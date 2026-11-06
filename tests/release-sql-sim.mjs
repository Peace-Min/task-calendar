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
//   Git, SVN 삭제(v18 조각 migrations/v18-remove-git.sql): 일정 표 셋의 행(cal_entry 의 user_id, entry_no, source,
//   cal_entry_except, cal_entry_commit), 지울 칸과 CHECK 의 목록과 cal_user_pref 표 설명(vcs 옵션, 기본은 17 까지의 모양).
//   DELETE FROM cal_entry WHERE user_id > 0 AND source = 'git'(FK CASCADE 로 자식 행도 지운다, 트랜잭션 안),
//   SELECT COUNT(*) INTO @x FROM cal_entry WHERE source = 'git', DROP TABLE cal_entry_commit,
//   ALTER TABLE ... DROP CHECK(없으면 3821), ALTER TABLE ... DROP COLUMN ..., ALGORITHM=INSTANT(없으면 1091, 그 칸을 쓰는
//   CHECK 가 남아 있으면 MySQL 처럼 3959), ALTER TABLE cal_user_pref COMMENT, 그리고 information_schema.COLUMNS 와
//   TABLE_CONSTRAINTS 의 이름 하나 또는 IN 목록 하위 질의. 지울 칸이 없는데 그 칸을 읽거나 지우면 1054 로 멈춘다.
//   과제 순서(v19 조각 migrations/v19-project-order.sql): project 표의 행(tables.project 의 id, section_id, common_name,
//   project_name, is_active, 그리고 칸이 있으면 sort_no), ALTER TABLE project ADD COLUMN sort_no INT UNSIGNED NULL AFTER ...
//   (행마다 sort_no = NULL 이 생긴다), section_code 와 status_code 의 표 설명(codes 옵션, 기본은 18 까지의 글자)과
//   ALTER TABLE ... COMMENT, information_schema.COLUMNS 의 COLUMN_TYPE 과 TABLES 의 TABLE_COMMENT 하위 질의,
//   순서 채우기 UPDATE 한 문장(V19_FILL 과 글자까지 같아야 한다. 구분마다 표시 이름 순, 같으면 id 순으로 그 구분의 최댓값 뒤에),
//   그리고 SELECT COUNT(*) INTO @x FROM project WHERE is_active = 1 AND sort_no IS NULL. 칸이 없으면 1054 로 멈춘다.
//   주간보고 회의내용(v20 조각 migrations/v20-weekly-meeting.sql): cal_report_weekly 표의 열 순서와 형(weekly 옵션, 기본은 19 까지의 모양),
//   ALTER TABLE cal_report_weekly ADD COLUMN meeting MEDIUMTEXT NULL AFTER ..., ALGORITHM=INSTANT(있는 행은 meeting = NULL 이 된다),
//   information_schema.COLUMNS 의 이름, COLUMN_TYPE 과 NULL 허용, 바로 앞 칸 자리 하위 질의(project 와 같은 모양).
//   행(tables.cal_report_weekly 의 user_id, period_start, 그리고 칸이 있으면 meeting)은 값이 바뀌지 않았는지 보려고만 둔다.
//   주간 과제투입시간 표(같은 v20 조각, 2026-10-30 결정 14): cal_report_weekly_hours 를 v16 처럼 표 모양(defs)으로 둔다.
//   CREATE TABLE IF NOT EXISTS 의 정의에서 열 수, FK 수와 함께 기본 키 열 수, CHECK 이름, FK 의 대상과 규칙을 읽고
//   information_schema.KEY_COLUMN_USAGE(PRIMARY), TABLE_CONSTRAINTS(CHECK 이름), REFERENTIAL_CONSTRAINTS(대상, DELETE_RULE,
//   UPDATE_RULE) 의 표별 COUNT(*) 하위 질의에 그 값으로 답한다.
//   과제 일정 반복(같은 v20 조각, 2026-11-02 docs/PC-RECUR.md): 예외일 표 cal_project_event_except 도 위와 같은 표 모양(defs)이고,
//   cal_project_event 의 반복 칸은 defs 의 열 목록(list: 이름, 형, NULL 허용)으로 흉내 낸다.
//   ALTER TABLE cal_project_event ADD COLUMN recur_freq ENUM(...) NULL DEFAULT NULL COMMENT '...' AFTER memo, ALGORITHM=INSTANT 가
//   목록에 칸을 끼우고 열 수를 하나 올린다. information_schema.COLUMNS 의 이름, 형과 NULL 허용과 기본값 NULL, 바로 앞 칸 자리를 그 목록으로 답한다.
//   과제 탭 보기만 목록(v21 조각 migrations/v21-project-watch.sql, 2026-11-04 docs/PC-WATCH.md): cal_project_watch 도 위와 같은 표 모양(defs)이다.
//   기본 키 열 수와 FK 둘(app_user 를 RESTRICT 로, project 를 CASCADE 로)의 대상과 규칙을 표 모양에서 읽어 답한다.
//   일간보고 과제별 줄(v22 조각 migrations/v22-report-hours.sql, 2026-11-06 docs/DB-V22-REPORT-HOURS.md): cal_report_hours, cal_report_daily,
//   cal_report_weekly_hours 의 열(이름, COLUMN_TYPE, NULL 허용, 콜레이션), 색인, FK, CHECK 글, 표 설명, 행을 rh 옵션(RH_V21, RH_V22)으로 둔다.
//   DELETE(일간 옛 줄), ALTER TABLE 의 DROP FOREIGN KEY, DROP INDEX, DROP COLUMN, DROP CHECK, ADD CONSTRAINT CHECK, ADD COLUMN ... AFTER,
//   ADD INDEX, COMMENT(MySQL 의 1091, 1553, 1828, 3821, 3822, 1060, 1061 을 흉내 낸다), 주간 줄 채우기 두 문장(V22_FILL_DB, V22_FILL_LOCAL),
//   DROP TABLE IF EXISTS(지울 표 셋), SELECT COUNT(*) INTO, 그리고 information_schema 의 COLUMNS, STATISTICS, TABLE_CONSTRAINTS,
//   CHECK_CONSTRAINTS(LIKE), REFERENTIAL_CONSTRAINTS, TABLES 하위 질의(GROUP_CONCAT 과 COUNT(DISTINCT) 포함)에 답한다.
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
const COL_LINE = /^\s*[a-z_][a-z0-9_]*\s+(TINYINT|SMALLINT|INT|BIGINT|VARCHAR|CHAR|DATE|DATETIME|TIME|TEXT|MEDIUMTEXT|MEDIUMBLOB|JSON|DECIMAL|ENUM)\b/i;
//  표 모양을 세는(defs) 새 표: 과제 캘린더(v16), 월간보고 그림 표(v17), 주간 과제투입시간 표(v20)
const SHAPED = (n) => n.startsWith('cal_project_') || n === 'project_schedule_image' || n === 'cal_report_weekly_hours';   // cal_project_watch(v21)도 cal_project_ 로 시작한다

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
//  v19: sort_no 를 status_id 뒤에 넣는다. 형은 COLUMN_TYPE 글자('int unsigned')로 둔다(DATA_TYPE 은 첫 낱말).
export const PROJECT_V19 = () => {
  const p = PROJECT_V17();
  p.cols.splice(p.cols.indexOf('status_id:smallint?') + 1, 0, 'sort_no:int unsigned?');
  return p;
};
const colOf = (c) => { const [name, t] = c.split(':'); return { name, type: t.replace('?', ''), nullable: t.endsWith('?') }; };

// ── 주간보고 표의 모양(v20): 열 순서, 형(COLUMN_TYPE 글자), NULL 허용 ─────────────────────
//  정본 schema-calendar.sql 의 cal_report_weekly. 19 까지는 회의내용 칸이 없고, v20 이 plan 뒤에 meeting 을 넣는다.
//  형은 v19 의 sort_no 처럼 COLUMN_TYPE 글자로 둔다(DATA_TYPE 은 첫 낱말).
export const WEEKLY_V19 = () => ({
  cols: ['user_id:smallint unsigned', 'period_start:date', 'period_end:date', 'subject:varchar(200)', 'content:mediumtext',
    'endwork:mediumtext', 'plan:mediumtext', 'composed_at:datetime(3)', 'created_at:datetime(3)', 'updated_at:datetime(3)'],
});
export const WEEKLY_V20 = () => {
  const w = WEEKLY_V19();
  w.cols.splice(w.cols.indexOf('plan:mediumtext') + 1, 0, 'meeting:mediumtext?');
  return w;
};
//  열 모양을 흉내 내는 표(이름 → FakeDb 의 모양 필드)
const COL_SHAPED = { project: 'project', cal_report_weekly: 'weekly' };

// ── 과제 순서(v19): 코드표 표 설명과 순서 채우기 ─────────────────────────────
//  18 까지는 고정 번호 문구가 있다(2026-10-15 이관과 정본 13~18). 19 에서 지운다(정본 schema-structure.sql 과 같은 글자).
export const CODES_V18 = () => ({
  section_code: '구분 코드. PK=section_id(고정 번호 2=선진행), name=UNIQUE 라벨. Admin 관리.',
  status_code: '상태 코드. PK=status_id(고정 번호 2=종료), name=UNIQUE 라벨. Admin 관리.',
});
export const CODES_V19 = () => ({
  section_code: '구분 코드. PK=section_id, name=UNIQUE 라벨. Admin 관리.',
  status_code: '상태 코드. PK=status_id, name=UNIQUE 라벨. Admin 관리.',
});
const CODE_TABLES = ['section_code', 'status_code'];
//  v19 순서 채우기(PREPARE 로 실행되는 글자, 공백 하나로 접은 것). 조각이 바뀌면 여기도 함께 바꾼다(다르면 모르는 문장).
export const V19_FILL = 'UPDATE project p JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY section_id ORDER BY COALESCE(NULLIF(common_name, \'\'), project_name), id) AS rn '
  + 'FROM project WHERE is_active = 1 AND sort_no IS NULL) o ON o.id = p.id '
  + 'LEFT JOIN (SELECT section_id, MAX(sort_no) AS mx FROM project WHERE is_active = 1 GROUP BY section_id) m ON m.section_id = p.section_id '
  + 'SET p.sort_no = IFNULL(m.mx, 0) + o.rn, p.updated_at = p.updated_at WHERE p.id > 0';
const showName = (r) => (String(r.common_name || '') !== '' ? String(r.common_name) : String(r.project_name || ''));
//  defOf: 열 수와 FK 수만(v16, v17 의 검증과 그 시험이 쓰는 모양). defShape: 거기에 기본 키 열 수, CHECK 이름, FK 대상과 규칙을 더한 것
//  (흉내 실행기의 표 모양과 v20 검증). defOf 의 모양을 넓히지 않는 이유: 다른 시험이 그 값을 { cols, fks } 로 통째 대조한다.
export function defOf(createSql) {
  const { cols, fks } = defShape(createSql);
  return { cols, fks };
}
export function defShape(createSql) {
  const open = createSql.indexOf('(');
  const close = createSql.lastIndexOf(') ENGINE=');
  if (open < 0 || close < open) throw new Error(`표 정의를 읽지 못했다: ${createSql.slice(0, 80)}`);
  const body = createSql.slice(open + 1, close);
  //  v20: 기본 키 열 수, CHECK 이름, FK 의 대상과 규칙(적지 않은 규칙은 MySQL 처럼 NO ACTION 으로 읽힌다).
  //  COMMENT 글자 안을 잘못 읽지 않게 따옴표 안을 비운 뒤 읽는다(조각의 두 겹 따옴표도 같은 식으로 비워진다).
  const bare = body.replace(/'(?:[^']|'')*'/g, "''");
  const pk = /PRIMARY KEY\s*\(([^)]*)\)/i.exec(bare);
  const checks = [...bare.matchAll(/CONSTRAINT\s+(\w+)\s+CHECK\b/gi)].map((m) => m[1]);
  const RULE = '(CASCADE|RESTRICT|SET NULL|NO ACTION)';
  const refs = [...bare.matchAll(new RegExp(`REFERENCES\\s+(\\w+)\\s*\\([^)]*\\)((?:\\s+ON\\s+(?:DELETE|UPDATE)\\s+${RULE})*)`, 'gi'))]
    .map((m) => {
      const rule = (w) => ((new RegExp(`ON\\s+${w}\\s+${RULE}`, 'i').exec(m[2]) || [])[1] || 'NO ACTION').toUpperCase();
      return `${m[1]}:${rule('DELETE')}:${rule('UPDATE')}`;
    });
  //  v20(과제 일정 반복): 열 목록. 형은 information_schema.COLUMNS.COLUMN_TYPE 처럼 ENUM 은 값까지(enum('weekly','monthly')), 나머지는 첫 낱말.
  const list = body.split('\n').filter((l) => COL_LINE.test(l)).map((l) => {
    const x = /^\s*([a-z_][a-z0-9_]*)\s+(ENUM\([^)]*\)|\w+)/i.exec(l);
    const noCmt = l.replace(/COMMENT\s+'(?:[^']|'')*'/i, '');
    return { name: x[1], type: x[2].toLowerCase(), nullable: !/\bNOT NULL\b/i.test(noCmt) };
  });
  return {
    cols: list.length, fks: (body.match(/\bFOREIGN KEY\b/g) || []).length,
    pk: pk ? pk[1].split(',').length : 0, checks, refs, list,
  };
}

// ── Git, SVN 삭제(v18): 지울 칸과 CHECK, 그리고 CHECK 가 쓰는 칸 ──────────────────
//  이름은 '표.칸', '표.CHECK' 다. 정본 schema-calendar.sql 17 의 모양이다(18 에서는 모두 없다).
export const VCS_COLS = ['cal_entry.source', 'cal_category.uses_repo', 'cal_user_pref.git_author', 'cal_user_pref.svn_author', 'cal_user_pref.git_commit_body'];
export const VCS_CHECKS = ['cal_entry.chk_cal_entry_source', 'cal_entry.chk_cal_entry_git', 'cal_category.chk_cal_category_usesrepo01', 'cal_user_pref.chk_cal_user_pref_commit_body'];
const VCS_CHECK_USES = {
  chk_cal_entry_source: ['source'], chk_cal_entry_git: ['source', 'end_date', 'recur_freq'],
  chk_cal_category_usesrepo01: ['uses_repo'], chk_cal_user_pref_commit_body: ['git_commit_body'],
};
const VCS_TABLES = ['cal_entry', 'cal_category', 'cal_user_pref'];
export const PREF_COMMENT_V17 = '사용자당 1행 설정 — 커밋 수집 작성자(git/svn) + 보고서 서식. PK=(user_id). 삭제 경로 없음.';
export const PREF_COMMENT_V18 = '사용자당 1행 설정(보고서 서식). PK=(user_id). 삭제 경로 없음.';
export const VCS_V17 = () => ({ cols: [...VCS_COLS], checks: [...VCS_CHECKS], prefComment: PREF_COMMENT_V17 });
export const VCS_V18 = () => ({ cols: [], checks: [], prefComment: PREF_COMMENT_V18 });
const listNames = (one, list) => (one !== undefined ? [one] : [...list.matchAll(/'(\w+)'/g)].map((x) => x[1]));
//  일정 표 셋의 행을 한 줄 글자로(상태 비교용). cal_entry 의 source 는 칸이 있을 때만 행에 있다.
const ROW_KEY = {
  cal_entry: (r) => `${r.user_id}:${r.entry_no}` + ('source' in r ? `:${r.source}` : ''),
  cal_entry_except: (r) => `${r.user_id}:${r.entry_no}:${r.d}`,
  cal_entry_commit: (r) => `${r.user_id}:${r.entry_no}:${r.seq}`,
  //  과제: 번호, 구분, 보임. sort_no 는 칸이 있을 때만 행에 있다(없으면 '-' 도 붙이지 않는다).
  project: (r) => `${r.id}:${r.section_id}:${r.is_active}` + ('sort_no' in r ? `:${r.sort_no === null ? 'NULL' : r.sort_no}` : ''),
  //  주간보고: 주인, 기간 시작. meeting 은 칸이 있을 때만 행에 있다.
  cal_report_weekly: (r) => `${r.user_id}:${r.period_start}` + ('meeting' in r ? `:${r.meeting === null ? 'NULL' : r.meeting}` : ''),
};

// ── 일간보고 과제별 줄(v22 조각 migrations/v22-report-hours.sql, docs/DB-V22-REPORT-HOURS.md) ─────────
//  세 표(cal_report_hours, cal_report_daily, cal_report_weekly_hours)의 열(이름, COLUMN_TYPE, NULL 허용, 콜레이션),
//  색인(이름 → 칸 순서), FK(이름 → 칸, 대상과 규칙), CHECK(이름 → MySQL 이 보여 주는 CHECK_CLAUSE 글), 표 설명, 행을 rh 옵션으로 둔다.
//  지울 표 셋(cal_task_hours, cal_migration_log, cal_user_pref)은 rh.old 이름 목록이다(hasTable 이 함께 본다).
//  ALTER 의 MySQL 규칙을 흉내 낸다: FK 가 받침으로 쓰는 색인은 못 지운다(1553), FK 가 쓰는 칸은 못 지운다(1828),
//  색인에 든 칸을 지우면 색인이 남은 칸으로 줄어든다(오류 없음), 없는 것을 지우면 1091 이나 3821, 있는 것을 더하면 1060, 1061, 3822.
const RH_AI = 'utf8mb4_0900_ai_ci', RH_BIN = 'utf8mb4_bin';
const rc = (name, type, nullable = false, coll = null) => ({ name, type, nullable, coll });
export const CLAUSE_GT0 = '((`hours` > 0) and (`hours` <= 24))';
export const CLAUSE_GE0 = '((`hours` >= 0) and (`hours` <= 24))';
export const CRH_COMMENT_V21 = '(구조 21 의 표 설명)';   // 옛 글자는 검증이 보지 않는다(새 글자와 다르기만 하면 된다)
export const CRH_COMMENT_V22 = '근태 일간보고 과제별 줄. 주간 불러오기, 이전 보고, 공수 집계, 공식 과제 이관의 원천';
export const RH_OLD_TABLES = ['cal_migration_log', 'cal_task_hours', 'cal_user_pref'];
//  21 까지의 모양(정본 schema-calendar.sql 21). 일간 줄 셋(옛 줄, v22 가 지운다). 주간 줄과 개인 과제는 시험이 rh 로 준다.
export const RH_V21 = () => ({
  crh: {
    cols: [rc('user_id', 'smallint unsigned'), rc('work_date', 'date'), rc('line_no', 'smallint unsigned'), rc('task_name', 'varchar(200)', false, RH_AI),
      rc('cat_no', 'int unsigned', true), rc('hours', 'decimal(4,2)')],
    idx: { PRIMARY: ['user_id', 'work_date', 'line_no'], idx_crh_cat: ['user_id', 'cat_no', 'work_date'] },
    fks: { fk_crh_daily: { cols: ['user_id', 'work_date'], ref: 'cal_report_daily:CASCADE:CASCADE' }, fk_crh_cat: { cols: ['user_id', 'cat_no'], ref: 'cal_category:RESTRICT:RESTRICT' } },
    checks: { chk_crh_hours: CLAUSE_GT0 }, comment: CRH_COMMENT_V21, rows: 3,
  },
  crd: { cols: [rc('user_id', 'smallint unsigned'), rc('work_date', 'date'), rc('status', 'varchar(2)', false, RH_BIN), rc('overtime', 'tinyint'),
    rc('content', 'mediumtext', false, RH_AI), rc('sent_at', 'datetime(3)'), rc('created_at', 'datetime(3)'), rc('updated_at', 'datetime(3)')] },
  crwh: {
    cols: [rc('user_id', 'smallint unsigned'), rc('period_start', 'date'), rc('line_no', 'smallint unsigned'), rc('task_name', 'varchar(200)', false, RH_AI),
      rc('project_uid', 'char(36)', true, RH_AI), rc('hours', 'decimal(5,2)')],
    idx: { PRIMARY: ['user_id', 'period_start', 'line_no'], ix_crwh_project: ['project_uid', 'period_start'] },
    rows: [],
  },
  cats: [],
  projectUidColl: RH_AI,
  old: [...RH_OLD_TABLES],
});
//  22 의 모양(정본 schema-calendar.sql 22). 시험이 정본에서 읽은 열, 색인, FK, CHECK, 표 설명과 대조한다.
export const RH_V22 = () => {
  const r = RH_V21();
  r.crh.cols = [rc('user_id', 'smallint unsigned'), rc('work_date', 'date'), rc('line_no', 'smallint unsigned'), rc('task_name', 'varchar(200)', false, RH_AI),
    rc('cat_uid', 'varchar(80)', true, RH_BIN), rc('project_uid', 'char(36)', true, RH_AI), rc('hours', 'decimal(4,2)'), rc('body', 'mediumtext', true, RH_AI)];
  r.crh.idx = { PRIMARY: ['user_id', 'work_date', 'line_no'], ix_crh_project: ['project_uid', 'work_date'], ix_crh_cat: ['user_id', 'cat_uid'] };
  r.crh.fks = { fk_crh_daily: { cols: ['user_id', 'work_date'], ref: 'cal_report_daily:CASCADE:CASCADE' } };
  r.crh.checks = { chk_crh_hours: CLAUSE_GE0 };
  r.crh.comment = CRH_COMMENT_V22;
  r.crh.rows = 0;
  r.crd.cols.splice(r.crd.cols.findIndex((c) => c.name === 'content') + 1, 0, rc('memo', 'mediumtext', true, RH_AI));
  r.crwh.cols.splice(r.crwh.cols.findIndex((c) => c.name === 'task_name') + 1, 0, rc('cat_uid', 'varchar(80)', true, RH_BIN));
  r.crwh.idx = { ...r.crwh.idx, ix_crwh_cat: ['user_id', 'cat_uid'] };
  r.old = [];
  return r;
};
//  v22 의 표 키(조각의 표 이름 → rh 의 칸)
const RH_KEY = { cal_report_hours: 'crh', cal_report_daily: 'crd', cal_report_weekly_hours: 'crwh' };
const RH_TABLES = '(cal_report_hours|cal_report_daily|cal_report_weekly_hours)';
//  v22 가 PREPARE 로 실행하는 데이터 문장과 검증 하위 질의(공백 하나로 접은 글자). 조각이 바뀌면 여기도 함께 바꾼다(다르면 모르는 문장).
export const V22_FILL_DB = "UPDATE cal_report_weekly_hours SET cat_uid = CONCAT('db-', project_uid) WHERE user_id > 0 AND cat_uid IS NULL AND project_uid IS NOT NULL";
export const V22_FILL_LOCAL = "UPDATE cal_report_weekly_hours h JOIN (SELECT user_id, name COLLATE utf8mb4_bin AS nm, MIN(uid) AS uid FROM cal_category WHERE source = 'local' GROUP BY user_id, nm HAVING COUNT(*) = 1) c "
  + 'ON c.user_id = h.user_id AND c.nm = h.task_name COLLATE utf8mb4_bin SET h.cat_uid = c.uid WHERE h.user_id > 0 AND h.cat_uid IS NULL AND h.project_uid IS NULL';
const V22_HNEW = "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_hours' AND IS_NULLABLE = 'YES' "
  + "AND ((COLUMN_NAME = 'cat_uid' AND COLUMN_TYPE = 'varchar(80)' AND COLLATION_NAME = 'utf8mb4_bin') "
  + "OR (COLUMN_NAME = 'project_uid' AND COLUMN_TYPE = 'char(36)' AND COLLATION_NAME = (SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project' AND COLUMN_NAME = 'uid')) "
  + "OR (COLUMN_NAME = 'body' AND COLUMN_TYPE = 'mediumtext'))";
const V22_WNEW = "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly_hours' AND IS_NULLABLE = 'YES' "
  + "AND COLUMN_NAME = 'cat_uid' AND COLUMN_TYPE = 'varchar(80)' AND COLLATION_NAME = 'utf8mb4_bin'";
//  ADD COLUMN 의 형 글자 → COLUMN_TYPE 과 콜레이션
const RH_TYPES = {
  'VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin': ['varchar(80)', RH_BIN],
  'CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci': ['char(36)', RH_AI],
  'MEDIUMTEXT': ['mediumtext', RH_AI],
};
//  LIKE '%x%' 하나(이 조각이 쓰는 모양만)
const likeAll = (v, pats) => pats.every((p) => String(v).includes(p.replace(/^%|%$/g, '')));
//  상태 비교용 글자(색인과 FK 는 이름 순서와 상관없게)
const rhState = (rh) => JSON.stringify({
  ...rh,
  crh: { ...rh.crh, idx: sortKeys(rh.crh.idx), fks: sortKeys(rh.crh.fks), checks: sortKeys(rh.crh.checks) },
  crwh: { ...rh.crwh, idx: sortKeys(rh.crwh.idx) },
  old: [...rh.old].sort(),
});
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

// ── 흉내 DB ────────────────────────────────────────────────────────────
//  meta: { 키: 값 } (cal_schema_meta). 실행 기록(writes)과 updated_at 흉내(시각 카운터)를 남긴다.
//  tables: { cal_room: [{ user_id, name }], room_code: [{ name, sort_order }] } 처럼 있는 표만 준다(없는 키 = 없는 표).
//  표 바꾸기도 writes 에 'table:<이름>' 으로 남긴다(다시 돌렸을 때 바뀐 것이 없는지 보려고).
export class FakeDb {
  constructor(meta, { tableExists = true, schema = 'taskcalendar', tables = {}, defs = {}, project = PROJECT_V16(), vcs = VCS_V17(), codes = CODES_V18(), weekly = WEEKLY_V19(), rh = RH_V21() } = {}) {
    this.rows = new Map(Object.entries(meta).map(([k, v]) => [k, { v, at: 0 }]));
    this.tables = Object.fromEntries(Object.entries(tables).map(([n, rs]) => [n, rs.map((r) => ({ ...r }))]));
    this.defs = Object.fromEntries(Object.entries(defs).map(([n, d]) => [n, { ...d }]));   // 표 이름 → { cols, fks }(v16 검증용)
    this.project = { cols: [...project.cols], checks: [...project.checks] };                  // project 표 모양(v17 검증용)
    this.vcs = { cols: [...vcs.cols], checks: [...vcs.checks], prefComment: vcs.prefComment };  // 지울 칸, CHECK, 표 설명(v18 검증용)
    this.codes = { ...codes };                                                                   // 코드표 표 설명(v19 검증용)
    this.weekly = { cols: [...weekly.cols] };
    this.rh = JSON.parse(JSON.stringify(rh));                                                     // 일간 과제별 줄 표 셋과 지울 표(v22 검증용)                                                    // cal_report_weekly 모양(v20 검증용)
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
  state() { return { ...this.meta(), '#tables': JSON.stringify(this.tableShape()), '#project': JSON.stringify(this.project), '#vcs': JSON.stringify(this.vcs), '#codes': JSON.stringify(this.codes), '#weekly': JSON.stringify(this.weekly), '#rh': rhState(this.rh) }; }
  projectHasCol(c) { return this.project.cols.some((x) => colOf(x).name === c); }
  //  열 모양을 흉내 내는 표의 열 목록(project, cal_report_weekly)
  shapeCols(t) { return this[COL_SHAPED[t]].cols; }
  tableShape() {
    const out = {};
    for (const n of Object.keys(this.tables).sort()) {
      out[n] = n === 'room_code'
        ? this.tables[n].map((r) => [r.name, r.sort_order]).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
        : ROW_KEY[n] ? this.tables[n].map(ROW_KEY[n]).sort()
        : this.defs[n] ? [`cols=${this.defs[n].cols}`, `fks=${this.defs[n].fks}`,
          ...(this.defs[n].pk === undefined ? [] : [`pk=${this.defs[n].pk}`, `checks=${this.defs[n].checks}`, `refs=${this.defs[n].refs}`])]
          : this.tables[n].map((r) => `${r.user_id}:${r.name}`).sort();
    }
    return out;
  }
  hasCol(t, c) { return this.vcs.cols.includes(`${t}.${c}`); }
  hasTable(n) { return n === 'cal_schema_meta' ? this.tableExists : Object.prototype.hasOwnProperty.call(this.tables, n) || this.rh.old.includes(n) || n === 'cal_report_hours' || n === 'cal_report_daily'; }   // v22: 일간 두 표는 rh 가 늘 갖고 있다(구조 6 부터 있다)
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
    //  v22: 일간 과제별 줄, 일간보고, 주간 줄 표(rh). 이름, 형, 콜레이션, 색인, FK, CHECK, 표 설명.
    if (s === V22_HNEW) {
      const t = this.rhT('cal_report_hours');
      return t.cols.filter((c) => c.nullable && ((c.name === 'cat_uid' && c.type === 'varchar(80)' && c.coll === RH_BIN)
        || (c.name === 'project_uid' && c.type === 'char(36)' && c.coll === this.rh.projectUidColl) || (c.name === 'body' && c.type === 'mediumtext'))).length;
    }
    if (s === V22_WNEW) return this.rhT('cal_report_weekly_hours').cols.filter((c) => c.nullable && c.name === 'cat_uid' && c.type === 'varchar(80)' && c.coll === RH_BIN).length;
    m = new RegExp(`^SELECT COUNT\\(\\*\\) FROM information_schema\\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\\(\\) AND TABLE_NAME = '${RH_TABLES}' AND COLUMN_NAME = '(\\w+)'(?: AND COLUMN_TYPE = '([\\w() ,]+)' AND IS_NULLABLE = '(YES|NO)')?$`).exec(s);
    if (m) {
      const c = this.rhT(m[1]).cols.find((x) => x.name === m[2]);
      if (!c) return 0;
      return m[3] === undefined ? 1 : (c.type === m[3] && c.nullable === (m[4] === 'YES') ? 1 : 0);
    }
    m = new RegExp(`^SELECT COUNT\\(\\*\\) FROM information_schema\\.COLUMNS a JOIN information_schema\\.COLUMNS b ON b\\.TABLE_SCHEMA = a\\.TABLE_SCHEMA AND b\\.TABLE_NAME = a\\.TABLE_NAME AND b\\.ORDINAL_POSITION = a\\.ORDINAL_POSITION \\+ 1 WHERE a\\.TABLE_SCHEMA = DATABASE\\(\\) AND a\\.TABLE_NAME = '${RH_TABLES}' AND a\\.COLUMN_NAME = '(\\w+)' AND b\\.COLUMN_NAME = '(\\w+)'$`).exec(s);
    if (m) {
      const names = this.rhT(m[1]).cols.map((c) => c.name);
      const i = names.indexOf(m[2]);
      return i >= 0 && names[i + 1] === m[3] ? 1 : 0;
    }
    m = new RegExp(`^SELECT GROUP_CONCAT\\(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ','\\) FROM information_schema\\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\\(\\) AND TABLE_NAME = '${RH_TABLES}'$`).exec(s);
    if (m) return this.rhT(m[1]).cols.map((c) => c.name).join(',');
    m = new RegExp(`^SELECT COUNT\\(\\*\\) FROM information_schema\\.STATISTICS WHERE TABLE_SCHEMA = DATABASE\\(\\) AND TABLE_NAME = '${RH_TABLES}' AND INDEX_NAME = '(\\w+)'$`).exec(s);
    if (m) { const ix = this.rhIdx(m[1])[m[2]]; return ix ? ix.length : 0; }
    m = new RegExp(`^SELECT GROUP_CONCAT\\(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ','\\) FROM information_schema\\.STATISTICS WHERE TABLE_SCHEMA = DATABASE\\(\\) AND TABLE_NAME = '${RH_TABLES}' AND INDEX_NAME = '(\\w+)'$`).exec(s);
    if (m) { const ix = this.rhIdx(m[1])[m[2]]; return ix ? ix.join(',') : null; }
    m = new RegExp(`^SELECT COUNT\\(DISTINCT INDEX_NAME\\) FROM information_schema\\.STATISTICS WHERE TABLE_SCHEMA = DATABASE\\(\\) AND TABLE_NAME = '${RH_TABLES}'$`).exec(s);
    if (m) return Object.keys(this.rhIdx(m[1])).length;
    m = /^SELECT COUNT\(\*\) FROM information_schema\.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'cal_report_hours' AND CONSTRAINT_NAME = '(\w+)' AND CONSTRAINT_TYPE = '(FOREIGN KEY|CHECK)'$/.exec(s);
    if (m) { const t = this.rhT('cal_report_hours'); return (m[2] === 'CHECK' ? t.checks : t.fks)[m[1]] === undefined ? 0 : 1; }
    m = /^SELECT COUNT\(\*\) FROM information_schema\.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE\(\) AND CONSTRAINT_NAME = 'chk_crh_hours'((?: AND CHECK_CLAUSE LIKE '[^']*')+)$/.exec(s);
    if (m) {
      const cl = this.rhT('cal_report_hours').checks.chk_crh_hours;
      return cl === undefined ? 0 : (likeAll(cl, [...m[1].matchAll(/LIKE '([^']*)'/g)].map((x) => x[1])) ? 1 : 0);
    }
    m = /^SELECT COUNT\(\*\) FROM information_schema\.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'cal_report_hours'(?: AND CONSTRAINT_NAME = '(\w+)' AND REFERENCED_TABLE_NAME = '(\w+)' AND DELETE_RULE = '([A-Z ]+)' AND UPDATE_RULE = '([A-Z ]+)')?$/.exec(s);
    if (m) {
      const fks = this.rhT('cal_report_hours').fks;
      if (m[1] === undefined) return Object.keys(fks).length;
      return fks[m[1]] && fks[m[1]].ref === `${m[2]}:${m[3]}:${m[4]}` ? 1 : 0;
    }
    m = /^SELECT COUNT\(\*\) FROM information_schema\.TABLES WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'cal_report_hours' AND TABLE_COMMENT = '((?:[^']|'')*)'$/.exec(s);
    if (m) return this.rhT('cal_report_hours').comment === m[1].replace(/''/g, "'") ? 1 : 0;
    m = /^SELECT COUNT\(\*\) FROM information_schema\.(COLUMNS|REFERENTIAL_CONSTRAINTS) WHERE (?:TABLE_SCHEMA|CONSTRAINT_SCHEMA) = DATABASE\(\) AND TABLE_NAME = '(\w+)'$/i.exec(s);
    if (m) {
      if (!this.schema || !this.hasTable(m[2])) return 0;
      const d = this.defs[m[2]];
      if (!d) throw new Error(`모양을 모르는 표를 센다(defs 에 ${m[2]} 가 없다)`);
      return m[1].toUpperCase() === 'COLUMNS' ? d.cols : d.fks;
    }
    //  v20: 주간 과제투입시간 표의 기본 키 열 수, CHECK 이름, 대상과 규칙을 붙인 FK 수(모양은 defs. 모르면 판정 불가로 실패)
    m = /^SELECT COUNT\(\*\) FROM information_schema\.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = '(cal_report_weekly_hours|cal_project_event_except|cal_project_watch)' AND CONSTRAINT_NAME = 'PRIMARY'$/.exec(s);
    if (m) return this.shapeOf(m[1], 'pk', (d) => d.pk);
    m = /^SELECT COUNT\(\*\) FROM information_schema\.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE\(\) AND TABLE_NAME = '(cal_report_weekly_hours)' AND CONSTRAINT_NAME = '(\w+)' AND CONSTRAINT_TYPE = 'CHECK'$/.exec(s);
    if (m) { const c = m[2]; return this.shapeOf(m[1], 'checks', (d) => d.checks.filter((x) => x === c).length); }
    m = /^SELECT COUNT\(\*\) FROM information_schema\.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE\(\) AND TABLE_NAME = '(cal_report_weekly_hours|cal_project_event_except|cal_project_watch)' AND REFERENCED_TABLE_NAME = '(\w+)' AND DELETE_RULE = '([A-Z ]+)' AND UPDATE_RULE = '([A-Z ]+)'$/.exec(s);
    if (m) { const want = `${m[2]}:${m[3]}:${m[4]}`; return this.shapeOf(m[1], 'refs', (d) => d.refs.filter((x) => x === want).length); }
    //  v20(과제 일정 반복): cal_project_event 의 칸(이름만, 또는 형과 NULL 허용과 기본값 NULL)과 바로 앞 칸 자리. 열 목록은 defs.list.
    m = /^SELECT COUNT\(\*\) FROM information_schema\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = '(cal_project_event)' AND COLUMN_NAME = '(\w+)'(?: AND COLUMN_TYPE = '((?:[^']|'')+)' AND IS_NULLABLE = '(YES|NO)' AND COLUMN_DEFAULT IS NULL)?$/.exec(s);
    if (m) {
      const list = this.pcList(m[1]);
      if (!list) return 0;
      const c = list.find((x) => x.name === m[2]);
      if (!c) return 0;
      if (m[3] === undefined) return 1;
      return c.type === m[3].replace(/''/g, "'") && c.nullable === (m[4] === 'YES') ? 1 : 0;
    }
    m = /^SELECT COUNT\(\*\) FROM information_schema\.COLUMNS a JOIN information_schema\.COLUMNS b ON b\.TABLE_SCHEMA = a\.TABLE_SCHEMA AND b\.TABLE_NAME = a\.TABLE_NAME AND b\.ORDINAL_POSITION = a\.ORDINAL_POSITION \+ 1 WHERE a\.TABLE_SCHEMA = DATABASE\(\) AND a\.TABLE_NAME = '(cal_project_event)' AND a\.COLUMN_NAME = '(\w+)' AND b\.COLUMN_NAME = '(\w+)'$/.exec(s);
    if (m) {
      const list = this.pcList(m[1]);
      if (!list) return 0;
      const i = list.findIndex((x) => x.name === m[2]);
      return i >= 0 && list[i + 1] && list[i + 1].name === m[3] ? 1 : 0;
    }
    //  v18: 일정, 과제, 설정 표의 지울 칸(이름 하나 또는 IN 목록)과 CHECK 이름. 지울 칸 목록에 없는 이름을 물으면 모르는 질의다.
    m = /^SELECT COUNT\(\*\) FROM information_schema\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = '(cal_entry|cal_category|cal_user_pref)' AND COLUMN_NAME (?:= '(\w+)'|IN \(([^)]*)\))$/.exec(s);
    if (m) {
      const names = listNames(m[2], m[3]);
      for (const c of names) if (!VCS_COLS.includes(`${m[1]}.${c}`)) throw new Error(`모르는 칸을 센다: ${m[1]}.${c}`);
      return this.schema ? names.filter((c) => this.hasCol(m[1], c)).length : 0;
    }
    m = /^SELECT COUNT\(\*\) FROM information_schema\.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE\(\) AND TABLE_NAME = '(cal_entry|cal_category|cal_user_pref)' AND CONSTRAINT_NAME (?:= '(\w+)'|IN \(([^)]*)\)) AND CONSTRAINT_TYPE = 'CHECK'$/.exec(s);
    if (m) {
      const names = listNames(m[2], m[3]);
      for (const c of names) if (!VCS_CHECKS.includes(`${m[1]}.${c}`)) throw new Error(`모르는 CHECK 를 센다: ${m[1]}.${c}`);
      return this.schema ? names.filter((c) => this.vcs.checks.includes(`${m[1]}.${c}`)).length : 0;
    }
    //  v17: project 의 칸(이름만, 또는 형과 NULL 허용까지), 바로 앞 칸 자리, CHECK 이름
    //  v17, v19: DATA_TYPE 은 형의 첫 낱말('int'), COLUMN_TYPE 은 형 글자 전체('int unsigned')와 비교한다.
    //  v20: cal_report_weekly 도 같은 모양으로 묻는다.
    m = /^SELECT COUNT\(\*\) FROM information_schema\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = '(project|cal_report_weekly)' AND COLUMN_NAME = '(\w+)'(?: AND (DATA_TYPE|COLUMN_TYPE) = '([\w ]+)' AND IS_NULLABLE = '(YES|NO)')?$/.exec(s);
    if (m) {
      if (!this.schema) return 0;
      const c = this.shapeCols(m[1]).map(colOf).find((x) => x.name === m[2]);
      if (!c) return 0;
      if (m[3] === undefined) return 1;
      const got = m[3] === 'DATA_TYPE' ? c.type.split(' ')[0] : c.type;
      return got === m[4] && c.nullable === (m[5] === 'YES') ? 1 : 0;
    }
    //  v19: 코드표 표 설명(정확히 같은 글자일 때만 1)
    m = /^SELECT COUNT\(\*\) FROM information_schema\.TABLES WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = '(section_code|status_code)' AND TABLE_COMMENT = '((?:[^']|'')*)'$/.exec(s);
    if (m) return this.schema && this.codes[m[1]] === m[2].replace(/''/g, "'") ? 1 : 0;
    m = /^SELECT COUNT\(\*\) FROM information_schema\.COLUMNS a JOIN information_schema\.COLUMNS b ON b\.TABLE_SCHEMA = a\.TABLE_SCHEMA AND b\.TABLE_NAME = a\.TABLE_NAME AND b\.ORDINAL_POSITION = a\.ORDINAL_POSITION \+ 1 WHERE a\.TABLE_SCHEMA = DATABASE\(\) AND a\.TABLE_NAME = '(project|cal_report_weekly)' AND a\.COLUMN_NAME = '(\w+)' AND b\.COLUMN_NAME = '(\w+)'$/.exec(s);
    if (m) {
      if (!this.schema) return 0;
      const names = this.shapeCols(m[1]).map((c) => colOf(c).name);
      const i = names.indexOf(m[2]);
      return i >= 0 && names[i + 1] === m[3] ? 1 : 0;
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
  //  v20(과제 일정 반복): cal_project_event 의 열 목록. 표가 없으면 null. 시험이 손으로 만든 모양(열 목록 없음)은 MySQL 에서라면
  //  다른 모양의 표라 질의 결과를 알 수 없다. 통과로 치지 않고 멈춘다(SqlStop).
  pcList(t) {
    if (!this.schema || !this.hasTable(t)) return null;
    const d = this.defs[t];
    if (!d || !d.list) throw new SqlStop('모양을 모르는 ' + t + '(열 목록 없음)');
    return d.list;
  }
  //  defs 로 모양을 아는 표의 한 가지 값. 표가 없으면 0, 그 값을 모르면 판정 불가로 실패한다(통과가 아니다).
  shapeOf(t, field, f) {
    if (!this.schema || !this.hasTable(t)) return 0;
    const d = this.defs[t];
    if (!d || d[field] === undefined) throw new Error(`모양을 모르는 표를 센다(defs 에 ${t}.${field} 가 없다)`);
    return f(d);
  }
  //  v22: rh 의 표 하나(cal_report_hours, cal_report_daily, cal_report_weekly_hours)
  rhT(t) { return this.rh[RH_KEY[t]]; }
  rhIdx(t) { const x = this.rhT(t); if (!x.idx) throw new Error(`색인을 흉내 내지 않는 표: ${t}`); return x.idx; }
  //  v22 의 ALTER 한 문장(MySQL 의 오류 규칙을 흉내 낸다. 머리말 참조)
  rhAlter(table, rest) {
    const t = this.rhT(table), key = RH_KEY[table];
    const names = () => t.cols.map((c) => c.name);
    let m;
    if ((m = /^DROP FOREIGN KEY (\w+)$/.exec(rest))) {
      if (!t.fks || !t.fks[m[1]]) throw new SqlStop(`1091 FK ${m[1]} 이 없다`);
      delete t.fks[m[1]];
      this.writes.push({ k: `rh:${key}.fk.${m[1]}`, v: 'drop' });
      return;
    }
    if ((m = /^DROP INDEX (\w+)$/.exec(rest))) {
      const idx = this.rhIdx(table);
      if (!idx[m[1]]) throw new SqlStop(`1091 색인 ${m[1]} 이 없다`);
      //  FK 의 칸이 앞머리인 다른 색인이 없으면 이 색인이 그 FK 의 받침이라 못 지운다
      for (const [fk, f] of Object.entries(t.fks || {})) {
        const backs = (cols) => f.cols.every((c, i) => cols[i] === c);
        if (backs(idx[m[1]]) && !Object.entries(idx).some(([n, cols]) => n !== m[1] && backs(cols))) throw new SqlStop(`1553 색인 ${m[1]} 은 FK ${fk} 의 받침이다`);
      }
      delete idx[m[1]];
      this.writes.push({ k: `rh:${key}.idx.${m[1]}`, v: 'drop' });
      return;
    }
    if ((m = /^DROP COLUMN (\w+), ALGORITHM=INSTANT$/.exec(rest))) {
      if (!names().includes(m[1])) throw new SqlStop(`1091 칸 ${table}.${m[1]} 이 없다`);
      for (const [fk, f] of Object.entries(t.fks || {})) if (f.cols.includes(m[1])) throw new SqlStop(`1828 칸 ${m[1]} 은 FK ${fk} 가 쓴다`);
      t.cols = t.cols.filter((c) => c.name !== m[1]);
      //  색인에 든 칸이면 색인이 남은 칸으로 줄어든다(MySQL 은 오류를 내지 않는다). 칸이 하나도 안 남은 색인은 사라진다.
      for (const [n, cols] of Object.entries(t.idx || {})) {
        if (!cols.includes(m[1])) continue;
        const left = cols.filter((c) => c !== m[1]);
        if (left.length) t.idx[n] = left; else delete t.idx[n];
      }
      this.writes.push({ k: `rh:${key}.col.${m[1]}`, v: 'drop' });
      return;
    }
    if ((m = /^DROP CHECK (\w+)$/.exec(rest))) {
      if (!t.checks || t.checks[m[1]] === undefined) throw new SqlStop(`3821 CHECK ${m[1]} 이 없다`);
      delete t.checks[m[1]];
      this.writes.push({ k: `rh:${key}.check.${m[1]}`, v: 'drop' });
      return;
    }
    if ((m = /^ADD CONSTRAINT (\w+) CHECK \((.+)\)$/.exec(rest))) {
      if (t.checks[m[1]] !== undefined) throw new SqlStop(`3822 CHECK ${m[1]} 이 이미 있다`);
      t.checks[m[1]] = m[2] === 'hours >= 0 AND hours <= 24' ? CLAUSE_GE0 : m[2] === 'hours > 0 AND hours <= 24' ? CLAUSE_GT0 : m[2];
      this.writes.push({ k: `rh:${key}.check.${m[1]}`, v: 'add' });
      return;
    }
    if ((m = /^ADD COLUMN (\w+) (.+?) NULL COMMENT '(?:[^']|'')*' AFTER (\w+), ALGORITHM=INSTANT$/.exec(rest))) {
      const ty = RH_TYPES[m[2]];
      if (!ty) throw new Error(`모르는 칸 형: ${m[2]}`);
      if (names().includes(m[1])) throw new SqlStop(`1060 칸 ${m[1]} 이 이미 있다`);
      const at = names().indexOf(m[3]);
      if (at < 0) throw new SqlStop(`1054 칸 ${m[3]} 이 없다`);
      t.cols.splice(at + 1, 0, rc(m[1], ty[0], true, ty[1]));
      if (key === 'crwh') {
        for (const r of t.rows) r[m[1]] = null;
        //  v20 의 표 모양(defs)도 함께 늘린다(열 수와 열 목록. defShape 처럼 형은 첫 낱말)
        const d = this.defs.cal_report_weekly_hours;
        if (d) {
          const list = d.list ? [...d.list] : undefined;
          if (list) list.splice(list.findIndex((x) => x.name === m[3]) + 1, 0, { name: m[1], type: ty[0].replace(/\(.*$/, ''), nullable: true });
          this.defs.cal_report_weekly_hours = { ...d, cols: d.cols + 1, ...(list ? { list } : {}) };
        }
      }
      this.writes.push({ k: `rh:${key}.col.${m[1]}`, v: 'add' });
      return;
    }
    if ((m = /^ADD INDEX (\w+) \(([^)]*)\)$/.exec(rest))) {
      const idx = this.rhIdx(table);
      if (idx[m[1]]) throw new SqlStop(`1061 색인 ${m[1]} 이 이미 있다`);
      const cols = m[2].split(',').map((x) => x.trim());
      for (const c of cols) if (!names().includes(c)) throw new SqlStop(`1072 칸 ${c} 이 없다`);
      idx[m[1]] = cols;
      this.writes.push({ k: `rh:${key}.idx.${m[1]}`, v: 'add' });
      return;
    }
    if ((m = /^COMMENT = '((?:[^']|'')*)'$/.exec(rest))) {
      const v = m[1].replace(/''/g, "'");
      if (t.comment !== v) this.writes.push({ k: `rh:${key}.comment`, v });
      t.comment = v;
      return;
    }
    throw new Error(`모르는 문장: ALTER TABLE ${table} ${rest.slice(0, 100)}`);
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
    if ((m = /^SELECT COUNT\(\*\) INTO (@\w+) FROM cal_entry WHERE source = 'git'$/.exec(q))) {   // v18: 남은 커밋 기록
      const rows = this.need('cal_entry');
      if (!this.hasCol('cal_entry', 'source')) throw new SqlStop('1054 칸 cal_entry.source 가 없다');
      this.vars.set(m[1], rows.filter((r) => r.source === 'git').length);
      return;
    }
    //  v19: 보이는 과제 가운데 번호가 빈 것의 수(검증). 칸이 없으면 MySQL 처럼 1054 로 멈춘다.
    if ((m = /^SELECT COUNT\(\*\) INTO (@\w+) FROM project WHERE is_active = 1 AND sort_no IS NULL$/.exec(q))) {
      const rows = this.need('project');
      if (!this.projectHasCol('sort_no')) throw new SqlStop('1054 칸 project.sort_no 가 없다');
      this.vars.set(m[1], rows.filter((r) => r.is_active === 1 && r.sort_no === null).length);
      return;
    }
    //  v22: 표 이름을 고정해 읽는 행 수(PREPARE 로 @go 일 때만)
    if ((m = /^SELECT COUNT\(\*\) INTO (@\w+) FROM (cal_report_hours|cal_report_weekly_hours)$/.exec(q))) {
      if (m[2] === 'cal_report_weekly_hours') this.need('cal_report_weekly_hours');
      this.vars.set(m[1], m[2] === 'cal_report_hours' ? this.rh.crh.rows : this.rh.crwh.rows.length);
      return;
    }
    if ((m = /^SELECT COUNT\(\*\) INTO (@\w+) FROM ([\s\S]+)$/.exec(q))) {
      const f = ROOM_COUNTS[m[2]];
      if (!f) throw new Error(`모르는 문장: ${q.slice(0, 160)}`);
      this.vars.set(m[1], f(this));
      return;
    }
    if (/^SELECT\b/i.test(s)) return;   // 보여 주기만 하는 SELECT
    if (/^START TRANSACTION$/.test(s)) {
      this.tx = { rows: new Map([...this.rows].map(([k, r]) => [k, { ...r }])), writes: this.writes.length,
        tables: Object.fromEntries(Object.entries(this.tables).map(([n, rs]) => [n, rs.map((r) => ({ ...r }))])), rh: JSON.parse(JSON.stringify(this.rh)) };
      return;
    }
    if (/^COMMIT$/.test(s)) { this.tx = null; this.snap(); return; }
    if ((m = /^CREATE TABLE IF NOT EXISTS (\w+) \(/.exec(q))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      if (!this.hasTable(m[1])) {
        this.tables[m[1]] = [];
        if (SHAPED(m[1])) this.defs[m[1]] = defShape(s);
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
    if ((m = /^ALTER TABLE project ADD COLUMN (\w+) (DATE|INT UNSIGNED) NULL AFTER (\w+), ALGORITHM=INSTANT$/.exec(q))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      const names = this.project.cols.map((c) => colOf(c).name);
      if (names.includes(m[1])) throw new SqlStop(`1060 칸 ${m[1]} 이 이미 있다`);
      const at = names.indexOf(m[3]);
      if (at < 0) throw new SqlStop(`1054 칸 ${m[3]} 이 없다`);
      this.project.cols.splice(at + 1, 0, `${m[1]}:${m[2].toLowerCase()}?`);
      //  v19: 과제 행은 sort_no 만 흉내 낸다(새 칸은 NULL 로 생긴다).
      if (m[1] === 'sort_no' && this.hasTable('project')) for (const r of this.tables.project) r.sort_no = null;
      this.writes.push({ k: `col:project.${m[1]}`, v: 'add' });
      return;
    }
    //  v20: cal_report_weekly 에 칸 하나(AFTER). 이미 있으면 MySQL 처럼 1060 으로 멈춘다. 있는 행은 새 칸이 NULL 로 생긴다(값 채우기 없음).
    if ((m = /^ALTER TABLE cal_report_weekly ADD COLUMN (\w+) (MEDIUMTEXT) NULL AFTER (\w+), ALGORITHM=INSTANT$/.exec(q))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      const names = this.weekly.cols.map((c) => colOf(c).name);
      if (names.includes(m[1])) throw new SqlStop(`1060 칸 ${m[1]} 이 이미 있다`);
      const at = names.indexOf(m[3]);
      if (at < 0) throw new SqlStop(`1054 칸 ${m[3]} 이 없다`);
      this.weekly.cols.splice(at + 1, 0, `${m[1]}:${m[2].toLowerCase()}?`);
      if (this.hasTable('cal_report_weekly')) for (const r of this.tables.cal_report_weekly) r[m[1]] = null;
      this.writes.push({ k: `col:cal_report_weekly.${m[1]}`, v: 'add' });
      return;
    }
    //  v20(과제 일정 반복): cal_project_event 에 칸 하나(AFTER). 모양은 defs(열 수와 열 목록)로 흉내 낸다. 이미 있으면 1060.
    //  defs 객체는 시험의 상수와 같은 것일 수 있어 고치지 않고 새 객체로 바꾼다.
    if ((m = /^ALTER TABLE cal_project_event ADD COLUMN (\w+) (ENUM\([^)]*\)) NULL DEFAULT NULL COMMENT '(?:[^']|'')*' AFTER (\w+), ALGORITHM=INSTANT$/.exec(q))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      this.need('cal_project_event');
      const d = this.defs.cal_project_event;
      if (!d || !d.list) throw new Error('모양을 모르는 표를 바꾼다(defs 에 cal_project_event.list 가 없다)');
      const names = d.list.map((c) => c.name);
      if (names.includes(m[1])) throw new SqlStop('1060 칸 ' + m[1] + ' 이 이미 있다');
      const at = names.indexOf(m[3]);
      if (at < 0) throw new SqlStop('1054 칸 ' + m[3] + ' 이 없다');
      const list = [...d.list];
      list.splice(at + 1, 0, { name: m[1], type: m[2].toLowerCase(), nullable: true });
      this.defs.cal_project_event = { ...d, cols: d.cols + 1, list };
      this.writes.push({ k: 'col:cal_project_event.' + m[1], v: 'add' });
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
    //  v22: 일간 옛 줄 지우기(행 수만 흉내 낸다. 줄은 모두 user_id > 0 이다)
    if (q === 'DELETE FROM cal_report_hours WHERE user_id > 0') {
      this.mutating(s, opts);
      const n = this.rh.crh.rows;
      this.rh.crh.rows = 0;
      this.rowCount = n;
      if (n) this.writes.push({ k: 'rh:crh.rows', v: `-${n}` });
      return;
    }
    //  v22: 주간 줄 과제 id 채우기 두 문장(V22_FILL_DB, V22_FILL_LOCAL 과 글자까지 같아야 한다)
    if (q === V22_FILL_DB || q === V22_FILL_LOCAL) {
      this.mutating(s, opts);
      this.need('cal_report_weekly_hours');
      if (!this.rh.crwh.cols.some((c) => c.name === 'cat_uid')) throw new SqlStop('1054 칸 cal_report_weekly_hours.cat_uid 가 없다');
      let n = 0;
      if (q === V22_FILL_DB) {
        for (const r of this.rh.crwh.rows) if (r.user_id > 0 && r.cat_uid === null && r.project_uid !== null) { r.cat_uid = 'db-' + r.project_uid; n++; }
      } else {
        const groups = new Map();   // 사람 + 이름(_bin: 글자 그대로) → uid 목록
        for (const c of this.rh.cats) {
          if (c.source !== 'local') continue;
          const k = `${c.user_id}\u0000${c.name}`;
          groups.set(k, [...(groups.get(k) || []), c.uid]);
        }
        for (const r of this.rh.crwh.rows) {
          if (!(r.user_id > 0 && r.cat_uid === null && r.project_uid === null)) continue;
          const g = groups.get(`${r.user_id}\u0000${r.task_name}`);
          if (g && g.length === 1) { r.cat_uid = g[0]; n++; }
        }
      }
      this.rowCount = n;
      if (n) this.writes.push({ k: q === V22_FILL_DB ? 'rh:crwh.fill.db' : 'rh:crwh.fill.local', v: `+${n}` });
      return;
    }
    if ((m = /^DROP TABLE IF EXISTS (cal_task_hours|cal_migration_log|cal_user_pref)$/.exec(q))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      if (this.rh.old.includes(m[1])) { this.rh.old = this.rh.old.filter((x) => x !== m[1]); this.writes.push({ k: `rh:drop.${m[1]}`, v: 'drop' }); }
      return;
    }
    if ((m = new RegExp(`^ALTER TABLE ${RH_TABLES} (.+)$`).exec(q))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      this.rhAlter(m[1], m[2]);
      return;
    }
    //  v20 3-2: 옛 주간보고 기록 모두 지우기. FK CASCADE 로 주간 시간 표의 줄도(행을 흉내 내는 경우) 함께 지운다.
    if (q === 'DELETE FROM cal_report_weekly WHERE user_id > 0') {
      this.mutating(s, opts);
      const rows = this.need('cal_report_weekly');
      this.tables.cal_report_weekly = [];
      if (Array.isArray(this.tables.cal_report_weekly_hours)) this.tables.cal_report_weekly_hours = [];
      this.rh.crwh.rows = [];   // v22 가 보는 주간 줄도 CASCADE 로 함께 지워진다
      this.rowCount = rows.length;
      if (rows.length) this.writes.push({ k: 'table:cal_report_weekly', v: `-${rows.length}` });
      return;
    }
    //  v18: 커밋 기록 지우기. FK CASCADE 로 예외일과 커밋 목록(표가 남아 있으면)도 함께 지운다.
    if (q === "DELETE FROM cal_entry WHERE user_id > 0 AND source = 'git'") {
      this.mutating(s, opts);
      const rows = this.need('cal_entry');
      if (!this.hasCol('cal_entry', 'source')) throw new SqlStop('1054 칸 cal_entry.source 가 없다');
      const gone = rows.filter((r) => r.user_id > 0 && r.source === 'git');
      const isGone = (x) => gone.some((r) => r.user_id === x.user_id && r.entry_no === x.entry_no);
      this.tables.cal_entry = rows.filter((r) => !gone.includes(r));
      for (const child of ['cal_entry_except', 'cal_entry_commit'])
        if (this.hasTable(child)) this.tables[child] = this.tables[child].filter((x) => !isGone(x));
      this.rowCount = gone.length;
      if (gone.length) this.writes.push({ k: 'table:cal_entry', v: `-${gone.length}` });
      return;
    }
    if ((m = /^ALTER TABLE (\w+) DROP CHECK (\w+)$/.exec(q))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      if (!VCS_TABLES.includes(m[1])) throw new Error(`모르는 문장: ${q.slice(0, 120)}`);
      this.mutating(s, opts);
      const key = `${m[1]}.${m[2]}`;
      if (!this.vcs.checks.includes(key)) throw new SqlStop(`3821 CHECK ${m[2]} 이 없다`);
      this.vcs.checks = this.vcs.checks.filter((x) => x !== key);
      this.writes.push({ k: `check:${m[2]}`, v: 'drop' });
      return;
    }
    if ((m = /^ALTER TABLE (\w+) DROP COLUMN (\w+), ALGORITHM=INSTANT$/.exec(q))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      if (!VCS_TABLES.includes(m[1])) throw new Error(`모르는 문장: ${q.slice(0, 120)}`);
      this.mutating(s, opts);
      if (!this.hasCol(m[1], m[2])) throw new SqlStop(`1091 칸 ${m[1]}.${m[2]} 이 없다`);
      const user = this.vcs.checks.find((x) => x.startsWith(`${m[1]}.`) && VCS_CHECK_USES[x.slice(m[1].length + 1)].includes(m[2]));
      if (user) throw new SqlStop(`3959 CHECK ${user} 가 칸 ${m[2]} 을 쓴다`);
      this.vcs.cols = this.vcs.cols.filter((x) => x !== `${m[1]}.${m[2]}`);
      if (m[1] === 'cal_entry' && this.hasTable('cal_entry')) for (const r of this.tables.cal_entry) delete r[m[2]];
      this.writes.push({ k: `col:${m[1]}.${m[2]}`, v: 'drop' });
      return;
    }
    if ((m = /^ALTER TABLE cal_user_pref COMMENT = '((?:[^']|'')*)'$/.exec(s))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      this.vcs.prefComment = m[1].replace(/''/g, "'");
      return;
    }
    //  v19: 코드표 표 설명(메타데이터만)
    if ((m = /^ALTER TABLE (section_code|status_code) COMMENT = '((?:[^']|'')*)'$/.exec(s))) {
      if (this.tx) throw new Error('트랜잭션 안의 DDL(자동 확정된다)');
      this.mutating(s, opts);
      const v = m[2].replace(/''/g, "'");
      if (this.codes[m[1]] !== v) this.writes.push({ k: `comment:${m[1]}`, v });
      this.codes[m[1]] = v;
      return;
    }
    //  v19: 순서 채우기. 보이는 과제 가운데 번호가 빈 것만, 구분마다 (그 구분의 보이는 과제 최댓값 + 표시 이름 순 자리).
    if (q === V19_FILL) {
      this.mutating(s, opts);
      const rows = this.need('project');
      if (!this.projectHasCol('sort_no')) throw new SqlStop('1054 칸 project.sort_no 가 없다');
      const bySec = new Map();
      for (const r of rows) {
        if (r.is_active !== 1 || r.sort_no !== null) continue;
        if (!bySec.has(r.section_id)) bySec.set(r.section_id, []);
        bySec.get(r.section_id).push(r);
      }
      let n = 0;
      for (const [sec, list] of bySec) {
        const mx = Math.max(0, ...rows.filter((r) => r.section_id === sec && r.is_active === 1 && r.sort_no !== null).map((r) => r.sort_no));
        list.sort((a, b) => { const x = fold(showName(a)), y = fold(showName(b)); return x < y ? -1 : x > y ? 1 : a.id - b.id; });
        list.forEach((r, i) => { r.sort_no = mx + i + 1; n++; });
      }
      this.rowCount = n;
      if (n) this.writes.push({ k: 'table:project', v: `sort_no+${n}` });
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
      if (this.tx) { this.rows = this.tx.rows; this.tables = this.tx.tables; this.rh = this.tx.rh; this.writes.length = this.tx.writes; this.tx = null; }
      if (e instanceof SqlStop) return { ok: false, stop: e.stopName };
      if (e instanceof InjectedFault) return { ok: false, fault: e.n };
      throw e;
    }
  }
}
