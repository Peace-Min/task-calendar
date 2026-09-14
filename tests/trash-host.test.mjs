// 휴지통(영구 삭제) — 호스트 게이트 · docs/TRASH-DELETE.md §8 계약 ①~⑥(+ 2026-09-10 ⑦~⑨)
//
// 이 파일이 존재하는 이유:
//   이 저장소는 지금까지 **아무것도 지우지 않는 앱**이었다. 숨김(is_active=0)만 있었고, 그 사실이
//   여러 시험에 "DELETE 는 어디에도 없다"는 계약으로 박혀 있었다. 휴지통은 그 계약을 푼다 —
//   그러나 **없앤 것이 아니라 자리를 하나로 좁힌 것**이다. 그래서 지켜야 할 것이 여섯이다:
//     ① 권한 세 파일이 DELETE 를 실제로 부여한다(앱은 되는 줄 아는데 DB 가 1142 로 거부하는 상태 금지).
//     ② 휴지통 조회·복구·삭제가 **관리자 관문만** 연다.
//     ③ '기록 0건'의 기준 표 9개가 **정본에서 파생**된다(표 이름을 시험에도 코드에도 박제하지 않는다).
//     ④ 활성 항목은 DELETE 에 닿지 않는다 + 거부 문구가 설계 문장 그대로다.
//     ⑤ 이름 대조를 호스트도 한다(Ordinal · TRIM 없음).
//     ⑥ 다섯 표의 DELETE 문이 **한 함수 안에만** 있고, 인력은 부속 2표를 먼저 지운다.
//   2026-09-10 검토로 셋이 늘었다(전부 '조용히 엉뚱한 표를 건드리는' 한 종류의 결함이다):
//     ⑦ 복구의 sort_order 재매김(MAX+10)은 **구분·상태에만** 있다(§11-1).
//     ⑧ 복구는 is_active 를 잠근 채 읽고 **UPDATE 보다 먼저** 판정한다(이미 활성이면 거부).
//     ⑨ 복구·삭제의 종류 switch 에 '기본값으로 아무 표나' 고르는 `default:` 가 없다.
//
//   ★ 관문 우회 금지 자체는 tests/admin-auth.test.mjs 가 형태로 훑는다(opener 집합·연결 개시 지점).
//     여기서는 그 위에 얹히는 계약 — 권한 파일·정본 파생·거부 문구·삭제 순서 — 을 본다.
//   ★ 값을 시험에 박지 않는다: 표 9개는 정본(db/deploy/schema-calendar.sql)에서 읽고, 못 읽으면
//     통과가 아니라 실패다(판정 불가 ≠ 통과).
import { readFileSync } from 'node:fs';
//  ★ C# 슬라이서는 **하네스의 것을 쓴다**(2026-09-11 R2-W6). 이 파일에도 사본이 있었는데, 사본은 반드시
//    낡는다 — 실제로 하네스만 식(=>) 본문을 배웠고 이 사본은 그대로 다음 멤버를 삼키고 있었다.
import { test, assert, stripCsComments as stripCs, extractCsMember as csMember } from './harness.mjs';
import { canonSql, stripSqlComments } from './canon-schema.mjs';

const pdb  = readFileSync(new URL('../widget/ProjectDb.cs', import.meta.url), 'utf8');
const main = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');

// ── 기준 파일 — 없으면 '한 건의 실패'로 강등한다(최상위 throw 는 전 스위트 판정을 증발시킨다) ──
const missing = [];
const readOr = (rel, label) => {
  try { return readFileSync(new URL(rel, import.meta.url), 'utf8'); } catch (_) { missing.push(label); return ''; }
};
const CREATE_USER = 'db/deploy/create-app-user.sql';
const CAL_GRANTS  = 'db/deploy/grants-calendar.sql';
const USER_GRANTS = 'taskmgr-company-data/05-grants.sql';
const createUser  = readOr('../' + CREATE_USER, CREATE_USER);
const calGrants   = readOr('../' + CAL_GRANTS, CAL_GRANTS);
const userGrants  = readOr('../../' + USER_GRANTS, USER_GRANTS);

function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

//  정본에서 'app_user 를 FK 로 붙드는 표'를 읽어 낸다 — 목록을 시험에 적지 않기 위한 유일한 방법이다.
//  ★ 못 읽어 내면(형태가 바뀌었으면) 빈 배열을 돌려주지 않고 그 자리에서 실패한다.
function canonUserRefTables(sql) {
  const out = [];
  const re = /CREATE TABLE\s+`?(\w+)`?\s*\(([\s\S]*?)\n\)\s*ENGINE/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    if (/REFERENCES\s+`?app_user`?\s*\(/i.test(m[2])) out.push(m[1]);
  }
  assert.ok(out.length >= 10,
    `정본에서 app_user 를 붙드는 표를 ${out.length}개만 읽었다 — CREATE TABLE 형태가 바뀌었다면 이 파서를 함께 고칠 것(판정 불가)`);
  return out;
}

//  호스트의 기준 표 배열(문자열 리터럴만).
function hostUserRecordTables(cs) {
  const m = /private static readonly string\[\] UserRecordTables\s*=\s*\{([\s\S]*?)\};/.exec(stripCs(cs));
  assert.ok(m, 'ProjectDb 에서 UserRecordTables 배열을 찾지 못했다 — 이름이 바뀌었다면 여기도 함께 고칠 것(판정 불가)');
  return [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]);
}

// ══════════════════════════════════════════════════════════════════════
//  계약 — 검사와 변이가 같은 함수를 쓴다(검사가 실제로 잡는지 증명하려면 그래야 한다)
// ══════════════════════════════════════════════════════════════════════

const checks = {
  // ① 권한 세 파일 — 앱 계정이 다섯 표를 지울 수 있어야 휴지통이 동작한다(§3.3).
  //    권한은 '가능하게'만 한다. 무엇을 지울 수 있는지는 호스트 관문이 정한다.
  grantsThreeFiles(createSql, userSql, calSql) {
    for (const t of ['project', 'customer', 'section_code', 'status_code']) {
      const re = new RegExp('GRANT ([A-Z, ]+) ON taskmgr\\.' + t + '\\b');
      const m = re.exec(createSql);
      assert.ok(m, `create-app-user.sql 에 ${t} GRANT 가 없다`);
      assert.ok(/\bDELETE\b/.test(m[1]),
        `create-app-user.sql 이 ${t} 에 DELETE 를 주지 않는다 — 휴지통의 영구 삭제가 ERROR 1142 로 죽는다(§3.3)`);
    }
    const um = /GRANT ([A-Z, ]+) ON [^\n]*app_user/.exec(userSql);
    assert.ok(um, '05-grants.sql 에 app_user GRANT 가 없다');
    assert.ok(/\bDELETE\b/.test(um[1]),
      '05-grants.sql 이 app_user 에 DELETE 를 주지 않는다 — 기록 0건 계정 삭제가 ERROR 1142 로 죽는다(§3.3)');
    // grants-calendar.sql 은 app_user 의 GRANT 를 늘리지 않는다(그 도메인은 05-grants.sql). 대신 **서술이 사실이어야** 한다.
    // ★ 그러나 부속 2표(cal_user_pref·cal_user_rev)는 이 파일이 정본이고, 계정 영구 삭제가 app_user 보다 먼저 지운다 —
    //   DELETE 가 없으면 트랜잭션 첫 문장에서 1142 로 죽는다(2026-09-10 개발 DB 실측: loop-trash C02/C08 이 잡았다).
    for (const t of ['cal_user_pref', 'cal_user_rev']) {
      const re = new RegExp('GRANT ([A-Z, ]+) ON taskmgr\\.' + t + '\\b');
      const m = re.exec(calSql);
      assert.ok(m, `grants-calendar.sql 에 ${t} GRANT 가 없다`);
      assert.ok(/\bDELETE\b/.test(m[1]),
        `grants-calendar.sql 이 ${t} 에 DELETE 를 주지 않는다 — 계정 영구 삭제가 첫 문장(DELETE FROM ${t})에서 ERROR 1142 로 죽는다(§3.1·§3.4)`);
    }
    assert.ok(/app_user 의 DELETE 는 휴지통 관문\(ProjectDb\.DeleteTrashAsync\) 한 곳뿐이다/.test(calSql),
      'grants-calendar.sql 머리말이 아직 "app_user DELETE 없음"이다 — 없는 사실을 적어 두면 다음 사람이 그걸 믿는다');
    assert.ok(!/GRANT[^\n]*DELETE[^\n]*taskmgr\.app_user/.test(calSql),
      'grants-calendar.sql 이 app_user 의 DELETE 를 직접 부여한다 — 그 도메인의 GRANT 정본은 05-grants.sql 하나다');
  },

  // ② 관문 — 셋 다 OpenAdminAsync 뿐이고, 브리지 세 명령이 실제로 거기 닿는다.
  gateIsAdminOnly(cs, mainCs) {
    for (const nm of ['LoadTrashJsonAsync', 'RestoreTrashAsync', 'DeleteTrashAsync']) {
      const b = csMember(cs, nm + '(');
      //  단언 순서는 '원인을 정확히 말하는 쪽'이 앞이다 — 쓰기 관문으로 내려간 변이는
      //  '관리자 관문이 없다'로도 잡히지만, 그 문장은 무엇을 잘못했는지 말해 주지 않는다(admin-auth 와 같은 규칙).
      assert.ok(!/OpenWriteAsync\(/.test(b), `${nm} 가 쓰기 관문(editor 통과)으로 연다 — 되돌릴 수 없는 조작이 editor 에게 열린다`);
      assert.ok(!/OpenReadAsync\(/.test(b), `${nm} 가 읽기 관문으로 연다 — 권한 판정을 통째로 건너뛴다`);
      assert.ok(/OpenAdminAsync\(/.test(b), `${nm} 가 관리자 관문을 지나지 않는다 — 휴지통은 admin 전용이다(§4.1)`);
    }
    const code = stripCs(mainCs);
    for (const [cmd, fn] of [['trashGet', 'RunTrashGetAsync'], ['trashRestore', 'TrashRestoreAsync'], ['trashDelete', 'TrashDeleteAsync']]) {
      assert.ok(new RegExp('case "' + cmd + '":[\\s\\S]{0,300}?' + fn + '\\(').test(code),
        `브리지 case "${cmd}" 가 ${fn} 으로 이어지지 않는다 — 화면이 눌러도 아무 일도 안 난다`);
    }
    for (const [fn, host] of [['RunTrashGetAsync', 'LoadTrashJsonAsync'], ['TrashRestoreAsync', 'RestoreTrashAsync'], ['TrashDeleteAsync', 'DeleteTrashAsync']]) {
      const b = csMember(mainCs, 'private async Task ' + fn + '(');
      assert.ok(new RegExp('_projectDb\\.' + host + '\\(').test(b), `${fn} 이 ${host} 를 부르지 않는다`);
    }
    // 결과 회신·재조회(§4.2) — 없으면 "지웠는데 목록은 그대로"인 창이 생긴다.
    //  ★ 2026-09-14 — 그 결과는 이제 **푸시가 아니라 회신**이다(ReplyOnUi). 옛 판은 __trashDone 으로 밀었고,
    //    푸시에는 상관관계가 없어 웹이 그것을 손으로 한 벌 더 지었다(__trReq · 워치독). 이 저장소가 이미
    //    가진 요청/회신 배관으로 옮기면서 그 복제를 지웠다 — 그래서 여기서 보는 것은 "회신으로 돌려주는가"다.
    assert.ok(!/__trashDone/.test(code),
      '호스트에 아직 __trashDone 푸시가 남아 있다 — 결과는 회신(ReplyOnUi)으로만 간다(2026-09-14)');
    for (const fn of ['TrashRestoreAsync', 'TrashDeleteAsync']) {
      const b = csMember(mainCs, 'private async Task ' + fn + '(');
      assert.ok(/ReplyOnUi\(reqId, new \{ ok, msg, trash, roster \}\);/.test(b),
        `${fn} 이 결과를 회신(ReplyOnUi)으로 돌려주지 않는다 — 푸시로 되돌아가면 웹이 상관관계를 다시 손으로 짓는다`);
      assert.ok(/if \(ok\) await TrashRefreshRelatedAsync\(kind\);/.test(b),
        `${fn} 이 성공 뒤 관련 목록(과제·발주처·코드)을 다시 밀지 않는다 — 명부는 여기가 아니라 회신의 roster 로 간다`);
    }
    //  휴지통 목록 자체는 **성공·실패 모두** 회신에 실어야 하므로 부르는 쪽에 있다 — 계약⑩ 이 그 자리를 본다(R2).
    const refresh = csMember(mainCs, 'private async Task TrashRefreshRelatedAsync(');
    //  ★ 인력은 여기서 **아무것도 밀지 않는다**(2026-09-14). 갱신된 명부는 그 조작의 회신에 roster 로 실려
    //    가고, 웹이 「구성원 편집」과 **같은 문**(uaSeatReply)으로 앉힌다(task-calendar-prototype.html §trSend).
    //    "그 화면은 이 요청을 보낸 적이 없어 회신으로 닿을 수 없다" 는 서술은 사실이 아니었다 — 그래서 푸시까지
    //    하면 같은 명부를 DB 에서 **두 번** 읽고 #uaList 를 **두 번** 칠했다. 배달은 한 번이어야 한다.
    //    ★ 여기가 그 푸시의 **마지막 호출부**였으므로 방출부(LoadMembersToWebAsync)와 웹 수신부
    //      (window.__applyMembers)도 함께 사라졌다. 그 **부재**는 widget/*.cs 와 웹을 함께 훑는
    //      user-admin 계약⑭-h4 가 지킨다 — 여기서는 이 갈래가 일찍 돌아가는지만 본다.
    assert.ok(/if \(kind == "user"\) return;/.test(refresh),
      '인력 갈래가 일찍 돌아가지 않는다 — 갈래가 없어지면 과제·발주처·코드 푸시가 인력 조작에까지 번진다');
    //  나머지 갱신은 **그대로**다 — 그쪽은 이 요청의 회신이 나르지 않는 **다른 화면**이다.
    assert.ok(/LoadProjectsToWebAsync\(\)/.test(refresh), '과제·코드 조작 뒤 카탈로그를 다시 밀지 않는다(dbGone 재판정이 걸려 있다)');
  },

  // ③ '기록 0건'의 기준 표 = 정본의 REFERENCES app_user 에서 부속 2표를 뺀 것(§3.2).
  //    ★ 시험에도 코드에도 목록을 박제하지 않는다 — 정본이 움직이면 둘 다 따라 움직여야 한다.
  userRecordTablesMatchCanon(cs, canonText) {
    const ATTACHED = ['cal_user_pref', 'cal_user_rev'];
    //  주석에는 옛 상태 서술이 일부러 남아 있다 — 지우고 본다(canon-schema 와 같은 규칙).
    const expect = canonUserRefTables(stripSqlComments(canonText)).filter((t) => !ATTACHED.includes(t)).sort();
    const actual = [...hostUserRecordTables(cs)].sort();
    assert.deepStrictEqual(actual, expect,
      `호스트의 기준 표 목록이 정본과 다르다.\n  정본(부속 2표 제외): ${expect.join(', ')}\n  호스트: ${actual.join(', ')}\n` +
      '  빠진 표가 있으면 그 표에 기록이 남은 계정을 "기록 0건"으로 오판해 지우려 든다(DB 가 1451 로 막지만, ' +
      '화면은 지울 수 있다고 거짓말한 뒤다).');
    for (const t of ATTACHED) {
      assert.ok(!actual.includes(t),
        `${t} 이 기록 표에 끼었다 — 로그인 한 번이면 생기는 부속 행이라 아무도 지울 수 없게 된다(§3.2)`);
    }
  },

  // ④ 활성 항목은 DELETE 에 닿지 않는다 + 거부 문구가 설계(§4.3) 문장 그대로다.
  activeGuardAndMessages(cs) {
    const del = csMember(cs, 'DeleteTrashAsync(');
    //  문구는 상수로 들어온다(아래에서 그 상수의 글자를 따로 못박는다) — 여기서 보는 것은 **자리**다.
    const guard = del.indexOf('TrashActiveMsg');
    const firstDelete = del.search(/DELETE\s+FROM/);
    assert.ok(guard >= 0, '영구 삭제에 활성 항목 거부(TrashActiveMsg)가 없다(§4.3)');
    assert.ok(firstDelete >= 0, '영구 삭제에 DELETE 문이 없다(측정 불가 ≠ 통과)');
    assert.ok(guard < firstDelete,
      '활성 항목 판정이 첫 DELETE 보다 뒤에 있다 — 숨기지 않은 항목이 지워질 수 있다(숨김 → 휴지통 두 단계가 실수 방지의 전부다)');
    assert.ok(/if \(isActive != 0\)/.test(del), '활성 판정이 is_active 값 비교가 아니다');
    // 문구는 상수 한 곳에서만 온다 — 같은 말을 두 곳에 적으면 한쪽만 고쳐진다.
    const code = stripCs(cs);
    for (const [nm, txt] of [
      ['TrashGoneMsg', '이미 삭제됐거나 없는 항목입니다 — 목록을 새로고침합니다.'],
      ['TrashActiveMsg', '숨긴(퇴사) 항목만 지울 수 있습니다. 먼저 숨기세요.'],
      ['TrashNameMsg', '입력한 이름이 다릅니다.'],
      ['TrashSelfMsg', '자기 계정은 지울 수 없습니다.'],
      ['TrashFkMsg', '다른 기록이 붙어 있어 지울 수 없습니다.'],
      ['TrashKindMsg', '알 수 없는 대상입니다.'],
      ['TrashDoneMsg', '영구 삭제했습니다.'],
    ]) {
      const re = new RegExp('const string ' + nm + '\\s*=\\s*"' + txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"');
      assert.ok(re.test(code), `거부/완료 문구 상수 ${nm} 이 설계 §4.3 과 다르다`);
      const uses = code.split(nm).length - 1;
      assert.ok(uses >= 2, `${nm} 이 선언만 있고 쓰이지 않는다 — 문장이 화면에 닿지 않는다`);
    }
    // 수가 들어가는 두 문장은 조립식이다 — 꼬리 문장을 계약으로 잡는다.
    assert.ok(/"기록 " \+ n \+ "건이 있어 지울 수 없습니다\. 퇴사 상태로 유지됩니다\."/.test(code),
      '인력 거부 문구(기록 n건)가 설계 §4.3 과 다르다');
    assert.ok(/"이 값을 쓰는 과제가 " \+ n \+ "건\(숨긴 과제 포함\) 있어 지울 수 없습니다\."/.test(code),
      '코드 거부 문구(과제 n건)가 설계 §4.3 과 다르다');
    // 인력·코드의 거부는 '재계산한 수'로 한다(화면 힌트를 그대로 믿지 않는다).
    assert.ok(/if \(refs > 0\)[\s\S]{0,140}UserRecordsMsg\(refs\)/.test(del),
      '인력 삭제가 기록 수를 재계산해 거부하지 않는다 — 힌트는 조회 시점 값이다(§4.2)');
    assert.ok(/if \(refs > 0\)[\s\S]{0,140}CodeInUseMsg\(refs\)/.test(del),
      '코드 삭제가 사용 과제 수를 재계산해 거부하지 않는다');
    assert.ok(/TrashSelfMsg/.test(del), '자기 계정 금지(§3.4)가 영구 삭제에 없다');
  },

  // ⑤ 이름 대조는 호스트도 한다 — Ordinal · TRIM 없음(§5.2).
  confirmCompareIsOrdinalNoTrim(cs) {
    const del = csMember(cs, 'DeleteTrashAsync(');
    assert.ok(/string\.Equals\(confirm \?\? "", storedName, StringComparison\.Ordinal\)/.test(del),
      '이름 대조가 Ordinal 비교가 아니다 — 화면만 대조하면 브리지로 직접 보내는 경로가 확인을 건너뛴다(§8-5)');
    assert.ok(/if \(!string\.Equals\(confirm[\s\S]{0,120}TrashNameMsg/.test(del),
      '이름이 달라도 거부하지 않는다(대조 결과가 흐름을 바꾸지 않는다)');
    assert.ok(!/confirm[^\n]*\.Trim\(\)/.test(del),
      'confirm 을 TRIM 한다 — 이름에 공백이 있으면 공백까지 같아야 한다(§5.2)');
    const cmpAt = del.search(/string\.Equals\(confirm/);
    const firstDelete = del.search(/DELETE\s+FROM/);
    assert.ok(cmpAt >= 0 && firstDelete > cmpAt,
      '이름 대조가 첫 DELETE 보다 뒤에 있다 — 확인 없이 지워진다');
  },

  // ⑥ 다섯 표의 DELETE 는 한 함수 안에만. 인력은 부속 2표를 **먼저** 지운다(§3.1).
  deleteSqlLivesInOneFunction(cs) {
    const code = stripCs(cs);
    const del = csMember(cs, 'DeleteTrashAsync(');
    const outside = code.replace(del, '');
    for (const t of ['project', 'app_user', 'customer', 'section_code', 'status_code', 'cal_user_pref', 'cal_user_rev']) {
      assert.ok(new RegExp('DELETE\\s+FROM\\s+' + t + '\\b').test(del),
        `영구 삭제에 ${t} 의 DELETE 문이 없다 — 다섯 표 + 부속 2표가 이 함수 하나에 모여 있어야 한다`);
      assert.ok(!new RegExp('DELETE\\s+FROM\\s+' + t + '\\b').test(outside),
        `DeleteTrashAsync 밖에서 ${t} 를 DELETE 한다 — 지우는 자리는 관문을 지난 한 곳뿐이다(§3.3)`);
    }
    const pref = del.search(/DELETE\s+FROM\s+cal_user_pref\b/);
    const rev  = del.search(/DELETE\s+FROM\s+cal_user_rev\b/);
    const user = del.search(/DELETE\s+FROM\s+app_user\b/);
    assert.ok(pref < user && rev < user,
      '부속 2표(cal_user_pref·cal_user_rev)를 app_user 보다 뒤에 지운다 — FK RESTRICT 가 1451 로 거부해 아무도 못 지운다(§3.1)');
    // 1451 은 '힌트가 틀렸을 때의 최후 방어'다 — 사용자 문장은 고정, FK 이름은 로그에만.
    assert.ok(/catch \(MySqlException mex\) when \(mex\.Number == 1451\)/.test(del),
      'FK 1451 을 따로 잡지 않는다 — "지우지 못했습니다: …" 같은 원문이 사용자에게 샌다(§4.3)');
  },

  // ⑦ 복구의 sort_order 재매김은 **구분·상태에만** 있다(§11-1).
  //    과제·인력·발주처에 재매김이 번지면 없는 컬럼을 건드리거나(과제·인력) 쓰지도 않는 서열을 흔든다.
  //    반대로 구분·상태에서 빠지면 옛 순번을 들고 돌아와 활성끼리 겹친다(루프 I5 가 실측한 결함).
  restoreReordersOnlyCodes(cs) {
    const re = csMember(cs, 'RestoreTrashAsync(');
    const lines = re.split('\n').filter((l) => /UPDATE\s+\w+\s+SET is_active=1/.test(l));
    assert.strictEqual(lines.length, 5,
      `복구 UPDATE 가 ${lines.length}개다 — 다섯 표가 한 갈래씩이어야 한다(측정 불가 ≠ 통과)`);
    for (const l of lines) {
      const tbl = /UPDATE\s+(\w+)\s+SET/.exec(l)[1];
      const has = /COALESCE\(MAX\(sort_order\),0\)\+10/.test(l);
      const should = tbl === 'section_code' || tbl === 'status_code';
      assert.strictEqual(has, should, should
        ? `${tbl} 복구에 sort_order 재매김(MAX+10)이 없다 — 옛 순번이 활성 목록 사이에 끼어든다(§11-1)`
        : `${tbl} 복구가 sort_order 를 다시 매긴다 — 재매김은 구분·상태 코드에만 있는 규칙이다`);
    }
    //  ★ 2026-09-11 적대 검토(R3) — 인력만은 **비운다**(sort_order=NULL). 뜻은 코드 2종의 MAX+10 과
    //    같다(돌아온 사람은 맨 뒤에 선다) — 셈이 다를 뿐이다. 명부 ORDER BY 가 NULL 을 맨 뒤로 보내므로
    //    (USER-ADMIN §5.3) 최댓값을 셀 필요가 없고, 값이 없다는 사실 자체가 '아직 자리를 안 정했다' 다.
    //    이 한 줄이 빠지면 퇴사자가 옛 순번을 들고 돌아와 활성 서열(10·20·30…) 사이에 끼어든다(§7-1a).
    //    ★ 같은 규칙이 SetUserActiveAsync(편집 폼의 [복구])에도 있다 — 복구 경로는 둘이고, 한쪽만
    //      고치면 그쪽으로 돌아온 사람이 결함을 그대로 재현한다(그 축은 user-admin 게이트 ⑥-f 가 진다).
    const userLine = lines.find((l) => /UPDATE app_user SET/.test(l));
    assert.ok(userLine && /UPDATE app_user SET is_active=1, sort_order=NULL WHERE user_id=@k/.test(userLine),
      '인력 복구가 sort_order 를 비우지 않는다(NULL = 명부 맨 뒤) — 퇴사자가 옛 순번을 들고 돌아와 ' +
      '활성 서열 사이에 끼어든다(USER-ADMIN §7-1a · R3)');
  },

  // ⑧ 복구는 is_active 를 **잠근 채** 읽고 UPDATE 보다 먼저 판정한다(2026-09-10 검토 지적).
  //    두 관리자가 같은 항목을 동시에 복구하면 뒤에 온 쪽이 이미 활성인 행에 UPDATE 를 걸고,
  //    구분·상태는 그 자리에서 sort_order 를 MAX+10 으로 **다시** 매겨 멀쩡한 값이 맨 뒤로 튄다.
  restoreChecksAlreadyActive(cs) {
    const code = stripCs(cs);
    const re = csMember(cs, 'RestoreTrashAsync(');
    //  SQL 은 표·컬럼 이름을 이어 붙여 만든다(상수 조각) — 조각 사이에 따옴표가 끼므로 조각으로 본다.
    assert.ok(/is_active AS act FROM/.test(re),
      '복구가 잠근 SELECT 에서 is_active 를 읽지 않는다 — 이미 복구된 항목인지 알 길이 없다');
    assert.ok(/FOR UPDATE/.test(re),
      '복구가 대상 행을 FOR UPDATE 로 잠그지 않는다 — 판정과 갱신 사이에 남이 복구할 수 있다');
    assert.ok(/if \(wasActive != 0\)/.test(re),
      '복구에 "이미 활성인가" 판정이 없다(값 비교가 아니다)');
    const guard = re.indexOf('AlreadyActiveMsg');
    const upd = re.search(/UPDATE\s+\w+\s+SET is_active=1/);
    assert.ok(guard >= 0, '복구에 이미 활성 거부(AlreadyActiveMsg)가 없다');
    assert.ok(upd >= 0, '복구에 UPDATE 문이 없다(측정 불가 ≠ 통과)');
    assert.ok(guard < upd,
      '이미 활성 판정이 첫 UPDATE 보다 뒤에 있다 — 남이 이미 복구한 코드의 순번이 맨 뒤로 튄다');
    assert.ok(/const string AlreadyActiveMsg\s*=\s*"이미 복구된 항목입니다 — 목록을 새로고침합니다\."/.test(code),
      '이미 복구됨 문구 상수가 설계 §4.3 과 다르다 — 실패가 아니라 "목록이 낡았다"고 말해야 한다');
  },

  // ⑨ 종류 switch 에 '기본값으로 아무 표나' 고르는 자리가 없다.
  //    옛 `default:` 는 둘 다 status_code 였다 — 종류가 하나 늘고 한쪽만 안 고치면 **엉뚱한 표**가 복구·삭제된다.
  kindSwitchHasNoSilentDefault(cs) {
    for (const nm of ['RestoreTrashAsync', 'DeleteTrashAsync']) {
      const b = csMember(cs, nm + '(');
      const defaults = [...b.matchAll(/default:([\s\S]{0,160})/g)];
      assert.ok(defaults.length >= 1, `${nm} 에서 종류 switch 의 default: 를 찾지 못했다(측정 불가 ≠ 통과)`);
      for (const d of defaults) {
        assert.ok(!/status_code/.test(d[1]),
          `${nm} 의 default: 가 status_code 를 고른다 — 종류가 늘고 이 switch 만 안 고치면 상태 코드가 대신 바뀐다`);
        //  거부 문장(TrashKindMsg)이든 예외든 좋다 — 금지되는 것은 '기본값으로 아무 표나 고르는 것' 하나다.
        //  2026-09-11(R5) 이후 실물은 throw 다: ResolveTrashKind 가 이미 걸러 여기 닿지 않으므로,
        //  닿았다면 종류가 늘고 이 switch 만 안 고친 것이라 거부 문장을 한 벌 더 적어 덮을 일이 아니다.
        assert.ok(/TrashKindMsg|throw new InvalidOperationException/.test(d[1]),
          `${nm} 의 default: 가 거부도 예외도 아니다 — 되돌릴 수 없는 조작에 '기본값으로 아무거나'는 없다`);
      }
      assert.ok(/case "status":/.test(b),
        `${nm} 가 status 를 이름으로 적지 않는다 — default: 에 기대는 순간 위 계약이 지킬 것을 잃는다`);
    }
  },

  // ⑩ 결과 회신이 **약속한 새로고침을 실제로 나르고**, 자기 요청과 짝지어진다(2026-09-11 R2·R3 → 2026-09-14).
  //    (a) 거부 문구 둘이 "…목록을 새로고침합니다"라고 말한다(TrashGoneMsg · AlreadyActiveMsg).
  //        그 둘은 정확히 **실패**할 때 나오는 문장인데 옛 판은 성공했을 때만 목록을 밀었다 —
  //        사용자는 "새로고침한다"를 읽으면서 사라진 항목이 그대로 있는 목록을 봤다. R2 가 그것을 '결과와
  //        무관하게 민다'로 닫았고, 지금은 그 갱신이 **회신에 실려**(trash) 간다 — 규칙은 그대로고 전송만 바뀌었다.
  //        관련 목록(과제·발주처·코드)은 그대로 **성공에만** — 실패했으면 그쪽은 바뀌지 않았다(계약② 가 본다).
  //    (b) 회신은 reqId 왕복(ReplyOnUi)이다. 옛 판은 푸시(__trashDone)였고 푸시에는 상관관계가 없어,
  //        웹이 그 짝짓기를 손으로 한 벌 더 지어야 했다(__trReq · 워치독). 배관이 이미 보장하는 것을
  //        복제한 자리라, 다섯 쓰기를 배관 위로 옮기면서 그 복제를 통째로 지웠다.
  //    (c) 인력을 복구·삭제하면 명부도 같은 회신에 실린다(roster) — 조건은 옛 명부 푸시와 **같다**
  //        (ok && kind=="user"). 나머지 종류·실패는 명부가 바뀌지 않았으므로 ""다.
  trashReplyCarriesFreshLists(mainCs) {
    const code = stripCs(mainCs);
    for (const [cmd, fn] of [['trashRestore', 'TrashRestoreAsync'], ['trashDelete', 'TrashDeleteAsync']]) {
      assert.ok(new RegExp('case "' + cmd + '":[\\s\\S]{0,300}?' + fn + '\\(GetStr\\(doc, "reqId"\\)').test(code),
        `브리지 case "${cmd}" 가 reqId 를 넘기지 않는다 — 회신이 어느 요청의 것인지 배관이 알 수 없다(R3)`);
      const b = csMember(mainCs, 'private async Task ' + fn + '(');
      assert.ok(/^private async Task \w+\(string reqId, /.test(b), `${fn} 이 reqId 를 받지 않는다(R3)`);
      assert.ok(/ReplyOnUi\(reqId, new \{ ok, msg, trash, roster \}\);/.test(b),
        `${fn} 의 회신이 {ok, msg, trash, roster} 가 아니다 — 결과와 갱신 목록이 **한 회신**으로 가야 ` +
        '웹이 뒤따르는 푸시를 기다리지 않는다(기다림이 있었기 때문에 워치독이 필요했다 · 2026-09-14)');
      assert.ok(/await ReadTrashJsonAsync\(\)/.test(b),
        `${fn} 이 휴지통 목록을 다시 읽지 않는다 — 거부 문구가 약속한 "목록을 새로고침합니다"가 거짓말이 된다(R2)`);
      assert.ok(!/\bok\b[^\n]*ReadTrashJsonAsync/.test(b),
        `${fn} 이 휴지통 목록 갱신을 성공(ok)에만 건다 — 그 문구는 정확히 **실패**할 때 나오는 말이다(R2)`);
      //  명부는 반대다 — **성공 + 인력**일 때만. 옛 TrashRefreshRelatedAsync 의 푸시 조건 그대로다.
      assert.ok(/string roster = ok && kind == "user" \? await ReadMembersJsonAsync\(includeInactive\) : "";/.test(b),
        `${fn} 의 roster 조건이 'ok && kind=="user"' 가 아니다 — 옛 명부 푸시와 같은 조건이어야 한다(전송만 바뀐다)`);
    }
    //  옛 푸시 배관은 **남아 있으면 안 된다**. 남겨 두면 웹이 그 위에 상관관계를 다시 손으로 짓는다.
    assert.ok(!/__trashDone/.test(code), '호스트에 아직 __trashDone 푸시가 남아 있다(2026-09-14)');
    assert.ok(!/LoadTrashToWebAsync/.test(code),
      '휴지통 푸시(LoadTrashToWebAsync)가 아직 남아 있다 — 갱신은 회신의 trash 하나로만 간다(2026-09-14)');
  },
};

// ══════════════════════════════════════════════════════════════════════
//  계약 검사
// ══════════════════════════════════════════════════════════════════════

test('기준⓪: 이 게이트의 기준 파일이 전부 실재한다(못 읽었으면 통과가 아니라 측정 실패다)', () => {
  assert.deepStrictEqual(missing, [],
    '휴지통 게이트가 기준 파일을 읽지 못했다. 없는 것: ' + missing.join(', ') + '\n' +
    '  · taskmgr-company-data 는 이 저장소의 **형제 폴더**여야 한다(app_user 권한의 정본이 거기 있다).');
});

test('계약①: 권한 세 파일이 다섯 표 DELETE 를 부여하고 서술이 사실이다(TRASH-DELETE §3.3)', () => {
  checks.grantsThreeFiles(createUser, userGrants, calGrants);
});

test('계약②: 휴지통 조회·복구·삭제가 관리자 관문만 열고, 브리지 3종이 거기 닿는다(§4.1·§4.2)', () => {
  checks.gateIsAdminOnly(pdb, main);
});

test("계약③: '기록 0건'의 기준 표 9개가 정본에서 파생된다(박제 금지 · §3.2)", () => {
  checks.userRecordTablesMatchCanon(pdb, canonSql());
});

test('계약④: 활성 항목은 DELETE 에 닿지 않고, 거부 문구가 설계 문장 그대로다(§4.3)', () => {
  checks.activeGuardAndMessages(pdb);
});

test('계약⑤: 이름 대조를 호스트도 한다 — Ordinal · TRIM 없음(§5.2)', () => {
  checks.confirmCompareIsOrdinalNoTrim(pdb);
});

test('계약⑥: 다섯 표의 DELETE 는 한 함수 안에만 있고, 인력은 부속 2표를 먼저 지운다(§3.1)', () => {
  checks.deleteSqlLivesInOneFunction(pdb);
});

test('계약⑦: 복구의 sort_order 재매김(MAX+10)은 구분·상태에만 있다(§11-1)', () => {
  checks.restoreReordersOnlyCodes(pdb);
});

test('계약⑧: 복구는 is_active 를 잠근 채 읽고 UPDATE 보다 먼저 판정한다(이미 복구된 항목 거부)', () => {
  checks.restoreChecksAlreadyActive(pdb);
});

test("계약⑨: 복구·삭제의 종류 switch 에 '기본값으로 status_code' 가 없다", () => {
  checks.kindSwitchHasNoSilentDefault(pdb);
});

test('계약⑩: 복구·삭제는 reqId 회신으로 답하고 그 회신이 휴지통(+인력이면 명부)을 나른다(R2·R3 · 2026-09-14)', () => {
  checks.trashReplyCarriesFreshLists(main);
});

// ══════════════════════════════════════════════════════════════════════
//  변이 주입 — 위 계약이 실효성이 있는지 증명한다(안 잡으면 그 검사는 장식이다)
// ══════════════════════════════════════════════════════════════════════

test('변이①: create-app-user.sql 에서 한 표의 DELETE 를 빼면 계약① 이 실패한다', () => {
  const bad = mutate(createUser,
    'GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.section_code',
    'GRANT SELECT, INSERT, UPDATE ON taskmgr.section_code');
  assert.throws(() => checks.grantsThreeFiles(bad, userGrants, calGrants), /section_code 에 DELETE 를 주지 않는다/);
  assert.doesNotThrow(() => checks.grantsThreeFiles(createUser, userGrants, calGrants));   // 통제군
});

test('변이①-c: grants-calendar.sql 에서 cal_user_rev 의 DELETE 를 빼면 계약① 이 실패한다(부속 2표도 정본)', () => {
  const bad = mutate(calGrants,
    'GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.cal_user_rev',
    'GRANT SELECT, INSERT, UPDATE ON taskmgr.cal_user_rev');
  assert.throws(() => checks.grantsThreeFiles(createUser, userGrants, bad), /cal_user_rev 에 DELETE 를 주지 않는다/);
  assert.doesNotThrow(() => checks.grantsThreeFiles(createUser, userGrants, calGrants));   // 통제군
});

test('변이①-b: 05-grants.sql 에서 app_user 의 DELETE 를 빼면 계약① 이 실패한다', () => {
  const bad = mutate(userGrants, 'GRANT SELECT, INSERT, UPDATE, DELETE ON `', 'GRANT SELECT, INSERT, UPDATE ON `');
  assert.throws(() => checks.grantsThreeFiles(createUser, bad, calGrants), /app_user 에 DELETE 를 주지 않는다/);
});

test('변이①-c: grants-calendar.sql 서술을 옛 "DELETE 없음"으로 되돌리면 계약① 이 실패한다', () => {
  const bad = mutate(calGrants,
    'app_user 의 DELETE 는 휴지통 관문(ProjectDb.DeleteTrashAsync) 한 곳뿐이다',
    'app_user 의 DELETE 는 어디에도 없다');
  assert.throws(() => checks.grantsThreeFiles(createUser, userGrants, bad), /아직 "app_user DELETE 없음"이다/);
});

test('변이②: 영구 삭제를 쓰기 관문(editor 통과)으로 내리면 계약② 가 실패한다', () => {
  const bad = mutate(pdb,
    'try { conn = await OpenAdminAsync(cts.Token); }\n                catch (NotAuthorizedException nex) { _log("권한 거부(영구 삭제): "',
    'try { conn = await OpenWriteAsync(cts.Token); }\n                catch (NotAuthorizedException nex) { _log("권한 거부(영구 삭제): "');
  assert.throws(() => checks.gateIsAdminOnly(bad, main), /DeleteTrashAsync 가 쓰기 관문/);
  assert.doesNotThrow(() => checks.gateIsAdminOnly(pdb, main));   // 통제군
});

test('변이②-b: 휴지통 조회를 읽기 관문으로 내리면 계약② 가 실패한다(비관리자가 숨긴 항목 전량을 본다)', () => {
  const bad = mutate(pdb,
    'try { conn = await OpenAdminAsync(cts.Token); }\n                catch (NotAuthorizedException nex)\n                {',
    'try { conn = await OpenReadAsync(cts.Token); }\n                catch (NotAuthorizedException nex)\n                {');
  assert.throws(() => checks.gateIsAdminOnly(bad, main), /LoadTrashJsonAsync 가 (?:관리자 관문을 지나지 않는다|읽기 관문)/);
});

test('변이②-d: 인력 갈래를 통째로 지우면 계약② 가 실패한다(과제·발주처 푸시가 인력 조작에 번진다)', () => {
  const bad = mutate(main, 'if (kind == "user") return;', '');
  assert.throws(() => checks.gateIsAdminOnly(pdb, bad), /인력 갈래가 일찍 돌아가지 않는다/);
  assert.doesNotThrow(() => checks.gateIsAdminOnly(pdb, main));   // 통제군
});

test('변이③: 기준 표 배열에서 한 표를 빼면 계약③ 이 실패한다(정본 파생이 아니면 통과할 변이)', () => {
  const bad = mutate(pdb, '"cal_room", ', '');
  assert.throws(() => checks.userRecordTablesMatchCanon(bad, canonSql()), /기준 표 목록이 정본과 다르다/);
  assert.doesNotThrow(() => checks.userRecordTablesMatchCanon(pdb, canonSql()));   // 통제군
});

test('변이③-b: 부속 2표를 기록 표에 끼워 넣으면 계약③ 이 실패한다(아무도 못 지우게 된다)', () => {
  const bad = mutate(pdb, '"cal_migration_log",', '"cal_migration_log", "cal_user_pref",');
  assert.throws(() => checks.userRecordTablesMatchCanon(bad, canonSql()), /정본과 다르다|기록 표에 끼었다/);
});

test('변이④: 활성 항목 판정을 지우면 계약④ 가 실패한다(숨기지 않은 항목이 지워진다)', () => {
  const bad = mutate(pdb,
    'if (isActive != 0) { await tx.RollbackAsync(cts.Token); return (false, TrashActiveMsg); }',
    'if (false) { await tx.RollbackAsync(cts.Token); return (false, "x"); }');
  assert.throws(() => checks.activeGuardAndMessages(bad), /활성 항목 거부\(TrashActiveMsg\)가 없다|is_active 값 비교가 아니다/);
  assert.doesNotThrow(() => checks.activeGuardAndMessages(pdb));   // 통제군
});

test('변이④-b: 거부 문구를 살짝 바꾸면 계약④ 가 실패한다(설계 문장과 두 벌이 된다)', () => {
  const bad = mutate(pdb, '숨긴(퇴사) 항목만 지울 수 있습니다. 먼저 숨기세요.', '숨긴 항목만 삭제 가능합니다.');
  assert.throws(() => checks.activeGuardAndMessages(bad), /TrashActiveMsg 이 설계 §4\.3 과 다르다/);
});

test('변이⑤: 이름 대조를 지우면 계약⑤ 가 실패한다(확인 없이 지워진다)', () => {
  const bad = mutate(pdb,
    'if (!string.Equals(confirm ?? "", storedName, StringComparison.Ordinal))',
    'if (false)');
  assert.throws(() => checks.confirmCompareIsOrdinalNoTrim(bad), /Ordinal 비교가 아니다/);
  assert.doesNotThrow(() => checks.confirmCompareIsOrdinalNoTrim(pdb));   // 통제군
});

test('변이⑤-b: 대조 전에 confirm 을 TRIM 하면 계약⑤ 가 실패한다(끝공백 이름이 통과한다)', () => {
  const bad = mutate(pdb,
    'string storedName = row.TryGetValue(nameCol, out var nv)',
    'confirm = (confirm ?? "").Trim();\n                    string storedName = row.TryGetValue(nameCol, out var nv)');
  assert.throws(() => checks.confirmCompareIsOrdinalNoTrim(bad), /confirm 을 TRIM 한다/);
});

test('변이⑥: 휴지통 밖에 하드삭제 경로가 생기면 계약⑥ 이 실패한다', () => {
  const bad = mutate(pdb,
    'await using var cmd = new MySqlCommand("UPDATE project SET is_active=@a WHERE uid=@uid", conn);',
    'await using var cmd = new MySqlCommand("DELETE FROM project WHERE uid=@uid", conn);');
  assert.throws(() => checks.deleteSqlLivesInOneFunction(bad), /DeleteTrashAsync 밖에서 project 를 DELETE 한다/);
  assert.doesNotThrow(() => checks.deleteSqlLivesInOneFunction(pdb));   // 통제군
});

test('변이⑥-b: 부속 2표를 app_user 뒤로 옮기면 계약⑥ 이 실패한다(FK 1451 로 아무도 못 지운다)', () => {
  const PREF = '                        await using (var cmd = new MySqlCommand("DELETE FROM cal_user_pref WHERE user_id=@u", conn, tx))\n' +
               '                        { cmd.Parameters.AddWithValue("@u", targetUserId); await cmd.ExecuteNonQueryAsync(cts.Token); }\n';
  let bad = mutate(pdb, PREF, '');
  bad = mutate(bad, '                    if (n == 0) { await tx.RollbackAsync(cts.Token); return (false, TrashGoneMsg); }',
                    PREF + '                    if (n == 0) { await tx.RollbackAsync(cts.Token); return (false, TrashGoneMsg); }');
  assert.throws(() => checks.deleteSqlLivesInOneFunction(bad), /app_user 보다 뒤에 지운다/);
});

test('변이⑦: 과제 복구에까지 sort_order 재매김을 번지게 하면 계약⑦ 이 실패한다', () => {
  const bad = mutate(pdb,
    '"UPDATE project SET is_active=1 WHERE uid=@k"',
    '"UPDATE project SET is_active=1, sort_order=(SELECT s FROM (SELECT COALESCE(MAX(sort_order),0)+10 AS s FROM project) x) WHERE uid=@k"');
  assert.throws(() => checks.restoreReordersOnlyCodes(bad), /project 복구가 sort_order 를 다시 매긴다/);
  assert.doesNotThrow(() => checks.restoreReordersOnlyCodes(pdb));   // 통제군
});

test('변이⑦-a2: 인력 복구에서 sort_order=NULL 을 빼면 계약⑦ 이 실패한다(옛 순번을 들고 돌아온다 · R3)', () => {
  const bad = mutate(pdb,
    'sql = "UPDATE app_user SET is_active=1, sort_order=NULL WHERE user_id=@k"',
    'sql = "UPDATE app_user SET is_active=1 WHERE user_id=@k"');
  assert.throws(() => checks.restoreReordersOnlyCodes(bad), /인력 복구가 sort_order 를 비우지 않는다/);
});

test('변이⑦-a3: 인력 복구를 코드 2종처럼 MAX\\+10 으로 바꾸면 계약⑦ 이 실패한다(재매김은 코드만의 규칙이다)', () => {
  const bad = mutate(pdb,
    'sql = "UPDATE app_user SET is_active=1, sort_order=NULL WHERE user_id=@k"',
    'sql = "UPDATE app_user SET is_active=1, sort_order=(SELECT s FROM (SELECT COALESCE(MAX(sort_order),0)+10 AS s FROM app_user) x) WHERE user_id=@k"');
  assert.throws(() => checks.restoreReordersOnlyCodes(bad), /app_user 복구가 sort_order 를 다시 매긴다/);
});

test('변이⑦-b: 구분 복구에서 재매김을 빼면 계약⑦ 이 실패한다(옛 순번이 활성 사이에 끼어든다)', () => {
  const bad = mutate(pdb,
    '"UPDATE section_code SET is_active=1, sort_order=(SELECT s FROM (SELECT COALESCE(MAX(sort_order),0)+10 AS s FROM section_code) x) WHERE name=@k"',
    '"UPDATE section_code SET is_active=1 WHERE name=@k"');
  assert.throws(() => checks.restoreReordersOnlyCodes(bad), /section_code 복구에 sort_order 재매김/);
});

test('변이⑧: 이미 활성 판정을 지우면 계약⑧ 이 실패한다(남이 복구한 코드의 순번이 맨 뒤로 튄다)', () => {
  const bad = mutate(pdb,
    'if (wasActive != 0) { await tx.RollbackAsync(cts.Token); return (false, AlreadyActiveMsg); }',
    'if (false) { }');
  assert.throws(() => checks.restoreChecksAlreadyActive(bad), /이미 활성 거부\(AlreadyActiveMsg\)가 없다|값 비교가 아니다/);
  assert.doesNotThrow(() => checks.restoreChecksAlreadyActive(pdb));   // 통제군
});

test('변이⑧-b: 잠근 SELECT 에서 is_active 를 빼면 계약⑧ 이 실패한다(판정의 근거가 사라진다)', () => {
  const bad = mutate(pdb, ' AS nm, is_active AS act FROM ', ' AS nm FROM ');
  assert.throws(() => checks.restoreChecksAlreadyActive(bad), /is_active 를 읽지 않는다/);
});

test('변이⑨: 복구의 default: 를 옛 status_code 로 되돌리면 계약⑨ 가 실패한다', () => {
  const bad = mutate(pdb,
    '                        default:         throw new InvalidOperationException("알 수 없는 휴지통 종류(복구): " + kd);',
    '                        default:         sql = "UPDATE status_code SET is_active=1, sort_order=(SELECT s FROM (SELECT COALESCE(MAX(sort_order),0)+10 AS s FROM status_code) x) WHERE name=@k"; break;');
  assert.throws(() => checks.kindSwitchHasNoSilentDefault(bad), /default: 가 status_code 를 고른다|status 를 이름으로 적지 않는다/);
  assert.doesNotThrow(() => checks.kindSwitchHasNoSilentDefault(pdb));   // 통제군
});

test('변이⑨-b: 영구 삭제의 default: 를 옛 status_code 로 되돌리면 계약⑨ 가 실패한다', () => {
  const bad = mutate(pdb,
    '                        default:         throw new InvalidOperationException("알 수 없는 휴지통 종류(영구 삭제): " + kd);',
    '                        default:         delSql = "DELETE FROM status_code WHERE name=@k"; break;');
  assert.throws(() => checks.kindSwitchHasNoSilentDefault(bad), /default: 가 status_code 를 고른다|status 를 이름으로 적지 않는다/);
});

test('변이⑩: 휴지통 갱신을 성공(ok)에만 걸면 계약⑩ 이 실패한다("새로고침합니다"가 거짓말이 된다)', () => {
  const bad = mutate(main, 'string trash = await ReadTrashJsonAsync();', 'string trash = ok ? await ReadTrashJsonAsync() : "";');
  assert.throws(() => checks.trashReplyCarriesFreshLists(bad), /성공\(ok\)에만 건다/);
  assert.doesNotThrow(() => checks.trashReplyCarriesFreshLists(main));   // 통제군
});

test('변이⑩-b: 회신에서 갱신 목록을 빼면 계약⑩ 이 실패한다(웹이 다시 푸시를 기다리게 된다)', () => {
  const bad = mutate(main,
    'ReplyOnUi(reqId, new { ok, msg, trash, roster });',
    'ReplyOnUi(reqId, new { ok, msg });');
  assert.throws(() => checks.trashReplyCarriesFreshLists(bad), /\{ok, msg, trash, roster\} 가 아니다/);
  assert.doesNotThrow(() => checks.trashReplyCarriesFreshLists(main));   // 통제군
});

test('변이⑩-c: 브리지가 reqId 를 안 넘기면 계약⑩ 이 실패한다', () => {
  const bad = mutate(main,
    '_ = TrashRestoreAsync(GetStr(doc, "reqId"), GetStr(doc, "kind")',
    '_ = TrashRestoreAsync(GetStr(doc, "kind")');
  assert.throws(() => checks.trashReplyCarriesFreshLists(bad), /reqId 를 넘기지 않는다/);
  assert.doesNotThrow(() => checks.trashReplyCarriesFreshLists(main));   // 통제군
});

test('변이⑩-d: 명부를 조건 없이 실으면 계약⑩ 이 실패한다(옛 푸시 조건과 갈린다 · 2026-09-14)', () => {
  const bad = mutate(main,
    'string roster = ok && kind == "user" ? await ReadMembersJsonAsync(includeInactive) : "";',
    'string roster = await ReadMembersJsonAsync(includeInactive);');
  assert.throws(() => checks.trashReplyCarriesFreshLists(bad), /roster 조건이/);
  assert.doesNotThrow(() => checks.trashReplyCarriesFreshLists(main));   // 통제군
});

test('변이⑩-e: 옛 푸시 배관(__trashDone)을 되살리면 계약⑩ 이 실패한다(웹이 상관관계를 다시 손으로 짓는다)', () => {
  const bad = mutate(main, 'private async Task<string> ReadTrashJsonAsync()',
    'private void TrashDone(bool ok, string msg, string reqId = "") =>\n'
    + '            JsCall("window.__trashDone && window.__trashDone(" + JsonSerializer.Serialize(reqId ?? "") + ")");\n\n'
    + '        private async Task<string> ReadTrashJsonAsync()');
  assert.throws(() => checks.trashReplyCarriesFreshLists(bad), /__trashDone 푸시가 남아 있다/);
  assert.doesNotThrow(() => checks.trashReplyCarriesFreshLists(main));   // 통제군
});

test('변이⑩-f: 옛 휴지통 푸시(LoadTrashToWebAsync)를 되살리면 계약⑩ 이 실패한다(갱신 경로가 둘로 갈린다)', () => {
  const bad = mutate(main, 'private async Task<string> ReadTrashJsonAsync()',
    'private async Task LoadTrashToWebAsync() { await Task.CompletedTask; }\n\n'
    + '        private async Task<string> ReadTrashJsonAsync()');
  assert.throws(() => checks.trashReplyCarriesFreshLists(bad), /LoadTrashToWebAsync\)가 아직 남아 있다/);
  assert.doesNotThrow(() => checks.trashReplyCarriesFreshLists(main));   // 통제군
});
