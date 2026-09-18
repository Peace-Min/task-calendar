// 직급·소속 관리 — 호스트 계약(docs/ORG-TITLE-ADMIN.md §4 · §6 · §7)
//
// 이 파일이 존재하는 이유:
//   「직급·소속 관리」는 **사람의 직급·소속 마스터**(title_code · org_unit)를 앱에서 고치는 첫 화면이다.
//   그 두 표는 앱 계정이 지금까지 **읽기만** 하던 표였다. 열어 주는 순간 지켜야 할 것이 여섯이다:
//     ① 아홉 쓰기와 조회가 전부 **관리자 관문**(OpenAdminAsync)을 지난다. 그리고 이 구역에 DELETE 는 없다
//        (이 판은 숨김까지 · §2). 관문 우회 '형태'는 admin-auth.test.mjs 가 훑고, 여기서는 그 위에 얹히는
//        계약 — 어느 관문인가·삭제가 없는가 — 을 이름으로 못 박는다.
//     ② 숨김 판정(재직자·활성 하위 수)은 **쓰기와 같은 트랜잭션**에서 FOR UPDATE 로 다시 센다. 조회가
//        실어 보낸 users·children 은 화면 힌트다 — 힌트로 판정하면 세는 사이에 들어온 사람이 빠져나간다.
//     ③ 상위 변경에는 **조상 사슬 순환 검사**가 있고, 최상위(NULL)·자기 자신으로는 못 옮긴다.
//     ④ 순서 저장은 **활성 전부**가 와야 한다(집합 대조) — 빠진 것이 있으면 아무것도 쓰지 않고 거부한다.
//        받아들이면 10 간격으로 전량 재작성한다(절반만 다시 매기면 목록 밖 값이 새 번호 사이에 낀다).
//     ⑤ 브리지는 열 명령을 받고, 쓰기 회신에 갱신 목록(orgTitle)을 싣는다. 거부 둘(낡음·이미 그 상태)도
//        목록을 실어 준다 — 그 약속을 안 지키면 관리자가 낡은 화면으로 같은 거부만 반복한다.
//     ⑥ GRANT 세 파일이 org_unit·title_code 에 SELECT·INSERT·UPDATE 를 주고 **DELETE 는 주지 않는다**.
//        빠지면 첫 쓰기가 ERROR 1142 다(휴지통이 2026-09-10 에 겪은 그 사고와 같은 모양).
//
//   ★ 값을 시험에 박되, 박는 것은 **설계 문서의 문장**뿐이다 — 문구가 바뀌면 문서와 함께 바뀌어야 한다.
//   ★ 못 읽은 기준 파일은 통과가 아니라 실패(또는 사유 있는 skip)다.
import { readFileSync } from 'node:fs';
import { test, skip, assert, stripCsComments as stripCs, extractCsMember as csMember } from './harness.mjs';

const pdb  = readFileSync(new URL('../widget/ProjectDb.cs', import.meta.url), 'utf8');
const main = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');

// ── 기준 파일 ───────────────────────────────────────────────────────
//   ★ 비공개 05-grants.sql 은 **형제 폴더**(taskmgr-company-data)에 있다. 없는 체크아웃도 있으므로
//     '사유 있는 skip' 으로 강등한다 — 다만 있는 곳에서는 반드시 본다(있으면 검사, 없으면 사유).
const missing = [];
const readOr = (rel, label) => {
  try { return readFileSync(new URL(rel, import.meta.url), 'utf8'); } catch (_) { missing.push(label); return ''; }
};
const CREATE_USER = 'db/deploy/create-app-user.sql';
const CAL_GRANTS  = 'db/deploy/grants-calendar.sql';
const DEPLOY_MD   = 'DEPLOY.md';
const USER_GRANTS = 'taskmgr-company-data/05-grants.sql';
const createUser = readOr('../' + CREATE_USER, CREATE_USER);
const calGrants  = readOr('../' + CAL_GRANTS, CAL_GRANTS);
const deployMd   = readOr('../' + DEPLOY_MD, DEPLOY_MD);
let userGrants = '';
try { userGrants = readFileSync(new URL('../../' + USER_GRANTS, import.meta.url), 'utf8'); } catch (_) { userGrants = ''; }

function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

//  브리지의 case 한 토막 — break; 까지.
function csCase(source, name) {
  const code = stripCs(source);
  const s = code.indexOf('case "' + name + '":');
  assert.ok(s >= 0, `호스트 case "${name}" 을 찾지 못함 — 판정 불가`);
  const e = code.indexOf('break;', s);
  assert.ok(e > s, `case "${name}" 의 break; 를 찾지 못함 — 판정 불가`);
  return code.slice(s, e + 6);
}

// ── 이 화면이 가진 것들(설계 §4) ────────────────────────────────────
const TITLE_SIGS = {
  TitleAddAsync:       'public async Task<(bool ok, string msg)> TitleAddAsync(',
  TitleRenameAsync:    'public async Task<(bool ok, string msg)> TitleRenameAsync(',
  TitleSetActiveAsync: 'public async Task<(bool ok, string msg)> TitleSetActiveAsync(',
  TitleReorderAsync:   'public async Task<(bool ok, string msg)> TitleReorderAsync(',
  UnitAddAsync:        'public async Task<(bool ok, string msg)> UnitAddAsync(',
  UnitRenameAsync:     'public async Task<(bool ok, string msg)> UnitRenameAsync(',
  UnitSetActiveAsync:  'public async Task<(bool ok, string msg)> UnitSetActiveAsync(',
  UnitMoveAsync:       'public async Task<(bool ok, string msg)> UnitMoveAsync(',
  UnitReorderAsync:    'public async Task<(bool ok, string msg)> UnitReorderAsync(',
};
const LOAD_SIG = 'public async Task<string?> LoadOrgTitleJsonAsync(';
//  브리지 열 명령 → 그것이 닿아야 할 ProjectDb 함수.
const BRIDGE = [
  ['orgTitleGet', 'LoadOrgTitleJsonAsync'],
  ['titleAdd', 'TitleAddAsync'], ['titleRename', 'TitleRenameAsync'],
  ['titleSetActive', 'TitleSetActiveAsync'], ['titleReorder', 'TitleReorderAsync'],
  ['unitAdd', 'UnitAddAsync'], ['unitRename', 'UnitRenameAsync'],
  ['unitSetActive', 'UnitSetActiveAsync'], ['unitMove', 'UnitMoveAsync'],
  ['unitReorder', 'UnitReorderAsync'],
];
//  ★ 조회는 목록을 그 자리에서 싣는다(orgTitle 을 따로 붙이지 않는다) — 회신에 orgTitle 을 요구하는 것은 **아홉 쓰기**다.
const WRITE_CMDS = BRIDGE.slice(1);

//  설계 §5.2 의 문장들(정본은 ProjectDb 의 상수다 — 여기 적힌 것은 '그 문장이 사라지지 않았는가'의 증거다).
const ROOT_HIDE_MSG   = '최상위 조직은 숨길 수 없습니다';
const PARENT_HIDE_MSG = '상위 조직을 먼저 복구하세요';
//  §11-2 정정 — GRANT 누락(1142)은 자기 문장을 갖는다. 루프(loop-org-title.mjs)가 이 문장을 보고
//  '고장'이 아니라 '아직 안 한 일'(exit 2)로 끝내므로, 글자가 바뀌면 그 판정도 함께 멈춘다.
const GRANT_MISSING_MSG = 'DB 권한이 없습니다\\(1142\\) — 서버에 직급·소속 GRANT 를 적용해야 합니다\\(DEPLOY §0-5\\)\\.';

// ══════════════════════════════════════════════════════════════════════
//  계약
// ══════════════════════════════════════════════════════════════════════

const checks = {
  // ① 아홉 쓰기 + 조회가 관리자 관문만 연다 · 이 구역에 DELETE 문이 없다.
  adminGateOnly(cs) {
    for (const [name, sig] of Object.entries(TITLE_SIGS)) {
      const b = csMember(cs, sig);
      //  단언 순서는 '원인을 정확히 말하는 쪽'이 앞이다(admin-auth 와 같은 규율) — 쓰기 관문으로 내려간
      //  변이는 '관리자 관문이 없다'로도 잡히지만, 그 문장은 무엇을 잘못했는지 말해 주지 않는다.
      assert.ok(!/OpenWriteAsync\(/.test(b),
        `${name} 가 쓰기 관문(editor 통과)으로 연결을 연다 — 발주처·코드값과 달리 이 둘은 admin 전용이다`);
      assert.ok(!/OpenReadAsync\(/.test(b), `${name} 가 읽기 관문으로 연결을 열고 마스터를 쓴다(권한 검사 우회)`);
      assert.ok(/OpenAdminAsync\(/.test(b),
        `${name} 가 관리자 관문을 지나지 않는다 — 사람의 직급·소속은 관리자의 것이다(ORG-TITLE-ADMIN §2)`);
      assert.ok(!/DELETE\s+FROM/i.test(b),
        `${name} 에 DELETE 문이 있다 — 이 판은 숨김(is_active=0)까지고 행은 남는다(§2 삭제 없음)`);
    }
    const load = csMember(cs, LOAD_SIG);
    assert.ok(/OpenAdminAsync\(/.test(load),
      'LoadOrgTitleJsonAsync 가 관리자 관문을 지나지 않는다 — 조회도 관리자 전용이다(§4.1)');
    assert.ok(!/OpenWriteAsync\(|OpenReadAsync\(/.test(load), '직급·소속 조회가 관리자 아닌 관문으로 연결을 연다');
    //  조회의 3분기 — '볼 수 없는 사람'(admin:false)과 '서버가 안 된다'(found:false)를 갈라야 한다.
    assert.ok(/\["found"\] = true, \["admin"\] = false/.test(load),
      '비관리자에게 {found:true, admin:false} 를 돌려주지 않는다 — 화면이 "서버가 안 된다"와 구별할 수 없다');
    assert.ok(/\["admin"\]\s*=\s*true/.test(load), '관리자 회신에 admin:true 가 없다');
  },

  // ② 숨김 판정은 쓰기와 **같은 트랜잭션**이다 — FOR UPDATE 로 잡은 채 센다(§4.1 ★).
  hideJudgedInSameTx(cs) {
    const t = csMember(cs, TITLE_SIGS.TitleSetActiveAsync);
    const txT = t.indexOf('BeginTransactionAsync');
    assert.ok(txT >= 0, 'TitleSetActiveAsync 가 트랜잭션을 열지 않는다 — 판정과 갱신 사이가 열려 있다');
    const cntT = t.indexOf('SELECT COUNT(*) FROM app_user WHERE title=@n AND is_active=1 FOR UPDATE');
    assert.ok(cntT > txT,
      '직급 숨김의 재직자 세기가 트랜잭션 **밖**(또는 FOR UPDATE 없이)이다 — 세는 사이에 그 직급으로 옮겨 온 사람이 판정을 빠져나간다');
    assert.ok(/FOR UPDATE/.test(t.slice(0, cntT)), '대상 직급 행을 FOR UPDATE 로 잡지 않은 채 센다');
    assert.ok(/COALESCE\(MAX\(sort_order\),0\)\+10 FROM title_code/.test(t),
      '직급 복구가 sort_order 를 맨 뒤로 새로 주지 않는다 — 옛 순번을 들고 오면 활성끼리 겹친다');

    const u = csMember(cs, TITLE_SIGS.UnitSetActiveAsync);
    const txU = u.indexOf('BeginTransactionAsync');
    assert.ok(txU >= 0, 'UnitSetActiveAsync 가 트랜잭션을 열지 않는다');
    const users = u.indexOf('SELECT COUNT(*) FROM app_user WHERE org_id=@o AND is_active=1 FOR UPDATE');
    const kids  = u.indexOf('SELECT COUNT(*) FROM org_unit WHERE parent_id=@o AND is_active=1 FOR UPDATE');
    assert.ok(users > txU, '조직 숨김의 재직자 세기가 트랜잭션 밖(또는 FOR UPDATE 없이)이다');
    assert.ok(kids > txU, '조직 숨김의 활성 하위 세기가 트랜잭션 밖(또는 FOR UPDATE 없이)이다');
    //  최상위는 숨길 수 없다 · 상위가 숨김이면 복구도 받지 않는다(§2 숨김 조건).
    //   ★ 거부는 **상수 한 줄**이 정본이다 — 함수가 그 상수를 쓰는지와, 그 상수의 문장이 설계 그대로인지를
    //     따로 본다. 문장만 보면 상수를 다른 데서 베껴 써도 통과하고, 상수만 보면 아무도 안 써도 통과한다.
    const code = stripCs(cs);
    assert.ok(/UnitRootHideMsg/.test(u),
      '조직 숨김이 최상위를 거부하지 않는다(UnitRootHideMsg 를 쓰지 않는다) — 루트가 사라지면 추가할 상위가 없어진다');
    assert.ok(new RegExp('UnitRootHideMsg\\s*=\\s*"' + ROOT_HIDE_MSG + '"').test(code),
      `최상위 숨김 거부 문장이 설계(§5.2)와 다르다 — "${ROOT_HIDE_MSG}" 여야 한다`);
    assert.ok(/UnitParentHiddenMsg/.test(u),
      '조직 복구가 숨긴 상위 밑으로의 복구를 거부하지 않는다 — 트리에 서지 못하는 가지가 생긴다');
    assert.ok(new RegExp('UnitParentHiddenMsg\\s*=\\s*"' + PARENT_HIDE_MSG + '"').test(code),
      `복구 거부 문장이 설계(§4.2)와 다르다 — "${PARENT_HIDE_MSG}" 여야 한다`);
    //  이미 그 상태면 거부한다(복구가 sort_order 를 새로 주기 때문에 다시 걸면 제자리가 밀린다).
    for (const [nm, b] of [['TitleSetActiveAsync', t], ['UnitSetActiveAsync', u]]) {
      assert.ok(/OrgTitleAlreadyMsg/.test(b),
        `${nm} 가 '이미 그 상태' 를 거부하지 않는다 — 낡은 화면이 [복구] 를 한 번 더 걸면 자리가 소리 없이 맨 뒤로 밀린다`);
    }
  },

  // ③ 상위 변경 — 조상 사슬을 걸어 올라가는 순환 검사. 최상위(NULL)·자기 자신은 받지 않는다.
  moveHasCycleGuard(cs) {
    const b = csMember(cs, TITLE_SIGS.UnitMoveAsync);
    assert.ok(/if \(parentId <= 0\) return \(false, UnitRootMoveMsg\);/.test(b),
      'UnitMoveAsync 가 최상위(NULL)로의 이동을 거부하지 않는다 — 루트는 하나뿐이다(§3.2)');
    assert.ok(/if \(parentId == orgId\) return \(false, UnitSelfMoveMsg\);/.test(b),
      'UnitMoveAsync 가 자기 자신을 상위로 삼는 이동을 거부하지 않는다');
    //  사슬 순회 — 새 상위에서 위로 걸어 올라가며 대상 자신이 나오는지 본다(루프가 있어야 한다).
    assert.ok(/while \(cursor\.HasValue\)/.test(b),
      'UnitMoveAsync 에 조상 사슬을 걸어 올라가는 루프가 없다 — 자기 하위로 옮기면 그 가지가 트리에서 통째로 사라진다');
    assert.ok(/SELECT parent_id FROM org_unit WHERE org_id=@c/.test(b),
      '순환 검사가 부모를 한 칸씩 읽어 올라가지 않는다 — 한 단계만 보면 손자 밑으로의 이동을 통과시킨다');
    assert.ok(/if \(cursor\.Value == orgId\)/.test(b) && /UnitCycleMsg/.test(b),
      '순환을 만나도 거부하지 않는다');
    assert.ok(/walked\.Add\(cursor\.Value\)/.test(b),
      '이미 본 노드를 기억하지 않는다 — DB 에 순환이 이미 있으면 여기서 무한 루프가 된다');
  },

  // ④ 순서 저장 — **활성 전부**가 와야 하고(집합 대조), 받아들이면 10 간격으로 전량 재작성한다.
  reorderNeedsWholeSet(cs) {
    const t = csMember(cs, TITLE_SIGS.TitleReorderAsync);
    assert.ok(/SELECT name FROM title_code WHERE is_active=1 FOR UPDATE/.test(t),
      '직급 순서가 지금의 **활성** 집합을 잠근 채 읽지 않는다 — 판정과 갱신 사이가 열린다');
    assert.ok(/given\.SetEquals\(live\)/.test(t) && /OrgTitleStaleMsg/.test(t),
      '직급 순서가 받은 집합과 활성 집합을 대조해 낡은 화면을 거부하지 않는다');
    assert.ok(/order \+= 10;/.test(t), '직급 순서가 10 간격으로 다시 매기지 않는다(복구가 MAX+10 을 주므로 간격이 맞아야 한다)');

    const u = csMember(cs, TITLE_SIGS.UnitReorderAsync);
    assert.ok(/SELECT org_id FROM org_unit WHERE parent_id=@p AND is_active=1 FOR UPDATE/.test(u),
      '조직 순서가 그 상위의 **활성 하위** 집합을 잠근 채 읽지 않는다');
    assert.ok(/given\.SetEquals\(live\)/.test(u) && /OrgTitleStaleMsg/.test(u),
      '조직 순서가 형제 집합을 대조하지 않는다 — 절반만 다시 매기면 목록 밖 형제가 새 번호 사이에 낀다');
    assert.ok(/order \+= 10;/.test(u), '조직 순서가 10 간격으로 다시 매기지 않는다');
    //  거부 문장의 정본은 상수 한 줄이다 — 브리지가 그 문장으로 갱신 목록을 실을지 가린다.
    assert.ok(/internal const string OrgTitleStaleMsg/.test(stripCs(cs)),
      'OrgTitleStaleMsg 가 internal 이 아니다 — 브리지가 못 보면 문장을 한 벌 더 적게 되고 둘이 갈린다');
    assert.ok(/internal const string OrgTitleAlreadyMsg/.test(stripCs(cs)),
      'OrgTitleAlreadyMsg 가 internal 이 아니다(같은 이유)');
  },

  // ⑤ 브리지 — 열 명령 · 아홉 쓰기 회신에 orgTitle · 갱신 목록을 싣는 판정은 ProjectDb 의 두 상수 대조다.
  bridgeCarriesList(mainCs) {
    const code = stripCs(mainCs);
    for (const [cmd, fn] of BRIDGE) {
      assert.ok(new RegExp('case "' + cmd + '":').test(code), `브리지 case "${cmd}" 가 없다 — 화면이 부르면 아무 일도 안 일어난다`);
    }
    //  조회는 제 자리에서 목록을 싣는다(쓰기와 회신 모양이 다르다).
    assert.ok(/_projectDb\.LoadOrgTitleJsonAsync\(/.test(code), '브리지가 LoadOrgTitleJsonAsync 를 부르지 않는다');
    for (const [cmd, fn] of WRITE_CMDS) {
      const c = csCase(mainCs, cmd);
      assert.ok(new RegExp('\\b' + fn + '\\(').test(c), `case "${cmd}" 가 ${fn} 을 부르지 않는다`);
      const b = csMember(mainCs, 'private async Task ' + fn + '(string reqId');
      assert.ok(/ReplyOrgTitleAsync\(reqId, ok, msg\);/.test(b),
        `${fn} 브리지가 갱신 목록을 싣는 공통 회신(ReplyOrgTitleAsync)을 쓰지 않는다 — 고친 결과가 화면에 닿지 않는다`);
    }
    const rep = csMember(mainCs, 'private async Task ReplyOrgTitleAsync(');
    assert.ok(/ProjectDb\.OrgTitleStaleMsg/.test(rep) && /ProjectDb\.OrgTitleAlreadyMsg/.test(rep),
      '회신이 거부 두 문장을 ProjectDb 의 상수와 대조하지 않는다 — 문장을 한 벌 더 적으면 한쪽만 고쳐지는 순간 새로고침이 멈춘다');
    assert.ok(/ReplyOnUi\(reqId, new \{ ok, msg, orgTitle \}\);/.test(rep),
      '쓰기 회신이 { ok, msg, orgTitle } 모양이 아니다 — 목록을 따로 밀면 배달이 둘로 갈린다(USER-ADMIN §11-34)');
    assert.ok(/string orgTitle = ok \|\| stale \? await ReadOrgTitleJsonAsync\(\) : "";/.test(rep),
      "성공·거부둘에만 목록을 싣지 않는다 — 무조건 실으면 바뀌지도 않은 실패까지 화면을 다시 그리고, 성공에만 실으면 '새로고침합니다' 가 거짓말이 된다");
  },

  // ⑤-b 1142(권한 없음)는 일반 DB 오류로 뭉개지 않는다(§11-2 정정).
  //    GRANT 가 빠진 서버에서 「처리하지 못했습니다(DB 오류).」 만 나오면 관리자는 무엇을 고쳐야 하는지 알 수 없고,
  //    루프도 '고장'과 '아직 안 한 일'을 가를 수 없다. 아홉 쓰기 **전부**가 그 번호를 따로 받아야 한다.
  grantMissingIsItsOwnSentence(cs) {
    const code = stripCs(cs);
    assert.ok(new RegExp('internal const string GrantMissingMsg\\s*=\\s*"' + GRANT_MISSING_MSG + '"').test(code),
      `GrantMissingMsg 가 없거나 문장이 §11-2 와 다르다 — "${GRANT_MISSING_MSG}" 여야 한다`);
    for (const [name, sig] of Object.entries(TITLE_SIGS)) {
      const b = csMember(cs, sig);
      assert.ok(/mex\.Number == 1142 \? GrantMissingMsg/.test(b),
        `${name} 가 1142 를 일반 DB 오류로 뭉갠다 — GRANT 누락이 「처리하지 못했습니다(DB 오류).」 로만 보이면 배포 누락을 아무도 못 찾는다(§11-2)`);
    }
  },

  // ⑥ GRANT — 세 파일이 같은 목록이어야 한다(한쪽만 돌린 서버에서 첫 쓰기가 ERROR 1142 로 죽는다).
  //    ★ SELECT·INSERT·UPDATE 는 **있어야** 하고 DELETE 는 **없어야** 한다(§2 삭제 없음 · §6).
  grantsOpenWritesNotDelete(sql, label) {
    for (const t of ['org_unit', 'title_code']) {
      const m = new RegExp('GRANT ([A-Z, ]+) ON [^\\n]*' + t).exec(sql);
      assert.ok(m, `${label} 에 ${t} GRANT 가 없다 — 판정 불가`);
      const verbs = m[1].trim().split(',').map((s) => s.trim()).filter(Boolean);
      for (const need of ['SELECT', 'INSERT', 'UPDATE']) {
        assert.ok(verbs.includes(need),
          `${label} 이 ${t} 에 [${verbs.join(', ')}] 을 준다 — ${need} 이 빠졌다(「직급·소속 관리」의 첫 쓰기가 ERROR 1142 다 · §6)`);
      }
      assert.ok(!verbs.includes('DELETE'),
        `${label} 이 ${t} 에 DELETE 를 준다 — 이 판은 숨김까지고 행은 남는다(§2)`);
    }
  },
};

// ── 실행 ────────────────────────────────────────────────────────────

test('기준⓪: 이 게이트의 기준 파일이 전부 실재한다(못 읽었으면 통과가 아니라 측정 실패다)', () => {
  assert.deepStrictEqual(missing, [], '직급·소속 호스트 게이트가 기준 파일을 읽지 못했다. 없는 것: ' + missing.join(', '));
});

test('계약①: 아홉 쓰기와 조회가 관리자 관문만 열고, 이 구역에 DELETE 문이 없다', () => checks.adminGateOnly(pdb));
test('계약②: 숨김 판정(재직자·활성 하위)은 쓰기와 같은 트랜잭션에서 FOR UPDATE 로 다시 센다', () => checks.hideJudgedInSameTx(pdb));
test('계약③: 상위 변경에 조상 사슬 순환 검사가 있고, 최상위·자기 자신으로는 못 옮긴다', () => checks.moveHasCycleGuard(pdb));
test('계약④: 순서 저장은 활성 전부가 와야 하고(집합 대조) 10 간격으로 전량 재작성한다', () => checks.reorderNeedsWholeSet(pdb));
test('계약⑤: 브리지 열 명령이 실재하고, 아홉 쓰기 회신이 갱신 목록(orgTitle)을 싣는다', () => checks.bridgeCarriesList(main));
test('계약⑤-b: 1142(GRANT 누락)는 아홉 쓰기 전부가 제 문장으로 돌려준다(§11-2)', () => checks.grantMissingIsItsOwnSentence(pdb));

test('계약⑥: db/deploy/create-app-user.sql 이 두 표에 SELECT·INSERT·UPDATE 를 주고 DELETE 는 안 준다', () => {
  checks.grantsOpenWritesNotDelete(createUser, CREATE_USER);
});
test('계약⑥-b: db/deploy/grants-calendar.sql 이 두 표에 SELECT·INSERT·UPDATE 를 주고 DELETE 는 안 준다', () => {
  checks.grantsOpenWritesNotDelete(calGrants, CAL_GRANTS);
  //  머리말 서술도 사실이어야 한다 — 없는 사실도, 빠진 사실도 다음 사람이 그대로 믿는다.
  assert.ok(/org_unit\s+SELECT \+ \*\*INSERT · UPDATE\*\*/.test(calGrants),
    'grants-calendar.sql 머리말이 아직 org_unit 을 "이번 범위 밖" 으로 적고 있다(§6)');
  assert.ok(/title_code\s+SELECT \+ \*\*INSERT · UPDATE\*\*/.test(calGrants),
    'grants-calendar.sql 머리말이 아직 title_code 를 "이번 범위 밖" 으로 적고 있다(§6)');
});
if (userGrants) {
  test('계약⑥-c: 비공개 05-grants.sql 이 두 표에 SELECT·INSERT·UPDATE 를 주고 DELETE 는 안 준다', () => {
    checks.grantsOpenWritesNotDelete(userGrants, USER_GRANTS);
  });
} else {
  //  ★ 형제 폴더가 없는 체크아웃 — '판정 불가'를 통과로 넘기지 않고 사유를 남긴다(엄격 게이트는 이것을 실패로 올린다).
  skip('계약⑥-c: 비공개 05-grants.sql 이 두 표에 SELECT·INSERT·UPDATE 를 주고 DELETE 는 안 준다',
    `${USER_GRANTS} 를 읽지 못함(형제 폴더 taskmgr-company-data 가 없다)`);
}
test('계약⑥-d: DEPLOY.md §0-5 가 org_unit·title_code 권한 변경을 적어 둔다(세 파일을 같은 목록으로 돌린다)', () => {
  assert.ok(/org_unit/.test(deployMd) && /title_code/.test(deployMd),
    'DEPLOY.md 가 두 표의 권한 변경을 말하지 않는다 — 그 한 줄이 없으면 배포자가 05-grants.sql 만 돌린다');
  assert.ok(/`org_unit`·`title_code` 의 `INSERT`·`UPDATE`/.test(deployMd),
    'DEPLOY.md §0-5 에 "org_unit·title_code 의 INSERT·UPDATE" 한 줄이 없다(ORG-TITLE-ADMIN §6)');
  assert.ok(/`DELETE` 는 주지 않는다/.test(deployMd),
    'DEPLOY.md 가 "DELETE 는 주지 않는다"를 말하지 않는다 — 다음 사람이 넉넉하게 주고 끝낸다');
});

// ══════════════════════════════════════════════════════════════════════
//  변이 주입 — 위 계약이 실효성이 있는지 증명한다. 각 변이마다 통제군을 둔다.
// ══════════════════════════════════════════════════════════════════════

test('변이①: 조직 추가를 쓰기 관문(editor 통과)으로 내리면 계약① 이 실패한다', () => {
  const bad = mutate(pdb,
    'try { conn = await OpenAdminAsync(cts.Token); }\n                catch (NotAuthorizedException nex) { _log("권한 거부(조직 추가): "',
    'try { conn = await OpenWriteAsync(cts.Token); }\n                catch (NotAuthorizedException nex) { _log("권한 거부(조직 추가): "');
  assert.throws(() => checks.adminGateOnly(bad), /UnitAddAsync 가 쓰기 관문\(editor 통과\)으로 연결을 연다/);
  assert.doesNotThrow(() => checks.adminGateOnly(pdb));   // 통제군
});

test('변이①-b: 이 구역에 DELETE 문을 하나 넣으면 계약① 이 실패한다(이 판은 숨김까지다)', () => {
  const bad = mutate(pdb, 'await using (var cmd = new MySqlCommand("UPDATE org_unit SET name=@n WHERE org_id=@o", conn))',
    'await using (var cmd = new MySqlCommand("DELETE FROM org_unit WHERE org_id=@o", conn))');
  assert.throws(() => checks.adminGateOnly(bad), /UnitRenameAsync 에 DELETE 문이 있다/);
  assert.doesNotThrow(() => checks.adminGateOnly(pdb));   // 통제군
});

test('변이②: 직급 숨김의 재직자 세기에서 FOR UPDATE 를 떼면 계약② 가 실패한다', () => {
  const bad = mutate(pdb, '"SELECT COUNT(*) FROM app_user WHERE title=@n AND is_active=1 FOR UPDATE"',
    '"SELECT COUNT(*) FROM app_user WHERE title=@n AND is_active=1"');
  assert.throws(() => checks.hideJudgedInSameTx(bad), /재직자 세기가 트랜잭션 \*\*밖\*\*/);
  assert.doesNotThrow(() => checks.hideJudgedInSameTx(pdb));   // 통제군
});

test('변이②-b: 최상위 숨김 거부를 지우면 계약② 가 실패한다(루트가 사라지면 추가할 상위가 없다)', () => {
  const bad = mutate(pdb, 'private const string UnitRootHideMsg     = "최상위 조직은 숨길 수 없습니다";',
    'private const string UnitRootHideMsg     = "숨겼습니다";');
  assert.throws(() => checks.hideJudgedInSameTx(bad), /최상위 숨김 거부 문장이 설계\(§5\.2\)와 다르다/);
  assert.doesNotThrow(() => checks.hideJudgedInSameTx(pdb));   // 통제군
});

test('변이②-c: 최상위 숨김 분기를 다른 거부로 바꾸면 계약② 가 실패한다(사유가 사라진다)', () => {
  const bad = mutate(pdb, 'if (!parentId.HasValue) { await SafeRollbackAsync(tx); return (false, UnitRootHideMsg); }',
    'if (!parentId.HasValue) { await SafeRollbackAsync(tx); return (false, OrgTitleStaleMsg); }');
  assert.throws(() => checks.hideJudgedInSameTx(bad), /최상위를 거부하지 않는다\(UnitRootHideMsg 를 쓰지 않는다\)/);
  assert.doesNotThrow(() => checks.hideJudgedInSameTx(pdb));   // 통제군
});

test('변이②-d: 숨긴 상위 밑으로의 복구를 열면 계약② 가 실패한다(트리에 서지 못하는 가지가 생긴다)', () => {
  const bad = mutate(pdb, 'if (pAct == null || pAct.Value == 0) { await SafeRollbackAsync(tx); return (false, UnitParentHiddenMsg); }',
    'if (false) { await SafeRollbackAsync(tx); return (false, OrgTitleStaleMsg); }');
  assert.throws(() => checks.hideJudgedInSameTx(bad), /숨긴 상위 밑으로의 복구를 거부하지 않는다/);
  assert.doesNotThrow(() => checks.hideJudgedInSameTx(pdb));   // 통제군
});

test('변이③: 순환 검사 루프를 지우면 계약③ 이 실패한다(자기 하위로 옮기면 가지가 통째로 사라진다)', () => {
  const bad = mutate(pdb, '                    while (cursor.HasValue)', '                    while (false)');
  assert.throws(() => checks.moveHasCycleGuard(bad), /조상 사슬을 걸어 올라가는 루프가 없다/);
  assert.doesNotThrow(() => checks.moveHasCycleGuard(pdb));   // 통제군
});

test('변이③-b: 최상위(NULL)로의 이동을 열면 계약③ 이 실패한다(루트는 하나뿐이다)', () => {
  const bad = mutate(pdb, 'if (parentId <= 0) return (false, UnitRootMoveMsg);', 'if (parentId < 0) return (false, UnitRootMoveMsg);');
  assert.throws(() => checks.moveHasCycleGuard(bad), /최상위\(NULL\)로의 이동을 거부하지 않는다/);
  assert.doesNotThrow(() => checks.moveHasCycleGuard(pdb));   // 통제군
});

test('변이④: 재매김 간격을 10 에서 1 로 줄이면 계약④ 가 실패한다(복구의 MAX+10 과 어긋난다)', () => {
  //  ★ 'order += 10;' 는 코드표(ReorderCodesAsync)에도 같은 줄이 있다 — String.replace 는 첫 일치만 바꾸므로
  //    바로 뒤따르는 UPDATE 문까지 묶어 **이 한 곳**을 가리킨다(유일하지 않은 변이는 엉뚱한 함수를 친다).
  const bad = mutate(pdb,
    '                        order += 10;\n                        await using var cmd = new MySqlCommand("UPDATE title_code SET sort_order=@s WHERE name=@n", conn, tx);',
    '                        order += 1;\n                        await using var cmd = new MySqlCommand("UPDATE title_code SET sort_order=@s WHERE name=@n", conn, tx);');
  assert.throws(() => checks.reorderNeedsWholeSet(bad), /직급 순서가 10 간격으로 다시 매기지 않는다/);
  assert.doesNotThrow(() => checks.reorderNeedsWholeSet(pdb));   // 통제군
});

test('변이④-b: 집합 대조를 개수 비교로 느슨하게 하면 계약④ 가 실패한다', () => {
  const bad = mutate(pdb, 'if (given.Count != kept.Count || given.Count != live.Count || !given.SetEquals(live))',
    'if (given.Count != live.Count)');
  assert.throws(() => checks.reorderNeedsWholeSet(bad), /낡은 화면을 거부하지 않는다/);
  assert.doesNotThrow(() => checks.reorderNeedsWholeSet(pdb));   // 통제군
});

//  ★ MainWindow.xaml.cs 의 줄끝은 **\r\r\n** 이다(실측 3026줄 · 나머지 24줄만 평범한 CRLF — ORG-TITLE-ADMIN §4
//    이 말하는 그 "CRLF 24 규칙"). 여러 줄 앵커는 그 바이트를 그대로 써야 한다: \n 이나 \r\n 으로 적으면
//    변이가 조용히 아무것도 바꾸지 못하고, 그 시험은 '대상 없음' 으로만 운다(계약은 검증되지 않은 채 남는다).
const NL = '\r\r\n';

test('변이⑤: 브리지 하나가 갱신 목록을 안 싣게 하면 계약⑤ 가 실패한다', () => {
  const bad = mutate(main,
    '_projectDb.UnitMoveAsync(orgId, parentId);' + NL + '            await ReplyOrgTitleAsync(reqId, ok, msg);',
    '_projectDb.UnitMoveAsync(orgId, parentId);' + NL + '            ReplyOnUi(reqId, new { ok, msg });');
  assert.throws(() => checks.bridgeCarriesList(bad), /UnitMoveAsync 브리지가 갱신 목록을 싣는 공통 회신/);
  assert.doesNotThrow(() => checks.bridgeCarriesList(main));   // 통제군
});

test('변이⑤-b: 거부 두 문장을 브리지가 제 손으로 적으면 계약⑤ 가 실패한다(한쪽만 고쳐지면 새로고침이 멈춘다)', () => {
  const bad = mutate(main,
    'bool stale = string.Equals(msg, ProjectDb.OrgTitleStaleMsg, StringComparison.Ordinal)' + NL +
    '                      || string.Equals(msg, ProjectDb.OrgTitleAlreadyMsg, StringComparison.Ordinal);',
    'bool stale = msg.Contains("목록이 바뀌었습니다") || msg.Contains("이미 그 상태입니다");');
  assert.throws(() => checks.bridgeCarriesList(bad), /ProjectDb 의 상수와 대조하지 않는다/);
  assert.doesNotThrow(() => checks.bridgeCarriesList(main));   // 통제군
});

test('변이⑤-c: 1142 를 일반 DB 오류로 되돌리면 계약⑤-b 가 실패한다(배포 누락이 고장으로 보인다)', () => {
  const bad = mutate(pdb,
    '_log("직급 추가 실패(" + mex.Number + "): " + Short(mex)); return (false, mex.Number == 1142 ? GrantMissingMsg : IsLockContention(mex) ? DbBusyMsg : DbFailMsg);',
    '_log("직급 추가 실패(" + mex.Number + "): " + Short(mex)); return (false, IsLockContention(mex) ? DbBusyMsg : DbFailMsg);');
  assert.throws(() => checks.grantMissingIsItsOwnSentence(bad), /TitleAddAsync 가 1142 를 일반 DB 오류로 뭉갠다/);
  assert.doesNotThrow(() => checks.grantMissingIsItsOwnSentence(pdb));   // 통제군
});

test('변이⑤-d: GRANT 누락 문장을 바꾸면 계약⑤-b 가 실패한다(루프의 판정 없음이 함께 멈춘다)', () => {
  const bad = mutate(pdb, 'internal const string GrantMissingMsg = "DB 권한이 없습니다(1142)',
    'internal const string GrantMissingMsg = "권한 오류(1142)');
  assert.throws(() => checks.grantMissingIsItsOwnSentence(bad), /GrantMissingMsg 가 없거나 문장이 §11-2 와 다르다/);
  assert.doesNotThrow(() => checks.grantMissingIsItsOwnSentence(pdb));   // 통제군
});

test('변이⑥: GRANT 한 줄에 DELETE 를 더하면 계약⑥ 이 실패한다', () => {
  const bad = mutate(createUser, 'GRANT SELECT, INSERT, UPDATE ON taskmgr.org_unit   ', 'GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.org_unit   ');
  assert.throws(() => checks.grantsOpenWritesNotDelete(bad, CREATE_USER), /org_unit 에 DELETE 를 준다/);
  assert.doesNotThrow(() => checks.grantsOpenWritesNotDelete(createUser, CREATE_USER));   // 통제군
});

test('변이⑥-b: GRANT 에서 INSERT 를 빼면 계약⑥ 이 실패한다(조직 추가가 ERROR 1142 로 죽는다)', () => {
  const bad = mutate(createUser, 'GRANT SELECT, INSERT, UPDATE ON taskmgr.title_code ', 'GRANT SELECT, UPDATE ON taskmgr.title_code ');
  assert.throws(() => checks.grantsOpenWritesNotDelete(bad, CREATE_USER), /title_code 에 \[SELECT, UPDATE\] 을 준다 — INSERT 이 빠졌다/);
  assert.doesNotThrow(() => checks.grantsOpenWritesNotDelete(createUser, CREATE_USER));   // 통제군
});
