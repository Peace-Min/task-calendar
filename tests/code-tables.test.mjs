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

// ══ 범위 고정 도구 ═════════════════════════════════════════════════════
// ★ 2026-09-04 변이감사(P5)로 드러난 구멍: 이 파일의 여러 단언이 **파일 전체**에 대한
//   존재검사였다. 같은 문자열이 여러 곳에 있으면 한 곳이 망가져도 나머지가 단언을
//   만족시켜 게이트가 초록으로 남는다. 실측(896 pass / 0 fail / exit 0 = 전부 조용히 통과):
//     · 부팅(11742)의 hpost({ cmd:'loadCodes' }) 만 지움
//     · 모달 프리로드(6918)의 loadCodes 만 지움
//     · 부팅+모달 **둘 다** 지우고 codeSend 후 갱신만 남김
//       ↑ 이 제품은 코드 CRUD 를 한 번이라도 하기 전까지 구분·상태 드롭다운이 세션 내내 빈 채다.
//     · 부팅의 hpost({ cmd:'loadProjects' }) 를 지움(공식 과제 조회 자체가 사라짐)
//   그래서 아래 검사들은 **경로별로 범위를 잘라** 본다. 존재검사는 '어딘가 남아 있는가'를
//   재지 '그 경로가 하는가'를 재지 못한다.

// 변이 주입 도우미 — 대상 문자열이 없으면 변이 자체가 무효이므로 그 자리에서 실패시킨다.
function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

// 주석 제거 — 계약이 보는 것은 **호출**이지 글자가 아니다(설명 주석에 hpost({cmd:'loadCodes'})
// 라고 적어 두면 존재검사가 그걸로 만족해 버린다). 줄끝 \r 대비로 \r*\n 으로 쪼갠다.
function stripJsComments(text) {
  const t = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return t.split(/\r*\n/).map((l) => l.replace(/(^|\s)\/\/[^\r\n]*$/, '')).join('\n');
}

// C# 소스에서 [시작 선언, 다음 선언) 구간만 잘라낸다. 두 마커가 다 있고 순서가 맞아야 한다
// (마커가 사라진 채 빈 슬라이스로 통과하는 오탐을 막는다).
function csSlice(source, startMarker, endMarker) {
  const i = source.indexOf(startMarker);
  assert.ok(i >= 0, `범위 시작 마커를 찾지 못했다: ${startMarker}`);
  const j = source.indexOf(endMarker, i + startMarker.length);
  assert.ok(j > i, `범위 끝 마커를 찾지 못했다(또는 순서가 뒤집혔다): ${endMarker}`);
  return source.slice(i, j);
}

// 웹 부팅 경로 — 최상위 `if(HOST){ // 데스크톱 위젯 모드 … }` 블록. **함수가 아니라서**
// extractFunction 으로는 잡히지 않는다(이 소스에 bootstrap 이라는 함수는 없다).
// 바로 뒤에 오는 `function hpost(o){` 선언을 끝으로 삼는다.
const BOOT_HEAD = 'if(HOST){ // 데스크톱 위젯 모드';
const BOOT_TAIL = 'function hpost(o){';
function bootBlock(source) {
  const i = source.indexOf(BOOT_HEAD);
  assert.ok(i >= 0, `부팅 블록(${BOOT_HEAD})을 찾지 못했다 — 부팅 경로 계약이 통째로 무력화된다`);
  const j = source.indexOf(BOOT_TAIL, i);
  assert.ok(j > i, `부팅 블록의 끝(${BOOT_TAIL})을 찾지 못했다`);
  return stripJsComments(source.slice(i, j));
}

// hpost({ cmd:'loadCodes' }) — 공백 유무 두 표기(부팅은 cmd:'…', 나머지는 cmd: '…')를 모두 받는다.
const HPOST_CODES = /hpost\(\s*\{\s*cmd:\s*'loadCodes'\s*\}\s*\)/;
const HPOST_CODES_G = /hpost\(\s*\{\s*cmd:\s*'loadCodes'\s*\}\s*\)/g;
const HPOST_PROJECTS = /hpost\(\s*\{\s*cmd:\s*'loadProjects'\s*\}\s*\)/;

// ── 검사 함수(테스트 + 변이 주입이 같은 함수를 쓴다) ────────────────────
const checks = {
  // 부팅 경로가 카탈로그 소스를 **직접** 싣는가. 모달 프리로드로 대체되지 않는다 —
  // 모달을 열기 전까지 offSections/offStatuses 가 []라 그룹 정렬(rank)이 전부 '미발견'이 된다.
  bootLoadsCatalog(source) {
    const boot = bootBlock(source);
    assert.ok(HPOST_CODES.test(boot),
      '부팅에서 loadCodes 를 부르지 않는다(드롭다운·그룹정렬 소스가 빈 채로 시작한다)');
    assert.ok(HPOST_PROJECTS.test(boot),
      '부팅에서 loadProjects 를 부르지 않는다(공식 과제 목록 조회 자체가 사라진다)');
  },
  // 모달 프리로드 — 부팅 뒤 DB 에서 코드가 바뀌었을 수 있으므로 열 때 한 번 더 싣는다.
  modalPreloadsCodes(source) {
    const b = stripJsComments(extractFunction(source, 'openOfficialModal'));
    assert.ok(HPOST_CODES.test(b), '공식과제 모달 프리로드에 loadCodes 가 없다(모달이 낡은 코드목록으로 그려진다)');
    assert.ok(/hpost\(\s*\{\s*cmd:\s*'loadCustomers'\s*\}\s*\)/.test(b), '공식과제 모달 프리로드에 loadCustomers 가 없다');
  },
  // 코드 CRUD 성공 후 갱신 — 세 번째 경로.
  codeSendReloadsCodes(source) {
    const b = stripJsComments(extractFunction(source, 'codeSend'));
    assert.ok(HPOST_CODES.test(b), 'codeSend 성공 후 드롭다운 갱신(loadCodes)이 없다');
  },
  // 호출부는 정확히 세 곳이다. 넷째가 생기면 '한 곳이 망가져도 다른 곳이 만족시키는' 구멍이
  // 다시 열리므로, 그때는 그 경로에 대한 범위고정 단언도 위에 함께 늘려야 한다.
  loadCodesCallSites(source) {
    const n = (stripJsComments(source).match(HPOST_CODES_G) || []).length;
    assert.strictEqual(n, 3,
      `loadCodes 호출부가 3곳(부팅·모달 프리로드·codeSend 후)이 아니다(실측 ${n}곳)`);
  },
  // 활성 코드 로더(드롭다운 소스)는 sort_order 순 — 로더 **구간 안에서** 확인한다.
  activeLoaderSorted(pdb) {
    const b = csSlice(pdb, 'private async Task<string?> LoadActiveCodeNamesJsonAsync',
                           'public async Task<string?> LoadCodesFullJsonAsync');
    assert.ok(/WHERE is_active=1 ORDER BY sort_order, name/.test(b), '활성 코드 로더가 sort_order 순이 아니다');
  },
  // full 로더(관리 화면)는 활성 먼저 · 그 안에서 sort_order.
  fullLoaderSorted(pdb) {
    const b = csSlice(pdb, 'public async Task<string?> LoadCodesFullJsonAsync',
                           'private static async Task<HashSet<string>> LoadCodeNameSetAsync');
    assert.ok(/ORDER BY is_active DESC, sort_order, name/.test(b), 'full 로더 정렬이 다르다');
  },
  // note 는 쓰기(UpsertProjectAsync)·바인딩(BindProject)·읽기(LoadProjectsJsonAsync) 세 구간에
  // 각각 있어야 한다. 한 구간에서 빠져도 다른 구간의 같은 문자열이 존재검사를 만족시키면 안 된다.
  noteWiredPerScope(pdb) {
    const up = csSlice(pdb, 'public async Task<(bool ok, string msg, bool needConfirm)> UpsertProjectAsync',
                            'private static async Task<(string pn, string cn)?> FindSimilarActiveAsync');
    assert.ok(/INSERT INTO project \(section, customer, project_name, contract_name, common_name, [\s\S]{0,80}status, note\)/.test(up),
      'UpsertProjectAsync 의 INSERT 에 note 가 없다');
    assert.ok(/status=@st, note=@note WHERE uid=@uid/.test(up), 'UpsertProjectAsync 의 UPDATE 에 note 가 없다');
    const bind = csSlice(pdb, 'private static void BindProject',
                              'public async Task<(bool ok, string msg)> SetProjectActiveAsync');
    assert.ok(/AddWithValue\("@note", nt\)/.test(bind),
      'BindProject 에 note 바인딩이 없다(INSERT/UPDATE 둘 다 @note 미바인딩으로 터진다)');
    const sel = csSlice(pdb, 'public async Task<string?> LoadProjectsJsonAsync',
                             'public async Task<string?> LoadCustomersJsonAsync');
    assert.ok(/status, note, is_active FROM project WHERE is_active=1/.test(sel),
      'LoadProjectsJsonAsync 의 SELECT 에 note 가 없다(저장은 되는데 다시 읽히지 않는다)');
  },
};

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
  // ★ 위 두 줄은 파일 전체 존재검사다 — 같은 SQL 을 쓰는 로더가 하나 더 생기면 진짜 로더가
  //   망가져도 통과한다(P5 와 같은 형태). 그래서 로더 구간 안에서 한 번 더 못박는다.
  checks.activeLoaderSorted(projectDb);
  checks.fullLoaderSorted(projectDb);
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
  // ★ 위 네 줄도 파일 전체 존재검사다 — 쓰기·바인딩·읽기 세 구간으로 잘라 각각 못박는다.
  checks.noteWiredPerScope(projectDb);
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

// ══ 카탈로그 소스 적재 — 경로별 범위 고정 ══════════════════════════════
// 위 '__applyCodes' 테스트의 마지막 줄은 src 전체 OR 존재검사라 세 호출부 중 둘이 사라져도
// 통과한다(감사 실측). 아래 셋은 **각 경로 안에서** 본다 — 한 경로가 사라지면 그 경로의 검사만 운다.

test('웹: 부팅 경로가 loadCodes·loadProjects 를 부른다(모달 프리로드로 대체 불가)', () => {
  checks.bootLoadsCatalog(src);
});

test('웹: 공식과제 모달 프리로드가 loadCodes·loadCustomers 를 부른다', () => {
  checks.modalPreloadsCodes(src);
});

test('웹: loadCodes 호출부는 정확히 3곳(부팅·모달 프리로드·codeSend 후)', () => {
  checks.loadCodesCallSites(src);
});

// ══ 변이 주입(검사가 실효성이 있는지 증명) ═════════════════════════════
// 각 변이는 감사에서 **실제로 조용히 통과했던** 파손이다. 검사가 안 잡으면 그 검사는 장식이다.

test('변이⑲: 부팅의 loadCodes 를 지우면 부팅 경로 검사가 실패한다(모달 프리로드가 남아 있어도)', () => {
  const bad = mutate("  hpost({ cmd:'loadCodes' });", '  ;', src);
  // 대조군 — 옛 판(파일 전체 OR 존재검사)은 이 상태를 여전히 통과시킨다. 그게 P5 의 구멍이었다.
  assert.ok(/hpost\(\{ cmd:'loadCodes' \}\)/.test(bad) || /hpost\(\{ cmd: 'loadCodes' \}\)/.test(bad),
    '변이 전제가 깨졌다 — 남은 호출부가 없어서 옛 존재검사도 잡아 버린다(이 변이는 무의미)');
  assert.throws(() => checks.bootLoadsCatalog(bad), /부팅에서 loadCodes 를 부르지 않는다/);
  assert.throws(() => checks.loadCodesCallSites(bad), /loadCodes 호출부가 3곳[\s\S]*아니다/);
});

test('변이⑳: 부팅의 loadProjects 를 지우면 부팅 경로 검사가 실패한다', () => {
  const bad = mutate("  hpost({ cmd:'loadProjects' });", '  ;', src);
  assert.throws(() => checks.bootLoadsCatalog(bad), /부팅에서 loadProjects 를 부르지 않는다/);
});

test('변이㉑: 모달 프리로드의 loadCodes 를 지우면 프리로드 검사가 실패한다', () => {
  const bad = mutate("if(HOST){ hpost({ cmd: 'loadCustomers' }); hpost({ cmd: 'loadCodes' }); }",
                     "if(HOST){ hpost({ cmd: 'loadCustomers' }); }", src);
  assert.ok(/hpost\(\{ cmd: 'loadCodes' \}\)/.test(bad), '변이 전제가 깨졌다(남은 호출부 없음)');
  assert.throws(() => checks.modalPreloadsCodes(bad), /모달 프리로드에 loadCodes 가 없다/);
  assert.throws(() => checks.loadCodesCallSites(bad), /loadCodes 호출부가 3곳[\s\S]*아니다/);
});

test('변이㉒: 부팅+모달을 동시에 지우고 codeSend 후 갱신만 남겨도 잡힌다(감사에서 가장 센 파손)', () => {
  // 이 제품은 코드 CRUD 를 한 번이라도 하기 전까지 구분·상태 드롭다운이 세션 내내 빈 채다.
  // 그런데 남은 1곳이 옛 존재검사와 codeSend 범위검사를 동시에 만족시켜 게이트가 초록이었다.
  let bad = mutate("  hpost({ cmd:'loadCodes' });", '  ;', src);
  bad = mutate("if(HOST){ hpost({ cmd: 'loadCustomers' }); hpost({ cmd: 'loadCodes' }); }",
               "if(HOST){ hpost({ cmd: 'loadCustomers' }); }", bad);
  // 대조군 — 옛 판은 여전히 통과한다(codeSend 안의 1곳이 남아 있으므로).
  assert.ok(/hpost\(\{ cmd: 'loadCodes' \}\)/.test(bad), '변이 전제가 깨졌다');
  checks.codeSendReloadsCodes(bad);   // 남은 경로는 멀쩡 — 그래서 옛 검사가 조용했다
  assert.throws(() => checks.bootLoadsCatalog(bad), /부팅에서 loadCodes 를 부르지 않는다/);
  assert.throws(() => checks.modalPreloadsCodes(bad), /모달 프리로드에 loadCodes 가 없다/);
  assert.throws(() => checks.loadCodesCallSites(bad), /실측 1곳/);
});

test('변이㉓: codeSend 성공 후 갱신을 지우면 codeSend 범위검사가 실패한다', () => {
  // 줄머리 개행+4칸 들여쓰기로 codeSend 안의 그 줄만 겨냥한다(모달 프리로드는 한 줄에 붙어 있다).
  const bad = mutate("\n    hpost({ cmd: 'loadCodes' });", '\n    ;', src);
  assert.throws(() => checks.codeSendReloadsCodes(bad), /codeSend 성공 후 드롭다운 갱신/);
});

test('변이㉔: 주석에만 남은 호출은 호출로 세지 않는다(존재검사 우회 차단)', () => {
  // 코드를 지우고 설명 주석으로만 남기는 흔한 리팩터. 문자열은 파일에 남지만 실행되지 않는다.
  const bad = mutate("  hpost({ cmd:'loadCodes' });",
                     "  // 부팅에서는 hpost({ cmd:'loadCodes' }) 를 부르지 않는다(모달에서 싣는다)", src);
  assert.throws(() => checks.bootLoadsCatalog(bad), /부팅에서 loadCodes 를 부르지 않는다/);
  assert.throws(() => checks.loadCodesCallSites(bad), /loadCodes 호출부가 3곳[\s\S]*아니다/);
});

test('변이㉕: 부팅 블록 자체가 사라지면 조용히 통과하지 않는다(빈 슬라이스 방어)', () => {
  const bad = mutate(BOOT_HEAD, 'if(HOST){ // (블록 표식 제거)', src);
  assert.throws(() => checks.bootLoadsCatalog(bad), /부팅 블록.*찾지 못했다/);
});

test('변이㉖: 활성 코드 로더의 정렬이 사라져도 같은 SQL 이 다른 로더에 있으면 옛 존재검사는 통과한다(범위고정이 잡는다)', () => {
  // '필터 전용 활성 코드 로더가 하나 더 생긴' 상황을 모사 — 감사가 지적한 구조적 약점.
  let bad = mutate('$"SELECT name FROM {table} WHERE is_active=1 ORDER BY sort_order, name"',
                   '$"SELECT name FROM {table} WHERE is_active=1"', projectDb);
  bad = mutate('private static bool IsDateOrEmpty(string? s)',
    'private async Task<string?> LoadFilterCodeNamesJsonAsync(string table)\n' +
    '        {\n            var q = $"SELECT name FROM {table} WHERE is_active=1 ORDER BY sort_order, name";\n' +
    '            return await Task.FromResult<string?>(q);\n        }\n\n' +
    '        private static bool IsDateOrEmpty(string? s)', bad);
  // 대조군 — 옛 판(파일 전체 존재검사)은 통과한다.
  assert.ok(/WHERE is_active=1 ORDER BY sort_order, name/.test(bad), '변이 전제가 깨졌다(대조 문자열이 안 남았다)');
  assert.throws(() => checks.activeLoaderSorted(bad), /활성 코드 로더가 sort_order 순이 아니다/);
});

test('변이㉗: 읽기 SELECT 에서 note 만 빠져도 잡힌다(쓰기 쪽 note 가 존재검사를 만족시켜도)', () => {
  const bad = mutate('"status, note, is_active FROM project WHERE is_active=1 ORDER BY common_name"',
                     '"status, is_active FROM project WHERE is_active=1 ORDER BY common_name"', projectDb);
  assert.throws(() => checks.noteWiredPerScope(bad), /LoadProjectsJsonAsync 의 SELECT 에 note 가 없다/);
});

test('변이㉘: BindProject 의 note 바인딩을 지우면 잡힌다(INSERT/UPDATE 문구가 남아 있어도)', () => {
  const bad = mutate('cmd.Parameters.AddWithValue("@note", nt);', '', projectDb);
  assert.throws(() => checks.noteWiredPerScope(bad), /BindProject 에 note 바인딩이 없다/);
});
