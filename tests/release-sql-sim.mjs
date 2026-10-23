// release-v<버전>.sql 을 DB 없이 돌려 보는 작은 흉내 실행기(tests/release-sql.test.mjs 전용).
//
// 왜 있나
//   배포 SQL 은 운영자가 폐쇄망 Workbench 에서 한 번 돌리는 파일이고, 실패와 재실행과 건너뛴 배포를 모두
//   견뎌야 한다. 시험 게이트는 MySQL 에 닿지 않으므로, 이 파일이 쓰는 문장만 아는 흉내 실행기로
//   상태 전이(확인, 닫기, 조각, 끝 확인, 열기)를 돌려 본다. 실제 MySQL 리허설을 대신하지는 않는다.
//
// 아는 것(이것 말고는 모두 '모르는 문장' 으로 실패한다. 판정 불가는 통과가 아니다)
//   SET SESSION/NAMES, SET @x := 식, PREPARE x FROM @v / EXECUTE x / DEALLOCATE PREPARE x, DO 0,
//   SELECT 1 FROM `중단: ...`(멈춤), 그 밖의 SELECT(보여 주기만), START TRANSACTION / COMMIT,
//   cal_schema_meta 에 대한 INSERT ... ON DUPLICATE KEY UPDATE, DELETE, UPDATE, ALTER TABLE ... COMMENT.
//   식: NULL, 숫자(음수 상수 포함), '문자열', @변수, IF, COALESCE, CAST(x AS UNSIGNED), OR, AND, NOT, IS [NOT] NULL,
//   = <> <=> < <= > >=, REGEXP, IN (...), 그리고 cal_schema_meta 와 information_schema.TABLES 를 읽는 하위 질의.
//   NULL 은 MySQL 처럼 세 값 논리로 다룬다.
//   회의실 표 두 개(v15 조각 migrations/v15-shared-rooms.sql 이 쓰는 모양만): cal_room(사람마다 두던 이름, v15 가 지운다),
//   room_code(공용 목록, v15 가 만든다). CREATE TABLE IF NOT EXISTS, DROP TABLE, cal_room 에서 room_code 로의
//   INSERT IGNORE ... SELECT(앞뒤 공백 정리, ai_ci 로 묶기, 쓰는 사람 수와 이름 순서), 그리고 SELECT COUNT(*) INTO @x
//   세 가지(고유 이름 수, room_code 에 빠진 이름 수, room_code 줄 수). 정렬과 비교 규칙은 흉내다(대소문자와 악센트 무시).
//   과제 캘린더 표 둘(v16 조각 migrations/v16-project-calendar.sql): CREATE TABLE IF NOT EXISTS 의 정의에서 열 수와 FK 수를 읽어
//   표 모양(defs)으로 두고, information_schema.COLUMNS 와 REFERENTIAL_CONSTRAINTS 의 표별 COUNT(*) 하위 질의에 그 수로 답한다.
//   출발 상태에 이미 있는 표의 모양은 FakeDb 의 defs 옵션으로 준다(모양을 모르는 표를 세면 '모르는 문장' 으로 실패한다).
//   월간보고(v17 조각 migrations/v17-monthly-report.sql): project 표의 열 순서와 형(project 옵션, 기본은 v16 까지의 모양),
//   ALTER TABLE project ADD COLUMN ... AFTER ..., ALGORITHM=INSTANT 와 ADD CONSTRAINT ... CHECK(이미 있으면 MySQL 처럼 오류로 멈춘다),
//   information_schema.COLUMNS(이름, 형과 NULL 허용, 바로 앞 칸 자리)와 TABLE_CONSTRAINTS(CHECK 이름) 하위 질의,
//   그리고 새 표 project_schedule_image 의 모양(defs, MEDIUMBLOB 열 포함).
//
// ★ *.test.mjs 가 아니다(러너가 수집하지 않는다. ps-guard-lib.mjs 머리말과 같은 이유).

export class SqlStop extends Error {
  constructor(name) { super('1146 ' + name); this.stopName = name; }
}
export class InjectedFault extends Error {
  constructor(n, stmt) { super(`주입한 실패: 바꾸는 문장 #${n}: ${stmt.slice(0, 80)}`); this.n = n; }
}

// ── 문장 나누기: 주석(-- 줄끝)을 지우고, 따옴표와 백틱 밖의 ; 에서 자른다 ──────────
export function splitStatements(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === '-' && sql[i + 1] === '-') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (c === "'" || c === '`') {
      let k = i + 1;
      while (k < n) {
        if (sql[k] === c && sql[k + 1] === c) { k += 2; continue; }
        if (sql[k] === c) break;
        k++;
      }
      cur += sql.slice(i, k + 1); i = k + 1; continue;
    }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ── 식 ────────────────────────────────────────────────────────────────
function tokenize(s) {
  const t = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let k = i + 1, v = '';
      while (k < s.length) {
        if (s[k] === "'" && s[k + 1] === "'") { v += "'"; k += 2; continue; }
        if (s[k] === "'") break;
        v += s[k++];
      }
      t.push({ k: 'str', v }); i = k + 1; continue;
    }
    if (c === '(') {
      // 하위 질의는 통째로 잡는다
      if (/^\(\s*SELECT\b/i.test(s.slice(i))) {
        let d = 0, k = i;
        while (k < s.length) {
          if (s[k] === "'") {                       // 문자열 안의 괄호는 세지 않는다('' 는 이스케이프)
            k++;
            while (k < s.length) { if (s[k] === "'" && s[k + 1] === "'") { k += 2; continue; } if (s[k] === "'") break; k++; }
            k++; continue;
          }
          if (s[k] === '(') d++;
          else if (s[k] === ')') { d--; if (d === 0) break; }
          k++;
        }
        t.push({ k: 'sub', v: s.slice(i + 1, k).trim() }); i = k + 1; continue;
      }
      t.push({ k: 'op', v: '(' }); i++; continue;
    }
    const op = /^(<=>|<=|>=|<>|!=|=|<|>|\)|,)/.exec(s.slice(i));
    if (op) { t.push({ k: 'op', v: op[1] }); i += op[1].length; continue; }
    //  음수 상수(-1): 앞이 값이 아닐 때만(이 흉내에는 빼기 연산이 없다)
    const prev = t[t.length - 1];
    const neg = c === '-' && /\d/.test(s[i + 1] || '') && (!prev || (prev.k === 'op' && prev.v !== ')'));
    const num = /^-?\d+/.exec(s.slice(i));
    if (num && num[0][0] === '-' && !neg) throw new Error(`식을 읽지 못했다: ${s.slice(i, i + 40)}`);
    if (num) { t.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^@?[A-Za-z_][A-Za-z0-9_.]*/.exec(s.slice(i));
    if (id) { t.push({ k: id[0][0] === '@' ? 'var' : 'id', v: id[0] }); i += id[0].length; continue; }
    throw new Error(`식을 읽지 못했다: ${s.slice(i, i + 40)}`);
  }
  return t;
}

const isNull = (v) => v === null || v === undefined;
const toNum = (v) => (typeof v === 'number' ? v : (/^\s*-?\d+(\.\d+)?/.exec(String(v)) ? parseFloat(String(v)) : 0));
const truth = (v) => (isNull(v) ? null : toNum(v) !== 0);
const b = (x) => (x === null ? null : (x ? 1 : 0));
function cmp(a, bb) {
  if (typeof a === 'string' && typeof bb === 'string') return a < bb ? -1 : a > bb ? 1 : 0;   // _bin: 코드 단위 비교
  const x = toNum(a), y = toNum(bb);
  return x < y ? -1 : x > y ? 1 : 0;
}

class Expr {
  constructor(text, db) { this.t = tokenize(text); this.p = 0; this.db = db; }
  peek(v) { const x = this.t[this.p]; return x && (v === undefined || (x.k !== 'str' && String(x.v).toUpperCase() === v)); }
  take(v) { if (!this.peek(v)) throw new Error(`기대한 '${v}' 가 없다(위치 ${this.p})`); return this.t[this.p++]; }
  parse() { const v = this.or(); if (this.p !== this.t.length) throw new Error('식 뒤에 남은 토큰이 있다'); return v; }
  or() { let v = this.and(); while (this.peek('OR')) { this.p++; const r = this.and(); const a = truth(v), c = truth(r); v = (a === true || c === true) ? 1 : (a === null || c === null) ? null : 0; } return v; }
  and() { let v = this.not(); while (this.peek('AND')) { this.p++; const r = this.not(); const a = truth(v), c = truth(r); v = (a === false || c === false) ? 0 : (a === null || c === null) ? null : 1; } return v; }
  not() { if (this.peek('NOT')) { this.p++; const v = truth(this.not()); return v === null ? null : (v ? 0 : 1); } return this.cmp(); }
  cmp() {
    const a = this.prim();
    const x = this.t[this.p];
    if (!x) return a;
    if (x.k === 'op' && ['=', '<>', '!=', '<=>', '<', '<=', '>', '>='].includes(x.v)) {
      this.p++;
      const r = this.prim();
      if (x.v === '<=>') return (isNull(a) && isNull(r)) ? 1 : (isNull(a) || isNull(r)) ? 0 : b(cmp(a, r) === 0);
      if (isNull(a) || isNull(r)) return null;
      const c = cmp(a, r);
      return b({ '=': c === 0, '<>': c !== 0, '!=': c !== 0, '<': c < 0, '<=': c <= 0, '>': c > 0, '>=': c >= 0 }[x.v]);
    }
    if (this.peek('IS')) { this.p++; const neg = this.peek('NOT') ? (this.p++, true) : false; this.take('NULL'); return b(neg ? !isNull(a) : isNull(a)); }
    if (this.peek('REGEXP')) { this.p++; const r = this.prim(); if (isNull(a) || isNull(r)) return null; return b(new RegExp(String(r)).test(String(a))); }
    if (this.peek('IN')) {
      this.p++; this.take('(');
      const list = [this.or()]; while (this.peek(',')) { this.p++; list.push(this.or()); } this.take(')');
      if (isNull(a)) return null;
      return b(list.some((v) => !isNull(v) && cmp(a, v) === 0));
    }
    return a;
  }
  args() { this.take('('); const xs = []; if (!this.peek(')')) { xs.push(this.or()); while (this.peek(',')) { this.p++; xs.push(this.or()); } } this.take(')'); return xs; }
  prim() {
    const x = this.t[this.p++];
    if (!x) throw new Error('식이 끝났다');
    if (x.k === 'num') return x.v;
    if (x.k === 'str') return x.v;
    if (x.k === 'var') return this.db.vars.has(x.v) ? this.db.vars.get(x.v) : null;
    if (x.k === 'sub') return this.db.subquery(x.v);
    if (x.k === 'op' && x.v === '(') { const v = this.or(); this.take(')'); return v; }
    const U = String(x.v).toUpperCase();
    if (U === 'NULL') return null;
    if (U === 'IF') { const [c, y, n] = this.args(); return truth(c) ? y : n; }
    if (U === 'COALESCE') { const xs = this.args(); return xs.find((v) => !isNull(v)) ?? null; }
    if (U === 'CAST') {
      this.take('('); const v = this.or(); this.take('AS'); this.take('UNSIGNED'); this.take(')');
      if (isNull(v)) return null;
      const m = /^\s*(\d+)/.exec(String(v)); return m ? Number(m[1]) : 0;
    }
    if (U === 'DATABASE') { this.args(); return this.db.schema; }
    if (U === 'ROW_COUNT') { this.args(); return this.db.rowCount ?? 0; }
    throw new Error(`모르는 식 요소: ${x.v}`);
  }
}

// ── 회의실 표 흉내(v15) ───────────────────────────────────────────────
const fold = (x) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();   // utf8mb4_0900_ai_ci 흉내
const trimSp = (x) => x.replace(/^ +| +$/g, '');                                 // MySQL TRIM 은 공백만 지운다
const ROOM_SRC = "FROM cal_room WHERE TRIM(name) <> '' GROUP BY TRIM(name) COLLATE utf8mb4_0900_ai_ci) t";
const ROOM_INSERT = 'INSERT IGNORE INTO room_code (name, sort_order, created_at, updated_at) SELECT nm, ROW_NUMBER() OVER (ORDER BY users DESC, nm) * 10, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) '
  + 'FROM (SELECT MIN(TRIM(name)) COLLATE utf8mb4_0900_ai_ci AS nm, COUNT(DISTINCT user_id) AS users ' + ROOM_SRC;
const ROOM_COUNTS = {
  [`(SELECT 1 AS one ${ROOM_SRC}`]: (db) => db.roomGroups().length,
  [`(SELECT MIN(TRIM(name)) COLLATE utf8mb4_0900_ai_ci AS nm ${ROOM_SRC} LEFT JOIN room_code r ON r.name = t.nm WHERE r.room_id IS NULL`]:
    (db) => { const rc = db.need('room_code'); return db.roomGroups().filter((x) => !rc.some((r) => fold(r.name) === fold(x.nm))).length; },
  'room_code': (db) => db.need('room_code').length,
};

// ── 표 정의의 모양(v16): 열 수와 FK 수 ────────────────────────────────────
//  CREATE TABLE 문 하나에서 괄호 안의 열 정의 줄(이름 + 형)과 FOREIGN KEY 를 센다. 정본과 조각의 정의를 같은 함수로 센다.
const COL_LINE = /^\s*[a-z_][a-z0-9_]*\s+(TINYINT|SMALLINT|INT|BIGINT|VARCHAR|CHAR|DATE|DATETIME|TIME|TEXT|MEDIUMTEXT|MEDIUMBLOB|JSON|DECIMAL)\b/i;
//  표 모양을 세는(defs) 새 표: 과제 캘린더(v16)와 월간보고 그림 표(v17)
const SHAPED = (n) => n.startsWith('cal_project_') || n === 'project_schedule_image';

// ── project 표의 모양(v17): 열 순서, 형, NULL 허용과 CHECK 이름 ──────────────────
//  정본 schema-structure.sql 의 v16 까지 모양. dev_start_date 는 v17 이 end_date 뒤에 넣는다.
export const PROJECT_V16 = () => ({
  cols: ['id:int', 'uid:char', 'section_id:smallint', 'customer_id:smallint', 'project_name:varchar', 'contract_name:varchar',
    'common_name:varchar', 'start_date:date?', 'end_date:date?', 'dev_end_date:date?', 'status_id:smallint?', 'note:varchar',
    'is_active:tinyint', 'created_at:datetime', 'updated_at:datetime'],
  checks: ['chk_project_active'],
});
export const PROJECT_V17 = () => {
  const p = PROJECT_V16();
  p.cols.splice(p.cols.indexOf('end_date:date?') + 1, 0, 'dev_start_date:date?');
  p.checks.push('chk_project_dev_dates');
  return p;
};
const colOf = (c) => { const [name, t] = c.split(':'); return { name, type: t.replace('?', ''), nullable: t.endsWith('?') }; };
export function defOf(createSql) {
  const open = createSql.indexOf('(');
  const close = createSql.lastIndexOf(') ENGINE=');
  if (open < 0 || close < open) throw new Error(`표 정의를 읽지 못했다: ${createSql.slice(0, 80)}`);
  const body = createSql.slice(open + 1, close);
  return { cols: body.split('\n').filter((l) => COL_LINE.test(l)).length, fks: (body.match(/\bFOREIGN KEY\b/g) || []).length };
}

// ── 흉내 DB ────────────────────────────────────────────────────────────
//  meta: { 키: 값 } (cal_schema_meta). 실행 기록(writes)과 updated_at 흉내(시각 카운터)를 남긴다.
//  tables: { cal_room: [{ user_id, name }], room_code: [{ name, sort_order }] } 처럼 있는 표만 준다(없는 키 = 없는 표).
//  표 바꾸기도 writes 에 'table:<이름>' 으로 남긴다(다시 돌렸을 때 바뀐 것이 없는지 보려고).
export class FakeDb {
  constructor(meta, { tableExists = true, schema = 'taskcalendar', tables = {}, defs = {}, project = PROJECT_V16() } = {}) {
    this.rows = new Map(Object.entries(meta).map(([k, v]) => [k, { v, at: 0 }]));
    this.tables = Object.fromEntries(Object.entries(tables).map(([n, rs]) => [n, rs.map((r) => ({ ...r }))]));
    this.defs = Object.fromEntries(Object.entries(defs).map(([n, d]) => [n, { ...d }]));   // 표 이름 → { cols, fks }(v16 검증용)
    this.project = { cols: [...project.cols], checks: [...project.checks] };                  // project 표 모양(v17 검증용)
    this.tableExists = tableExists;
    this.schema = schema;
    this.comment = '';
    this.clock = 0;
    this.vars = new Map();
    this.prepared = new Map();
    this.tx = null;
    this.writes = [];        // [{ k, v }] 실제로 바뀐 행
    this.mutations = 0;      // 바꿀 수 있는 문장을 실행한 횟수(실패 주입 기준)
    this.visible = [this.state()];   // 다른 연결(앱)에 보인 상태들(state): 처음, 트랜잭션 밖 문장 뒤, COMMIT 뒤
  }
  snap() { if (!this.tx) this.visible.push(this.state()); }
  meta() { return Object.fromEntries([...this.rows].map(([k, r]) => [k, r.v])); }
  //  meta 에 회의실 표 모양('#tables')을 붙인 것. 앱에 보인 상태 비교와 실패 뒤 재실행 결과 비교에 쓴다.
  state() { return { ...this.meta(), '#tables': JSON.stringify(this.tableShape()), '#project': JSON.stringify(this.project) }; }
  tableShape() {
    const out = {};
    for (const n of Object.keys(this.tables).sort()) {
      out[n] = n === 'room_code'
        ? this.tables[n].map((r) => [r.name, r.sort_order]).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
        : this.defs[n] ? [`cols=${this.defs[n].cols}`, `fks=${this.defs[n].fks}`]
          : this.tables[n].map((r) => `${r.user_id}:${r.name}`).sort();
    }
    return out;
  }
  hasTable(n) { return n === 'cal_schema_meta' ? this.tableExists : Object.prototype.hasOwnProperty.call(this.tables, n); }
  need(n) { if (!this.hasTable(n)) throw new SqlStop(`${n}(없음)`); return this.tables[n]; }
  //  cal_room 의 이름을 앞뒤 공백을 지우고 ai_ci 로 묶는다. nm 은 묶음의 MIN(cal_room.name 은 _bin 이라 코드 단위 순서).
  roomGroups() {
    const g = new Map();
    for (const r of this.need('cal_room')) {
      const t = trimSp(r.name);
      if (t === '') continue;
      const x = g.get(fold(t)) || { nm: null, users: new Set() };
      if (x.nm === null || t < x.nm) x.nm = t;
      x.users.add(r.user_id);
      g.set(fold(t), x);
    }
    return [...g.values()].map((x) => ({ nm: x.nm, users: x.users.size }));
  }
  stamps() { return Object.fromEntries([...this.rows].map(([k, r]) => [k, r.at])); }
  subquery(q) {
    const s = q.replace(/\s+/g, ' ');
    let m = /^SELECT COUNT\(\*\) FROM information_schema\.TABLES WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME (?:= '(\w+)'|IN \(([^)]*)\))$/i.exec(s);
    if (m) {
      if (!this.schema) return 0;
      const names = m[1] ? [m[1]] : [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]);
      return names.filter((n) => this.hasTable(n)).length;
    }
    m = /^SELECT COUNT\(\*\) FROM information_schema\.(COLUMNS|REFERENTIAL_CONSTRAINTS) WHERE (?:TABLE_SCHEMA|CONSTRAINT_SCHEMA) = DATABASE\(\) AND TABLE_NAME = '(\w+)'$/i.exec(s);
    if (m) {
      if (!this.schema || !this.hasTable(m[2])) return 0;
      const d = this.defs[m[2]];
      if (!d) throw new Error(`모양을 모르는 표를 센다(defs 에 ${m[2]} 가 없다)`);
      return m[1].toUpperCase() === 'COLUMNS' ? d.cols : d.fks;
    }
    //  v17: project 의 칸(이름만, 또는 형과 NULL 허용까지), 바로 앞 칸 자리, CHECK 이름
    m = /^SELECT COUNT\(\*\) FROM information_schema\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'project' AND COLUMN_NAME = '(\w+)'(?: AND DATA_TYPE = '(\w+)' AND IS_NULLABLE = '(YES|NO)')?$/.exec(s);
    if (m) {
      if (!this.schema) return 0;
      const c = this.project.cols.map(colOf).find((x) => x.name === m[1]);
      if (!c) return 0;
      if (m[2] === undefined) return 1;
      return c.type === m[2] && c.nullable === (m[3] === 'YES') ? 1 : 0;
    }
    m = /^SELECT COUNT\(\*\) FROM information_schema\.COLUMNS a JOIN information_schema\.COLUMNS b ON b\.TABLE_SCHEMA = a\.TABLE_SCHEMA AND b\.TABLE_NAME = a\.TABLE_NAME AND b\.ORDINAL_POSITION = a\.ORDINAL_POSITION \+ 1 WHERE a\.TABLE_SCHEMA = DATABASE\(\) AND a\.TABLE_NAME = 'project' AND a\.COLUMN_NAME = '(\w+)' AND b\.COLUMN_NAME = '(\w+)'$/.exec(s);
    if (m) {
      if (!this.schema) return 0;
      const names = this.project.cols.map((c) => colOf(c).name);
      const i = names.indexOf(m[1]);
      return i >= 0 && names[i + 1] === m[2] ? 1 : 0;
    }
    m = /^SELECT COUNT\(\*\) FROM information_schema\.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'project' AND CONSTRAINT_NAME = '(\w+)' AND CONSTRAINT_TYPE = 'CHECK'$/.exec(s);
    if (m) return this.schema && this.project.checks.includes(m[1]) ? 1 : 0;
    m = /^SELECT v FROM cal_schema_meta WHERE k = '([a-z_0-9]+)'$/.exec(s);
    if (m) return this.rows.has(m[1]) ? this.rows.get(m[1]).v : null;
    m = /^SELECT COUNT\(\*\) FROM cal_schema_meta WHERE k = '([a-z_0-9]+)'$/.exec(s);
    if (m) return this.rows.has(m[1]) ? 1 : 0;
    m = /^SELECT COUNT\(\*\) FROM cal_schema_meta WHERE k IN \(([^)]*)\)$/.exec(s);
    if (m) return [...m[1].matchAll(/'([a-z_0-9]+)'/g)].filter((x) => this.rows.has(x[1])).length;
    throw new Error(`모르는 하위 질의: ${s}`);
  }
  eval(text) { return new Expr(text, this).parse(); }
  put(k, v) {
    const r = this.rows.get(k);
    this.clock++;
    this.rows.set(k, { v, at: this.clock });
    this.writes.push({ k, v, was: r ? r.v : null });
  }
  mutating(stmt, opts) {
    this.mutations++;
    if (opts.failAt === this.mutations) throw new InjectedFault(this.mutations, stmt);
  }
  exec(stmt, opts = {}) {
    const s = stmt.trim();
    let m;
    if (/^SET (SESSION|NAMES)\b/i.test(s)) return;
    if ((m = /^SET (@\w+) := ([\s\S]+)$/.exec(s))) { this.vars.set(m[1], this.eval(m[2])); return; }
    if ((m = /^PREPARE (\w+) FROM (@\w+)$/.exec(s))) { this.prepared.set(m[1], this.vars.get(m[2])); return; }
    if ((m = /^EXECUTE (\w+)$/.exec(s))) {
      const body = this.prepared.get(m[1]);
      if (typeof body !== 'string') throw new Error(`준비되지 않은 문장 실행: ${m[1]}`);
      return this.exec(body, opts);
    }
    if (/^DEALLOCATE PREPARE \w+$/.test(s)) return;
    if (/^DO 0$/.test(s)) return;
    if ((m = /^SELECT 1 FROM `([^`]+)`$/.exec(s))) throw new SqlStop(m[1]);
    const q = s.replace(/\s+/g, ' ');
    if ((m = /^SELECT COUNT\(\*\) INTO (@\w+) FROM ([\s\S]+)$/.exec(q))) {
      const f = ROOM_COUNTS[m[2]];
      if (!f) throw new Error(`모르는 문장: ${q.slice(0, 160)}`);
      this.vars.set(m[1], f(this));
      return;
    }
    if (/^SELECT\b/i.test(s)) return;   // 보여 주기만 하는 SELECT
    if (/^START TRANSACTION$/.test(s)) {
      this.tx = { rows: new Map([...this.rows].map(([k, r]) => [k, { ...r }])), writes: this.writes.length,
        tables: Object.fromEntries(Object.entries(this.tables).map(([n, rs]) => [n, rs.map((r) => ({ ...r }))])) };
      return;
    }
    if (/^COMMIT$/.test(s)) { this.tx = null; this.snap(); return; }
    if ((m = /^CREATE TABLE IF NOT EXISTS (\w+) \(/.exec(q))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      if (!this.hasTable(m[1])) {
        this.tables[m[1]] = [];
        if (SHAPED(m[1])) this.defs[m[1]] = defOf(s);
        this.writes.push({ k: `table:${m[1]}`, v: 'create' });
      }
      return;
    }
    if ((m = /^DROP TABLE (\w+)$/.exec(q))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      this.need(m[1]);                       // 없는 표를 지우면 MySQL 도 오류(1051)로 멈춘다
      delete this.tables[m[1]];
      delete this.defs[m[1]];
      this.writes.push({ k: `table:${m[1]}`, v: 'drop' });
      return;
    }
    //  v17: project 에 칸 하나(AFTER), CHECK 하나. 이미 있으면 MySQL 처럼 오류로 멈춘다(1060, 3822). 조각은 information_schema 로 건너뛴다.
    if ((m = /^ALTER TABLE project ADD COLUMN (\w+) (DATE) NULL AFTER (\w+), ALGORITHM=INSTANT$/.exec(q))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      const names = this.project.cols.map((c) => colOf(c).name);
      if (names.includes(m[1])) throw new SqlStop(`1060 칸 ${m[1]} 이 이미 있다`);
      const at = names.indexOf(m[3]);
      if (at < 0) throw new SqlStop(`1054 칸 ${m[3]} 이 없다`);
      this.project.cols.splice(at + 1, 0, `${m[1]}:${m[2].toLowerCase()}?`);
      this.writes.push({ k: `col:project.${m[1]}`, v: 'add' });
      return;
    }
    if ((m = /^ALTER TABLE project ADD CONSTRAINT (\w+) CHECK \(.+\)$/.exec(q))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      if (this.project.checks.includes(m[1])) throw new SqlStop(`3822 CHECK ${m[1]} 이 이미 있다`);
      this.project.checks.push(m[1]);
      this.writes.push({ k: `check:${m[1]}`, v: 'add' });
      return;
    }
    //  v17 4b: 기존 과제 개발 날짜 기본값. 과제 행은 흉내 내지 않는다(0행). 칸이 없으면 MySQL 처럼 1054 로 멈춘다.
    if (/^UPDATE project SET dev_start_date = DATE_ADD\(start_date, INTERVAL 1 MONTH\), dev_end_date = DATE_SUB\(end_date, INTERVAL 1 MONTH\) WHERE id > 0 AND dev_start_date IS NULL AND dev_end_date IS NULL AND start_date IS NOT NULL AND end_date IS NOT NULL AND DATE_ADD\(start_date, INTERVAL 1 MONTH\) <= DATE_SUB\(end_date, INTERVAL 1 MONTH\)$/.test(q)) {
      this.mutating(s, opts);
      const names = this.project.cols.map((c) => colOf(c).name);
      for (const c of ['dev_start_date', 'dev_end_date', 'start_date', 'end_date']) if (!names.includes(c)) throw new SqlStop(`1054 칸 ${c} 이 없다`);
      this.rowCount = 0;
      return;
    }
    if (q === ROOM_INSERT) {
      this.mutating(s, opts);
      const rc = this.need('room_code');
      const groups = this.roomGroups().sort((a, b) => b.users - a.users || (fold(a.nm) < fold(b.nm) ? -1 : fold(a.nm) > fold(b.nm) ? 1 : 0));
      let n = 0;
      groups.forEach((x, i) => {
        if (rc.some((r) => fold(r.name) === fold(x.nm))) return;   // INSERT IGNORE: name UNIQUE(ai_ci) 충돌은 건너뛴다
        rc.push({ name: x.nm, sort_order: (i + 1) * 10 });
        n++;
      });
      if (n) this.writes.push({ k: 'table:room_code', v: `+${n}` });
      return;
    }
    if (!this.tableExists) throw new SqlStop('cal_schema_meta(없음)');
    if ((m = /^INSERT INTO cal_schema_meta \(k, v, updated_at\) VALUES ([\s\S]+?) ON DUPLICATE KEY UPDATE (k = k|v = '([^']*)', updated_at = UTC_TIMESTAMP\(3\))$/.exec(s))) {
      this.mutating(s, opts);
      const tuples = [...m[1].matchAll(/\('([a-z_0-9]+)', '((?:[^']|'')*)', UTC_TIMESTAMP\(3\)\)/g)];
      if (!tuples.length) throw new Error(`INSERT 값을 읽지 못했다: ${s}`);
      for (const tp of tuples) {
        const k = tp[1], v = tp[2].replace(/''/g, "'");
        if (!this.rows.has(k)) this.put(k, v);
        else if (m[3] !== undefined) this.put(k, m[3]);
      }
      return;
    }
    if ((m = /^DELETE FROM cal_schema_meta WHERE k = '([a-z_0-9]+)'$/.exec(s))) {
      this.mutating(s, opts);
      if (this.rows.delete(m[1])) this.writes.push({ k: m[1], v: null });
      return;
    }
    if ((m = /^UPDATE cal_schema_meta SET v = '((?:[^']|'')*)', updated_at = UTC_TIMESTAMP\(3\)\s+WHERE k = '([a-z_0-9]+)'(?: AND v (=|<>) '((?:[^']|'')*)')?$/.exec(s))) {
      this.mutating(s, opts);
      const v = m[1].replace(/''/g, "'"), k = m[2];
      const r = this.rows.get(k);
      if (!r) return;
      if (m[3] === '=' && r.v !== m[4].replace(/''/g, "'")) return;
      if (m[3] === '<>' && r.v === m[4].replace(/''/g, "'")) return;
      this.put(k, v);
      return;
    }
    if ((m = /^ALTER TABLE cal_schema_meta COMMENT = '((?:[^']|'')*)'$/.exec(s))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      this.comment = m[1].replace(/''/g, "'");
      return;
    }
    throw new Error(`모르는 문장: ${s.slice(0, 120)}`);
  }
  // 파일 전체를 Workbench 처럼(오류에서 멈춤) 돌린다. 멈추면 열린 트랜잭션은 되돌린다(세션이 끝날 때와 같다).
  run(sql, opts = {}) {
    this.vars = new Map();
    this.mutations = 0;
    try {
      for (const st of splitStatements(sql)) { const before = this.mutations; this.exec(st, opts); if (this.mutations !== before) this.snap(); }
      if (this.tx) throw new Error('끝났는데 트랜잭션이 열려 있다');
      return { ok: true };
    } catch (e) {
      if (this.tx) { this.rows = this.tx.rows; this.tables = this.tx.tables; this.writes.length = this.tx.writes; this.tx = null; }
      if (e instanceof SqlStop) return { ok: false, stop: e.stopName };
      if (e instanceof InjectedFault) return { ok: false, fault: e.n };
      throw e;
    }
  }
}
