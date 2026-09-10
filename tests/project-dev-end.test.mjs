// 개발종료일(project.dev_end_date) 게이트 (2026-09-10 신설)
//
// 이 파일이 존재하는 이유:
//   개발종료일 하나가 **여섯 자리**에 동시에 살아야 한다 — 정본 SQL 2개 · 마이그레이션 ·
//   호스트 질의(SELECT/INSERT/UPDATE) · 호스트 장표 열 · 화면(폼·payload·상세).
//   한 자리라도 빠지면 증상이 조용하다: 폼에 칸은 있는데 UPDATE 가 그 컬럼을 안 적으면
//   사용자는 저장했다고 믿고 값은 사라진다(무음 유실). 사람의 기억에 맡기지 않는다.
//
//   ★ 그리고 이 게이트는 **설계 결정 하나를 계약으로 붙잡는다** —
//     dev_end_date 는 **선진행 잠금 규칙에 들어가지 않는다.** 선진행은 '계약 전'일 뿐이고
//     개발은 이미 돌고 있어, 그 구간에서 유일하게 의미 있는 날짜가 개발종료일이기 때문이다.
//     이 결정은 화면(offEdApplySectionRule)과 호스트(ProjectDb 의 선진행 분기) 양쪽에 걸쳐 있어
//     "정리한다"며 계약시작·계약종료 옆에 끼워 넣기 딱 좋은 모양이다. 그러면 조용히 값이 지워진다.
//     그래서 '없어야 한다'를 시험이 지킨다('있어야 한다'만 지키면 반쪽이다).
//
//   판정 불가 ≠ 통과 — 기준 파일을 못 읽으면 그 사실 자체가 실패다(계약⓪).
import { readFileSync } from 'node:fs';
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';
import { stripSqlComments, canonSchemaVersion } from './canon-schema.mjs';

const COL = 'dev_end_date';        // DB 컬럼명
const JSKEY = 'devEndDate';        // 화면·호스트가 주고받는 키
const FORM_ID = 'offEdDevEnd';     // 편집 폼 입력칸 id
const MIGRATE = 'migrate-2026-09-10-dev-end-date.sql';

// ── 기준 파일 로드 — 최상위에서 던지지 않는다(run-tests 의 import 루프에서 던지면 프로세스가 죽어
//    **전 스위트 판정이 증발**한다. commit-merge.test.mjs 가 그 사고로 남긴 관례다). ──
const missing = [];
function readOr(url, label) {
  try {
    const s = readFileSync(url, 'utf8');
    if (!s) { missing.push(label + '(빈 파일)'); return ''; }
    return s;
  } catch { missing.push(label); return ''; }
}
const R = (rel) => new URL('../' + rel, import.meta.url);
const canonFiles = [
  ['db/schema.sql', readOr(R('db/schema.sql'), 'db/schema.sql')],
  ['db/deploy/schema-structure.sql', readOr(R('db/deploy/schema-structure.sql'), 'db/deploy/schema-structure.sql')],
];
const projectDb = readOr(R('widget/ProjectDb.cs'), 'widget/ProjectDb.cs');
const mainWin = readOr(R('widget/MainWindow.xaml.cs'), 'widget/MainWindow.xaml.cs');
const migrateSql = readOr(R('db/deploy/' + MIGRATE), 'db/deploy/' + MIGRATE);
let app = '';
try { app = loadAppSource(); } catch { missing.push('task-calendar-prototype.html'); }

// ── 주석 제거(JS/C#) ────────────────────────────────────────────────
//  ★ 줄을 \r*\n 으로 자른다 — MainWindow.xaml.cs 의 줄끝은 \r\r\n(CR 중복)이다.
//    \r?\n 으로 자르면 줄 끝에 \r 가 남아 줄 주석 정규식이 거기서 멈춘다(xml-retirement 의 교훈).
//  ★ 주석을 지우는 이유가 이 파일에선 특히 크다 — 아래 계약④ 는 "잠금 배열에 FORM_ID 가 **없다**"를
//    확인하는데, 그 결정의 근거를 적은 주석에 그 이름이 그대로 들어 있다. 안 지우면 영원히 거짓 실패다.
function stripCode(text) {
  const t = String(text).replace(/\/\*[\s\S]*?\*\//g, ' ');
  return t.split(/\r*\n/).map((l) => l.replace(/(^|\s)\/\/[^\r\n]*$/, '')).join('\n');
}

// ── 정본 SQL 에서 project 표의 컬럼 순서를 읽는다 ──────────────────
//  존재만 보지 않고 **순서**를 보는 이유: 정본 두 파일과 마이그레이션이 같은 구조에 도달해야
//  mysqldump --no-data 대조가 성립한다. 순서가 갈리면 "새로 세운 DB" 와 "마이그레이션으로 온 DB"가
//  diff 에서 갈라진다 — 그것이 이 저장소가 2026-09-09 에 한 번 겪은 드리프트 사고의 모양이다.
export function projectColumns(sql) {
  const m = /CREATE TABLE\s+`?project`?\s*\(([\s\S]*?)\n\)\s*ENGINE/i.exec(String(sql));
  if (!m) return null;
  const body = stripSqlComments(m[1]);
  const cols = [];
  for (const raw of body.split('\n')) {
    const t = raw.trim();
    //  **소문자로 시작하는 줄만** 컬럼으로 본다 — PRIMARY/UNIQUE/KEY/CONSTRAINT 는 전부 대문자라
    //  이 한 줄이 키·제약 절을 자연스럽게 걸러 낸다(제외 목록을 따로 적어 두면 그 목록이 낡는다).
    const c = /^`?([a-z_][a-z0-9_]*)`?\s+[A-Za-z]/.exec(t);
    if (!c) continue;
    cols.push({ name: c[1], def: t.replace(/,\s*$/, '') });
  }
  return cols;
}

// ── C# 문장의 SQL 리터럴을 이어 붙여 돌려준다 ──────────────────────
//  문자열 검색("소스 어딘가에 dev_end_date 가 있다")으로는 계약②를 판정할 수 없다 —
//  SELECT 에만 있고 UPDATE 에 없어도 통과해 버린다. 그래서 **문장 단위로 잘라** 본다.
//  (리터럴 안에 ; 가 없다는 사실에 기댄다 — 이 세 문장 모두 그렇다.)
export function csSqlLiteral(cs, head) {
  const src = String(cs);
  const i = src.indexOf('"' + head);
  if (i < 0) return null;
  const end = src.indexOf(';', i);
  if (end < 0) return null;
  const region = src.slice(i, end);
  const parts = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(region)) !== null) parts.push(m[1]);
  return parts.length ? parts.join('') : null;
}

// ── C# switch 의 한 case 블록 ──────────────────────────────────────
export function csCaseBlock(cs, caseName) {
  const src = String(cs);
  const i = src.indexOf('case "' + caseName + '":');
  if (i < 0) return null;
  const end = src.indexOf('break;', i);
  return end < 0 ? null : src.slice(i, end);
}

// ── 화면: offEdApplySectionRule 의 '잠금 배열' 안에 든 id 목록 ─────
export function lockedFieldIds(appSrc) {
  let fn;
  try { fn = extractFunction(appSrc, 'offEdApplySectionRule'); } catch { return null; }
  const m = /\[([^\]]*)\]\s*\.forEach\s*\(/.exec(stripCode(fn));
  if (!m) return null;
  const ids = [];
  const lit = /'([^']*)'/g;
  let x;
  while ((x = lit.exec(m[1])) !== null) ids.push(x[1]);
  return ids;
}

// ══ 계약 ═══════════════════════════════════════════════════════════
//  검사 함수를 시험과 변이 주입이 공유한다 — 검사가 실제로 잡는지 증명하기 위해서다
//  (이 저장소의 관례. schema-guards · schema-integrity · xml-retirement 와 같은 꼴).
export const checks = {
  //  ① 정본 두 파일이 같은 자리에 같은 모양으로 컬럼을 갖는다
  canonHasColumn(label, sql) {
    const cols = projectColumns(sql);
    assert.ok(cols && cols.length > 0,
      label + ' 에서 project 표의 컬럼을 하나도 읽지 못했다 — CREATE TABLE 형태가 바뀌었다면 ' +
      'projectColumns 를 함께 고칠 것. 못 읽으면 통과가 아니라 측정 실패다');
    const names = cols.map((c) => c.name);
    const iEnd = names.indexOf('end_date');
    const iDev = names.indexOf(COL);
    assert.notStrictEqual(iEnd, -1, label + ' 에 end_date 가 없다 — 기준 컬럼이 사라졌다');
    assert.notStrictEqual(iDev, -1,
      label + ' 에 ' + COL + ' 이 없다 — 개발종료일은 계약종료일과 별개의 날짜다. 정본에 없으면 ' +
      '새로 세운 DB 에만 컬럼이 빠지고, 그 DB 를 보는 위젯 질의가 1054 로 죽어 과제 목록이 통째로 빈다');
    assert.strictEqual(iDev, iEnd + 1,
      label + ': ' + COL + ' 이 end_date 바로 뒤가 아니다(end_date=' + iEnd + ', ' + COL + '=' + iDev + '). ' +
      '컬럼 순서까지 같아야 마이그레이션 결과와 신규 구축 결과가 mysqldump 대조에서 일치한다');
    assert.ok(/^dev_end_date\s+DATE\s+NULL$/i.test(cols[iDev].def),
      label + ': ' + COL + ' 의 정의가 `DATE NULL` 이 아니다 — 실제: ' + cols[iDev].def);
  },

  //  ② 호스트의 세 SQL 이 **전부** 그 컬럼을 담는다(하나라도 빠지면 무음 유실)
  hostSqlCarriesColumn(cs) {
    const sel = csSqlLiteral(cs, 'SELECT uid,');
    const ins = csSqlLiteral(cs, 'INSERT INTO project (');
    const upd = csSqlLiteral(cs, 'UPDATE project SET ');
    assert.ok(sel && ins && upd,
      'ProjectDb.cs 에서 SELECT/INSERT/UPDATE 세 문장을 다 찾지 못했다(sel=' + !!sel + ' ins=' + !!ins +
      ' upd=' + !!upd + ') — 문장 형태가 바뀌었다면 csSqlLiteral 의 머리말을 함께 고칠 것');
    assert.ok(sel.includes(COL),
      'SELECT 가 ' + COL + ' 을 읽지 않는다 — 상세 패널·편집 폼·Excel 이 영원히 빈 값을 본다');
    assert.ok(ins.includes(COL) && /@ded\b/.test(ins),
      'INSERT 의 컬럼 목록 또는 VALUES 에 ' + COL + '/@ded 가 없다 — 새 과제의 개발종료일이 조용히 버려진다. 실제: ' + ins);
    assert.ok(/dev_end_date\s*=\s*@ded/.test(upd),
      'UPDATE 가 ' + COL + ' 을 갱신하지 않는다 — 폼에 칸은 있는데 저장만 안 되는, 가장 조용한 실패다. 실제: ' + upd);
  },

  //  ③ 호스트가 화면의 값을 받아 장표 열까지 잇는다
  hostWiring(cs) {
    const blk = csCaseBlock(cs, 'saveProject');
    assert.ok(blk, 'MainWindow 에서 case "saveProject" 블록을 찾지 못했다 — 배선 게이트가 기준을 잃었다');
    assert.ok(new RegExp('GetStr\\s*\\(\\s*doc\\s*,\\s*"' + JSKEY + '"\\s*\\)').test(blk),
      'saveProject 분기가 ' + JSKEY + ' 를 읽지 않는다 — 화면이 보낸 값이 호스트에서 증발한다');
    const cols = /ProjectExportCols\s*=\s*\{([\s\S]*?)\n\s*\};/.exec(String(cs));
    assert.ok(cols, 'ProjectExportCols 배열을 찾지 못했다 — 장표 열 정의의 단일 소스가 사라졌다');
    assert.ok(new RegExp('"' + JSKEY + '"').test(cols[1]),
      'ProjectExportCols 에 개발종료일 열이 없다 — 화면엔 보이는데 Excel 장표에만 빠진다');
  },

  //  ④ 화면: 폼·payload 에는 있고, **선진행 잠금 배열에는 없다**(설계 결정)
  appWiring(appSrc) {
    const code = stripCode(appSrc);
    assert.ok(new RegExp('id="' + FORM_ID + '"').test(code),
      '편집 폼에 #' + FORM_ID + ' 입력칸이 없다 — 관리자가 값을 넣을 자리가 없다');
    let save = null;
    try { save = stripCode(extractFunction(appSrc, 'offEdSaveNow')); } catch { save = null; }
    assert.ok(save, 'offEdSaveNow 를 찾지 못했다 — payload 빌더가 개명됐다면 이 게이트도 함께 고칠 것');
    assert.ok(new RegExp('\\b' + JSKEY + '\\s*:').test(save),
      'payload 에 ' + JSKEY + ' 가 없다 — 폼에 값을 넣어도 호스트로 가지 않는다');
    assert.ok(save.includes(FORM_ID),
      'payload 가 #' + FORM_ID + ' 를 읽지 않는다 — 다른 칸의 값을 보내고 있다');

    const locked = lockedFieldIds(appSrc);
    assert.ok(Array.isArray(locked) && locked.length > 0,
      'offEdApplySectionRule 의 잠금 배열을 읽지 못했다 — 형태가 바뀌었다면 lockedFieldIds 를 고칠 것. ' +
      '못 읽으면 "없다"를 증명할 수 없으니 통과가 아니다');
    assert.ok(locked.includes('offEdStart') && locked.includes('offEdEnd'),
      '잠금 배열에서 계약 날짜가 빠졌다 — 선진행 규칙 자체가 무너졌다. 실제: ' + locked.join(', '));
    assert.ok(!locked.includes(FORM_ID),
      '선진행 잠금 배열에 ' + FORM_ID + ' 가 들어갔다 — 선진행은 계약 전일 뿐 개발은 이미 돈다. ' +
      '이 칸을 잠그면 그 구간에서 유일하게 의미 있는 날짜를 못 적고, 잠금이 값까지 비우므로 ' +
      '기존 값이 조용히 지워진다(2026-09-10 설계 결정). 실제: ' + locked.join(', '));
  },

  //  ⑤ 마이그레이션이 자리를 못 박고, 가드·승격 값이 정본과 맞물린다
  migrationShape(sql, canonVer) {
    const code = stripSqlComments(sql);
    assert.ok(/ALTER\s+TABLE\s+project[\s\S]{0,400}?ADD\s+COLUMN\s+dev_end_date\s+DATE\s+NULL/i.test(code),
      MIGRATE + ' 이 project 에 ' + COL + ' DATE NULL 을 추가하지 않는다');
    assert.ok(/ADD\s+COLUMN\s+dev_end_date[\s\S]{0,400}?AFTER\s+end_date/i.test(code),
      MIGRATE + ' 에 `AFTER end_date` 가 없다 — 컬럼이 표 끝에 붙어 정본(신규 구축)과 순서가 갈린다. ' +
      '그 차이는 mysqldump 대조에서만 드러나므로, 여기서 못 박지 않으면 아무도 모른다');
    //  값은 이 파일 자신에게서 읽고, 정본과는 **관계**로 대조한다 — 시험에 판번호를 박으면
    //  정본이 움직일 때 시험이 거짓말을 한다.
    //  ★ 2026-09-10 정정: 예전에는 "이 마이그레이션이 올리는 값 = 정본이 심는 값" 이었다. 그건
    //    '이 파일이 언제나 마지막 판' 이라는 가정이었고, 같은 날 user-sort-order(10 → 11)가 뒤에
    //    붙으면서 깨졌다. 이 파일이 지켜야 할 사실은 셋으로 좁혀진다:
    //      ① 한 칸만 움직인다 · ② 가드가 그 출발값을 요구한다 · ③ 정본을 **앞서가지 않는다**.
    //    정본과 '최신 마이그레이션'의 일치는 schema-integrity 계약⑥ 이 파일 목록 전체로 본다.
    const bump = /UPDATE\s+cal_schema_meta\s+SET\s+v\s*=\s*'(\d+)'[\s\S]{0,200}?AND\s+v\s*=\s*'(\d+)'/i.exec(code);
    assert.ok(bump, MIGRATE + ' 에서 schema_version 승격 문장을 찾지 못했다');
    const to = Number(bump[1]), from = Number(bump[2]);
    assert.strictEqual(to, from + 1,
      MIGRATE + ' 이 판번호를 ' + from + ' → ' + to + ' 로 움직인다 — 한 번에 한 칸이어야 중간 판이 건너뛰어지지 않는다');
    assert.ok(to <= Number(canonVer),
      MIGRATE + ' 이 올리는 값(' + to + ')이 정본이 심는 값(' + canonVer + ')보다 크다 — ' +
      '마이그레이션이 정본을 앞서가면 아무도 도달할 수 없는 판번호를 자칭하게 된다');
    const guard = /@v\s*=\s*'(\d+)'/.exec(code);
    assert.ok(guard, MIGRATE + " 에 선행조건 가드(@v = 'N')가 없다 — 재실행이 1060 으로 죽는다");
    assert.strictEqual(guard[1], String(from),
      MIGRATE + ' 의 가드가 v=' + guard[1] + " 를 요구한다 — 승격 출발값 기준으로는 '" + from + "' 이어야 한다");
  },
};

// ══ 시험 ═══════════════════════════════════════════════════════════
test('계약⓪: 게이트의 기준 파일이 전부 실재한다(못 읽었으면 통과가 아니라 측정 실패다)', () => {
  assert.deepStrictEqual(missing, [],
    '개발종료일 게이트가 기준 파일을 읽지 못했다 — 개명·이동됐다면 경로를 갱신할 것. 없는 것: ' + missing.join(', '));
});

test('계약①: 정본 SQL 두 파일 모두 project.dev_end_date 가 end_date 바로 뒤에 있다', () => {
  for (const [label, sql] of canonFiles) checks.canonHasColumn(label, sql);
});

test('계약②: ProjectDb 의 SELECT·INSERT·UPDATE 가 전부 dev_end_date 를 담는다', () => {
  checks.hostSqlCarriesColumn(projectDb);
});

test('계약③: saveProject 분기가 devEndDate 를 읽고 장표에 개발종료일 열이 있다', () => {
  checks.hostWiring(mainWin);
});

test('계약④: 폼·payload 에 개발종료일이 있고 선진행 잠금 배열에는 없다(설계 결정)', () => {
  checks.appWiring(app);
});

test('계약⑤: 마이그레이션이 AFTER end_date 로 붙이고 판번호를 한 칸만(가드=출발값) 움직인다', () => {
  checks.migrationShape(migrateSql, canonSchemaVersion());
});

// ── 변이 시험 — 계약이 정말 발화하는지(통제군 포함) ─────────────────
test('변이①: 정본에서 컬럼 줄을 지우면 계약① 이 실패한다 + 원본은 통과한다(통제군)', () => {
  const [label, sql] = canonFiles[0];
  const bad = sql.replace(/^[^\S\n]*dev_end_date[^\n]*\n/m, '');
  assert.notStrictEqual(bad, sql, '변이가 원본을 바꾸지 못했다 — 컬럼 줄의 모양이 바뀌었다');
  assert.throws(() => checks.canonHasColumn(label, bad), /dev_end_date 이 없다/);
  assert.doesNotThrow(() => checks.canonHasColumn(label, sql));
});

test('변이①b: 컬럼을 status 뒤로 옮기면 계약① 이 순서를 잡는다(존재만 보면 통과할 변이)', () => {
  //  ★ 옮기는 작업은 **project 블록 안에서만** 한다 — is_active·status 같은 이름은 이 파일의
  //    다른 표에도 있어서, 파일 전체에 replace 를 걸면 엉뚱한 표에 줄을 심고 정작 project 에서는
  //    컬럼이 사라진다(그러면 '순서'가 아니라 '부재'로 실패해 이 변이가 시험하려던 것을 못 본다).
  const [label, sql] = canonFiles[0];
  const blk = /CREATE TABLE\s+`?project`?\s*\(([\s\S]*?)\n\)\s*ENGINE/i.exec(sql);
  assert.ok(blk, '변이 준비 실패: project 블록을 찾지 못했다');
  const body = blk[1];
  const line = /^[^\S\n]*dev_end_date[^\n]*\n/m.exec(body);
  assert.ok(line, '변이 준비 실패: 컬럼 줄을 찾지 못했다');
  const pulled = body.replace(line[0], '');
  const st = /^[^\S\n]*status[^\n]*\n/m.exec(pulled);
  assert.ok(st, '변이 준비 실패: status 줄을 찾지 못했다');
  const movedBody = pulled.replace(st[0], () => st[0] + line[0]);
  assert.notStrictEqual(movedBody, body, '변이가 원본을 바꾸지 못했다');
  const moved = sql.replace(body, () => movedBody);
  assert.throws(() => checks.canonHasColumn(label, moved), /바로 뒤가 아니다/);
});

test('변이②: UPDATE 에서만 dev_end_date 를 빼도 계약② 가 잡는다(문자열 검색이면 통과할 변이)', () => {
  //  UPDATE 쪽에만 있는 조각을 고른다 — INSERT 는 `dev_end_date`(=@ded 없음) 형태라 겹치지 않는다.
  const bad = projectDb.replace('end_date=@ed, dev_end_date=@ded, ', 'end_date=@ed, ');
  assert.notStrictEqual(bad, projectDb, '변이 준비 실패: UPDATE 리터럴의 모양이 바뀌었다');
  //  소스 전체에는 dev_end_date 가 여전히 여러 번 남아 있다 — 그래도 잡혀야 한다.
  assert.ok(bad.includes(COL), '변이가 과했다: 소스에서 컬럼이 통째로 사라지면 이 변이는 계약②를 시험하지 않는다');
  assert.throws(() => checks.hostSqlCarriesColumn(bad), /UPDATE 가 dev_end_date 을 갱신하지 않는다/);
  assert.doesNotThrow(() => checks.hostSqlCarriesColumn(projectDb));
});

test('변이③: 장표 열 정의에서 devEndDate 를 빼면 계약③ 이 실패한다', () => {
  const bad = mainWin.replace(/[^\S\n]*\("개발종료일"[^\n]*\n/, '');
  assert.notStrictEqual(bad, mainWin, '변이 준비 실패: 장표 열 줄을 찾지 못했다');
  assert.throws(() => checks.hostWiring(bad), /Excel 장표에만 빠진다/);
  assert.doesNotThrow(() => checks.hostWiring(mainWin));
});

test('변이④: 잠금 배열에 offEdDevEnd 를 끼워 넣으면 계약④ 가 실패한다(설계 결정 봉인)', () => {
  const bad = app.replace("['offEdStart', 'offEdEnd', 'offEdStatus'].forEach(id => {",
                          "['offEdStart', 'offEdEnd', 'offEdDevEnd', 'offEdStatus'].forEach(id => {");
  assert.notStrictEqual(bad, app, '변이 준비 실패: 잠금 배열의 모양이 바뀌었다');
  assert.throws(() => checks.appWiring(bad), /선진행 잠금 배열에 offEdDevEnd 가 들어갔다/);
  assert.doesNotThrow(() => checks.appWiring(app));
});

test('변이④b: payload 에서 devEndDate 를 빼면 계약④ 가 실패한다', () => {
  const bad = app.replace(/[^\S\n]*devEndDate: val\('offEdDevEnd'\),[^\n]*\n/, '');
  assert.notStrictEqual(bad, app, '변이 준비 실패: payload 줄을 찾지 못했다');
  assert.throws(() => checks.appWiring(bad), /payload 에 devEndDate 가 없다/);
});

test('변이⑤: 마이그레이션에서 AFTER 절을 지우면 계약⑤ 가 실패한다', () => {
  const bad = migrateSql.replace(/\n[^\S\n]*AFTER end_date;/, ';');
  assert.notStrictEqual(bad, migrateSql, '변이 준비 실패: AFTER 절의 모양이 바뀌었다');
  assert.throws(() => checks.migrationShape(bad, canonSchemaVersion()), /AFTER end_date` 가 없다/);
  assert.doesNotThrow(() => checks.migrationShape(migrateSql, canonSchemaVersion()));
});

test('변이⑤b: 가드를 옛 판번호에 두면 계약⑤ 가 승격 출발값과의 어긋남을 잡는다', () => {
  const bad = migrateSql.replace("IF(@v = '9'", "IF(@v = '8'");
  assert.notStrictEqual(bad, migrateSql, '변이 준비 실패: 가드 형태가 바뀌었다');
  assert.throws(() => checks.migrationShape(bad, canonSchemaVersion()), /가드가 v=8/);
});

test('변이⑤c: 판번호를 두 칸 건너뛰면 계약⑤ 가 실패한다(중간 판 누락)', () => {
  const bad = migrateSql.replace("SET v = '10', updated_at", "SET v = '11', updated_at");
  assert.notStrictEqual(bad, migrateSql, '변이 준비 실패: 승격 문장의 모양이 바뀌었다');
  assert.throws(() => checks.migrationShape(bad, canonSchemaVersion()), /한 번에 한 칸이어야/);
});

test('변이⑤d: 마이그레이션이 정본보다 앞서가면 계약⑤ 가 실패한다', () => {
  //  한 칸 규칙은 지키면서 정본(11)을 넘어서는 형태 — 통제군과 달라야 하는 자리다.
  const ahead = Number(canonSchemaVersion()) + 1;
  const bad = migrateSql
    .replace("SET v = '10', updated_at", `SET v = '${ahead}', updated_at`)
    .replace("AND v = '9'", `AND v = '${ahead - 1}'`)
    .replace("IF(@v = '9'", `IF(@v = '${ahead - 1}'`);
  assert.notStrictEqual(bad, migrateSql, '변이 준비 실패: 승격·가드 문장의 모양이 바뀌었다');
  assert.throws(() => checks.migrationShape(bad, canonSchemaVersion()), /정본이 심는 값.*보다 크다/);
  assert.doesNotThrow(() => checks.migrationShape(migrateSql, canonSchemaVersion()));   // 통제군
});
