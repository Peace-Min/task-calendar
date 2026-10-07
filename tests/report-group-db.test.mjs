// Layer 1: 보고서 묶음(cal_category.report_group, schema_version 13) DB 계약을 소스 텍스트로 검사한다.
// 의존성 0(jsdom 도 DB 도 필요 없다). docs/REPORT-INCLUDE-STATE.md 의 데이터/DB 계약.
//
// 이 파일은 **보조 증거**다. 호스트가 실제로 'etc' 외 값을 'include' 로 내리고 되읽는지는
// tests/loop-calendar-write.mjs(실 DB 왕복)가 증명하고, 마이그레이션의 실제 적용은
// tests/loop-migrate-report-group.mjs 가 증명한다. 여기서는 그 둘이 기대는 글자(DDL, 마이그레이션 표식,
// 부팅 SELECT, 저장 SQL)가 빠지지 않았는지를 무인 게이트에서 바로 잡는다.
//
// 검사 함수(checks)를 시험과 변이 주입이 공유한다(검사가 실제로 잡는지 증명. 이 저장소의 관례).
import { test, assert } from './harness.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { stripSqlComments } from './canon-schema.mjs';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

const CANON = 'db/deploy/schema-calendar.sql';
const MIGRATE = 'db/deploy/migrate-2026-10-06-category-report-group.sql';
const READ_CS = 'widget/CalendarDb.cs';
const WRITE_CS = 'widget/CalendarWriteDb.cs';

const canonSql = read(CANON);
const migrateSql = read(MIGRATE);
const readCs = read(READ_CS);
const writeCs = read(WRITE_CS);

// cal_category CREATE 블록(주석 제거본). 다음 CREATE TABLE 앞까지.
function catBlock(sql) {
  const code = stripSqlComments(sql);
  const a = code.indexOf('CREATE TABLE cal_category (');
  assert.ok(a >= 0, 'cal_category CREATE 블록을 찾지 못했다');
  const b = code.indexOf('CREATE TABLE', a + 10);
  return code.slice(a, b < 0 ? undefined : b);
}

// 마이그레이션의 schema_version 갱신 [N, M] 목록(schema-guards 의 versionBump 와 같은 정규식).
function bumps(sql) {
  const code = stripSqlComments(sql);
  const re = /\bUPDATE\s+`?cal_schema_meta`?\s+SET\s+v\s*=\s*'(\d+)'[\s\S]*?WHERE\s+k\s*=\s*'schema_version'\s+AND\s+v\s*=\s*'(\d+)'/gi;
  const out = [];
  let m;
  while ((m = re.exec(code)) !== null) out.push([Number(m[2]), Number(m[1])]);
  return out;
}

// C# 문자열 연결("..." + "...")을 한 줄로 이어 붙인 판. SQL 조각을 정규식으로 보기 위해.
function joinCsStrings(src) {
  return src.replace(/"\s*\+\s*\$?"/g, '');
}

const checks = {
  // (a) 정본 DDL
  canonDdl(sql) {
    const blk = catBlock(sql);
    assert.ok(/\breport_group\s+VARCHAR\(8\)\s+CHARACTER\s+SET\s+utf8mb4\s+COLLATE\s+utf8mb4_bin\s+NOT\s+NULL\s+DEFAULT\s+'include'\s*,/i.test(blk),
      "정본 cal_category 에 report_group VARCHAR(8) _bin NOT NULL DEFAULT 'include' 가 없다");
    assert.ok(/\buses_repo\b[^\n]*\n\s*report_group\b/.test(blk),
      'report_group 이 uses_repo 바로 다음 컬럼이 아니다(마이그레이션의 AFTER uses_repo 와 위치가 어긋난다)');
    assert.ok(/CONSTRAINT\s+chk_cal_category_rgroup\s+CHECK\s*\(\s*report_group\s+IN\s*\(\s*'include'\s*,\s*'etc'\s*\)\s*\)/i.test(blk),
      "정본에 chk_cal_category_rgroup CHECK (report_group IN ('include','etc')) 가 없다");
    const seed = /VALUES\s*\(\s*'schema_version'\s*,\s*'(\d+)'/.exec(stripSqlComments(sql));
    assert.ok(seed && seed[1] === '13', '정본 시딩 schema_version 이 13 이 아니다: ' + (seed && seed[1]));
  },
  // (b) 마이그레이션 표식
  migration(sql) {
    const code = stripSqlComments(sql);
    assert.ok(/SET\s+NAMES\s+utf8mb4/i.test(code), 'SET NAMES utf8mb4 가 없다');
    assert.ok(/lock_wait_timeout/i.test(code), 'lock_wait_timeout 이 없다');
    assert.ok(/information_schema\.COLUMNS[\s\S]{0,200}COLUMN_NAME\s*=\s*'report_group'/i.test(code),
      '컬럼 유무 탐지(information_schema.COLUMNS report_group)가 없다');
    assert.ok(/information_schema\.CHECK_CONSTRAINTS[\s\S]{0,200}'chk_cal_category_rgroup'/i.test(code),
      'CHECK 유무 탐지(information_schema.CHECK_CONSTRAINTS)가 없다');
    assert.ok(/@ver\s+IN\s*\(\s*'12'\s*,\s*'13'\s*\)/.test(code), "가드 @ver IN ('12','13') 가 없다");
    assert.ok(/IF\(\s*@has_col\s*=\s*1\s*,\s*'DO 0'\s*,\s*'ALTER TABLE cal_category ADD COLUMN report_group VARCHAR\(8\)[^']*?NOT NULL DEFAULT ''include'' AFTER uses_repo'/.test(code),
      '컬럼이 없을 때만 ADD COLUMN report_group ... AFTER uses_repo 하는 조건부 문장이 없다');
    assert.ok(/IF\(\s*@has_chk\s*=\s*1\s*,\s*'DO 0'\s*,\s*'ALTER TABLE cal_category ADD CONSTRAINT chk_cal_category_rgroup CHECK/.test(code),
      'CHECK 가 없을 때만 추가하는 조건부 문장이 없다');
    const b = bumps(sql);
    assert.deepStrictEqual(b, [[12, 13]], 'schema_version 갱신이 12→13 정확히 한 건이 아니다: ' + JSON.stringify(b));
    const e9 = code.slice(code.indexOf('SET @bad'));
    assert.ok(code.includes('SET @bad'), '차단형 사후 검증(SET @bad)이 없다');
    for (const [label, re] of [
      ['타입 varchar(8)', /COLUMN_TYPE\s*=\s*'varchar\(8\)'/],
      ['NOT NULL', /IS_NULLABLE\s*=\s*'NO'/],
      ['기본값 include', /COLUMN_DEFAULT\s*=\s*'include'/],
      ['위치 uses_repo+1', /ORDINAL_POSITION\s*\+\s*1[\s\S]{0,200}COLUMN_NAME\s*=\s*'uses_repo'/],
      ['CHECK 존재', /CHECK_CONSTRAINTS[\s\S]{0,120}chk_cal_category_rgroup/],
      ['버전 13', /k\s*=\s*'schema_version'\s+AND\s+v\s*=\s*'13'/],
      ['기존 행 전부 include', /report_group\s*<>\s*'include'/],
    ]) assert.ok(re.test(e9), '차단형 사후 검증에 ' + label + ' 조건이 없다');
    assert.ok(/IF\(\s*@bad\s*=\s*0\s*,\s*'DO 0'\s*,\s*'SELECT 1 FROM `/.test(e9), '사후 검증이 실패해도 중단(존재하지 않는 표 SELECT)하지 않는다');
  },
  // (c) 부팅 조회
  readAdapter(cs) {
    const flat = joinCsStrings(cs);
    const m = /const string catSql\s*=\s*"(SELECT[^"]*FROM cal_category c[^"]*)"/.exec(flat);
    assert.ok(m, 'CalendarDb 의 catSql 을 찾지 못했다');
    assert.ok(/\bc\.report_group\b/.test(m[1]), '부팅 과제 조회(catSql)가 c.report_group 을 SELECT 하지 않는다');
    assert.ok(/\["usesRepo"\][^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*\["reportGroup"\]\s*=\s*Str\(rd,\s*"report_group"\)\s*==\s*"etc"\s*\?\s*"etc"\s*:\s*"include"\s*,/.test(cs),
      'CalendarDb 가 usesRepo 바로 뒤에 ["reportGroup"] = (etc ? etc : include) 를 항상 싣지 않는다');
    const v = /\bconst\s+string\s+ExpectedSchemaVersion\s*=\s*"(\d+)"\s*;/.exec(cs);
    assert.ok(v && v[1] === '13', 'ExpectedSchemaVersion 이 13 이 아니다: ' + (v && v[1]));
  },
  // (d) 저장
  writeAdapter(cs) {
    const flat = joinCsStrings(cs);
    const upd = /"SET name=@n,[^"]*WHERE user_id=\{u\} AND cat_no=\{no\}"/.exec(flat);
    assert.ok(upd, '과제 UPDATE SET 문장을 찾지 못했다');
    assert.ok(/\breport_group=@rg\b/.test(upd[0]), '과제 UPDATE 의 SET 에 report_group=@rg 가 없다');
    const ins = /INSERT INTO cal_category \(([^)]*)\)\s*VALUES \(([^)]*)\)/.exec(flat);
    assert.ok(ins, 'INSERT INTO cal_category 를 찾지 못했다');
    const cols = ins[1].split(',').map((s) => s.trim());
    const vals = ins[2].split(',').map((s) => s.trim());
    assert.strictEqual(cols.length, vals.length, 'INSERT 컬럼 수와 VALUES 수가 다르다');
    const ci = cols.indexOf('report_group');
    assert.ok(ci >= 0, 'INSERT 컬럼 목록에 report_group 이 없다');
    assert.strictEqual(vals[ci], '@rg', 'INSERT 의 report_group 자리 값이 @rg 가 아니다');
    const cp = /CategoryParams\(JsonElement c, int i\) => new\(\)\s*\{([\s\S]*?)\};/.exec(cs);
    assert.ok(cp, 'CategoryParams 본문을 찾지 못했다');
    assert.ok(/\("@rg",\s*S\(c,\s*"reportGroup"\)\s*==\s*"etc"\s*\?\s*"etc"\s*:\s*"include"\)/.test(cp[1]),
      'CategoryParams 가 etc 외 값을 include 로 내리는 @rg 를 만들지 않는다');
  },
  // schema-guards 의 체인과 같은 판정: 모든 migrate-*.sql 의 갱신이 이어져 정본 버전에서 끝난다.
  chainEndsAtCanon(srcMap, canon) {
    const seed = /VALUES\s*\(\s*'schema_version'\s*,\s*'(\d+)'/.exec(stripSqlComments(canon));
    const links = [];
    for (const [, sql] of srcMap) for (const p of bumps(sql)) links.push(p);
    const top = Math.max(...links.map((l) => l[1]));
    assert.strictEqual(String(top), seed[1], `마이그레이션 체인의 끝(${top})이 정본 값(${seed[1]})과 다르다`);
    assert.ok(links.some((l) => l[0] === 12 && l[1] === 13), '12→13 고리가 체인에 없다');
  },
};

const DEPLOY = new URL('../db/deploy/', import.meta.url);
const migrateSrc = new Map(readdirSync(DEPLOY).filter((f) => /^migrate-.*\.sql$/i.test(f)).sort()
  .map((f) => [f, readFileSync(new URL(f, DEPLOY), 'utf8')]));

test('report_group (a): 정본 DDL 에 report_group NOT NULL DEFAULT include + CHECK, 시딩 13', () => checks.canonDdl(canonSql));
test('report_group (b): 마이그레이션이 조건부 ADD COLUMN, 조건부 CHECK, 12→13 1건, 차단형 사후 검증을 갖는다', () => checks.migration(migrateSql));
test('report_group (c): CalendarDb 부팅 catSql 이 c.report_group 을 SELECT 하고 reportGroup 을 include/etc 로 정규화한다', () => checks.readAdapter(readCs));
test('report_group (d): CalendarWriteDb UPDATE SET 과 INSERT 컬럼 목록에 report_group, CategoryParams 가 etc 외 값을 include 로', () => checks.writeAdapter(writeCs));
test('report_group (b2): 마이그레이션 체인이 정본 13 에서 끝난다', () => checks.chainEndsAtCanon(migrateSrc, canonSql));

// ── 변이(검사가 실제로 잡는지) ──────────────────────────────────────
function mutate(src, from, to) {
  const out = src.replace(from, to);
  assert.notStrictEqual(out, src, '변이 준비 실패: 대상을 찾지 못했다 ' + String(from));
  return out;
}

test('변이 report_group-1: INSERT 컬럼 목록에서만 report_group 을 빼면 (d) 가 실패한다', () => {
  const bad = mutate(writeCs, 'project_uid,uses_repo,report_group,sort_order', 'project_uid,uses_repo,sort_order');
  assert.throws(() => checks.writeAdapter(bad), /INSERT/);
});
test('변이 report_group-2: UPDATE SET 에서 report_group 을 빼면 (d) 가 실패한다', () => {
  const bad = mutate(writeCs, 'uses_repo=@ur, report_group=@rg,', 'uses_repo=@ur,');
  assert.throws(() => checks.writeAdapter(bad), /UPDATE/);
});
test('변이 report_group-3: CategoryParams 가 값을 그대로 넘기면 (d) 가 실패한다', () => {
  const bad = mutate(writeCs, '("@rg", S(c, "reportGroup") == "etc" ? "etc" : "include")', '("@rg", S(c, "reportGroup"))');
  assert.throws(() => checks.writeAdapter(bad), /CategoryParams/);
});
test('변이 report_group-4: 부팅 SELECT 에서 c.report_group 을 빼면 (c) 가 실패한다', () => {
  const bad = mutate(readCs, 'c.uses_repo, c.report_group, ', 'c.uses_repo, ');
  assert.throws(() => checks.readAdapter(bad), /catSql/);
});
test('변이 report_group-5: 마이그레이션의 12→13 UPDATE 를 지우면 (b) 와 체인 검사가 실패한다', () => {
  const bad = mutate(migrateSql, /UPDATE cal_schema_meta SET v = '13'[^;]*;/, '');
  assert.throws(() => checks.migration(bad), /12→13/);
  const m = new Map(migrateSrc);
  m.set('migrate-2026-10-06-category-report-group.sql', bad);
  assert.throws(() => checks.chainEndsAtCanon(m, canonSql), /체인의 끝|12→13/);
});
test('변이 report_group-6: 정본에서 DEFAULT include 를 빼면 (a) 가 실패한다', () => {
  const bad = mutate(canonSql, "COLLATE utf8mb4_bin NOT NULL DEFAULT 'include', -- 보고서 묶음", 'COLLATE utf8mb4_bin NOT NULL, -- 보고서 묶음');
  assert.throws(() => checks.canonDdl(bad), /DEFAULT 'include'/);
});
test('변이 report_group-7: 사후 검증에서 위치 조건을 빼면 (b) 가 실패한다', () => {
  const bad = mutate(migrateSql, /AND ORDINAL_POSITION = \(SELECT ORDINAL_POSITION \+ 1[\s\S]*?'uses_repo'\)\)/, ')');
  assert.throws(() => checks.migration(bad), /위치/);
});
