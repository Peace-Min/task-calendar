// 휴지통(영구 삭제) — 호스트 게이트 · docs/TRASH-DELETE.md §8 계약 ①~⑥
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
//
//   ★ 관문 우회 금지 자체는 tests/admin-auth.test.mjs 가 형태로 훑는다(opener 집합·연결 개시 지점).
//     여기서는 그 위에 얹히는 계약 — 권한 파일·정본 파생·거부 문구·삭제 순서 — 을 본다.
//   ★ 값을 시험에 박지 않는다: 표 9개는 정본(db/deploy/schema-calendar.sql)에서 읽고, 못 읽으면
//     통과가 아니라 실패다(판정 불가 ≠ 통과).
import { readFileSync } from 'node:fs';
import { test, assert } from './harness.mjs';
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

// C# 주석 제거(문자열 리터럴은 보존) — "왜 안 하는지"를 적어 둔 주석이 계약을 통과시키면 안 된다.
const BS = String.fromCharCode(92);
function stripCs(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length) { if (s[j] === BS) { j += 2; continue; } if (s[j] === c) { j++; break; } j++; }
      out += s.slice(i, j); i = j; continue;
    }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// C# 멤버 본문 슬라이스 — 시그니처 조각부터 중괄호 짝이 맞는 곳까지(주석 제거본 기준).
function csMember(source, sig) {
  const code = stripCs(source);
  const s = code.indexOf(sig);
  assert.ok(s >= 0, `C# 멤버를 찾지 못함: ${sig}(측정 불가 ≠ 통과)`);
  const open = code.indexOf('{', s);
  assert.ok(open > s, `${sig} 의 여는 중괄호를 찾지 못함`);
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    const c = code[k];
    if (c === '"' || c === "'") {
      let j = k + 1;
      while (j < code.length) { if (code[j] === BS) { j += 2; continue; } if (code[j] === c) break; j++; }
      k = j; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return code.slice(s, k + 1); }
  }
  assert.fail(`${sig} 의 중괄호 짝이 맞지 않는다`);
}

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
    // 결과 통지·재조회 푸시(§4.2) — 없으면 "지웠는데 목록은 그대로"인 창이 생긴다.
    assert.ok(/window\.__trashDone && window\.__trashDone\(/.test(mainCs), '호스트가 __trashDone 을 부르지 않는다');
    assert.ok(/window\.__applyTrash && window\.__applyTrash\(/.test(mainCs), '호스트가 __applyTrash 로 휴지통을 다시 밀지 않는다');
    for (const fn of ['TrashRestoreAsync', 'TrashDeleteAsync']) {
      const b = csMember(mainCs, 'private async Task ' + fn + '(');
      assert.ok(/TrashDone\(ok, msg\);/.test(b), `${fn} 이 결과를 웹으로 돌려주지 않는다`);
      assert.ok(/if \(ok\) await TrashRefreshAsync\(kind, includeInactive\);/.test(b),
        `${fn} 이 성공 뒤 목록을 다시 밀지 않는다`);
    }
    const refresh = csMember(mainCs, 'private async Task TrashRefreshAsync(');
    assert.ok(/LoadTrashToWebAsync\(\)/.test(refresh), 'TrashRefreshAsync 가 휴지통을 다시 그리지 않는다');
    assert.ok(/LoadMembersToWebAsync\(includeInactive\)/.test(refresh), '인력 조작 뒤 명부를 다시 밀지 않는다');
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
