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
//   식: NULL, 숫자, '문자열', @변수, IF, COALESCE, CAST(x AS UNSIGNED), OR, AND, NOT, IS [NOT] NULL,
//   = <> <=> < <= > >=, REGEXP, IN (...), 그리고 cal_schema_meta 와 information_schema.TABLES 를 읽는 하위 질의.
//   NULL 은 MySQL 처럼 세 값 논리로 다룬다.
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
    const num = /^\d+/.exec(s.slice(i));
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
    throw new Error(`모르는 식 요소: ${x.v}`);
  }
}

// ── 흉내 DB ────────────────────────────────────────────────────────────
//  meta: { 키: 값 } (cal_schema_meta). 실행 기록(writes)과 updated_at 흉내(시각 카운터)를 남긴다.
export class FakeDb {
  constructor(meta, { tableExists = true, schema = 'taskcalendar' } = {}) {
    this.rows = new Map(Object.entries(meta).map(([k, v]) => [k, { v, at: 0 }]));
    this.tableExists = tableExists;
    this.schema = schema;
    this.comment = '';
    this.clock = 0;
    this.vars = new Map();
    this.prepared = new Map();
    this.tx = null;
    this.writes = [];        // [{ k, v }] 실제로 바뀐 행
    this.mutations = 0;      // 바꿀 수 있는 문장을 실행한 횟수(실패 주입 기준)
    this.visible = [this.meta()];   // 다른 연결(앱)에 보인 상태들: 처음, 트랜잭션 밖 문장 뒤, COMMIT 뒤
  }
  snap() { if (!this.tx) this.visible.push(this.meta()); }
  meta() { return Object.fromEntries([...this.rows].map(([k, r]) => [k, r.v])); }
  stamps() { return Object.fromEntries([...this.rows].map(([k, r]) => [k, r.at])); }
  subquery(q) {
    const s = q.replace(/\s+/g, ' ');
    let m = /^SELECT COUNT\(\*\) FROM information_schema\.TABLES WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'cal_schema_meta'$/i.exec(s);
    if (m) return this.tableExists && this.schema ? 1 : 0;
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
    if (/^SELECT\b/i.test(s)) return;   // 보여 주기만 하는 SELECT
    if (/^START TRANSACTION$/.test(s)) { this.tx = { rows: new Map([...this.rows].map(([k, r]) => [k, { ...r }])), writes: this.writes.length }; return; }
    if (/^COMMIT$/.test(s)) { this.tx = null; this.snap(); return; }
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
      if (this.tx) { this.rows = this.tx.rows; this.writes.length = this.tx.writes; this.tx = null; }
      if (e instanceof SqlStop) return { ok: false, stop: e.stopName };
      if (e instanceof InjectedFault) return { ok: false, fault: e.n };
      throw e;
    }
  }
}
