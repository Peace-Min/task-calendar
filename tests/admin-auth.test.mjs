// 관리자 자격(공용 비밀번호) 폐지 — 되살아나지 않는지 기계가 지킨다 (2026-07-30, USER-LOGIN §3.3)
//
// 이 파일은 원래 '관리자 인증 우회 취약점'(2026-07-24)의 회귀 방지였다.
//   viewer(미인증) → saveAdminCred 호출 → 성공 → 공격자 비번으로 admin 획득 + 원래 관리자 잠김(DoS).
// 그 취약점은 이제 **구조적으로 존재할 수 없다** — 공용 관리자 비밀번호라는 개념 자체를 없앴기 때문이다.
//   · 편집 권한은 로그인 신원(app_user.edit_role·is_active)으로 '작업 요청 시점'에 호스트가 판정한다.
//   · 그래서 "바꿔치기할 비밀번호"도, "잠금해제 상태"도, "그걸 저장하는 파일"도 없다.
//
// ★ 이 파일이 지금 지키는 것은 하나다: **그 개념이 어느 층에서도 되살아나지 않는다.**
//   부활은 늘 편의(“임시로 관리자 비번 하나만…”)로 시작하고, 시작하면 취약점도 함께 돌아온다.
//
// ── 2026-09-04 보강(변이 감사) ────────────────────────────────────────
// 감사에서 이 파일이 자기 표제의 시나리오를 두 형태로 놓치는 것이 확인됐다. 둘 다 저장소 전체 그린이었다.
//   [G1] 쓰기 11곳을 전부 무검사 opener 로 갈아끼워도 침묵했다 — 「관문이 있다」만 봤기 때문이다.
//        관문은 '존재'가 아니라 '통과'로 지켜야 한다. 그래서 아래 gate.* 는 opener 선언 집합·모든
//        연결 개시 지점·쓰기 SQL 을 가진 메서드를 전부 훑는다(옆 파일에 기대지 않는다 — 자급자족).
//   [G2] 폐지한 개념이 **새 이름**(unlockEditing / CheckMasterPassphrase / _editingUnlocked)으로
//        웹·브리지·ProjectDb 세 층에 동시에 들어와도 침묵했다 — 금지 목록이 옛 어휘 대조뿐이었다.
//        부활은 늘 새 이름으로 온다. 그래서 아래 revive.* 는 이름이 아니라 **형태**를 금지한다:
//        평문 비밀문자열 비교 · 문자열로 쓰기를 여는 bool 함수 · 잠금해제 상태 플래그 ·
//        로그인(userLogin) 외의 브리지 명령에 실려 나가는 비밀번호.
//   추가로 관문 '안에서' 우회하는 형태(if (MasterUnlocked) return conn;)와, 튜플이 아닌 반환형으로
//   관문 밖에 새 쓰기 API 를 다는 형태(Task<bool> + OpenReadAsync + UPDATE)도 여기서 막는다 —
//   앞의 것은 new MySqlConnection 개수를 늘리지 않고, 뒤의 것은 (bool ok, …) 시그니처를 피해 간다.
import { test, assert, loadAppSource } from './harness.mjs';
import { readFileSync } from 'node:fs';

const src          = loadAppSource();
const projectDb    = readFileSync(new URL('../widget/ProjectDb.cs', import.meta.url), 'utf8');
const mainWindow   = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
const deployConfig = readFileSync(new URL('../widget/DeployConfig.cs', import.meta.url), 'utf8');

// ── 웹: 역할 캐시·인증 UI가 흔적 없이 사라졌다 ─────────────────────────
// 이름을 통째로 금지한다(주석에도 남기지 않았다) — 부분 검사는 "한 군데만 남겨두기"로 빠져나간다.

test('웹: 역할 캐시·관리자 인증 배선이 흔적 없이 제거됐다', () => {
  for (const dead of ['getRole', '__adminSession', '__adminState', '__adminResult', '__adminSaved',
                      'updateAdminUi', 'submitAdminAuth', 'adminAuthNeeded']) {
    assert.ok(!src.includes(dead), `제거 대상이 남아 있다: ${dead}`);
  }
});

test('웹: 설정창 관리자 섹션 마크업이 통째로 사라졌다', () => {
  for (const dead of ['adminSection', 'admAuthBlock', 'admAuthPw', 'admAuthOk', 'admUnlockedBlock',
                      'admChangeBlock', 'admRegId', 'admRegPw', 'admRegSave', 'admLogout',
                      'admState', 'admMsg', 'adm-row']) {
    assert.ok(!src.includes(dead), `설정창 관리자 UI 잔재가 남아 있다: ${dead}`);
  }
});

test('웹: 관리자 브리지 명령을 호스트로 보내지 않는다', () => {
  for (const cmd of ['adminLogin', 'adminLogout', 'adminStateGet', 'saveAdminCred']) {
    assert.ok(!src.includes(cmd), `폐지된 브리지 명령을 아직 보낸다: ${cmd}`);
  }
});

test('웹: 인증 UI를 지우면서 과제 DB 상태·새로고침까지 잃지 않았다', () => {
  // 관리자 섹션 안에 함께 살던 DB 상태줄·새로고침은 인증과 무관하다 — 통째 삭제의 부수피해가 되기 쉬운 지점.
  assert.ok(/id="dbSection"/.test(src), '과제 DB 섹션이 없다(관리자 섹션과 함께 지워졌다)');
  for (const id of ['dbCacheLine', 'dbReload', 'dbMsg']) {
    assert.ok(new RegExp('id="' + id + '"').test(src), `과제 DB 섹션에 #${id}가 없다`);
  }
  assert.ok(/getElementById\('dbSection'\)/.test(src), '설정 열기 경로가 과제 DB 섹션을 다루지 않는다');
});

// ── 호스트: 브리지 케이스·검증 함수·자격 저장이 전부 사라졌다 ───────────

test('호스트: 관리자 브리지 케이스 4종이 사라졌다', () => {
  for (const c of ['adminLogin', 'adminLogout', 'adminStateGet', 'saveAdminCred']) {
    assert.ok(!new RegExp(`case "${c}":`).test(mainWindow), `브리지 케이스가 남아 있다: ${c}`);
  }
  assert.ok(!/SendAdminState/.test(mainWindow), '관리자 상태 통지(SendAdminState)가 남아 있다');
});

test('호스트: ProjectDb의 관리자 자격 API가 사라졌다', () => {
  for (const dead of ['VerifyAdmin(', 'SaveAdminCred(', 'IsAdminUnlocked(', 'SetAdminUnlocked(',
                      'LoadAdmin(', 'WriteAdmin(']) {
    assert.ok(!projectDb.includes(dead), `관리자 자격 API가 남아 있다: ${dead}`);
  }
});

test('호스트: db-config.json의 관리자 항목을 읽지도 쓰지도 않는다', () => {
  // 파일 자체를 지우는 코드를 넣지도 않는다 — 읽지 않으면 그만이고, 지우는 코드는 위험만 는다.
  assert.ok(!/"db-config\.json"/.test(projectDb), 'db-config.json 경로를 아직 만든다');
  for (const key of ['"adminId"', '"adminPw"', '"adminUnlocked"', 'adminId =', 'adminPw =', 'adminUnlocked =']) {
    assert.ok(!projectDb.includes(key), `관리자 설정 항목을 아직 다룬다: ${key}`);
  }
  assert.ok(!/File\.(ReadAllText|WriteAllText)/.test(projectDb),
    'ProjectDb가 아직 파일을 직접 읽고 쓴다 — 남은 것은 세션(UserSession)뿐이어야 한다');
});

test('배포 구성: 배포본에 심는 관리자 비밀번호가 더는 없다', () => {
  assert.ok(!/const string AdminId/.test(deployConfig), '관리자 초기 ID 상수가 남아 있다');
  assert.ok(!/const string AdminPw/.test(deployConfig), '관리자 초기 비밀번호 상수가 남아 있다 — 배포 빌드에 그대로 실린다');
  assert.ok(!/admin1234/.test(deployConfig), '관리자 비밀번호 리터럴이 남아 있다');
  // DB 접속 상수는 그대로여야 한다(같이 지우면 앱이 서버를 못 찾는다).
  for (const keep of ['DbHost', 'DbPort', 'DbName', 'DbUser', 'DbPassword', 'UpdateSourceUrl']) {
    assert.ok(deployConfig.includes(keep), `배포 구성에서 같이 지우면 안 되는 값이 사라졌다: ${keep}`);
  }
});

// ── 대체 경로가 실제로 있는지(제거만 하고 대체를 안 하면 편집이 영영 안 열린다) ──

test('대체 경로 존재: 편집 권한 판정이 쓰기 관문 한 곳에 있다', () => {
  assert.ok(/private async Task<MySqlConnection> OpenWriteAsync/.test(projectDb),
    '쓰기 관문이 없다 — 관리자 자격만 지우고 대체 판정을 안 넣으면 fail-open이 된다');
  assert.ok(/SELECT edit_role, is_active FROM app_user WHERE login_id=@id/.test(projectDb),
    '쓰기 관문이 권한을 조회하지 않는다');
});

test('로그: 시작 시 비우지 않고 회전한다(크기 1MB·2세대·백업 30일 상한)', () => {
  // 왜: 시작 시 truncate하면 "재시작해봤는데 또 그래요" 뒤에 오는 제보에 증거가 없다.
  // 반대로 무한정 쌓으면 연결 실패 재시도 폭주에서 파일이 커진다 → 용량·기간 양쪽 상한.
  assert.ok(!/File\.WriteAllText\(_logFile, ""\)/.test(mainWindow), '시작 시 로그를 비운다(재시작하면 증거 소실)');
  assert.ok(/private void RotateLog\(\)/.test(mainWindow), 'RotateLog가 없다');
  const b = mainWindow.slice(mainWindow.indexOf('private void RotateLog()'), mainWindow.indexOf('private void Log(string msg)'));
  assert.ok(/MaxBytes = 1024 \* 1024/.test(b), '용량 상한(1MB)이 없다');
  assert.ok(/KeepDays = 30/.test(b), '백업 보관 상한(30일)이 없다');
  assert.ok(/File\.Move\(_logFile, bak\)/.test(b), '1MB 초과 시 .1로 회전하지 않는다');
  assert.ok(/TotalDays > KeepDays[\s\S]{0,120}File\.Delete\(bak\)/.test(b), '30일 지난 백업을 지우지 않는다');
  assert.ok(/RotateLog\(\);/.test(mainWindow), '시작 경로에서 RotateLog를 호출하지 않는다');
});

// ══════════════════════════════════════════════════════════════════════
// 소스 슬라이서 — 검사와 변이 주입이 같은 함수를 쓴다(검사가 실제로 잡는지 증명하기 위해서다).
// ══════════════════════════════════════════════════════════════════════

const BS = String.fromCharCode(92);

// C# 주석 제거(문자열 리터럴은 보존). 폐지된 개념은 주석에 이름이 남아 있다 —
// "코드가 실제로 그렇게 하는가"를 물어야 하므로 주석을 세면 안 된다.
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

// ProjectDb 의 클래스 멤버들을 {name, body}로 자른다(주석 제거본 기준, 중괄호 짝 맞춤).
// ★ 이름으로 고르지 않는다 — '새 이름으로 들어온 쓰기 API'를 잡는 것이 목적이라
//   선언을 전부 훑어야 한다(이름 목록을 쓰면 새 이름이 그대로 빠져나간다).
function csMembers(source) {
  const code = stripCs(source);
  const re = /\n {8}(?:public|private|internal|protected)\b[^\n]*/g;
  const starts = [];
  let m;
  while ((m = re.exec(code)) !== null) starts.push(m.index + 1);
  const out = [];
  const skipLit = (k) => {
    const q = code[k];
    let j = k + 1;
    while (j < code.length) { if (code[j] === BS) { j += 2; continue; } if (code[j] === q) break; j++; }
    return j;
  };
  for (const s of starts) {
    const head = code.slice(s, code.indexOf('\n', s) + 1);
    const nm = /(\w+)\s*\(/.exec(head);
    const name = nm ? nm[1] : '(멤버)';
    let open = -1, semi = -1;
    for (let k = s; k < code.length; k++) {
      const c = code[k];
      if (c === '"' || c === "'") { k = skipLit(k); continue; }
      if (c === '{') { open = k; break; }
      if (c === ';') { semi = k; break; }
    }
    if (open < 0) { out.push({ name, body: code.slice(s, semi < 0 ? s : semi + 1) }); continue; }
    let depth = 0, end = -1;
    for (let k = open; k < code.length; k++) {
      const c = code[k];
      if (c === '"' || c === "'") { k = skipLit(k); continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    assert.ok(end > open, `${name} 의 중괄호 짝이 맞지 않는다`);
    out.push({ name, body: code.slice(s, end + 1) });
  }
  return out;
}

// C# switch 의 한 case 블록 — `case "<name>":` 부터 그 뒤 첫 `break;` 까지(주석 제거본 기준).
function csCase(source, name) {
  const code = stripCs(source);
  const s = code.indexOf('case "' + name + '":');
  assert.ok(s >= 0, `호스트 case "${name}" 을 찾지 못함`);
  const e = code.indexOf('break;', s);
  assert.ok(e > s, `case "${name}" 의 break; 를 찾지 못함`);
  return code.slice(s, e + 6);
}

// JS 호출의 인자 텍스트를 균형 괄호로 잘라낸다(문자열 리터럴 안의 괄호는 세지 않는다).
function jsCallArgs(source, fnName) {
  const out = [];
  const re = new RegExp('\\b' + fnName + '\\s*\\(', 'g');
  let m;
  while ((m = re.exec(source)) !== null) {
    let depth = 0, k = m.index + m[0].length - 1;
    const start = k + 1;
    for (; k < source.length; k++) {
      const c = source[k];
      if (c === '"' || c === "'" || c === '`') {
        let j = k + 1;
        while (j < source.length) { if (source[j] === BS) { j += 2; continue; } if (source[j] === c) break; j++; }
        k = j; continue;
      }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
    }
    out.push(source.slice(start, k));
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// 검사 ① 관문은 '존재'가 아니라 '통과'로 지킨다 (G1 / 신규 A·B)
// ══════════════════════════════════════════════════════════════════════

// 쓰기 SQL 의 '모양' — 이름과 무관하다. 새 메서드가 어떤 이름·어떤 반환형이든 이 모양을 쓰면 쓰기다.
const WRITE_SQL = /\b(?:INSERT\s+INTO|REPLACE\s+INTO|DELETE\s+FROM|TRUNCATE\s+TABLE|UPDATE\s+[\w{])/;

const gate = {
  // 연결을 여는 헬퍼는 딱 둘이다. 무검사 opener 를 하나 더 다는 순간 여기서 운다.
  openersAreExactlyTwo(pdb) {
    const decls = [...stripCs(pdb).matchAll(/Task<MySqlConnection>\s+(\w+)\s*\(/g)].map((m) => m[1]).sort();
    assert.deepStrictEqual(decls, ['OpenReadAsync', 'OpenWriteAsync'],
      `연결 헬퍼가 [${decls.join(', ')}] 이다 — 관문 밖에 연결을 여는 통로가 생겼다`);
    const opens = (pdb.match(/new MySqlConnection\(/g) || []).length;
    assert.strictEqual(opens, 2, `new MySqlConnection 이 ${opens}곳이다(헬퍼 2곳이어야 한다 — 관문 우회 통로)`);
  },

  // 모든 연결 개시 지점이 두 관문 중 하나를 지난다. 11곳을 전부 갈아끼운 변이가 여기서 죽는다.
  everyOpenGoesThroughAGate(pdb) {
    const sites = [...stripCs(pdb).matchAll(/await\s+Open(\w+)Async\s*\(/g)].map((m) => m[1]);
    const stray = sites.filter((k) => k !== 'Read' && k !== 'Write');
    assert.deepStrictEqual(stray, [],
      `Open${stray[0]}Async 로 연결을 연다 — 관문은 남아 있지만 아무도 지나지 않는다(fail-open)`);
    const writes = sites.filter((k) => k === 'Write').length;
    assert.ok(writes >= 11, `쓰기 관문 통과 지점이 ${writes}곳뿐이다(11곳 이상이어야 한다 — 우회로가 생겼다)`);
  },

  // 쓰기 SQL 을 가진 메서드는 반환형·이름이 무엇이든 쓰기 관문으로 연다.
  // ★ (bool ok, …) 튜플 시그니처로 좁히지 않는다 — Task<bool> 로 바꾸면 그대로 빠져나가기 때문이다.
  writeSqlGoesThroughGate(pdb) {
    const writers = csMembers(pdb).filter((x) => WRITE_SQL.test(x.body));
    assert.ok(writers.length >= 9,
      `쓰기 SQL 을 가진 메서드가 ${writers.length}개뿐이다(9개 이상이어야 한다 — 탐지기가 헛돌고 있다)`);
    for (const w of writers) {
      assert.ok(/OpenWriteAsync\(/.test(w.body),
        `${w.name} 가 쓰기 SQL 을 실행하면서 쓰기 관문을 지나지 않는다 — 권한 판정을 통째로 건너뛴다`);
      assert.ok(!/OpenReadAsync\(/.test(w.body),
        `${w.name} 가 읽기 관문으로 연결을 열고 쓰기 SQL 을 실행한다(권한 검사 우회)`);
    }
  },

  // 관문 '안에서'의 우회 — if (MasterUnlocked) return conn; 처럼 거부 3분기 앞으로 빠져나가는 출구.
  // 연결을 새로 만들지 않으므로 new MySqlConnection 개수는 2 그대로다. 개수만 세면 못 잡는다.
  gateHasNoEarlyExit(pdb) {
    const ow = csMembers(pdb).find((x) => x.name === 'OpenWriteAsync');
    assert.ok(ow, '쓰기 관문(OpenWriteAsync)을 찾지 못했다');
    const rets = [...ow.body.matchAll(/\breturn\b[^;]*;/g)].map((m) => m[0].trim());
    assert.deepStrictEqual(rets, ['return conn;'],
      `쓰기 관문의 출구가 [${rets.join(' / ')}] 이다 — 거부 3분기 앞으로 빠져나가는 조기 반환이 생겼다`);
    // 신원 검사는 조건이 붙지 않은 채 그대로여야 한다(다른 조건과 && / || 로 엮으면 무력해진다).
    assert.ok(ow.body.includes('if (s == null || s.LoginId.Length == 0) throw new NotAuthorizedException("로그인이 필요합니다.");'),
      '미로그인 거부 조건이 계약과 다르다 — 다른 조건이 끼어들면 신원 없이도 쓰기 연결이 열린다');
    // 거부 3분기가 유일한 출구보다 앞에 있어야 관문을 '지난다'고 말할 수 있다.
    const ret = ow.body.lastIndexOf('return conn;');
    for (const msg of ['사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요.', '비활성 처리된 계정입니다.', '편집 권한이 없습니다.']) {
      const at = ow.body.indexOf(msg);
      assert.ok(at >= 0 && at < ret, `거부 분기가 없거나 반환 뒤에 있다: ${msg}`);
    }
  },
};

test('관문 우회 금지: 연결을 여는 헬퍼는 읽기·쓰기 둘뿐이다', () => gate.openersAreExactlyTwo(projectDb));
test('관문 우회 금지: 모든 연결 개시가 두 관문 중 하나를 지난다', () => gate.everyOpenGoesThroughAGate(projectDb));
test('관문 우회 금지: 쓰기 SQL 을 가진 메서드는 이름·반환형과 무관하게 쓰기 관문으로 연다', () => gate.writeSqlGoesThroughGate(projectDb));
test('관문 우회 금지: 쓰기 관문 안에 거부 3분기를 건너뛰는 출구가 없다', () => gate.gateHasNoEarlyExit(projectDb));

// ══════════════════════════════════════════════════════════════════════
// 검사 ② 부활 금지는 '이름'이 아니라 '형태'로 (G2)
// ══════════════════════════════════════════════════════════════════════

const revive = {
  // 평문 비밀문자열 비교 — 이름이 무엇이든(CheckMasterPassphrase / 임시잠금해제 / …) 공용 통행구다.
  noPlaintextSecretCompare(hostCode) {
    const eq = /\b(?:pw|pwd|passwd|pass|password|passphrase|secret|unlock)\w*\s*(?:==|!=|\.Equals\s*\()\s*"/i;
    assert.ok(!eq.test(hostCode),
      `평문 비밀문자열 비교가 있다 — 이름이 무엇이든 공용 통행구다: ${(eq.exec(hostCode) || [''])[0]}`);
    const eq2 = /\bEquals\s*\(\s*\w*(?:pw|pass|passphrase|secret|unlock)\w*\s*,\s*"/i;
    assert.ok(!eq2.test(hostCode),
      `평문 비밀문자열 비교가 있다(Equals 형태): ${(eq2.exec(hostCode) || [''])[0]}`);
  },

  // 쓰기 허용을 '세션 신원'이 아니라 '문자열 검증'으로 여는 함수.
  noSecretGateFunction(hostCode) {
    const fn = /\b(?:static\s+)?bool\s+\w*(?:Unlock|Master|Passphrase|AdminOk|Secret)\w*\s*\(/i;
    assert.ok(!fn.test(hostCode),
      `쓰기 허용을 세션 신원이 아닌 문자열 검증으로 여는 함수가 생겼다: ${(fn.exec(hostCode) || [''])[0]}`);
  },

  // 잠금해제 상태를 들고 있는 이름 — 권한은 매 쓰기마다 DB 가 정한다(캐시할 상태가 없다).
  noUnlockStateFlag(hostCode) {
    const flag = /\b\w*(?:Unlock|EditAllowed|AdminOk|Bypass|Passphrase)\w*\b/i;
    assert.ok(!flag.test(hostCode),
      `잠금해제 개념의 식별자가 되살아났다: ${(flag.exec(hostCode) || [''])[0]}`);
  },

  // 호스트가 브리지에서 비밀번호를 읽는 자리는 둘뿐이다 — 회사 일간보고 자격 저장과 로그인.
  // 새 명령이 비밀번호를 받기 시작하면(이름이 무엇이든) 여기서 운다.
  hostPwReadsAreBounded(main) {
    const reads = (stripCs(main).match(/GetStr\(doc,\s*"(?:pw|pwd|pass|password|passphrase|secret)"\)/g) || []);
    assert.strictEqual(reads.length, 2,
      `호스트가 브리지에서 비밀번호를 ${reads.length}곳에서 읽는다(netcusSaveCreds·userLogin 둘뿐이어야 한다)`);
    assert.ok(/GetStr\(doc,\s*"pw"\)/.test(csCase(main, 'netcusSaveCreds')), 'netcusSaveCreds 가 비밀번호를 읽지 않는다');
    assert.ok(/GetStr\(doc,\s*"pw"\)/.test(csCase(main, 'userLogin')), 'userLogin 이 비밀번호를 읽지 않는다');
  },

  // 웹이 호스트로 비밀번호를 실어 보내는 곳은 로그인 왕복 하나뿐이다(명령 이름과 무관하게).
  webSendsSecretOnlyToLogin(web) {
    const SECRET_KEY = /[{,]\s*(?:pw|pwd|passwd|pass|password|passphrase|secret)\s*(?::|,|\})/i;
    for (const a of jsCallArgs(web, 'hpost')) {
      assert.ok(!SECRET_KEY.test(a),
        `웹이 브리지(hpost)로 비밀번호를 보낸다 — 명령 이름과 무관하게 폐지된 개념이다: ${a.slice(0, 60)}`);
    }
    const carriers = jsCallArgs(web, 'hostRequest')
      .filter((a) => SECRET_KEY.test(a))
      .map((a) => (/^\s*['"]([\w.-]+)['"]/.exec(a) || [null, '(동적 명령)'])[1]);
    assert.deepStrictEqual(carriers, ['userLogin'],
      `비밀번호를 싣는 호스트 왕복이 [${carriers.join(', ')}] 이다 — 로그인(userLogin) 하나뿐이어야 한다`);
  },
};

const hostCode = stripCs(projectDb) + '\n' + stripCs(mainWindow);

test('부활 금지(형태): 호스트에 평문 비밀문자열 비교가 없다', () => revive.noPlaintextSecretCompare(hostCode));
test('부활 금지(형태): 문자열 검증으로 쓰기를 여는 함수가 없다', () => revive.noSecretGateFunction(hostCode));
test('부활 금지(형태): 편집 허용 상태를 들고 있는 이름이 없다', () => revive.noUnlockStateFlag(hostCode));
test('부활 금지(형태): 호스트가 비밀번호를 읽는 브리지 자리는 둘뿐이다', () => revive.hostPwReadsAreBounded(mainWindow));
test('부활 금지(형태): 웹이 비밀번호를 싣는 호스트 왕복은 로그인 하나뿐이다', () => revive.webSendsSecretOnlyToLogin(src));

// ══════════════════════════════════════════════════════════════════════
// 변이 주입 — 위 검사가 실효성이 있는지 증명한다(안 잡으면 그 검사는 장식이다).
// 앵커가 소스에서 안 찾히면 여기서 실패한다 — 조용히 통과하지 않는다.
// ══════════════════════════════════════════════════════════════════════

function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}
function mutateAll(base, from, to) {
  const out = base.split(from).join(to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

const UNCHECKED_OPENER = [
  '        private static async Task<MySqlConnection> OpenUncheckedAsync(CancellationToken ct)',
  '        {',
  '            var conn = new MySqlConnection(BuildConnString());',
  '            await conn.OpenAsync(ct);',
  '            return conn;',
  '        }',
  '',
  '        private async Task<MySqlConnection> OpenWriteAsync(CancellationToken ct)',
].join('\n');

// [G1] 감사에서 놓쳤던 변이 — 쓰기 11곳을 전부 무검사 opener 로 갈아끼운다(관문 정의는 그대로 남긴다).
test('변이G1: 쓰기 11곳을 전부 무검사 opener 로 갈아끼우면 관문 통과 검사가 실패한다', () => {
  let bad = mutate(projectDb, '        private async Task<MySqlConnection> OpenWriteAsync(CancellationToken ct)', UNCHECKED_OPENER);
  bad = mutateAll(bad, 'conn = await OpenWriteAsync(', 'conn = await OpenUncheckedAsync(');
  assert.throws(() => gate.everyOpenGoesThroughAGate(bad), /관문은 남아 있지만 아무도 지나지 않는다/);
  assert.throws(() => gate.openersAreExactlyTwo(bad), /관문 밖에 연결을 여는 통로가 생겼다/);
  assert.throws(() => gate.writeSqlGoesThroughGate(bad), /쓰기 관문을 지나지 않는다/);
  // 옛 계약(관문 '존재'만 보는 것)은 이 변이를 그대로 통과시킨다 — 그래서 위 셋이 필요하다.
  assert.ok(/private async Task<MySqlConnection> OpenWriteAsync/.test(bad), '변이본에서 관문 정의가 사라졌다(전제 확인)');
});

test('변이G1-b: 쓰기 한 곳만 무검사 opener 로 바꿔도 관문 통과 검사가 실패한다', () => {
  const bad = mutate(projectDb, 'try { conn = await OpenWriteAsync(cts.Token); }', 'try { conn = await OpenUncheckedAsync(cts.Token); }');
  assert.throws(() => gate.everyOpenGoesThroughAGate(bad), /Open\w+Async 로 연결을 연다/);
  assert.throws(() => gate.writeSqlGoesThroughGate(bad), /쓰기 관문을 지나지 않는다/);
});

// [신규 B] 튜플이 아닌 반환형으로 관문 밖에 새 쓰기 API 를 단다 — 옆 파일의 불변식②도 못 잡는 형태.
const PURGE_API = [
  '        public async Task<bool> PurgeProjectsAsync()',
  '        {',
  '            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));',
  '            await using var conn = await OpenReadAsync(cts.Token);',
  '            await using var cmd = new MySqlCommand("UPDATE project SET is_active=0", conn);',
  '            await cmd.ExecuteNonQueryAsync(cts.Token);',
  '            return true;',
  '        }',
  '',
  '        public async Task<(bool ok, string msg)> SetProjectActiveAsync(',
].join('\n');

test('변이신규B: 관문 밖에 Task<bool> 쓰기 API 를 달면 쓰기 SQL 검사가 실패한다', () => {
  const bad = mutate(projectDb, '        public async Task<(bool ok, string msg)> SetProjectActiveAsync(', PURGE_API);
  assert.throws(() => gate.writeSqlGoesThroughGate(bad), /PurgeProjectsAsync 가 쓰기 SQL 을 실행하면서 쓰기 관문을 지나지 않는다/);
  // 연결 생성 지점은 2 그대로다 — 개수만 세는 방어로는 절대 안 잡힌다(그래서 위 검사가 필요하다).
  assert.strictEqual((bad.match(/new MySqlConnection\(/g) || []).length, 2, '변이 전제: 연결 생성 지점은 늘지 않는다');
  gate.openersAreExactlyTwo(bad);
});

// [신규 A] 관문 '안에서' 우회 — 이미 연 conn 을 거부 3분기 앞에서 그냥 돌려준다.
test('변이신규A: 쓰기 관문 안에 조기 반환을 넣으면 조기 출구 검사가 실패한다', () => {
  const bad = mutate(projectDb,
    '                if (!found) throw new NotAuthorizedException("사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요.");',
    '                if (MasterUnlocked) return conn;\n                if (!found) throw new NotAuthorizedException("사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요.");');
  assert.throws(() => gate.gateHasNoEarlyExit(bad), /거부 3분기 앞으로 빠져나가는 조기 반환이 생겼다/);
  assert.strictEqual((bad.match(/new MySqlConnection\(/g) || []).length, 2, '변이 전제: 연결 생성 지점은 늘지 않는다');
});

test('변이신규A-b: 신원 검사를 다른 조건과 엮으면 조기 출구 검사가 실패한다', () => {
  const bad = mutate(projectDb,
    'if (s == null || s.LoginId.Length == 0) throw new NotAuthorizedException("로그인이 필요합니다.");',
    'if (!MasterUnlocked && (s == null || s.LoginId.Length == 0)) throw new NotAuthorizedException("로그인이 필요합니다.");');
  assert.throws(() => gate.gateHasNoEarlyExit(bad), /미로그인 거부 조건이 계약과 다르다/);
});

// [G2] 새 어휘로 부활 — 웹·브리지·ProjectDb 세 층. 옛 이름 금지 목록은 한 건도 울리지 않는다.
const CHECK_FN = [
  '        public static bool CheckMasterPassphrase(string pw) => pw == "netcus2026";',
  '',
  '        private static string BuildConnString() =>',
].join('\n');

const UNLOCK_CASE = [
  '                    case "unlockEditing":',
  '                        _editingUnlocked = ProjectDb.CheckMasterPassphrase(GetStr(doc, "pw"));',
  '                        break;',
  '                    case "userLogout":',
].join('\n');

test('변이G2: ProjectDb 에 새 이름의 공용 통행구가 생기면 형태 검사가 실패한다', () => {
  const bad = mutate(projectDb, '        private static string BuildConnString() =>', CHECK_FN);
  const host = stripCs(bad) + '\n' + stripCs(mainWindow);
  assert.throws(() => revive.noPlaintextSecretCompare(host), /평문 비밀문자열 비교가 있다/);
  assert.throws(() => revive.noSecretGateFunction(host), /문자열 검증으로 여는 함수가 생겼다/);
  assert.throws(() => revive.noUnlockStateFlag(host), /잠금해제 개념의 식별자가 되살아났다/);
  // 옛 이름 금지 목록(VerifyAdmin/SaveAdminCred/…)은 이 부활을 한 건도 잡지 못한다.
  for (const dead of ['VerifyAdmin(', 'SaveAdminCred(', 'IsAdminUnlocked(', 'SetAdminUnlocked(']) {
    assert.ok(!bad.includes(dead), `변이 전제: 옛 어휘는 쓰지 않는다(${dead})`);
  }
});

test('변이G2-b: 브리지에 새 잠금해제 명령이 생기면 상태 플래그·비밀번호 자리 검사가 실패한다', () => {
  let bad = mutate(mainWindow, '                    case "userLogout":', UNLOCK_CASE);
  bad = mutate(bad, '        private bool _desktopApplied = false;', '        private bool _editingUnlocked = false;\n        private bool _desktopApplied = false;');
  assert.throws(() => revive.hostPwReadsAreBounded(bad), /비밀번호를 3곳에서 읽는다/);
  assert.throws(() => revive.noUnlockStateFlag(stripCs(projectDb) + '\n' + stripCs(bad)), /잠금해제 개념의 식별자가 되살아났다/);
  // 옛 이름 기준의 브리지 케이스 금지는 새 명령을 못 본다.
  for (const c of ['adminLogin', 'adminLogout', 'adminStateGet', 'saveAdminCred']) {
    assert.ok(!new RegExp(`case "${c}":`).test(bad), `변이 전제: 옛 브리지 이름은 쓰지 않는다(${c})`);
  }
});

test('변이G2-c: 웹이 새 명령으로 비밀번호를 실어 보내면 웹 검사가 실패한다', () => {
  const bad = mutate(src, "hpost({ cmd: 'loadCustomers' });", "hpost({ cmd: 'unlockEditing', pw }); hpost({ cmd: 'loadCustomers' });");
  assert.throws(() => revive.webSendsSecretOnlyToLogin(bad), /웹이 브리지\(hpost\)로 비밀번호를 보낸다/);
});

test('변이G2-d: 로그인 외의 왕복이 비밀번호를 실으면 웹 검사가 실패한다', () => {
  const bad = mutate(src, "await hostRequest('userInfoGet', {}, 10000)", "await hostRequest('unlockEditing', { pw }, 10000)");
  assert.throws(() => revive.webSendsSecretOnlyToLogin(bad), /로그인\(userLogin\) 하나뿐이어야 한다/);
});
