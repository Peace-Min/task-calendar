// Layer 1: 코드표 번호 키 전환(docs/CODE-TABLE-IDS.md, schema_version 13)의 DB 쪽 계약을 소스 텍스트로 못 박는다.
// MySQL 을 돌리지 않는다(이관 리허설은 사람이 격리 DB 에서 한다). 여기서 보는 것:
//   ① 스키마 모양: 코드표 넷의 번호 PK, name UNIQUE, CHECK(name<>'', is_active IN (0,1)), 자식 번호 열,
//      이름 붙인 인덱스와 외래키(ON UPDATE RESTRICT ON DELETE RESTRICT), 옛 이름 열과 옛 외래키 없음
//   ② 고정 번호: schema-structure.sql 시드 = 이관 SQL 의 지도(구분, 상태), 02-seed-org.sql 직급표 = 이관 SQL 의 직급 지도
//   ③ 이관 SQL 구조: v12 가드, 에러로 멈추는 가드(PREPARE + 없는 표 SELECT), 순서(가드 → 스냅숏 → 번호 → 절단 관문 →
//      절단 → v13 → 사후 검증), 절단 관문의 BINARY 와 NULL 대칭, 두 경로(재구축, 이관)의 제약 정의와 표 COMMENT 일치
//   ④ 운영 스크립트 기본 DB = taskcalendar(§8-1), ⑤ 낡은 진입점이 없고 아무도 읽지 않는다(§8-2)
//   ⑥ 안 쓰는 UPDATE 권한이 없다(§8-3), ⑦ 회사 저장소 시드와 apply.ps1 이 번호 키를 전제한다(§7)
//   ⑧ 변이 주입: 위 검사가 실제로 잡는지
//
//   판정 불가 ≠ 통과: 기준 파일을 못 읽으면 그 사실이 실패다(기준⓪). 최상위에서는 던지지 않는다
//   (run-tests 의 import 루프에서 던지면 전 스위트 판정이 증발한다. schema-integrity 와 같은 규칙).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { test, assert } from './harness.mjs';
import { stripSqlComments, parseSeededSchemaVersion } from './canon-schema.mjs';
import { maskPs, mutate } from './ps-guard-lib.mjs';

const missing = [];
function readOr(url, label) {
  try {
    const s = readFileSync(url, 'utf8');
    if (!s) { missing.push(label + '(빈 파일)'); return ''; }
    return s.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  } catch { missing.push(label); return ''; }
}
const R = (rel) => new URL('../' + rel, import.meta.url);
const C = (name) => new URL('../../taskmgr-company-data/' + name, import.meta.url);   // 비공개 형제 저장소(user-admin 시험과 같은 자리)

const STRUCT   = readOr(R('db/deploy/schema-structure.sql'), 'db/deploy/schema-structure.sql');
const CAL      = readOr(R('db/deploy/schema-calendar.sql'), 'db/deploy/schema-calendar.sql');
const MIG_NAME = 'migrate-2026-10-15-code-ids.sql';
const MIG      = readOr(R('db/deploy/' + MIG_NAME), 'db/deploy/' + MIG_NAME);
const GRANTS   = readOr(R('db/deploy/grants-calendar.sql'), 'db/deploy/grants-calendar.sql');
const BACKUP_USER = readOr(R('db/deploy/create-backup-user.sql'), 'db/deploy/create-backup-user.sql');
const LOAD     = readOr(R('db/deploy/load-template.sql'), 'db/deploy/load-template.sql');
const SEED_DUMMY = readOr(R('db/deploy/seed-dummy.mjs'), 'db/deploy/seed-dummy.mjs');
const SETUP    = readOr(R('db/deploy/setup-taskcalendar.ps1'), 'db/deploy/setup-taskcalendar.ps1');
const WRITE_DB = readOr(R('widget/CalendarWriteDb.cs'), 'widget/CalendarWriteDb.cs');
const DB_README = readOr(R('db/README.md'), 'db/README.md');
const USERS01  = readOr(C('01-schema-users.sql'), 'taskmgr-company-data/01-schema-users.sql');
const SEED02   = readOr(C('02-seed-org.sql'), 'taskmgr-company-data/02-seed-org.sql');
const SEED03   = readOr(C('03-seed-users.sql'), 'taskmgr-company-data/03-seed-users.sql');
const APPLY    = readOr(C('apply.ps1'), 'taskmgr-company-data/apply.ps1');
const OPS = {
  'backup-taskmgr.ps1':  readOr(R('db/deploy/backup-taskmgr.ps1'), 'db/deploy/backup-taskmgr.ps1'),
  'restore-taskmgr.ps1': readOr(R('db/deploy/restore-taskmgr.ps1'), 'db/deploy/restore-taskmgr.ps1'),
  'init-calendar.ps1':   readOr(R('db/deploy/init-calendar.ps1'), 'db/deploy/init-calendar.ps1'),
  'org-ops.ps1':         readOr(R('db/deploy/org-ops.ps1'), 'db/deploy/org-ops.ps1'),
  'app-account.ps1':     readOr(R('db/deploy/app-account.ps1'), 'db/deploy/app-account.ps1'),
};

// ── 작은 파서 ───────────────────────────────────────────────────────
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().replace(/,$/, '').trim();
function tableBlock(sql, t) {
  const m = new RegExp('CREATE TABLE\\s+`?' + t + '`?\\s*\\(([\\s\\S]*?)\\n\\)\\s*ENGINE[^;]*;', 'i').exec(stripSqlComments(sql));
  return m ? m[1] : null;
}
function tableComment(sql, t) {
  const m = new RegExp('CREATE TABLE\\s+`?' + t + '`?\\s*\\([\\s\\S]*?\\n\\)\\s*ENGINE[^;]*?COMMENT=\'([^\']*)\'', 'i').exec(stripSqlComments(sql));
  return m ? m[1] : null;
}
function columnDef(block, col) {
  const m = new RegExp('^\\s*' + col + '\\s+([^\\n]*?),?\\s*$', 'm').exec(block || '');
  return m ? norm(m[1]) : null;
}
// CONSTRAINT 이름 → 정의(공백 접기). 재구축 경로와 이관 경로가 같은 정의를 내놓는지 대조하는 재료.
function constraintDefs(sql) {
  const out = {};
  const code = stripSqlComments(sql);
  for (const m of code.matchAll(/(?:ADD\s+)?CONSTRAINT\s+(\w+)\s+([\s\S]*?)(?=,\s*\n|\n\s*\)|;)/g)) out[m[1]] = norm(m[2]);
  return out;
}
function keyDefs(sql) {
  const out = {};
  const code = stripSqlComments(sql);
  for (const m of code.matchAll(/(?:ADD\s+)?((?:UNIQUE\s+)?KEY)\s+(\w+)\s*\(([^)]*)\)/g)) out[m[2]] = norm(m[1] + ' (' + m[3] + ')');
  return out;
}
// 이관 SQL 의 고정 번호 지도: 'UPDATE <t> ... JOIN ( SELECT 1 AS id, '이름' AS nm UNION ALL SELECT 2, '이름' ... ) m'
function migrationMaps(sql, t) {
  const code = stripSqlComments(sql);
  const maps = [];
  const re = new RegExp('(?:UPDATE|FROM)\\s+' + t + '\\s+\\w+\\s+JOIN\\s*\\(\\s*(SELECT\\s+1\\s+AS\\s+id[\\s\\S]*?)\\)\\s*m\\s+ON', 'g');
  for (const m of code.matchAll(re)) {
    const map = {};
    for (const v of m[1].matchAll(/SELECT\s+(\d+)(?:\s+AS\s+id)?\s*,\s*'([^']*)'/g)) map[v[1]] = v[2];
    maps.push(map);
  }
  return maps;
}
function seedMap(sql, t, idCol) {
  const m = new RegExp('INSERT INTO ' + t + ' \\(' + idCol + ', name, sort_order\\) VALUES([\\s\\S]*?);').exec(sql);
  if (!m) return null;
  const map = {};
  for (const v of m[1].matchAll(/\(\s*(\d+)\s*,\s*'([^']*)'/g)) map[String(Number(v[1]))] = v[2];
  return map;
}
// 이관 SQL 의 '없는 표 SELECT' 중단 문장.
function abortMessages(sql) {
  return [...stripSqlComments(sql).matchAll(/'SELECT 1 FROM `([^`]*)`'/g)].map((m) => m[1]);
}

const PARENTS = [
  { t: 'customer',     id: 'customer_id', src: () => STRUCT,  nameType: 'VARCHAR(100) NOT NULL' },
  { t: 'section_code', id: 'section_id',  src: () => STRUCT,  nameType: 'VARCHAR(50) NOT NULL' },
  { t: 'status_code',  id: 'status_id',   src: () => STRUCT,  nameType: 'VARCHAR(50) NOT NULL' },
  { t: 'title_code',   id: 'title_id',    src: () => USERS01, nameType: 'VARCHAR(30) NOT NULL' },
];
const CHILDREN = [
  { t: 'project',  col: 'customer_id', parent: 'customer',     fk: 'fk_project_customer_id', ix: 'ix_project_customer_id', nullable: false, src: () => STRUCT, old: 'customer' },
  { t: 'project',  col: 'section_id',  parent: 'section_code', fk: 'fk_project_section_id',  ix: 'ix_project_section_id',  nullable: false, src: () => STRUCT, old: 'section' },
  { t: 'project',  col: 'status_id',   parent: 'status_code',  fk: 'fk_project_status_id',   ix: 'ix_project_status_id',   nullable: true,  src: () => STRUCT, old: 'status' },
  { t: 'app_user', col: 'title_id',    parent: 'title_code',   fk: 'fk_user_title_id',       ix: 'ix_user_title_id',       nullable: true,  src: () => USERS01, old: 'title' },
];

// ══ 검사 함수(시험 + 변이 주입이 같은 함수를 쓴다) ═══════════════════════
export const checks = {
  // ① 스키마 모양(재구축 경로의 정본 두 파일)
  schemaShape(struct, users) {
    const srcOf = (p) => (p.src() === USERS01 ? users : struct);
    for (const p of PARENTS) {
      const sql = srcOf(p);
      const blk = tableBlock(sql, p.t);
      assert.ok(blk, `${p.t} 의 CREATE TABLE 을 찾지 못했다`);
      assert.strictEqual(columnDef(blk, p.id), 'SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT', `${p.t}.${p.id} 가 SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT 가 아니다`);
      assert.ok(/^\s*PRIMARY KEY \(\s*\w+\s*\)/m.test(blk) && new RegExp('PRIMARY KEY \\(' + p.id + '\\)').test(blk), `${p.t} 의 기본키가 ${p.id} 하나가 아니다`);
      assert.ok(!/PRIMARY KEY \(name\)/.test(blk), `${p.t} 의 기본키가 아직 name 이다`);
      assert.ok(new RegExp('UNIQUE KEY uq_' + p.t + '_name \\(name\\)').test(blk), `${p.t}.name 에 UNIQUE(uq_${p.t}_name)가 없다(옛 기본키가 하던 중복 막기)`);
      assert.ok(new RegExp("CONSTRAINT chk_" + p.t + "_name\\s+CHECK \\(name <> ''\\)").test(blk), `${p.t} 에 CHECK (name <> '') 가 없다`);
      assert.ok(new RegExp('CONSTRAINT chk_' + p.t + '_active\\s+CHECK \\(is_active IN \\(0,1\\)\\)').test(blk), `${p.t} 에 CHECK (is_active IN (0,1)) 가 없다`);
      assert.ok(columnDef(blk, 'name').startsWith(p.nameType), `${p.t}.name 의 타입이 바뀌었다(기대 ${p.nameType})`);
      const ids = Object.keys(constraintDefs(sql)).filter((n) => n.startsWith('fk_') && new RegExp('REFERENCES\\s+' + p.t + '\\s*\\(\\s*name').test(constraintDefs(sql)[n]));
      assert.deepStrictEqual(ids, [], `${p.t}(name) 을 가리키는 옛 외래키가 남아 있다: ${ids.join(', ')}`);
    }
    for (const c of CHILDREN) {
      const sql = srcOf(c);
      const blk = tableBlock(sql, c.t);
      assert.ok(blk, `${c.t} 의 CREATE TABLE 을 찾지 못했다`);
      const want = c.nullable ? 'SMALLINT UNSIGNED NULL DEFAULT NULL' : 'SMALLINT UNSIGNED NOT NULL';
      assert.strictEqual(columnDef(blk, c.col), want, `${c.t}.${c.col} 가 ${want} 가 아니다(부모 번호 타입과 같아야 FK 가 선다)`);
      assert.strictEqual(columnDef(blk, c.old), null, `${c.t} 에 옛 이름 참조 열 ${c.old} 가 남아 있다`);
      assert.ok(new RegExp('KEY ' + c.ix + '\\s*\\(' + c.col + '\\)').test(blk),`${c.t} 에 이름 붙인 인덱스 ${c.ix}(${c.col}) 가 없다`);
      const fk = constraintDefs(sql)[c.fk];
      assert.ok(fk, `${c.t} 에 외래키 ${c.fk} 가 없다`);
      assert.strictEqual(fk, `FOREIGN KEY (${c.col}) REFERENCES ${c.parent}(${PARENTS.find((p) => p.t === c.parent).id}) ON UPDATE RESTRICT ON DELETE RESTRICT`,
        `${c.fk} 의 정의가 (번호 → 부모 번호, ON UPDATE RESTRICT ON DELETE RESTRICT) 가 아니다`);
    }
    assert.ok(/CONSTRAINT chk_project_active CHECK \(is_active IN \(0,1\)\)/.test(tableBlock(struct, 'project')), 'project 에 CHECK (is_active IN (0,1)) 가 없다');
    for (const old of ['fk_project_customer', 'fk_project_section', 'fk_project_status', 'fk_user_title']) {
      assert.ok(!new RegExp('CONSTRAINT ' + old + '\\b(?!_id)').test(stripSqlComments(struct + '\n' + users)), `옛 외래키 이름 ${old} 가 남아 있다`);
    }
  },

  // ② 고정 번호: 시드와 이관 SQL 의 지도가 같다
  fixedIds(struct, mig, seed02) {
    const sec = seedMap(struct, 'section_code', 'section_id');
    const st = seedMap(struct, 'status_code', 'status_id');
    assert.deepStrictEqual(sec, { 1: '일반계약', 2: '선진행', 3: '사업부관리' }, 'schema-structure.sql 의 구분 시드 번호가 계획(§3)과 다르다');
    assert.deepStrictEqual(st, { 1: '진행중', 2: '종료', 3: '1차 납품완료', 4: '미정' }, 'schema-structure.sql 의 상태 시드 번호가 계획(§3)과 다르다');
    const t02 = /INSERT INTO _title_seed \(title_id, name, sort_order\) VALUES([\s\S]*?);/.exec(seed02);
    assert.ok(t02, '02-seed-org.sql 에 직급 배정표(_title_seed 에 title_id 명시)가 없다');
    const titles = {};
    for (const v of t02[1].matchAll(/\(\s*(\d+)\s*,\s*'([^']*)'/g)) titles[String(Number(v[1]))] = v[2];
    assert.ok(Object.keys(titles).length >= 1, '02-seed-org.sql 의 직급 배정표를 읽지 못했다');
    for (const [t, want] of [['section_code', sec], ['status_code', st], ['title_code', titles]]) {
      const maps = migrationMaps(mig, t);
      assert.strictEqual(maps.length, 2, `${MIG_NAME} 에서 ${t} 의 고정 번호 지도를 2곳(2단계 배정, 4단계 관문)에서 찾지 못했다(찾은 수 ${maps.length})`);
      for (const m of maps) assert.deepStrictEqual(m, want, `${MIG_NAME} 의 ${t} 고정 번호 지도가 정본 시드와 다르다`);
    }
    assert.strictEqual(migrationMaps(mig, 'customer').length, 0, 'customer 에 고정 번호 지도가 생겼다(계획 §3 은 발주처를 1 부터 이름순으로 매긴다)');
    // 나머지 이름은 지도의 MAX+1 부터 이름순: 기준 번호가 지도 크기와 맞는가
    for (const [t, id, max] of [['section_code', 'section_id', 3], ['status_code', 'status_id', 4], ['title_code', 'title_id', Object.keys(titles).length]]) {
      assert.ok(new RegExp('SET @base := \\(SELECT GREATEST\\(' + max + ', IFNULL\\(MAX\\(' + id + '\\), 0\\)\\) FROM ' + t + '\\);').test(mig),
        `${t} 의 MAX+1 기준이 지도의 최대 번호(${max})가 아니다`);
    }
    assert.ok(/ROW_NUMBER\(\) OVER \(ORDER BY name, CAST\(name AS BINARY\)\)/.test(mig), '지도 밖 이름의 번호가 이름순(동률은 BINARY)이 아니다');
    assert.ok(!/ORDER BY sort_order/.test(stripSqlComments(mig)), '번호를 sort_order 순으로 매긴다(로컬 DB 의 sort_order 는 시드와 다르다, §3)');
  },

  // ③ 이관 SQL 구조
  migrationShape(mig, cal) {
    const code = stripSqlComments(mig);
    // 가드: v12 에서만
    assert.ok(/SET @v := \(SELECT v FROM cal_schema_meta WHERE k = 'schema_version'\);\s*\nSET @g := IF\(@v = '12', 'DO 0',/.test(code), 'schema_version 12 가드가 없다');
    // 멈추는 방법: 모든 @g 는 PREPARE/EXECUTE 로 실행되고, 실패 쪽은 '없는 표 SELECT' 다(64자 이내)
    const guards = [...code.matchAll(/SET @g := IF\(([\s\S]*?)\);\s*\nPREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;/g)];
    assert.ok(guards.length >= 8, `에러로 멈추는 가드가 ${guards.length}개뿐이다(가드 0-a~0-g, 절단 관문, 사후 검증)`);
    const nG = [...code.matchAll(/SET @g := /g)].length;
    assert.strictEqual(guards.length, nG, 'PREPARE/EXECUTE 로 실행되지 않는 @g 가 있다(조건을 계산만 하고 멈추지 않는다)');
    for (const g of guards) assert.ok(/'DO 0',\s*\n?\s*'SELECT 1 FROM `중단: [^`]+`'$/.test(g[1].trim()), `가드의 실패 쪽이 '없는 표 SELECT' 가 아니다: ${g[1].slice(0, 80)}`);
    for (const msg of abortMessages(mig)) assert.ok([...msg].length <= 64, `중단 문장이 64자를 넘는다(식별자 한도): ${msg}`);
    assert.ok(!/SIGNAL\s+SQLSTATE/i.test(code), 'SIGNAL 을 쓴다(스토어드 프로그램 밖에서는 못 쓴다)');
    // 순서
    const at = (re, label) => { const m = re.exec(code); assert.ok(m, `${label} 을(를) 찾지 못했다`); return m.index; };
    const steps = [
      ['v12 가드', /IF\(@v = '12'/],
      ['문자셋 가드', /HEX\('선진행'\) = 'EC84A0ECA784ED9689'/],
      ['스냅숏', /CREATE TEMPORARY TABLE _cid_snap_project/],
      ['부모 번호 열 추가', /ADD COLUMN customer_id SMALLINT UNSIGNED NULL DEFAULT NULL FIRST/],
      ['자식 번호 채우기', /UPDATE project p\s*\n\s*LEFT JOIN section_code s ON s\.name = p\.section/],
      ['절단 관문', /'SELECT 1 FROM `중단: 번호가 옛 이름을 그대로 되살리지 못한다/],
      ['옛 외래키 떼기', /ALTER TABLE project DROP FOREIGN KEY/],
      ['옛 열 지우기', /ALTER TABLE project  DROP COLUMN customer, DROP COLUMN section, DROP COLUMN status;/],
      ['부모 기본키 교체', /ADD PRIMARY KEY \(customer_id\)/],
      ['자식 외래키', /ADD CONSTRAINT fk_project_customer_id/],
      ['v13 기록', /UPDATE cal_schema_meta SET v = '13', updated_at = UTC_TIMESTAMP\(3\)\s*\n\s*WHERE k = 'schema_version' AND v = '12';/],
      ['사후 검증 중단', /'SELECT 1 FROM `중단: 사후 검증 실패/],
    ];
    const pos = steps.map(([l, re]) => [l, at(re, l)]);
    for (let i = 1; i < pos.length; i++) {
      assert.ok(pos[i - 1][1] < pos[i][1], `이관 단계 순서가 틀렸다: '${pos[i - 1][0]}' 가 '${pos[i][0]}' 보다 뒤에 있다`);
    }
    // 절단 관문: BINARY, NULL 대칭, 스냅숏 대조
    const gate = code.slice(code.indexOf('SET @cut_parent'), code.indexOf("'SELECT 1 FROM `중단: 번호가 옛 이름을"));
    for (const [col, parent] of [['customer', 'customer'], ['section', 'section_code'], ['status', 'status_code']]) {
      assert.ok(new RegExp('FROM _cid_snap_project s[\\s\\S]{0,200}?LEFT JOIN ' + parent + ' c[\\s\\S]{0,200}?NOT \\(CAST\\(s\\.' + col + ' AS BINARY\\) <=> CAST\\(c\\.name AS BINARY\\)\\)').test(gate),
        `절단 관문이 project.${col} 를 스냅숏과 BINARY, NULL 대칭(<=>)으로 대조하지 않는다`);
      assert.ok(new RegExp('\\(s\\.' + col + ' IS NULL\\) <> \\(p\\.' + col + '_id IS NULL\\)').test(gate), `절단 관문이 project.${col} 의 NULL 여부를 따로 대조하지 않는다`);
    }
    assert.ok(/NOT \(CAST\(s\.title AS BINARY\) <=> CAST\(t\.name AS BINARY\)\)/.test(gate) && /\(s\.title IS NULL\) <> \(u\.title_id IS NULL\)/.test(gate),
      '절단 관문이 app_user.title 을 BINARY, NULL 대칭으로 대조하지 않는다');
    const sum = /SET @g := IF\(@cut_parent \+ @cut_fixed([\s\S]*?) = 0, 'DO 0',/.exec(code);
    assert.ok(sum, '절단 관문이 계산한 값을 합쳐 멈추지 않는다');
    for (const v of ['@cut_cust_null', '@cut_sec_null', '@cut_st_null', '@cut_title_null', '@cut_cust_drift', '@cut_sec_drift', '@cut_st_drift', '@cut_title_drift', '@cut_rows']) {
      assert.ok(sum[1].includes(v), `절단 관문의 합에 ${v} 가 빠졌다(계산만 하고 멈추지 않는다)`);
    }
    // 백필은 감사 시각을 덮지 않는다
    for (const m of code.matchAll(/^UPDATE\s+(\w+)[\s\S]*?;/gm)) {
      if (m[1] === 'cal_schema_meta') continue;
      assert.ok(/updated_at = (?:\w+\.)?updated_at/.test(m[0]), `${m[1]} 백필 UPDATE 가 updated_at 을 자기 값으로 적지 않는다(ON UPDATE 가 갱신 시각을 덮는다)`);
    }
    // 사후 검증: 고아, 행 수, 이름 복원, cal_* 불변, 구조, AUTO_INCREMENT, 판번호가 모두 중단 조건에 들어간다
    const post = /SET @g := IF\(@e_orphan \+ @e_rows \+ @e_proj_drift \+ @e_user_drift \+ @e_same \+ @e_struct \+ @e_ai \+ @e_ver = 0, 'DO 0',/.test(code);
    assert.ok(post, '사후 검증의 중단 조건이 (고아, 행 수, 이름 복원, 불변, 구조, AUTO_INCREMENT, 판번호) 전부가 아니다');
    assert.ok(/information_schema_stats_expiry = 0/.test(code), 'AUTO_INCREMENT 를 낡은 캐시(stats_expiry)로 읽는다');
    // 판번호: 정본 시딩 13 과 맞물린다
    assert.strictEqual(parseSeededSchemaVersion(stripSqlComments(cal)), '13', 'schema-calendar.sql 이 schema_version 13 을 시딩하지 않는다');
    // 머리말: 실행법(백업 -DbName taskcalendar, utf8mb4, --force 금지)
    assert.ok(mig.includes('backup-taskmgr.cmd -DbName taskcalendar'), '머리말에 백업 명령(-DbName taskcalendar)이 없다');
    assert.ok(/mysql -u root -p --default-character-set=utf8mb4 taskcalendar < db\\deploy\\migrate-2026-10-15-code-ids\.sql/.test(mig), '머리말에 실행 명령(utf8mb4, taskcalendar)이 없다');
    assert.ok(/--force 를 붙이지 말 것/.test(mig), '머리말에 --force 금지가 없다');
  },

  // ③-b 두 경로가 같은 구조를 내놓는가: 이관이 거는 제약, 인덱스, 표 COMMENT 가 재구축 정본과 글자까지 같다
  pathsAgree(struct, users, mig) {
    const canonC = { ...constraintDefs(struct), ...constraintDefs(users) };
    const migC = constraintDefs(mig);
    const want = ['chk_customer_name', 'chk_customer_active', 'chk_section_code_name', 'chk_section_code_active',
      'chk_status_code_name', 'chk_status_code_active', 'chk_title_code_name', 'chk_title_code_active', 'chk_project_active',
      'fk_project_customer_id', 'fk_project_section_id', 'fk_project_status_id', 'fk_user_title_id'];
    for (const n of want) {
      assert.ok(canonC[n], `재구축 정본에 ${n} 가 없다`);
      assert.ok(migC[n], `${MIG_NAME} 가 ${n} 를 걸지 않는다`);
      assert.strictEqual(migC[n], canonC[n], `${n} 의 정의가 두 경로에서 다르다: 재구축: [${canonC[n]}] / 이관: [${migC[n]}]`);
    }
    const canonK = { ...keyDefs(struct), ...keyDefs(users) };
    const migK = keyDefs(mig);
    for (const n of ['uq_customer_name', 'uq_section_code_name', 'uq_status_code_name', 'uq_title_code_name',
      'ix_project_customer_id', 'ix_project_section_id', 'ix_project_status_id', 'ix_user_title_id']) {
      assert.ok(canonK[n] && migK[n], `${n} 이(가) 두 경로 중 한쪽에 없다`);
      assert.strictEqual(migK[n], canonK[n], `${n} 의 정의가 두 경로에서 다르다`);
    }
    for (const [t, src] of [['customer', struct], ['section_code', struct], ['status_code', struct], ['project', struct], ['title_code', users]]) {
      const c = tableComment(src, t);
      assert.ok(c, `${t} 의 표 COMMENT 를 정본에서 찾지 못했다`);
      assert.ok(mig.includes(`COMMENT = '${c}';`), `${MIG_NAME} 의 ${t} 표 COMMENT 가 정본과 다르다(정본: ${c})`);
      assert.ok(mig.includes(`'${c}'`), `${MIG_NAME} 사후 검증이 ${t} 표 COMMENT 를 정본 문자열로 대조하지 않는다`);
      assert.ok(!/—|–/.test(c), `${t} 의 새 표 COMMENT 에 대시가 있다`);
    }
    // 열 정의(최종 모양)도 같다. 이관은 NULL 로 더한 뒤 MODIFY 하거나(필수 열), NULL 그대로 둔다(status_id, title_id).
    //  표마다 자기 ALTER 문 안에서 찾는다(customer_id 는 customer 의 PK 이자 project 의 자식 열이라 이름이 겹친다).
    const migCode = stripSqlComments(mig);
    const finalDef = (table, col) => {
      for (const st of migCode.split(';')) {
        if (!new RegExp('^\\s*ALTER TABLE ' + table + '\\b').test(st)) continue;
        const m = new RegExp('MODIFY ' + col + '\\s+([^,\\n]*)').exec(st);
        if (m) return norm(m[1].replace(/\s+FIRST\s*$/, ''));
      }
      const a = new RegExp('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ([^\']*?) (?:AFTER|FIRST)').exec(migCode);
      return a ? norm(a[1]) : null;
    };
    for (const p of PARENTS) {
      assert.strictEqual(finalDef(p.t, p.id), columnDef(tableBlock(p.src() === USERS01 ? users : struct, p.t), p.id), `${p.t}.${p.id} 의 최종 정의가 두 경로에서 다르다`);
    }
    for (const c of CHILDREN) {
      assert.strictEqual(finalDef(c.t, c.col), columnDef(tableBlock(c.src() === USERS01 ? users : struct, c.t), c.col), `${c.t}.${c.col} 의 최종 정의가 두 경로에서 다르다`);
      assert.ok(new RegExp('ADD COLUMN ' + c.col + ' SMALLINT UNSIGNED NULL DEFAULT NULL AFTER ' + c.old + "'").test(mig),
        `${MIG_NAME} 가 ${c.t}.${c.col} 를 옛 열(${c.old}) 바로 뒤에 더하지 않는다(새로 지은 DB 와 열 순서가 갈린다)`);
    }
  },

  // ④ 운영 스크립트 기본 DB = taskcalendar (§8-1)
  opsDefaults(ops, setup, backupUser, applyPs) {
    const want = {
      'backup-taskmgr.ps1': /\[string\]\$DbName\s*=\s*"taskcalendar",/,
      'restore-taskmgr.ps1': /\[string\]\$LiveDb\s*=\s*"taskcalendar",/,
      'init-calendar.ps1': /\[string\]\$DbName\s*=\s*"taskcalendar",/,
      'org-ops.ps1': /\[string\]\$DbName\s*=\s*"taskcalendar",/,
      'app-account.ps1': /\[string\]\$DbName\s*=\s*"taskcalendar",/,
    };
    for (const [f, re] of Object.entries(want)) {
      const code = maskPs(ops[f]);
      assert.ok(re.test(code), `${f} 의 기본 DB 가 taskcalendar 가 아니다(앱이 쓰는 DB, CODE-TABLE-IDS §8-1)`);
      assert.ok(!/\[string\]\$(DbName|LiveDb)\s*=\s*"taskmgr"/.test(code), `${f} 에 기본값 "taskmgr" 가 남아 있다`);
    }
    assert.ok(/\[string\]\$TargetDb\s*=\s*"taskcalendar_restore",/.test(maskPs(ops['restore-taskmgr.ps1'])), 'restore-taskmgr.ps1 의 기본 복구 대상이 taskcalendar_restore 가 아니다');
    // setup 은 옛 DB 를 '원본' 으로 읽어야 한다: 거기만은 taskmgr 가 맞다.
    assert.ok(/\[string\]\$SourceDb = "taskmgr",/.test(maskPs(setup)) && /\[string\]\$TargetDb = "taskcalendar",/.test(maskPs(setup)),
      'setup-taskcalendar.ps1 의 원본(taskmgr)/대상(taskcalendar) 기본값이 바뀌었다');
    assert.ok(/^GRANT SELECT, TRIGGER ON taskcalendar\.\* TO 'taskmgr_backup'@'localhost';/m.test(backupUser),
      'create-backup-user.sql 이 백업 계정에 taskcalendar 권한을 주지 않는다(백업 기본 DB 와 어긋나 권한 선검사에서 멈춘다)');
    if (applyPs) assert.ok(/\[string\]\$DbName = "taskcalendar",/.test(maskPs(applyPs)), '회사 저장소 apply.ps1 의 기본 DB 가 taskcalendar 가 아니다');
  },

  // ⑤ 낡은 진입점(§8-2): 파일이 없고, 스크립트와 시험이 읽지 않는다
  legacyGone() {
    const gone = ['db/deploy/init-db.ps1', 'db/deploy/init-db.cmd', 'db/deploy/migrate.ps1', 'db/deploy/migrate.cmd', 'db/schema.sql',
      'db/deploy/rollback-2026-08-24-org-id.sql'];
    for (const f of gone) assert.ok(!existsSync(R(f)), `지웠어야 할 낡은 진입점이 남아 있다: ${f}`);
    const mig = readdirSync(R('db/deploy/')).filter((f) => /^migrate-.*\.sql$/.test(f));
    assert.deepStrictEqual(mig, [MIG_NAME], `db/deploy 의 이관 파일이 ${MIG_NAME} 하나가 아니다: ${mig.join(', ')}`);
    const names = ['init-db.ps1', 'init-db.cmd', 'migrate.ps1', 'migrate.cmd', 'db/schema.sql', 'rollback-2026-08-24-org-id.sql',
      'migrate-2026-07-', 'migrate-2026-08-', 'migrate-2026-09-'];
    const bad = [];
    // 스크립트: 주석을 지운 코드에서 파일을 여는 자리(Join-Path, Get-Content, -File, %~dp0, mysql < 파일)에 옛 이름이 있으면 실패.
    const deploy = readdirSync(R('db/deploy/')).filter((f) => /\.(ps1|cmd)$/.test(f));
    for (const f of deploy) {
      const src = readFileSync(R('db/deploy/' + f), 'utf8');
      const code = f.endsWith('.ps1') ? maskPs(src) : src.split(/\r?\n/).filter((l) => !/^\s*rem\b/i.test(l)).join('\n');
      for (const line of code.split('\n')) {
        if (!/Join-Path|Get-Content|ReadAllText|-File\b|%~dp0|<\s*["`]?\$/.test(line)) continue;
        for (const n of names) if (line.includes(n)) bad.push(`${f}: ${line.trim().slice(0, 120)}`);
      }
    }
    // 시험: 옛 파일을 읽는 자리(readFileSync, new URL, readOr, loadSql, loadDeploy)에 옛 이름이 있으면 실패.
    const tests = readdirSync(new URL('./', import.meta.url)).filter((f) => /\.mjs$/.test(f) && f !== 'code-ids-db.test.mjs');
    for (const f of tests) {
      const src = readFileSync(new URL('./' + f, import.meta.url), 'utf8');
      for (const line of src.split(/\r?\n/)) {
        if (/^\s*\/\//.test(line)) continue;
        if (!/readFileSync|new URL\(|readOr\(|loadSql\(|loadDeploy\(|const MIGRATE/.test(line)) continue;
        for (const n of names) if (line.includes(n)) bad.push(`tests/${f}: ${line.trim().slice(0, 120)}`);
      }
    }
    assert.deepStrictEqual(bad, [], '지운 파일을 아직 읽는 자리가 있다:\n' + bad.join('\n'));
  },

  // ⑥ 안 쓰는 UPDATE 권한(§8-3)
  unusedGrants(grants, writeDb, mig) {
    for (const t of ['cal_entry_commit', 'cal_todo_day_note', 'cal_room']) {
      const m = new RegExp('^GRANT\\s+([A-Z, ]+?)\\s+ON\\s+taskmgr\\.' + t + '\\s+TO', 'm').exec(grants);
      assert.ok(m, `grants-calendar.sql 에 ${t} 의 GRANT 가 없다`);
      assert.deepStrictEqual(m[1].split(',').map((s) => s.trim()).sort(), ['DELETE', 'INSERT', 'SELECT'],
        `${t} 의 권한이 SELECT, INSERT, DELETE 가 아니다(호스트는 지운 뒤 다시 넣는다. UPDATE 는 쓰지 않는다)`);
      assert.ok(!new RegExp('UPDATE\\s+' + t + '\\b', 'i').test(writeDb), `실물: widget/CalendarWriteDb.cs 가 ${t} 에 UPDATE 를 낸다(권한을 빼면 깨진다)`);
      assert.ok(new RegExp("REVOKE UPDATE ON `', DATABASE\\(\\), '`\\." + t + " FROM").test(mig), `${MIG_NAME} 가 이미 받은 ${t} 의 UPDATE 를 거두지 않는다`);
    }
  },

  // ⑦ 회사 저장소: 시드와 apply.ps1 이 번호 키를 전제한다
  companyRepo(seed02, seed03, applyPs) {
    assert.ok(/INSERT INTO title_code \(title_id, name, sort_order\)\s*\nSELECT s\.title_id, s\.name, s\.sort_order FROM _title_seed s/.test(seed02), '02 가 직급을 번호 명시로 넣지 않는다');
    assert.ok(/'SELECT 1 FROM `중단: 직급 번호와 이름이 DB 와 어긋난다/.test(seed02), '02 가 DB 와 어긋난 직급 번호, 이름을 덮지 않고 멈추는 가드가 없다');
    assert.ok(/INSERT INTO app_user \(user_id, login_id, name, title_id, org_id\)\s*\nSELECT s\.user_id, s\.login_id, s\.name, t\.title_id, s\.org_id FROM _user_seed s\s*\n\s*LEFT JOIN title_code t ON CAST\(t\.name AS BINARY\) = CAST\(s\.title AS BINARY\)/.test(seed03),
      '03 이 직급 이름을 title_code 에서 번호로 바꿔(BINARY 조인) 넣지 않는다');
    assert.ok(/OR NOT \(u\.title_id <=> t\.title_id\)/.test(seed03), '03 의 드리프트 가드(G3)가 직급을 번호로 비교하지 않는다');
    assert.ok(/'SELECT 1 FROM `중단: 이 파일의 직급 이름이 title_code 에 없다/.test(seed03), '03 이 못 찾는 직급 이름에서 멈추지 않는다(조용히 NULL 로 들어간다)');
    // 03 의 명부가 쓰는 직급 이름은 전부 02 배정표에 있다
    const t02 = new Set([...(/INSERT INTO _title_seed[\s\S]*?VALUES([\s\S]*?);/.exec(seed02) || [, ''])[1].matchAll(/'([^']*)'/g)].map((m) => m[1]));
    const u03 = /INSERT INTO _user_seed \(user_id, login_id, name, title, org_id\) VALUES([\s\S]*?)\n;/.exec(seed03);
    assert.ok(u03, '03 의 명부(_user_seed)를 읽지 못했다');
    const used = new Set([...u03[1].matchAll(/\(\s*\d+\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'([^']*)'/g)].map((m) => m[1]));
    const lack = [...used].filter((t) => !t02.has(t));
    assert.deepStrictEqual(lack, [], `03 이 쓰는 직급 이름 중 02 배정표에 없는 것: ${lack.join(', ')}`);
    const code = maskPs(applyPs);
    assert.ok(/if\(\$tPk -ne 'title_id' -or \$tOld -ne 0 -or \$tNew -ne 1\)\{/.test(code) && /if\(\$tOrphan -ne 0\)\{ Die /.test(code) && /if\(\$tFk -ne 1\)\{ Die /.test(code),
      'apply.ps1 에 title_id 게이트(PK, 옛 열, 고아, 외래키)가 없다');
    assert.ok(/if\(\$preTitle -ne 2 -or \$preTitleOld -ne 0\)\{/.test(code), 'apply.ps1 -SkipSchema 선행검사가 직급 번호 키를 보지 않는다');
  },

  // 그 밖의 구조 따르기(load-template, seed-dummy, 문서 속 비밀번호)
  followers(load, seedDummy, readme) {
    assert.ok(/INSERT INTO project\s*\n\s*\(section_id, customer_id, project_name,[^)]*status_id, note\)/.test(load), 'load-template.sql 이 project 에 번호 열로 넣지 않는다');
    assert.ok(/'SELECT 1 FROM `중단: 코드표에 없는 구분, 발주처, 상태 이름이 있다/.test(load), 'load-template.sql 이 못 찾는 이름에서 멈추지 않는다(JOIN 으로 조용히 빠진다)');
    assert.ok(/FROM project p JOIN section_code s ON s\.section_id = p\.section_id/.test(seedDummy), 'seed-dummy.mjs 가 구분을 번호로 조인하지 않는다');
    assert.ok(/const DB_SECTION_COLORS = \{ 1: '#3e5be0', 3: '#8a5cf6', 2: '#c2770a' \};/.test(seedDummy), 'seed-dummy.mjs 의 구분 색 표가 번호 기준이 아니다');
    assert.ok(!/-ptaskmgr123|taskmgr123/.test(readme), 'db/README.md 에 관리자 비밀번호 글자가 남아 있다(§8-5)');
  },
};

// ══ 시험 ═══════════════════════════════════════════════════════════
test('번호 키⓪: 기준 파일이 전부 실재한다(회사 저장소 포함, 못 읽으면 측정 실패)', () => {
  assert.deepStrictEqual(missing, [], '번호 키 게이트가 기준 파일을 읽지 못했다: ' + missing.join(', ') +
    ': taskmgr-company-data 는 이 저장소의 형제 폴더여야 한다');
});
test('번호 키①: 코드표 넷은 번호 PK, name UNIQUE, CHECK 두 개, 자식은 번호 열, 이름 붙인 인덱스, RESTRICT 외래키', () => checks.schemaShape(STRUCT, USERS01));
test('번호 키②: 고정 번호(구분 2=선진행, 상태 2=종료)가 시드와 이관 지도에서 같다, 나머지는 MAX+1 이름순', () => checks.fixedIds(STRUCT, MIG, SEED02));
test('번호 키③: 이관 SQL 은 v12 가드, 에러로 멈추는 가드, 단계 순서, BINARY 절단 관문, 사후 검증, v13', () => checks.migrationShape(MIG, CAL));
test('번호 키③-b: 이관 경로와 재구축 경로의 제약, 인덱스, 열, 표 COMMENT 가 글자까지 같다', () => checks.pathsAgree(STRUCT, USERS01, MIG));
test('번호 키④: 운영 스크립트 기본 DB 는 taskcalendar(setup 원본만 taskmgr), 백업 계정 권한도 taskcalendar', () => checks.opsDefaults(OPS, SETUP, BACKUP_USER, APPLY));
test('번호 키⑤: 낡은 진입점과 지난 이관 파일이 없고, 스크립트와 시험이 읽지 않는다', () => checks.legacyGone());
test('번호 키⑥: cal_entry_commit, cal_todo_day_note, cal_room 에 UPDATE 권한이 없다, 이관이 거둔다', () => checks.unusedGrants(GRANTS, WRITE_DB, MIG));
test('번호 키⑦: 회사 저장소 02, 03, apply.ps1 이 직급 번호 키를 전제한다', () => checks.companyRepo(SEED02, SEED03, APPLY));
test('번호 키⑧: load-template, seed-dummy 가 번호 키를 따르고 db/README.md 에 비밀번호가 없다', () => checks.followers(LOAD, SEED_DUMMY, DB_README));

// ── 변이: 검사가 실제로 잡는지(통제군 포함) ─────────────────────────
test('번호 키 변이①: 절단 관문의 중단을 끄면(DO 0 만 남기면) ③ 이 잡는다', () => {
  const bad = mutate(MIG, "'SELECT 1 FROM `중단: 번호가 옛 이름을 그대로 되살리지 못한다 - 옛 열을 지우지 않았다`'", "'DO 0'");
  assert.throws(() => checks.migrationShape(bad, CAL), /절단 관문|없는 표 SELECT/);
  assert.doesNotThrow(() => checks.migrationShape(MIG, CAL));
});
test('번호 키 변이②: 절단 관문의 BINARY 비교를 콜레이션 비교로 바꾸면 ③ 이 잡는다', () => {
  const bad = MIG.replace('WHERE p.id IS NULL OR NOT (CAST(s.customer AS BINARY) <=> CAST(c.name AS BINARY)));', 'WHERE p.id IS NULL OR NOT (s.customer <=> c.name));');
  assert.notStrictEqual(bad, MIG, '변이 준비 실패');
  assert.throws(() => checks.migrationShape(bad, CAL), /project\.customer 를 스냅숏과 BINARY/);
});
test('번호 키 변이③: 이관 지도의 고정 번호 하나를 바꾸면(선진행 2 → 4) ② 가 잡는다', () => {
  const bad = mutate(MIG, "    SELECT 1 AS id, '일반계약' AS nm UNION ALL SELECT 2, '선진행' UNION ALL SELECT 3, '사업부관리'\n  ) m ON CAST(s.name AS BINARY) = CAST(m.nm AS BINARY)\n   SET s.section_id",
    "    SELECT 1 AS id, '일반계약' AS nm UNION ALL SELECT 4, '선진행' UNION ALL SELECT 3, '사업부관리'\n  ) m ON CAST(s.name AS BINARY) = CAST(m.nm AS BINARY)\n   SET s.section_id");
  assert.throws(() => checks.fixedIds(STRUCT, bad, SEED02), /고정 번호 지도가 정본 시드와 다르다/);
  assert.doesNotThrow(() => checks.fixedIds(STRUCT, MIG, SEED02));
});
test('번호 키 변이④: 이관이 거는 CHECK 를 재구축과 다르게 쓰면 ③-b 가 잡는다', () => {
  const bad = mutate(MIG, "  ADD CONSTRAINT chk_customer_active CHECK (is_active IN (0,1)),", "  ADD CONSTRAINT chk_customer_active CHECK (is_active >= 0),");
  assert.throws(() => checks.pathsAgree(STRUCT, USERS01, bad), /chk_customer_active 의 정의가 두 경로에서 다르다/);
  assert.doesNotThrow(() => checks.pathsAgree(STRUCT, USERS01, MIG));
});
test('번호 키 변이⑤: 정본의 외래키를 CASCADE 로 되돌리면 ① 이 잡는다', () => {
  const bad = mutate(STRUCT, "REFERENCES customer(customer_id)\n    ON UPDATE RESTRICT ON DELETE RESTRICT", "REFERENCES customer(customer_id)\n    ON UPDATE CASCADE ON DELETE RESTRICT");
  assert.throws(() => checks.schemaShape(bad, USERS01), /fk_project_customer_id 의 정의가/);
});
test('번호 키 변이⑥: 백필 UPDATE 에서 updated_at 대입을 빼면 ③ 이 잡는다', () => {
  const bad = mutate(MIG, "   SET p.section_id = s.section_id, p.customer_id = c.customer_id, p.status_id = t.status_id,\n       p.updated_at = p.updated_at;",
    "   SET p.section_id = s.section_id, p.customer_id = c.customer_id, p.status_id = t.status_id;");
  assert.throws(() => checks.migrationShape(bad, CAL), /updated_at 을 자기 값으로/);
});
test('번호 키 변이⑦: 기본 DB 를 taskmgr 로 되돌리거나 cal_room 에 UPDATE 를 되살리면 ④, ⑥ 이 잡는다', () => {
  const ops = { ...OPS, 'org-ops.ps1': mutate(OPS['org-ops.ps1'], '[string]$DbName = "taskcalendar",', '[string]$DbName = "taskmgr",') };
  assert.throws(() => checks.opsDefaults(ops, SETUP, BACKUP_USER, APPLY), /org-ops\.ps1 의 기본 DB/);
  const g = mutate(GRANTS, "GRANT SELECT, INSERT, DELETE ON taskmgr.cal_room TO", "GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.cal_room TO");
  assert.throws(() => checks.unusedGrants(g, WRITE_DB, MIG), /cal_room 의 권한이/);
});
test('번호 키 변이⑧: 03 이 직급 이름을 그대로 넣으면(번호 변환 없이) ⑦ 이 잡는다', () => {
  const bad = mutate(SEED03, 'SELECT s.user_id, s.login_id, s.name, t.title_id, s.org_id FROM _user_seed s', 'SELECT s.user_id, s.login_id, s.name, s.title, s.org_id FROM _user_seed s');
  assert.throws(() => checks.companyRepo(SEED02, bad, APPLY), /번호로 바꿔/);
});
