// 식별·유니크 규칙 재정의 (2026-07-24, ADR-21) — 이름 하드 유니크 제거 + 소프트 경고 + TRIM + NOT NULL DEFAULT ''.
// 근거·결정: db/TABLE-DESIGN.md §4.
//
// ★ 실 동작(연도갱신 실삽입·소프트경고·마이그레이션 ALTER)은 코디네이터가 실 MySQL(throwaway)로 게이트한다.
//   여기서는 (1) 스키마/호스트/브리지/웹 소스의 계약을 못박고(회귀 방지),
//   (2) 소프트경고의 '정규화 매칭 결정'을 JS로 포팅해 실데이터 시나리오(구성품/연도갱신/끝공백)로 검증한다.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';
import { readFileSync } from 'node:fs';

const src = loadAppSource();
const projectDb = readFileSync(new URL('../widget/ProjectDb.cs', import.meta.url), 'utf8');
const mainWindow = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const schemaDeploy = readFileSync(new URL('../db/deploy/schema-structure.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../db/deploy/migrate-2026-07-24-uniqueness.sql', import.meta.url), 'utf8');

// ── 스키마: 유니크 제거 · uid 존치 · NOT NULL DEFAULT '' (두 파일 모두) ───────────────
for (const [label, sql] of [['schema.sql', schema], ['deploy/schema-structure.sql', schemaDeploy]]) {
  test(`스키마(${label}): (customer, project_name) 하드 유니크가 제거됐다`, () => {
    assert.ok(!/UNIQUE KEY uq_project \(customer, project_name\)/.test(sql), 'uq_project(customer, project_name)가 남아 있다');
    assert.ok(!/uq_project\b(?!_uid)/.test(sql.replace(/uq_project_uid/g, '')), '이름 유니크 잔재가 있다');
  });
  test(`스키마(${label}): uid 유니크는 유지 · customer 조회 인덱스도 유지`, () => {
    assert.ok(/UNIQUE KEY uq_project_uid \(uid\)/.test(sql), 'uq_project_uid(uid)가 사라졌다(과제 정체성)');
    assert.ok(/KEY ix_project_customer \(customer\)/.test(sql), 'ix_project_customer가 사라졌다(발주처 조회·소프트경고 후보)');
  });
  test(`스키마(${label}): contract_name·common_name = NOT NULL DEFAULT ''`, () => {
    assert.ok(/contract_name VARCHAR\(200\) NOT NULL DEFAULT ''/.test(sql), "contract_name이 NOT NULL DEFAULT ''가 아니다");
    assert.ok(/common_name\s+VARCHAR\(200\) NOT NULL DEFAULT ''/.test(sql), "common_name이 NOT NULL DEFAULT ''가 아니다");
  });
  test(`스키마(${label}): "같은 발주처 동일 사업명 금지" 문구가 사라졌다`, () => {
    assert.ok(!/동일 사업명 금지/.test(sql), '유니크 전제 주석이 남아 있다');
  });
}

// ── 마이그레이션 스크립트 ───────────────────────────────────────────────
test('마이그레이션: NULL→\'\' 선처리 → DROP uq_project → MODIFY NOT NULL DEFAULT \'\' 순서', () => {
  const iFillCn = migration.indexOf("UPDATE project SET contract_name = ''");
  const iFillMn = migration.indexOf("UPDATE project SET common_name   = ''");
  const iDrop = migration.indexOf('DROP INDEX uq_project');
  const iModify = migration.indexOf('MODIFY contract_name VARCHAR(200) NOT NULL DEFAULT');
  assert.ok(iFillCn >= 0 && iFillMn >= 0, 'NULL→\'\' 선처리가 없다(NOT NULL 전환이 실패한다)');
  assert.ok(iDrop >= 0, 'DROP INDEX uq_project가 없다');
  assert.ok(iModify >= 0, 'MODIFY NOT NULL DEFAULT가 없다');
  assert.ok(iFillCn < iModify && iFillMn < iModify, 'NULL 채우기가 MODIFY보다 뒤에 있다(전환 실패)');
  assert.ok(/멱등.*아님|아님.*멱등/.test(migration), '멱등 아님 경고가 없다');
  assert.ok(/최초 구축은 schema/.test(migration), '최초 구축 vs 마이그레이션 구분 안내가 없다');
  // uid 유니크는 건드리지 않는다(과제 정체성)
  assert.ok(!/DROP INDEX uq_project_uid/.test(migration), '마이그레이션이 uid 유니크를 지운다(정체성 파괴)');
});

// ── 호스트 ProjectDb: 시그니처·반환계약·TRIM·1062 정정·죽은 코드 ─────────
function upsertBody() {
  const s = projectDb.indexOf('public async Task<(bool ok, string msg, bool needConfirm)> UpsertProjectAsync');
  assert.ok(s >= 0, 'UpsertProjectAsync가 3-튜플 반환으로 바뀌지 않았다');
  const e = projectDb.indexOf('private static async Task<(string pn, string cn)?> FindSimilarActiveAsync');
  assert.ok(e > s, 'FindSimilarActiveAsync 경계를 찾지 못함');
  return projectDb.slice(s, e);
}

test('호스트: UpsertProjectAsync에 confirmSimilar 파라미터 + needConfirm 반환', () => {
  const b = upsertBody();
  assert.ok(/bool confirmSimilar = false\)/.test(b), 'confirmSimilar 파라미터가 없다');
  // 소프트경고 반환: (false, msg, true)
  assert.ok(/return \(false,\s*\n?\s*"비슷한 과제가 있습니다: /.test(b) || /비슷한 과제가 있습니다: /.test(b), '소프트경고 메시지가 없다');
  assert.ok(/,\s*\n?\s*true\);/.test(b), 'needConfirm=true 반환이 없다');
  // 성공 반환은 needConfirm=false
  assert.ok(/return \(true, "공식 과제를 추가했습니다\.", false\);/.test(b), '추가 성공 반환 계약이 다르다');
  assert.ok(/return \(true, "공식 과제를 저장했습니다\.", false\);/.test(b), '수정 성공 반환 계약이 다르다');
});

test('호스트: 이름 필드 TRIM + 빈 계약명/통상명칭은 \'\'(NULL 금지)', () => {
  const b = upsertBody();
  assert.ok(/string cn = \(contractName \?\? ""\)\.Trim\(\), mn = \(commonName \?\? ""\)\.Trim\(\);/.test(b),
    '계약명·통상명칭 TRIM이 없다');
  assert.ok(/string sec = \(section \?\? ""\)\.Trim\(\), cust = \(customer \?\? ""\)\.Trim\(\), pname = \(projectName \?\? ""\)\.Trim\(\);/.test(b),
    '발주처·사업명 TRIM이 없다');
  // BindProject는 cn/mn을 TextOrNull(빈값→NULL) 하지 않고 그대로 문자열로 쓴다
  const bind = projectDb.slice(projectDb.indexOf('private static void BindProject'), projectDb.indexOf('private static void BindProject') + 700);
  assert.ok(/AddWithValue\("@cn", cn\)/.test(bind), '@cn을 문자열 그대로 쓰지 않는다(빈값이 NULL이 된다)');
  assert.ok(/AddWithValue\("@mn", mn\)/.test(bind), '@mn을 문자열 그대로 쓰지 않는다');
  assert.ok(!/TextOrNull\(contractName\)|TextOrNull\(commonName\)/.test(projectDb), '계약명/통상명칭에 TextOrNull(→NULL)이 남아 있다');
});

test('호스트: INSERT에만 소프트경고, UPDATE(자기수정)엔 검사 없음', () => {
  const b = upsertBody();
  // confirmSimilar 검사는 u.Length==0(INSERT) 블록 안에 있어야 한다
  const insBlock = b.slice(b.indexOf('if (u.Length == 0)'), b.indexOf('const string upd'));
  assert.ok(/if \(!confirmSimilar\)/.test(insBlock), 'INSERT 블록에 소프트경고 검사가 없다');
  assert.ok(/FindSimilarActiveAsync\(conn, cts\.Token, cust, pname, cn\)/.test(insBlock), '유사 검사 호출이 없다');
  const updBlock = b.slice(b.indexOf('const string upd'));
  assert.ok(!/FindSimilarActiveAsync/.test(updBlock), 'UPDATE에도 유사 검사가 걸려 자기수정이 막힌다');
});

test('호스트: FindSimilarActiveAsync는 활성 과제만 후보로, C#에서 정규화 비교', () => {
  const s = projectDb.indexOf('private static async Task<(string pn, string cn)?> FindSimilarActiveAsync');
  const b = projectDb.slice(s, projectDb.indexOf('private static void BindProject'));
  assert.ok(/WHERE customer=@c AND is_active=1/.test(b), '활성 과제만 후보로 삼지 않는다');
  assert.ok(/NormalizeName\(ep\) == nPn && NormalizeName\(ec\) == nCn/.test(b), '(사업명, 계약명) 정규화 동시 비교가 아니다');
});

test('호스트: MySqlMsg에서 (customer, project_name) 1062 문구 제거, 발주처 1062는 유지', () => {
  const m = projectDb.slice(projectDb.indexOf('private static string MySqlMsg'), projectDb.indexOf('private static string NormalizeName'));
  assert.ok(!/같은 발주처에 동일 사업명이 이미 있습니다/.test(m), 'project 1062 문구가 남아 있다');
  assert.ok(!/case 1062:/.test(m), 'MySqlMsg에 1062 케이스가 남아 있다(project엔 이제 이름 유니크가 없다)');
  // 발주처 이름 PK 1062는 AddCustomerAsync에서 별도 처리 — 그대로 유지
  assert.ok(/mex\.Number == 1062/.test(projectDb) && /이미 등록된 발주처입니다/.test(projectDb), '발주처 1062 처리가 사라졌다');
});

test('호스트: 죽은 코드 — SoftDeletedDuplicateExistsAsync 제거', () => {
  assert.ok(!/SoftDeletedDuplicateExistsAsync/.test(projectDb), '숨김 중복 확인 함수가 남아 있다(이름 유니크 전제 코드)');
  assert.ok(!/숨김 처리된 동일 사업명/.test(projectDb), '숨김 동일 사업명 안내가 남아 있다');
});

// ── 브리지 & 웹 계약 ────────────────────────────────────────────────────
test('브리지: saveProject가 confirm을 읽어 전달, ProjectSaved가 needConfirm 3인자로 통지', () => {
  assert.ok(/GetStr\(doc, "status"\), GetBool\(doc, "confirm"\)\);/.test(mainWindow), 'saveProject가 confirm을 읽지 않는다');
  assert.ok(/confirmSimilar: confirm/.test(mainWindow), 'confirm을 UpsertProjectAsync로 전달하지 않는다');
  assert.ok(/private void ProjectSaved\(bool ok, string msg, bool needConfirm = false\)/.test(mainWindow),
    'ProjectSaved가 needConfirm 3인자가 아니다');
  assert.ok(/\(needConfirm \? "true" : "false"\) \+ "\)"/.test(mainWindow), '__projectSaved에 needConfirm을 넘기지 않는다');
  // setProjectActive는 2인자 호출 그대로(기본 false) — 정합
  assert.ok(/ProjectSaved\(ok, msg\);   \/\/ needConfirm 기본 false/.test(mainWindow), 'setProjectActive 정합 주석/호출이 다르다');
});

test('웹: needConfirm이면 confirmBox 후 confirm:true로 재전송', () => {
  assert.ok(/window\.__projectSaved = function\(ok, msg, needConfirm\)/.test(src), '__projectSaved가 needConfirm 3인자가 아니다');
  const fn = src.slice(src.indexOf('window.__projectSaved = function(ok, msg, needConfirm)'),
                       src.indexOf('// 소프트삭제(is_active=0)'));
  assert.ok(/if\(!ok && needConfirm\)\{/.test(fn), '소프트경고 분기가 없다');
  assert.ok(/confirmBox\('비슷한 과제'/.test(fn), 'confirmBox 안내가 없다');
  assert.ok(/offEdSend\(Object\.assign\(\{\}, pending, \{ confirm: true \}\)\)/.test(fn), 'confirm:true 재전송이 없다');
  assert.ok(/if\(r === 'ok'/.test(fn), "confirmBox 'ok' 규약을 쓰지 않는다");
});

test('웹: offEdSend가 payload를 보관(재전송용)하고 offEdSaveNow가 이를 쓴다', () => {
  const send = extractFunction(src, 'offEdSend');
  assert.ok(/__offEdPending = payload/.test(send), '재전송용 payload 보관이 없다');
  assert.ok(/hpost\(payload\)/.test(send), 'payload 전송이 없다');
  const save = extractFunction(src, 'offEdSaveNow');
  assert.ok(/offEdSend\(payload\)/.test(save), 'offEdSaveNow가 offEdSend로 위임하지 않는다');
});

test('웹: 편집폼이 이름을 TRIM해서 전송(호스트가 최종 권위지만 UX 일관)', () => {
  const save = extractFunction(src, 'offEdSaveNow');
  assert.ok(/const val = id => \{[^}]*String\(e\.value \|\| ''\)\.trim\(\)/.test(save), '전송 전 TRIM이 없다');
});

test('웹: 안내문에서 "같은 사업명은 등록할 수 없습니다"가 사라지고 소프트경고 안내로 대체', () => {
  assert.ok(!/같은 사업명은 등록할 수 없습니다/.test(src), '유니크 전제 안내문이 남아 있다');
  assert.ok(/비슷한 과제가 있으면 확인을 요청합니다/.test(src), '소프트경고 안내문이 없다');
});

// ── 소프트경고 '정규화 매칭 결정' 포팅 — 실데이터 시나리오로 검증 ─────────
// C# NormalizeName(= TRIM + 연속공백 1칸 + 소문자)과 동치인 JS 포팅. C# 정의를 소스에서 확인해 드리프트를 잡는다.
test('호스트: NormalizeName 정의가 TRIM + 연속공백 축소 + 소문자화다', () => {
  assert.ok(/Regex\.Replace\(\(s \?\? ""\)\.Trim\(\), @"\\s\+", " "\)\.ToLowerInvariant\(\)/.test(projectDb),
    'NormalizeName 정의가 기대와 다르다(포팅 테스트의 전제가 깨짐)');
});
const norm = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
// 같은 발주처 후보들 중 (사업명, 계약명) 정규화가 신규와 일치하는 게 있으면 needConfirm.
const wouldWarn = (existing, incoming) => existing.some(e =>
  norm(e.pn) === norm(incoming.pn) && norm(e.cn) === norm(incoming.cn));

test('소프트경고: 연도별 갱신(사업명·계약명 동일, 날짜만 다름) → 경고 후 confirm으로 둘 다 저장 가능', () => {
  const existing = [{ pn: '○○유지보수', cn: '○○유지보수' }];   // 2024–2025
  const incoming = { pn: '○○유지보수', cn: '○○유지보수' };      // 2026–2027, 날짜만 다름
  assert.strictEqual(wouldWarn(existing, incoming), true, '연도갱신이 경고되지 않으면 사용자가 확인할 기회가 없다');
  // confirm:true(=검사 건너뜀)면 저장된다 → 두 건이 각자 uid로 공존(호스트 게이트에서 실삽입 검증)
});

test('소프트경고: 구성품별 계약(같은 사업명, 다른 계약명) → 경고 없이 저장', () => {
  const existing = [{ pn: '체계1', cn: '저장장치' }];
  const incoming = { pn: '체계1', cn: '처리장치' };   // 계약명이 다르다
  assert.strictEqual(wouldWarn(existing, incoming), false, '계약명이 다른데 경고하면 정상 등록을 막는다');
});

test('소프트경고: 끝공백/연속공백 변형 → 정규화가 같아 경고(하드 유니크는 못 잡는 케이스)', () => {
  const existing = [{ pn: '개발벤치SW', cn: '' }];
  assert.strictEqual(wouldWarn(existing, { pn: '개발벤치SW ', cn: '' }), true, '끝공백 변형을 못 잡는다');
  assert.strictEqual(wouldWarn(existing, { pn: '개발벤치SW', cn: '' }), true, '동일 이름을 못 잡는다');
  assert.strictEqual(wouldWarn([{ pn: '개발  벤치 SW', cn: '' }], { pn: '개발 벤치 SW', cn: '' }), true, '연속공백 차이를 못 잡는다');
});

test('소프트경고: 빈 계약명끼리는 같게, 한쪽만 계약명 있으면 다르게', () => {
  assert.strictEqual(wouldWarn([{ pn: 'A', cn: '' }], { pn: 'A', cn: '' }), true, '둘 다 빈 계약명이면 같다');
  assert.strictEqual(wouldWarn([{ pn: 'A', cn: '' }], { pn: 'A', cn: '계약X' }), false, '계약명 유무가 다르면 별건이다');
});
