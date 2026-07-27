// 구분/상태 ENUM → 룩업 코드테이블(section_code/status_code) + FK 전환 + note 컬럼 (2026-07-24).
// 발주처(customer) 패턴을 대칭 복제. 실 MySQL 검증은 코디네이터 게이트; 여기서는 스키마·마이그레이션·호스트·브리지·웹의
// 계약을 소스에서 못박는다(회귀 방지). 순수 로직(코드목록 파싱·순서 스왑)은 JS로 포팅해 동작을 확인한다.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';
import { readFileSync } from 'node:fs';

const src = loadAppSource();
const projectDb = readFileSync(new URL('../widget/ProjectDb.cs', import.meta.url), 'utf8');
const mainWindow = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const schemaDeploy = readFileSync(new URL('../db/deploy/schema-structure.sql', import.meta.url), 'utf8');
const migratePs1 = readFileSync(new URL('../db/deploy/migrate.ps1', import.meta.url), 'utf8');

// ── 스키마: 코드테이블 · FK · note (두 파일 모두) ───────────────────────
for (const [label, sql] of [['schema.sql', schema], ['deploy/schema-structure.sql', schemaDeploy]]) {
  test(`스키마(${label}): section_code/status_code 테이블(name PK·sort_order·is_active)`, () => {
    for (const t of ['section_code', 'status_code']) {
      const re = new RegExp('CREATE TABLE ' + t + '[\\s\\S]{0,400}?PRIMARY KEY \\(name\\)');
      assert.ok(re.test(sql), `${t} 테이블 정의가 없다`);
      const block = sql.slice(sql.indexOf('CREATE TABLE ' + t), sql.indexOf('PRIMARY KEY (name)', sql.indexOf('CREATE TABLE ' + t)));
      assert.ok(/name\s+VARCHAR\(50\)\s+NOT NULL/.test(block), `${t}.name VARCHAR(50) NOT NULL이 아니다`);
      assert.ok(/sort_order\s+INT\s+NOT NULL DEFAULT 0/.test(block), `${t}.sort_order 정의가 다르다`);
      assert.ok(/is_active\s+TINYINT\(1\)\s+NOT NULL DEFAULT 1/.test(block), `${t}.is_active 정의가 다르다`);
    }
  });
  test(`스키마(${label}): project.section VARCHAR+NOT NULL, status VARCHAR+NULL, note VARCHAR(500) NOT NULL DEFAULT ''`, () => {
    assert.ok(/section\s+VARCHAR\(50\)\s+NOT NULL/.test(sql), 'project.section이 VARCHAR(50) NOT NULL이 아니다');
    assert.ok(/status\s+VARCHAR\(50\)\s+NULL/.test(sql), 'project.status가 VARCHAR(50) NULL이 아니다');
    assert.ok(/note\s+VARCHAR\(500\) NOT NULL DEFAULT ''/.test(sql), "project.note가 NOT NULL DEFAULT ''가 아니다");
    assert.ok(!/section\s+ENUM/.test(sql) && !/status\s+ENUM/.test(sql), 'ENUM 정의가 남아 있다');
  });
  test(`스키마(${label}): FK fk_project_section/status = ON UPDATE CASCADE ON DELETE RESTRICT`, () => {
    assert.ok(/CONSTRAINT fk_project_section FOREIGN KEY \(section\) REFERENCES section_code\(name\)[\s\S]{0,80}ON UPDATE CASCADE ON DELETE RESTRICT/.test(sql),
      'fk_project_section이 없거나 CASCADE/RESTRICT가 아니다');
    assert.ok(/CONSTRAINT fk_project_status FOREIGN KEY \(status\) REFERENCES status_code\(name\)[\s\S]{0,80}ON UPDATE CASCADE ON DELETE RESTRICT/.test(sql),
      'fk_project_status가 없거나 CASCADE/RESTRICT가 아니다');
    // 발주처 FK도 유지
    assert.ok(/fk_project_customer FOREIGN KEY \(customer\) REFERENCES customer\(name\)/.test(sql), '발주처 FK가 사라졌다');
  });
  test(`스키마(${label}): DROP 순서 — project 먼저, 코드테이블 포함`, () => {
    const iProj = sql.indexOf('DROP TABLE IF EXISTS project;');
    const iSec = sql.indexOf('DROP TABLE IF EXISTS section_code;');
    const iSt = sql.indexOf('DROP TABLE IF EXISTS status_code;');
    assert.ok(iProj >= 0 && iSec >= 0 && iSt >= 0, '코드테이블 DROP이 없다');
    assert.ok(iProj < iSec && iProj < iSt, 'project를 코드테이블보다 먼저 DROP하지 않는다(FK 참조 순서)');
  });
  test(`스키마(${label}): 코드테이블 표준 시드(일반계약/선진행/사업부관리 · 진행중/종료/1차 납품완료/미정)`, () => {
    assert.ok(/INSERT INTO section_code[\s\S]{0,120}'일반계약', 10[\s\S]{0,60}'선진행', 20[\s\S]{0,60}'사업부관리', 30/.test(sql),
      'section_code 시드가 없거나 sort_order가 다르다');
    assert.ok(/INSERT INTO status_code[\s\S]{0,160}'진행중', 10[\s\S]{0,120}'미정', 40/.test(sql), 'status_code 시드가 없다');
  });
}

// ── 마이그레이션 — 멱등 단계 ────────────────────────────────────────────
test('마이그레이션: 코드테이블 CREATE IF NOT EXISTS + INSERT IGNORE 시드 + 기존값 흡수(SELECT DISTINCT)', () => {
  assert.ok(/CREATE TABLE IF NOT EXISTS ``\$DbName``\.section_code/.test(migratePs1), 'section_code CREATE IF NOT EXISTS가 없다');
  assert.ok(/CREATE TABLE IF NOT EXISTS ``\$DbName``\.status_code/.test(migratePs1), 'status_code CREATE IF NOT EXISTS가 없다');
  assert.ok(/INSERT IGNORE INTO ``\$DbName``\.section_code \(name,sort_order\) VALUES/.test(migratePs1), 'section 표준 시드(INSERT IGNORE)가 없다');
  // 안전망: FK 붙이기 전 기존 project 값 흡수
  assert.ok(/INSERT IGNORE INTO ``\$DbName``\.section_code \(name,sort_order\) SELECT DISTINCT section, 900 FROM ``\$DbName``\.project/.test(migratePs1),
    'project.section 기존값 흡수가 없다(FK 생성 실패 위험)');
  assert.ok(/INSERT IGNORE INTO ``\$DbName``\.status_code \(name,sort_order\) SELECT DISTINCT status, 900 FROM ``\$DbName``\.project/.test(migratePs1),
    'project.status 기존값 흡수가 없다');
});
test('마이그레이션: ENUM→VARCHAR는 COLUMN_TYPE=enum일 때만 · FK는 없을 때만 · note는 없을 때만(멱등)', () => {
  assert.ok(/\$secType -like 'enum\*'/.test(migratePs1), 'section ENUM 조건 검사가 없다');
  assert.ok(/\$stType\s+-like 'enum\*'/.test(migratePs1), 'status ENUM 조건 검사가 없다');
  assert.ok(/MODIFY section VARCHAR\(50\) NOT NULL/.test(migratePs1), 'section VARCHAR 변경이 없다');
  assert.ok(/MODIFY status VARCHAR\(50\) NULL/.test(migratePs1), 'status VARCHAR NULL 변경이 없다');
  assert.ok(/\$hasFkSec -eq 0/.test(migratePs1) && /ADD CONSTRAINT fk_project_section/.test(migratePs1), 'section FK 조건부 추가가 없다');
  assert.ok(/\$hasFkSt -eq 0/.test(migratePs1) && /ADD CONSTRAINT fk_project_status/.test(migratePs1), 'status FK 조건부 추가가 없다');
  assert.ok(/\$hasNote -eq 0/.test(migratePs1) && /ADD COLUMN note VARCHAR\(500\) NOT NULL DEFAULT ''/.test(migratePs1), 'note 조건부 추가가 없다');
});
test('마이그레이션: 무손실 검증 — count before==after, 최종 최신이면 스킵', () => {
  assert.ok(/"\$custN" -ne "\$custA" -or "\$projN" -ne "\$projA"/.test(migratePs1), '데이터 건수 before==after 검증이 없다');
  assert.ok(/이미 반영됨\(건너뜀\)/.test(migratePs1), '단계1 멱등 스킵 문구가 없다');
});

// ── 호스트 ProjectDb — 코드 CRUD·로더·검증·note ─────────────────────────
test('호스트: 하드코딩 Sections/Statuses 배열이 제거됐다(코드테이블 로드로 대체)', () => {
  assert.ok(!/private static readonly string\[\] Sections/.test(projectDb), 'Sections 하드코딩 배열이 남아 있다');
  assert.ok(!/private static readonly string\[\] Statuses/.test(projectDb), 'Statuses 하드코딩 배열이 남아 있다');
});
test('호스트: ResolveCodeKind가 section→section_code/section, status→status_code/status로 해석', () => {
  const b = projectDb.slice(projectDb.indexOf('ResolveCodeKind'), projectDb.indexOf('ResolveCodeKind') + 700);
  assert.ok(/case "section": table = "section_code"; projCol = "section";/.test(b), 'section 매핑이 다르다');
  assert.ok(/case "status":\s+table = "status_code";\s+projCol = "status";/.test(b), 'status 매핑이 다르다');
  assert.ok(/default:[\s\S]{0,60}return false;/.test(b), '알 수 없는 kind 방어(default→false)가 없다');
});
test('호스트: 코드 로더 5종(활성 sections/statuses·full·nameset) 존재', () => {
  for (const m of ['LoadSectionCodesJsonAsync', 'LoadStatusCodesJsonAsync', 'LoadCodesFullJsonAsync', 'LoadCodeNameSetAsync']) {
    assert.ok(new RegExp('Task[^\\n]*' + m).test(projectDb), `${m}가 없다`);
  }
  // 드롭다운 로더는 활성만 sort_order 순
  assert.ok(/WHERE is_active=1 ORDER BY sort_order, name/.test(projectDb), '활성 코드 로더가 sort_order 순이 아니다');
  // full 로더는 활성 먼저 sort_order
  assert.ok(/ORDER BY is_active DESC, sort_order, name/.test(projectDb), 'full 로더 정렬이 다르다');
});
test('호스트: 코드 CRUD 5종(add/rename/setActive/reorder/refCount) 존재 + kind 파라미터', () => {
  for (const m of ['AddCodeAsync', 'RenameCodeAsync', 'SetCodeActiveAsync', 'ReorderCodesAsync', 'CountActiveProjectsByCodeAsync']) {
    assert.ok(new RegExp('public async Task[^\\n]*' + m + '\\(string\\? kind').test(projectDb), `${m}(kind …)가 없다`);
  }
});
test('호스트: rename은 CASCADE 의존(수동 UPDATE project 없음) · reorder는 트랜잭션', () => {
  const rn = projectDb.slice(projectDb.indexOf('RenameCodeAsync'), projectDb.indexOf('SetCodeActiveAsync'));
  assert.ok(/UPDATE \{table\} SET name=@new WHERE name=@old/.test(rn), '코드 개명이 name UPDATE가 아니다');
  assert.ok(!/UPDATE project SET/.test(rn), 'rename이 project를 직접 UPDATE한다(FK CASCADE로 자동 전파여야 함)');
  const ro = projectDb.slice(projectDb.indexOf('ReorderCodesAsync'), projectDb.indexOf('CountActiveProjectsByCodeAsync'));
  assert.ok(/BeginTransactionAsync/.test(ro) && /sort_order=@s/.test(ro), 'reorder가 트랜잭션 sort_order 재부여가 아니다');
});
test('호스트: 복구(setActive true)는 sort_order를 MAX+10으로 재부여 — 활성 순번 충돌 방지', () => {
  // 왜: 숨김은 sort_order를 그대로 두는데 reorder는 '활성 값만' 10·20·30…으로 재부여한다.
  // 옛 순번을 들고 복구되면 활성끼리 sort_order가 겹쳐 드롭다운 순서가 이름 tiebreak에 좌우된다.
  // (루프 UI 정합성 테스트 I5로 실측된 결함 — tests/loop-ui-integrity.mjs)
  const sa = projectDb.slice(projectDb.indexOf('SetCodeActiveAsync'), projectDb.indexOf('ReorderCodesAsync'));
  assert.ok(/is_active=1, *sort_order=\(SELECT/.test(sa), '복구가 sort_order를 재부여하지 않는다(순번 충돌 재발)');
  assert.ok(/COALESCE\(MAX\(sort_order\),0\)\+10/.test(sa), '복구 순번이 MAX+10(맨 뒤)이 아니다');
  assert.ok(/UPDATE \{table\} SET is_active=0 WHERE name=@n/.test(sa), '숨김은 sort_order를 건드리지 않아야 한다');
});
test('호스트: add는 1062로 활성/숨김 구분 · refCount는 활성 과제만', () => {
  const ad = projectDb.slice(projectDb.indexOf('AddCodeAsync'), projectDb.indexOf('RenameCodeAsync'));
  assert.ok(/mex\.Number == 1062/.test(ad) && /숨김 처리된 동일/.test(ad) && /이미 등록된/.test(ad), '1062 활성/숨김 분기가 없다');
  const rc = projectDb.slice(projectDb.indexOf('CountActiveProjectsByCodeAsync'));
  assert.ok(/SELECT COUNT\(\*\) FROM project WHERE \{projCol\}=@n AND is_active=1/.test(rc), 'refCount가 활성 과제만 세지 않는다');
});
test('호스트: UpsertProjectAsync — note 파라미터 + 코드테이블 로드 검증(하드코딩 아님)', () => {
  const up = projectDb.slice(projectDb.indexOf('public async Task<(bool ok, string msg, bool needConfirm)> UpsertProjectAsync'),
                             projectDb.indexOf('private static async Task<(string pn, string cn)?> FindSimilarActiveAsync'));
  assert.ok(/string\? note = null, bool confirmSimilar = false/.test(up), 'note 파라미터가 없다');
  assert.ok(/string nt = \(note \?\? ""\)\.Trim\(\);/.test(up), 'note TRIM이 없다');
  // 코드 존재 검증을 코드테이블 로드로(하드코딩 배열 IndexOf 아님)
  assert.ok(/LoadCodeNameSetAsync\(conn, cts\.Token, "section_code", activeOnly: false\)/.test(up), 'section 검증이 코드테이블 로드가 아니다');
  assert.ok(/LoadCodeNameSetAsync\(conn, cts\.Token, "status_code", activeOnly: false\)/.test(up), 'status 검증이 코드테이블 로드가 아니다');
  assert.ok(!/Array\.IndexOf\(Sections|Array\.IndexOf\(Statuses/.test(projectDb), '하드코딩 배열 검증이 남아 있다');
});
test('호스트: INSERT/UPDATE/SELECT에 note 반영', () => {
  assert.ok(/INSERT INTO project \(section, customer, project_name, contract_name, common_name, [\s\S]{0,80}status, note\)/.test(projectDb), 'INSERT에 note가 없다');
  assert.ok(/status=@st, note=@note WHERE uid=@uid/.test(projectDb), 'UPDATE에 note가 없다');
  assert.ok(/status, note, is_active FROM project WHERE is_active=1/.test(projectDb), 'SELECT에 note가 없다');
  assert.ok(/AddWithValue\("@note", nt\)/.test(projectDb), 'note 바인딩이 없다');
});
test('호스트: MySqlMsg가 FK 3종을 제약명으로 구분', () => {
  const m = projectDb.slice(projectDb.indexOf('private static string MySqlMsg'), projectDb.indexOf('private static string NormalizeName'));
  assert.ok(/fk_project_section/.test(m) && /등록되지 않은 구분입니다/.test(m), 'section FK 안내가 없다');
  assert.ok(/fk_project_status/.test(m) && /등록되지 않은 상태입니다/.test(m), 'status FK 안내가 없다');
  assert.ok(/등록되지 않은 발주처입니다/.test(m), '발주처 FK 안내가 사라졌다');
});

// ── 브리지 MainWindow ───────────────────────────────────────────────────
test('브리지: 코드 cmd 7종 + saveProject가 note 전달', () => {
  for (const c of ['loadCodes', 'getCodesFull', 'codeAdd', 'codeRename', 'codeSetActive', 'codeReorder', 'codeRefCount']) {
    assert.ok(new RegExp('case "' + c + '":').test(mainWindow), `case "${c}"가 없다`);
  }
  assert.ok(/GetStr\(doc, "note"\), GetBool\(doc, "confirm"\)/.test(mainWindow), 'saveProject가 note를 읽지 않는다');
  assert.ok(/note: note/.test(mainWindow), 'note를 UpsertProjectAsync로 전달하지 않는다');
});
test('브리지: __applyCodes로 sections/statuses 2배열 전달 · 코드 Run*는 ReplyOnUi', () => {
  assert.ok(/LoadSectionCodesJsonAsync\(\)[\s\S]{0,200}LoadStatusCodesJsonAsync\(\)[\s\S]{0,200}window\.__applyCodes/.test(mainWindow),
    'LoadCodesToWebAsync가 두 코드목록을 __applyCodes로 넘기지 않는다');
  for (const m of ['RunAddCodeAsync', 'RunRenameCodeAsync', 'RunSetCodeActiveAsync', 'RunReorderCodesAsync', 'RunCodeRefCountAsync', 'RunLoadCodesFullAsync']) {
    const b = mainWindow.slice(mainWindow.indexOf('private async Task ' + m), mainWindow.indexOf('private async Task ' + m) + 400);
    assert.ok(/ReplyOnUi\(reqId,/.test(b), `${m}가 ReplyOnUi로 회신하지 않는다`);
  }
  // codeReorder는 문자열 배열(names) 수신
  assert.ok(/GetStrArray\(doc, "names"\)/.test(mainWindow), 'codeReorder가 names 배열을 읽지 않는다');
});

// ── 웹: 드롭다운 DB 로드 · __applyCodes · 코드 관리 · note · 인라인 제거 ──
test('웹: OFF_SECTIONS/OFF_STATUSES 상수 제거 → offSections/offStatuses 동적', () => {
  assert.ok(!/OFF_SECTIONS|OFF_STATUSES/.test(src), '하드코딩 구분/상태 상수가 남아 있다');
  assert.ok(/let offSections = \[\];/.test(src) && /let offStatuses = \[\];/.test(src), '동적 코드목록 변수가 없다');
});
test('웹: __applyCodes가 두 배열을 파싱해 offSections/offStatuses 채움', () => {
  const b = src.slice(src.indexOf('window.__applyCodes = function'), src.indexOf('window.__applyCodes = function') + 900);
  assert.ok(/offSections = parse\(sectionsJson/.test(b) && /offStatuses = parse\(statusesJson/.test(b), '코드목록 파싱이 없다');
  // 부팅·모달 열 때 loadCodes
  assert.ok(/hpost\(\{ cmd:'loadCodes' \}\)/.test(src) || /hpost\(\{ cmd: 'loadCodes' \}\)/.test(src), '부팅/모달에서 loadCodes 호출이 없다');
});
test('웹: 코드 관리 codeSend — 성공 시 loadCodes, 개명은 loadProjects까지', () => {
  const b = extractFunction(src, 'codeSend');
  assert.ok(/hostRequest\(cmd, Object\.assign\(\{ kind: codeKind \}/.test(b), 'codeSend가 kind를 함께 보내지 않는다');
  assert.ok(/hpost\(\{ cmd: 'loadCodes' \}\)/.test(b), '성공 후 드롭다운 갱신(loadCodes)이 없다');
  assert.ok(/cmd === 'codeRename'[\s\S]{0,60}loadProjects/.test(b), '개명 후 과제 표기 갱신(loadProjects)이 없다');
});
test('웹: 코드 관리 조작은 offEditGuard 게이트', () => {
  for (const fn of ['codeDoAdd', 'codeDoHide', 'codeDoShow', 'codeBeginRename', 'codeMove']) {
    assert.ok(/offEditGuard\(/.test(extractFunction(src, fn)), `${fn}가 offEditGuard를 거치지 않는다`);
  }
});
test('웹: codeMove가 활성 순서 스왑 후 codeReorder(names) 전송', () => {
  const b = extractFunction(src, 'codeMove');
  assert.ok(/codeList\.filter\(c => c\.active\)\.map\(c => c\.name\)/.test(b), '활성 순서 배열을 만들지 않는다');
  assert.ok(/codeSend\('codeReorder', \{ names: active \}/.test(b), 'codeReorder(names) 전송이 없다');
});
test('웹: note — payload·mapDbRows·offEditOpen 반영, 편입분엔 안 넘어감(전시 미노출)', () => {
  const save = extractFunction(src, 'offEdSaveNow');
  assert.ok(/note: \(document\.getElementById\('offEdNote'\)/.test(save), 'saveProject payload에 note가 없다');
  const map = extractFunction(src, 'mapDbRows');
  assert.ok(/note:String\(r\.note \|\| ''\)/.test(map), 'mapDbRows에 note 매핑이 없다');
  assert.ok(/set\('offEdNote', c \? c\.note : ''\)/.test(src), 'offEditOpen이 note를 세팅하지 않는다');
  // 편입분(subscribeDbCat)엔 note 없음 — 라벨 최소 메타(name/color)만
  const sub = extractFunction(src, 'subscribeDbCat');
  assert.ok(!/note/.test(sub), '편입분에 note가 새어 든다(전시로 유출 위험)');
});
