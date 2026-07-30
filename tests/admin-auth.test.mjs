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
