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
import {
  test, assert, loadAppSource, extractFunction, importOptional, SKIP_NO_JSDOM,
  stripCsComments, extractCsMember, useJsdom, runInJsdom,
} from './harness.mjs';
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

// C# 주석 제거·멤버 슬라이스는 harness 한 곳에 있다(다섯 시험 파일이 같은 사본을 안고 있던 것을 걷었다).
//   ★ 주석을 지우는 이유: "왜 안 하는지"를 적어 둔 **문장이** 계약을 통과시키면 안 된다.
const stripCs = stripCsComments;
const csMember = extractCsMember;
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

//  회신 명부의 **좌석 한 줄**(2026-09-14 좌석 일원화) — uaSend 안에 있다. trSend 에 글자가 똑같은 줄이
//  하나 더 있으므로(같은 문을 쓰기 때문이다) 앞의 회신 객체까지 묶어 **그 한 곳만** 가리키게 한다.
//  ★ String.replace 는 첫 일치만 바꾼다 — 유일하지 않은 변이는 어느 날 조용히 엉뚱한 함수를 친다.
const SEAT_IN_SEND = "r.error)) || ''), roster: String((r && r.roster) || '') };\n  rep.painted = uaSeatReply(rep.roster, cmd);\n";
const SEAT_IN_SEND_GONE = "r.error)) || ''), roster: String((r && r.roster) || '') };\n";

// window.__xxx = function(...){...} 형태의 호스트 콜백 — extractFunction 은 `function 이름(` 만 찾으므로
// 여기서 따로 오려 낸다(선언 모양이 다르다고 계약을 못 보면 안 된다 · trash-web.test.mjs 와 같은 도구).
function windowFn(web, name) {
  const s = web.indexOf('window.' + name + ' = function');
  assert.ok(s >= 0, `window.${name} 선언을 찾지 못했다 — 판정 불가`);
  const e = web.indexOf('\n};', s);
  assert.ok(e > s, `window.${name} 의 끝(';};')을 찾지 못했다 — 판정 불가`);
  return web.slice(s, e + 3);
}

//  ★ async 함수는 extractFunction 이 'function 이름(' 부터 오려 내므로 **async 가 떨어진다** — 그대로
//    jsdom 에서 eval 하면 "await is only valid in async functions" 로 죽는다(2026-09-14, 쓰기가 왕복이 된 뒤).
//    선언을 보고 다시 붙인다: 붙였는지 아닌지를 **원본이** 정하므로, 변이가 async 를 떼면 그대로 따라간다.
function extractFn(web, name) {
  const isAsync = new RegExp('async\\s+function\\s+' + name + '\\s*\\(').test(web);
  return (isAsync ? 'async ' : '') + extractFunction(web, name);
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
    // 잠금 방지 3규칙은 복구(active=true)에 걸지 않는다 — 막을 것이 없다(사람을 되살리는 조작이다).
    assert.ok(/if \(!active\)\s*\{/.test(sa),
      '퇴사/복구가 같은 규칙을 받는다 — 잠금 방지는 퇴사(!active)에만 걸어야 한다');
    //  ★ 2026-09-11 적대 검토(R4) — 다만 복구에는 **다른** 문이 하나 필요하다: 이미 활성인 사람을
    //    한 번 더 복구하면 아래 UPDATE 가 sort_order 를 비워 **살아 있는 서열이 지워지고** 성공까지
    //    돌려줬다(낡은 화면·세워 둔 푸시면 충분히 일어난다). 실패가 아니라 목록이 낡은 것이므로
    //    휴지통 복구와 **같은 판정·같은 문장**이다(AlreadyActiveMsg 한 줄이 정본).
    const already = sa.indexOf('AlreadyActiveMsg');
    assert.ok(already >= 0,
      '복구(SetUserActiveAsync 의 active=true)에 이미 활성 거부가 없다 — 이미 복구된 사람을 다시 복구하면 ' +
      '그 사람의 살아 있는 서열(sort_order)이 지워지고 성공으로 끝난다(R4)');
    assert.ok(/else if \(target\.Value\.isActive != 0\)/.test(sa),
      '이미 활성 판정이 **잠근 행의 값**(target.Value.isActive)으로 오지 않는다 — 판정과 갱신이 갈린다(R4)');
    assert.ok(already < sa.indexOf('string setActiveSql'),
      '이미 활성 거부가 UPDATE 문장을 만드는 자리보다 뒤에 있다 — 서열이 먼저 지워진다(R4)');
    assert.ok(/RollbackAsync\(cts\.Token\); *\n? *return \(false, AlreadyActiveMsg\);|RollbackAsync\(cts\.Token\);[\s\S]{0,80}?return \(false, AlreadyActiveMsg\);/.test(sa),
      '이미 활성 거부가 롤백 + 실패 회신으로 끝나지 않는다 — 브리지의 실패 갈래가 그 문장을 띄운다(R4)');

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
    //  ★ 2026-09-11 적대 검토(R7) — 그 검사는 이제 분기마다가 아니라 **한 벌**이다. 전에는 수정용과
    //    등록용이 같은 말(문구까지 같다)을 두 벌 적고 있어 한쪽만 고치면 조용히 갈렸다. 지금은
    //    '지금 저장된 값'을 curTitle·curOrg 로 받고, 신규는 그 둘이 null 이라 갈래가 저절로 닫힌다
    //    — 곧 **활성만**이다. 그래서 계약도 한 벌을 본다(두 벌을 강제하면 중복을 계약으로 굳히는 셈이다).
    assert.ok(/!titleSet\.Contains\(ti\) && !string\.Equals\(ti, curTitle, StringComparison\.Ordinal\)/.test(up),
      '직급 검사가 "활성이거나 현재 저장된 값"이 아니다 — 폐지된 직급을 단 사람은 이름 한 글자도 못 고친다(§4.3)');
    assert.ok(/orgId\.HasValue && orgId\.Value != \(curOrg \?\? -1\)/.test(up),
      '소속 검사가 "활성이거나 현재 저장된 값"이 아니다 — 값이 그대로면 조회조차 하지 않아야 한다(§4.3)');
    //    완화가 **신규 등록까지 번지지 않는다**는 것은 '지금 저장된 값'의 출처로 못박는다: 그 둘은
    //    잠근 대상 행(target)에서만 오고, 신규면 target 이 null 이라 함께 null 이다. 입력값이나 상수에서
    //    오면 등록도 통과해 폐지된 직급으로 새 사람이 들어온다.
    assert.ok(/string\? curTitle = target\?\.title;/.test(up) && /int\? curOrg = target\?\.orgId;/.test(up),
      "'지금 저장된 값'이 잠근 대상 행(target)에서 오지 않는다 — 신규 등록까지 완화가 번지면 폐지된 직급으로 새 사람이 들어온다");
    assert.ok(/target = await LockedUserAsync\(conn, tx, userId\.Value, cts\.Token\);/.test(up),
      '대상 행을 FOR UPDATE 로 잠근 뒤 읽지 않는다 — 완화의 근거가 잠기지 않은 값이 된다(§4.4)');
  },

  // ⑥-f 퇴사자의 옛 순번은 **어디서** 비워지는가(USER-ADMIN §7-1a · 2026-09-10 → R1 → 2026-09-11 R3).
  //    옛 판은 **순서 저장** 쪽에서 비웠다: 목록 밖이면 sort_order 를 NULL 로 밀었다(R1 에서 그 갈래에
  //    is_active=0 을 걸어 활성 직원을 보호했다). 그래도 틈이 남았다 — 낡은 명부 판정(COUNT)과
  //    재작성(CASE) 사이에 남이 그 퇴사자를 복구하면, 그 사람은 그 순간 **활성**이라 비우기 갈래에
  //    걸리지 않고 옛 숫자를 그대로 들고 새 서열(10·20·30…) 사이에 끼어들었다(2026-09-11 적대 검토 R3).
  //    지금은 비우는 시점이 '저장할 때' 가 아니라 **'돌아올 때'** 다: 복구하는 두 자리
  //    (SetUserActiveAsync 의 active=true · RestoreTrashAsync 의 user 갈래)가 sort_order 를 NULL 로
  //    비운다. NULL 은 명부 ORDER BY 에서 맨 뒤라(§5.3) 복구한 사람은 맨 뒤에 서고, 관리자가 그때 한 번
  //    끌어올리면 끝난다 — 구분·상태 코드의 '복구 = MAX+10' 과 같은 판단이다.
  //    그래서 순서 저장이 쓰는 자리는 **받은 목록 하나**뿐이고, 낡은 명부 거부(①)만 그대로 남는다
  //    (그건 서열 비우기가 아니라 '화면이 낡았다' 에 대한 가드다).
  orderClearsOutsiders(cs) {
    const so = csMember(cs, 'SaveUserOrderAsync(');
    //  (0) 비우는 자리는 **복구 쪽 두 곳**이다. 한쪽만 고치면 그 경로로 돌아온 사람이 옛 숫자를 들고 온다.
    const act = csMember(cs, 'SetUserActiveAsync(');
    //      ★ 2026-09-11 적대 검토(R4) — 그 비우기는 **숨김에서 돌아오는 사람에게만** 걸려야 한다.
    //        문장의 AND is_active=0 이 그 이중 잠금이다(판정은 위 잠근 행에서 이미 끝났다).
    assert.ok(/UPDATE app_user SET is_active=1, sort_order=NULL WHERE user_id=@uid AND is_active=0/.test(act),
      '복구(SetUserActiveAsync 의 active=true)가 sort_order 를 비우지 않거나, 이미 활성인 행까지 비운다 — ' +
      '전자는 퇴사자가 옛 순번을 들고 돌아와 활성 서열(10·20·30…) 사이에 끼어들고(§7-1a · R3), ' +
      '후자는 멀쩡히 쓰이던 사람의 서열을 지운다(R4)');
    assert.ok(/UPDATE app_user SET is_active=0 WHERE user_id=@uid/.test(act),
      '퇴사(active=false)가 서열까지 손댄다 — 그 값은 돌아올 때 어차피 비워지고, 지금 지우면 ' +
      "'퇴사 → 곧바로 복구' 가 멀쩡하던 자리를 잃는다(R3)");
    const rt = csMember(cs, 'RestoreTrashAsync(');
    assert.ok(/case "user":\s*sql = "UPDATE app_user SET is_active=1, sort_order=NULL WHERE user_id=@k"/.test(rt),
      '휴지통 복구(RestoreTrashAsync 의 user 갈래)가 sort_order 를 비우지 않는다 — 복구 경로가 두 개인데 ' +
      '한쪽만 비우면 그쪽으로 돌아온 사람이 §7-1a 를 그대로 재현한다(R3)');
    //  (a) 전량 재작성 — 받은 순서대로 10·20·30…. 이제 N 번의 UPDATE 가 아니라 CASE 한 문장이다.
    assert.ok(/UPDATE app_user SET sort_order = CASE user_id /.test(so),
      '순서 저장이 받은 순서대로 sort_order 를 전량 재작성하지 않는다(측정 불가 ≠ 통과)');
    assert.ok(/WHEN " \+ keyPn\[i\] \+ " THEN "/.test(so) || /"WHEN " \+ keyPn\[i\]/.test(so),
      '재작성의 WHEN 갈래가 파라미터로 묶이지 않는다 — 값은 언제나 @파라미터 바인딩이다(규약 ①)');
    //  (b) 이 함수는 목록 **밖**을 아예 건드리지 않는다(2026-09-11 R3). 비우기 갈래가 여기 남아 있으면
    //      '판정과 재작성 사이에 남이 복구한 사람' 이 is_active=0 조건을 빠져나가 옛 숫자를 지킨다 —
    //      그게 R3 이 찾아낸 구멍이다. 비우는 일은 위 (0) 의 복구 두 자리가 진다.
    assert.ok(!/is_active=0/.test(so),
      '순서 저장이 아직도 목록 밖의 서열을 비운다(is_active=0) — 비우기의 자리는 저장이 아니라 ' +
      '**복구**다(R3). 여기 두면 저장 사이에 복구된 사람이 그 갈래를 빠져나간다.');
    //  (b-2) 그 한 문장에는 **WHERE 가 있어야 한다**(2026-09-11 적대 검토 R2). 없으면 문장의 대상은
    //      app_user **전 행**이다 — 한 사람의 순서 저장이 표 전체에 X 잠금을 걸고, 드라이버가 돌려주는
    //      영향 행 수도 표 크기가 된다. 쓸 자리는 하나뿐이다: 받은 목록 안(재작성).
    assert.ok(/END WHERE user_id IN \(" \+ inList \+ "\)/.test(so),
      '순서 저장의 한 문장에 WHERE 가 없다(또는 받은 목록 밖까지 넓다) — app_user 전 행이 UPDATE 대상이 되어 ' +
      '전원에 X 잠금이 걸린다(R2)');
    //  (b-3) 그 문장이 **몇 행에 닿았는지**는 남긴다(2026-09-11 R3). WHERE 가 받은 PK 로 좁혀진 지금,
    //      이 수는 표 크기가 아니라 '받은 목록 중 실제로 있는 사람 수' 다 — 대상 수와 다르면 뜻이 하나다:
    //      목록에 **이미 없는 id** 가 섞여 있었다. 낡은 명부 거부(①)는 '목록 밖 활성' 만 보므로 그 경우를
    //      못 잡는다. 로그의 이 한 줄이 유일한 단서다.
    assert.ok(/int matched;/.test(so) && /matched = await cmd\.ExecuteNonQueryAsync/.test(so),
      '재작성 문장의 일치 행 수를 받지 않는다 — 지워진 id 가 섞인 목록을 나중에 진단할 길이 없다(R3)');
    assert.ok(/일치 행 " \+ matched \+ " \/ 대상 " \+ kept\.Count/.test(so),
      "로그가 '일치 행 N / 대상 M' 으로 두 수를 함께 말하지 않는다 — 하나만으로는 어긋남이 안 보인다(R3)");
    //      그리고 로그는 '바뀐 행' 을 주장하지 않는다 — MySqlConnector 가 주는 수는 **조건에 맞은 행**이다.
    assert.ok(!/바뀐 행/.test(so),
      "순서 저장 로그가 '바뀐 행' 을 주장한다 — 드라이버가 주는 수는 맞은 행(CLIENT_FOUND_ROWS)이라 거짓말이다(R2)");
    //  (c) 낡은 명부 거부 — 목록 밖에 활성이 하나라도 있으면 저장을 통째로 거부한다.
    //      세는 문장은 **잠근 채**(FOR UPDATE)여야 판정과 갱신 사이에 새 사람이 끼어들지 못한다.
    assert.ok(/SELECT COUNT\(\*\) FROM app_user WHERE is_active=1 AND user_id NOT IN \(/.test(so),
      '목록 밖 **활성** 직원을 세지 않는다 — 낡은 명부로 저장해도 그대로 진행돼 그 사람의 서열이 사라진다(R1)');
    assert.ok(/FOR UPDATE/.test(so),
      '목록 밖 활성 직원을 잠그지 않고 센다 — 판정과 갱신 사이에 등록된 사람이 그 틈으로 빠진다(§4.4)');
    assert.ok(/StaleRosterMsg/.test(so),
      '낡은 명부를 거부하는 문장(StaleRosterMsg)이 없다 — 사용자가 무엇을 해야 하는지 알 수 없다');
    assert.ok(/const string StaleRosterMsg\s*=\s*"명부가 바뀌었습니다 — 새로고침한 뒤 다시 저장하세요\."/.test(cs),
      '낡은 명부 거부 문구 상수가 설계와 다르다 — 할 일(새로고침 뒤 재저장)을 말해 주는 한 문장이어야 한다');
    //      거부 판정은 **쓰기보다 앞**이어야 한다. 뒤면 이미 갈아엎은 뒤에 거부하는 셈이다.
    const count = so.indexOf('SELECT COUNT(*) FROM app_user WHERE is_active=1');
    const write = so.indexOf('UPDATE app_user SET sort_order = CASE user_id');
    const commit = so.indexOf('CommitAsync');
    assert.ok(count >= 0 && write > count && commit > write,
      '낡은 명부 판정이 재작성보다 뒤이거나 커밋 뒤에 있다 — 한 트랜잭션 안에서 판정 → 재작성 → 커밋 순이어야 한다');
    //  (d) 받은 목록이 통째로 쓸모없으면(전부 0 이하) **어떤 문장을 내기도 전에** 거부한다.
    //      안 그러면 NOT IN () 가 전원을 목록 밖으로 만든다.
    assert.ok(/kept\.Count == 0/.test(so) && /정렬할 명부가 비어 있습니다/.test(so),
      '목록이 통째로 비었을 때 거부하지 않는다 — 전원의 서열을 지우는 사고가 남는다');
    const refuse = so.indexOf('kept.Count == 0');
    assert.ok(refuse >= 0 && refuse < count,
      '빈 목록 거부가 첫 SQL 보다 뒤에 있다 — 거부 전에 이미 문장이 나간다');
    //  (e) updated_at 은 손대지 않는다(§4.5 — 서버 ON UPDATE 의 몫).
    assert.ok(!/updated_at/.test(so),
      '순서 저장이 updated_at 을 직접 쓴다 — 이 표의 감사 시각은 서버 ON UPDATE 가 정한다(§4.5)');
  },

  // ⑭-h 갱신된 명부는 **회신을 타고** 온다 — 푸시는 인자 하나짜리 '남의 갱신' 뿐이다(2026-09-14).
  //    옛 판(R3-H2)은 그 푸시에 reqId 를 실어 "이게 내 쓰기의 결과인가"를 웹이 가리게 했다. 그 인자가
  //    필요했던 이유는 하나다 — 결과(__userSaved)도 갱신(__applyMembers)도 **푸시**라서 배관이 짝을
  //    지어 주지 않았기 때문이다. 그래서 웹은 배관이 이미 보장하는 상관관계를 손으로 한 벌 더 지어야
  //    했다(__uaReq · __ueTok · __ueTokSeq · 워치독 · await/빚). 다섯 쓰기를 hostRequest/ReplyOnUi 위로
  //    옮기면서 그 복제를 통째로 지웠다: **내 것은 회신을 타고 오고, 푸시는 언제나 남의 갱신이다.**
  //    그러니 푸시에 reqId 가 다시 붙으면 그 낡은 짝짓기를 다시 지을 근거가 생긴다 — 인자는 하나여야 한다.
  membersRideInReply(mainCs) {
    const code = stripCs(mainCs);
    //  (a) 옛 푸시 배관이 코드에 남아 있으면 안 된다(주석의 회고는 코드가 아니므로 지우고 본다).
    assert.ok(!/__userSaved/.test(code),
      '호스트에 아직 __userSaved 푸시가 남아 있다 — 쓰기 결과는 회신(ReplyOnUi)으로만 간다(2026-09-14)');
    //  (b) 세 쓰기의 회신이 {ok, msg, roster} 한 벌이다 — 결과와 명부가 같은 시점의 것이어야
    //      웹이 뒤따르는 푸시를 기다리지 않는다(그 기다림이 있었기 때문에 워치독이 필요했다).
    for (const fn of ['SaveUserAsync', 'SetUserActiveAsync', 'SaveUserOrderAsync']) {
      const b = csMember(mainCs, 'private async Task ' + fn + '(');
      assert.ok(/ReplyOnUi\(reqId, new \{ ok, msg, roster \}\);/.test(b),
        `${fn} 의 회신이 {ok, msg, roster} 가 아니다 — 결과와 갱신 명부가 한 회신으로 가야 한다(2026-09-14)`);
      assert.ok(/await ReadMembersJsonAsync\(includeInactive\)/.test(b),
        `${fn} 이 회신에 실을 명부를 읽지 않는다 — roster 가 늘 "" 면 화면은 영영 낡은 채다`);
    }
    //  (c) 회신에 실을 명부는 「구성원 편집」의 순서(전사 서열)로 읽는다 — 옛 푸시와 같은 한 자리에서.
    const rd = csMember(mainCs, 'private async Task<string> ReadMembersJsonAsync(');
    assert.ok(/LoadMembersJsonAsync\(s\.LoginId, includeInactive, flatOrder: true\)/.test(rd),
      '회신용 명부가 flat(전사 서열)이 아니다 — 저장 직후 편집 화면이 소속 순으로 튄다');
    assert.ok(/return "";/.test(rd),
      '재조회에 실패했을 때 ""를 돌려주지 않는다 — 빈 명부를 실어 보내면 저장 성공 직후 화면이 통째로 빈다');
    //  (d) 남은 푸시(__applyMembers)는 **인자 하나**다. 그 자리는 휴지통에서 인력을 건드린 뒤의 갱신 하나뿐이고,
    //      그 화면은 요청을 보낸 적이 없어 회신으로 닿을 수 없다 — 그래서 푸시로 남는다.
    const fn = csMember(mainCs, 'private async Task LoadMembersToWebAsync(');
    assert.ok(/private async Task LoadMembersToWebAsync\(bool includeInactive\)/.test(fn),
      'LoadMembersToWebAsync 가 아직 reqId 를 받는다 — 푸시는 더 이상 누구의 것도 아니다(2026-09-14)');
    assert.ok(/window\.__applyMembers\(" \+ JsonSerializer\.Serialize\(json\) \+ "\)"\);/.test(fn),
      '__applyMembers 푸시가 인자 하나(json)가 아니다 — 두 번째 인자가 붙으면 웹이 옛 짝짓기를 다시 짓는다(2026-09-14)');
  },

  // ⑭-h2 순서 저장의 회신이 명부를 싣는 경우는 **둘뿐**이다(2026-09-11 적대 검토 R3-H2 · 전송은 2026-09-14).
  //    R2-H2 는 '실패해도 무조건 민다' 로 거부 루프를 닫았는데, 그게 너무 넓었다 — 권한·연결·DB 실패처럼
  //    **명부가 바뀌지 않은** 실패까지 실으면 화면은 같은 명부를 한 번 더 그릴 뿐이다.
  //    실어야 하는 것은 "지금 화면의 명부를 갈아 끼워야 한다" 는 둘 — 성공(ok) · 낡은 명부(StaleRosterMsg).
  //    ★ 그 **조건**은 옛 푸시의 조건과 한 글자도 다르지 않다. 2026-09-14 에 바뀐 것은 전송 방식뿐이다
  //      (푸시 __applyMembers → 회신의 roster). 조건이 함께 움직이면 그건 전송 변경이 아니라 동작 변경이다.
  //    ★ 문장 대조의 정본은 ProjectDb.StaleRosterMsg 한 줄이다. 브리지가 그 상수를 **직접** 봐야 한다 —
  //      같은 문장을 여기 한 벌 더 적으면 한쪽만 고쳐지는 순간 명부가 조용히 멈춘다.
  orderRosterPolicy(mainCs, pdbCs) {
    assert.ok(/internal const string StaleRosterMsg/.test(pdbCs),
      'StaleRosterMsg 가 internal 이 아니다 — 브리지가 그 상수를 못 보면 문장을 한 벌 더 적게 되고 둘이 갈린다(R3-H2)');
    const b = csMember(mainCs, 'private async Task SaveUserOrderAsync(');
    assert.ok(/string roster = ok \|\| string\.Equals\(msg, ProjectDb\.StaleRosterMsg, StringComparison\.Ordinal\)/.test(b),
      '순서 저장의 명부가 "성공 또는 낡은 명부" 로 좁혀져 있지 않다 — 무조건 실으면 명부가 바뀌지도 ' +
      '않은 실패(권한·연결·DB)까지 화면을 다시 그리고, 성공 때만 실으면 거부 루프가 돌아온다(R3-H2)');
    assert.ok(!/"명부가 바뀌었습니다/.test(b),
      '브리지가 낡은 명부 문구를 제 손으로 적는다 — 정본은 ProjectDb.StaleRosterMsg 한 줄이어야 한다(R3-H2)');
    assert.ok(/\? await ReadMembersJsonAsync\(includeInactive\) : "";/.test(b),
      '그 둘에 해당해도 명부를 읽지 않는다(또는 나머지 갈래에서 ""를 싣지 않는다) — 거부 루프가 돌아온다');
  },

  // ⑭-h3 퇴사/복구의 회신이 명부를 싣는 경우도 **둘**이다(2026-09-11 적대 검토 R5 · 전송은 2026-09-14).
  //    복구의 거부 문구(AlreadyActiveMsg — "이미 복구된 항목입니다 — 목록을 새로고침합니다.")는 정확히
  //    **실패**로 나오면서 새로고침을 약속한다. 옛 판의 브리지는 `if (ok)` 였으므로 그 약속은 한 번도
  //    지켜지지 않았다 — 관리자는 그 문장을 읽으면서 **바뀐 것이 없는 낡은 명부**를 보고 같은 [복구] 를
  //    다시 눌러 같은 거부만 반복했다(휴지통이 TRASH-DELETE §11-23 에서 닫은 것과 같은 구멍이다).
  //    실어야 하는 것은 "지금 화면의 명부를 갈아 끼워야 한다" 는 둘 — 성공(ok) · 이미 복구됨.
  //    나머지 실패(권한·연결·DB·자기 퇴사·마지막 관리자)는 명부가 바뀌지 않았으므로 싣지 않는다.
  //    ★ 그 **조건**은 옛 푸시의 조건 그대로다 — 2026-09-14 에 바뀐 것은 전송 방식뿐이다(⑭-h2 와 같은 규율).
  //      그리고 그 회신에는 표식(reqId)이 배관에서 이미 붙는다 — R6 이 푸시에 손으로 붙여야 했던 것이,
  //      왕복으로 옮기자 배관의 보장이 됐다. 열려 있는 편집 폼을 다시 맞추는 것은 그 회신을 받은 웹의 몫이다.
  activeRosterPolicy(mainCs, pdbCs) {
    //  이름이 먼저다 — 휴지통 이름을 달고 있으면 아래 internal 검사는 '선언이 없다'로 잘못 운다.
    assert.ok(!/Trash\w*AlreadyActiveMsg/.test(pdbCs),
      '그 상수가 아직 휴지통 이름을 달고 있다 — 명부 복구도 같이 쓰는 문장이다(이름이 자리를 거짓말한다 · R5)');
    assert.ok(/internal const string AlreadyActiveMsg/.test(pdbCs),
      'AlreadyActiveMsg 가 internal 이 아니다 — 브리지가 그 상수를 못 보면 문장을 한 벌 더 적게 되고 둘이 갈린다(R5)');
    const b = csMember(mainCs, 'private async Task SetUserActiveAsync(');
    assert.ok(/string roster = ok \|\| string\.Equals\(msg, ProjectDb\.AlreadyActiveMsg, StringComparison\.Ordinal\)/.test(b),
      '퇴사/복구의 명부가 "성공 또는 이미 복구됨" 으로 돼 있지 않다 — 성공에만 실으면 "목록을 새로고침합니다" ' +
      '가 거짓말이 되고, 무조건 실으면 명부가 바뀌지도 않은 실패까지 화면을 다시 그린다(R5)');
    assert.ok(!/"이미 복구된 항목입니다/.test(b),
      '브리지가 이미 복구됨 문구를 제 손으로 적는다 — 정본은 ProjectDb.AlreadyActiveMsg 한 줄이어야 한다(R5)');
    assert.ok(/\? await ReadMembersJsonAsync\(includeInactive\) : "";/.test(b),
      '그 둘에 해당해도 명부를 읽지 않는다(또는 나머지 갈래에서 ""를 싣지 않는다) — 거부 루프가 돌아온다(R5)');
    //  ★ 회신은 그 요청의 reqId 로 돌아간다 — 옛 판이 푸시에 손으로 붙이던 표식(R6)을 배관이 보장한다.
    assert.ok(/ReplyOnUi\(reqId, new \{ ok, msg, roster \}\);/.test(b),
      '퇴사/복구가 명부를 회신에 싣지 않는다 — 표식 없는 푸시로 되돌아가면 열려 있는 편집 폼을 ' +
      '갱신된 명부로 다시 맞출 근거가 사라진다(R6)');
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
    //  ★ 되돌릴 화살표는 **방향**이 정한다(2026-09-11). 예전에는 포커스를 쥔 요소를 읽어 같은 답을
    //    더 먼 길로 구했다 — 그 길은 '그 버튼이 정말 이 행의 것인가'를 한 번 더 따지느라 길기만 했다.
    assert.ok(/const uop = delta < 0 \? 'up' : 'down';/.test(b),
      'uaMove 가 방향으로 화살표를 정하지 않는다 — 어디로 포커스를 되돌릴지 두 갈래로 갈린다');
    assert.ok(/uaFocusMoved\(/.test(b),
      'uaMove 가 포커스를 되돌리지 않는다 — 한 번 누르면 포커스가 사라져 두 번째를 누를 수 없다');
    const f = extractFunction(web, 'uaFocusMoved');
    assert.ok(/data-uop/.test(f) && /data-uid/.test(f),
      'uaFocusMoved 가 data-uop/data-uid 손잡이로 버튼을 찾지 않는다 — 이름으로 찾으면 동명이인에서 갈린다');
    assert.ok(/disabled/.test(f) && /'down' : 'up'/.test(f),
      'uaFocusMoved 가 꺼진 화살표일 때 반대쪽을 잡지 않는다 — 끝(맨 위·맨 아래)에 닿는 순간 포커스가 사라진다');
    assert.ok(/scrollIntoView/.test(f), 'uaFocusMoved 가 옮긴 행을 보이는 자리로 끌어오지 않는다');
    //  ★ 2026-09-11(R5-W3)부터 **uaRender 도 같은 자리를 지킨다** — ▲▼ 말고도 목록을 다시 그리는 길이
    //    여럿이기 때문이다(잠금·호스트 푸시). 여기 한 줄은 그것과 같은 값을 앉히므로 다투지 않는다.
    //    ㆍ포커스는 **마지막에** uaFocusMoved 가 정한다 — 렌더가 앉힌 자리를 옮긴 행이 덮어써야 한다.
    assert.ok(b.indexOf('uaFocusMoved(') > b.indexOf('uaApply()'),
      'uaMove 가 다시 그리기 **전에** 포커스를 정한다 — 그 뒤의 렌더가 그 자리를 덮어쓴다');
  },

  // ⑬-b 목록을 **다시 그리는 쪽**이 보던 자리와 포커스를 지킨다(2026-09-11 적대 검토 R5-W3).
  //     uaMove 만 제 손으로 지키던 옛 판은, 저장 한 번에 여러 번 도는 다른 렌더(uaSetSaving 의 잠금 ·
  //     호스트 푸시)에서 그대로 맨 위로 튀었다 — 80번째 사람을 저장하면 다음 사람을 다시 찾아야 했다.
  renderKeepsPlace(web) {
    const r = extractFunction(web, 'uaRender');
    assert.ok(/const keepScroll = list\.scrollTop;/.test(r) && /list\.scrollTop = sameView \? keepScroll : 0;/.test(r),
      'uaRender 가 스크롤 자리를 찍어 두고 되돌리지 않는다 — 다시 그릴 때마다 목록이 맨 위로 튄다(R5-W3)');
    //  ★ 되돌리는 것은 **같은 화면일 때만**이다 — 순서 편집을 켜거나 「퇴사자 보기」를 뒤집으면 목록의
    //    내용이 통째로 달라진다(trRender 의 sameView 와 같은 규칙).
    assert.ok(/const sameView = !!__uaShown && __uaShown\.order === view\.order && __uaShown\.inactive === view\.inactive/.test(r),
      "uaRender 가 '지금 그리는 것이 직전과 같은 화면인가'를 재지 않는다 — 순서 편집을 켜도 옛 스크롤 자리가 그대로 앉는다(R5-W3)");
    //  ★ 그 열쇠에는 **검색어와 관리자 여부**도 든다(2026-09-11 적대 검토 R6-W1). 검색은 목록을 통째로
    //    갈아치우는데 옛 열쇠는 순서 편집·퇴사자 보기 둘뿐이라 '같은 화면'으로 읽혔다 — 89행을 내려다
    //    보던 중에 검색어를 치면 걸러진 결과가 목록 한가운데에서 열렸다.
    assert.ok(/q: qv \? String\(qv\.value \|\| ''\)\.trim\(\)\.toLowerCase\(\) : ''/.test(r),
      'uaRender 의 화면 열쇠에 검색어가 없다 — 검색으로 목록이 통째로 갈려도 옛 스크롤 자리가 앉는다(R6-W1)');
    assert.ok(/__uaShown\.q === view\.q/.test(r),
      "uaRender 가 검색어를 열쇠에 **담기만 하고 대조하지 않는다** — 담아 두는 것만으로는 '같은 화면'이 갈리지 않는다(R6-W1)");
    assert.ok(/admin: __uaAdmin/.test(r) && /__uaShown\.admin === view\.admin/.test(r),
      'uaRender 의 화면 열쇠에 관리자 여부가 없다 — 관리자에서 내려갔다 올라오면 목록이 통째로 새로 서는데 옛 자리가 앉는다(R6-W1)');
    //  ★ 거르는 규칙(uaVisible)과 **같은 정규화**여야 한다 — 한쪽만 trim·소문자를 하면 같은 목록이
    //    다른 열쇠를 내고, 앞뒤 공백만 친 재렌더가 맨 위로 튄다.
    assert.ok(/String\(q\.value \|\| ''\)\.trim\(\)\.toLowerCase\(\)/.test(extractFunction(web, 'uaVisible')),
      '전제 붕괴: uaVisible 의 검색어 정규화가 바뀌었다 — 열쇠의 정규화를 맞댈 기준이 사라졌다');
    assert.ok((r.match(/__uaShown = view;/g) || []).length >= 2,
      'uaRender 가 그린 화면(__uaShown)을 갈래마다 남기지 않는다 — 안내 한 줄뿐인 화면에서 빠져나오면 판정이 낡는다');
    //  ★ 포커스도 같은 규칙이다: 잠금이 걸린 렌더는 행 버튼을 전부 끄므로 되돌릴 곳이 없다 — 그때는
    //    **그 행**으로 물러났다가, 잠금이 풀리면 맡아 둔 표(__uaKeepBtn)로 그 버튼에 돌아온다.
    assert.ok(/let keepBtn = \(af && list\.contains\(af\) && af\.dataset && af\.dataset\.uop && af\.dataset\.uid\)/.test(r),
      'uaRender 가 포커스를 쥔 행 버튼을 data-uop·data-uid 로 찍어 두지 않는다(또는 목록 밖 버튼까지 센다 — 편집 폼의 포커스를 목록이 빼앗는다)');
    assert.ok(/line\.dataset\.uid = String\(Number\(m && m\.userId != null \? m\.userId : 0\)\);/.test(r),
      '행(.mba-line)에 data-uid 가 없다 — 물러난 포커스가 어느 행인지 다음 렌더가 알 길이 없다');
    assert.ok(/line\.tabIndex = -1;/.test(r),
      '행(.mba-line)이 포커스를 받을 수 없다 — 꺼진 버튼에서 물러설 자리가 없어 포커스가 body 로 떨어진다');
    assert.ok(/if\(ub && !ub\.disabled\)/.test(r),
      'uaRender 가 꺼진 버튼에도 포커스를 준다 — 브라우저가 그 포커스를 body 로 떨어뜨려 결국 같은 문제로 돌아온다');
    assert.ok(/if\(__uaSaving\) __uaKeepBtn = keepBtn;/.test(r),
      '잠금 동안 되돌릴 버튼을 맡아 두지 않는다 — 잠금이 풀려도 포커스가 행에 남아 다음 사람을 이어서 못 누른다');
    assert.ok(/String\(af\.dataset\.uid \|\| ''\) === __uaKeepBtn\.uid/.test(r),
      '맡아 둔 표를 되돌릴 때 **그 행인지** 대조하지 않는다 — 관리자가 잠금 중에 옮겨 둔 포커스를 엉뚱한 행으로 끌고 간다');
    assert.ok(/if\(!restored && sameView && keepUid\)\{/.test(r) && /String\(ln\.dataset\.uid \|\| ''\) === keepUid/.test(r),
      '행에 머물던 포커스를 그 행으로 되돌리지 않는다 — 되돌릴 버튼이 없으면 포커스가 body 로 떨어진다');
    assert.ok(!/line\.dataset\.uop/.test(r),
      "행에 data-uop 을 달았다 — 버튼을 찾는 셀렉터('[data-uop][data-uid]')에 행이 끼어든다");
  },

  // ⑦-e2 갱신 명부가 앉으면 **열려 있는 편집 폼**의 퇴사/복구 상태도 그 명부에 맞춘다(R6-W3).
  //      #userEdActive 의 문구·data-uop 은 userEdOpen 이 폼을 **열 때 한 번** 정한다. 그래서 "이미 복구된
  //      항목입니다 — 목록을 새로고침합니다."(AlreadyActiveMsg) 로 거부당한 뒤 호스트가 약속대로 갱신
  //      명부를 밀어도(§11-32), 폼은 이미 재직 중인 사람에게 여전히 [복구]를 내줬다 — 다시 누르면 같은
  //      거부만 되풀이된다(§11-32 가 닫았다고 적은 그 고리다).
  //      ★ 2026-09-14 — 갱신 명부가 오는 길이 **둘**이다: 내 쓰기의 회신에 실려서(uaSeatRoster) ·
  //        부탁하지 않은 푸시로(__applyMembers). 왕복이 됐다고 이 계약이 사라지지 않는다 — 「이미 복구됨」
  //        거부는 폼을 **열어 둔 채** 갱신 명부를 실어 보내므로, 그 자리에서 폼을 다시 맞추지 않으면
  //        관리자는 낡은 [복구]를 다시 눌러 같은 거부를 되풀이한다. 그래서 userEdSyncActive 는 살아 있고,
  //        **두 길 모두** 그것을 부른다.
  formResyncsOnPush(web) {
    const seat = extractFunction(web, 'uaSeatRoster').replace(/\/\/[^\n]*/g, '');
    assert.ok(/uaApplyData\(d\);\s*\n\s*userEdSyncActive\(\);/.test(seat),
      '회신에 실려 온 명부를 앉히면서 열려 있는 편집 폼을 다시 맞추지 않는다 — 「이미 복구됨」 거부 뒤 낡은 [복구] 를 다시 눌러 같은 거부가 되풀이된다(R6-W3)');
    const ap = windowFn(web, '__applyMembers').replace(/\/\/[^\n]*/g, '');
    assert.ok(/uaApplyData\(d\);\s*\n\s*userEdSyncActive\(\);/.test(ap),
      '부탁하지 않은 명부 푸시가 앉으면서 열려 있는 편집 폼을 다시 맞추지 않는다 — 남이 그 사람을 복구해도 폼은 낡은 [복구]를 계속 내준다(R6-W3)');
    const f = extractFunction(web, 'userEdSyncActive');
    assert.ok(/isOverlayOpen\(ed\)/.test(f),
      "userEdSyncActive 가 '폼이 열려 있는가'를 공용 판정(isOverlayOpen)으로 보지 않는다 — 닫히는 중인 폼까지 칠한다");
    assert.ok(/if\(!__ueId\) return;/.test(f),
      '신규 등록(uid 0)에서도 맞추려 든다 — 명부에 없는 대상을 찾다 엉뚱한 문구가 뜬다');
    assert.ok(/__uaMembers\.find\(x => x && Number\(x\.userId\) === Number\(__ueId\)\)/.test(f),
      'userEdSyncActive 가 새 명부에서 그 사람을 찾지 않는다 — 무엇에 맞출지가 없다');
    //  ★ 규칙은 userEdOpen 과 **글자 그대로** 같아야 한다 — 갈리면 '열었을 때'와 '푸시가 왔을 때'가 다른 말을 한다.
    const o = extractFunction(web, 'userEdOpen');
    for (const line of ["const off = !(m && m.isActive === false);",
      "ab.textContent = off ? '퇴사 처리' : '복구';",
      "ab.classList.toggle('danger', off);",
      "ab.dataset.uop = off ? 'off' : 'on';"]) {
      assert.ok(o.includes(line), `전제 붕괴: userEdOpen 에 «${line}» 이 없다 — 맞댈 정본이 사라졌다`);
      assert.ok(f.includes(line), `userEdSyncActive 가 userEdOpen 과 다른 규칙을 쓴다: «${line}» — 두 곳이 갈리면 한쪽이 반드시 낡는다(R6-W3)`);
    }
    assert.ok(/getElementById\('userEdSort'\)/.test(f) && /sortOrder/.test(f),
      '푸시가 와도 서열 번호(#userEdSort)는 낡은 채로 남는다 — 남이 순서를 저장하면 그 숫자가 바뀐다(R6-W3)');
    //  ★ 관리자가 **고치던 칸**은 건드리지 않는다 — 남의 쓰기가 내 편집을 조용히 지우면 안 된다.
    for (const id of ['userEdLogin', 'userEdName', 'userEdTitle', 'userEdOrg', 'userEdScope', 'userEdRole']) {
      assert.ok(!new RegExp(id).test(f),
        `userEdSyncActive 가 ${id} 를 손댄다 — 저장하지 않은 편집이 남의 푸시 한 번에 사라진다(R6-W3)`);
    }
    //  ★ 대상이 사라졌으면 **닫지 않고** 말한다 — 닫으면 적어 둔 편집이 통째로 사라지고 이유도 남지 않는다.
    assert.ok(!/closeModal|closeOverlay/.test(f),
      'userEdSyncActive 가 폼을 닫는다 — 명부에서 사라진 대상이라도 적어 둔 편집을 말없이 버리면 안 된다(R6-W3)');
    assert.ok(/userEdMsgSet\(/.test(f) && /대상 직원을 찾을 수 없습니다/.test(f),
      '대상이 새 명부에 없을 때 폼이 아무 말도 하지 않는다 — 관리자는 왜 저장이 실패할지 모른 채 [저장]을 누른다(R6-W3)');
  },

  // ⑭ 회신은 **그 요청을 보낸 클로저**로 돌아온다(2026-09-14 · 손으로 만든 상관관계 걷어내기 1단계).
  //    예전에는 공용 회신함(window.__userSaved)이 세 쓰기의 결과를 한 자리에서 받아, '이 회신이 어느
  //    요청·어느 폼의 것인가'를 모듈 전역의 요청 표(__uaReq: id·uid·cmd·tok·done)와 폼 표(__ueTok)로
  //    되짚었다. 그 표들이 하던 일을 지금은 **언어가** 한다: hostRequest 의 Promise 는 자기 호출자에게
  //    한 번만 풀리므로, A 의 늦은 회신이 B 의 폼에 닿을 길 자체가 없다.
  //    ★ 그래서 여기서 보는 것은 '표가 맞는가'가 아니라 **표가 없는가**, 그리고 회신을 부르는 쪽이
  //      처리하는가 — 그 둘이다. 표를 하나라도 되살리면 두 규약이 공존하고, 둘 중 하나는 반드시 낡는다.
  //    ★ 워치독도 함께 사라져야 한다(단순한 정리가 아니다): 옛 R2-W1 버그가 가능했던 **전제**가 바로
  //      "워치독이 12초에 잠금을 풀어 준다" 였다. 잠금이 왕복 내내 유지되면 다른 폼으로 가는 길
  //      ([편집]·[＋ 직원 등록]·폼 닫기)이 전부 막혀, 둘째 폼이 아예 열리지 않는다.
  replyGoesToItsCaller(web) {
    const s = extractFunction(web, 'uaSend');
    assert.ok(/^async function uaSend\(payload\)\{/m.test(web),
      'uaSend 가 async 가 아니다 — 회신을 부르는 쪽에 돌려줄 수 없다(공용 회신함으로 되돌아간 것이다)');
    assert.ok(/await hostRequest\(cmd, Object\.assign\(\{ includeInactive: __uaInactive \}, payload\), 20000\)/.test(s),
      'uaSend 가 hostRequest 왕복(includeInactive 동봉 · 20초)으로 보내지 않는다 — 회신을 짝지을 수단이 다시 손으로 만든 표가 된다');
    assert.ok(/if\(__uaSaving\) return null;/.test(s),
      'uaSend 에 중복 전송 가드가 없다(또는 못 보냈음을 null 로 말하지 않는다) — 두 왕복이 겹치면 잠금 하나로 둘을 풀게 되고, 그 틈에서 회신이 다시 짝을 잃는다');
    assert.ok(/const rep = \{ ok: [^\n]*roster: /.test(s) && /return rep;/.test(s),
      'uaSend 가 { ok, msg, roster } 를 돌려주지 않는다 — 부르는 쪽이 판단할 재료가 없다');
    //  ★ 손으로 만든 상관관계가 **하나도 남아 있지 않아야** 한다(주석은 빼고 본다 — 왜 없앴는지를 적어 둔
    //    문장이 계약을 깨뜨리면 안 된다).
    const bare = web.replace(/\/\/[^\n]*/g, '');
    for (const dead of ['__uaReq', '__ueTok', '__ueTokSeq', '__uaSaveWatchdog', '__uaAwaitPush',
      '__uaAwaitSeen', 'uaAwaitArm', 'uaAwaitStop', '__userSaved']) {
      assert.ok(!bare.includes(dead),
        `손으로 만든 상관관계 ${dead} 가 아직 살아 있다 — 왕복이 이미 짝을 지어 주는데 표를 또 들고 다니면 둘 중 하나는 반드시 낡는다`);
    }
    //  ★ 폼에서 나간 두 쓰기는 **그 폼의 클로저에서** 회신을 처리한다.
    const save = extractFunction(web, 'userEdSaveNow');
    assert.ok(/^async function userEdSaveNow\(\)\{/m.test(web),
      'userEdSaveNow 가 async 가 아니다 — 자기 왕복의 회신을 자기 자리에서 받을 수 없다');
    assert.ok(/const r = await uaSend\(payload\);/.test(save) && /if\(r\) userEdAfterWrite\(r\);/.test(save),
      '[저장]이 자기 왕복의 회신을 받아 처리하지 않는다 — 결과가 다시 공용 회신함으로 흘러간다');
    const act = extractFunction(web, 'uaSetActive');
    assert.ok(/const rep = await uaSend\(\{ cmd: 'setUserActive'/.test(act) && /if\(rep\) userEdAfterWrite\(rep\);/.test(act),
      '[퇴사 처리]/[복구] 가 자기 왕복의 회신을 받아 처리하지 않는다');
    //  ★ 성공=폼 닫고 토스트 · 실패=폼 유지 + 호스트 문장 그대로(화면이 다시 쓰면 거부 사유가 뭉개진다).
    const aw = extractFunction(web, 'userEdAfterWrite');
    assert.ok(/closeModal\('#userEditModal'\);/.test(aw),
      '성공해도 폼을 닫지 않는다 — 저장한 폼이 그대로 서 있으면 관리자가 한 번 더 누른다');
    assert.ok(/userEdMsgSet\(ICON\.alert \+ ' ' \+ esc\(r\.msg \|\| '저장하지 못했습니다\.'\), 'err'\);/.test(aw),
      '실패 사유를 호스트 문장 그대로 폼에 띄우지 않는다 — 다시 쓰면 "관리자만 고칠 수 있다"가 "저장 실패"로 뭉개진다');
    const okAt = aw.indexOf("closeModal('#userEditModal')");
    const errAt = aw.indexOf("'err'");
    assert.ok(okAt >= 0 && errAt > okAt,
      '전제 붕괴: userEdAfterWrite 의 성공·실패 갈래를 찾지 못했다(판정 불가)');
    assert.ok(!/closeModal/.test(aw.slice(errAt)),
      '실패 갈래에서도 폼을 닫는다 — 관리자가 무엇을 고쳐야 하는지 읽을 자리가 사라진다');
    //  ★ 2026-09-14(좌석 일원화) — 명부를 앉히는 것은 **여기가 아니다**. 회신의 명부는 uaSend 가 그 자리에서
    //    uaSeatReply 로 들여보낸다(계약⑭-e). 뒤처리가 자기 몫으로 한 번 더 앉히면 앉히는 자리가 둘이 되고,
    //    그 둘은 '순서 편집 중이면 미뤄 둔다'를 각자 판단하게 된다 — 한쪽은 반드시 빠진다.
    assert.ok(!/uaSeatRoster\(/.test(aw) && !/uaSeatReply\(/.test(aw),
      'userEdAfterWrite 가 명부를 스스로 앉힌다 — 앉히는 자리가 둘이면 순서 편집 중 미뤄 두기가 한쪽에서만 지켜진다(좌석 일원화가 깨진다)');
    //  ★ 잠금은 왕복 **내내** 유지된다 — 이것이 지금 '늦은 회신이 남의 폼을 닫지 않는다'를 지탱하는 유일한 보증이다.
    const ss = extractFunction(web, 'uaSetSaving');
    assert.ok(/dataset\.busy = '1'/.test(ss) && /delete ov\.dataset\.busy/.test(ss),
      'uaSetSaving 이 #userEditModal 의 dataset.busy 를 세우고 지우지 않는다 — 저장 중에 창을 닫으면 결과를 알릴 곳이 사라진다');
    assert.ok(!/setTimeout/.test(ss),
      'uaSetSaving 에 워치독이 되살아났다 — 왕복 도중에 잠금을 푸는 두 번째 장치가 생기면 그 틈으로 다른 폼이 열리고, 짝지을 표가 없는 지금은 그때부터 회신이 아무 폼이나 닫는다(R2-W1 이 되돌아온다)');
    assert.ok(!/setTimeout/.test(extractFunction(web, 'trSetSaving')),
      'trSetSaving 에 워치독이 되살아났다 — 휴지통도 같은 이유로 왕복 내내 잠겨 있어야 한다');
  },

  // ⑭-e 회신에 실려 온 명부의 **좌석은 한 곳**이다(2026-09-14 · 왕복 전환이 열어 둔 구멍을 닫는다).
  //     1단계(왕복 전환)는 명부를 회신에 실어 보내면서 **앉히는 일은 부르는 쪽마다** 남겨 두었다.
  //     그 결과 실측된 것이 셋이다(루프 tests/loop-user-admin.mjs):
  //       · 폼을 거치지 않는 쓰기는 명부를 **아예 앉히지 못했다** → 화면 명부가 낡고(C06), 그 낡은 id 목록으로
  //         「순서 저장」을 눌러 호스트의 「명부가 바뀌었습니다」 거부를 받았다(C08).
  //       · 순서 편집 중에 온 **남의 갱신**이 회신에 실려 오면 그대로 앉아 편집 중인 순서를 덮었다(C20) —
  //         라운드 2·3 이 닫았던 결함이 '전달 방식이 바뀌었다'는 이유만으로 되살아난 자리다.
  //     ★ 그래서 규칙을 한 문에 모은다: **uaSeatReply** 가 '앉힐까 미룰까'를 정하고, uaSeatRoster 는
  //       두 길(회신·푸시)이 함께 쓰는 **앉히는 손**으로 남는다. 미뤄 두기는 '명부가 어느 길로 왔는가'가
  //       아니라 **'화면이 지금 무엇을 하고 있는가'** 의 문제다 — 그래서 회신에도 똑같이 걸린다.
  replySeatIsOnePlace(web) {
    const bare = web.replace(/\/\/[^\n]*/g, '');
    //  ① 앉히는 손(uaSeatRoster)을 부르는 곳은 **한 곳**뿐이다(선언 1 + uaSeatReply 안의 호출 1 = 2).
    const seats = bare.split('uaSeatRoster(').length - 1;
    assert.strictEqual(seats, 2,
      `회신 명부를 앉히는 자리가 ${seats - 1}곳이다(선언 말고 1곳이어야 한다) — 부르는 쪽마다 앉히면 쓰기를 ` +
      '하나 늘릴 때 그 한 줄을 빠뜨리는 것만으로 화면이 조용히 낡고, 그 낡은 명부가 「순서 저장」에서 되튄다(C06·C08)');
    //  ② 그 문의 규칙 — 순서 편집 중에 온 **내 순서 저장이 아닌** 명부는 미뤄 둔다(푸시와 같은 취급).
    const seat = extractFunction(web, 'uaSeatReply').replace(/\/\/[^\n]*/g, '');
    assert.ok(/if\(!json\) return false;/.test(seat),
      "uaSeatReply 가 '명부가 안 실려 왔다'를 먼저 가려내지 않는다 — 빈 문자열을 앉히려 들면 화면이 비거나 헛돈다");
    assert.ok(/if\(__uaOrder && cmd !== 'saveUserOrder'\)\{/.test(seat),
      "uaSeatReply 가 '순서 편집 중 · 내 순서 저장이 아닌 회신'을 가려내지 않는다 — 남의 갱신이 편집 중인 순서를 덮는다(C20)");
    assert.ok(/__uaPendingData = d;\s*\n\s*uaAdminBar\(\);\s*\n\s*return false;/.test(seat),
      '미뤄 두면서 막대를 다시 그리지 않는다(또는 미뤄 두고도 "앉혔다"고 답한다) — 관리자는 화면이 낡은 줄 모른 채 순서를 정한다');
    //  ★ 미뤄 둘지 말지는 **화면 상태**만 본다. '내 쓰기인가'를 다시 짐작하기 시작하면 걷어낸 요청 표가
    //    이름만 바꿔 되살아난다(그 짐작이 바로 R3-W1 의 자리였다).
    for (const dead of ['__uaSaving', 'reqId', '__uaReq']) {
      assert.ok(!seat.includes(dead),
        `uaSeatReply 가 ${dead} 를 본다 — 미뤄 두기는 '이 명부가 누구 것인가'가 아니라 '화면이 무엇을 하고 있는가'의 문제다`);
    }
    //  ③ 「순서 저장」의 회신만 예외다 — 그리고 **앉히기 전에** 편집 모드를 끝낸다(화면은 한 번에 최종형).
    const resetAt = seat.indexOf("if(cmd === 'saveUserOrder') uaOrderReset();");
    const seatAt = seat.indexOf('return uaSeatRoster(json);');
    assert.ok(resetAt >= 0,
      "uaSeatReply 가 「순서 저장」 회신에서 편집 모드를 끝내지 않는다 — ▲▼·[취소]·[순서 저장]이 끝난 편집 화면에 남는다");
    assert.ok(seatAt > resetAt,
      '편집 모드를 끄기 **전에** 명부를 앉힌다 — 순서 편집 화면을 한 번 그리고 최종형을 또 그려야 한다(한 번에 그려야 한다)');
    //  ④ 두 왕복이 같은 문을 지난다 — 그리고 **잠금을 푼 뒤**에 앉힌다(그리는 목록이 꺼진 버튼으로 서지 않게).
    const s = extractFunction(web, 'uaSend').replace(/\/\/[^\n]*/g, '');
    assert.ok(/rep\.painted = uaSeatReply\(rep\.roster, cmd\);/.test(s),
      'uaSend 가 회신의 명부를 그 자리에서 들여보내지 않는다 — 폼을 거치지 않는 쓰기가 명부를 영영 앉히지 못한다(C06·C08)');
    assert.ok(s.indexOf('uaSetSaving(false);') >= 0 && s.indexOf('uaSeatReply(') > s.indexOf('uaSetSaving(false);'),
      'uaSend 가 잠금을 풀기 전에 명부를 앉힌다 — 그때 그려지는 목록이 전부 꺼진 버튼으로 선다');
    const t = extractFunction(web, 'trSend').replace(/\/\/[^\n]*/g, '');
    assert.ok(/rep\.painted = uaSeatReply\(rep\.roster, cmd\);/.test(t),
      '휴지통 회신의 명부가 같은 문을 지나지 않는다 — 인력 복구·삭제가 순서 편집 중인 화면을 덮는다(규칙이 두 벌이 된다)');
    assert.ok(t.indexOf('trSetSaving(false);') >= 0 && t.indexOf('uaSeatReply(') > t.indexOf('trSetSaving(false);'),
      'trSend 가 잠금을 풀기 전에 명부를 앉힌다 — uaSend 와 다른 차례를 쓰면 한쪽만 낡는다');
    //  ⑤ 부르는 쪽은 앉히지 않는다(회신이 '앉았나'를 실어 오므로 되물을 것도 없다).
    for (const fn of ['uaOrderSave', 'userEdAfterWrite', 'trAfterWrite', 'uaSetActive', 'userEdSaveNow']) {
      const body = extractFunction(web, fn);
      assert.ok(!/uaSeatRoster\(|uaSeatReply\(/.test(body),
        `${fn} 이 회신의 명부를 스스로 앉힌다 — 좌석이 둘이면 '순서 편집 중이면 미뤄 둔다'가 한쪽에서만 지켜진다`);
    }
    assert.ok(/rep\.painted = /.test(s) && /let painted = r\.painted;/.test(extractFunction(web, 'uaOrderSave')),
      "회신이 '앉았나'를 실어 오지 않는다(또는 「순서 저장」이 그것을 안 받는다) — 되그릴지 말지를 판단할 근거가 사라진다(R4-W3)");
  },

  // ⑭-b 명부 쪽 잠금은 **렌더가 진다**(2026-09-11 적대 검토 R3-W2).
  //     노드를 걸어 다니며 끄면, 왕복 중에 도착한 명부 푸시가 목록을 새로 만드는 순간 잠금이 증발한다.
  //     ★ 폼 하단의 [저장]·[퇴사 처리]는 예외다 — 그 둘은 마크업에 박힌 붙박이라 다시 그려지지 않는다.
  lockIsDerivedAtRender(web) {
    const ra = extractFunction(web, 'uaRowActions');
    assert.ok(/b\.disabled = __uaSaving;/.test(ra),
      'uaRowActions 가 행 버튼을 그릴 때 __uaSaving 을 보지 않는다 — 재렌더가 잠금을 지운다');
    const bar = extractFunction(web, 'uaAdminBar');
    assert.ok(/mk\('순서 저장', 'uaOrderSave', 'btn sm primary', uaOrderSave\)\.disabled = __uaSaving;/.test(bar),
      '「순서 저장」이 왕복 중에도 켜져 있다 — 같은 순서를 두 번 보낼 수 있다');
    assert.ok(/mk\('순서 편집', 'uaOrderEdit', 'btn sm', \(\) => uaOrderToggle\(true\)\)\.disabled = __uaSaving;/.test(bar),
      '「순서 편집」이 왕복 중에도 켜져 있다 — 저장 중인 명부를 다시 흔들 수 있다');
    assert.ok(/nb\.disabled = __uaSaving;/.test(bar),
      '「＋ 직원 등록」이 왕복 중에도 켜져 있다 — 결과를 기다리는 폼 위에 새 폼이 겹친다');
    const ss = extractFunction(web, 'uaSetSaving');
    assert.ok(/uaAdminBar\(\);\s*\n\s*uaApply\(\);/.test(ss),
      'uaSetSaving 이 잠금을 렌더로 반영하지 않는다 — 잠금이 화면에 닿는 길이 없다');
    assert.ok(/getElementById\('userEdSave'\)/.test(ss) && /getElementById\('userEdActive'\)/.test(ss),
      'uaSetSaving 이 폼 하단의 붙박이 두 버튼을 직접 잠그지 않는다 — 그 둘은 다시 그려지지 않는다');
  },

  // ⑭-c 「순서 저장」은 **자기 회신을 자기가 받는다**(2026-09-14). 예전에는 공용 회신함이 요청 표에서
  //     '이 회신이 순서 저장의 것인가(wasOrder)'를 되읽어야 했다 — 표가 사라진 지금은 물을 필요가 없다.
  //     ★ 성공도 「낡은 명부」 거부도 편집 모드를 끝낸다. 끝냈으면 **누군가는 다시 그려야** 한다:
  //       안 그리면 ▲▼·[취소]·[순서 저장]이 __uaOrder=false 인 화면에 남아, 눌러도 아무 일이 없다(R4-W3).
  //       명부가 회신에 실려 오면 그것을 앉히면서 그려지고(uaSeatRoster → uaApplyData), 안 실려 오면 여기서 그린다.
  orderSaveHandlesItsOwnReply(web) {
    const o = extractFunction(web, 'uaOrderSave');
    assert.ok(/^async function uaOrderSave\(\)\{/m.test(web),
      'uaOrderSave 가 async 가 아니다 — 자기 회신을 자기 자리에서 받을 수 없다');
    assert.ok(/const r = await uaSend\(\{ cmd: 'saveUserOrder', userIds: ids \}\);/.test(o),
      'uaOrderSave 가 uaSend 의 회신을 받지 않는다 — 결과가 다시 공용 회신함으로 흘러간다');
    assert.ok(/if\(!r\) return;/.test(o),
      "uaOrderSave 가 '못 보냈다(null)'를 회신과 같이 다룬다 — 화면이 있지도 않은 결과를 말한다");
    //  ★ 문구는 **호스트의 상수 한 벌**(ProjectDb.StaleRosterMsg)이 정본이다 — 여기서 둘을 맞댄다.
    const staleMsg = /internal const string StaleRosterMsg\s*=\s*"([^"]+)"/.exec(pdb);
    assert.ok(staleMsg, 'ProjectDb 에 StaleRosterMsg 상수 선언이 없다 — 맞댈 정본이 없다(판정 불가)');
    assert.ok(o.includes("r.msg === '" + staleMsg[1] + "'"),
      `uaOrderSave 가 「낡은 명부」 거부를 호스트 문구 그대로 알아보지 못한다(정본: ${JSON.stringify(staleMsg[1])}) — 한 글자만 갈려도 편집 모드가 영영 안 끝난다`);
    assert.ok(/const staleRoster = \(!r\.ok && r\.msg === '[^']+'\);/.test(o),
      "uaOrderSave 가 「낡은 명부」 거부를 이름 붙여 두지 않는다 — 그 조건을 되그리기 판단에서 다시 쓸 수 없다(R4-W3)");
    assert.ok(/if\(r\.ok \|\| staleRoster\) uaOrderReset\(\);/.test(o),
      'uaOrderSave 가 성공·「낡은 명부」 거부에서 편집 모드를 끝내지 않는다 — 그 거부는 "네 화면이 낡았다"는 뜻이라, 그대로 두면 같은 거부만 되풀이된다');
    //  ★ 미뤄 둔 갱신은 성공에서 **버린다**(R4-W1) — 그 스냅샷은 내 저장이 서버에 닿기 전의 명부라,
    //    앉히면 방금 저장한 순서가 옛 순서로 되돌아간다. 확정 명부는 회신(r.roster)이 싣고 온다.
    assert.ok(/if\(r\.ok\) __uaPendingData = null;/.test(o),
      'uaOrderSave 가 성공에서 미뤄 둔 옛 스냅샷을 버리지 않는다 — 나중에 편집을 켰다 끄면 그 옛 명부가 이긴다(R4-W1·R4-W2)');
    //  ★ 2026-09-14(좌석 일원화): 확정 명부는 **uaSend 안에서** 앉았다(uaSeatReply · 계약⑭-e).
    //    여기서는 '앉았나'만 회신에서 받아 되그릴지 판단한다 — 앉히는 자리를 여기에 또 두면 좌석이 둘이 된다.
    assert.ok(/let painted = r\.painted;/.test(o),
      "uaOrderSave 가 '확정 명부가 앉았나'를 회신에서 받지 않는다(또는 스스로 앉힌다) — 좌석이 둘로 갈리거나 되그리기 판단의 근거가 사라진다");
    assert.ok(/if\(!painted && staleRoster && __uaPendingData\)\{ uaFlushPending\(\); painted = true; \}/.test(o),
      '「낡은 명부」 거부에 명부가 안 실려 왔을 때 미뤄 둔 갱신을 앉히지 않는다 — 관리자는 낡은 명부로 같은 거부를 되풀이한다');
    assert.ok(/if\(!painted && \(r\.ok \|\| staleRoster\)\)\{ uaAdminBar\(\); uaApply\(\); \}/.test(o),
      'uaOrderSave 가 편집 모드를 끝내고도 다시 그리지 않는다(또는 성공만 그린다) — ▲▼·[취소]·[순서 저장]이 끝난 편집 화면에 그대로 남는다(R4-W3)');
  },

  // ⑭-d 잠금 표시는 **바뀔 때만** 다시 그린다(2026-09-11 적대 검토 R2-W3).
  //     무조건 그리면 [편집]·[＋ 직원 등록]을 누르는 것만으로도 명부가 통째로 다시 만들어진다
  //     (userEdOpen 이 uaSetSaving(false) 를 부른다) — 89행짜리 목록이 맨 위로 튀고, 방금 누른 그 버튼이
  //     사라져 폼을 닫을 때 포커스를 되돌릴 자리도 함께 없어진다.
  renderOnlyWhenLockChanges(web) {
    const ss = extractFunction(web, 'uaSetSaving');
    assert.ok(/const changed = \(__uaSaving !== !!on\);/.test(ss),
      'uaSetSaving 이 "잠금이 실제로 바뀌었나"를 재지 않는다 — 안 바뀐 호출에도 명부가 통째로 다시 그려진다(R2-W3)');
    assert.ok(/if\(changed\)\{\s*\n\s*uaAdminBar\(\);\s*\n\s*uaApply\(\);\s*\n\s*\}/.test(ss),
      'uaSetSaving 의 재렌더가 changed 로 좁혀져 있지 않다 — [편집] 한 번에 스크롤과 누른 버튼이 사라진다');
    //  ★ 2026-09-14: 돌아오는 자리가 **하나**다. 옛 판은 '잠금 해제'와 '워치독 설치' 두 갈래에서 각각
    //    돌려줬는데, 워치독이 사라지면서 갈래도 하나가 됐다 — 둘을 요구하면 없는 갈래를 요구하는 것이다.
    assert.ok((ss.match(/return changed;/g) || []).length === 1,
      "uaSetSaving 이 '다시 그렸나'를 정확히 한 자리에서 돌려주지 않는다 — 갈래가 둘이면 워치독이 되살아난 것이고, 없으면 부르는 쪽이 판단할 근거가 없다");
  },

  // ⑮ 여는 순간 낡은 잠금을 정리한다 — 다만 **도는 중이면 풀지 않는다**(그 왕복이 끝나는 자리가 푼다).
  openKeepsGuard(web) {
    const oa = extractFunction(web, 'openUserAdmin');
    assert.ok(/if\(__uaSaving\) uaSetSaving\(true\); else uaSetSaving\(false\);/.test(oa),
      'openUserAdmin 이 낡은 잠금을 정리하지 않는다 — 회신 없이 닫았다 다시 열면 화면이 잠긴 채로 선다');
    const o = extractFunction(web, 'userEdOpen');
    assert.ok(/if\(__uaSaving\)\{/.test(o),
      'userEdOpen 이 진행 중 왕복을 무조건 풀어 버린다 — 전송 중에 다른 사람을 열면 중복 전송 가드가 통째로 사라진다');
    assert.ok(/uaSetSaving\(false\);\s*\/\/ 왕복이 없을 때만/.test(o),
      'userEdOpen 의 잠금 해제가 "왕복이 없을 때만"으로 좁혀져 있지 않다');
  },

  // ⑯ 순서 편집 중에 오는 **부탁하지 않은 명부 푸시**가 편집 중인 순서를 지우지 않는다(2026-09-10).
  //    ★ 2026-09-14: 이 자리에서 '내 쓰기의 결과인가'(reqId 대조)를 묻던 갈래가 통째로 사라졌다 —
  //      내 쓰기의 결과는 이제 **그 쓰기의 회신**에 실려 오므로, 여기 닿는 것은 정의상 **남의 갱신**뿐이다.
  //      짝지을 상대가 없으면 짝짓기도 필요 없다. 남는 물음은 하나다: "지금 순서를 만지는 중인가."
  orderSurvivesPush(web) {
    const ap = windowFn(web, '__applyMembers');
    assert.ok(/window\.__applyMembers = function\(json\)\{/.test(ap),
      '__applyMembers 가 아직 두 번째 인자(reqId)를 받는다 — 짝지을 상대가 사라진 자리에 표만 남았다');
    //  ★ 주석은 빼고 본다 — '왜 더는 짐작하지 않는가'를 적어 둔 문장이 계약을 대신 통과시키면 안 된다.
    const bare = ap.replace(/\/\/[^\n]*/g, '');
    for (const dead of ['reqId', '__uaReq', '__uaSaving']) {
      assert.ok(!bare.includes(dead),
        `__applyMembers 가 아직 ${dead} 를 본다 — 부탁하지 않은 푸시에는 짝지을 요청이 없다(그 짐작이 바로 R3-W1 의 자리다)`);
    }
    assert.ok(/const d = uaParseRoster\(json\);/.test(ap) && /if\(!d\) return;/.test(ap),
      '__applyMembers 가 회신 쪽과 같은 파서(uaParseRoster)를 쓰지 않는다 — 두 길이 갈리면 한쪽만 낡는다');
    assert.ok(/if\(__uaOrder\)\{ __uaPendingData = d; uaAdminBar\(\); return; \}/.test(ap),
      '__applyMembers 가 순서 편집 중의 푸시를 미뤄 두지 않는다(또는 미뤄 두고도 막대를 다시 그리지 않는다) — 남의 저장 한 번에 편집 중인 순서가 날아간다');
    //  ★ 확정 명부(회신에 실려 온 것)가 앉으면 미뤄 둔 옛 스냅샷은 그 자리에서 버린다(R4-W2).
    //    남겨 두면 나중에 순서 편집을 켰다 끄는 것만으로 그 옛 명부가 확정 명부를 덮어쓴다(uaOrderToggle 의 길).
    const seat = extractFunction(web, 'uaSeatRoster').replace(/\/\/[^\n]*/g, '');
    assert.ok(/__uaPendingData = null;\s*\n\s*uaApplyData\(d\);/.test(seat),
      '확정 명부를 앉히면서 미뤄 둔 옛 스냅샷을 버리지 않는다 — 뒤에 순서 편집을 켰다 끄면 옛 명부가 새 명부를 덮는다(R4-W2)');
    const tog = extractFunction(web, 'uaOrderToggle');
    assert.ok(/__uaPendingData/.test(tog) && /uaFlushPending\(\)/.test(tog),
      'uaOrderToggle 이 미뤄 둔 갱신을 반영하지 않는다 — 편집을 끄면 그 사이의 진짜 변경이 사라진다');
    const bar = extractFunction(web, 'uaAdminBar');
    assert.ok(/명부가 갱신되었습니다 — 순서 편집을 마치면 반영됩니다\./.test(bar),
      '미뤄 둔 갱신을 화면이 말하지 않는다 — 관리자는 자기 화면이 낡은 줄 모른 채 순서를 정한다');
  },

  // ⑰ 「퇴사자 보기」는 **조회가 실제로 시작됐을 때만** 켜진 채로 남는다(2026-09-10).
  //    ★ 2026-09-11: '시작 못 했다'를 한 false 로 뭉치지 않는다. '다른 조회가 도는 중'과 '호스트가 아니다'는
  //      관리자가 할 일이 다르다 — 뭉치면 브라우저에서 '불러오는 중입니다' 라는 **틀린 이유**가 뜬다.
  inactiveToggleIsHonest(web) {
    const r = extractFunction(web, 'uaReload');
    assert.ok(/if\(!HOST\) return 'nohost';/.test(r) && /if\(__uaBusy\) return 'busy';/.test(r),
      "uaReload 가 '못 시작한 이유'를 갈라 돌려주지 않는다 — 브라우저에서 '불러오는 중'이라는 틀린 안내가 뜬다");
    assert.ok(/return true;/.test(r), 'uaReload 가 "시작했다"를 돌려주지 않는다 — 호출부가 판정할 근거가 없다');
    assert.ok(!/^async function uaReload/m.test(web),
      'uaReload 가 async 다 — 그러면 반환값이 언제나 Promise(늘 참)라 재진입 판정이 무의미해진다');
    const bar = extractFunction(web, 'uaAdminBar');
    assert.ok(/const r = uaReload\(\);/.test(bar) && /if\(r !== 'busy'\) return;/.test(bar),
      "「퇴사자 보기」가 uaReload 의 사유를 보지 않는다 — 체크만 켜지고 목록은 그대로인 화면이 되거나, 틀린 이유를 말한다");
    assert.ok(/cb\.checked = prev;/.test(bar), '조회를 시작하지 못했는데 체크를 되돌리지 않는다');
    //  ★ 2026-09-11 교차 추적 — 시작은 했는데 **회신이 실패**한 경우도 같다: 값을 요청 전으로 되돌리지 않으면
    //    체크·__uaInactive 는 새 값, 명부는 옛 것이 되어 다음 쓰기가 includeInactive 를 화면과 다르게 보낸다.
    assert.ok(/const prevInactive = __uaInactive;/.test(r) && /__uaInactive = prevInactive;/.test(r) && /cb\.checked = prevInactive;/.test(r),
      '조회가 실패했는데 「퇴사자 보기」를 요청 전 값으로 되돌리지 않는다 — 체크와 명부가 어긋난 채 남는다');
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
    //  ★ dirty 판정은 **한 벌**이다(2026-09-11 적대 검토 R3-W4). 예전에는 여기만 칸 값을 __uaMembers 와
    //    하나씩 견주고, Esc·배경 클릭은 formSnapshot 을 썼다 — 같은 폼을 두고 한쪽은 "버려질 게 있다"
    //    하고 다른 쪽은 조용히 닫는 어긋남이 생겼다. 기준이 둘이면 한쪽은 반드시 낡는다.
    const d = extractFunction(web, 'userEdIsDirty');
    assert.ok(/formSnapshot\(ov\) !== \(ov\.__openSnap \|\| ''\)/.test(d),
      'userEdIsDirty 가 formSnapshot 한 벌을 쓰지 않는다 — Esc·배경 클릭(confirmDiscardIfDirty)과 기준이 갈린다');
    assert.ok(!/__uaMembers|uaMemberOf/.test(d),
      'userEdIsDirty 가 아직 저장된 값과 칸을 하나씩 견준다 — 칸이 하나 늘면 그 칸만 조용히 빠진다');
    //  같은 스냅샷을 Esc·배경 클릭도 쓴다 — 두 경로가 같은 식을 보는지 여기서 함께 본다.
    assert.ok(/formSnapshot\(ov\) === \(ov\.__openSnap\|\|''\)/.test(extractFunction(web, 'confirmDiscardIfDirty')),
      'confirmDiscardIfDirty 가 __openSnap 스냅샷을 보지 않는다 — dirty 기준이 두 벌로 갈린다');
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
test('계약⑥-f: 순서 저장은 숨긴 사람의 서열만 비우고, 낡은 명부는 통째로 거부한다(§7-1a · R1)', () => {
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
test('계약⑦-e2: 명부 푸시는 열려 있는 편집 폼의 퇴사/복구 상태도 맞춘다(입력칸은 건드리지 않는다 · R6)', () => {
  checks.formResyncsOnPush(app);
});
test('계약⑩: 열람 범위·편집 권한은 드롭다운이고, 문구는 매핑표 한 벌에서만 나온다(2026-09-10)', () => {
  checks.formPickers(app);
});
test('계약⑪: 모달 폼의 세로 리듬은 토큰 한 곳에서 정한다(.row2 셀 라벨이 위 칸에 붙지 않는다)', () => {
  checks.modalFormRhythm(app);
});
test('계약⑫: 파괴 테두리·읽기전용 wash 는 다섯 테마 전부가 자기 토큰을 갖는다', () => checks.themeTokens(app));
test('계약⑬: 순서 편집 ▲▼ 는 스크롤 자리와 포커스를 지킨다(89행에서 연속 조작이 된다)', () => checks.moveKeepsPlace(app));
test('계약⑬-b: 목록을 다시 그려도 보던 자리와 누르던 버튼의 포커스가 남는다', () => checks.renderKeepsPlace(app));
test('계약⑭: 쓰기 회신은 그 요청을 보낸 클로저가 받는다(손으로 만든 상관관계가 하나도 없다)', () => checks.replyGoesToItsCaller(app));
test('계약⑭-b: 명부 쪽 잠금은 렌더가 진다(재렌더가 잠금을 지우지 않는다)', () => checks.lockIsDerivedAtRender(app));
test('계약⑭-c: 「순서 저장」은 자기 회신을 자기가 받고, 편집 모드를 끝냈으면 반드시 다시 그린다', () => checks.orderSaveHandlesItsOwnReply(app));
test('계약⑭-d: 잠금 표시는 바뀔 때만 다시 그린다([편집] 한 번에 명부가 맨 위로 튀지 않는다)', () => checks.renderOnlyWhenLockChanges(app));
test('계약⑭-e: 회신 명부의 좌석은 한 곳(uaSeatReply)이고, 순서 편집 중이면 회신도 미뤄 둔다', () => checks.replySeatIsOnePlace(app));
test('계약⑮: 화면을 (다시) 열 때 낡은 잠금은 풀되, 도는 중이면 그대로 둔다', () => checks.openKeepsGuard(app));
test('계약⑯: 순서 편집 중의 부탁하지 않은 명부 푸시는 미뤄 두고 편집을 마칠 때 반영한다', () => checks.orderSurvivesPush(app));
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

test('변이⑬-b: uaRender 에서 자리 되돌리기를 빼면 계약⑬-b 가 실패한다(다시 그릴 때마다 맨 위로 튄다)', () => {
  const bad = mutate(app, '  list.scrollTop = sameView ? keepScroll : 0;\n', '');
  assert.throws(() => checks.renderKeepsPlace(bad), /스크롤 자리를 찍어 두고 되돌리지 않는다/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑬-b2: 같은 화면 판정을 지우면 계약⑬-b 가 실패한다(순서 편집으로 바뀌어도 옛 자리가 앉는다)', () => {
  const bad = mutate(app, '  list.scrollTop = sameView ? keepScroll : 0;', '  list.scrollTop = keepScroll;');
  assert.throws(() => checks.renderKeepsPlace(bad), /스크롤 자리를 찍어 두고 되돌리지 않는다/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑬-b3: 잠금 동안 맡아 둔 버튼을 지우면 계약⑬-b 가 실패한다(풀려도 포커스가 행에 남는다)', () => {
  const bad = mutate(app, '      if(__uaSaving) __uaKeepBtn = keepBtn;\n', '');
  assert.throws(() => checks.renderKeepsPlace(bad), /되돌릴 버튼을 맡아 두지 않는다/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑬: uaMove 에서 포커스 복원을 빼면 계약⑬ 이 실패한다', () => {
  const bad = mutate(app, '  uaFocusMoved(userId, uop);', '  ');
  assert.throws(() => checks.moveKeepsPlace(bad), /포커스를 되돌리지 않는다/);
  assert.doesNotThrow(() => checks.moveKeepsPlace(app));   // 통제군
});

test('변이⑭: 회신을 부르는 쪽이 안 받게 되돌리면 계약⑭ 가 실패한다(결과가 갈 곳이 없다)', () => {
  const bad = mutate(app, '  const r = await uaSend(payload);\n  if(r) userEdAfterWrite(r);\n', '  uaSend(payload);\n');
  assert.throws(() => checks.replyGoesToItsCaller(bad), /자기 왕복의 회신을 받아 처리하지 않는다/);
  assert.doesNotThrow(() => checks.replyGoesToItsCaller(app));   // 통제군
});

test('변이⑭-b: 워치독을 되살리면 계약⑭ 가 실패한다(왕복 도중에 잠금이 풀려 둘째 폼이 열린다 · R2-W1)', () => {
  const bad = mutate(app, '  if(changed){\n    uaAdminBar();\n    uaApply();\n  }\n  return changed;\n}',
    '  if(changed){\n    uaAdminBar();\n    uaApply();\n  }\n  if(on) setTimeout(() => uaSetSaving(false), 12000);\n  return changed;\n}');
  assert.throws(() => checks.replyGoesToItsCaller(bad), /워치독이 되살아났다/);
  assert.doesNotThrow(() => checks.replyGoesToItsCaller(app));   // 통제군
});

test('변이⑭-c: 모듈 전역의 요청 표를 되살리면 계약⑭ 가 실패한다(규약이 두 벌이 된다)', () => {
  const bad = mutate(app, 'let __uaPendingData = null; // 순서 편집 중에 도착한',
    'let __uaReq = null;\nlet __uaPendingData = null; // 순서 편집 중에 도착한');
  assert.throws(() => checks.replyGoesToItsCaller(bad), /__uaReq 가 아직 살아 있다/);
  assert.doesNotThrow(() => checks.replyGoesToItsCaller(app));   // 통제군
});

test('변이⑭-d: 행 버튼의 렌더 시 잠금을 빼면 계약⑭-b 가 실패한다', () => {
  const bad = mutate(app, '    b.disabled = __uaSaving;', '    b.disabled = false;');
  assert.throws(() => checks.lockIsDerivedAtRender(bad), /__uaSaving 을 보지 않는다/);
  assert.doesNotThrow(() => checks.lockIsDerivedAtRender(app));   // 통제군
});

test('변이⑭-e: 순서 저장의 되그리기를 지우면 계약⑭-c 가 실패한다(끝난 편집 막대가 남는다)', () => {
  const bad = mutate(app, '  if(!painted && (r.ok || staleRoster)){ uaAdminBar(); uaApply(); }\n', '');
  assert.throws(() => checks.orderSaveHandlesItsOwnReply(bad), /다시 그리지 않는다/);
  assert.doesNotThrow(() => checks.orderSaveHandlesItsOwnReply(app));   // 통제군
});

//  ★ 되그리기를 **성공에만** 걸어 두면(R4-W3 이전 판) 「낡은 명부」 거부 뒤에 아무도 다시 그리지 않는다
//    — ▲▼·[취소]·[순서 저장]이 __uaOrder=false 인 화면에 그대로 남는다(눌러도 아무 일이 없다).
test('변이⑭-e3: 되그리기를 성공에만 걸면 계약⑭-c 가 실패한다(거부 뒤 순서 컨트롤이 남는다)', () => {
  const bad = mutate(app, '  if(!painted && (r.ok || staleRoster)){ uaAdminBar(); uaApply(); }',
    '  if(!painted && r.ok){ uaAdminBar(); uaApply(); }');
  assert.throws(() => checks.orderSaveHandlesItsOwnReply(bad), /다시 그리지 않는다/);
  assert.doesNotThrow(() => checks.orderSaveHandlesItsOwnReply(app));   // 통제군
});

test('변이⑭-e2: 「낡은 명부」 거부에서 편집 모드를 끝내지 않게 되돌리면 계약⑭-c 가 실패한다', () => {
  const bad = mutate(app, '  if(r.ok || staleRoster) uaOrderReset();', '  if(r.ok) uaOrderReset();');
  assert.throws(() => checks.orderSaveHandlesItsOwnReply(bad), /편집 모드를 끝내지 않는다/);
  assert.doesNotThrow(() => checks.orderSaveHandlesItsOwnReply(app));   // 통제군
});

test("변이⑭-f: uaSend 의 중복 전송 가드를 지우면 계약⑭ 가 실패한다(두 왕복이 겹쳐 짝을 잃는다)", () => {
  const bad = mutate(app, '  if(__uaSaving) return null;   // 연타·중복 전송 차단\n', '');
  assert.throws(() => checks.replyGoesToItsCaller(bad), /중복 전송 가드가 없다/);
  assert.doesNotThrow(() => checks.replyGoesToItsCaller(app));   // 통제군
});

test('변이⑭-g: uaSetSaving 이 무조건 다시 그리게 되돌리면 계약⑭-d 가 실패한다', () => {
  const bad = mutate(app, '  const changed = (__uaSaving !== !!on);', '  const changed = true;');
  assert.throws(() => checks.renderOnlyWhenLockChanges(bad), /"잠금이 실제로 바뀌었나"를 재지 않는다/);
  assert.doesNotThrow(() => checks.renderOnlyWhenLockChanges(app));   // 통제군
});

//  ★ 계약⑭-e 의 변이 넷 — 1단계(왕복 전환)가 실제로 남긴 구멍 넷을 각각 되돌려 본다.
test('변이⑭-e4: uaSend 에서 좌석을 빼면 계약⑭-e 가 실패한다(폼을 안 거친 쓰기가 명부를 못 앉힌다 · C06·C08)', () => {
  const bad = mutate(app, SEAT_IN_SEND, SEAT_IN_SEND_GONE);
  assert.throws(() => checks.replySeatIsOnePlace(bad), /그 자리에서 들여보내지 않는다/);
  assert.doesNotThrow(() => checks.replySeatIsOnePlace(app));   // 통제군
});

test('변이⑭-e5: 회신은 미뤄 두지 않게 되돌리면 계약⑭-e 가 실패한다(편집 중인 순서가 덮인다 · C20)', () => {
  const bad = mutate(app, "  if(__uaOrder && cmd !== 'saveUserOrder'){", '  if(false){');
  assert.throws(() => checks.replySeatIsOnePlace(bad), /가려내지 않는다/);
  assert.doesNotThrow(() => checks.replySeatIsOnePlace(app));   // 통제군
});

test('변이⑭-e6: 뒤처리가 한 번 더 앉히게 되돌리면 계약⑭-e 가 실패한다(좌석이 둘로 갈린다)', () => {
  const bad = mutate(app, '  trSeat(r.trash);\n  toast(r.msg', '  trSeat(r.trash);\n  uaSeatRoster(r.roster);\n  toast(r.msg');
  assert.throws(() => checks.replySeatIsOnePlace(bad), /앉히는 자리가 2곳이다/);
  assert.doesNotThrow(() => checks.replySeatIsOnePlace(app));   // 통제군
});

test('변이⑭-e7: 「순서 저장」 회신에서 앉힌 뒤에 편집 모드를 끄면 계약⑭-e 가 실패한다(두 번 그려야 한다)', () => {
  const bad = mutate(app, "  if(cmd === 'saveUserOrder') uaOrderReset();\n  return uaSeatRoster(json);",
    "  const seated = uaSeatRoster(json);\n  if(cmd === 'saveUserOrder') uaOrderReset();\n  return seated;");
  assert.throws(() => checks.replySeatIsOnePlace(bad), /한 번에 그려야 한다/);
  assert.doesNotThrow(() => checks.replySeatIsOnePlace(app));   // 통제군
});

test('변이⑮: userEdOpen 이 잠금을 무조건 풀면 계약⑮ 가 실패한다(전송 중 가드가 사라진다)', () => {
  const bad = mutate(app, '    uaSetSaving(false);                                    // 왕복이 없을 때만 잠금을 푼다',
    '    uaSetSaving(false);');
  assert.throws(() => checks.openKeepsGuard(bad), /"왕복이 없을 때만"으로 좁혀져 있지 않다/);
  assert.doesNotThrow(() => checks.openKeepsGuard(app));   // 통제군
});

test('변이⑯: 관계없는 푸시를 그대로 반영하게 되돌리면 계약⑯ 이 실패한다', () => {
  const bad = mutate(app, '  if(__uaOrder){ __uaPendingData = d; uaAdminBar(); return; }', '  ');
  assert.throws(() => checks.orderSurvivesPush(bad), /미뤄 두지 않는다/);
  assert.doesNotThrow(() => checks.orderSurvivesPush(app));   // 통제군
});

test("변이⑯-b: 푸시가 다시 '내 것인가'를 짐작하게 만들면 계약⑯ 이 실패한다(짝지을 상대가 없다)", () => {
  const bad = mutate(app, '  if(__uaOrder){ __uaPendingData = d; uaAdminBar(); return; }',
    '  if(__uaOrder && !__uaSaving){ __uaPendingData = d; uaAdminBar(); return; }');
  assert.throws(() => checks.orderSurvivesPush(bad), /__applyMembers 가 아직 __uaSaving 를 본다/);
  assert.doesNotThrow(() => checks.orderSurvivesPush(app));   // 통제군
});

test('변이⑯-b2: 확정 명부가 옛 스냅샷을 남기게 되돌리면 계약⑯ 이 실패한다(뒤에 켰다 끄면 옛 명부가 이긴다)', () => {
  const bad = mutate(app, '  __uaPendingData = null;\n  uaApplyData(d);\n  userEdSyncActive();   // ★ 열려 있는 편집 폼의 퇴사/복구 상태도 이 명부에 맞춘다(R6-W3)\n  return true;',
    '  uaApplyData(d);\n  userEdSyncActive();   // ★ 열려 있는 편집 폼의 퇴사/복구 상태도 이 명부에 맞춘다(R6-W3)\n  return true;');
  assert.throws(() => checks.orderSurvivesPush(bad), /미뤄 둔 옛 스냅샷을 버리지 않는다/);
  assert.doesNotThrow(() => checks.orderSurvivesPush(app));   // 통제군
});

test('변이⑯-c: 푸시가 다시 reqId 를 받게 되돌리면 계약⑯ 이 실패한다(짝지을 상대가 없는 표다)', () => {
  const bad = mutate(app, 'window.__applyMembers = function(json){', 'window.__applyMembers = function(json, reqId){');
  assert.throws(() => checks.orderSurvivesPush(bad), /아직 두 번째 인자\(reqId\)를 받는다/);
  assert.doesNotThrow(() => checks.orderSurvivesPush(app));   // 통제군
});

test('변이⑰: uaReload 를 async 로 되돌리면 계약⑰ 이 실패한다(반환값이 늘 참이 된다)', () => {
  const bad = mutate(app, "function uaReload(){\n  if(!HOST) return 'nohost';",
    "async function uaReload(){\n  if(!HOST) return 'nohost';");
  assert.throws(() => checks.inactiveToggleIsHonest(bad), /uaReload 가 async 다/);
  assert.doesNotThrow(() => checks.inactiveToggleIsHonest(app));   // 통제군
});

test('변이⑰-c: 조회 실패 시 「퇴사자 보기」 되돌리기를 지우면 계약⑰ 이 실패한다', () => {
  const bad = mutate(app, '      __uaInactive = prevInactive;\n', '');
  assert.throws(() => checks.inactiveToggleIsHonest(bad), /요청 전 값으로 되돌리지 않는다/);
  assert.doesNotThrow(() => checks.inactiveToggleIsHonest(app));   // 통제군
});

test("변이⑰-b: 못 시작한 두 사유를 한 false 로 뭉치면 계약⑰ 이 실패한다(틀린 이유를 말한다)", () => {
  const bad = mutate(app, "  if(!HOST) return 'nohost';\n  if(__uaBusy) return 'busy';", '  if(!HOST || __uaBusy) return false;');
  assert.throws(() => checks.inactiveToggleIsHonest(bad), /못 시작한 이유.*갈라 돌려주지 않는다/);
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

test('변이⑲-b: userEdIsDirty 를 옛 칸별 대조로 되돌리면 계약⑲ 가 실패한다(기준이 두 벌이 된다)', () => {
  const bad = mutate(app, '  const ov = document.getElementById(\'userEditModal\');\n  return !!ov && formSnapshot(ov) !== (ov.__openSnap || \'\');',
    "  const m = uaMemberOf(__ueId);\n  return !!m && String(m.name || '') !== '';");
  assert.throws(() => checks.retireConfirmIsHonest(bad), /formSnapshot 한 벌을 쓰지 않는다|칸을 하나씩 견준다/);
  assert.doesNotThrow(() => checks.retireConfirmIsHonest(app));   // 통제군
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

// ── 브리지 배선 — 세 명령이 실제로 호스트에 닿고, 갱신된 명부가 그 회신에 실려 온다 ──────────
test('계약②-b: 브리지 3종(saveUser·setUserActive·saveUserOrder)이 배선돼 있고 회신이 갱신 명부를 나른다', () => {
  const code = stripCs(main);
  for (const [cmd, fn] of [['saveUser', 'SaveUserAsync'], ['setUserActive', 'SetUserActiveAsync'], ['saveUserOrder', 'SaveUserOrderAsync']]) {
    assert.ok(new RegExp('case "' + cmd + '":').test(code), `브리지 case "${cmd}" 가 없다 — 화면이 눌러도 아무 일도 안 난다`);
    //  ★ 2026-09-11 적대 검토(R3) → 2026-09-14 — 세 명령이 reqId 를 함께 나른다. 옛 판에서 그 reqId 는
    //    **푸시**(__userSaved)의 세 번째 인자로 돌아왔고, 푸시에는 배관의 짝짓기가 없어 웹이 그것을
    //    손으로 한 벌 더 지어야 했다. 지금은 같은 reqId 가 요청/회신 배관(ReplyOnUi)을 타고 돌아온다.
    assert.ok(new RegExp('case "' + cmd + '":[\\s\\S]{0,300}?' + fn + '\\(GetStr\\(doc, "reqId"\\)').test(code),
      `브리지 case "${cmd}" 가 reqId 를 넘기지 않는다 — 회신이 어느 요청의 것인지 배관이 알 수 없다(R3)`);
    const b = csMember(main, 'private async Task ' + fn + '(');
    assert.ok(/^private async Task \w+\(string reqId, /.test(b), `${fn} 이 reqId 를 받지 않는다(R3)`);
    assert.ok(/ReplyOnUi\(reqId, new \{ ok, msg, roster \}\);/.test(b),
      `${fn} 이 결과를 회신(ReplyOnUi)으로 돌려주지 않는다 — 푸시로 되돌아가면 웹이 상관관계를 다시 손으로 짓는다`);
    //  ★ 명부를 싣는 **조건**은 셋이 서로 다르다. 자세한 정책은 ⑭-h2(순서)·⑭-h3(퇴사/복구)이 지고,
    //    여기서는 '셋의 조건이 서로 다르다' 는 것만 본다 — 한 벌로 뭉뚱그리면 아래 계약이 지킬 것을 잃는다.
    //  ★ 2026-09-11 적대 검토(R2-H2 → R3-H2) — 순서 저장은 실패해도 명부를 싣지만 **아무 실패나** 는 아니다.
    //  ★ 2026-09-11 적대 검토(R5) — 퇴사/복구도 같은 자리에 걸린다. 복구의 거부 문구
    //    (ProjectDb.AlreadyActiveMsg — "…목록을 새로고침합니다")는 정확히 **실패**로 나오면서
    //    새로고침을 약속하므로, 성공(ok)에만 실으면 그 약속이 거짓말이 되고 관리자는 같은 낡은 명부로
    //    같은 [복구] 를 다시 눌러 같은 거부만 반복한다(휴지통이 TRASH-DELETE §11-23 에서 닫은 그 구멍).
    //    저장(SaveUserAsync)만 그대로 '성공 때만' 이다 — 실패는 폼 안의 문구로 끝나고 목록은 안 바뀐 채다.
    if (fn === 'SaveUserOrderAsync') {
      assert.ok(/string roster = ok \|\| string\.Equals\(msg, ProjectDb\.StaleRosterMsg/.test(b),
        `${fn} 의 명부 조건이 "성공 또는 낡은 명부" 가 아니다 — 성공에만 실으면 낡은 명부 거부(StaleRosterMsg)를 ` +
        '받은 관리자가 같은 화면으로 다시 눌러 거부만 반복하는 루프에 갇힌다(R2-H2)');
    } else if (fn === 'SetUserActiveAsync') {
      assert.ok(/string roster = ok \|\| string\.Equals\(msg, ProjectDb\.AlreadyActiveMsg/.test(b),
        `${fn} 의 명부 조건이 "성공 또는 이미 복구됨" 이 아니다 — 이미 복구된 항목 거부(AlreadyActiveMsg)가 ` +
        '"목록을 새로고침합니다" 라고 약속해 놓고 아무것도 싣지 않는다(R5)');
    } else {
      assert.ok(/string roster = ok \? await ReadMembersJsonAsync\(includeInactive\) : "";/.test(b),
        `${fn} 이 성공 뒤 명부를 회신에 싣지 않는다 — "저장은 됐는데 목록은 그대로"인 창이 생긴다`);
    }
  }
  //  옛 푸시 배관은 남아 있으면 안 된다 — 남겨 두면 웹이 그 위에 상관관계를 다시 손으로 짓는다.
  assert.ok(!/__userSaved/.test(code),
    '호스트에 아직 __userSaved 푸시가 남아 있다 — 쓰기 결과는 회신(ReplyOnUi)으로만 간다(2026-09-14)');
  //  남은 푸시(__applyMembers)는 인자 하나짜리 '남의 갱신' 하나뿐이다(⑭-h 가 그 모양을 본다).
  assert.ok(/window\.__applyMembers && window\.__applyMembers\(/.test(code),
    '호스트가 남의 갱신을 __applyMembers 로 밀어 주지 않는다(휴지통에서 인력을 건드린 뒤의 자리다)');
  assert.ok(/window\.__applyMembers = function/.test(app), '웹에 __applyMembers 수신부가 없다');
});

test('계약⑭-h: 갱신 명부는 회신을 타고 오고, 남은 푸시(__applyMembers)는 인자 하나다(2026-09-14)', () =>
  checks.membersRideInReply(main));

test('계약⑭-h2: 순서 저장 회신의 명부는 성공·낡은 명부 거부 둘뿐이다(정본은 ProjectDb 의 상수다)', () =>
  checks.orderRosterPolicy(main, pdb));

test('변이⑭-h: __applyMembers 푸시에 reqId 를 다시 붙이면 계약⑭-h 가 실패한다(옛 짝짓기가 되살아난다)', () => {
  const bad = mutate(main,
    'window.__applyMembers(" + JsonSerializer.Serialize(json) + ")");',
    'window.__applyMembers(" + JsonSerializer.Serialize(json) + "," + JsonSerializer.Serialize(reqId ?? "") + ")");');
  assert.throws(() => checks.membersRideInReply(bad), /인자 하나\(json\)가 아니다/);
  assert.doesNotThrow(() => checks.membersRideInReply(main));   // 통제군
});

test('변이⑭-h1b: LoadMembersToWebAsync 가 reqId 를 다시 받게 되돌리면 계약⑭-h 가 실패한다', () => {
  const bad = mutate(main,
    'private async Task LoadMembersToWebAsync(bool includeInactive)',
    'private async Task LoadMembersToWebAsync(bool includeInactive, string reqId = "")');
  assert.throws(() => checks.membersRideInReply(bad), /아직 reqId 를 받는다/);
  assert.doesNotThrow(() => checks.membersRideInReply(main));   // 통제군
});

test('변이⑭-h1c: 쓰기 결과를 옛 푸시(__userSaved)로 되돌리면 계약⑭-h 가 실패한다(상관관계가 사라진다)', () => {
  const bad = mutate(main, 'private async Task<string> ReadMembersJsonAsync(',
    'private void UserSaved(bool ok, string msg, string reqId = "") =>\n'
    + '            JsCall("window.__userSaved && window.__userSaved(" + JsonSerializer.Serialize(reqId ?? "") + ")");\n\n'
    + '        private async Task<string> ReadMembersJsonAsync(');
  assert.throws(() => checks.membersRideInReply(bad), /__userSaved 푸시가 남아 있다/);
  assert.doesNotThrow(() => checks.membersRideInReply(main));   // 통제군
});

test('변이⑭-h1d: 회신에서 roster 를 빼면 계약⑭-h 가 실패한다(저장은 됐는데 목록은 그대로다)', () => {
  const bad = mutate(main, 'ReplyOnUi(reqId, new { ok, msg, roster });', 'ReplyOnUi(reqId, new { ok, msg });');
  assert.throws(() => checks.membersRideInReply(bad), /\{ok, msg, roster\} 가 아니다/);
  assert.doesNotThrow(() => checks.membersRideInReply(main));   // 통제군
});

test('변이⑭-h2: 순서 저장이 실패에도 무조건 명부를 싣게 되돌리면 계약⑭-h2 가 실패한다(R2-H2 의 과잉)', () => {
  const bad = mutate(main,
    'string roster = ok || string.Equals(msg, ProjectDb.StaleRosterMsg, StringComparison.Ordinal)',
    'string roster = true');
  assert.throws(() => checks.orderRosterPolicy(bad, pdb), /성공 또는 낡은 명부/);
  assert.doesNotThrow(() => checks.orderRosterPolicy(main, pdb));   // 통제군
});

test('변이⑭-h2b: 낡은 명부 판정을 브리지가 제 손으로 적으면 계약⑭-h2 가 실패한다(문장이 두 벌이 된다)', () => {
  const bad = mutate(main,
    'string.Equals(msg, ProjectDb.StaleRosterMsg, StringComparison.Ordinal)',
    'string.Equals(msg, "명부가 바뀌었습니다 — 새로고침한 뒤 다시 저장하세요.", StringComparison.Ordinal)');
  assert.throws(() => checks.orderRosterPolicy(bad, pdb), /성공 또는 낡은 명부/);
  assert.doesNotThrow(() => checks.orderRosterPolicy(main, pdb));   // 통제군
});

test('변이⑭-h2c: StaleRosterMsg 를 private 로 되돌리면 계약⑭-h2 가 실패한다(브리지가 그 상수를 못 본다)', () => {
  const bad = mutate(pdb, 'internal const string StaleRosterMsg', 'private const string StaleRosterMsg');
  assert.throws(() => checks.orderRosterPolicy(main, bad), /internal 이 아니다/);
  assert.doesNotThrow(() => checks.orderRosterPolicy(main, pdb));   // 통제군
});

test('계약⑭-h3: 퇴사/복구 회신의 명부가 "성공 또는 이미 복구됨" 둘이다(R5)', () =>
  checks.activeRosterPolicy(main, pdb));

test('변이⑭-h3: 그 명부를 성공에만 걸면(옛 if (ok)) 계약⑭-h3 이 실패한다("새로고침합니다"가 거짓말이 된다 · R5)', () => {
  const bad = mutate(main,
    'string roster = ok || string.Equals(msg, ProjectDb.AlreadyActiveMsg, StringComparison.Ordinal)',
    'string roster = ok');
  assert.throws(() => checks.activeRosterPolicy(bad, pdb), /성공 또는 이미 복구됨/);
  assert.doesNotThrow(() => checks.activeRosterPolicy(main, pdb));   // 통제군
});

test('변이⑭-h3b: 그 판정을 브리지가 제 손으로 적으면 계약⑭-h3 이 실패한다(문장이 두 벌이 된다 · R5)', () => {
  const bad = mutate(main,
    'string.Equals(msg, ProjectDb.AlreadyActiveMsg, StringComparison.Ordinal)',
    'string.Equals(msg, "이미 복구된 항목입니다 — 목록을 새로고침합니다.", StringComparison.Ordinal)');
  assert.throws(() => checks.activeRosterPolicy(bad, pdb), /성공 또는 이미 복구됨/);
  assert.doesNotThrow(() => checks.activeRosterPolicy(main, pdb));   // 통제군
});

test('변이⑭-h3c: AlreadyActiveMsg 를 private 로 되돌리면 계약⑭-h3 이 실패한다(브리지가 그 상수를 못 본다 · R5)', () => {
  const bad = mutate(pdb, 'internal const string AlreadyActiveMsg', 'private const string AlreadyActiveMsg');
  assert.throws(() => checks.activeRosterPolicy(main, bad), /internal 이 아니다/);
  assert.doesNotThrow(() => checks.activeRosterPolicy(main, pdb));   // 통제군
});

test('변이⑭-h3d: 그 상수를 휴지통 전용 이름으로 되돌리면 계약⑭-h3 이 실패한다(이름이 자리를 거짓말한다 · R5)', () => {
  const bad = mutate(pdb, 'internal const string AlreadyActiveMsg', 'internal const string TrashAlreadyActiveMsg');
  assert.throws(() => checks.activeRosterPolicy(main, bad), /휴지통 이름을 달고 있다/);
  assert.doesNotThrow(() => checks.activeRosterPolicy(main, pdb));   // 통제군
});

test('변이⑭-h3e: 퇴사/복구가 명부를 안 읽으면 계약⑭-h3 이 실패한다(거부 루프가 돌아온다 · R5·R6)', () => {
  //  변이는 계약과 **같은 슬라이스**(SetUserActiveAsync)에만 건다 — 같은 꼴이 파일에 여럿이라
  //  '첫 번째 등장' 은 파일 안의 순서라는 우연이다(변이⑥-f6 과 같은 규율).
  const from = '? await ReadMembersJsonAsync(includeInactive) : "";';
  const at = main.indexOf('private async Task SetUserActiveAsync(');
  assert.ok(at >= 0, '변이 준비 실패: SetUserActiveAsync 선언을 찾지 못했다(판정 불가)');
  const i = main.indexOf(from, at);
  assert.ok(i >= 0, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  const bad = main.slice(0, i) + '? "" : "";' + main.slice(i + from.length);
  assert.ok(!csMember(bad, 'private async Task SetUserActiveAsync(').includes('ReadMembersJsonAsync'),
    '변이가 퇴사/복구 갈래에 걸리지 않았다 — 계약⑭-h3 은 그 슬라이스만 본다(판정 불가)');
  assert.ok(csMember(bad, 'private async Task SaveUserOrderAsync(').includes('ReadMembersJsonAsync'),
    '변이가 순서 저장까지 건드렸다 — 이 변이의 대상은 퇴사/복구 한 벌이다(판정 불가)');
  assert.throws(() => checks.activeRosterPolicy(bad, pdb), /명부를 읽지 않는다/);
  assert.doesNotThrow(() => checks.activeRosterPolicy(main, pdb));   // 통제군
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
  assert.doesNotThrow(() => checks.canonColumnShape(usersCanon, 'x'));   // 통제군
});

test('변이①-c: 마이그레이션에서 AFTER title 을 지우면 계약①-b 가 실패한다', () => {
  const bad = mutate(migrateSql, '\n  AFTER title;', ';');
  assert.throws(() => checks.migrationShape(bad, canonSchemaVersion()), /AFTER title` 이 없다/);
  assert.doesNotThrow(() => checks.migrationShape(migrateSql, canonSchemaVersion()));   // 통제군
});

test('변이①-d: 초기값 UPDATE 에서 updated_at 명시를 빼면 계약①-b 가 실패한다(감사 시각 전면 덮어쓰기)', () => {
  const bad = mutate(migrateSql, ',\n       u.updated_at = u.updated_at;', ';');
  assert.throws(() => checks.migrationShape(bad, canonSchemaVersion()), /updated_at 을 명시하지 않는다/);
  assert.doesNotThrow(() => checks.migrationShape(migrateSql, canonSchemaVersion()));   // 통제군
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
  assert.doesNotThrow(() => checks.lockoutGuards(pdb));   // 통제군
});

test('변이③-b: 자기 퇴사 금지를 지우면 계약③ 이 실패한다', () => {
  const bad = mutate(pdb,
    '                        { await tx.RollbackAsync(cts.Token); return (false, SelfDeactivateMsg); }',
    '                        { }');
  assert.throws(() => checks.lockoutGuards(bad), /자기 퇴사 금지/);
  assert.doesNotThrow(() => checks.lockoutGuards(pdb));   // 통제군
});

test('변이③-c: app_user 하드삭제 경로가 생기면 계약③ 이 실패한다', () => {
  //  ★ 앵커는 퇴사 갈래다(2026-09-11 R3 부터 복구·퇴사가 두 문장으로 갈렸다 — 복구는 sort_order 를 비운다).
  const bad = mutate(pdb, 'UPDATE app_user SET is_active=0 WHERE user_id=@uid', 'DELETE FROM app_user WHERE user_id=@uid');
  assert.throws(() => checks.lockoutGuards(bad), /DELETE 하는 SQL 이 생겼다/);
  assert.doesNotThrow(() => checks.lockoutGuards(pdb));   // 통제군
});

test('변이④: 로그인 ID 정규식을 넓히면 계약④ 가 실패한다', () => {
  const bad = mutate(pdb, '@"^[A-Za-z0-9._-]{1,50}$"', '@"^.{1,50}$"');
  assert.throws(() => checks.inputValidation(bad), /정규식이 \^\[A-Za-z0-9/);
  assert.doesNotThrow(() => checks.inputValidation(pdb));   // 통제군
});

test('변이④-b: 직급 검증을 숨김 포함으로 바꾸면 계약④ 가 실패한다(폐지된 직급으로 신규 배정)', () => {
  const bad = mutate(pdb, 'LoadCodeNameSetAsync(conn, cts.Token, "title_code", activeOnly: true)',
                          'LoadCodeNameSetAsync(conn, cts.Token, "title_code", activeOnly: false)');
  assert.throws(() => checks.inputValidation(bad), /활성 title_code 로드가 아니다/);
  assert.doesNotThrow(() => checks.inputValidation(pdb));   // 통제군
});

test('변이④-c: 수정에서 "현재 저장된 값 허용"을 지우면 계약④ 가 실패한다(폐지 직급인 사람을 못 고친다)', () => {
  const bad = mutate(pdb,
    'if (!titleSet.Contains(ti) && !string.Equals(ti, curTitle, StringComparison.Ordinal))',
    'if (!titleSet.Contains(ti))');
  assert.throws(() => checks.inputValidation(bad), /직급 검사가/);
  assert.doesNotThrow(() => checks.inputValidation(pdb));   // 통제군
});

test("변이④-d: '지금 저장된 값'을 잠근 행이 아니라 입력값에서 받으면 계약④ 가 실패한다(완화가 신규 등록까지 번진다)", () => {
  const bad = mutate(pdb, 'string? curTitle = target?.title;', 'string? curTitle = ti;');
  assert.throws(() => checks.inputValidation(bad), /잠근 대상 행\(target\)에서 오지 않는다/);
  assert.doesNotThrow(() => checks.inputValidation(pdb));   // 통제군
});

test('변이⑥-f: 복구가 sort_order 를 비우지 않게 되돌리면 계약⑥-f 가 실패한다(옛 순번을 들고 돌아온다 · R3)', () => {
  const bad = mutate(pdb,
    '"UPDATE app_user SET is_active=1, sort_order=NULL WHERE user_id=@uid AND is_active=0"',
    '"UPDATE app_user SET is_active=1 WHERE user_id=@uid"');
  assert.throws(() => checks.orderClearsOutsiders(bad), /복구\(SetUserActiveAsync/);
  assert.doesNotThrow(() => checks.orderClearsOutsiders(pdb));   // 통제군
});

test('변이⑥-f5: 이미 활성인 사람의 복구를 막는 문을 지우면 계약④(잠금 방지)가 실패한다(살아 있는 서열이 지워진다 · R4)', () => {
  //  세워 둔 푸시·낡은 화면이 멀쩡히 쓰이던 사람에게 복구를 한 번 더 걸면, 옛 판은 sort_order 를
  //  비우고 **성공**을 돌려줬다. 그 문이 사라졌는지 본다.
  const bad = mutate(pdb,
    'else if (target.Value.isActive != 0)',
    'else if (false)');
  assert.throws(() => checks.lockoutGuards(bad), /이미 활성 판정이 \*\*잠근 행의 값\*\*/);
  assert.doesNotThrow(() => checks.lockoutGuards(pdb));   // 통제군
});

test('변이⑥-f6: 그 거부를 다른 문구로 갈라놓으면 계약④ 가 실패한다(정본은 AlreadyActiveMsg 한 줄 · R4)', () => {
  //  휴지통 복구와 명부 복구는 **같은 사건**이다. 문장을 두 벌로 적는 순간 한쪽만 고쳐진다 —
  //  그 갈라짐 자체를 잡는다.
  //  ★ 2026-09-11(R5) — 옛 변이는 '첫 번째 등장' 에 기댔다. 그 상수를 쓰는 자리가 둘(명부 복구 ·
  //    휴지통 복구)이므로 어느 쪽이 먼저냐는 **파일 안의 순서**라는 우연이다: 두 함수의 자리가
  //    바뀌면 이 변이는 엉뚱한 함수를 갈라놓고, 계약④(명부 복구만 본다)는 멀쩡히 통과한다.
  //    변이도 계약과 **같은 슬라이스**(SetUserActiveAsync)에만 건다.
  //    (csMember 는 **주석을 지운** 사본을 돌려주므로 원본에 되붙일 수 없다 — 원본에서 그 멤버가
  //     시작하는 자리를 잡고, 거기서 처음 만나는 한 벌만 바꾼다. 제대로 걸렸는지는 아래 두 줄이 본다.)
  const from = 'return (false, AlreadyActiveMsg);';
  const at = pdb.indexOf('SetUserActiveAsync(int userId');
  assert.ok(at >= 0, '변이 준비 실패: SetUserActiveAsync 선언을 찾지 못했다(판정 불가)');
  const i = pdb.indexOf(from, at);
  assert.ok(i >= 0, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  const bad = pdb.slice(0, i) + 'return (false, "이미 복구됐습니다.");' + pdb.slice(i + from.length);
  assert.ok(!csMember(bad, 'SetUserActiveAsync(').includes('AlreadyActiveMsg'),
    '변이가 명부 복구(SetUserActiveAsync) 갈래에 걸리지 않았다 — 계약④ 는 그 슬라이스만 본다(판정 불가)');
  assert.ok(csMember(bad, 'RestoreTrashAsync(').includes('AlreadyActiveMsg'),
    '변이가 휴지통 복구까지 갈라놓았다 — 이 변이의 대상은 명부 복구 한 벌이다(판정 불가)');
  assert.throws(() => checks.lockoutGuards(bad), /이미 활성 거부가 없다/);
  assert.doesNotThrow(() => checks.lockoutGuards(pdb));   // 통제군
});

test('변이⑥-f2: 휴지통 복구 갈래에서 sort_order=NULL 을 빼면 계약⑥-f 가 실패한다(복구 경로는 둘이다 · R3)', () => {
  const bad = mutate(pdb,
    'sql = "UPDATE app_user SET is_active=1, sort_order=NULL WHERE user_id=@k"',
    'sql = "UPDATE app_user SET is_active=1 WHERE user_id=@k"');
  assert.throws(() => checks.orderClearsOutsiders(bad), /휴지통 복구/);
  assert.doesNotThrow(() => checks.orderClearsOutsiders(pdb));   // 통제군
});

test('변이⑥-f3: 퇴사까지 서열을 비우게 만들면 계약⑥-f 가 실패한다(곧바로 복구하면 자리를 잃는다 · R3)', () => {
  const bad = mutate(pdb,
    '"UPDATE app_user SET is_active=0 WHERE user_id=@uid"',
    '"UPDATE app_user SET is_active=0, sort_order=NULL WHERE user_id=@uid"');
  assert.throws(() => checks.orderClearsOutsiders(bad), /퇴사\(active=false\)가 서열까지 손댄다/);
  assert.doesNotThrow(() => checks.orderClearsOutsiders(pdb));   // 통제군
});

test('변이⑥-f4: 순서 저장에 옛 비우기 갈래를 되살리면 계약⑥-f 가 실패한다(저장 사이의 복구가 빠져나간다 · R3)', () => {
  const bad = mutate(pdb,
    '" END WHERE user_id IN (" + inList + ")"',
    '" ELSE (CASE WHEN is_active=0 THEN NULL ELSE sort_order END) END WHERE user_id IN (" + inList + ") OR is_active=0"');
  assert.throws(() => checks.orderClearsOutsiders(bad), /비우기의 자리는 저장이 아니라/);
  assert.doesNotThrow(() => checks.orderClearsOutsiders(pdb));   // 통제군
});

test('변이⑥-j: 한 문장에서 WHERE 를 빼면 계약⑥-f 가 실패한다(표 전체가 UPDATE 대상이 된다 · R2)', () => {
  const bad = mutate(pdb,
    '" END WHERE user_id IN (" + inList + ")"',
    '" END"');
  assert.throws(() => checks.orderClearsOutsiders(bad), /WHERE 가 없다/);
  assert.doesNotThrow(() => checks.orderClearsOutsiders(pdb));   // 통제군
});

test('변이⑥-k: 일치 행 수 로그를 지우면 계약⑥-f 가 실패한다(지워진 id 가 섞여도 안 보인다 · R3)', () => {
  const bad = mutate(pdb,
    '"명부 순서 저장: 일치 행 " + matched + " / 대상 " + kept.Count + "명 전량 재작성"',
    '"명부 순서 저장: 대상 " + kept.Count + "명 전량 재작성"');
  assert.throws(() => checks.orderClearsOutsiders(bad), /두 수를 함께 말하지 않는다/);
  assert.doesNotThrow(() => checks.orderClearsOutsiders(pdb));   // 통제군
});

test('변이⑥-h: 낡은 명부 거부(목록 밖 활성 세기)를 지우면 계약⑥-f 가 실패한다(R1)', () => {
  const bad = mutate(pdb,
    '"SELECT COUNT(*) FROM app_user WHERE is_active=1 AND user_id NOT IN (" +',
    '"SELECT 0 FROM DUAL WHERE 0=1 AND 0 IN (" +');
  assert.throws(() => checks.orderClearsOutsiders(bad), /목록 밖 \*\*활성\*\* 직원을 세지 않는다/);
  assert.doesNotThrow(() => checks.orderClearsOutsiders(pdb));   // 통제군
});

test('변이⑥-i: 낡은 명부를 세면서 FOR UPDATE 를 빼면 계약⑥-f 가 실패한다(판정과 갱신 사이가 열린다)', () => {
  const bad = mutate(pdb, '") FOR UPDATE"', '")"');
  assert.throws(() => checks.orderClearsOutsiders(bad), /잠그지 않고 센다/);
  assert.doesNotThrow(() => checks.orderClearsOutsiders(pdb));   // 통제군
});

test('변이⑥-g: 빈 목록 거부를 지우면 계약⑥-f 가 실패한다(전원의 서열이 NULL 이 된다)', () => {
  const bad = mutate(pdb, 'if (kept.Count == 0)', 'if (false)');
  assert.throws(() => checks.orderClearsOutsiders(bad), /목록이 통째로 비었을 때 거부하지 않는다/);
  assert.doesNotThrow(() => checks.orderClearsOutsiders(pdb));   // 통제군
});

test('변이⑤: 05-grants.sql 을 옛 SELECT 전용으로 되돌리면 계약⑤ 가 실패한다', () => {
  const bad = mutate(userGrants, 'GRANT SELECT, INSERT, UPDATE, DELETE ON `', 'GRANT SELECT ON `');
  assert.throws(() => checks.grantFiles(bad, calGrants), /넷이어야 한다/);
  assert.doesNotThrow(() => checks.grantFiles(userGrants, calGrants));   // 통제군
});

test('변이⑤-b: app_user 에서 DELETE 를 빼면 계약⑤ 가 실패한다(휴지통이 ERROR 1142 로 죽는다)', () => {
  const bad = mutate(userGrants, 'GRANT SELECT, INSERT, UPDATE, DELETE ON `', 'GRANT SELECT, INSERT, UPDATE ON `');
  assert.throws(() => checks.grantFiles(bad, calGrants), /넷이어야 한다/);
  assert.doesNotThrow(() => checks.grantFiles(userGrants, calGrants));   // 통제군
});

test('변이⑤-d: grants-calendar.sql 서술을 옛 "DELETE 없음"으로 되돌리면 계약⑤ 가 실패한다', () => {
  const bad = mutate(calGrants,
    'app_user 의 DELETE 는 휴지통 관문(ProjectDb.DeleteTrashAsync) 한 곳뿐이다',
    'app_user 의 DELETE 는 어디에도 없다');
  assert.throws(() => checks.grantFiles(userGrants, bad), /아직 "app_user DELETE 없음"이다/);
  assert.doesNotThrow(() => checks.grantFiles(userGrants, calGrants));   // 통제군
});

test('변이⑤-c: org_unit 에도 쓰기를 열면 계약⑤ 가 실패한다(이번 범위 밖)', () => {
  const bad = mutate(userGrants, "GRANT SELECT ON `', DATABASE(), '`.org_unit", "GRANT SELECT, UPDATE ON `', DATABASE(), '`.org_unit");
  assert.throws(() => checks.grantFiles(bad, calGrants), /org_unit 에 SELECT, UPDATE 을 준다/);
  assert.doesNotThrow(() => checks.grantFiles(userGrants, calGrants));   // 통제군
});

test('변이⑥: 명부 ORDER BY 에서 순번을 빼면 계약⑥ 이 실패한다(관리자가 정한 서열이 사라진다)', () => {
  const bad = mutate(pdb, '"ORDER BY o.name, u.sort_order IS NULL, u.sort_order, u.name"', '"ORDER BY o.name, u.name"');
  assert.throws(() => checks.orderIsHostOnly(bad, app), /§5\.3\(소속 → 순번/);
  assert.doesNotThrow(() => checks.orderIsHostOnly(pdb, app));   // 통제군
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
  assert.doesNotThrow(() => checks.userAdminMarkupHasNoControls(app));   // 통제군
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
  assert.doesNotThrow(() => checks.retireLivesInForm(app));   // 통제군
});

test('변이⑦-f3: 퇴사 버튼을 spacer 뒤(=[취소][저장] 옆)로 옮기면 계약⑦-e 가 실패한다', () => {
  const bad = mutate(app,
    '      <button type="button" class="btn danger" id="userEdActive" hidden>퇴사 처리</button>\n      <span class="spacer"></span>',
    '      <span class="spacer"></span>\n      <button type="button" class="btn danger" id="userEdActive" hidden>퇴사 처리</button>');
  assert.throws(() => checks.retireLivesInForm(bad), /spacer 뒤에 있다/);
  assert.doesNotThrow(() => checks.retireLivesInForm(app));   // 통제군
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
  assert.doesNotThrow(() => checks.formPickers(app));   // 통제군
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
  assert.doesNotThrow(() => checks.adminFlagComesFromHost(app));   // 통제군
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
  assert.doesNotThrow(() => checks.adminEntryButtonIsBuiltNotHidden(app));   // 통제군
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

const jsdom = useJsdom(await importOptional('jsdom'));   // 부팅 다섯 줄은 harness(runInJsdom) 한 곳에 있다

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
    'var __uaSaving = false;   // 쓰기 왕복 중인가 — 2026-09-11 부터 잠금은 **렌더가** 이 값을 보고 그린다',
    'var __uaPendingData = null;   // 미뤄 둔 명부 푸시(uaAdminBar 가 안내 줄을 낼지 판단한다)',
    //  ★ 렌더가 기억하는 두 값 — 직전에 그린 화면(__uaShown)과 잠금 동안 맡아 둔 버튼(__uaKeepBtn · R5-W3).
    'var __uaShown = null, __uaKeepBtn = null;',
    '// 이 계약과 무관한 협력자는 빈 함수로 — 여기서 보는 것은 "무엇이 그려지는가" 하나다.',
    'function userEdOpen(){} function uaSetActive(){} function uaMove(){}',
    'function uaOrderToggle(){} function uaOrderSave(){} function uaReload(){} function toast(){}',
    ...fns,
    COUNT_JS,
    'window.__probe = function(rows, admin, order){',
    '  __uaAdmin = !!admin; __uaOrder = !!order; __uaPendingData = null; __uaSaving = false;',
    '  uaAdminBar(); uaRender(rows);',
    '  return __count("uaList", "uaAdmin");',
    '};',
    //  쓰기 왕복 중에 다시 그려도 잠금이 남는가(계약⑭-b 의 DOM 쪽).
    //  ★ 여기서 재는 것은 **렌더 결과** 하나다 — uaSetSaving 은 붙박이 버튼·워치독까지 끌고 오므로 넣지 않는다.
    'window.__probeSaving = function(rows, order, saving){',
    '  __uaAdmin = true; __uaOrder = !!order; __uaPendingData = null; __uaSaving = !!saving;',
    '  uaAdminBar(); uaRender(rows);',
    '  var bar = document.getElementById("uaAdmin"), foot = document.getElementById("uaFoot");',
    '  var pick = function(box){ return Array.prototype.map.call(box.querySelectorAll("button"), function(b){',
    '    return { id: String(b.id || ""), text: String(b.textContent || ""), disabled: !!b.disabled }; }); };',
    '  return {',
    '    rowOps: Array.prototype.map.call(document.querySelectorAll("#uaList [data-uop]"), function(b){',
    '      return { uop: b.dataset.uop, uid: b.dataset.uid, disabled: !!b.disabled }; }),',
    '    bar: pick(bar), foot: pick(foot) };',
    '};',
    //  미뤄 둔 갱신이 있으면 순서 편집 막대가 그 사실을 말해야 한다(계약⑯의 DOM 쪽).
    'window.__probePending = function(rows, pending){',
    '  __uaAdmin = true; __uaOrder = true; __uaPendingData = pending ? { found: true } : null;',
    '  uaAdminBar(); uaRender(rows);',
    '  var bar = document.getElementById("uaAdmin");',
    '  return { hint: !!document.getElementById("uaPendHint"), text: String(bar.textContent || "") };',
    '};',
    //  보던 자리(스크롤)는 **같은 화면일 때만** 남는다(R5-W3) — 순서 편집을 켜면 내용이 통째로 달라지므로 맨 위가 옳다.
    'window.__probeScrollKeep = function(rows){',
    '  __uaAdmin = true; __uaOrder = false; __uaInactive = false; __uaSaving = false;',
    '  __uaShown = null; __uaKeepBtn = null;',
    '  uaRender(rows);',
    '  var list = document.getElementById("uaList");',
    '  list.scrollTop = 120;',
    '  var set = list.scrollTop;',
    '  uaRender(rows);',            // 같은 화면 — 보던 자리가 남아야 한다(잠금 렌더·호스트 푸시가 이 길이다)
    '  var same = list.scrollTop;',
    '  list.scrollTop = 120;',
    '  __uaOrder = true;',
    '  uaRender(rows);',            // 순서 편집으로 바뀌었다 — 다른 화면이므로 맨 위로
    '  var switched = list.scrollTop;',
    '  return { set: set, same: same, switched: switched };',
    '};',
    //  검색은 목록을 통째로 갈아치운다 — 그것도 '다른 화면'이다(R6-W1). 앞뒤 공백만 다른 같은 검색은
    //  같은 목록이므로 자리가 남아야 하고(정규화가 uaVisible 과 같다), 관리자 여부가 뒤집혀도 맨 위다.
    'window.__probeScrollSearch = function(rows){',
    '  __uaAdmin = true; __uaOrder = false; __uaInactive = false; __uaSaving = false;',
    '  __uaShown = null; __uaKeepBtn = null;',
    '  var q = document.getElementById("uaSearch"); q.value = "";',
    '  uaRender(rows);',
    '  var list = document.getElementById("uaList");',
    '  var one = rows.filter(function(m){ return m.name === "zzU_a"; });',
    '  list.scrollTop = 120;',
    '  var set = list.scrollTop;',
    '  q.value = "zzU_a"; uaRender(one);',            // 검색어를 쳤다 — 보이는 목록이 통째로 달라진다
    '  var searched = list.scrollTop;',
    '  list.scrollTop = 120;',
    '  q.value = "zzU_a "; uaRender(one);',           // 같은 검색(뒤 공백만 다르다) — 같은 목록이니 자리가 남는다
    '  var sameSearch = list.scrollTop;',
    '  __uaAdmin = false; uaRender(rows);',           // 관리자에서 내려갔다 — 안내 한 줄뿐인 화면
    '  list.scrollTop = 120;',
    '  __uaAdmin = true; uaRender(rows);',            // 다시 올라왔다 — 목록이 통째로 새로 선다
    '  var readmin = list.scrollTop;',
    '  return { set: set, searched: searched, sameSearch: sameSearch, readmin: readmin };',
    '};',
    //  잠금이 걸린 렌더는 행 버튼을 전부 끈다 — 그때 포커스는 **행**으로 물러나고, 풀리면 그 버튼으로 돌아온다(R5-W3).
    'window.__probeLockFocus = function(rows){',
    '  __uaAdmin = true; __uaOrder = false; __uaInactive = false; __uaSaving = false;',
    '  __uaShown = null; __uaKeepBtn = null;',
    '  uaRender(rows);',
    '  var b = document.querySelector("#uaList [data-uop=\'edit\']");',
    '  if(!b) return { found: false };',
    '  b.focus();',
    '  var started = document.activeElement === b;',
    '  var uid = String(b.dataset.uid || "");',
    '  __uaSaving = true; uaRender(rows);',
    '  var a1 = document.activeElement;',
    '  var locked = { isBody: a1 === document.body,',
    '                 line: !!(a1 && a1.classList && a1.classList.contains("mba-line")),',
    '                 uid: (a1 && a1.dataset) ? String(a1.dataset.uid || "") : "",',
    '                 kept: !!__uaKeepBtn };',
    '  __uaSaving = false; uaRender(rows);',
    '  var a2 = document.activeElement;',
    '  var unlocked = { isBody: a2 === document.body,',
    '                   uop: (a2 && a2.dataset) ? String(a2.dataset.uop || "") : "",',
    '                   uid: (a2 && a2.dataset) ? String(a2.dataset.uid || "") : "",',
    '                   disabled: !!(a2 && a2.disabled) };',
    '  return { found: true, started: started, uid: uid, locked: locked, unlocked: unlocked };',
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
    'var __uaAdmin = true, __uaOrder = true, __uaInactive = false, __uaMembers = [], __uaSaving = false;',
    'var __uaShown = null, __uaKeepBtn = null;   // 렌더가 기억하는 화면·맡아 둔 버튼(R5-W3)',
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

// (d2) 회신(uaSend 가 돌려주는 Promise)과 **부탁하지 않은** 명부 푸시(__applyMembers) — 무엇이 앉고 무엇이 미뤄지는가.
//   ★ 2026-09-14. 옛 판은 공용 회신함(__userSaved)과 푸시를 **손으로 짝지었다**(reqId 대조 · R3-W1).
//     그 짝짓기가 사라진 지금 재야 할 것이 바뀐다:
//       · 회신은 그 왕복을 시작한 **그 자리로** 돌아온다(uaSend 가 Promise 를 돌려준다).
//       · 회신에 실려 온 명부는 **정의상 내 쓰기의 결과**라, 미뤄 두지 않고 그 자리에서 앉는다.
//       · __applyMembers 로 오는 것은 **정의상 남의 갱신**이라, 순서 편집 중이면 미뤄 둔다.
//   ★ 호스트 왕복은 우리 손에 둔다(hostRequest 를 바꿔 끼운다) — 회신을 **무엇으로** 돌려줄지 시험이 정한다.
//     그리는 일(uaAdminBar·uaApply)은 빈 함수다: 여기서 재는 것은 **어느 명부가 화면 상태에 앉는가** 하나다.
//   ★ setTimeout 은 세기만 한다(바꿔치기가 아니다). 워치독이 되살아나면 그 수가 0 이 아니게 된다 —
//     '잠금이 왕복 내내 유지된다'는 지금 계약의 뼈대라, 그것을 화면 쪽에서도 잰다.
function pushHarnessJs(src) {
  return [
    'var __uaAdmin = true, __uaOrder = false, __uaInactive = false;',
    'var __uaMembers = [], __uaUnits = [], __uaTitles = [], __uaOrderBackup = null;',
    'var __uaSaving = false, __uaPendingData = null, __ueId = 0;',
    'var __toasts = [], __bars = 0, __barsFinal = 0, __barsPend = 0, HOST = true;',
    'var ICON = { alert: "!", spinner: "~" };',
    'var __sent = [], __reply = null, __timers = 0;',
    'var __realSetTimeout = window.setTimeout;',
    'window.setTimeout = function(fn, ms){ __timers++; return __realSetTimeout(fn, ms); };',
    'function hostRequest(cmd, params, timeoutMs){',
    '  __sent.push({ cmd: String(cmd), timeoutMs: timeoutMs, params: JSON.parse(JSON.stringify(params || {})) });',
    '  return Promise.resolve(__reply);',
    '}',
    'function toast(m, k){ __toasts.push({ msg: String(m), kind: String(k || "") }); }',
    //  ★ 순서 편집이 **이미 끝난 뒤**의 되그리기만 따로 센다 — 계약은 "끝냈으면 최종형을 그린다" 이고,
    //    잠금 켜기·끄기의 되그리기(그때는 아직 편집 중이다)는 그 물음의 답이 아니다.
    //  ★ __barsPend — **미뤄 둔 갱신이 있는 채로** 막대를 다시 그린 횟수. 안내 줄('명부가 갱신되었습니다')이
    //    화면에 닿을 수 있었는지는 그 순간의 __uaPendingData 가 정한다(막대 DOM 자체는 계약⑯-DOM 이 본다).
    'function uaAdminBar(){ __bars++; if(!__uaOrder) __barsFinal++; if(__uaPendingData) __barsPend++; }',
    'function uaApply(){}',
    'var __msgs = [];',
    'function userEdMsgSet(html, tone){ __msgs.push({ html: String(html == null ? "" : html), tone: String(tone || "") }); }',
    //  닫기는 **실제로 감춘다** — 닫힌 폼을 userEdSyncActive 가 다시 칠하지 않는지까지 재려면 그래야 한다.
    'var __closes = 0;',
    'function closeModal(){ __closes++; document.getElementById("userEditModal").classList.add("hidden"); }',
    'function esc(s){ return String(s); }',
    extractFunction(src, 'isOverlayOpen'),
    extractFunction(src, 'userEdSyncActive'),
    extractFunction(src, 'uaOrderReset'),
    extractFunction(src, 'uaFlushPending'),
    //  ★ 순서 편집 켜기/끄기도 떼어 온다(R4-W2) — '미뤄 둔 갱신이 남으면 언제 터지는가'가 바로 이 길이다.
    extractFunction(src, 'uaOrderToggle'),
    extractFunction(src, 'uaApplyData'),
    extractFunction(src, 'uaSetSaving'),
    extractFn(src, 'uaSend'),
    extractFunction(src, 'uaParseRoster'),
    extractFunction(src, 'uaSeatRoster'),
    //  ★ 회신 명부의 **문**(2026-09-14 좌석 일원화) — 앉힐지 미룰지를 여기서 정한다. 떼어 오지 않으면
    //    uaSend 가 부를 것이 없어, 이 하네스가 재려는 것(무엇이 앉고 무엇이 미뤄지는가)이 아예 돌지 않는다.
    extractFunction(src, 'uaSeatReply'),
    extractFunction(src, 'userEdAfterWrite'),
    extractFn(src, 'uaOrderSave'),
    windowFn(src, '__applyMembers'),
    'function __reset(rows){',
    '  __uaAdmin = true; __uaMembers = rows.slice(); __uaUnits = []; __uaTitles = [];',
    '  __uaOrder = false; __uaOrderBackup = null; __uaPendingData = null; __uaSaving = false; __ueId = 0;',
    '  __sent.length = 0; __toasts.length = 0; __msgs.length = 0;',
    '  __closes = 0; __bars = 0; __barsFinal = 0; __barsPend = 0; __timers = 0; __reply = null;',
    '  var q = document.getElementById("uaSearch"); if(q){ q.value = ""; q.disabled = false; }',
    '  var ov = document.getElementById("userEditModal"); ov.classList.add("hidden"); delete ov.dataset.busy;',
    '}',
    //  순서 편집을 켠 자리(모든 순서 시나리오의 출발점) — 「순서 저장」을 누르기 직전이다.
    'function __armOrder(rows){ __reset(rows); __uaOrder = true; __uaOrderBackup = rows.slice(); __bars = 0; __barsFinal = 0; __barsPend = 0; }',
    'function __names(){ return __uaMembers.map(function(m){ return String(m.name || ""); }); }',
    'function __state(){ return { order: !!__uaOrder, pending: !!__uaPendingData, names: __names(),',
    '                             bars: __bars, barsFinal: __barsFinal, barsPend: __barsPend, saving: !!__uaSaving }; }',
    //  폼을 연 상태를 만든다 — userEdOpen 과 **같은 규칙**으로 칠한다(그 함수는 드롭다운까지 끌고 온다).
    'function __openForm(uid){',
    '  __ueId = Number(uid);',
    '  var m = __uaMembers.filter(function(x){ return Number(x.userId) === Number(uid); })[0] || null;',
    '  var ab = document.getElementById("userEdActive");',
    '  var so = document.getElementById("userEdSort");',
    '  var off0 = !(m && m.isActive === false);',
    '  ab.hidden = !m; ab.textContent = off0 ? "퇴사 처리" : "복구";',
    '  ab.classList.toggle("danger", off0); ab.dataset.uop = off0 ? "off" : "on";',
    '  ab.dataset.uid = String(Number(uid));',
    '  so.value = (m && m.sortOrder != null) ? String(m.sortOrder) : "";',
    '  document.getElementById("userEditModal").classList.remove("hidden");',
    '}',
    'function __pickAct(){',
    '  var ab = document.getElementById("userEdActive"), so = document.getElementById("userEdSort");',
    '  return { uop: String(ab.dataset.uop || ""), text: String(ab.textContent || ""),',
    '           danger: ab.classList.contains("danger"), sort: String(so.value || "") };',
    '}',
    'function __busy(){ return String(document.getElementById("userEditModal").dataset.busy || ""); }',
    //  ① 「순서 저장」 — 편집 중에 남의 갱신이 먼저 미뤄졌고(선택), 그다음 내 회신이 온다.
    //     회신에 명부가 실려 오면 그것이 앉고, 안 실려 오면 화면에는 **내가 저장한 순서**가 남는다.
    //     끝에서 순서 편집을 켰다 끈다 — 미뤄 둔 옛 스냅샷이 남아 있으면 바로 여기서 확정 명부를 덮는다(R4-W2).
    'window.__probeOrderSave = function(rows, parked, reply){',
    '  __armOrder(rows);',
    '  if(parked) window.__applyMembers(JSON.stringify(parked));',
    '  var parkedState = __state();',
    '  __reply = reply;',
    '  return uaOrderSave().then(function(){',
    '    var end = __state();',
    '    uaOrderToggle(true); uaOrderToggle(false);',
    '    return { parked: parkedState, end: end, afterToggle: __state(),',
    '             toasts: __toasts.slice(), sent: __sent.slice(), timers: __timers };',
    '  });',
    '};',
    //  ② 부탁하지 않은 푸시 — 편집 중이면 미뤄 두고 막대가 그 사실을 말한다. 편집을 마치면 그때 앉는다.
    'window.__probeUnsolicited = function(rows, pushed){',
    '  __armOrder(rows);',
    '  window.__applyMembers(JSON.stringify(pushed));',
    '  var parked = __state();',
    '  uaOrderToggle(false);',
    '  return { parked: parked, end: __state() };',
    '};',
    //  ③ 편집 중이 아니면 그 자리에서 앉는다(그리고 열려 있는 폼도 다시 맞춘다 · R6-W3).
    'window.__probeIdlePush = function(rows, pushed, uid){',
    '  __reset(rows);',
    '  if(uid) __openForm(uid);',
    '  var before = __pickAct();',
    '  window.__applyMembers(JSON.stringify(pushed));',
    '  return { before: before, after: __pickAct(), names: __names(),',
    '           msgs: __msgs.slice(), closes: __closes, pending: !!__uaPendingData };',
    '};',
    //  ④ 폼에서 나간 쓰기 — 회신은 **이 자리로** 돌아오고, 뒤처리는 그 클로저가 한다.
    //     왕복 **중**의 잠금(dataset.busy · __uaSaving)과 걸린 타이머 수를 함께 잰다: 잠금이 왕복 내내
    //     유지되는 것이 지금 '늦은 회신이 남의 폼을 닫지 않는다'를 지탱하는 유일한 보증이다.
    'window.__probeFormReply = function(rows, uid, reply){',
    '  __reset(rows); __openForm(uid);',
    '  var before = __pickAct();',
    '  __reply = reply;',
    '  var p = uaSend({ cmd: "setUserActive", userId: uid, active: true });',
    '  var inflight = { saving: !!__uaSaving, busy: __busy(), timers: __timers };',
    '  return p.then(function(r){',
    '    userEdAfterWrite(r);',
    '    return { before: before, after: __pickAct(), reply: r, inflight: inflight,',
    '             msgs: __msgs.slice(), closes: __closes, toasts: __toasts.slice(), names: __names(),',
    '             saving: !!__uaSaving, busy: __busy(), timers: __timers, sent: __sent.slice() };',
    '  });',
    '};',
    //  ④-b 회신의 명부는 **uaSend 가 앉힌다** — 뒤처리(userEdAfterWrite)를 부르지 않아도 화면 명부는 최신이다.
    //      ★ 이것이 2026-09-14 루프가 잡아낸 자리다: 폼을 거치지 않는 쓰기(루프의 send)는 뒤처리를 부르지
    //        않으므로, 앉히는 일이 부르는 쪽에 남아 있으면 명부가 **영영 낡은 채로** 남는다(C06) — 그리고
    //        그 낡은 id 목록으로 「순서 저장」을 누르면 호스트가 「명부가 바뀌었습니다」로 되돌려준다(C08).
    'window.__probeSendSeats = function(rows, uid, reply){',
    '  __reset(rows); __openForm(uid);',
    '  __reply = reply;',
    '  return uaSend({ cmd: "setUserActive", userId: uid, active: true }).then(function(r){',
    '    return { painted: !!(r && r.painted), names: __names(), pending: !!__uaPendingData,',
    '             order: !!__uaOrder, act: __pickAct(), saving: !!__uaSaving };',
    '  });',
    '};',
    //  ④-c 순서 편집 중에 온 **내 순서 저장이 아닌** 회신은 미뤄 둔다 — 회신이든 푸시든 규칙은 하나다.
    //      (1단계 전환 뒤 이 회신이 그대로 앉아 편집 중인 순서를 덮었다 · 루프 C20)
    'window.__probeReplyDuringOrder = function(rows, reply){',
    '  __armOrder(rows);',
    '  __reply = reply;',
    '  return uaSend({ cmd: "saveUser", userId: 13, name: "x" }).then(function(r){',
    '    var parked = __state();',
    '    uaOrderToggle(false);',   // 편집을 마치면 그때 앉는다(미뤄 둔 것이 이긴다)
    '    return { painted: !!(r && r.painted), parked: parked, end: __state() };',
    '  });',
    '};',
    //  ⑤ 왕복이 도는 동안 두 번째 쓰기는 **나가지 못한다**(가드) — 겹치면 잠금 하나로 둘을 풀게 되고,
    //     그 틈에서 회신이 다시 짝을 잃는다(짝지을 표가 없는 지금은 그 가드가 유일한 문이다).
    'window.__probeConcurrentGuard = function(rows, uid, reply){',
    '  __reset(rows); __openForm(uid);',
    '  __reply = reply;',
    '  var p1 = uaSend({ cmd: "setUserActive", userId: uid, active: true });',
    '  var p2 = uaSend({ cmd: "setUserActive", userId: uid, active: false });',
    '  return Promise.all([p1, p2]).then(function(rs){',
    '    return { first: rs[0], second: rs[1], sent: __sent.slice() };',
    '  });',
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
    'var __uaAdmin = true, __uaOrder = false, __uaInactive = false, __uaMembers = [], __uaSaving = false;',
    'var __uaShown = null, __uaKeepBtn = null;   // 렌더가 기억하는 화면·맡아 둔 버튼(R5-W3)',
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

//  ★ jsdom 부팅·JSON 왕복은 harness 의 runInJsdom 한 곳에 있다(사본은 반드시 낡는다).
//    JSON 왕복이 필요한 이유: jsdom 의 Array 는 다른 realm 이라 deepStrictEqual 이
//    프로토타입 불일치로 항상 실패한다(값은 같은데 판정이 거짓말을 한다).
const FILL_FIXTURE = '<!doctype html><html><body><select id="sel"></select></body></html>';
const probeView = (src = app) => runInJsdom(VIEW_FIXTURE, viewHarnessJs(src), '__probe', ROWS);
const probeAdmin = (admin, order, src = app) => runInJsdom(ADMIN_FIXTURE, adminHarnessJs(src), '__probe', ROWS, admin, order);
const probePending = (pending, src = app) => runInJsdom(ADMIN_FIXTURE, adminHarnessJs(src), '__probePending', ROWS, pending);
const probeSaving = (order, saving, src = app) => runInJsdom(ADMIN_FIXTURE, adminHarnessJs(src), '__probeSaving', ROWS, order, saving);
const probeMove = (uid, delta, pressUop, src = app) => runInJsdom(ADMIN_FIXTURE, moveHarnessJs(src), '__probe', ROWS, uid, delta, pressUop);
const probeFill = (items, cur, blank, src = app) => runInJsdom(FILL_FIXTURE, fillHarnessJs(src), '__probe', items, cur, blank);
const probeScope = (search, inactive, admin, src = app) => runInJsdom(ADMIN_FIXTURE, scopeHarnessJs(src), '__probe', ROWS, search, inactive, admin);
const probeEntry = (role, src = app) => runInJsdom(ENTRY_FIXTURE, entryHarnessJs(src), '__probe', role);
//  회신·푸시 짝짓기(R3-W1) — 그리지 않으므로 자리만 있으면 된다(uaOrderReset 이 검색칸을 푼다).
//   ★ 폼 하단의 [퇴사 처리]/[복구] 와 읽기전용 서열 칸도 둔다(R6-W3) — 명부 푸시가 그 둘을 다시 맞춘다.
const PUSH_FIXTURE = '<!doctype html><html><body><input id="uaSearch">' +
  '<div class="overlay hidden" id="userEditModal">' +
  '<div id="userEdMsg"></div><input type="text" id="userEdSort" readonly>' +
  '<button type="button" class="btn danger" id="userEdActive" hidden>퇴사 처리</button>' +
  '</div></body></html>';
const PUSHED = { found: true, admin: true, includeInactive: false, units: [], titles: [],
  members: [{ userId: 91, loginId: 'zzUnew', name: 'zzU_새사람', title: 'zzU-T1', orgUnit: 'zzU-조직', isActive: true }] };
//  ★ '미뤄 둔 옛 스냅샷' 과 '확정 명부' 는 **서로 다른 명부**여야 한다(R4-W1·W2) — 같은 것을 쓰면
//    어느 쪽이 앉았는지 구별되지 않아, 옛 것이 새 것을 덮어써도 초록이 뜬다.
const PARKED = { found: true, admin: true, includeInactive: false, units: [], titles: [],
  members: [{ userId: 92, loginId: 'zzUold', name: 'zzU_옛명부', title: 'zzU-T1', orgUnit: 'zzU-조직', isActive: true }] };
//  ★ 「이미 복구됨」 거부 뒤의 명부 — 퇴사자였던 13 이 **이미 재직 중**으로 돌아온다(R6-W3).
const REACTIVATED = { found: true, admin: true, includeInactive: true, units: [], titles: [],
  members: [{ userId: 13, loginId: 'zzUb', name: 'zzU_b', title: 'zzU-T2', orgUnit: 'zzU-조직', isActive: true, sortOrder: 40 }] };
//  ★ 그 사람이 명부에서 **사라진** 경우(다른 관리자가 지웠다) — 폼은 닫지 않고 그 사실만 말한다.
const WITHOUT_TARGET = { found: true, admin: true, includeInactive: true, units: [], titles: [],
  members: [{ userId: 11, loginId: 'zzUa', name: 'zzU_a', title: 'zzU-T1', orgUnit: 'zzU-조직', isActive: true }] };
//  ★ 왕복이 된 뒤로 probe 도 Promise 를 돌려준다 — harness 의 runInJsdom 은 동기 창구 전용이라 여기서
//    같은 일을 한 번 더 한다(그 파일은 이 작업의 소유가 아니다). JSON 왕복 이유는 runInJsdom 과 같다:
//    jsdom 의 Array 는 다른 realm 이라 deepStrictEqual 이 프로토타입 불일치로 늘 실패한다.
async function runInJsdomAsync(fixture, js, name, ...args) {
  const dom = new jsdom.JSDOM(fixture, { runScripts: 'outside-only' });
  dom.window.eval(js);
  const fn = dom.window[name];
  assert.ok(typeof fn === 'function', `runInJsdomAsync: window.${name} 창구가 없다 — 판정 불가`);
  return JSON.parse(JSON.stringify(await fn(...args)));
}
//  회신 하나를 만드는 손잡이 — 호스트가 돌려줄 모양 { ok, msg, roster } 그대로다.
const reply = (ok, msg, roster) => ({ ok: !!ok, msg: String(msg || ''), roster: roster ? JSON.stringify(roster) : '' });
const probeOrderSave = (parked, rep, src = app) =>
  runInJsdomAsync(PUSH_FIXTURE, pushHarnessJs(src), '__probeOrderSave', ROWS, parked, rep);
const probeUnsolicited = (pushed, src = app) =>
  runInJsdomAsync(PUSH_FIXTURE, pushHarnessJs(src), '__probeUnsolicited', ROWS, pushed);
const probeIdlePush = (pushed, uid, src = app) =>
  runInJsdom(PUSH_FIXTURE, pushHarnessJs(src), '__probeIdlePush', ROWS, pushed, uid || 0);
const probeFormReply = (uid, rep, src = app) =>
  runInJsdomAsync(PUSH_FIXTURE, pushHarnessJs(src), '__probeFormReply', ROWS, uid, rep);
const probeConcurrentGuard = (uid, rep, src = app) =>
  runInJsdomAsync(PUSH_FIXTURE, pushHarnessJs(src), '__probeConcurrentGuard', ROWS, uid, rep);
const probeSendSeats = (uid, rep, src = app) =>
  runInJsdomAsync(PUSH_FIXTURE, pushHarnessJs(src), '__probeSendSeats', ROWS, uid, rep);
const probeReplyDuringOrder = (rep, src = app) =>
  runInJsdomAsync(PUSH_FIXTURE, pushHarnessJs(src), '__probeReplyDuringOrder', ROWS, rep);
const probeUaScrollKeep = (src = app) => runInJsdom(ADMIN_FIXTURE, adminHarnessJs(src), '__probeScrollKeep', ROWS);
const probeUaScrollSearch = (src = app) => runInJsdom(ADMIN_FIXTURE, adminHarnessJs(src), '__probeScrollSearch', ROWS);
const probeUaLockFocus = (src = app) => runInJsdom(ADMIN_FIXTURE, adminHarnessJs(src), '__probeLockFocus', ROWS);
//  ★ 문구의 정본은 호스트 상수 하나다 — 시험이 사본을 적으면 둘이 갈려도 초록이 뜬다.
const STALE_MSG = (/internal const string StaleRosterMsg\s*=\s*"([^"]+)"/.exec(pdb) || [])[1];
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
  skip('변이⑬-DOM: 포커스 복원을 지우면 꺼진 화살표 자리에서 버튼을 놓친다', SKIP_NO_JSDOM);
  skip('계약⑯-DOM: 미뤄 둔 갱신이 있으면 순서 편집 막대가 그 사실을 말한다', SKIP_NO_JSDOM);
  skip('계약⑯-DOM(b): 회신에 실려 온 명부는 미뤄 두지 않고 그 자리에서 앉는다', SKIP_NO_JSDOM);
  skip('계약⑯-DOM(c): 부탁하지 않은 푸시는 편집 중이면 미뤄 두고, 편집을 마칠 때 앉는다', SKIP_NO_JSDOM);
  skip('계약⑯-DOM(d): 「낡은 명부」 거부는 편집 모드를 끝내고 갱신 명부를 앉힌다', SKIP_NO_JSDOM);
  skip('계약⑯-DOM(e): 회신에 명부가 안 실려 와도 저장한 순서가 화면에 남는다', SKIP_NO_JSDOM);
  skip('계약⑯-DOM(f): 확정 명부가 앉으면 미뤄 둔 옛 스냅샷도 함께 사라진다', SKIP_NO_JSDOM);
  skip('계약⑭-DOM(d): 왕복이 도는 동안 두 번째 쓰기는 나가지 못한다', SKIP_NO_JSDOM);
  skip('계약⑭-DOM(c): 잠금은 왕복 내내 유지되고 아무 타이머도 걸리지 않는다', SKIP_NO_JSDOM);
  skip('변이⑯-DOM(b): 회신의 명부를 안 앉히면 저장한 뒤 남의 변경이 화면에 닿지 않는다', SKIP_NO_JSDOM);
  skip('변이⑯-DOM(e): 성공에서 미뤄 둔 스냅샷을 안 버리면 편집을 켰다 끄는 것만으로 되살아난다', SKIP_NO_JSDOM);
  skip('변이⑯-DOM(f): 확정 명부가 옛 스냅샷을 남기면 편집을 켰다 끄는 것만으로 덮인다', SKIP_NO_JSDOM);
  skip('변이⑭-DOM(c): 되그리기를 성공에만 걸면 늦은 거부 뒤 순서 컨트롤이 남는다', SKIP_NO_JSDOM);
  skip('계약⑭-DOM(b): 쓰기 왕복 중에 그리면 명부 쪽 버튼이 전부 잠긴 채로 나온다', SKIP_NO_JSDOM);
  skip('변이⑭-DOM(b): 렌더에서 잠금을 빼면 다시 그린 버튼이 켜진 채로 나온다', SKIP_NO_JSDOM);
  skip('계약⑱-DOM: 목록에 없는 값은 맨 위에 끼워 넣고 그대로 선택된다', SKIP_NO_JSDOM);
  skip('변이⑱-DOM: 옛 동작(첫 항목으로 갈아치우기)이면 값이 조용히 바뀐다', SKIP_NO_JSDOM);
  skip('계약⑳-DOM: 검색 중 머리줄은 걸러진 수와 전체 수를 함께 낸다', SKIP_NO_JSDOM);
  skip('계약⑬-DOM(c): 같은 화면을 다시 그리면 보던 자리가 남고, 화면이 바뀌면 맨 위다', SKIP_NO_JSDOM);
  skip('계약⑬-DOM(d): 잠기면 포커스가 행으로 물러나고, 풀리면 그 버튼으로 돌아온다', SKIP_NO_JSDOM);
  skip('변이⑬-DOM(c): 같은 화면 판정을 지우면 순서 편집으로 바뀌어도 옛 자리가 앉는다', SKIP_NO_JSDOM);
  skip('변이⑬-DOM(d): 행이 포커스를 못 받으면 잠기는 순간 포커스가 body 로 떨어진다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(e4): 회신에 실려 온 명부도 열려 있는 폼을 다시 맞춘다', SKIP_NO_JSDOM);
  skip('계약⑬-DOM(c2): 검색어가 바뀌면 맨 위, 같은 검색이면 보던 자리가 남는다', SKIP_NO_JSDOM);
  skip('변이⑬-DOM(c2): 검색어를 열쇠에서 빼면 걸러진 목록이 한가운데에서 열린다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(e2): 부탁하지 않은 명부 푸시가 오면 열려 있는 폼의 [복구]가 [퇴사 처리]로 바뀐다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(e3): 대상이 새 명부에서 사라지면 폼을 닫지 않고 그 사실만 말한다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(e2): 푸시 뒤 폼 맞추기를 지우면 낡은 [복구]가 그대로 남는다', SKIP_NO_JSDOM);
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

  //  ★ 2026-09-11(R5-W3) 이후로는 **렌더도** 누르던 버튼으로 포커스를 되돌린다 — 그래서 '가운데 행'
  //    에서는 uaFocusMoved 를 지워도 포커스가 남는다(렌더가 같은 답을 낸다). uaFocusMoved 가 혼자 지는
  //    자리는 **끝에 닿아 그 화살표가 꺼진 경우**다: 렌더는 꺼진 버튼을 피해 행으로 물러나므로,
  //    반대쪽 화살표를 잡아 주는 것은 여전히 uaFocusMoved 뿐이다. 변이는 그 자리를 친다.
  test('변이⑬-DOM: 포커스 복원을 지우면 꺼진 화살표 자리에서 버튼을 놓친다(그래서 이 계약이 필요하다)', () => {
    const bad = mutate(app, '  uaFocusMoved(userId, uop);', '  ');
    const r = probeMove(12, -1, 'up', bad);
    assert.strictEqual(r.focus.uop, '',
      `변이 전제: 복원을 지우면 포커스가 버튼이 아니라 행에 남아야 한다(실제: ${JSON.stringify(r.focus)})`);
    assert.strictEqual(probeMove(12, -1, 'up').focus.uop, 'down');   // 통제군
  });

  //  ★ ▲▼ 말고도 목록을 다시 그리는 길이 여럿이다(잠금 · 호스트 푸시 · 검색) — 그래서 **그리는 쪽**이
  //    자리를 지켜야 한다(2026-09-11 적대 검토 R5-W3). 옛 판은 uaMove 만 지켜서, 80번째 사람을 저장하면
  //    목록이 맨 위로 튀어 다음 사람을 다시 찾아야 했다.
  test('계약⑬-DOM(c): 같은 화면을 다시 그리면 보던 자리가 남고, 화면이 바뀌면 맨 위다', () => {
    const r = probeUaScrollKeep();
    assert.strictEqual(r.set, 120, '전제 붕괴: jsdom 이 scrollTop 을 기억하지 못한다 — 이 계약을 잴 수 없다');
    assert.strictEqual(r.same, 120,
      `같은 화면을 다시 그렸는데 보던 자리가 ${r.same} 로 튀었다 — 저장 한 번에 명부가 맨 위로 돌아간다(R5-W3)`);
    assert.strictEqual(r.switched, 0,
      `순서 편집으로 바뀌었는데 옛 스크롤 자리(${r.switched})가 그대로 앉았다 — 고른 적 없는 중간에서 시작한다`);
  });

  //  ★ R6-W1 — 검색도 목록을 통째로 갈아치운다. 옛 열쇠는 순서 편집·퇴사자 보기 둘뿐이라 검색 재렌더가
  //    '같은 화면'으로 읽혀, 89행을 내려다 보던 중에 검색어를 치면 걸러진 결과가 한가운데에서 열렸다.
  test('계약⑬-DOM(c2): 검색어가 바뀌면 맨 위, 같은 검색이면 보던 자리가 남는다(R6-W1)', () => {
    const r = probeUaScrollSearch();
    assert.strictEqual(r.set, 120, '전제 붕괴: jsdom 이 scrollTop 을 기억하지 못한다 — 이 계약을 잴 수 없다');
    assert.strictEqual(r.searched, 0,
      `검색어를 쳤는데 옛 스크롤 자리(${r.searched})가 그대로 앉았다 — 걸러진 결과가 목록 한가운데에서 열린다(R6-W1)`);
    assert.strictEqual(r.sameSearch, 120,
      `같은 검색(앞뒤 공백만 다름)을 다시 그렸는데 자리가 ${r.sameSearch} 로 튀었다 — 열쇠의 정규화가 uaVisible 과 어긋났다`);
    assert.strictEqual(r.readmin, 0,
      `관리자 여부가 뒤집혔다 돌아왔는데 옛 자리(${r.readmin})가 앉았다 — 목록이 통째로 새로 서는 화면이다(R6-W1)`);
  });

  test('변이⑬-DOM(c2): 검색어를 열쇠에서 빼면 걸러진 목록이 한가운데에서 열린다(R6-W1)', () => {
    const bad = mutate(app, ' && __uaShown.admin === view.admin && __uaShown.q === view.q;',
      ' && __uaShown.admin === view.admin;');
    const r = probeUaScrollSearch(bad);
    assert.strictEqual(r.searched, 120,
      `변이 전제: 검색어를 빼면 검색 재렌더가 옛 자리를 앉혀야 한다(실제: ${JSON.stringify(r)})`);
    assert.strictEqual(probeUaScrollSearch().searched, 0);   // 통제군
  });

  test('계약⑬-DOM(d): 잠기면 포커스가 행으로 물러나고, 풀리면 그 버튼으로 돌아온다', () => {
    const r = probeUaLockFocus();
    assert.strictEqual(r.found, true, '전제 붕괴: [편집] 버튼을 찾지 못했다');
    assert.strictEqual(r.started, true, '전제 붕괴: 행 버튼에 포커스를 주지 못했다');
    assert.strictEqual(r.locked.isBody, false,
      `잠기는 순간 포커스가 body 로 떨어졌다: ${JSON.stringify(r.locked)} — 여기서 Tab 이 문서 처음으로 돌아간다`);
    assert.strictEqual(r.locked.line, true,
      `잠금 중 포커스가 행(.mba-line)에 있지 않다: ${JSON.stringify(r.locked)} — 물러설 자리는 그 행이다`);
    assert.strictEqual(r.locked.uid, r.uid, `물러난 행이 누르던 그 행이 아니다: ${JSON.stringify(r.locked)}`);
    assert.strictEqual(r.locked.kept, true, '잠금 동안 되돌릴 버튼을 맡아 두지 않았다 — 풀려도 행에 남는다');
    assert.strictEqual(r.unlocked.isBody, false, '잠금이 풀리자 포커스가 body 로 떨어졌다');
    assert.strictEqual(r.unlocked.uop, 'edit',
      `잠금이 풀렸는데 누르던 버튼으로 돌아오지 않았다: ${JSON.stringify(r.unlocked)}`);
    assert.strictEqual(r.unlocked.uid, r.uid, `풀린 뒤 포커스가 다른 행으로 갔다: ${JSON.stringify(r.unlocked)}`);
    assert.strictEqual(r.unlocked.disabled, false, '되돌아온 버튼이 아직 꺼져 있다 — 잠금이 풀리지 않았다');
  });

  //  ★ jsdom 에는 레이아웃이 없어 '되돌리기를 통째로 지우는' 변이는 잴 수 없다(노드를 다 지워도
  //    scrollTop 값이 그대로 남는다). 그건 형태 계약(계약⑬-b)이 본다 — 여기서는 참·거짓이 실제로
  //    갈리는 자리, **같은 화면 판정**을 친다.
  test('변이⑬-DOM(c): 같은 화면 판정을 지우면 순서 편집으로 바뀌어도 옛 자리가 앉는다', () => {
    const bad = mutate(app, '  list.scrollTop = sameView ? keepScroll : 0;', '  list.scrollTop = keepScroll;');
    const r = probeUaScrollKeep(bad);
    assert.strictEqual(r.switched, 120,
      `변이 전제: 같은 화면 판정을 지우면 화면이 바뀌어도 옛 자리가 앉아야 한다(실제: ${JSON.stringify(r)})`);
    assert.strictEqual(probeUaScrollKeep().switched, 0);   // 통제군
  });

  test('변이⑬-DOM(d): 행이 포커스를 못 받으면 잠기는 순간 포커스가 body 로 떨어진다', () => {
    const bad = mutate(app, '    line.tabIndex = -1;   // 탭 순서에는 끼지 않는다(trRender 의 행과 같은 규칙)\n', '');
    const r = probeUaLockFocus(bad);
    assert.strictEqual(r.locked.isBody, true,
      `변이 전제: 행이 포커스를 못 받으면 잠금 렌더에서 body 로 떨어져야 한다(실제: ${JSON.stringify(r.locked)})`);
    assert.strictEqual(probeUaLockFocus().locked.isBody, false);   // 통제군
  });

  //  ★ 잠금이 **데이터가 아니라 렌더**에서 나오는지 본다(2026-09-11 적대 검토 R3-W2).
  //    옛 판은 uaSetSaving 이 노드를 걸어 다니며 껐다 — 그래서 왕복 중에 명부 푸시가 오면
  //    새로 만든 버튼이 멀쩡히 켜진 채로 섰고, 그 틈에 같은 쓰기가 두 번 나갔다.
  //    여기서는 '__uaSaving 을 켜 놓고 그냥 그린다' — 그것만으로 잠겨야 한다.
  test('계약⑭-DOM(b): 쓰기 왕복 중에 그리면 명부 쪽 버튼이 전부 잠긴 채로 나온다', () => {
    //  ① 평소(왕복 없음) — 전부 눌린다.
    const idle = probeSaving(false, false);
    assert.deepStrictEqual(idle.rowOps.map((b) => b.disabled), [false, false, false],
      `전제 붕괴: 평소에도 행 [편집]이 잠겨 있다 — ${JSON.stringify(idle.rowOps)}`);
    assert.deepStrictEqual(idle.bar.map((b) => b.disabled), [false], `평소 막대 버튼이 잠겨 있다: ${JSON.stringify(idle.bar)}`);
    assert.deepStrictEqual(idle.foot.map((b) => b.disabled), [false], `평소 [＋ 직원 등록]이 잠겨 있다: ${JSON.stringify(idle.foot)}`);
    //  ② 왕복 중 — 다시 그려도 전부 잠긴 채다.
    const busy = probeSaving(false, true);
    assert.deepStrictEqual(busy.rowOps.map((b) => b.disabled), [true, true, true],
      `왕복 중에 다시 그렸더니 행 [편집]이 켜져 있다: ${JSON.stringify(busy.rowOps)} — 결과를 기다리는 중에 다른 사람의 폼이 열린다`);
    assert.deepStrictEqual(busy.bar.map((b) => b.disabled), [true],
      `왕복 중인데 「순서 편집」이 켜져 있다: ${JSON.stringify(busy.bar)}`);
    assert.deepStrictEqual(busy.foot.map((b) => b.disabled), [true],
      `왕복 중인데 [＋ 직원 등록]이 켜져 있다: ${JSON.stringify(busy.foot)}`);
    //  ③ 순서 편집 중 — ▲▼ 와 [순서 저장]도 같은 규칙. [취소]는 화면 안의 일이라 열려 있어야 한다.
    const ord = probeSaving(true, true);
    assert.ok(ord.rowOps.length === 6 && ord.rowOps.every((b) => b.disabled),
      `순서 편집 왕복 중인데 ▲▼ 가 켜져 있다: ${JSON.stringify(ord.rowOps)} — 저장 중인 순서를 더 흔들 수 있다`);
    const save = ord.bar.find((b) => b.id === 'uaOrderSave');
    const cancel = ord.bar.find((b) => b.id === 'uaOrderCancel');
    assert.ok(save && save.disabled, `왕복 중인데 [순서 저장]이 켜져 있다: ${JSON.stringify(ord.bar)}`);
    assert.ok(cancel && !cancel.disabled, `[취소]까지 잠겼다: ${JSON.stringify(ord.bar)} — 되돌리기는 호스트 왕복과 겹치지 않는다`);
  });

  test('변이⑭-DOM(b): 렌더에서 잠금을 빼면 다시 그린 버튼이 켜진 채로 나온다(그래서 이 계약이 필요하다)', () => {
    const bad = mutate(app, '    b.disabled = __uaSaving;', '    b.disabled = false;');
    const r = probeSaving(false, true, bad);
    assert.deepStrictEqual(r.rowOps.map((b) => b.disabled), [false, false, false],
      '변이 전제: 렌더가 잠금을 보지 않으면 왕복 중에도 행 [편집]이 켜져 있어야 한다');
    assert.deepStrictEqual(probeSaving(false, true).rowOps.map((b) => b.disabled), [true, true, true]);   // 통제군
  });

  test('계약⑯-DOM: 미뤄 둔 갱신이 있으면 순서 편집 막대가 그 사실을 말한다', () => {
    const off = probePending(false);
    assert.strictEqual(off.hint, false, '미뤄 둔 갱신이 없는데 안내가 떴다');
    const on = probePending(true);
    assert.strictEqual(on.hint, true, '미뤄 둔 갱신이 있는데 안내가 없다 — 관리자는 낡은 화면인 줄 모른다');
    assert.ok(/명부가 갱신되었습니다 — 순서 편집을 마치면 반영됩니다\./.test(on.text),
      `안내 문구가 계약과 다르다: ${JSON.stringify(on.text)}`);
  });

  //  ★ 회신과 푸시가 **갈라섰다**(2026-09-14). 옛 판은 둘 다 __applyMembers 로 들어와 reqId 로 짝지어야
  //    했다 — 그 짝짓기가 어긋나면 저장한 순서가 화면에 끝내 안 보였다(R3-W1). 지금 회신은 uaSend 의
  //    Promise 로, 푸시는 __applyMembers 로 들어온다: 어느 길로 왔는지가 곧 '누구 것인가'의 답이다.
  const NEW_NAME = PUSHED.members[0].name;
  const OLD_NAME = PARKED.members[0].name;
  const OLD_NAMES = ROWS.map((m) => m.name);

  test('계약⑯-DOM(b): 회신에 실려 온 명부는 미뤄 두지 않고 그 자리에서 앉는다', async () => {
    //  편집 중에 남의 갱신이 먼저 미뤄졌고(PARKED), 내 「순서 저장」의 회신이 확정 명부(PUSHED)를 싣고 온다.
    const r = await probeOrderSave(PARKED, reply(true, '저장했습니다', PUSHED));
    assert.strictEqual(r.parked.pending, true, '전제 붕괴: 남의 푸시가 미뤄 두지 않았다');
    assert.deepStrictEqual(r.parked.names, OLD_NAMES, '전제 붕괴: 남의 푸시가 편집 중인 명부를 덮었다');
    assert.deepStrictEqual(r.end.names, [NEW_NAME],
      `회신에 실려 온 확정 명부가 앉지 않았다(${JSON.stringify(r.end.names)}) — 저장한 결과가 화면에 안 보인다`);
    assert.strictEqual(r.end.order, false, '내 저장의 결과가 왔는데 순서 편집이 끝나지 않았다');
    assert.strictEqual(r.end.pending, false,
      "회신의 명부를 앉히고도 미뤄 둔 옛 스냅샷이 남았다 — 나중에 편집을 켰다 끄면 그 옛 명부가 이긴다(R4-W2)");
    assert.deepStrictEqual(r.afterToggle.names, [NEW_NAME],
      `순서 편집을 켰다 끄자 옛 명부가 확정 명부를 덮었다: ${JSON.stringify(r.afterToggle.names)}`);
    //  왕복은 정확히 한 번, 명령·타임아웃·「퇴사자 보기」가 함께 실려 나간다.
    assert.strictEqual(r.sent.length, 1, `요청이 ${r.sent.length}번 나갔다(1번이어야 한다)`);
    assert.strictEqual(r.sent[0].cmd, 'saveUserOrder', `보낸 명령이 다르다: ${JSON.stringify(r.sent[0])}`);
    assert.strictEqual(r.sent[0].timeoutMs, 20000, `왕복 타임아웃이 20초가 아니다: ${JSON.stringify(r.sent[0])}`);
    assert.ok('includeInactive' in r.sent[0].params,
      `includeInactive 가 함께 나가지 않았다: ${JSON.stringify(r.sent[0].params)} — 호스트가 어떤 명부를 되읽을지 모른다`);
  });

  //  ★ 2026-09-14(좌석 일원화) — 여기 셋이 이번 회귀의 자리다. 1단계는 명부를 회신에 실어 보내면서
  //    **앉히는 일**을 부르는 쪽마다 남겼고, 그래서 (a) 뒤처리를 부르지 않는 쓰기는 명부를 못 앉혔고
  //    (C06·C08) (b) 순서 편집 중에 온 남의 갱신이 그대로 앉아 편집 중인 순서를 덮었다(C20).
  test('계약⑭-e-DOM: 회신의 명부는 **뒤처리를 부르지 않아도** 그 자리에서 앉는다(C06·C08 의 자리)', async () => {
    //  「이미 복구됨」 거부 — 실패 회신인데도 명부가 실려 온다(§11-32). 뒤처리(userEdAfterWrite)는 부르지 않는다:
    //  그런데도 화면 명부와 열려 있는 폼이 최신이어야 한다. 앉히는 일이 부르는 쪽에 남아 있으면 여기서 갈린다.
    const r = await probeSendSeats(13, reply(false, '이미 복구된 항목입니다 — 목록을 새로고침합니다.', REACTIVATED));
    assert.strictEqual(r.painted, true,
      "회신이 '명부가 앉았다'를 실어 오지 않았다 — 부르는 쪽이 되그릴지 판단할 근거가 사라진다(R4-W3)");
    assert.deepStrictEqual(r.names, [REACTIVATED.members[0].name],
      `회신에 실려 온 명부가 앉지 않았다: ${JSON.stringify(r.names)} — 화면 명부가 낡은 채로 남고(C06), ` +
      '그 낡은 id 목록으로 「순서 저장」을 누르면 호스트가 「명부가 바뀌었습니다」로 되돌려준다(C08)');
    assert.strictEqual(r.pending, false, '앉힌 명부가 미뤄 둔 자리에 그대로 남았다');
    assert.strictEqual(r.saving, false, '회신이 왔는데 잠금이 풀리지 않았다');
    //  ★ 열려 있는 폼도 **그 자리에서** 함께 맞는다(R6-W3) — 좌석이 uaSend 로 옮겨 가도 그 계약은 그대로다.
    assert.strictEqual(r.act.uop, 'off',
      `명부는 앉았는데 폼이 아직 [복구]를 내준다: ${JSON.stringify(r.act)} — 다시 눌러 같은 거부만 되풀이된다(R6-W3)`);
    assert.strictEqual(r.act.sort, '40', `읽기전용 서열 번호가 새 명부와 어긋난다: ${JSON.stringify(r.act)}`);
  });

  test('변이⑭-e-DOM: uaSend 에서 좌석을 빼면 명부가 영영 낡은 채로 남는다(1단계가 남긴 구멍)', async () => {
    const REP = reply(false, '이미 복구된 항목입니다 — 목록을 새로고침합니다.', REACTIVATED);
    const bad = mutate(app, SEAT_IN_SEND, SEAT_IN_SEND_GONE);
    const r = await probeSendSeats(13, REP, bad);
    assert.deepStrictEqual(r.names, OLD_NAMES,
      `변이 전제: 좌석을 빼면 화면 명부가 옛것으로 남아야 한다(실제: ${JSON.stringify(r.names)})`);
    assert.strictEqual(r.painted, false, '변이 전제: 앉힌 것이 없으므로 painted 도 거짓이어야 한다');
    const ctrl = await probeSendSeats(13, REP);
    assert.deepStrictEqual(ctrl.names, [REACTIVATED.members[0].name]);   // 통제군
  });

  test('계약⑭-e-DOM(b): 순서 편집 중에 온 **내 순서 저장이 아닌** 회신은 미뤄 둔다(C20)', async () => {
    const r = await probeReplyDuringOrder(reply(true, '저장했습니다', PUSHED));
    assert.strictEqual(r.painted, false,
      "미뤄 두고도 '앉혔다'고 답했다 — 부르는 쪽이 '이미 그렸다'로 읽어 끝난 편집 막대를 그대로 둔다");
    assert.deepStrictEqual(r.parked.names, OLD_NAMES,
      `회신에 실려 온 남의 갱신이 편집 중인 명부를 덮었다: ${JSON.stringify(r.parked.names)} — ` +
      '잡고 있던 순서가 통째로 날아간다(라운드 2·3 이 닫은 결함이 전달 방식이 바뀌었다는 이유만으로 되살아난 자리 · C20)');
    assert.strictEqual(r.parked.order, true, '회신 한 번에 순서 편집이 끝났다');
    assert.strictEqual(r.parked.pending, true, '미뤄 두지 않았다 — 편집을 마쳐도 그 변경이 사라진다');
    assert.ok(r.parked.barsPend > 0,
      "미뤄 둔 뒤 막대를 다시 그리지 않았다 — '명부가 갱신되었습니다' 안내가 화면에 닿을 자리가 없다");
    //  ★ 마칠 때는 미뤄 둔 갱신이 앉는다 — 미뤄 두기는 '버리기'가 아니다.
    assert.deepStrictEqual(r.end.names, [NEW_NAME],
      `편집을 마쳤는데 미뤄 둔 갱신이 앉지 않았다: ${JSON.stringify(r.end.names)}`);
    assert.strictEqual(r.end.pending, false, '앉힌 갱신이 미뤄 둔 자리에 그대로 남아 있다');
  });

  test('변이⑭-e-DOM(b): 회신을 미뤄 두지 않게 되돌리면 편집 중인 순서가 덮인다(C20 이 잡은 그 결함)', async () => {
    const REP = reply(true, '저장했습니다', PUSHED);
    const bad = mutate(app, "  if(__uaOrder && cmd !== 'saveUserOrder'){", '  if(false){');
    const r = await probeReplyDuringOrder(REP, bad);
    assert.deepStrictEqual(r.parked.names, [NEW_NAME],
      `변이 전제: 미뤄 두지 않으면 남의 갱신이 편집 중인 명부를 덮어야 한다(실제: ${JSON.stringify(r.parked.names)})`);
    assert.strictEqual(r.parked.pending, false, '변이 전제: 미뤄 둔 것이 없어야 한다');
    const ctrl = await probeReplyDuringOrder(REP);
    assert.deepStrictEqual(ctrl.parked.names, OLD_NAMES);   // 통제군
  });

  test('계약⑭-e-DOM(c): 「순서 저장」 회신은 편집 모드를 끝낸 **뒤** 앉고, 최종형은 한 번만 그려진다', async () => {
    const r = await probeOrderSave(null, reply(true, '저장했습니다', PUSHED));
    assert.strictEqual(r.end.order, false, '내 순서 저장의 확정 명부가 왔는데 편집 모드가 끝나지 않았다');
    assert.deepStrictEqual(r.end.names, [NEW_NAME], `확정 명부가 앉지 않았다: ${JSON.stringify(r.end.names)}`);
    assert.strictEqual(r.end.barsFinal, 1,
      `편집이 끝난 최종 화면을 ${r.end.barsFinal}번 그렸다(1번이어야 한다) — 0 이면 ▲▼·[취소]·[순서 저장]이 ` +
      '끝난 편집 화면에 그대로 남고(R4-W3), 2 이상이면 편집 중인 화면을 한 번 그린 뒤 다시 그린 것이다');
  });

  test('변이⑭-e-DOM(c): 앉힌 뒤에 편집 모드를 끄면 최종형을 아무도 그리지 않는다(끝난 편집 막대가 남는다)', async () => {
    const REP = reply(true, '저장했습니다', PUSHED);
    const bad = mutate(app, "  if(cmd === 'saveUserOrder') uaOrderReset();\n  return uaSeatRoster(json);",
      "  const seated = uaSeatRoster(json);\n  if(cmd === 'saveUserOrder') uaOrderReset();\n  return seated;");
    const r = await probeOrderSave(null, REP, bad);
    assert.strictEqual(r.end.order, false, '변이 전제: 편집 모드는 그대로 끝나야 한다(그래서 막대만 남는 것이 결함이다)');
    assert.strictEqual(r.end.barsFinal, 0,
      `변이 전제: 앉힌 뒤에 끄면 최종형을 그린 사람이 없어야 한다(실제: ${JSON.stringify(r.end)})`);
    const ctrl = await probeOrderSave(null, REP);
    assert.strictEqual(ctrl.end.barsFinal, 1);   // 통제군
  });

  test('계약⑯-DOM(c): 부탁하지 않은 푸시는 편집 중이면 미뤄 두고, 편집을 마칠 때 앉는다', async () => {
    const r = await probeUnsolicited(PUSHED);
    assert.deepStrictEqual(r.parked.names, OLD_NAMES,
      '부탁하지 않은 푸시가 편집 중인 명부를 덮어썼다 — 잡고 있던 순서가 통째로 날아간다');
    assert.strictEqual(r.parked.order, true, '부탁하지 않은 푸시가 순서 편집을 끝냈다');
    assert.strictEqual(r.parked.pending, true, '미뤄 두지 않았다 — 편집을 마쳐도 그 변경이 사라진다');
    assert.ok(r.parked.bars > 0,
      "막대를 다시 그리지 않았다 — '명부가 갱신되었다'는 안내가 화면에 닿지 않는다");
    assert.deepStrictEqual(r.end.names, [NEW_NAME],
      `편집을 마쳤는데 미뤄 둔 갱신이 앉지 않았다: ${JSON.stringify(r.end.names)}`);
    assert.strictEqual(r.end.pending, false, '앉힌 갱신이 미뤄 둔 자리에 그대로 남아 있다');
  });

  test('계약⑯-DOM(d): 「낡은 명부」 거부는 편집 모드를 끝내고 갱신 명부를 앉힌다', async () => {
    assert.ok(STALE_MSG, 'ProjectDb 의 StaleRosterMsg 를 읽지 못했다 — 판정 불가');
    //  ① 거부가 갱신 명부를 함께 싣고 온다(호스트의 보통 길)
    const a = await probeOrderSave(null, reply(false, STALE_MSG, PUSHED));
    assert.strictEqual(a.end.order, false,
      '「낡은 명부」 거부를 받고도 순서 편집이 이어진다 — 관리자는 같은 낡은 명부로 같은 거부만 되풀이한다');
    assert.deepStrictEqual(a.end.names, [NEW_NAME], `거부에 실려 온 갱신 명부가 앉지 않았다: ${JSON.stringify(a.end)}`);
    //  ② 거부가 명부를 못 싣고 왔지만 미뤄 둔 갱신이 있다 — 그것을 앉힌다.
    const b = await probeOrderSave(PARKED, reply(false, STALE_MSG, null));
    assert.strictEqual(b.end.order, false, '명부가 안 실려 온 거부에서도 편집 모드는 끝나야 한다');
    assert.deepStrictEqual(b.end.names, [OLD_NAME],
      `미뤄 둔 갱신을 거부 처리에서 앉히지 않았다: ${JSON.stringify(b.end)} — 낡은 명부로 같은 거부를 되풀이한다`);
    assert.strictEqual(b.end.pending, false, '앉힌 갱신이 미뤄 둔 자리에 그대로 남아 있다');
    //  ③ 다른 문구의 실패는 편집 모드를 끝내지 않는다(권한 거부 등은 다시 시도할 여지가 있다).
    const c = await probeOrderSave(null, reply(false, '관리자만 사용할 수 있습니다.', null));
    assert.strictEqual(c.end.order, true,
      '「낡은 명부」가 아닌 실패에도 편집 모드를 끝낸다 — 잡고 있던 순서가 사라진다');
    assert.deepStrictEqual(c.end.names, OLD_NAMES, '실패했는데 명부가 바뀌었다');
  });

  //  ★ 2026-09-11 적대 검토 R4-W1 — 미뤄 둔 스냅샷은 **내 저장이 서버에 닿기 전**의 명부다.
  //    성공에서 그것을 앉히면 방금 저장한 순서가 화면에서 옛 순서로 되돌아간다. 확정 명부는 회신이 싣고 온다.
  test('계약⑯-DOM(e): 회신에 명부가 안 실려 와도 저장한 순서가 화면에 남는다', async () => {
    const r = await probeOrderSave(PARKED, reply(true, '저장했습니다', null));
    assert.strictEqual(r.parked.pending, true, '전제 붕괴: 남의 푸시가 미뤄 두지 않았다');
    assert.strictEqual(r.end.order, false, '순서 저장 성공인데 편집 모드가 끝나지 않았다');
    assert.deepStrictEqual(r.end.names, OLD_NAMES,
      `성공 회신이 옛 스냅샷을 앉혔다(${JSON.stringify(r.end.names)}) — 방금 저장한 순서가 저장 전 명부로 되돌아간다(R4-W1)`);
    assert.strictEqual(r.end.pending, false,
      '성공 회신이 미뤄 둔 옛 스냅샷을 남겼다 — 나중에 편집을 켰다 끄면 그 옛 명부가 확정 명부를 덮는다(R4-W2)');
    assert.deepStrictEqual(r.afterToggle.names, OLD_NAMES,
      `순서 편집을 켰다 끄자 옛 명부가 되살아났다: ${JSON.stringify(r.afterToggle.names)}`);
    assert.ok(r.end.barsFinal > 0,
      '편집 모드를 끝내고도 아무도 최종형을 다시 그리지 않았다 — ▲▼·[취소]·[순서 저장]이 끝난 편집 화면에 그대로 남는다(R4-W3)');
  });

  //  ★ 거부 + 명부가 함께 온 자리로 잰다 — 성공 갈래는 uaOrderSave 가 스스로 미뤄 둔 것을 버리므로
  //    'uaSeatRoster 가 버리는가'를 가릴 수 없다(둘 중 누가 버렸는지 구별되지 않는다).
  test('계약⑯-DOM(f): 확정 명부가 앉으면 미뤄 둔 옛 스냅샷도 함께 사라진다', async () => {
    const r = await probeOrderSave(PARKED, reply(false, STALE_MSG, PUSHED));
    assert.strictEqual(r.end.pending, false,
      '확정 명부를 앉히고도 옛 스냅샷이 미뤄 둔 자리에 남아 있다 — 편집을 켰다 끄면 그것이 이긴다(R4-W2)');
    assert.deepStrictEqual(r.afterToggle.names, [NEW_NAME],
      `순서 편집을 켰다 끄자 옛 명부가 확정 명부를 덮었다: ${JSON.stringify(r.afterToggle.names)}`);
  });

  //  ★ 2026-09-14 — 왕복이 도는 동안 **두 번째 쓰기는 나가지 못한다**. 짝지을 표가 사라진 지금, 두 왕복이
  //    겹치면 잠금 하나로 둘을 풀게 되고 그 틈에서 회신이 다시 짝을 잃는다. 가드가 그 유일한 문이다.
  test('계약⑭-DOM(d): 왕복이 도는 동안 두 번째 쓰기는 나가지 못한다(회신이 짝을 잃지 않는다)', async () => {
    const r = await probeConcurrentGuard(13, reply(true, '저장했습니다', null));
    assert.strictEqual(r.sent.length, 1, `가드를 뚫고 요청이 ${r.sent.length}번 나갔다(1번이어야 한다)`);
    assert.ok(r.first && r.first.ok === true, `첫 왕복이 회신을 받지 못했다: ${JSON.stringify(r.first)}`);
    assert.strictEqual(r.second, null,
      `두 번째 호출이 회신처럼 생긴 값을 돌려줬다: ${JSON.stringify(r.second)} — '못 보냈다'와 '회신이 왔다'가 구별되지 않는다`);
  });

  //  ★ R6-W3 — "이미 복구된 항목입니다 — 목록을 새로고침합니다."(AlreadyActiveMsg) 로 거부당하면
  //    호스트가 약속대로 갱신 명부를 **그 거부와 함께** 돌려준다(§11-32). 그런데 열려 있는 폼의 [복구] 는
  //    userEdOpen 이 열 때 한 번 정한 그대로라, 다시 누르면 같은 거부만 되풀이됐다.
  test('계약⑦-DOM(e2): 부탁하지 않은 명부 푸시가 오면 열려 있는 폼의 [복구]가 [퇴사 처리]로 바뀐다(R6-W3)', () => {
    const r = probeIdlePush(REACTIVATED, 13);
    assert.strictEqual(r.before.uop, 'on', `전제 붕괴: 퇴사자의 폼이 [복구]로 서지 않았다: ${JSON.stringify(r.before)}`);
    assert.strictEqual(r.before.text, '복구', `전제 붕괴: ${JSON.stringify(r.before)}`);
    assert.strictEqual(r.after.uop, 'off',
      `푸시가 왔는데 폼이 아직 [복구]를 내준다: ${JSON.stringify(r.after)} — 다시 누르면 같은 거부만 되풀이된다(R6-W3)`);
    assert.strictEqual(r.after.text, '퇴사 처리', `버튼 문구가 새 명부와 어긋난다: ${JSON.stringify(r.after)}`);
    assert.strictEqual(r.after.danger, true, '재직 중인데 파괴 표시(danger)가 붙지 않았다 — [퇴사 처리]는 파괴적 동작이다');
    assert.strictEqual(r.after.sort, '40',
      `읽기전용 서열 번호가 새 명부와 어긋난다: ${JSON.stringify(r.after)} — 남이 순서를 저장하면 그 숫자가 바뀐다`);
    assert.strictEqual(r.closes, 0, '푸시 한 번에 폼이 닫혔다 — 적어 둔 편집이 말없이 사라진다');
  });

  //  ★ 그리고 **거부 회신에 실려 온 명부**도 같은 일을 해야 한다 — 그것이 AlreadyActiveMsg 의 진짜 길이다.
  test('계약⑦-DOM(e4): 회신에 실려 온 명부도 열려 있는 폼을 다시 맞춘다(거부 문장은 폼에 남는다)', async () => {
    const MSG = '이미 복구된 항목입니다 — 목록을 새로고침합니다.';
    const r = await probeFormReply(13, reply(false, MSG, REACTIVATED));
    assert.strictEqual(r.before.uop, 'on', `전제 붕괴: 퇴사자의 폼이 [복구]로 서지 않았다: ${JSON.stringify(r.before)}`);
    assert.strictEqual(r.closes, 0, '실패했는데 폼을 닫았다 — 관리자가 무엇을 고쳐야 하는지 읽을 자리가 사라진다');
    assert.ok(r.msgs.some((m) => m.html.includes(MSG) && m.tone === 'err'),
      `호스트의 거부 사유가 폼에 그대로 뜨지 않았다: ${JSON.stringify(r.msgs)}`);
    assert.strictEqual(r.after.uop, 'off',
      `거부에 실려 온 명부로 폼을 다시 맞추지 않았다: ${JSON.stringify(r.after)} — 낡은 [복구]를 다시 눌러 같은 거부가 되풀이된다(R6-W3)`);
    assert.deepStrictEqual(r.names, [REACTIVATED.members[0].name],
      `거부에 실려 온 명부가 앉지 않았다: ${JSON.stringify(r.names)}`);
  });

  test('계약⑦-DOM(e3): 대상이 새 명부에서 사라지면 폼을 닫지 않고 그 사실만 말한다(R6-W3)', () => {
    const r = probeIdlePush(WITHOUT_TARGET, 13);
    assert.strictEqual(r.closes, 0, '대상이 사라졌다고 폼을 닫았다 — 적어 둔 편집이 통째로 사라진다');
    assert.strictEqual(r.after.uop, r.before.uop,
      `명부에 없는 사람인데 폼의 상태를 바꿨다: ${JSON.stringify(r.after)} — 맞출 근거가 없다`);
    assert.ok(r.msgs.some((m) => /대상 직원을 찾을 수 없습니다/.test(m.html) && m.tone === 'err'),
      `대상이 사라졌는데 폼이 아무 말도 하지 않는다: ${JSON.stringify(r.msgs)} — 관리자는 모른 채 [저장]을 누른다`);
  });

  test('변이⑦-DOM(e2): 푸시 뒤 폼 맞추기를 지우면 낡은 [복구]가 그대로 남는다(R6-W3)', () => {
    const bad = mutate(app, '  uaApplyData(d);\n  userEdSyncActive();   // ★ 열려 있는 편집 폼의 퇴사/복구 상태도 이 명부에 맞춘다(R6-W3)\n};',
      '  uaApplyData(d);\n};');
    const r = probeIdlePush(REACTIVATED, 13, bad);
    assert.strictEqual(r.after.uop, 'on',
      `변이 전제: 맞추기를 지우면 폼이 [복구]로 남아야 한다(실제: ${JSON.stringify(r.after)})`);
    assert.strictEqual(probeIdlePush(REACTIVATED, 13).after.uop, 'off');   // 통제군
  });

  //  ★ 2026-09-14 — 잠금은 왕복 **내내** 유지된다. 옛 판에는 12초 워치독이 있어서, 그것이 잠금을 푸는
  //    순간 [편집]·[＋ 직원 등록]·폼 닫기가 열렸고 거기서 R2-W1(늦은 회신이 새 폼을 닫는다)이 태어났다.
  //    표로 가려내는 대신 **틈 자체를 없앴다** — 그러니 '아무 타이머도 걸리지 않는다'가 그 계약이다.
  test('계약⑭-DOM(c): 잠금은 왕복 내내 유지되고 아무 타이머도 걸리지 않는다', async () => {
    const r = await probeFormReply(13, reply(true, '저장했습니다', null));
    assert.strictEqual(r.inflight.saving, true, '왕복이 도는데 __uaSaving 이 서지 않았다');
    assert.strictEqual(r.inflight.busy, '1',
      '왕복이 도는데 #userEditModal 의 dataset.busy 가 서지 않았다 — Esc 로 닫으면 결과를 알릴 곳이 사라진다');
    assert.strictEqual(r.inflight.timers, 0,
      `왕복을 시작하면서 타이머를 걸었다(${r.inflight.timers}개) — 워치독이 되살아나면 잠금이 도중에 풀리고, 그 틈에서 회신이 다시 짝을 잃는다`);
    assert.strictEqual(r.timers, 0, `회신 처리에서 타이머를 걸었다(${r.timers}개)`);
    assert.strictEqual(r.saving, false, '회신이 왔는데 잠금이 풀리지 않았다');
    assert.strictEqual(r.busy, '', '회신이 왔는데 dataset.busy 가 남았다 — 창을 닫을 길이 없다');
    assert.strictEqual(r.closes, 1, '성공했는데 폼이 닫히지 않았다');
    assert.deepStrictEqual(r.toasts.map((t) => t.kind), ['success'], `결과 안내가 다르다: ${JSON.stringify(r.toasts)}`);
  });

  test('변이⑭-DOM(c2): 워치독을 되살리면 왕복 도중에 타이머가 걸린다(그래서 이 계약이 필요하다)', async () => {
    const bad = mutate(app, '  if(changed){\n    uaAdminBar();\n    uaApply();\n  }\n  return changed;\n}',
      '  if(changed){\n    uaAdminBar();\n    uaApply();\n  }\n  if(on) setTimeout(() => uaSetSaving(false), 12000);\n  return changed;\n}');
    const r = await probeFormReply(13, reply(true, '저장했습니다', null), bad);
    assert.ok(r.inflight.timers > 0,
      `변이 전제: 워치독을 되살리면 왕복 중에 타이머가 걸려 있어야 한다(실제: ${JSON.stringify(r.inflight)})`);
    const ctrl = await probeFormReply(13, reply(true, '저장했습니다', null));
    assert.strictEqual(ctrl.inflight.timers, 0);   // 통제군
  });

  test('변이⑯-DOM(b): 회신의 명부를 안 앉히면 저장한 뒤 남의 변경이 화면에 닿지 않는다', async () => {
    //  ★ 2026-09-14: 좌석이 uaSend 로 모였으므로 '안 앉힌다' 변이도 그 자리를 친다(옛 변이는 uaOrderSave 의
    //    uaSeatRoster 한 줄이었다 — 그 줄은 이제 없다).
    const bad = mutate(app, SEAT_IN_SEND, SEAT_IN_SEND_GONE);
    const r = await probeOrderSave(null, reply(true, '저장했습니다', PUSHED), bad);
    assert.deepStrictEqual(r.end.names, OLD_NAMES,
      `변이 전제: 회신의 명부를 안 앉히면 화면에 옛 명부가 남아야 한다(실제: ${JSON.stringify(r.end.names)})`);
    const ctrl = await probeOrderSave(null, reply(true, '저장했습니다', PUSHED));
    assert.deepStrictEqual(ctrl.end.names, [NEW_NAME]);   // 통제군
  });

  test('변이⑯-DOM(e): 성공에서 미뤄 둔 스냅샷을 안 버리면 편집을 켰다 끄는 것만으로 되살아난다', async () => {
    const bad = mutate(app, '  if(r.ok) __uaPendingData = null;\n', '');
    const r = await probeOrderSave(PARKED, reply(true, '저장했습니다', null), bad);
    assert.strictEqual(r.end.pending, true,
      `변이 전제: 버리지 않으면 미뤄 둔 자리에 남아야 한다(실제: ${JSON.stringify(r.end)})`);
    assert.deepStrictEqual(r.afterToggle.names, [OLD_NAME],
      `변이 전제: 남은 스냅샷은 편집을 켰다 끄면 앉아야 한다(실제: ${JSON.stringify(r.afterToggle)})`);
    const ctrl = await probeOrderSave(PARKED, reply(true, '저장했습니다', null));
    assert.deepStrictEqual(ctrl.afterToggle.names, OLD_NAMES);   // 통제군
  });

  test('변이⑯-DOM(f): 확정 명부가 옛 스냅샷을 남기면 편집을 켰다 끄는 것만으로 덮인다', async () => {
    const bad = mutate(app, '  __uaPendingData = null;\n  uaApplyData(d);\n  userEdSyncActive();   // ★ 열려 있는 편집 폼의 퇴사/복구 상태도 이 명부에 맞춘다(R6-W3)\n  return true;',
      '  uaApplyData(d);\n  userEdSyncActive();   // ★ 열려 있는 편집 폼의 퇴사/복구 상태도 이 명부에 맞춘다(R6-W3)\n  return true;');
    const r = await probeOrderSave(PARKED, reply(false, STALE_MSG, PUSHED), bad);
    assert.strictEqual(r.end.pending, true,
      `변이 전제: 옛 스냅샷을 안 버리면 미뤄 둔 자리에 남아야 한다(실제: ${JSON.stringify(r.end)})`);
    assert.deepStrictEqual(r.afterToggle.names, [OLD_NAME],
      `변이 전제: 남은 스냅샷은 편집을 켰다 끄면 확정 명부를 덮어야 한다(실제: ${JSON.stringify(r.afterToggle)})`);
    const ctrl = await probeOrderSave(PARKED, reply(false, STALE_MSG, PUSHED));
    assert.deepStrictEqual(ctrl.afterToggle.names, [NEW_NAME]);   // 통제군
  });

  test('변이⑭-DOM(c): 되그리기를 성공에만 걸면 거부 뒤 순서 컨트롤이 남는다', async () => {
    const bad = mutate(app, '  if(!painted && (r.ok || staleRoster)){ uaAdminBar(); uaApply(); }',
      '  if(!painted && r.ok){ uaAdminBar(); uaApply(); }');
    const r = await probeOrderSave(null, reply(false, STALE_MSG, null), bad);
    assert.strictEqual(r.end.order, false, '변이 전제: 편집 모드는 그대로 끝나야 한다(그래서 컨트롤만 남는 것이 결함이다)');
    assert.strictEqual(r.end.barsFinal, 0,
      `변이 전제: 성공에만 걸면 거부에서 아무도 최종형을 그리지 않아야 한다(실제: ${JSON.stringify(r.end)})`);
    const ctrl = await probeOrderSave(null, reply(false, STALE_MSG, null));
    assert.ok(ctrl.end.barsFinal > 0);   // 통제군
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
  assert.ok(/IF\(@v = '11'/.test(stripSqlComments(migrateIntSql)), '통제군: 원본은 통과해야 한다');
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
  assert.ok(/LoadMembersJsonAsync\(s\.LoginId, includeInactive, flatOrder: true\)/.test(mw), '쓰기 뒤 회신에 실을 명부(ReadMembersJsonAsync)가 flat 이 아니다 — 저장 직후 편집 화면이 소속 순으로 튄다');
});
test('변이⑥-c: uaReload 에서 flat:true 를 빼면 계약⑥-c 가 실패한다', () => {
  const body = extractFunction(app, 'uaReload'); const bad = app.replace(body, body.replace(', flat: true', ''));
  assert.notStrictEqual(bad, app, '변이가 적용되지 않았다');
  const m = /hostRequest\('membersGet',\s*\{([^}]*)\}/.exec(extractFunction(bad, 'uaReload'));
  assert.ok(m && !/\bflat:\s*true\b/.test(m[1]), '변이본이 계약⑥-c 를 통과한다 — 검사가 무효');
  const m0 = /hostRequest\('membersGet',\s*\{([^}]*)\}/.exec(extractFunction(app, 'uaReload'));
  assert.ok(m0 && /\bflat:\s*true\b/.test(m0[1]), '통제군: 원본은 통과해야 한다');
});
test('변이⑥-d: openMembers 에 flat:true 를 넣으면 계약⑥-c 가 실패한다(보기 화면까지 전사 서열이 된다)', () => {
  const body = extractFunction(app, 'openMembers'); const bad = app.replace(body, body.replace('{ includeInactive: false }', '{ includeInactive: false, flat: true }'));
  assert.notStrictEqual(bad, app, '변이가 적용되지 않았다');
  const m = /hostRequest\('membersGet',\s*\{([^}]*)\}/.exec(extractFunction(bad, 'openMembers'));
  assert.ok(m && /\bflat\b/.test(m[1]), '변이본이 계약⑥-c 를 통과한다 — 검사가 무효');
  const m0 = /hostRequest\('membersGet',\s*\{([^}]*)\}/.exec(extractFunction(app, 'openMembers'));
  assert.ok(m0 && !/\bflat\b/.test(m0[1]), '통제군: 원본은 통과해야 한다');
});
