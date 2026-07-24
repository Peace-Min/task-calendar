// 관리자 인증 — 우회 취약점 회귀 방지 + 설정 인증 UX 통일 (2026-07-24)
//
// 발견 경위: 폐쇄망 실사용 테스트에서 사용자가 발견, CDP로 실증됨.
//   viewer(미인증) → saveAdminCred 호출 → 성공 → 공격자 비번으로 admin 획득 + 원래 관리자 잠김(DoS).
// 원인 둘: ① 웹 '등록' 버튼에 인증 게이트 없음 ② 호스트 SaveAdminCred가 현재 인증 상태를 확인하지 않음.
// ★ 진짜 방어선은 ②다 — 브리지 메시지는 웹에서 직접 던질 수 있어 UI 게이트만으론 우회된다.
//   그래서 이 파일의 핵심은 '호스트가 미인증 변경을 거부하는가'이고, 나머지는 UX 통일의 구조 검증이다.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';
import { readFileSync } from 'node:fs';

const src = loadAppSource();
const projectDb = readFileSync(new URL('../widget/ProjectDb.cs', import.meta.url), 'utf8');
const mainWindow = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');

// SaveAdminCred 본문만 잘라낸다(다음 멤버 VerifyAdmin 직전까지).
function saveAdminCredBody() {
  const s = projectDb.indexOf('public (bool ok, string msg) SaveAdminCred');
  assert.ok(s >= 0, 'SaveAdminCred 선언을 찾지 못함');
  const e = projectDb.indexOf('public (string? role, string msg) VerifyAdmin');
  assert.ok(e > s, 'VerifyAdmin 선언을 찾지 못함(경계)');
  return projectDb.slice(s, e);
}

// ── ★ 호스트 레벨 방어 (핵심 회귀 방지) ────────────────────────────────

test('보안(핵심): 호스트 SaveAdminCred는 미인증(AdminUnlocked=false)이면 거부한다', () => {
  const b = saveAdminCredBody();
  // 잠금해제 검사가 '자격을 건드리기 전에' 와야 한다 — 뒤에 있으면 이미 덮어쓴 뒤라 의미가 없다.
  const guard = b.indexOf('if (!a.AdminUnlocked)');
  assert.ok(guard >= 0, '미인증 거부 가드가 없다 — 아무나 관리자 비번을 갈아치울 수 있다');
  const assignId = b.indexOf('a.AdminId = id');
  const assignPw = b.indexOf('a.AdminPw = pw');
  assert.ok(assignId > guard && assignPw > guard, '가드가 자격 대입보다 뒤에 있다(이미 덮어쓴 뒤 거부해도 소용없다)');
  // 거부는 (false, 안내)로 — 조용히 성공한 척하면 안 된다.
  assert.ok(/return \(false, "관리자 인증 후에 변경할 수 있습니다\."\);/.test(b), '거부 시 반환 계약이 다르다');
});

test('보안: 거부 경로는 로그를 남긴다(우회 시도 추적)', () => {
  const b = saveAdminCredBody();
  const guard = b.slice(b.indexOf('if (!a.AdminUnlocked)'), b.indexOf('return (false, "관리자 인증'));
  assert.ok(/_log\(/.test(guard), '미인증 변경 거부가 로그에 남지 않는다');
});

test('보안: 인증 상태 판단은 저장된 설정(LoadAdmin) 한 곳에서만 온다', () => {
  const b = saveAdminCredBody();
  // 웹이 보낸 값이 아니라 호스트가 읽은 파일 상태로 판단해야 한다(클라이언트가 주장하는 역할을 믿지 않는다).
  assert.ok(/var a = LoadAdmin\(\);/.test(b), 'LoadAdmin으로 현재 상태를 읽지 않는다');
  assert.ok(/if \(!a\.AdminUnlocked\)/.test(b), '가드가 LoadAdmin 결과(a)가 아닌 다른 출처를 본다');
  // 시그니처는 id·pw만 받는다 — 호출측이 '나 인증됐다'를 파라미터로 주장할 수 없어야 한다.
  const sig = /public \(bool ok, string msg\) SaveAdminCred\(([^)]*)\)/.exec(b);
  assert.ok(sig, 'SaveAdminCred 시그니처를 찾지 못함');
  assert.strictEqual(sig[1].trim(), 'string? id, string? pw',
    '인증 상태를 인자로 받으면 호출측이 위조할 수 있다: ' + sig[1]);
});

test('변경 성공 후에도 관리자 모드는 유지된다(불필요한 재인증 마찰 제거)', () => {
  const b = saveAdminCredBody();
  assert.ok(/a\.AdminUnlocked = true;/.test(b), '변경 후 잠금해제를 유지하지 않는다');
  assert.ok(!/a\.AdminUnlocked = false;/.test(b), '변경 후 잠금을 내린다(옛 동작 — 이미 인증한 사람이 바꾼 것이라 불필요)');
});

test('부트스트랩/복구 경로가 막히지 않는다: 최초 인증은 배포 구성 디폴트로 가능', () => {
  // VerifyAdmin은 config가 비면 DeployConfig 디폴트로 폴백한다 → 최초엔 디폴트로 인증 후 변경하면 된다.
  const v = projectDb.slice(projectDb.indexOf('public (string? role, string msg) VerifyAdmin'));
  assert.ok(/DeployConfig\.AdminPw/.test(v), '베이크 디폴트 폴백이 없으면 최초 인증이 불가능해 영구 잠김이 된다');
  assert.ok(/DeployConfig\.AdminId/.test(v), 'ID 디폴트 폴백이 없다');
});

test('브리지: saveAdminCred는 호스트 검사를 거치고 결과를 웹에 그대로 전달한다', () => {
  const i = mainWindow.indexOf('case "saveAdminCred":');
  assert.ok(i >= 0, 'saveAdminCred 케이스가 없다');
  const b = mainWindow.slice(i, i + 900);
  assert.ok(/_projectDb\.SaveAdminCred\(/.test(b), '호스트 검증 함수를 거치지 않는다');
  assert.ok(/__adminSaved/.test(b), '결과 통지(__adminSaved)가 없다 — 거짓 성공 표시 위험');
  assert.ok(/SendAdminState\(\)/.test(b), '상태 재통지가 없어 배지가 어긋날 수 있다');
});

// ── 웹: 즉석 프롬프트(UAC) 제거 · 설정 인증으로 통일 ────────────────────

test('죽은 코드 0: 즉석 인증 프롬프트 경로가 완전히 제거됐다', () => {
  for (const dead of ['requireAdmin', 'submitAdminPrompt', '__adminPendingFn', 'adminPromptModal',
                      'admPromptPw', 'admPromptOk', 'admPromptMsg', 'admPromptDesc',
                      'adm-p-desc', 'adm-p-msg']) {
    assert.ok(!src.includes(dead), `제거 대상이 남아 있다: ${dead}`);
  }
});

test('offEditGuard: 미인증이면 비밀번호를 묻지 않고 설정으로 유도한다', () => {
  const b = extractFunction(src, 'offEditGuard');
  assert.ok(/getRole\(\) !== 'admin'/.test(b), '역할 검사가 없다');
  assert.ok(/adminAuthNeeded\(\)/.test(b), '미인증 시 설정 유도 경로를 쓰지 않는다');
  assert.ok(!/requireAdmin/.test(b), '즉석 프롬프트 호출이 남아 있다');
  // 게이트 순서: 위젯 → 온라인 → 관리자 (이유별로 다음 행동이 다르다)
  assert.ok(b.indexOf('!HOST') < b.indexOf('!dbOnline'), '위젯 검사가 온라인 검사보다 뒤에 있다');
  assert.ok(b.indexOf('!dbOnline') < b.indexOf("getRole()"), '온라인 검사가 역할 검사보다 뒤에 있다');
});

test('설정 유도: netcus 가드와 같은 형태(안내 + 설정 열기 + 인증칸 포커스)', () => {
  const b = extractFunction(src, 'adminAuthNeeded');
  assert.ok(/openSettings\(\)/.test(b), '설정을 열지 않는다');
  assert.ok(/admAuthPw/.test(b), '관리자 비밀번호 입력칸에 포커스를 주지 않는다');
  // toast의 액션 버튼은 Undo 전용(클릭 후 "되돌렸습니다"를 띄운다)이라 쓰면 안 된다.
  assert.ok(!/toast\([^)]*\{[\s\S]*label:/.test(b), 'toast 액션 버튼을 쓰면 클릭 후 "되돌렸습니다"가 뜬다');
});

test('설정 인증: 비번은 호스트로만 보내고 JS에 남기지 않는다', () => {
  const b = extractFunction(src, 'submitAdminAuth');
  assert.ok(/cmd: 'adminLogin'/.test(b), 'adminLogin 경로를 쓰지 않는다');
  assert.ok(!/localStorage|sessionStorage/.test(b), '비밀번호가 로컬 저장소에 닿는다');
  assert.ok(/!HOST/.test(b), '브라우저 모드 가드가 없다');
});

test('설정 인증: 성공/실패 모두 입력칸을 비운다(비번이 화면에 남지 않게)', () => {
  const i = src.indexOf('window.__adminResult');
  const b = src.slice(i, src.indexOf('window.__adminSaved'));
  assert.ok(/admAuthPw/.test(b), '인증 입력칸을 다루지 않는다');
  const clears = b.match(/pw\.value = ''/g) || [];
  assert.ok(clears.length >= 2, `성공·실패 양쪽에서 비우지 않는다(발견 ${clears.length}곳)`);
});

// ── 설정 UI: 미인증/인증 상태별 노출 ───────────────────────────────────

test('설정 UI: 미인증=인증칸 / 인증됨=해제+비밀번호 변경', () => {
  const b = extractFunction(src, 'updateAdminUi');
  assert.ok(/admAuthBlock', HOST && !admin/.test(b), '미인증일 때 인증칸을 보이지 않는다');
  assert.ok(/admUnlockedBlock', HOST && admin/.test(b), '인증됨일 때 해제 블록을 보이지 않는다');
  assert.ok(/admChangeBlock', HOST && admin/.test(b), '비밀번호 변경이 인증 상태와 무관하게 노출된다(취약점 UI 경로)');
  assert.ok(/· 뷰어 · 인증 필요/.test(b), '뷰어 배지 문구가 새 흐름과 맞지 않다');
});

test('설정 UI: 필요한 요소가 마크업에 존재한다', () => {
  for (const id of ['admAuthBlock', 'admAuthPw', 'admAuthOk', 'admUnlockedBlock',
                    'admChangeBlock', 'admRegId', 'admRegPw', 'admRegSave', 'admLogout']) {
    assert.ok(new RegExp('id="' + id + '"').test(src), `설정 관리자 섹션에 #${id}가 없다`);
  }
  // 변경 블록은 기본 숨김(인증 전 노출 금지) — updateAdminUi가 켜 준다.
  assert.ok(/class="hidden" id="admChangeBlock"/.test(src), '비밀번호 변경 블록이 기본 노출 상태다');
  assert.ok(/class="adm-row hidden" id="admUnlockedBlock"/.test(src), '해제 블록이 기본 노출 상태다');
});

test('설정 UI: 변경 버튼도 클라이언트에서 한 번 더 막는다(이중 방어)', () => {
  const i = src.indexOf("$('#admRegSave')");
  assert.ok(i >= 0, 'admRegSave 핸들러가 없다');
  const b = src.slice(i, i + 800);
  assert.ok(/getRole\(\) !== 'admin'/.test(b), '변경 버튼에 역할 검사가 없다(취약점 원인 지점)');
  assert.ok(/adminAuthNeeded\(\)/.test(b), '미인증 클릭 시 설정 유도를 하지 않는다');
  assert.ok(/cmd: 'saveAdminCred'/.test(b), '변경 요청 경로가 다르다');
});

test('라벨: "관리자 자격 등록"이 아니라 "관리자 비밀번호 변경"으로 읽힌다', () => {
  assert.ok(!/관리자 자격 등록/.test(src), '옛 라벨이 남아 로그인으로 오해할 수 있다(사용자가 실제로 오해한 지점)');
  assert.ok(/관리자 비밀번호 변경/.test(src), '변경 라벨이 없다');
});