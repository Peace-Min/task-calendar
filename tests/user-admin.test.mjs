// 직원 관리(관리자 편집) 게이트 — docs/USER-ADMIN.md §8
//
// 이 파일이 존재하는 이유:
//   사용자 요구는 한 줄이었다 — "관리자가 신규 직원이나 퇴사 직원 있으면 **App 단에서만** 관리하는 걸
//   원함. **편집 권한 포함**해서." 그 한 줄이 이 저장소에서 가장 위험한 표(app_user — '누가 관리자인가'를
//   담는 표)에 쓰기를 연다. 그래서 지켜야 할 것이 셋이다:
//     ① 그 쓰기가 **관리자 관문만** 지난다(editor 는 못 지난다 — 지나면 스스로 admin 이 된다).
//     ② 관리자가 **자기 문을 닫지 못한다**(자기 퇴사·자기 권한·마지막 관리자).
//         못 막으면 그 순간 DB 로 가야 풀린다 — "앱에서만 관리한다"는 요구가 바로 거기서 깨진다.
//     ③ 관리자가 아닌 사람의 화면에는 편집 컨트롤이 **아예 없다**(숨김이 아니라 부재).
//         ★★ 2026-09-10 사용자 결정으로 이 계약이 넓어졌다: 「구성원 보기」(#membersModal)에는
//           **관리자에게도** 편집 컨트롤이 없다. 편집은 관리자에게만 존재하는 별도 버튼
//           (#usUserAdmin)과 별도 화면(#userAdminModal)이다. 그래서 볼 것이 셋으로 갈린다 —
//           (a) 보기 화면은 admin:true 회신에도 컨트롤 0 · (b) 편집 화면은 admin:true 일 때만 컨트롤 ·
//           (c) 진입 버튼은 edit_role!=='admin' 이면 DOM 에 없다(숨김이 아니라 부재).
//
//   ★ 관문 자체의 우회 금지는 tests/admin-auth.test.mjs 가 진다(그 파일이 opener 집합·모든 연결
//     개시 지점·쓰기 SQL 을 형태로 훑는다). 여기서는 그 위에 얹히는 계약을 본다 — 잠금 방지 문구,
//     입력 검증, 권한 파일, 정렬, 그리고 비관리자 DOM.
//
//   ★ 판번호·문구 같은 값을 시험에 박지 않는다. 판번호는 정본(tests/canon-schema.mjs)에서 읽고,
//     잠금 방지 문구는 ProjectDb 의 상수 선언에서 읽어 **그 상수가 실제로 쓰이는지**를 본다.
//     못 읽으면 통과가 아니라 실패다(판정 불가 ≠ 통과).
import { readFileSync } from 'node:fs';
import { test, assert, loadAppSource, extractFunction, importOptional, SKIP_NO_JSDOM } from './harness.mjs';
import { canonSchemaVersion, stripSqlComments } from './canon-schema.mjs';

const app = loadAppSource();
const pdb = readFileSync(new URL('../widget/ProjectDb.cs', import.meta.url), 'utf8');
const main = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');

// ── 기준 파일 — 없으면 '한 건의 실패'로 강등한다 ────────────────────────────
//  ★ 최상위에서 throw 하지 않는다: run-tests.mjs 의 import 루프에서 던지면 프로세스가 죽어
//    **전 스위트 판정이 증발한다**(xml-retirement.test.mjs 가 같은 이유로 같은 규칙을 쓴다).
//  ★ taskmgr-company-data 는 **비공개 형제 저장소**다. 직원·조직 표의 정본이 거기 있고,
//    이 판(sort_order 신설)은 그 파일과 db/deploy 의 마이그레이션이 **같은 구조**에 도달해야
//    성립한다. 그래서 없으면 '측정 못 함'이지 '통과'가 아니다.
const missing = [];
const readOr = (url, label) => {
  try { return readFileSync(url, 'utf8'); } catch (_) { missing.push(label); return ''; }
};
const MIGRATE = 'db/deploy/migrate-2026-09-10-user-sort-order.sql';
const migrateSql = readOr(new URL('../' + MIGRATE, import.meta.url), MIGRATE);
const usersCanon = readOr(new URL('../../taskmgr-company-data/01-schema-users.sql', import.meta.url),
  'taskmgr-company-data/01-schema-users.sql');
const userGrants = readOr(new URL('../../taskmgr-company-data/05-grants.sql', import.meta.url),
  'taskmgr-company-data/05-grants.sql');
const calGrants = readOr(new URL('../db/deploy/grants-calendar.sql', import.meta.url), 'db/deploy/grants-calendar.sql');

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
  assert.ok(s >= 0, `C# 멤버를 찾지 못함: ${sig}`);
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
// app_user 블록만 잘라낸다 — is_active·created_at 같은 이름은 이 파일의 다른 표에도 있다.
function appUserBlock(sql) {
  const m = /CREATE TABLE\s+`?app_user`?\s*\(([\s\S]*?)\n\)\s*ENGINE/i.exec(stripSqlComments(sql));
  assert.ok(m, 'app_user 의 CREATE TABLE 블록을 찾지 못했다 — 정본의 모양이 바뀌었다(판정 불가)');
  return m[1];
}

function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

// window.__xxx = function(...){...} 형태의 호스트 콜백 — extractFunction 은 `function 이름(` 만 찾으므로
// 여기서 따로 오려 낸다(선언 모양이 다르다고 계약을 못 보면 안 된다 · trash-web.test.mjs 와 같은 도구).
function windowFn(web, name) {
  const s = web.indexOf('window.' + name + ' = function');
  assert.ok(s >= 0, `window.${name} 선언을 찾지 못했다 — 판정 불가`);
  const e = web.indexOf('\n};', s);
  assert.ok(e > s, `window.${name} 의 끝(';};')을 찾지 못했다 — 판정 불가`);
  return web.slice(s, e + 3);
}

//  편집 폼(#userEditModal) 마크업만 오려 낸다 — 주석은 지운다("왜 안 하는지"를 적어 둔 문장이 계약을 통과시키면 안 된다).
//  ★ 못 오려 내면 '판정 불가'로 죽는다. 통과가 아니다.
function userEditModalMarkup(web) {
  const s = web.indexOf('<div class="overlay hidden" id="userEditModal">');
  assert.ok(s >= 0, '#userEditModal 마크업을 찾지 못함');
  const e = web.indexOf('<!-- ===== 자세한 사용설명서', s);
  assert.ok(e > s, '#userEditModal 뒤의 사용설명서 모달을 찾지 못했다(판정 불가)');
  return web.slice(s, e).replace(/<!--[\s\S]*?-->/g, '');
}

// ══════════════════════════════════════════════════════════════════════
//  계약 — 검사와 변이가 같은 함수를 쓴다(검사가 실제로 잡는지 증명하려면 그래야 한다)
// ══════════════════════════════════════════════════════════════════════

const checks = {
  // ① 정본·마이그레이션 동치 — 컬럼이 **같은 자리에 같은 모양으로** 선다.
  //    (실제 덤프 대조는 격리 DB 로 하고, 여기서는 두 소스가 같은 것을 말하는지 본다.)
  canonColumnShape(sql, label) {
    const blk = appUserBlock(sql);
    const line = /^[^\S\n]*sort_order[^\n]*$/m.exec(blk);
    assert.ok(line, `${label}: app_user 에 sort_order 컬럼이 없다`);
    //  ★ 2026-09-10 INT 로 넓힘 — SMALLINT 은 10 간격 6,553명이 천장이었다(격리 DB 실측 ERROR 1264).
    //    정본은 INT UNSIGNED 이고, 11 마이그레이션(SMALLINT 신설) 뒤에 12 마이그레이션(MODIFY INT)이 따라와 같은 모양에 이른다.
    assert.ok(/\bINT\s+UNSIGNED\s+NULL\s+DEFAULT\s+NULL/i.test(line[0]) && !/SMALLINT/i.test(line[0]),
      `${label}: sort_order 가 INT UNSIGNED NULL DEFAULT NULL 이 아니다 — 12 마이그레이션(INT 확장) 뒤의 모양과 갈리면 덤프 대조가 깨진다`);
    // 위치: title 바로 다음 컬럼이어야 한다(ADD COLUMN … AFTER title 과 짝).
    const cols = blk.split('\n').map((l) => /^[^\S\n]*`?([a-z_]+)`?\s+[A-Z]/.exec(l)).filter(Boolean).map((m) => m[1]);
    const iT = cols.indexOf('title'), iS = cols.indexOf('sort_order');
    assert.ok(iT >= 0, `${label}: title 컬럼을 찾지 못했다(판정 불가)`);
    assert.strictEqual(iS, iT + 1,
      `${label}: sort_order 가 title 바로 뒤가 아니다(title=${iT}, sort_order=${iS}) — ` +
      '컬럼 순서가 다르면 "마이그레이션으로 온 DB"와 "새로 세운 DB"가 mysqldump 대조에서 갈린다');
    // UNIQUE·인덱스·COMMENT 를 두지 않는다(§3.1 — 전량 재작성 중간의 중복이 1062 로 죽지 않게).
    assert.ok(!/UNIQUE[^\n]*sort_order|KEY[^\n]*\(\s*`?sort_order`?\s*\)/i.test(blk),
      `${label}: sort_order 에 UNIQUE·인덱스가 붙었다 — 앱의 전량 재작성이 중간값 충돌로 죽는다(§3.1)`);
    assert.ok(!/sort_order[^\n]*COMMENT/i.test(line[0]),
      `${label}: sort_order 에 컬럼 COMMENT 가 붙었다 — 이 DB 는 컬럼 주석이 0/174 다. ` +
      '여기만 달면 이관 경로에만 주석이 붙어 정본과 갈린다(09-09 가 복구한 드리프트와 같은 종류)');
  },

  // ① 계속 — 마이그레이션이 같은 자리·같은 모양으로 붙이고, 감사 시각을 덮지 않는다.
  migrationShape(sql, canonVer) {
    const code = stripSqlComments(sql);
    assert.ok(/ALTER\s+TABLE\s+app_user[\s\S]{0,400}?ADD\s+COLUMN\s+sort_order\s+SMALLINT\s+UNSIGNED\s+NULL\s+DEFAULT\s+NULL/i.test(code),
      MIGRATE + ' 이 app_user 에 sort_order SMALLINT UNSIGNED NULL DEFAULT NULL 을 추가하지 않는다');
    assert.ok(/ADD\s+COLUMN\s+sort_order[\s\S]{0,400}?AFTER\s+title/i.test(code),
      MIGRATE + ' 에 `AFTER title` 이 없다 — 컬럼이 표 끝에 붙어 정본(신규 구축)과 순서가 갈린다. ' +
      '그 차이는 mysqldump 대조에서만 드러나므로, 여기서 못 박지 않으면 아무도 모른다');
    //  ★ updated_at 을 명시하지 않으면 서버 ON UPDATE 가 89행의 갱신 시각을 전부 덮는다.
    //    "언제 이 사람의 정보가 마지막으로 바뀌었나"는 인사 이력이고, 컬럼 하나 늘린 일로 지울 값이 아니다.
    //    (migrate-2026-09-09-integrity.sql (5) 가 같은 이유로 같은 장치를 썼다.)
    assert.ok(/UPDATE\s+app_user[\s\S]{0,600}?updated_at\s*=\s*u\.updated_at/i.test(code),
      MIGRATE + ' 의 초기값 UPDATE 가 updated_at 을 명시하지 않는다 — 89행의 갱신 시각이 전부 지금으로 덮인다');
    //  판번호는 정본에서 읽어 대조한다(시험에 숫자를 박으면 정본이 움직일 때 시험이 거짓말을 한다).
    //  ★ 2026-09-10: 이 파일(11 신설)은 더 이상 '정본까지 올리는' 파일이 아니다 — 12(INT 확장)가 뒤에 있다.
    //    그래서 '한 칸만 · 가드=출발값 · 정본을 앞서지 않음' 으로 판정한다(project-dev-end 계약⑤ 와 같은 형태).
    const canonTo = String(canonVer);
    const bump = /UPDATE\s+cal_schema_meta\s+SET\s+v\s*=\s*'(\d+)'[\s\S]{0,200}?AND\s+v\s*=\s*'(\d+)'/i.exec(code);
    assert.ok(bump, MIGRATE + ' 에서 schema_version 승격 문장을 찾지 못했다');
    const to = bump[1], from = bump[2];
    assert.strictEqual(String(Number(from) + 1), to, MIGRATE + ' 이 판번호를 ' + from + ' → ' + to + ' 로 움직인다 — 한 번에 한 칸이어야 중간 판이 건너뛰어지지 않는다');
    assert.ok(Number(to) <= Number(canonTo), MIGRATE + ' 이 올리는 값(' + to + ')이 정본(' + canonTo + ')을 앞서간다 — 아무도 도달할 수 없는 판번호');
    const guard = /@v\s*=\s*'(\d+)'/.exec(code);
    assert.ok(guard, MIGRATE + " 에 선행조건 가드(@v = 'N')가 없다 — 재실행이 1060 으로 죽는다");
    assert.strictEqual(guard[1], from, MIGRATE + ' 의 가드가 v=' + guard[1] + " 를 요구한다 — 정본 기준으로는 '" + from + "' 이어야 한다");
    //  사후 검증 — 존재만 보지 않는다(위치·NULL·판번호를 @bad 가 기계적으로 막는다).
    assert.ok(/ORDINAL_POSITION\s*=\s*1\s*\+/.test(code),
      MIGRATE + ' 의 사후 검증이 컬럼 위치를 보지 않는다 — AFTER 가 먹혔는지 확인할 길이 없다');
    assert.ok(/is_active\s*=\s*1\s+AND\s+sort_order\s+IS\s+NULL/i.test(code),
      MIGRATE + ' 의 사후 검증이 "활성 사용자 중 sort_order NULL 0명"을 보지 않는다');
    assert.ok(/중단: 사후 검증 실패/.test(code),
      MIGRATE + ' 의 사후 검증이 출력만 하고 멈추지 않는다 — 아무도 안 읽는 경고는 게이트가 아니다');
  },

  // ② 관리자 관문 — 거부가 '오프라인'으로 뭉개지지 않는다(USER-LOGIN §3.3 의 함정).
  //    이 함정은 실제로 있었다: 쓰기 메서드가 연결 실패를 전부 OfflineMsg 로 환원하기 때문에
  //    NotAuthorizedException 을 **먼저** 잡지 않으면 "관리자만 고칠 수 있습니다"가
  //    "서버에 연결할 수 없습니다"로 표시된다 — 사용자는 원인을 영영 못 찾는다.
  deniedIsNotOffline(cs) {
    for (const name of ['UpsertUserAsync', 'SetUserActiveAsync', 'SaveUserOrderAsync']) {
      const b = csMember(cs, name + '(');
      assert.ok(/catch \(NotAuthorizedException nex\)[^\n]*return \(false, nex\.Message\)/.test(b),
        `${name} 가 권한 거부를 사용자 문장 그대로 돌려주지 않는다 — OfflineMsg 로 뭉개지면 원인이 뒤바뀐다`);
      const iNa = b.indexOf('catch (NotAuthorizedException nex)');
      const iOff = b.indexOf('return (false, OfflineMsg)');
      assert.ok(iNa >= 0 && iOff > iNa,
        `${name} 의 catch 순서가 뒤집혔다 — NotAuthorizedException 을 Exception 보다 앞에서 잡아야 한다`);
    }
  },

  // ③ 잠금 방지 — 세 문구가 상수 한 곳에 있고, 각 메서드가 **같은 트랜잭션 안에서** FOR UPDATE 로 판정한다.
  //    ★ FOR UPDATE 가 없으면 두 관리자가 동시에 서로를 강등해 **아무도 남지 않는다**(둘 다 COUNT=2 를 본다).
  lockoutGuards(cs) {
    const code = stripCs(cs);
    for (const [nm, txt] of [
      ['SelfDeactivateMsg', '자기 계정은 퇴사 처리할 수 없습니다.'],
      ['SelfRoleMsg', '자기 권한은 바꿀 수 없습니다. 다른 관리자가 바꿔야 합니다.'],
      ['LastAdminMsg', '관리자가 한 명뿐이라 처리할 수 없습니다. 먼저 다른 관리자를 지정하세요.'],
    ]) {
      assert.ok(new RegExp('const string ' + nm + '\\s*=\\s*"' + txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(code),
        `잠금 방지 문구 상수 ${nm} 이 계약과 다르다 — 같은 말을 두 곳에 적으면 한쪽만 고쳐진다`);
    }
    // 활성 관리자 수는 잠근 채 센다.
    assert.ok(/SELECT COUNT\(\*\) FROM app_user WHERE edit_role='admin' AND is_active=1 FOR UPDATE/.test(code),
      "활성 관리자 수를 FOR UPDATE 로 세지 않는다 — 동시 강등으로 관리자가 0명이 될 수 있다");
    // 대상·나 자신도 잠근 채 읽는다.
    //  ★ 컬럼 목록을 글자로 못박지 않는다 — 2026-09-10 에 title·org_id 가 늘었다(§4.3 완화가 '지금 저장된 값'을
    //    잠근 행에서 읽어야 하기 때문이다). 계약은 '무엇을 잠그고 무엇을 읽는가' 지 '몇 컬럼인가' 가 아니다.
    const lockedSel = /SELECT ([^"]*) FROM app_user WHERE user_id=@uid FOR UPDATE/.exec(code);
    assert.ok(lockedSel,
      '대상 직원을 FOR UPDATE 로 읽지 않는다 — 판정과 갱신 사이에 값이 바뀔 수 있다');
    for (const col of ['user_id', 'name', 'edit_role', 'is_active', 'title', 'org_id']) {
      assert.ok(new RegExp('\\b' + col + '\\b').test(lockedSel[1]),
        `잠근 행 읽기에 ${col} 이(가) 없다 — 판정의 근거를 잠그지 않은 채 읽으면 판정과 갱신이 갈린다`);
    }
    assert.ok(/SELECT user_id FROM app_user WHERE login_id=@me FOR UPDATE/.test(code),
      "'나'를 FOR UPDATE 로 읽지 않는다 — 자기 판정의 근거가 흔들린다");

    const up = csMember(cs, 'UpsertUserAsync(');
    assert.ok(/BeginTransactionAsync/.test(up), 'UpsertUserAsync 가 트랜잭션 안에서 판정하지 않는다');
    assert.ok(up.includes('SelfRoleMsg'), 'UpsertUserAsync 에 자기 권한 변경 금지(§4.4-2)가 없다');
    assert.ok(up.includes('LastAdminMsg'), 'UpsertUserAsync 에 마지막 관리자 강등 금지(§4.4-3)가 없다');
    assert.ok(/LockedActiveAdminCountAsync\(conn, tx, cts\.Token\) <= 1/.test(up),
      'UpsertUserAsync 의 마지막 관리자 판정이 COUNT<=1 이 아니다');

    const sa = csMember(cs, 'SetUserActiveAsync(');
    assert.ok(/BeginTransactionAsync/.test(sa), 'SetUserActiveAsync 가 트랜잭션 안에서 판정하지 않는다');
    assert.ok(sa.includes('SelfDeactivateMsg'), 'SetUserActiveAsync 에 자기 퇴사 금지(§4.4-1)가 없다');
    assert.ok(sa.includes('LastAdminMsg'), 'SetUserActiveAsync 에 마지막 관리자 퇴사 금지(§4.4-3)가 없다');
    // 복구(active=true)에는 걸지 않는다 — 막을 것이 없다(사람을 되살리는 조작이다).
    assert.ok(/if \(!active\)\s*\{/.test(sa),
      '퇴사/복구가 같은 규칙을 받는다 — 잠금 방지는 퇴사(!active)에만 걸어야 한다');

    // 하드삭제 경로는 **휴지통 한 곳뿐**이다(2026-09-10 개정 · TRASH-DELETE §3.3).
    //   옛 계약은 "어디에도 없다"였다. 휴지통이 생기며 그 문장은 거짓이 됐지만, 느슨해진 것이 아니라
    //   **자리가 하나로 좁혀진** 것이다 — DeleteTrashAsync 밖에서 app_user 를 지우면 여기서 운다
    //   (그 함수는 숨김 여부·기록 0건·자기 계정·이름 대조를 전부 지난 뒤에야 DELETE 에 닿는다).
    const delTrash = csMember(cs, 'DeleteTrashAsync(');
    const outside = code.replace(delTrash, '');
    assert.ok(!/DELETE\s+FROM\s+app_user/i.test(outside),
      'DeleteTrashAsync 밖에서 app_user 를 DELETE 하는 SQL 이 생겼다 — 퇴사는 is_active=0 이고 행은 남는다(§3.3)');
    assert.ok(/DELETE\s+FROM\s+app_user/i.test(delTrash),
      '휴지통의 영구 삭제에 app_user DELETE 가 없다 — 계약이 지킬 대상을 잃었다(측정 불가 ≠ 통과)');
  },

  // ④ 입력 검증 — 형식·도메인이 **사용자 문장**으로 거부된다(최종 보증은 DB 제약).
  inputValidation(cs) {
    const code = stripCs(cs);
    assert.ok(/@"\^\[A-Za-z0-9\._-\]\{1,50\}\$"/.test(code),
      '로그인 ID 형식 정규식이 ^[A-Za-z0-9._-]{1,50}$ 가 아니다 — 넓히면 넷커스에 없는 ID 가 들어온다');
    const up = csMember(cs, 'UpsertUserAsync(');
    for (const msg of ['로그인 ID 는 영문·숫자·._- 만 쓸 수 있습니다.', '이름을 입력하세요.',
                       '등록되지 않은 직급입니다.', '등록되지 않은 소속입니다.',
                       '열람 범위 값이 올바르지 않습니다.', '편집 권한 값이 올바르지 않습니다.']) {
      assert.ok(up.includes(msg), `입력 검증 문구가 없다: ${msg}`);
    }
    // 직급·소속은 **활성 마스터**로 검사한다 — 폐지된 값으로 새로 배정하지 못하게.
    assert.ok(/LoadCodeNameSetAsync\(conn, cts\.Token, "title_code", activeOnly: true\)/.test(up),
      '직급 검증이 활성 title_code 로드가 아니다(하드코딩이거나 숨김 포함이다)');
    assert.ok(/SELECT COUNT\(\*\) FROM org_unit WHERE org_id=@o AND is_active=1/.test(up),
      '소속 검증이 활성 org_unit 조회가 아니다');
    // 대소문자 정규화는 하지 않는다 — 넷커스가 어떤 표기를 쓰는지 이 앱이 정하지 않는다(§4.3).
    assert.ok(!/lid\s*=\s*lid\.ToLower|ToLowerInvariant\(\)\s*;[\s\S]{0,40}login_id/.test(up),
      '로그인 ID 를 소문자로 정규화한다 — 중복 판정은 DB 콜레이션(ai_ci)에 맡기기로 했다(§4.3)');
    // 중복은 DB 가 판정한다(1062).
    assert.ok(/case 1062: return "이미 등록된 ID 입니다\.";/.test(code),
      '로그인 ID 중복(1062)을 사용자 문장으로 돌려주지 않는다');
    // 기존 사용자의 login_id 는 UPDATE 대상이 아니다(§6 — 넷커스 소유).
    assert.ok(!/UPDATE app_user SET[^"]*login_id=/.test(code),
      '기존 사용자의 login_id 를 UPDATE 한다 — 그 값은 넷커스 소유다(§6). 필요하면 DBA 경로다');

    //  ★ 2026-09-10 완화 — **수정**에서는 '활성이거나 지금 저장된 값'이면 통과한다.
    //    폐지된 직급·조직을 단 사람의 이름 한 글자를 고치려는데 "등록되지 않은 직급입니다"로 막히면,
    //    관리자는 그 사람의 직급부터 바꿔야 한다. 화면은 저장된 값을 드롭다운에 그대로 남기므로
    //    '보이는 값'과 '되는 값'이 갈린다. 판정의 근거는 **잠근 행**(LockedUserAsync 의 FOR UPDATE)이다.
    assert.ok(/!titleSet\.Contains\(ti\) && !string\.Equals\(ti, target\.Value\.title, StringComparison\.Ordinal\)/.test(up),
      '수정의 직급 검사가 "활성이거나 현재 저장된 값"이 아니다 — 폐지된 직급을 단 사람은 이름 한 글자도 못 고친다(§4.3)');
    assert.ok(/orgId\.HasValue && orgId\.Value != \(target\.Value\.orgId \?\? -1\)/.test(up),
      '수정의 소속 검사가 "활성이거나 현재 저장된 값"이 아니다 — 값이 그대로면 조회조차 하지 않아야 한다(§4.3)');
    //    완화는 **수정에만**이다. 신규 등록은 활성만 — 폐지된 값으로 새 사람을 배정하지 않는다.
    assert.ok(/else\s*\{[\s\S]{0,120}?if \(!titleSet\.Contains\(ti\)\)[\s\S]{0,160}?등록되지 않은 직급입니다/.test(up),
      '신규 등록 분기에 활성 직급 검사가 없다 — 완화가 등록까지 번지면 폐지된 직급으로 새 사람이 들어온다');
  },

  // ⑥-f 순서 저장은 목록 **밖** 사람의 서열도 비운다(USER-ADMIN §7-1a 를 닫는다 · 2026-09-10).
  //    「퇴사자 보기」를 끈 채 저장하면 퇴사자는 목록에 없어 옛 숫자를 그대로 들고 남았고, 복구하면
  //    그 숫자가 새 서열 **사이에 끼어들었다**. NULL 은 명부 ORDER BY 에서 맨 뒤다(§5.3).
  orderClearsOutsiders(cs) {
    const so = csMember(cs, 'SaveUserOrderAsync(');
    assert.ok(/UPDATE app_user SET sort_order=@s WHERE user_id=@uid/.test(so),
      '순서 저장이 받은 순서대로 sort_order 를 전량 재작성하지 않는다(측정 불가 ≠ 통과)');
    assert.ok(/UPDATE app_user SET sort_order=NULL WHERE[^"]*user_id NOT IN \(/.test(so),
      '목록 밖 사람의 sort_order 를 비우지 않는다 — 숨긴 채 저장하면 그 사람은 옛 서열을 들고 남고, ' +
      '복구했을 때 새 서열 사이에 끼어든다(§7-1a)');
    //  재작성 → 비우기 → 커밋. 셋이 **한 트랜잭션**이어야 중간 상태(서열 중복)가 남지 않는다.
    const renum = so.indexOf('sort_order=@s');
    const clear = so.indexOf('sort_order=NULL');
    const commit = so.indexOf('CommitAsync');
    assert.ok(renum >= 0 && clear > renum && commit > clear,
      '서열 비우기가 재작성보다 앞이거나 커밋 뒤에 있다 — 한 트랜잭션 안에서 재작성 → 비우기 → 커밋 순이어야 한다');
    //  받은 목록이 통째로 쓸모없으면(전부 0 이하) 거부한다 — 안 그러면 전원의 서열이 NULL 이 된다.
    assert.ok(/kept\.Count == 0/.test(so) && /정렬할 명부가 비어 있습니다/.test(so),
      '목록이 통째로 비었을 때 거부하지 않는다 — NOT IN () 로 전원의 서열을 지우는 사고가 남는다');
    //  updated_at 은 두 UPDATE 모두 손대지 않는다(§4.5 — 서버 ON UPDATE 의 몫).
    assert.ok(!/updated_at/.test(so),
      '순서 저장이 updated_at 을 직접 쓴다 — 이 표의 감사 시각은 서버 ON UPDATE 가 정한다(§4.5)');
  },

  // ⑤ 권한 파일 — app_user 는 SELECT+INSERT+UPDATE+DELETE 넷(2026-09-10 개정 · TRASH-DELETE §3.3).
  //    DELETE 가 늘어난 이유는 휴지통 하나다. 권한은 '가능하게'만 하고, 무엇을 지울 수 있는지는
  //    호스트 관문(DeleteTrashAsync)이 정한다 — 그래서 여기서는 **넷 정확히**를 본다(늘어도 줄어도 실패).
  grantFiles(userGrantsSql, calGrantsSql) {
    const m = /GRANT ([A-Z, ]+) ON [^\n]*app_user/.exec(userGrantsSql);
    assert.ok(m, '05-grants.sql 에 app_user GRANT 가 없다 — 관리 화면이 ERROR 1142 로 죽는다');
    assert.strictEqual(m[1].trim(), 'SELECT, INSERT, UPDATE, DELETE',
      `05-grants.sql 이 app_user 에 [${m[1].trim()}] 을 준다 — 넷이어야 한다(INSERT·UPDATE 는 직원 관리, DELETE 는 휴지통 §3.3)`);
    for (const t of ['org_unit', 'title_code']) {
      const m = new RegExp("GRANT ([A-Z, ]+) ON [^\\n]*" + t).exec(userGrantsSql);
      assert.ok(m, `05-grants.sql 에 ${t} GRANT 가 없다`);
      assert.strictEqual(m[1].trim(), 'SELECT',
        `05-grants.sql 이 ${t} 에 ${m[1].trim()} 을 준다 — 조직·직급 코드 편집은 이번 범위 밖이다(§6)`);
    }
    // grants-calendar.sql 은 GRANT 를 늘리지 않는다(캘린더 표의 단일 소스다). 대신 **서술이 사실이어야** 한다.
    assert.ok(/app_user\s+SELECT \+ \*\*INSERT · UPDATE · DELETE\*\*/.test(calGrantsSql),
      'grants-calendar.sql 머리말의 app_user 권한 서술이 실제 분포(SELECT·INSERT·UPDATE·DELETE)와 다르다 — 없는 사실도, 빠진 사실도 다음 사람이 그대로 믿는다');
    assert.ok(/app_user 의 DELETE 는 휴지통 관문\(ProjectDb\.DeleteTrashAsync\) 한 곳뿐이다 — 퇴사는 is_active=0 이고 행은 남으며, 기록 0건인 계정만 관리자가 지운다\(TRASH-DELETE §3\.2\)/.test(calGrantsSql),
      'grants-calendar.sql 서술이 아직 "app_user DELETE 없음"이다 — DELETE 는 휴지통 한 곳뿐이라고 적어야 한다(§3.3)');
    assert.ok(!/GRANT[^\n]*(?:INSERT|UPDATE|DELETE)[^\n]*taskmgr\.app_user/.test(calGrantsSql),
      'grants-calendar.sql 이 app_user 쓰기를 직접 부여한다 — 그 도메인의 GRANT 정본은 05-grants.sql 하나다');
  },

  // ⑥ 정렬 — 호스트가 정하고 화면은 그대로 그린다. 두 곳이면 갈린다(§5.3).
  orderIsHostOnly(cs, web) {
    assert.ok(/"ORDER BY o\.name, u\.sort_order IS NULL, u\.sort_order, u\.name"/.test(cs),
      '명부(보기) ORDER BY 가 §5.3(소속 → 순번(NULL 맨 뒤) → 이름)과 글자까지 같지 않다 — 편집용 리터럴은 계약⑥-c 가 본다');
    //  직급 서열을 끼우지 않는다 — 전사 서열이 직급을 이미 담고 있고, 끼우면 관리자가 정한 순서를 직급이 뒤엎는다.
    assert.ok(!/ORDER BY o\.name[^"]*t\.sort_order/.test(cs),
      '명부 ORDER BY 에 직급 서열이 끼었다 — 관리자가 정한 순서를 직급이 뒤엎는다(§5.3)');
    const rm = extractFunction(web, 'renderMembers');
    assert.ok(!/\.sort\(/.test(rm),
      'renderMembers 가 목록을 다시 정렬한다 — 순서를 정하는 곳이 둘이 되면 반드시 갈린다(§5.3)');
    //  「구성원 편집」 화면도 같은 규칙이다 — 순서를 정하는 곳이 둘이면 반드시 갈린다.
    const ur = extractFunction(web, 'uaRender');
    assert.ok(!/\.sort\(/.test(ur),
      'uaRender 가 목록을 다시 정렬한다 — 화면은 호스트가 준 순서를 그대로 그린다(§5.3)');
    assert.ok(!/sortOrder/.test(ur),
      'uaRender 가 sortOrder 를 읽는다 — 명부(목록)에는 순번 숫자를 내지 않는다 — 편집 폼의 읽기전용 칸(#userEdSort)만 보여 준다(§5.2, 2026-09-10)');
    for (const fn of ['mbVisible', 'mbApplyData', 'uaVisible', 'uaApplyData']) {
      assert.ok(!/\.sort\(/.test(extractFunction(web, fn)),
        `${fn} 이 명부를 다시 정렬한다 — 화면은 호스트가 준 순서를 그대로 그린다(§5.3)`);
    }
    // 순번 숫자는 **목록**에 표시하지 않는다(§5.1-a) — 관리자는 목록에서 순서만 정한다.
    assert.ok(!/sortOrder/.test(rm),
      'renderMembers 가 sortOrder 를 읽는다 — 명부(목록)에는 순번 숫자를 내지 않는다 — 편집 폼의 읽기전용 칸(#userEdSort)만 보여 준다(§5.2, 2026-09-10)');
    //  ★ 2026-09-10 사용자 요청으로 '어디에도 없음'이 '폼에만 있음'이 됐다. 그러니 **폼에는 실제로 있어야** 한다 —
    //    금지만 남기고 허용을 안 적어 두면, 다음 사람이 계약⑥ 을 보고 폼의 칸까지 지운다.
    const uo = extractFunction(web, 'userEdOpen');
    assert.ok(/userEdSort/.test(uo) && /sortOrder/.test(uo),
      'userEdOpen 이 #userEdSort 에 sortOrder 를 넣지 않는다 — 순번을 확인할 곳이 다시 사라진다(§5.2)');
    const fm = userEditModalMarkup(web);
    assert.ok(/<input[^>]*id="userEdSort"[^>]*\breadonly\b/.test(fm),
      '#userEdSort 가 없거나 readonly 가 아니다 — 숫자를 직접 고치려면 호스트 계약(saveUser)이 달라져야 한다(§11-17)');
  },

  // ⑦ 관리자 회신은 '호스트가 준 값'으로만 켜진다 — 화면이 스스로 관리자라고 판단하지 않는다.
  //    ★ 그 값을 읽는 곳은 이제 **「구성원 편집」 화면 하나**다(uaApplyData). 보기 화면은 읽지 않는다.
  adminFlagComesFromHost(web) {
    const b = extractFunction(web, 'uaApplyData');
    assert.ok(/__uaAdmin = d\.admin === true;/.test(b),
      '관리자 여부를 호스트 회신(d.admin)에서 그대로 받지 않는다 — 화면이 권한을 지어내면 반드시 낡는다');
    assert.ok(/__uaInactive = __uaAdmin && d\.includeInactive === true;/.test(b),
      '「퇴사자 보기」 상태를 호스트가 정한 값으로 맞추지 않는다 — 요청과 결과가 갈리면 화면이 거짓말을 한다');
    // 여는 순간에도 낡은 값이 남지 않는다(한 프레임의 거짓말도 거짓말이다).
    assert.ok(/__uaAdmin = false;/.test(extractFunction(web, 'openUserAdmin')),
      'openUserAdmin 이 __uaAdmin 을 비우지 않는다 — 회신 전 한 프레임 동안 편집 컨트롤이 번쩍인다');
    //  ★ 보기 화면은 admin 을 **아예 읽지 않는다**(2026-09-10 결정). 읽기 시작하면 그 값에 따라
    //    보기 화면 모습이 갈리고, "보기는 전원에게 같다"는 결정이 조용히 깨진다.
    for (const fn of ['mbApplyData', 'renderMembers', 'openMembers', 'mbApply', 'mbSelect']) {
      const src = extractFunction(web, fn);
      assert.ok(!/\bd\.admin\b|__uaAdmin|__mbAdmin/.test(src),
        `${fn} 이 관리자 여부를 본다 — 「구성원 보기」는 권한과 무관하게 같은 모습이어야 한다(§5)`);
    }
  },

  // ⑦-a 「구성원 보기」 마크업에는 관리 자리조차 없다 — 관리자에게도 컨트롤이 없기 때문이다.
  membersMarkupHasNoControls(web) {
    const s = web.indexOf('<div class="overlay hidden" id="membersModal">');
    assert.ok(s >= 0, '#membersModal 마크업을 찾지 못함');
    const e = web.indexOf('<!-- ===== 타인 일정 열람', s);
    assert.ok(e > s, '#membersModal 뒤의 타인 일정 열람 모달을 찾지 못함');
    const md = web.slice(s, e).replace(/<!--[\s\S]*?-->/g, '');   // 주석의 설명 문구는 컨트롤이 아니다
    assert.ok(!/id="mbAdmin"/.test(md),
      '#mbAdmin(옛 관리자 막대 자리)이 아직 「구성원 보기」에 있다 — 편집은 별도 화면으로 옮겼다(2026-09-10)');
    for (const dead of ['직원 등록', '순서 편집', '순서 저장', '퇴사자 보기', 'data-uop', 'mba-']) {
      assert.ok(!md.includes(dead),
        `구성원 보기 모달 마크업에 편집 컨트롤(${dead})이 들어왔다 — 관리자에게도 없어야 한다(§5)`);
    }
  },

  // ⑦-b 「구성원 편집」 마크업도 **빈 자리**뿐이다 — 컨트롤은 admin:true 회신 뒤에만 생긴다.
  userAdminMarkupHasNoControls(web) {
    const s = web.indexOf('<div class="overlay hidden" id="userAdminModal">');
    assert.ok(s >= 0, '#userAdminModal 마크업을 찾지 못함 — 「구성원 편집」 화면이 없다');
    const e = web.indexOf('<!-- ===== 직원 등록', s);
    assert.ok(e > s, '#userAdminModal 뒤의 직원 등록·수정 폼을 찾지 못함');
    const md = web.slice(s, e).replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(/<div class="modal wide">/.test(md), '#userAdminModal 이 .modal.wide 가 아니다');
    assert.ok(/<div id="uaAdmin"><\/div>/.test(md),
      '#uaAdmin 이 비어 있지 않다 — 컨트롤을 마크업에 적으면 admin:false 회신에도 DOM 에 남는다(숨김 ≠ 부재)');
    //  ★ 2026-09-10 「＋ 직원 등록」이 하단으로 내려왔다 — 그 자리도 **빈 자리**여야 한다. 같은 규칙이다.
    assert.ok(/<span id="uaFoot"><\/span>/.test(md),
      '#uaFoot 이 비어 있지 않다 — 등록 버튼을 마크업에 적으면 admin:false 회신에도 DOM 에 남는다(숨김 ≠ 부재)');
    assert.ok(/id="uaList"/.test(md), '#uaList 목록 자리가 없다');
    for (const dead of ['직원 등록', '순서 편집', '순서 저장', '퇴사자 보기', 'data-uop']) {
      assert.ok(!md.includes(dead),
        `구성원 편집 모달 마크업에 컨트롤(${dead})이 들어왔다 — 관리자 회신 없이는 DOM 에 없어야 한다(§5)`);
    }
  },

  // ⑦-c 진입 버튼(#usUserAdmin)은 edit_role==='admin' 회신일 때만 만들어진다 — 숨김이 아니라 부재.
  adminEntryButtonIsBuiltNotHidden(web) {
    assert.ok(!/id="usUserAdmin"/.test(web),
      '「구성원 편집」 버튼이 마크업에 있다 — 비관리자 DOM 에 남는다(숨김 ≠ 부재). JS 가 만들어야 한다');
    assert.ok(/<div class="us-mem-row" id="usMemberBtns">/.test(web),
      '#usMemberBtns(버튼이 들어갈 자리)가 없다 — 만들어 넣을 곳이 사라졌다');
    const b = extractFunction(web, 'usAdminBtnSync');
    assert.ok(/=== 'admin'/.test(b),
      "usAdminBtnSync 가 edit_role 을 'admin' 과 대조하지 않는다 — 판정 기준이 사라졌다");
    assert.ok(/removeChild/.test(b),
      'usAdminBtnSync 가 버튼을 DOM 에서 제거하지 않는다 — 남겨 두면 관리자에서 내려가도 문이 남는다');
    //  ★ 숨김으로 바꾸는 변이를 형태로도 막는다: 이 함수에 classList·hidden·display 가 있으면 안 된다.
    assert.ok(!/classList|\.hidden|style\.display/.test(b),
      'usAdminBtnSync 가 숨김(classList/hidden/display)을 쓴다 — 부재여야 한다. 숨김은 클래스 하나로 풀린다');
    //  권한 회신을 읽는 곳에서 실제로 불린다(성공·실패 양쪽).
    const lp = extractFunction(web, 'loadUserPerm');
    assert.ok(/usAdminBtnSync\(inf\.edit_role\)/.test(lp),
      'loadUserPerm 이 회신의 edit_role 로 진입 버튼을 동기화하지 않는다');
    assert.ok(/usAdminBtnSync\(''\)/.test(lp),
      '권한 조회 실패 경로가 진입 버튼을 없애지 않는다 — 확인하지 못한 채 문이 열려 있게 된다');
    assert.ok(/usAdminBtnSync\(''\)/.test(extractFunction(web, 'updateUserUi')),
      '미로그인 경로가 진입 버튼을 없애지 않는다');
  },

  // ⑦-e 퇴사·복구는 **편집 폼 안에만** 산다(2026-09-10 사용자 결정).
  //    행마다 파괴적 버튼을 두면 89개 행이 그대로 오클릭 면적이 되고, 목록의 주 동작이 무엇인지 읽히지 않는다.
  //    '누구를 퇴사시키나'는 그 사람을 열어 놓고 판단할 일이다(업계 관례: 비활성화는 상세/편집 화면에 산다).
  //    ★ 형태로 못 박는 이유: 행에 도로 붙이는 변경은 한 줄이면 되고, 되돌아간 줄은 리뷰에서 눈에 띄지 않는다.
  retireLivesInForm(web) {
    const ra = extractFunction(web, 'uaRowActions');
    assert.ok(!/\buaSetActive\b/.test(ra),
      'uaRowActions 가 uaSetActive 를 부른다 — 퇴사·복구는 행이 아니라 편집 폼 하단의 일이다');
    assert.ok(!/'off'|'on'/.test(ra),
      "uaRowActions 에 'off'/'on' uop 이 남아 있다 — 행에는 [편집](과 순서 편집 중의 ▲▼)뿐이다");

    const md = userEditModalMarkup(web);
    const btn = /<button type="button" class="btn danger" id="userEdActive" hidden>/.exec(md);
    assert.ok(btn,
      '#userEdActive(퇴사·복구) 버튼이 편집 폼 마크업에 없다 — 이 폼은 admin:true 가 아니면 열리지 않으므로 정적이어도 된다');
    const sp = md.indexOf('<span class="spacer"></span>');
    assert.ok(sp > btn.index,
      '#userEdActive 가 spacer 뒤에 있다 — 파괴적 동작은 [취소][저장] 반대쪽 왼끝에 서야 잘못 눌리지 않는다');

    const o = extractFunction(web, 'userEdOpen');
    assert.ok(/userEdActive/.test(o), 'userEdOpen 이 #userEdActive 를 손대지 않는다 — 대상·문구가 이전 사람 것으로 남는다');
    assert.ok(/hidden = !m\b/.test(o),
      'userEdOpen 이 신규 등록(대상 없음)에서 퇴사 버튼을 감추지 않는다 — 없는 사람을 퇴사시킬 수는 없다');
    assert.ok(/\.dataset\.uop\s*=/.test(o) && /'off'/.test(o) && /'on'/.test(o),
      "userEdOpen 이 data-uop 을 'off'/'on' 양쪽으로 세우지 않는다 — 재직·퇴사 두 상태가 같은 버튼을 쓴다");
    //  ★ 2026-09-10: 편집 권한 **드롭다운**은 isMe 로 잠근다(§4.4-2 힌트) — 그래서 함수 전체에서
    //    'disabled = isMe' 를 금지할 수 없게 됐다. 금지 대상은 하나다: **퇴사 버튼이 isMe 를 보는 것**.
    //    그 블록만 오려 내서 본다(자기 퇴사 거부는 호스트 문장이어야 관문이 실제로 막는지 확인된다 · §4.4-1).
    const abAt = o.indexOf("const ab = document.getElementById('userEdActive');");
    assert.ok(abAt >= 0, 'userEdOpen 에서 #userEdActive 블록을 찾지 못했다(판정 불가)');
    assert.ok(!/isMe/.test(o.slice(abAt)),
      '화면이 자기 퇴사를 미리 막는다 — 거부는 호스트 문장이어야 관문이 실제로 막는지 확인된다(§4.4-1)');

    assert.ok(/userEdActive/.test(extractFunction(web, 'uaSetSaving')),
      'uaSetSaving 이 [퇴사 처리]를 함께 잠그지 않는다 — 전송 중에 눌리면 같은 왕복이 겹친다');
  },

  // ⑩ 폼 선택칸 — 열람 범위·편집 권한은 **드롭다운**이다(2026-09-10 사용자 요청: 라디오 6줄 → 2칸).
  //    바뀐 것은 위젯뿐이고 규칙은 그대로다: 문구는 「사용자 정보」의 매핑표 **한 벌**에서만 나온다.
  //    ★ 라디오로 되돌아가는 변경은 한 줄이면 되고, 되돌아간 줄은 리뷰에서 눈에 띄지 않는다 — 그래서 형태로 못 박는다.
  formPickers(web) {
    const md = userEditModalMarkup(web);
    for (const id of ['userEdScope', 'userEdRole']) {
      assert.ok(new RegExp('<select id="' + id + '">').test(md),
        `#${id} 가 <select> 가 아니다 — 라디오 묶음은 위젯 실폭에서 세로 6줄을 먹었다(2026-09-10)`);
    }
    assert.ok(!/ue-radios/.test(md) && !/type="radio"/.test(md),
      '편집 폼 마크업에 라디오(ue-radios/type="radio")가 남아 있다 — 선택칸은 드롭다운 하나로 통일한다');

    const o = extractFunction(web, 'userEdOpen');
    for (const [id, map] of [['userEdScope', 'US_VIEW_SCOPE'], ['userEdRole', 'US_EDIT_ROLE']]) {
      assert.ok(new RegExp("userEdFillSelect\\('" + id + "'").test(o),
        `userEdOpen 이 #${id} 를 userEdFillSelect 로 채우지 않는다 — 값 목록을 만드는 곳이 둘이 되면 갈린다`);
      assert.ok(new RegExp('\\b' + map + '\\b').test(o),
        `userEdOpen 이 ${map} 을 쓰지 않는다 — 같은 규칙을 두 벌로 적으면 한쪽이 반드시 낡는다`);
    }
    //  자기 행이면 편집 권한만 잠근다(§4.4-2). isMe 로 **다시 세운다**는 것이 핵심이다 —
    //  잠그기만 하고 풀지 않으면 그다음에 연 사람의 칸이 잠긴 채로 남는다.
    assert.ok(/getElementById\('userEdRole'\);[\s\S]{0,80}disabled = isMe/.test(o),
      "userEdOpen 이 #userEdRole.disabled 를 isMe 로 세우지 않는다 — 잠금이 이전 사람 것으로 남는다(§4.4-2)");

    const sv = extractFunction(web, 'userEdSaveNow');
    for (const id of ['userEdScope', 'userEdRole']) {
      assert.ok(new RegExp("userEdPick\\('" + id + "'\\)").test(sv),
        `userEdSaveNow 가 userEdPick('${id}') 로 읽지 않는다 — 옛 라디오 name 으로 읽으면 빈 값이 저장된다`);
    }
  },

  // ⑪ 모달 폼의 세로 리듬 — 폼별 손질이 아니라 **토큰 한 곳**에서 정한다(2026-09-10 사용자 지적).
  modalFormRhythm(web) {
    //  ★ 주석을 먼저 지운다 — "옛 규칙은 …이었다"라고 **적어 둔 문장**이 규칙으로 세어지면 안 된다
    //    (이 파일이 C# 주석을 지우는 것과 같은 이유다. 반대로 주석이 계약을 통과시켜서도 안 된다).
    const css = web.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/\.modal label:first-child\{margin-top:0\}/.test(css),
      '.row2 셀의 첫 label 이 :first-child 라 윗여백이 0 이 되어 2열 행이 위 칸에 붙는다 — 2026-09-10 사용자 지적');
    assert.ok(/\.modal-body > label:first-child\{margin-top:0\}/.test(css),
      "윗여백을 지우는 예외가 '모달 본문의 첫 라벨' 하나로 좁혀져 있지 않다(.modal-body > label:first-child)");
    assert.ok(/\.modal label\{[^}]*margin:var\(--sp-4\) 0 6px\}/.test(css),
      '.modal label 의 세로 리듬이 토큰(--sp-4 / 6px)이 아니다 — 폼마다 손으로 여백을 주면 반드시 갈린다');
    assert.ok(/\.row2\{[^}]*gap:var\(--sp-4\)\}/.test(css),
      '.row2 의 칸 사이가 토큰(--sp-4)이 아니다');
    //  ★ 자기 윗여백을 이미 가진 묶음의 첫 라벨은 그 여백과 16px 이 겹쳐 32~40px 이 된다(2026-09-10).
    assert.ok(/\.fsect > label:first-child,\.rem-block > label:first-child,\.cat-form > label:first-child,\.room-form > label:first-child\{margin-top:0\}/.test(css),
      '윗여백을 가진 묶음 넷(.fsect·.rem-block·.cat-form·.room-form)의 첫 라벨 예외가 없다 — 라벨 위가 두 벌로 쌓인다');
    //  ★ 좁은 폭에서는 2열을 접는다 — 위젯 실폭에서 드롭다운 문구가 통째로 잘렸다.
    assert.ok(/@media \(max-width:420px\)\{ \.modal \.row2\{grid-template-columns:minmax\(0,1fr\)\} \}/.test(css),
      '좁은 폭(≤420px)에서 .row2 가 1열로 접히지 않는다 — 잘린 라벨은 고를 수 없는 라벨이다');
    //  ★ disabled 칸도 '못 고치는 칸'으로 보여야 한다(#userEdLogin — 기존 직원의 ID 는 잠긴다).
    assert.ok(/\.modal input:disabled\{color:var\(--muted\);background:var\(--dim-bg\);cursor:not-allowed\}/.test(css),
      '.modal input:disabled 가 읽기전용 wash 를 받지 않는다 — 흰 입력칸과 똑같이 생기면 눌러 보고서야 안다');
  },

  // ⑫ 파괴 버튼의 테두리는 **토큰**이다 — 하드코딩(#efc7c9)은 다크에서 형광 분홍선이 됐다(2026-09-10).
  //    그리고 읽기전용 wash(--dim-bg)는 다섯 테마 전부가 자기 값을 가져야 한다(없으면 라이트값을 물려받아
  //    그 테마의 패널과 구분되지 않는다 = 잠긴 칸이 열린 칸처럼 보인다).
  themeTokens(web) {
    const css = web.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(/\.btn\.danger\{color:var\(--danger-text\);border-color:var\(--danger-line\)\}/.test(css),
      '.btn.danger 의 테두리가 토큰(--danger-line)이 아니다 — 테마마다 다시 칠할 길이 없다');
    assert.ok(!/border-color:#efc7c9/.test(css), '하드코딩된 파괴 테두리(#efc7c9)가 남아 있다');
    for (const [sel, label] of [[':root', '라이트'], ['html\\.dark', '다크'],
      [':root\\[data-theme="forest"\\]', 'forest'], [':root\\[data-theme="sepia"\\]', 'sepia'],
      [':root\\[data-theme="contrast"\\]', 'contrast']]) {
      const m = new RegExp(sel + '\\{[\\s\\S]*?\\n?\\}').exec(css);
      assert.ok(m, `${label} 테마 블록을 찾지 못했다 — 판정 불가`);
      assert.ok(/--dim-bg:/.test(m[0]), `${label} 테마에 --dim-bg 가 없다 — 읽기전용·disabled 칸이 그 테마의 패널과 구분되지 않는다`);
      assert.ok(/--danger-line:/.test(m[0]), `${label} 테마에 --danger-line 이 없다 — 파괴 버튼 테두리가 라이트 분홍으로 남는다`);
    }
  },

  // ⑬ 순서 편집의 ▲▼ — 목록을 통째로 다시 그리므로 스크롤 자리와 포커스를 **손으로** 지켜야 한다.
  //    89행에서 한 칸 옮길 때마다 맨 위로 튀고 포커스가 body 로 떨어지면 연속 조작이 불가능하다(2026-09-10).
  moveKeepsPlace(web) {
    const b = extractFunction(web, 'uaMove');
    assert.ok(/getElementById\('uaList'\)/.test(b) && /scrollTop/.test(b),
      'uaMove 가 #uaList 의 스크롤 자리를 기억·복원하지 않는다 — 한 칸 옮길 때마다 목록이 맨 위로 튄다');
    assert.ok(/activeElement/.test(b),
      'uaMove 가 누르고 있던 화살표(activeElement)를 기억하지 않는다 — 어디로 포커스를 되돌릴지 알 수 없다');
    assert.ok(/uaFocusMoved\(/.test(b),
      'uaMove 가 포커스를 되돌리지 않는다 — 한 번 누르면 포커스가 사라져 두 번째를 누를 수 없다');
    const f = extractFunction(web, 'uaFocusMoved');
    assert.ok(/data-uop/.test(f) && /data-uid/.test(f),
      'uaFocusMoved 가 data-uop/data-uid 손잡이로 버튼을 찾지 않는다 — 이름으로 찾으면 동명이인에서 갈린다');
    assert.ok(/disabled/.test(f) && /'down' : 'up'/.test(f),
      'uaFocusMoved 가 꺼진 화살표일 때 반대쪽을 잡지 않는다 — 끝(맨 위·맨 아래)에 닿는 순간 포커스가 사라진다');
    assert.ok(/scrollIntoView/.test(f), 'uaFocusMoved 가 옮긴 행을 보이는 자리로 끌어오지 않는다');
  },

  // ⑭ 요청 상관관계(세대) — A 의 늦은 회신이 지금 열려 있는 **B 의 폼**을 닫고 '저장했습니다'를 띄우던 자리다.
  //    과제 쪽 규약(projBeginRequest/__projGen)과 같은 모양이되, '어느 폼인가'를 알아야 해서 대상까지 기억한다.
  requestGeneration(web) {
    const s = extractFunction(web, 'uaSend');
    assert.ok(/__uaGen = \+\+__uaSeq;/.test(s), 'uaSend 가 요청 세대를 올리지 않는다 — 늦은 회신을 구별할 길이 없다');
    assert.ok(/__uaTarget = \{/.test(s), 'uaSend 가 요청 대상(__uaTarget)을 기억하지 않는다 — 어느 폼을 닫아도 되는지 알 수 없다');
    const w = windowFn(web, '__userSaved');
    assert.ok(/if\(__uaGen === 0\) return;/.test(w),
      '__userSaved 가 이월 회신을 걸러내지 않는다 — 워치독이 푼 뒤 도착한 회신이 다른 폼을 닫는다');
    assert.ok(/Number\(tg\.uid \|\| 0\) === Number\(__ueId \|\| 0\)/.test(w),
      '__userSaved 가 회신 대상과 **지금 폼이 연 사람**을 대조하지 않는다 — 세대만으로는 어느 폼인지 알 수 없다');
    assert.ok(/__uaGen = 0;/.test(w), '__userSaved 가 세대를 닫지 않는다 — 같은 회신이 두 번 처리될 수 있다');
    //  워치독도 세대를 무효화해야 한다(그러지 않으면 12초 뒤 도착한 회신이 그대로 먹힌다).
    const ss = extractFunction(web, 'uaSetSaving');
    assert.ok(/__uaGen = 0;/.test(ss), 'uaSetSaving 의 워치독이 세대를 무효화하지 않는다');
    //  전송 중에는 폼 자체가 닫히지 않는다(offEdSetBusy 와 같은 장치).
    assert.ok(/dataset\.busy = '1'/.test(ss) && /delete ov\.dataset\.busy/.test(ss),
      'uaSetSaving 이 #userEditModal 의 dataset.busy 를 세우고 지우지 않는다 — 저장 중에 창을 닫으면 결과를 알릴 곳이 사라진다');
  },

  // ⑮ 여는 순간 낡은 잠금을 정리한다 — 다만 **도는 중이면 풀지 않는다**(가드와 워치독이 함께 사라진다).
  openKeepsGuard(web) {
    const oa = extractFunction(web, 'openUserAdmin');
    assert.ok(/if\(__uaSaving\) uaSetSaving\(true\); else uaSetSaving\(false\);/.test(oa),
      'openUserAdmin 이 낡은 잠금을 정리하지 않는다 — 회신 없이 닫았다 다시 열면 화면이 잠긴 채로 선다');
    const o = extractFunction(web, 'userEdOpen');
    assert.ok(/if\(__uaSaving\)\{/.test(o),
      'userEdOpen 이 진행 중 왕복을 무조건 풀어 버린다 — 전송 중에 다른 사람을 열면 가드와 워치독이 함께 사라진다');
    assert.ok(/uaSetSaving\(false\);\s*\/\/ 왕복이 없을 때만/.test(o),
      'userEdOpen 의 잠금 해제가 "왕복이 없을 때만"으로 좁혀져 있지 않다');
  },

  // ⑯ 순서 편집 중에 오는 **관계없는 명부 푸시**가 편집 중인 순서를 지우지 않는다(2026-09-10).
  orderSurvivesPush(web) {
    const ap = windowFn(web, '__applyMembers');
    assert.ok(/if\(__uaOrder && !__uaOrderSaving\)\{ __uaPendingData = d;/.test(ap),
      '__applyMembers 가 순서 편집 중의 관계없는 푸시를 미뤄 두지 않는다 — 남의 저장 한 번에 편집 중인 순서가 날아간다');
    const s = extractFunction(web, 'uaSend');
    assert.ok(/__uaOrderSaving = \(__uaTarget\.cmd === 'saveUserOrder'\)/.test(s),
      "uaSend 가 '이 왕복이 순서 저장인가'를 표시하지 않는다 — 내 저장의 결과까지 미뤄지면 순서가 영영 반영되지 않는다");
    const us = windowFn(web, '__userSaved');
    assert.ok(/__uaOrderSaving = false;/.test(us), '__userSaved 가 순서 저장 표시를 닫지 않는다');
    assert.ok(/if\(wasOrder\)\{ uaOrderReset\(\); __uaPendingData = null; \}/.test(us),
      '__userSaved 가 순서 저장 성공에서 편집 모드를 끝내지 않는다 — 호스트는 회신을 먼저 보내고 명부를 그다음에 민다');
    const tog = extractFunction(web, 'uaOrderToggle');
    assert.ok(/__uaPendingData/.test(tog) && /uaFlushPending\(\)/.test(tog),
      'uaOrderToggle 이 미뤄 둔 갱신을 반영하지 않는다 — 편집을 끄면 그 사이의 진짜 변경이 사라진다');
    const bar = extractFunction(web, 'uaAdminBar');
    assert.ok(/명부가 갱신되었습니다 — 순서 편집을 마치면 반영됩니다\./.test(bar),
      '미뤄 둔 갱신을 화면이 말하지 않는다 — 관리자는 자기 화면이 낡은 줄 모른 채 순서를 정한다');
  },

  // ⑰ 「퇴사자 보기」는 **조회가 실제로 시작됐을 때만** 켜진 채로 남는다(2026-09-10).
  inactiveToggleIsHonest(web) {
    const r = extractFunction(web, 'uaReload');
    assert.ok(/return false;/.test(r) && /return true;/.test(r),
      'uaReload 가 시작 여부를 불린으로 돌려주지 않는다 — 호출부가 "시작조차 못 했다"를 알 수 없다');
    assert.ok(!/^async function uaReload/m.test(web),
      'uaReload 가 async 다 — 그러면 반환값이 언제나 Promise(늘 참)라 재진입 판정이 무의미해진다');
    const bar = extractFunction(web, 'uaAdminBar');
    assert.ok(/if\(uaReload\(\)\) return;/.test(bar),
      '「퇴사자 보기」가 uaReload 의 반환값을 보지 않는다 — 체크만 켜지고 목록은 그대로인 화면이 된다');
    assert.ok(/cb\.checked = prev;/.test(bar), '조회를 시작하지 못했는데 체크를 되돌리지 않는다');
    assert.ok(/불러오는 중입니다 — 잠시 후 다시 시도하세요/.test(bar), '되돌린 이유를 말하지 않는다 — 조용한 무시는 고장으로 읽힌다');
  },

  // ⑱ 폼의 드롭다운은 **모르는 값을 말없이 갈아치우지 않는다**(2026-09-10).
  //    비활성 직급·폐지된 소속을 가진 사람을 열어 [저장]만 눌러도 그 값이 조용히 바뀌던 자리다.
  unknownValueIsKept(web) {
    const f = extractFunction(web, 'userEdFillSelect');
    assert.ok(/목록에 없음/.test(f), 'userEdFillSelect 가 목록에 없는 값을 끼워 넣지 않는다 — 첫 항목으로 조용히 바뀐다');
    assert.ok(/insertBefore/.test(f), '끼워 넣은 옵션이 맨 위가 아니다 — 지금 값은 첫 줄에 있어야 눈에 든다');
    assert.ok(/return !known;/.test(f), 'userEdFillSelect 가 "끼워 넣었나"를 돌려주지 않는다 — 호출부가 안내할 근거가 없다');
    const o = extractFunction(web, 'userEdOpen');
    assert.ok(/현재 값이 목록에 없습니다\(비활성 직급\/소속 등\)\. 그대로 두면 유지됩니다\./.test(o),
      'userEdOpen 이 "목록에 없는 값"을 안내하지 않는다 — 관리자는 왜 이상한 옵션이 있는지 모른다');
    assert.ok(/직급 목록을 불러오지 못했습니다 — 명부를 새로고침하세요\./.test(o),
      '직급 목록이 비었을 때의 안내가 없다 — 다 채우고 [저장]에서야 막힌다');
    assert.ok(/if\(!__uaTitles\.length && sv\) sv\.disabled = true;/.test(o),
      '직급 목록이 비었는데 [저장]이 열려 있다 — 성립할 수 없는 저장을 권하는 셈이다');
  },

  // ⑲ 퇴사 확인창은 **저장된 이름**으로 말하고, 버려질 편집이 있으면 그 사실을 먼저 말한다(2026-09-10).
  retireConfirmIsHonest(web) {
    const s = extractFunction(web, 'uaSetActive');
    assert.ok(/userEdIsDirty\(\)/.test(s), 'uaSetActive 가 저장하지 않은 편집을 확인하지 않는다');
    assert.ok(/저장하지 않은 변경은 버려집니다\./.test(s),
      '퇴사 확인창이 "저장하지 않은 변경은 버려집니다."를 말하지 않는다 — 성공하면 폼이 닫히며 편집이 사라진다');
    assert.ok(/uaMemberName\(__ueId\)/.test(web),
      '#userEdActive 배선이 저장된 이름(uaMemberName)을 쓰지 않는다 — 고쳐 놓은 이름으로 확인창이 말한다');
    const d = extractFunction(web, 'userEdIsDirty');
    for (const id of ['userEdName', 'userEdTitle', 'userEdOrg', 'userEdScope', 'userEdRole']) {
      assert.ok(new RegExp("'" + id + "'").test(d), `userEdIsDirty 가 #${id} 를 견주지 않는다 — 그 칸의 편집은 조용히 버려진다`);
    }
    //  Esc·배경 클릭도 같은 규칙을 받는다(#officialEditModal 과 같은 자리).
    assert.ok(/ov\.id==='userEditModal'/.test(extractFunction(web, 'isGuardedModal')),
      '#userEditModal 이 우발적 닫기 가드에 들어 있지 않다 — Esc 한 번에 남의 권한 편집이 사라진다');
    assert.ok(/ov\.__openSnap = formSnapshot\(ov\)/.test(extractFunction(web, 'userEdOpen')),
      'userEdOpen 이 dirty-check 기준(__openSnap)을 남기지 않는다 — 가드가 늘 "변경됨"으로 읽는다');
  },

  // ⑳ 머리줄의 인원 수는 **거짓말을 하지 않는다** — 검색 중이면 걸러진 수와 전체 수를 함께 낸다(2026-09-10).
  scopeCountIsHonest(web) {
    const a = extractFunction(web, 'uaApply');
    assert.ok(/검색 결과 ' \+ rows\.length \+ '명 · 전체 ' \+ __uaMembers\.length \+ '명/.test(a),
      "검색 중에도 '구성원 n명' 만 낸다 — 걸러진 수라서 명부가 줄어든 것처럼 읽힌다");
    assert.ok(/구성원 ' \+ rows\.length \+ '명/.test(a), "검색어가 없을 때의 문구('구성원 N명')가 사라졌다");
    assert.ok(/퇴사자 포함/.test(a), "'· 퇴사자 포함' 꼬리가 사라졌다");
  },

  // ㉑ 열람 범위 문구는 **남의 폼에서도 맞아야** 한다 — 매핑표 한 벌을 두 화면이 함께 쓴다(2026-09-10).
  scopeTextIsNotFirstPerson(web) {
    assert.ok(/unit_tree:'소속 조직 — 본인 부서와 하위'/.test(web),
      "US_VIEW_SCOPE 의 unit_tree 문구가 '본인 부서와 하위' 가 아니다");
    assert.ok(!/내 부서와 하위/.test(web),
      "1인칭 문구('내 부서와 하위')가 남아 있다 — 남의 권한을 고치는 폼에서 그 '나'는 누구인지 알 수 없다");
  },
};

// ══════════════════════════════════════════════════════════════════════
//  실행
// ══════════════════════════════════════════════════════════════════════

test('기준⓪: 이 게이트의 기준 파일이 전부 실재한다(못 읽었으면 통과가 아니라 측정 실패다)', () => {
  assert.deepStrictEqual(missing, [],
    '직원 관리 게이트가 기준 파일을 읽지 못했다. 없는 것: ' + missing.join(', ') + '\n' +
    '  · taskmgr-company-data 는 이 저장소의 **형제 폴더**여야 한다(직원·조직 표의 정본이 거기 있다).\n' +
    '  · 읽지 못한 것을 통과로 넘기면 이 게이트는 그 순간부터 아무것도 지키지 않는다.');
});

test('계약①: 정본(01-schema-users.sql)의 sort_order 가 title 바로 뒤 · UNIQUE·인덱스·COMMENT 없음', () => {
  checks.canonColumnShape(usersCanon, 'taskmgr-company-data/01-schema-users.sql');
});
test('계약①-b: 마이그레이션이 AFTER title 로 붙이고 감사 시각을 덮지 않으며 판번호 한 칸을 올린다', () => {
  checks.migrationShape(migrateSql, canonSchemaVersion());
});
test('계약②: 직원 쓰기의 권한 거부가 오프라인 문구로 뭉개지지 않는다(USER-LOGIN §3.3 함정)', () => {
  checks.deniedIsNotOffline(pdb);
});
test('계약③: 잠금 방지 3규칙이 같은 트랜잭션 안에서 FOR UPDATE 로 판정된다', () => {
  checks.lockoutGuards(pdb);
});
test('계약④: 입력 검증이 형식·도메인을 사용자 문장으로 거부한다(최종 보증은 DB 제약)', () => {
  checks.inputValidation(pdb);
});
test('계약⑤: 권한 파일이 app_user 에 SELECT·INSERT·UPDATE·DELETE 넷을 주고, 서술이 휴지통 관문을 가리킨다', () => {
  checks.grantFiles(userGrants, calGrants);
});
test('계약⑥: 명부 순서는 호스트가 정하고 화면은 다시 정렬하지 않는다(순번 숫자 비노출)', () => {
  checks.orderIsHostOnly(pdb, app);
});
test('계약⑥-f: 순서 저장이 목록 밖 사람의 서열을 비운다(§7-1a — 복구했을 때 끼어들지 않게)', () => {
  checks.orderClearsOutsiders(pdb);
});
test('계약⑦: 관리자 여부는 호스트 회신으로만 켜지고, 두 모달 마크업에는 편집 컨트롤이 없다', () => {
  checks.adminFlagComesFromHost(app);
  checks.membersMarkupHasNoControls(app);
  checks.userAdminMarkupHasNoControls(app);
});
test("계약⑦-c: 「구성원 편집」 진입 버튼은 edit_role==='admin' 일 때만 만들어진다(숨김 ≠ 부재)", () => {
  checks.adminEntryButtonIsBuiltNotHidden(app);
});
test('계약⑦-e: 퇴사·복구는 편집 폼 하단에만 있고 행에는 없다(2026-09-10 사용자 결정)', () => {
  checks.retireLivesInForm(app);
});
test('계약⑩: 열람 범위·편집 권한은 드롭다운이고, 문구는 매핑표 한 벌에서만 나온다(2026-09-10)', () => {
  checks.formPickers(app);
});
test('계약⑪: 모달 폼의 세로 리듬은 토큰 한 곳에서 정한다(.row2 셀 라벨이 위 칸에 붙지 않는다)', () => {
  checks.modalFormRhythm(app);
});
test('계약⑫: 파괴 테두리·읽기전용 wash 는 다섯 테마 전부가 자기 토큰을 갖는다', () => checks.themeTokens(app));
test('계약⑬: 순서 편집 ▲▼ 는 스크롤 자리와 포커스를 지킨다(89행에서 연속 조작이 된다)', () => checks.moveKeepsPlace(app));
test('계약⑭: 직원 쓰기는 세대·대상으로 상관된다(늦은 회신이 다른 폼을 닫지 않는다)', () => checks.requestGeneration(app));
test('계약⑮: 화면을 (다시) 열 때 낡은 잠금은 풀되, 도는 중이면 워치독만 다시 건다', () => checks.openKeepsGuard(app));
test('계약⑯: 순서 편집 중의 관계없는 명부 푸시는 미뤄 두고 편집을 마칠 때 반영한다', () => checks.orderSurvivesPush(app));
test('계약⑰: 「퇴사자 보기」는 조회가 실제로 시작됐을 때만 켜진 채로 남는다', () => checks.inactiveToggleIsHonest(app));
test('계약⑱: 목록에 없는 값을 말없이 갈아치우지 않는다(직급 목록이 비면 저장을 잠근다)', () => checks.unknownValueIsKept(app));
test('계약⑲: 퇴사 확인창은 저장된 이름으로 말하고, 버려질 편집을 먼저 말한다', () => checks.retireConfirmIsHonest(app));
test('계약⑳: 검색 중 머리줄은 걸러진 수와 전체 수를 함께 낸다', () => checks.scopeCountIsHonest(app));
test('계약㉑: 열람 범위 문구는 1인칭이 아니다(매핑표 한 벌을 두 화면이 함께 쓴다)', () => checks.scopeTextIsNotFirstPerson(app));

test('변이⑫: 파괴 테두리를 하드코딩으로 되돌리면 계약⑫ 가 실패한다', () => {
  const bad = mutate(app, '.btn.danger{color:var(--danger-text);border-color:var(--danger-line)}',
    '.btn.danger{color:var(--danger-text);border-color:#efc7c9}');
  assert.throws(() => checks.themeTokens(bad), /토큰\(--danger-line\)이 아니다|하드코딩된 파괴 테두리/);
  assert.doesNotThrow(() => checks.themeTokens(app));   // 통제군
});

test('변이⑬: uaMove 에서 포커스 복원을 빼면 계약⑬ 이 실패한다', () => {
  const bad = mutate(app, '  uaFocusMoved(userId, uop);', '  ');
  assert.throws(() => checks.moveKeepsPlace(bad), /포커스를 되돌리지 않는다/);
  assert.doesNotThrow(() => checks.moveKeepsPlace(app));   // 통제군
});

test('변이⑭: __userSaved 의 이월 회신 가드를 지우면 계약⑭ 가 실패한다', () => {
  const bad = mutate(app, '  if(__uaGen === 0) return;   // 기다리는 요청이 없다 = 이 회신은 이월분이다', '  ');
  assert.throws(() => checks.requestGeneration(bad), /이월 회신을 걸러내지 않는다/);
  assert.doesNotThrow(() => checks.requestGeneration(app));   // 통제군
});

test('변이⑮: userEdOpen 이 잠금을 무조건 풀면 계약⑮ 가 실패한다(전송 중 가드가 사라진다)', () => {
  const bad = mutate(app, '    uaSetSaving(false);                                    // 왕복이 없을 때만 잠금·워치독을 푼다',
    '    uaSetSaving(false);');
  assert.throws(() => checks.openKeepsGuard(bad), /"왕복이 없을 때만"으로 좁혀져 있지 않다/);
  assert.doesNotThrow(() => checks.openKeepsGuard(app));   // 통제군
});

test('변이⑯: 관계없는 푸시를 그대로 반영하게 되돌리면 계약⑯ 이 실패한다', () => {
  const bad = mutate(app, '  if(__uaOrder && !__uaOrderSaving){ __uaPendingData = d; uaAdminBar(); return; }', '  ');
  assert.throws(() => checks.orderSurvivesPush(bad), /미뤄 두지 않는다/);
  assert.doesNotThrow(() => checks.orderSurvivesPush(app));   // 통제군
});

test('변이⑰: uaReload 를 async 로 되돌리면 계약⑰ 이 실패한다(반환값이 늘 참이 된다)', () => {
  const bad = mutate(app, 'function uaReload(){\n  if(!HOST || __uaBusy) return false;',
    'async function uaReload(){\n  if(!HOST || __uaBusy) return false;');
  assert.throws(() => checks.inactiveToggleIsHonest(bad), /uaReload 가 async 다/);
  assert.doesNotThrow(() => checks.inactiveToggleIsHonest(app));   // 통제군
});

test('변이⑱: 끼워 넣은 옵션의 라벨을 지우면 계약⑱ 이 실패한다(무엇이 문제인지 화면이 말하지 않는다)', () => {
  //  ★ '갈아치우기'로 되돌리는 변이(const known = true)는 **형태로는 안 잡힌다** — 코드가 그대로 남고 안 돌 뿐이다.
  //    그건 DOM 쪽 변이(변이⑱-DOM)가 잡는다. 여기서는 형태가 실제로 잡는 자리를 흔든다.
  const bad = mutate(app, "    o.value = want; o.textContent = want + ' — 목록에 없음';",
    '    o.value = want; o.textContent = want;');
  assert.throws(() => checks.unknownValueIsKept(bad), /끼워 넣지 않는다/);
  assert.doesNotThrow(() => checks.unknownValueIsKept(app));   // 통제군
});

test('변이⑲: 퇴사 확인창이 입력칸의 이름을 쓰게 되돌리면 계약⑲ 가 실패한다', () => {
  const bad = mutate(app, '      uaSetActive(__ueId, uaMemberName(__ueId), b.dataset.uop === \'on\'); }); }',
    "      const n = $('#userEdName'); uaSetActive(__ueId, n ? n.value : '', b.dataset.uop === 'on'); }); }");
  assert.throws(() => checks.retireConfirmIsHonest(bad), /저장된 이름\(uaMemberName\)을 쓰지 않는다/);
  assert.doesNotThrow(() => checks.retireConfirmIsHonest(app));   // 통제군
});

test('변이⑳: 검색 중에도 걸러진 수만 내게 되돌리면 계약⑳ 이 실패한다', () => {
  const bad = mutate(app, "  sc.textContent = (k ? ('검색 결과 ' + rows.length + '명 · 전체 ' + __uaMembers.length + '명')\n                      : ('구성원 ' + rows.length + '명'))",
    "  sc.textContent = ('구성원 ' + rows.length + '명')");
  assert.throws(() => checks.scopeCountIsHonest(bad), /'구성원 n명' 만 낸다/);
  assert.doesNotThrow(() => checks.scopeCountIsHonest(app));   // 통제군
});

test('변이㉑: 1인칭 문구로 되돌리면 계약㉑ 이 실패한다', () => {
  const bad = mutate(app, "unit_tree:'소속 조직 — 본인 부서와 하위'", "unit_tree:'소속 조직 — 내 부서와 하위'");
  assert.throws(() => checks.scopeTextIsNotFirstPerson(bad), /'본인 부서와 하위' 가 아니다|1인칭 문구/);
  assert.doesNotThrow(() => checks.scopeTextIsNotFirstPerson(app));   // 통제군
});

// ── 브리지 배선 — 세 명령이 실제로 호스트에 닿고, 성공하면 명부가 갱신된다 ──────────
test('계약②-b: 브리지 3종(saveUser·setUserActive·saveUserOrder)이 배선돼 있고 성공 시 명부를 재조회한다', () => {
  const code = stripCs(main);
  for (const [cmd, fn] of [['saveUser', 'SaveUserAsync'], ['setUserActive', 'SetUserActiveAsync'], ['saveUserOrder', 'SaveUserOrderAsync']]) {
    assert.ok(new RegExp('case "' + cmd + '":').test(code), `브리지 case "${cmd}" 가 없다 — 화면이 눌러도 아무 일도 안 난다`);
    const b = csMember(main, 'private async Task ' + fn + '(');
    assert.ok(/UserSaved\(ok, msg\);/.test(b), `${fn} 이 결과를 웹으로 돌려주지 않는다(__userSaved)`);
    assert.ok(/if \(ok\) await LoadMembersToWebAsync\(includeInactive\);/.test(b),
      `${fn} 이 성공 뒤 명부를 재조회하지 않는다 — "저장은 됐는데 목록은 그대로"인 창이 생긴다`);
  }
  assert.ok(/window\.__userSaved && window\.__userSaved\(/.test(main),
    '호스트가 __userSaved 를 부르지 않는다(과제의 __projectSaved 와 같은 패턴이어야 한다)');
  assert.ok(/window\.__applyMembers && window\.__applyMembers\(/.test(main),
    '호스트가 갱신 명부를 __applyMembers 로 밀어 주지 않는다');
  assert.ok(/typeof window\.__userSaved|window\.__userSaved = function/.test(app),
    '웹에 __userSaved 수신부가 없다');
  assert.ok(/window\.__applyMembers = function/.test(app), '웹에 __applyMembers 수신부가 없다');
});

// ══════════════════════════════════════════════════════════════════════
//  변이 주입 — 위 계약이 실효성이 있는지 증명한다(안 잡으면 그 검사는 장식이다)
// ══════════════════════════════════════════════════════════════════════

test('변이①: 정본에서 sort_order 를 org_id 뒤로 옮기면 계약① 이 잡는다(존재만 보면 통과할 변이)', () => {
  const blk = appUserBlock(usersCanon);
  const line = /^[^\S\n]*sort_order[^\n]*\n/m.exec(blk);
  assert.ok(line, '변이 준비 실패: 컬럼 줄을 찾지 못했다');
  const pulled = blk.replace(line[0], '');
  const org = /^[^\S\n]*org_id[^\n]*\n/m.exec(pulled);
  assert.ok(org, '변이 준비 실패: org_id 줄을 찾지 못했다');
  const movedBlk = pulled.replace(org[0], () => org[0] + line[0]);
  const bad = stripSqlComments(usersCanon).replace(blk, () => movedBlk);
  assert.throws(() => checks.canonColumnShape(bad, 'x'), /title 바로 뒤가 아니다/);
  assert.doesNotThrow(() => checks.canonColumnShape(usersCanon, 'x'));   // 통제군
});

test('변이①-b: 정본에 UNIQUE 를 걸면 계약① 이 실패한다(전량 재작성이 1062 로 죽는다)', () => {
  const bad = mutate(usersCanon, '  PRIMARY KEY (user_id),', '  UNIQUE KEY uq_app_user_sort_order (sort_order),\n  PRIMARY KEY (user_id),');
  assert.throws(() => checks.canonColumnShape(bad, 'x'), /UNIQUE·인덱스가 붙었다/);
});

test('변이①-c: 마이그레이션에서 AFTER title 을 지우면 계약①-b 가 실패한다', () => {
  const bad = mutate(migrateSql, '\n  AFTER title;', ';');
  assert.throws(() => checks.migrationShape(bad, canonSchemaVersion()), /AFTER title` 이 없다/);
  assert.doesNotThrow(() => checks.migrationShape(migrateSql, canonSchemaVersion()));   // 통제군
});

test('변이①-d: 초기값 UPDATE 에서 updated_at 명시를 빼면 계약①-b 가 실패한다(감사 시각 전면 덮어쓰기)', () => {
  const bad = mutate(migrateSql, ',\n       u.updated_at = u.updated_at;', ';');
  assert.throws(() => checks.migrationShape(bad, canonSchemaVersion()), /updated_at 을 명시하지 않는다/);
});

test('변이②: 권한 거부를 오프라인 문구로 바꾸면 계약② 가 실패한다', () => {
  const bad = mutate(pdb,
    'catch (NotAuthorizedException nex) { _log("권한 거부(직원 저장): " + nex.Message); return (false, nex.Message); }',
    'catch (NotAuthorizedException nex) { _log("권한 거부(직원 저장): " + nex.Message); return (false, OfflineMsg); }');
  assert.throws(() => checks.deniedIsNotOffline(bad), /사용자 문장 그대로 돌려주지 않는다/);
  assert.doesNotThrow(() => checks.deniedIsNotOffline(pdb));   // 통제군
});

test('변이③: 마지막 관리자 판정에서 FOR UPDATE 를 빼면 계약③ 이 실패한다(동시 강등으로 0명)', () => {
  const bad = mutate(pdb,
    "\"SELECT COUNT(*) FROM app_user WHERE edit_role='admin' AND is_active=1 FOR UPDATE\"",
    "\"SELECT COUNT(*) FROM app_user WHERE edit_role='admin' AND is_active=1\"");
  assert.throws(() => checks.lockoutGuards(bad), /FOR UPDATE 로 세지 않는다/);
});

test('변이③-b: 자기 퇴사 금지를 지우면 계약③ 이 실패한다', () => {
  const bad = mutate(pdb,
    '                        { await tx.RollbackAsync(cts.Token); return (false, SelfDeactivateMsg); }',
    '                        { }');
  assert.throws(() => checks.lockoutGuards(bad), /자기 퇴사 금지/);
});

test('변이③-c: app_user 하드삭제 경로가 생기면 계약③ 이 실패한다', () => {
  const bad = mutate(pdb, 'UPDATE app_user SET is_active=@a WHERE user_id=@uid', 'DELETE FROM app_user WHERE user_id=@uid');
  assert.throws(() => checks.lockoutGuards(bad), /DELETE 하는 SQL 이 생겼다/);
});

test('변이④: 로그인 ID 정규식을 넓히면 계약④ 가 실패한다', () => {
  const bad = mutate(pdb, '@"^[A-Za-z0-9._-]{1,50}$"', '@"^.{1,50}$"');
  assert.throws(() => checks.inputValidation(bad), /정규식이 \^\[A-Za-z0-9/);
});

test('변이④-b: 직급 검증을 숨김 포함으로 바꾸면 계약④ 가 실패한다(폐지된 직급으로 신규 배정)', () => {
  const bad = mutate(pdb, 'LoadCodeNameSetAsync(conn, cts.Token, "title_code", activeOnly: true)',
                          'LoadCodeNameSetAsync(conn, cts.Token, "title_code", activeOnly: false)');
  assert.throws(() => checks.inputValidation(bad), /활성 title_code 로드가 아니다/);
});

test('변이④-c: 수정에서 "현재 저장된 값 허용"을 지우면 계약④ 가 실패한다(폐지 직급인 사람을 못 고친다)', () => {
  const bad = mutate(pdb,
    'if (!titleSet.Contains(ti) && !string.Equals(ti, target.Value.title, StringComparison.Ordinal))',
    'if (!titleSet.Contains(ti))');
  assert.throws(() => checks.inputValidation(bad), /수정의 직급 검사가/);
  assert.doesNotThrow(() => checks.inputValidation(pdb));   // 통제군
});

test('변이④-d: 신규 등록의 활성 직급 검사를 지우면 계약④ 가 실패한다(폐지된 직급으로 새 사람이 들어온다)', () => {
  const bad = mutate(pdb,
    '                        if (!titleSet.Contains(ti)) { await tx.RollbackAsync(cts.Token); return (false, "등록되지 않은 직급입니다."); }\n',
    '');
  assert.throws(() => checks.inputValidation(bad), /신규 등록 분기에 활성 직급 검사가 없다/);
});

test('변이⑥-f: 목록 밖 서열 비우기를 지우면 계약⑥-f 가 실패한다(§7-1a 가 되살아난다)', () => {
  const bad = mutate(pdb,
    '"UPDATE app_user SET sort_order=NULL WHERE sort_order IS NOT NULL AND user_id NOT IN ("',
    '"UPDATE app_user SET sort_order=sort_order WHERE user_id IN ("');
  assert.throws(() => checks.orderClearsOutsiders(bad), /목록 밖 사람의 sort_order 를 비우지 않는다/);
  assert.doesNotThrow(() => checks.orderClearsOutsiders(pdb));   // 통제군
});

test('변이⑥-g: 빈 목록 거부를 지우면 계약⑥-f 가 실패한다(전원의 서열이 NULL 이 된다)', () => {
  const bad = mutate(pdb, 'if (kept.Count == 0)', 'if (false)');
  assert.throws(() => checks.orderClearsOutsiders(bad), /목록이 통째로 비었을 때 거부하지 않는다/);
});

test('변이⑤: 05-grants.sql 을 옛 SELECT 전용으로 되돌리면 계약⑤ 가 실패한다', () => {
  const bad = mutate(userGrants, 'GRANT SELECT, INSERT, UPDATE, DELETE ON `', 'GRANT SELECT ON `');
  assert.throws(() => checks.grantFiles(bad, calGrants), /넷이어야 한다/);
  assert.doesNotThrow(() => checks.grantFiles(userGrants, calGrants));   // 통제군
});

test('변이⑤-b: app_user 에서 DELETE 를 빼면 계약⑤ 가 실패한다(휴지통이 ERROR 1142 로 죽는다)', () => {
  const bad = mutate(userGrants, 'GRANT SELECT, INSERT, UPDATE, DELETE ON `', 'GRANT SELECT, INSERT, UPDATE ON `');
  assert.throws(() => checks.grantFiles(bad, calGrants), /넷이어야 한다/);
});

test('변이⑤-d: grants-calendar.sql 서술을 옛 "DELETE 없음"으로 되돌리면 계약⑤ 가 실패한다', () => {
  const bad = mutate(calGrants,
    'app_user 의 DELETE 는 휴지통 관문(ProjectDb.DeleteTrashAsync) 한 곳뿐이다',
    'app_user 의 DELETE 는 어디에도 없다');
  assert.throws(() => checks.grantFiles(userGrants, bad), /아직 "app_user DELETE 없음"이다/);
});

test('변이⑤-c: org_unit 에도 쓰기를 열면 계약⑤ 가 실패한다(이번 범위 밖)', () => {
  const bad = mutate(userGrants, "GRANT SELECT ON `', DATABASE(), '`.org_unit", "GRANT SELECT, UPDATE ON `', DATABASE(), '`.org_unit");
  assert.throws(() => checks.grantFiles(bad, calGrants), /org_unit 에 SELECT, UPDATE 을 준다/);
});

test('변이⑥: 명부 ORDER BY 에서 순번을 빼면 계약⑥ 이 실패한다(관리자가 정한 서열이 사라진다)', () => {
  const bad = mutate(pdb, '"ORDER BY o.name, u.sort_order IS NULL, u.sort_order, u.name"', '"ORDER BY o.name, u.name"');
  assert.throws(() => checks.orderIsHostOnly(bad, app), /§5\.3\(소속 → 순번/);
});

test('변이⑥-b: 화면이 명부를 다시 정렬하면 계약⑥ 이 실패한다', () => {
  const bad = mutate(app, '  const arr = Array.isArray(rows) ? rows : [];',
                          '  const arr = (Array.isArray(rows) ? rows : []).sort((a,b) => 0);');
  assert.throws(() => checks.orderIsHostOnly(pdb, bad), /다시 정렬한다/);
  assert.doesNotThrow(() => checks.orderIsHostOnly(pdb, app));   // 통제군
});

test('변이⑦: 화면이 스스로 관리자라고 판단하면 계약⑦ 이 실패한다', () => {
  const bad = mutate(app, '  __uaAdmin = d.admin === true;', '  __uaAdmin = true;');
  assert.throws(() => checks.adminFlagComesFromHost(bad), /호스트 회신\(d\.admin\)에서 그대로 받지 않는다/);
  assert.doesNotThrow(() => checks.adminFlagComesFromHost(app));   // 통제군
});

test('변이⑦-b: 편집 컨트롤을 「구성원 편집」 마크업에 적으면 계약⑦ 이 실패한다(숨김 ≠ 부재)', () => {
  const bad = mutate(app, '      <div id="uaAdmin"></div>',
                          '      <div id="uaAdmin"><button type="button" class="btn sm" id="uaNew">직원 등록</button></div>');
  assert.throws(() => checks.userAdminMarkupHasNoControls(bad), /비어 있지 않다|컨트롤\(직원 등록\)/);
});

test('변이⑦-b2: 등록 버튼을 하단 자리(#uaFoot)에 적어 두면 계약⑦ 이 실패한다(아래 자리도 같은 규칙이다)', () => {
  const bad = mutate(app, '      <span id="uaFoot"></span>',
                          '      <span id="uaFoot"><button type="button" class="btn primary" id="uaNew">＋ 직원 등록</button></span>');
  assert.throws(() => checks.userAdminMarkupHasNoControls(bad), /비어 있지 않다|컨트롤\(직원 등록\)/);
  assert.doesNotThrow(() => checks.userAdminMarkupHasNoControls(app));   // 통제군
});

test('변이⑦-f: 행에 [퇴사]를 도로 붙이면 계약⑦-e 가 실패한다', () => {
  const bad = mutate(app, "  mk('편집', 'edit', nm + ' 정보 수정', () => userEdOpen(uid));",
    "  mk('편집', 'edit', nm + ' 정보 수정', () => userEdOpen(uid));\n" +
    "  mk('퇴사', 'off', nm + ' 퇴사 처리', () => uaSetActive(uid, nm, false));");
  assert.throws(() => checks.retireLivesInForm(bad), /uaSetActive 를 부른다|uop 이 남아 있다/);
  assert.doesNotThrow(() => checks.retireLivesInForm(app));   // 통제군
});

test('변이⑦-f2: userEdOpen 이 폼 하단 버튼을 세우지 않으면 계약⑦-e 가 실패한다(대상이 이전 사람으로 남는다)', () => {
  const bad = mutate(app, "  const ab = document.getElementById('userEdActive');\n  if(ab){",
                          '  const ab = null;\n  if(ab){');
  assert.throws(() => checks.retireLivesInForm(bad), /#userEdActive 를 손대지 않는다/);
});

test('변이⑦-f3: 퇴사 버튼을 spacer 뒤(=[취소][저장] 옆)로 옮기면 계약⑦-e 가 실패한다', () => {
  const bad = mutate(app,
    '      <button type="button" class="btn danger" id="userEdActive" hidden>퇴사 처리</button>\n      <span class="spacer"></span>',
    '      <span class="spacer"></span>\n      <button type="button" class="btn danger" id="userEdActive" hidden>퇴사 처리</button>');
  assert.throws(() => checks.retireLivesInForm(bad), /spacer 뒤에 있다/);
});

test('변이⑩: 권한 문구를 폼 안에 직접 적으면 계약⑩ 이 실패한다(매핑표가 두 벌이 된다)', () => {
  const bad = mutate(app, "usRoleText(US_EDIT_ROLE, k)",
                          "usRoleText({ viewer: '조회', editor: '편집', admin: '관리자' }, k)");
  assert.throws(() => checks.formPickers(bad), /US_EDIT_ROLE 을 쓰지 않는다/);
  assert.doesNotThrow(() => checks.formPickers(app));   // 통제군
});

test('변이⑩-b: 편집 권한 잠금을 상수로 바꾸면 계약⑩ 이 실패한다(이전 사람의 잠금이 남는다)', () => {
  const bad = mutate(app, "if(rs) rs.disabled = isMe;", "if(rs && isMe) rs.disabled = true;");
  assert.throws(() => checks.formPickers(bad), /disabled 를 isMe 로 세우지 않는다/);
});

test('변이⑪: 옛 선택자(.modal label:first-child)로 되돌리면 계약⑪ 이 실패한다', () => {
  const bad = mutate(app, '.modal-body > label:first-child{margin-top:0}', '.modal label:first-child{margin-top:0}');
  assert.throws(() => checks.modalFormRhythm(bad), /2열 행이 위 칸에 붙는다/);
  assert.doesNotThrow(() => checks.modalFormRhythm(app));   // 통제군
});

test('변이⑦-c: 보기 화면이 admin 을 다시 읽기 시작하면 계약⑦ 이 실패한다(두 화면이 도로 엉킨다)', () => {
  const bad = mutate(app, '  __mbSel = mbDefaultSel(__mbUnits);',
                          '  __mbSel = d.admin === true ? null : mbDefaultSel(__mbUnits);');
  assert.throws(() => checks.adminFlagComesFromHost(bad), /mbApplyData 이 관리자 여부를 본다/);
});

test('변이⑦-d: 진입 버튼을 숨김으로 바꾸면 계약⑦-c 가 실패한다(숨김 ≠ 부재)', () => {
  const bad = mutate(app, '  if(!on){ if(cur && cur.parentNode) cur.parentNode.removeChild(cur); return; }',
                          "  if(!on){ if(cur) cur.classList.add('hidden'); return; }");
  assert.throws(() => checks.adminEntryButtonIsBuiltNotHidden(bad), /제거하지 않는다|숨김\(classList/);
  assert.doesNotThrow(() => checks.adminEntryButtonIsBuiltNotHidden(app));   // 통제군
});

test('변이⑦-e: 진입 버튼을 마크업에 적으면 계약⑦-c 가 실패한다', () => {
  const bad = mutate(app, '          <button type="button" class="btn sm" id="usMembers">구성원 보기</button>',
                          '          <button type="button" class="btn sm" id="usMembers">구성원 보기</button>\n' +
                          '          <button type="button" class="btn sm" id="usUserAdmin">구성원 편집</button>');
  assert.throws(() => checks.adminEntryButtonIsBuiltNotHidden(bad), /마크업에 있다/);
});

// ══════════════════════════════════════════════════════════════════════
//  §8-7 — 편집 컨트롤은 **있어야 할 곳에만** 있다(숨김이 아니라 부재)
//  ★ 2026-09-10 사용자 결정으로 볼 것이 셋이다:
//      (a) 「구성원 보기」(#membersModal)는 **admin:true 회신에도** 편집 컨트롤이 0 이다.
//      (b) 「구성원 편집」(#userAdminModal)의 컨트롤은 **admin:true 일 때만** DOM 에 있다.
//      (c) 「구성원 편집」 진입 버튼은 edit_role!=='admin' 이면 DOM 에 **없다**(숨기지 않는다).
//  ★ 소스 문자열 검사로는 이 계약을 증명할 수 없다. 컨트롤을 만드는 코드는 어차피 파일 안에 있고,
//    문제는 '그 코드가 언제 도는가'이기 때문이다. 그래서 실제로 그려 보고 DOM 을 센다.
//  ★ 앱 전체를 부팅하지 않는다 — 그리는 함수만 떼어 내 빈 문서에 심는다.
//    부팅하면 호스트 브리지·세션·타이머가 딸려 와 이 계약과 무관한 이유로 깨진다.
// ══════════════════════════════════════════════════════════════════════

const jsdom = await importOptional('jsdom');

const COUNT_JS = [
  'function __count(boxId, barId){',
  '  var list = document.getElementById(boxId);',
  '  var bar = barId ? document.getElementById(barId) : null;',
  '  return {',
  '    barChildren: bar ? bar.children.length : -1,',
  '    uops: Array.prototype.map.call(list.querySelectorAll("[data-uop]"), function(b){ return b.dataset.uop; }),',
  '    lines: list.querySelectorAll(".mba-line").length,',
  '    acts: list.querySelectorAll(".mba-act").length,',
  '    rows: list.querySelectorAll(".mb-row").length,',
  '    links: list.querySelectorAll(".mb-row.is-link").length,',
  '    badges: list.querySelectorAll(".badge").length,',
  '    text: String(list.textContent || ""),',
  '    texts: Array.prototype.map.call(list.querySelectorAll("button"), function(b){ return b.textContent; }),',
  '    footChildren: (function(){ var f = document.getElementById("uaFoot"); return f ? f.children.length : -1; })(),',
  '    footTexts: (function(){ var f = document.getElementById("uaFoot"); return f ?',
  '      Array.prototype.map.call(f.querySelectorAll("button"), function(b){ return b.textContent; }) : []; })(),',
  '  };',
  '}',
].join('\n');

// (a) 보기 화면 — 그리는 데 실제로 필요한 함수만 원본에서 떼어 낸다(사본은 반드시 낡는다).
//     ★ 관리자 상태를 **일부러 켜 둔 채로** 그린다: 보기 화면이 그 값을 어떤 경로로든 읽는다면
//       여기서 드러난다. 결정은 "관리자에게도 보기 화면은 같다" 이므로 켜 놓고 세는 것이 옳다.
function viewHarnessJs(src) {
  const fns = ['renderMembers', 'mbEmptyText'].map((n) => extractFunction(src, n));
  return [
    "var currentUser = { loginId: 'zzUme' };",
    'var __uaAdmin = true, __mbAdmin = true, __uaOrder = false;   // 켜 둔다 — 그래도 컨트롤이 0 이어야 한다',
    'function mbRowClick(){} function userEdOpen(){} function uaSetActive(){} function uaMove(){}',
    'function uaRowActions(){ var d = document.createElement("div"); d.className = "mba-act"; return d; }',
    'function toast(){}',
    ...fns,
    COUNT_JS,
    'window.__probe = function(rows){ renderMembers(rows); return __count("mbList", "mbAdmin"); };',
  ].join('\n');
}

// (b) 편집 화면 — 관리 막대와 목록을 그리는 함수만.
function adminHarnessJs(src) {
  const fns = ['uaRender', 'uaRowActions', 'uaAdminBar', 'uaEmptyText'].map((n) => extractFunction(src, n));
  return [
    "var currentUser = { loginId: 'zzUme' };",
    'var __uaAdmin = false, __uaOrder = false, __uaInactive = false;',
    'var __uaPendingData = null;   // 미뤄 둔 명부 푸시(uaAdminBar 가 안내 줄을 낼지 판단한다)',
    '// 이 계약과 무관한 협력자는 빈 함수로 — 여기서 보는 것은 "무엇이 그려지는가" 하나다.',
    'function userEdOpen(){} function uaSetActive(){} function uaMove(){}',
    'function uaOrderToggle(){} function uaOrderSave(){} function uaReload(){} function toast(){}',
    ...fns,
    COUNT_JS,
    'window.__probe = function(rows, admin, order){',
    '  __uaAdmin = !!admin; __uaOrder = !!order; __uaPendingData = null;',
    '  uaAdminBar(); uaRender(rows);',
    '  return __count("uaList", "uaAdmin");',
    '};',
    //  미뤄 둔 갱신이 있으면 순서 편집 막대가 그 사실을 말해야 한다(계약⑯의 DOM 쪽).
    'window.__probePending = function(rows, pending){',
    '  __uaAdmin = true; __uaOrder = true; __uaPendingData = pending ? { found: true } : null;',
    '  uaAdminBar(); uaRender(rows);',
    '  var bar = document.getElementById("uaAdmin");',
    '  return { hint: !!document.getElementById("uaPendHint"), text: String(bar.textContent || "") };',
    '};',
  ].join('\n');
}

// (d) 순서 편집의 ▲▼ — 목록을 다시 그린 **뒤에도** 포커스가 같은 행의 화살표에 남는가.
//     ★ jsdom 에는 레이아웃이 없어 scrollTop 은 늘 0 이다 — 그건 형태 계약(계약⑬)이 본다.
//       여기서 보는 것은 레이아웃이 없어도 참·거짓이 갈리는 것 하나, **포커스**다.
function moveHarnessJs(src) {
  const fns = ['uaVisible', 'uaEmptyText', 'uaRowActions', 'uaRender', 'uaApply', 'uaMove', 'uaFocusMoved']
    .map((n) => extractFunction(src, n));
  return [
    "var currentUser = { loginId: 'zzUme' };",
    'var __uaAdmin = true, __uaOrder = true, __uaInactive = false, __uaMembers = [];',
    'function userEdOpen(){} function uaSetActive(){} function toast(){}',
    ...fns,
    'function __focused(){',
    '  var a = document.activeElement;',
    '  return { uop: (a && a.dataset) ? String(a.dataset.uop || "") : "",',
    '           uid: (a && a.dataset) ? String(a.dataset.uid || "") : "",',
    '           isBody: a === document.body };',
    '}',
    'window.__probe = function(rows, uid, delta, pressUop){',
    '  __uaMembers = rows.slice();',
    '  uaApply();',
    '  var b = document.querySelector("[data-uop=\'" + pressUop + "\'][data-uid=\'" + uid + "\']");',
    '  var started = false;',
    '  if(b){ b.focus(); started = document.activeElement === b; }',
    '  uaMove(uid, delta);',
    '  return { started: started, order: __uaMembers.map(function(m){ return m.userId; }), focus: __focused() };',
    '};',
  ].join('\n');
}

// (e) 드롭다운 채우기 — '목록에 없는 값'을 만났을 때 무엇이 남는가(계약⑱의 DOM 쪽).
function fillHarnessJs(src) {
  return [
    extractFunction(src, 'userEdFillSelect'),
    'window.__probe = function(items, cur, blank){',
    '  var injected = userEdFillSelect("sel", items, cur, blank);',
    '  var sel = document.getElementById("sel");',
    '  return { injected: !!injected, value: String(sel.value),',
    '    options: Array.prototype.map.call(sel.options, function(o){',
    '      return { v: String(o.value), t: String(o.textContent), dis: !!o.disabled }; }) };',
    '};',
  ].join('\n');
}

// (f) 머리줄의 인원 수 — 검색 중이면 두 수를 함께 낸다(계약⑳의 DOM 쪽).
function scopeHarnessJs(src) {
  const fns = ['uaVisible', 'uaEmptyText', 'uaRowActions', 'uaRender', 'uaApply'].map((n) => extractFunction(src, n));
  return [
    "var currentUser = { loginId: 'zzUme' };",
    'var __uaAdmin = true, __uaOrder = false, __uaInactive = false, __uaMembers = [];',
    'function userEdOpen(){} function uaSetActive(){} function uaMove(){} function toast(){}',
    ...fns,
    'window.__probe = function(rows, search, inactive, admin){',
    '  __uaMembers = rows.slice(); __uaInactive = !!inactive; __uaAdmin = admin !== false;',
    '  document.getElementById("uaSearch").value = search || "";',
    '  uaApply();',
    '  return { scope: String(document.getElementById("uaScope").textContent || ""),',
    '           lines: document.querySelectorAll("#uaList .mba-line").length };',
    '};',
  ].join('\n');
}

// (c) 진입 버튼 — usAdminBtnSync 하나만 떼어 내 역할 문자열로 굴린다.
function entryHarnessJs(src) {
  return [
    'function openUserAdmin(){}',
    extractFunction(src, 'usAdminBtnSync'),
    'window.__probe = function(role){',
    '  usAdminBtnSync(role);',
    '  var b = document.getElementById("usUserAdmin");',
    '  return { present: !!b, text: b ? String(b.textContent || "") : "" };',
    '};',
  ].join('\n');
}

const VIEW_FIXTURE = '<!doctype html><html><body>' +
  '<input type="text" id="mbSearch">' +
  '<div id="mbSoon"></div><div id="mbList"></div><div id="mbEmpty"></div></body></html>';
const ADMIN_FIXTURE = '<!doctype html><html><body>' +
  '<div id="uaAdmin"></div><input type="text" id="uaSearch">' +
  '<div id="uaScope"></div><div id="uaList"></div><div id="uaEmpty"></div>' +
  '<span id="uaFoot"></span></body></html>';   // 하단 자리 — 마크업에선 빈 채고 uaAdminBar 가 채운다
const ENTRY_FIXTURE = '<!doctype html><html><body><div class="us-mem-row" id="usMemberBtns">' +
  '<button type="button" class="btn sm" id="usMembers">구성원 보기</button></div></body></html>';

const ROWS = [
  { userId: 11, loginId: 'zzUa', name: 'zzU_a', title: 'zzU-T1', orgUnit: 'zzU-조직', canViewSchedule: true, isActive: true },
  { userId: 12, loginId: 'zzUme', name: 'zzU_me', title: 'zzU-T1', orgUnit: 'zzU-조직', canViewSchedule: true, isActive: true },
  { userId: 13, loginId: 'zzUb', name: 'zzU_b', title: 'zzU-T2', orgUnit: 'zzU-조직', canViewSchedule: false, isActive: false },
];

//  ★ JSON 왕복으로 **이쪽 realm 의 값**으로 바꾼다. jsdom 의 Array 는 다른 realm 이라
//    deepStrictEqual 이 프로토타입 불일치로 항상 실패한다(값은 같은데 판정이 거짓말을 한다).
function run(fixture, js, ...args) {
  const { JSDOM } = jsdom;
  //  runScripts: outside-only — window 가 실제 realm 으로 선다(없으면 eval 안에서 window 가 미정의다).
  const dom = new JSDOM(fixture, { runScripts: 'outside-only' });
  dom.window.eval(js);
  return JSON.parse(JSON.stringify(dom.window.__probe(...args)));
}
//  __probe 말고 다른 이름의 창구를 부를 때(한 하네스가 여러 각도를 재는 경우).
function runNamed(fixture, js, name, ...args) {
  const { JSDOM } = jsdom;
  const dom = new JSDOM(fixture, { runScripts: 'outside-only' });
  dom.window.eval(js);
  return JSON.parse(JSON.stringify(dom.window[name](...args)));
}
const FILL_FIXTURE = '<!doctype html><html><body><select id="sel"></select></body></html>';
const probeView = (src = app) => run(VIEW_FIXTURE, viewHarnessJs(src), ROWS);
const probeAdmin = (admin, order, src = app) => run(ADMIN_FIXTURE, adminHarnessJs(src), ROWS, admin, order);
const probePending = (pending, src = app) => runNamed(ADMIN_FIXTURE, adminHarnessJs(src), '__probePending', ROWS, pending);
const probeMove = (uid, delta, pressUop, src = app) => run(ADMIN_FIXTURE, moveHarnessJs(src), ROWS, uid, delta, pressUop);
const probeFill = (items, cur, blank, src = app) => run(FILL_FIXTURE, fillHarnessJs(src), items, cur, blank);
const probeScope = (search, inactive, admin, src = app) => run(ADMIN_FIXTURE, scopeHarnessJs(src), ROWS, search, inactive, admin);
const probeEntry = (role, src = app) => run(ENTRY_FIXTURE, entryHarnessJs(src), role);
//  (c) 는 '한 번 만든 뒤 내려갔을 때'가 진짜 관문이다 — 만들어 본 적이 없으면 숨김 변이도 통과한다.
function probeEntrySeq(roles, src = app) {
  const { JSDOM } = jsdom;
  const dom = new JSDOM(ENTRY_FIXTURE, { runScripts: 'outside-only' });
  dom.window.eval(entryHarnessJs(src));
  return roles.map((r) => JSON.parse(JSON.stringify(dom.window.__probe(r))));
}

if (!jsdom) {
  // skip 은 통과가 아니다 — 러너가 exit 2(판정 없음)로 끝나고, 릴리스 게이트(TC_TEST_STRICT=1)는 실패로 승격한다.
  const { skip } = await import('./harness.mjs');
  skip('계약⑦-DOM(a): 「구성원 보기」는 관리자에게도 편집 컨트롤이 0', SKIP_NO_JSDOM, '이 파일의 DOM 계약 5건이 세어지지 않음');
  skip('계약⑦-DOM(b): 「구성원 편집」 컨트롤은 admin:true 일 때만 있다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(b): 순서 편집을 켜면 ▲▼ 로 바뀌고 편집은 사라진다(하단 등록도 함께 사라진다)', SKIP_NO_JSDOM);
  skip("계약⑦-DOM(c): 진입 버튼은 edit_role==='admin' 일 때만 DOM 에 있다", SKIP_NO_JSDOM);
  skip('변이⑦-DOM: 세 계약이 각각 한 줄 변이로 깨진다', SKIP_NO_JSDOM);
  skip('계약⑬-DOM: ▲▼ 를 눌러도 포커스가 같은 행의 화살표에 남는다', SKIP_NO_JSDOM);
  skip('계약⑬-DOM(b): 끝에 닿아 화살표가 꺼지면 반대쪽 화살표를 잡는다', SKIP_NO_JSDOM);
  skip('변이⑬-DOM: 포커스 복원을 지우면 포커스가 body 로 떨어진다', SKIP_NO_JSDOM);
  skip('계약⑯-DOM: 미뤄 둔 갱신이 있으면 순서 편집 막대가 그 사실을 말한다', SKIP_NO_JSDOM);
  skip('계약⑱-DOM: 목록에 없는 값은 맨 위에 끼워 넣고 그대로 선택된다', SKIP_NO_JSDOM);
  skip('변이⑱-DOM: 옛 동작(첫 항목으로 갈아치우기)이면 값이 조용히 바뀐다', SKIP_NO_JSDOM);
  skip('계약⑳-DOM: 검색 중 머리줄은 걸러진 수와 전체 수를 함께 낸다', SKIP_NO_JSDOM);
} else {
  test('계약⑦-DOM(a): 「구성원 보기」는 관리자에게도 편집 컨트롤이 0 이다(숨김이 아니라 부재)', () => {
    const r = probeView();
    assert.strictEqual(r.rows, ROWS.length, '전제 붕괴: 보기 명부에 행이 그려지지 않았다');
    assert.deepStrictEqual(r.uops, [], `보기 화면 DOM 에 조작 버튼이 있다: ${r.uops.join(', ')}`);
    assert.strictEqual(r.lines, 0, '보기 화면에 .mba-line 래퍼가 생겼다 — 편집 화면의 행 구조가 흘러들어 왔다');
    assert.strictEqual(r.acts, 0, '보기 화면에 .mba-act 조작칸이 생겼다');
    for (const t of r.texts) {
      assert.ok(!/편집|퇴사|복구|▲|▼|저장/.test(t), `보기 화면 DOM 에 편집 컨트롤 문구가 있다: ${t}`);
    }
    // 열람 진입점은 그대로여야 한다 — 과잉 차단도 결함이다(명부는 명부다).
    assert.strictEqual(r.links, 1, `누를 수 있는 행이 ${r.links}개다(내가 아니고 일정을 볼 수 있는 1명이어야 한다)`);
  });

  test('계약⑦-DOM(b): 「구성원 편집」 컨트롤은 admin:true 일 때만 DOM 에 있다', () => {
    const off = probeAdmin(false, false);
    assert.strictEqual(off.barChildren, 0, `admin:false 인데 #uaAdmin 에 자식이 ${off.barChildren}개 있다`);
    assert.deepStrictEqual(off.uops, [], `admin:false DOM 에 조작 버튼이 있다: ${off.uops.join(', ')}`);
    assert.strictEqual(off.lines, 0, 'admin:false 인데 행이 그려졌다 — 편집 화면은 관리자 회신 없이 아무것도 그리지 않는다');
    assert.ok(/관리자만 사용할 수 있습니다/.test(off.text),
      `admin:false 안내 문구가 없다(실제: ${JSON.stringify(off.text.slice(0, 60))}) — 빈 화면은 고장처럼 보인다`);
    assert.strictEqual(off.footChildren, 0, `admin:false 인데 #uaFoot 에 자식이 ${off.footChildren}개 있다 — 등록 버튼도 부재여야 한다`);

    const on = probeAdmin(true, false);
    assert.strictEqual(on.lines, ROWS.length, '관리자인데 행이 .mba-line 으로 묶이지 않았다');
    assert.deepStrictEqual(on.uops, ['edit', 'edit', 'edit'],
      `행 조작 버튼 구성이 계약과 다르다: ${on.uops.join(', ')} — 행에는 [편집]만 있다(퇴사·복구는 편집 폼 하단으로 옮겼다 2026-09-10)`);
    assert.ok(on.barChildren > 0, '관리자인데 #uaAdmin 막대가 비어 있다');
    //  ★ 「＋ 직원 등록」은 하단 자리에만 있다 — 상단 막대에 두었더니 관리자가 찾지 못했다(2026-09-10).
    assert.deepStrictEqual(on.footTexts, ['＋ 직원 등록'],
      `#uaFoot 의 버튼 구성이 계약과 다르다: ${JSON.stringify(on.footTexts)} — 등록 하나가 이 화면의 주 동작이다`);
    //  ★ 퇴사자 표시는 이제 알약 하나가 혼자 진다(행에서 [퇴사] 버튼이 사라졌으므로).
    assert.strictEqual(on.badges, 1,
      `퇴사 꼬리표(.badge)가 ${on.badges}개다 — 명부의 퇴사자 1명에게만 붙어야 한다`);
    //  ★ 편집 화면의 행은 눌리지 않는다 — 남의 일정 열람은 「구성원 보기」의 일이다.
    assert.strictEqual(on.links, 0, `편집 화면 행이 눌린다(.mb-row.is-link ${on.links}개) — 이 화면은 고치는 화면이다`);
  });

  test('계약⑦-DOM(b): 순서 편집을 켜면 ▲▼ 로 바뀌고 편집은 사라진다(하단 등록도 함께 사라진다)', () => {
    const r = probeAdmin(true, true);
    assert.deepStrictEqual(r.uops, ['up', 'down', 'up', 'down', 'up', 'down'],
      `순서 편집 중 조작 버튼이 ▲▼ 가 아니다: ${r.uops.join(', ')} — 좁은 폭에서 버튼 넷이 붙으면 이름이 되접힌다`);
    for (const t of r.texts) {
      assert.ok(!/편집|퇴사|복구/.test(t), `순서 편집 중인데 행에 ${t} 버튼이 남아 있다`);
    }
    //  ★ 등록은 명부를 다시 읽어 와 **편집 중인 순서를 날린다** — 그래서 이 모드에서는 하단도 빈 자리다.
    assert.strictEqual(r.footChildren, 0,
      `순서 편집 중인데 #uaFoot 에 자식이 ${r.footChildren}개 있다 — 등록이 명부를 다시 읽어 편집 중인 순서를 날린다`);
  });

  test("계약⑦-DOM(c): 진입 버튼은 edit_role==='admin' 일 때만 DOM 에 있다(숨김이 아니라 부재)", () => {
    for (const role of ['viewer', 'editor', '', null, 'superuser', 'Admin']) {
      const r = probeEntry(role);
      assert.strictEqual(r.present, false,
        `edit_role=${JSON.stringify(role)} 인데 「구성원 편집」 버튼이 DOM 에 있다 — 관리자만 이 문을 본다`);
    }
    const on = probeEntry('admin');
    assert.strictEqual(on.present, true, "edit_role='admin' 인데 「구성원 편집」 버튼이 만들어지지 않았다");
    assert.strictEqual(on.text, '구성원 편집', `버튼 문구가 다르다: ${JSON.stringify(on.text)}`);
    //  ★ 진짜 관문: 관리자였다가 내려간 경우. 숨김으로 바꾸면 여기서만 드러난다.
    const seq = probeEntrySeq(['admin', 'editor', 'admin', '']);
    assert.deepStrictEqual(seq.map((x) => x.present), [true, false, true, false],
      `역할이 바뀔 때 버튼이 생겼다 사라지지 않는다: ${JSON.stringify(seq.map((x) => x.present))} — 남으면 내려간 사람에게 문이 남는다`);
  });

  test('변이⑦-DOM: 세 계약이 각각 한 줄 변이로 깨진다(안 깨지면 그 검사는 장식이다)', () => {
    // (a) 보기 화면에 조작 버튼을 다는 한 줄
    const badA = mutate(app, '    list.appendChild(row);\n  }',
      '    var __l = document.createElement("div"); __l.className = "mba-line";' +
      ' __l.appendChild(row); __l.appendChild(uaRowActions(m, arr)); list.appendChild(__l);\n  }');
    const ra = probeView(badA);
    assert.ok(ra.lines > 0 || ra.acts > 0,
      '변이 전제: 보기 화면에 .mba-line/.mba-act 가 생겨야 한다(변이가 먹지 않았다)');

    // (b) 비관리자 분기를 지우는 한 줄
    const badB = mutate(app, '  if(!__uaAdmin){\n', '  if(false){\n');
    const rb = probeAdmin(false, false, badB);
    assert.ok(rb.uops.length > 0 || rb.lines > 0,
      '변이 전제: 분기를 지우면 admin:false 에도 조작 버튼이 그려져야 한다');

    // (c) 진입 버튼 제거를 숨김으로 바꾸는 한 줄
    const badC = mutate(app, '  if(!on){ if(cur && cur.parentNode) cur.parentNode.removeChild(cur); return; }',
      "  if(!on){ if(cur) cur.classList.add('hidden'); return; }");
    const rc = probeEntrySeq(['admin', 'editor'], badC);
    assert.strictEqual(rc[1].present, true,
      '변이 전제: 숨김으로 바꾸면 내려간 뒤에도 버튼이 DOM 에 남아야 한다(그래서 부재 계약이 필요하다)');
    // 통제군 — 원본은 셋 다 계약을 지킨다.
    assert.strictEqual(probeView().lines, 0);
    assert.strictEqual(probeAdmin(false, false).uops.length, 0);
    assert.strictEqual(probeEntrySeq(['admin', 'editor'])[1].present, false);
  });

  test('계약⑬-DOM: ▲▼ 를 눌러도 포커스가 **같은 행의 같은 화살표**에 남는다(연속 조작이 된다)', () => {
    //  [11, 12, 13] 에서 11 을 ▼ 로 내린다 → [12, 11, 13]. 11 은 가운데라 ▼ 가 살아 있으니 그대로 잡혀 있어야 한다.
    const r = probeMove(11, +1, 'down');
    assert.strictEqual(r.started, true, '전제 붕괴: ▼ 버튼에 포커스가 가지 않았다');
    assert.deepStrictEqual(r.order, [12, 11, 13], `한 칸 이동이 반영되지 않았다: ${JSON.stringify(r.order)}`);
    assert.strictEqual(r.focus.isBody, false,
      '한 칸 옮기자 포커스가 body 로 떨어졌다 — 두 번째 ▼ 를 누르려면 마우스로 다시 찾아야 한다');
    assert.strictEqual(r.focus.uid, '11', `포커스가 옮긴 행이 아닌 곳에 있다: ${JSON.stringify(r.focus)}`);
    assert.strictEqual(r.focus.uop, 'down', `누르던 화살표가 아닌 곳에 포커스가 있다: ${JSON.stringify(r.focus)}`);
  });

  test('계약⑬-DOM(b): 끝에 닿아 화살표가 꺼지면 **반대쪽** 화살표를 잡는다(포커스가 사라지지 않는다)', () => {
    //  [11, 12, 13] 에서 12 를 ▲ 로 올리면 [12, 11, 13] — 12 가 맨 위라 그 행의 ▲ 는 꺼진다.
    //  꺼진 버튼에 포커스를 주면 브라우저가 body 로 떨어뜨린다. 그래서 같은 행의 ▼ 를 잡아야 한다.
    const r = probeMove(12, -1, 'up');
    assert.deepStrictEqual(r.order, [12, 11, 13], `전제 붕괴: ${JSON.stringify(r.order)}`);
    assert.strictEqual(r.focus.isBody, false, '맨 위로 올린 뒤 포커스가 사라졌다 — 다음 조작을 마우스로 다시 찾아야 한다');
    assert.strictEqual(r.focus.uid, '12', `포커스가 옮긴 행에 없다: ${JSON.stringify(r.focus)}`);
    assert.strictEqual(r.focus.uop, 'down',
      `꺼진 ▲ 대신 ▼ 를 잡지 않았다: ${JSON.stringify(r.focus)} — 끝에 닿는 순간 포커스가 사라진다`);
  });

  test('변이⑬-DOM: 포커스 복원을 지우면 포커스가 body 로 떨어진다(그래서 이 계약이 필요하다)', () => {
    const bad = mutate(app, '  uaFocusMoved(userId, uop);', '  ');
    const r = probeMove(11, +1, 'down', bad);
    assert.strictEqual(r.focus.isBody, true, '변이 전제: 복원을 지우면 포커스가 body 로 떨어져야 한다');
    assert.strictEqual(probeMove(11, +1, 'down').focus.isBody, false);   // 통제군
  });

  test('계약⑯-DOM: 미뤄 둔 갱신이 있으면 순서 편집 막대가 그 사실을 말한다', () => {
    const off = probePending(false);
    assert.strictEqual(off.hint, false, '미뤄 둔 갱신이 없는데 안내가 떴다');
    const on = probePending(true);
    assert.strictEqual(on.hint, true, '미뤄 둔 갱신이 있는데 안내가 없다 — 관리자는 낡은 화면인 줄 모른다');
    assert.ok(/명부가 갱신되었습니다 — 순서 편집을 마치면 반영됩니다\./.test(on.text),
      `안내 문구가 계약과 다르다: ${JSON.stringify(on.text)}`);
  });

  test('계약⑱-DOM: 목록에 없는 값은 맨 위에 끼워 넣고 **그대로 선택**된다(조용히 안 바뀐다)', () => {
    const TITLES = [{ value: '사원', label: '사원' }, { value: '대리', label: '대리' }];
    //  ① 목록에 있는 값 — 끼워 넣지 않는다.
    const ok = probeFill(TITLES, '대리', null);
    assert.strictEqual(ok.injected, false, '목록에 있는 값인데 "목록에 없음" 옵션이 끼었다');
    assert.strictEqual(ok.value, '대리', '목록에 있는 값이 선택되지 않았다');
    assert.strictEqual(ok.options.length, 2, `옵션 수가 다르다: ${JSON.stringify(ok.options)}`);
    //  ② 목록에 없는 값(폐지된 직급) — 맨 위에 끼워 넣고 그대로 고른다.
    const gone = probeFill(TITLES, '주임', null);
    assert.strictEqual(gone.injected, true, '목록에 없는 값인데 끼워 넣지 않았다 — 첫 항목으로 조용히 바뀐다');
    assert.strictEqual(gone.value, '주임',
      `목록에 없는 값이 선택되지 않았다(실제: ${JSON.stringify(gone.value)}) — [저장]만 눌러도 직급이 바뀐다`);
    assert.strictEqual(gone.options[0].v, '주임', '끼워 넣은 옵션이 맨 위가 아니다');
    assert.strictEqual(gone.options[0].t, '주임 — 목록에 없음', `끼워 넣은 옵션의 라벨이 다르다: ${JSON.stringify(gone.options[0].t)}`);
    assert.strictEqual(gone.options[0].dis, false, '끼워 넣은 옵션이 disabled 다 — 그대로 두는 것이 기본값이라 고를 수 있어야 한다');
    //  ③ 빈 값 + 빈 옵션(소속 없음) — 끼워 넣지 않는다.
    const blank = probeFill([{ value: '3', label: 'SW 3팀' }], '', '(소속 없음)');
    assert.strictEqual(blank.injected, false, '빈 값에 "목록에 없음" 옵션이 끼었다');
    assert.strictEqual(blank.value, '', '빈 값이 선택되지 않았다');
  });

  test('변이⑱-DOM: 옛 동작(첫 항목으로 갈아치우기)이면 값이 조용히 바뀐다(그래서 이 계약이 필요하다)', () => {
    const bad = mutate(app, "  const known = want === '' || Array.prototype.some.call(sel.options, o => o.value === want);",
      '  const known = true;');
    const r = probeFill([{ value: '사원', label: '사원' }, { value: '대리', label: '대리' }], '주임', null, bad);
    assert.strictEqual(r.value, '사원', '변이 전제: 옛 동작이면 첫 항목으로 갈아치워져야 한다');
    assert.strictEqual(probeFill([{ value: '사원', label: '사원' }], '주임', null).value, '주임');   // 통제군
  });

  test('계약⑳-DOM: 검색 중 머리줄은 걸러진 수와 전체 수를 함께 낸다', () => {
    const all = probeScope('', false);
    assert.strictEqual(all.scope, '구성원 3명', `검색어가 없을 때의 문구가 다르다: ${JSON.stringify(all.scope)}`);
    const inact = probeScope('', true);
    assert.strictEqual(inact.scope, '구성원 3명 · 퇴사자 포함', `퇴사자 포함 꼬리가 다르다: ${JSON.stringify(inact.scope)}`);
    const q = probeScope('zzU_a', false);
    assert.strictEqual(q.lines, 1, `검색이 1명으로 좁혀지지 않았다: ${q.lines}`);
    assert.strictEqual(q.scope, '검색 결과 1명 · 전체 3명',
      `검색 중 머리줄이 계약과 다르다: ${JSON.stringify(q.scope)} — 걸러진 수만 내면 명부가 줄어든 것처럼 읽힌다`);
    //  비관리자에게는 인원 수 자체가 없다(그 화면에는 명부가 없다).
    assert.strictEqual(probeScope('', false, false).scope, '관리자만 사용할 수 있습니다.', '비관리자 머리줄이 안내가 아니다');
  });
}

// ── 계약⑧: 호스트 정수 파서·메시지 분기의 무음 실패 봉인 (2026-09-10 실측에서 발견) ───────
//   saveUser 에 orgId:null 을 보내자 회신도 로그도 없이 사라지고 화면이 저장 중으로 굳었다.
//   원인 둘: GetInt 가 TryGetInt32 를 ValueKind 검사 없이 불러 숫자 아닌 값에서 예외 · 바깥 catch 가 Debug 출력에만 남김.
const getIntSrc = (src) => { const m = /private static int GetInt\(JsonDocument d, string key\) =>\r*\n([^\n]*)/.exec(src); return m ? m[1] : ""; };
const outerCatch = (src) => { const m = /catch \(Exception ex\) \{ Debug\.WriteLine\("웹 메시지 처리 오류: " \+ ex\);([^\n]*)\}/.exec(src); return m ? m[1] : null; };

test("계약⑧: GetInt 는 ValueKind==Number 를 먼저 보고, 웹 메시지 바깥 catch 는 위젯 로그에 남긴다", () => {
  const body = getIntSrc(main);
  assert.ok(body.length > 0, "MainWindow.xaml.cs 에서 GetInt 정의를 찾지 못했다 — 측정 못 함");
  assert.ok(/ValueKind == JsonValueKind\.Number && v\.TryGetInt32/.test(body), "GetInt 가 TryGetInt32 앞에서 ValueKind 를 검사하지 않는다 — null 정수 필드가 메시지를 통째로 죽인다");
  const c = outerCatch(main);
  assert.ok(c !== null, "OnWebMessage 의 바깥 catch 를 찾지 못했다 — 측정 못 함");
  assert.ok(/\bLog\(/.test(c), "바깥 catch 가 위젯 로그(Log)에 남기지 않는다 — 배포본에서는 Debug 출력이 아무 데도 안 남는다");
});
test("변이⑧: ValueKind 검사를 지우면 계약⑧ 이 실패한다 + 원본은 통과한다(통제군)", () => {
  const bad = main.replace("v.ValueKind == JsonValueKind.Number && v.TryGetInt32", "v.TryGetInt32");
  assert.notStrictEqual(bad, main, "변이가 적용되지 않았다");
  assert.ok(!/ValueKind == JsonValueKind\.Number && v\.TryGetInt32/.test(getIntSrc(bad)), "변이본이 계약⑧ 을 통과한다 — 검사가 무효");
  assert.ok(/ValueKind == JsonValueKind\.Number && v\.TryGetInt32/.test(getIntSrc(main)), "통제군: 원본이 통과해야 한다");
});
test("변이⑧-b: 바깥 catch 의 Log 를 지우면 계약⑧ 이 실패한다", () => {
  const c = outerCatch(main); assert.ok(c !== null);
  const bad = main.replace(c, " ");
  assert.notStrictEqual(bad, main, "변이가 적용되지 않았다");
  assert.ok(!/\bLog\(/.test(outerCatch(bad) ?? ""), "변이본이 계약⑧ 을 통과한다 — 검사가 무효");
});

// ── 계약⑨: 12 마이그레이션 — sort_order 를 INT UNSIGNED 로 넓히고, 가드가 11 에서만 열리며, 12 로 올린다 ──
//   SMALLINT UNSIGNED 는 10 간격 6,553명이 천장이다(2026-09-10 격리 DB 실측: 6,554명째 ERROR 1264 · 전량 롤백).
const MIGRATE_INT = 'db/deploy/migrate-2026-09-10-user-sort-order-int.sql';
const migrateIntSql = readOr(new URL('../' + MIGRATE_INT, import.meta.url), MIGRATE_INT);
test('계약⑨: INT 확장 마이그레이션은 MODIFY sort_order INT UNSIGNED NULL · 가드 11 · 승격 12 다', () => {
  assert.ok(migrateIntSql, MIGRATE_INT + ' 을 읽지 못했다 — 측정 못 함');
  const code = stripSqlComments(migrateIntSql);
  assert.ok(/ALTER\s+TABLE\s+app_user\s+MODIFY\s+sort_order\s+INT\s+UNSIGNED\s+NULL\s+DEFAULT\s+NULL/i.test(code),
    MIGRATE_INT + ' 이 sort_order 를 INT UNSIGNED NULL DEFAULT NULL 로 MODIFY 하지 않는다');
  assert.ok(/IF\(@v = '11'/.test(code), MIGRATE_INT + ' 의 가드가 11 에서 열리지 않는다(재실행·건너뛰기 방지)');
  assert.ok(/SET v = '12'[\s\S]{0,120}AND v = '11'/.test(code), MIGRATE_INT + ' 이 11→12 로 올리지 않는다');
  assert.strictEqual(canonSchemaVersion(), '12', '정본 시딩이 12 가 아니다 — 위젯·마이그레이션과 어긋난다');
});
test('변이⑨: MODIFY 의 INT 를 SMALLINT 로 되돌리면 계약⑨ 가 실패한다 + 통제군', () => {
  assert.ok(migrateIntSql);
  const bad = migrateIntSql.replace('MODIFY sort_order INT UNSIGNED', 'MODIFY sort_order SMALLINT UNSIGNED');
  assert.notStrictEqual(bad, migrateIntSql, '변이가 적용되지 않았다');
  assert.ok(!/MODIFY\s+sort_order\s+INT\s+UNSIGNED/i.test(stripSqlComments(bad)), '변이본이 계약⑨ 를 통과한다 — 검사가 무효');
  assert.ok(/MODIFY\s+sort_order\s+INT\s+UNSIGNED/i.test(stripSqlComments(migrateIntSql)), '통제군: 원본은 통과해야 한다');
});
test('변이⑨-b: 가드를 10 으로 바꾸면 계약⑨ 가 실패한다(앞선 판을 건너뛴 DB 에서 열린다)', () => {
  const bad = migrateIntSql.replace("IF(@v = '11'", "IF(@v = '10'");
  assert.notStrictEqual(bad, migrateIntSql);
  assert.ok(!/IF\(@v = '11'/.test(stripSqlComments(bad)));
});

// ── 계약⑥-c: 「구성원 편집」은 팀과 무관하게 전사 서열순 — 호스트의 두 번째 ORDER BY(flatOrder)를 편집 화면만 부른다 ──
//   사용자 결정 2026-09-10. 정렬 리터럴은 호스트에 둘뿐이고(보기: 소속→순번→이름 / 편집: 순번→이름), 화면은 어느 쪽도 재정렬하지 않는다.
const FLAT_ORDER = '"ORDER BY u.sort_order IS NULL, u.sort_order, u.name"';
const callSite = (fn) => { const body = extractFunction(app, fn); const m = /hostRequest\('membersGet',\s*\{([^}]*)\}/.exec(body); return m ? m[1] : null; };
test('계약⑥-c: 편집 화면(uaReload·openUserAdmin)은 flat:true 로 부르고 보기 화면(openMembers)은 부르지 않으며, 호스트에 그 ORDER BY 가 있다', () => {
  assert.ok(pdb.includes(FLAT_ORDER), 'ProjectDb 에 편집용 ORDER BY(순번→이름)가 없다 — 편집 화면이 팀별로 묶인다');
  assert.ok(/flatOrder \? "ORDER BY u\.sort_order IS NULL/.test(pdb), 'flatOrder 가 편집용 ORDER BY 를 고르지 않는다');
  for (const fn of ['uaReload', 'openUserAdmin']) {
    const args = callSite(fn); assert.ok(args !== null, fn + ' 의 membersGet 호출을 찾지 못했다 — 측정 못 함');
    assert.ok(/\bflat:\s*true\b/.test(args), fn + ' 이 flat:true 를 보내지 않는다 — 편집 화면이 소속 순으로 묶인다');
  }
  const om = callSite('openMembers'); assert.ok(om !== null, 'openMembers 의 membersGet 호출을 찾지 못했다 — 측정 못 함');
  assert.ok(!/\bflat\b/.test(om), 'openMembers 가 flat 을 보낸다 — 보기 화면은 소속 → 순번 → 이름이어야 한다');
  const mw = stripCs(main);
  assert.ok(/GetBool\(doc, "flat"\)/.test(mw), 'membersGet 브리지가 flat 을 읽지 않는다');
  assert.ok(/LoadMembersJsonAsync\(s\.LoginId, includeInactive, flatOrder: true\)/.test(mw), '쓰기 뒤 푸시(LoadMembersToWebAsync)가 flat 이 아니다 — 저장 직후 편집 화면이 소속 순으로 튄다');
});
test('변이⑥-c: uaReload 에서 flat:true 를 빼면 계약⑥-c 가 실패한다', () => {
  const body = extractFunction(app, 'uaReload'); const bad = app.replace(body, body.replace(', flat: true', ''));
  assert.notStrictEqual(bad, app, '변이가 적용되지 않았다');
  const m = /hostRequest\('membersGet',\s*\{([^}]*)\}/.exec(extractFunction(bad, 'uaReload'));
  assert.ok(m && !/\bflat:\s*true\b/.test(m[1]), '변이본이 계약⑥-c 를 통과한다 — 검사가 무효');
});
test('변이⑥-d: openMembers 에 flat:true 를 넣으면 계약⑥-c 가 실패한다(보기 화면까지 전사 서열이 된다)', () => {
  const body = extractFunction(app, 'openMembers'); const bad = app.replace(body, body.replace('{ includeInactive: false }', '{ includeInactive: false, flat: true }'));
  assert.notStrictEqual(bad, app, '변이가 적용되지 않았다');
  const m = /hostRequest\('membersGet',\s*\{([^}]*)\}/.exec(extractFunction(bad, 'openMembers'));
  assert.ok(m && /\bflat\b/.test(m[1]), '변이본이 계약⑥-c 를 통과한다 — 검사가 무효');
});
