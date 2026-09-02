// Layer 1 — 재구축 스크립트·마이그레이션의 **정합**을 소스 텍스트만으로 검사한다.
// jsdom도 DB도 필요 없다(`db/deploy/*.sql` 을 읽어 파싱할 뿐).
//
// 왜 있나 (실제 사고)
//   · schema-calendar.sql 의 DROP 블록에 8-31 보고 기록 3표가 빠져 있었다. 재적용하면 옛 표가
//     남은 채 CREATE 가 ERROR 1050 으로 죽는다. 사람이 눈으로 잡았다(c4cf813) — 기계는 못 잡았다.
//   · 이 파일에는 `SET FOREIGN_KEY_CHECKS=0` 이 **없다**. 그래서 DROP/CREATE 의 *순서*가
//     실행 성패를 가른다(자식→부모 로 지우고, 부모→자식 으로 만든다). 알파벳순으로 '정리'하면
//     재적용이 ERROR 3730 으로 죽는다 — 파일 주석이 그렇게 경고하고 있지만, 경고는 기계가 아니다.
//   · migrate-*.sql 8개 중 7개는 어떤 테스트도 참조하지 않았다. schema_version 체인이 끊겨도
//     아무도 몰랐다.
//
// 검사 함수(checks)를 테스트와 변이 주입이 공유한다 — 검사가 실제로 잡는지 증명하기 위해서다
// (이 저장소의 관례. db-conn-info.test.mjs · user-info.test.mjs 와 같은 꼴).
import { test, assert } from './harness.mjs';
import { readFileSync, readdirSync } from 'node:fs';

const DEPLOY = new URL('../db/deploy/', import.meta.url);
const loadSql = (name) => readFileSync(new URL(name, DEPLOY), 'utf8');

const CANON = 'schema-calendar.sql';   // 정본 재구축 스크립트
const canonSql = loadSql(CANON);

// migrate-*.sql 전수(이름순 — 날짜가 이름 앞에 있어 사전순 = 시간순).
const MIGRATE_FILES = readdirSync(DEPLOY)
  .filter((f) => /^migrate-.*\.sql$/i.test(f))
  .sort();

// 파일명 → 원문. 변이 시험은 이 사본을 고쳐 checks 에 넘긴다.
const migrateSrc = new Map(MIGRATE_FILES.map((f) => [f, loadSql(f)]));

// ── schema_version 도입 전 파일(체인 검사 제외) ───────────────────────
// 제외 근거는 '오래돼서'가 아니라 **cal_schema_meta 를 아예 건드리지 않아서**다.
// 아래 checks.migrationChain 이 그 사실을 매번 다시 확인한다 — 나중에 누가 이 파일들에
// 버전 갱신을 넣으면 제외 목록이 거짓이 되고 테스트가 그 자리에서 실패한다.
const PRE_VERSION_FILES = new Map([
  ['migrate-2026-07-24-uniqueness.sql',
   'project 표의 유니크·NOT NULL 조정. cal_* 도 cal_schema_meta 도 아직 없던 시절의 1회용'],
  ['migrate-2026-08-24-user-id.sql',
   'app_user 의 PK 를 login_id→user_id 로. schema-calendar.sql **앞**에 도는 선행 파일이라 cal_schema_meta 가 존재하지 않는다'],
  ['migrate-2026-08-24-org-id.sql',
   'org_unit 의 PK 를 name→org_id 로. 대상이 org_unit/app_user 뿐 — cal_* 를 건드리지 않는다'],
]);

// ── DROP 에만 있어도 되는 표(명시적 허용 목록) ────────────────────────
// 여기 없는 'DROP 만 있고 CREATE 는 없는' 이름은 실패다 — 재생성을 빠뜨린 것과 구분되지 않기 때문.
const DROP_ONLY_ALLOWED = new Map([
  ['cal_audit_trash',
   '폐지(설계 §7.5). 옛 배포분에 남은 실물을 지우기 위해 DROP 만 남기고 재생성하지 않는다'],
]);

// ══ SQL 잡음 마스킹 ═══════════════════════════════════════════════════
// harness 의 skipString/skipLineComment 는 **JS 용**이다(`//` 주석 · 백슬래시 이스케이프).
// SQL 은 `--`/`#` 주석에 `''` 이중따옴표 이스케이프를 쓰고 백틱 식별자가 따로 있어 규칙이 다르다.
// 그래서 여기서는 SQL 전용 스캐너를 쓴다(같은 발상, 다른 문법).
//
// 반환 문자열은 **길이가 원문과 같다**(인덱스가 그대로 통한다).
//   blankStrings=true  → 주석 + 문자열 내용까지 공백. 구조(DROP/CREATE/REFERENCES) 스캔용.
//   blankStrings=false → 주석만 공백. 문자열 '값'(schema_version 숫자)을 읽어야 할 때.
// 백틱 식별자는 내용을 지우지 않는다(표 이름이 백틱으로 감싸일 수 있다). 대신 통째로 건너뛰어
// 그 안의 따옴표·`--` 가 바깥 파싱을 어지럽히지 못하게 한다.
function maskSql(src, blankStrings) {
  const out = src.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  };
  let i = 0;
  const len = src.length;
  while (i < len) {
    const c = src[i];
    // -- 줄 주석 (SQL 표준은 '-- ' 지만 이 저장소는 '--' 뒤 바로 글자도 쓴다)
    if (c === '-' && src[i + 1] === '-') {
      let k = i; while (k < len && src[k] !== '\n') k++;
      blank(i, k); i = k; continue;
    }
    // # 줄 주석 (MySQL)
    if (c === '#') {
      let k = i; while (k < len && src[k] !== '\n') k++;
      blank(i, k); i = k; continue;
    }
    // /* */ 블록 주석
    if (c === '/' && src[i + 1] === '*') {
      let k = i + 2;
      while (k < len && !(src[k] === '*' && src[k + 1] === '/')) k++;
      k = Math.min(len, k + 2);
      blank(i, k); i = k; continue;
    }
    // 백틱 식별자 — 내용 유지, 통째로 건너뛴다
    if (c === '`') {
      let k = i + 1;
      while (k < len && src[k] !== '`') k++;
      i = Math.min(len, k + 1); continue;
    }
    // 문자열 리터럴 — '' 와 \' 둘 다 이스케이프로 인정(MySQL 기본)
    if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < len) {
        if (src[k] === '\\') { k += 2; continue; }
        if (src[k] === c && src[k + 1] === c) { k += 2; continue; }
        if (src[k] === c) { k++; break; }
        k++;
      }
      if (blankStrings) blank(i + 1, k - 1);
      i = k; continue;
    }
    i++;
  }
  return out.join('');
}

const IDENT = '`?([A-Za-z0-9_$]+)`?';

// DROP TABLE 이름을 등장 순서대로.
function dropList(sql) {
  const code = maskSql(sql, true);
  const re = new RegExp('\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?' + IDENT, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(code)) !== null) out.push(m[1]);
  return out;
}

// CREATE TABLE 이름을 등장 순서대로 + 각 표의 REFERENCES 대상(=부모).
// 본문은 표 이름 뒤 첫 '(' 부터 괄호 짝이 맞는 지점까지 — 그 밖의 REFERENCES 는 보지 않는다.
function createList(sql) {
  const code = maskSql(sql, true);
  const re = new RegExp('\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?' + IDENT, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(code)) !== null) {
    const name = m[1];
    let i = code.indexOf('(', m.index + m[0].length);
    const parents = [];
    if (i >= 0) {
      let depth = 0, j = i;
      for (; j < code.length; j++) {
        if (code[j] === '(') depth++;
        else if (code[j] === ')') { depth--; if (depth === 0) { j++; break; } }
      }
      const body = code.slice(i, j);
      const rre = new RegExp('\\bREFERENCES\\s+' + IDENT, 'gi');
      let r;
      while ((r = rre.exec(body)) !== null) parents.push(r[1]);
    }
    out.push({ name, parents });
  }
  return out;
}

// ══ 검사 함수 ═════════════════════════════════════════════════════════
const checks = {
  // ① 마스킹이 살아 있는지부터 — 여기서 0이 나오면 아래 검사 전부가 조용히 통과한다.
  parserSane(sql) {
    const drops = dropList(sql);
    const creates = createList(sql);
    assert.ok(drops.length >= 10, `DROP TABLE 파싱 결과가 ${drops.length}건 — 마스커가 깨졌다`);
    assert.ok(creates.length >= 10, `CREATE TABLE 파싱 결과가 ${creates.length}건 — 마스커가 깨졌다`);
    const edges = creates.flatMap((c) => c.parents);
    assert.ok(edges.length >= 10, `REFERENCES 파싱 결과가 ${edges.length}건 — 마스커가 깨졌다`);
  },

  // ② 순서 검사의 전제 — 이 파일에는 FK 검사 해제가 없다.
  noFkCheckEscape(sql) {
    const code = maskSql(sql, true);
    assert.ok(!/FOREIGN_KEY_CHECKS/i.test(code),
      'SET FOREIGN_KEY_CHECKS 가 생겼다 — DROP/CREATE 순서 검사의 전제가 바뀌었다. 이 테스트를 다시 설계할 것');
  },

  // ③ DROP ⊇ CREATE. 만드는 표는 전부 먼저 지운다(재적용 = ERROR 1050 방지).
  dropCoversCreate(sql) {
    const drops = new Set(dropList(sql));
    const creates = createList(sql).map((c) => c.name);
    const missing = creates.filter((n) => !drops.has(n));
    assert.deepStrictEqual(missing, [],
      `CREATE 는 있는데 DROP 이 없다: ${missing.join(', ')} — 재적용 시 ERROR 1050`);
  },

  // ④ DROP 에만 있는 이름은 허용 목록에 사유와 함께 있어야 한다.
  dropOnlyIsAllowed(sql) {
    const creates = new Set(createList(sql).map((c) => c.name));
    const extra = dropList(sql).filter((n) => !creates.has(n) && !DROP_ONLY_ALLOWED.has(n));
    assert.deepStrictEqual(extra, [],
      `DROP 만 있고 CREATE 가 없다: ${extra.join(', ')} — 재생성을 빠뜨린 것인지 의도적 폐지인지 구분되지 않는다. ` +
      '의도적 폐지라면 DROP_ONLY_ALLOWED 에 사유와 함께 적을 것');
  },

  // ⑤ DROP 순서 = 자식 → 부모. (이 파일 밖 표(app_user 등)는 부모로만 등장 — 검사 대상 아님)
  dropOrderChildFirst(sql) {
    const order = dropList(sql);
    const pos = new Map(order.map((n, i) => [n, i]));
    const bad = [];
    for (const { name, parents } of createList(sql)) {
      for (const p of parents) {
        if (p === name) continue;                       // 자기참조는 순서와 무관
        if (!pos.has(name) || !pos.has(p)) continue;    // 이 파일이 지우지 않는 표
        if (pos.get(name) > pos.get(p)) bad.push(`${name}(자식) 이 ${p}(부모) 뒤에 있다`);
      }
    }
    assert.deepStrictEqual(bad, [],
      `DROP 순서 위반 — 부모를 먼저 지우면 ERROR 3730: ${bad.join(' · ')}`);
  },

  // ⑥ CREATE 순서 = 부모 → 자식. FK 대상이 아직 없으면 ERROR 1824/3734.
  createOrderParentFirst(sql) {
    const creates = createList(sql);
    const pos = new Map(creates.map((c, i) => [c.name, i]));
    const bad = [];
    for (const { name, parents } of creates) {
      for (const p of parents) {
        if (p === name) continue;
        if (!pos.has(p)) continue;                      // 이 파일 밖 표(app_user 등)
        if (pos.get(p) > pos.get(name)) bad.push(`${name} 이 부모 ${p} 보다 먼저 만들어진다`);
      }
    }
    assert.deepStrictEqual(bad, [],
      `CREATE 순서 위반 — FK 대상이 아직 없다: ${bad.join(' · ')}`);
  },

  // ⑦ 마이그레이션 체인 — (N→M) 이 끊김·중복 없이 이어지고 마지막이 정본 버전과 같다.
  //    srcMap: 파일명 → 원문 · canon: schema-calendar.sql 원문.
  migrationChain(srcMap, canon) {
    const links = [];
    for (const [file, sql] of srcMap) {
      const pair = versionBump(sql);
      if (PRE_VERSION_FILES.has(file)) {
        // 제외 근거를 매번 다시 확인한다 — '버전을 안 올리는 파일'이라는 주장이 여전히 참인가.
        assert.strictEqual(pair, null,
          `${file} 은 버전 도입 전 파일로 제외돼 있는데 schema_version 을 ${pair && pair.join('→')} 로 올린다. ` +
          'PRE_VERSION_FILES 에서 빼고 체인에 넣을 것');
        continue;
      }
      assert.ok(pair,
        `${file} 에서 schema_version 갱신을 찾지 못했다 — ` +
        "UPDATE cal_schema_meta SET v='M' … WHERE k='schema_version' AND v='N' 형태여야 한다. " +
        '버전을 올리지 않는 파일이면 PRE_VERSION_FILES 에 사유와 함께 적을 것');
      links.push({ file, from: pair[0], to: pair[1] });
    }

    assert.ok(links.length > 0, '체인에 든 마이그레이션이 하나도 없다');

    // 한 칸씩 오르는가(N+1 == M).
    for (const l of links) {
      assert.strictEqual(l.to, l.from + 1,
        `${l.file}: ${l.from}→${l.to} 는 한 칸이 아니다`);
    }
    // 시작점 중복 없음.
    const froms = links.map((l) => l.from);
    const dup = froms.filter((v, i) => froms.indexOf(v) !== i);
    assert.deepStrictEqual(dup, [],
      `같은 버전에서 갈라지는 마이그레이션이 둘 이상이다: v=${dup.join(', ')}`);

    // 끊김 없이 이어지는가.
    const sorted = [...links].sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i++) {
      assert.strictEqual(sorted[i].from, sorted[i - 1].to,
        `체인이 끊겼다: ${sorted[i - 1].file}(→${sorted[i - 1].to}) 다음이 ` +
        `${sorted[i].file}(${sorted[i].from}→) 다 — v=${sorted[i - 1].to} 에서 출발하는 파일이 없다`);
    }

    // 마지막 도착점 = 정본이 새로 심는 값.
    const canonVer = canonSchemaVersion(canon);
    assert.ok(canonVer !== null, `${CANON} 에서 schema_version INSERT 값을 찾지 못했다`);
    const last = sorted[sorted.length - 1];
    assert.strictEqual(last.to, canonVer,
      `체인의 끝(${last.file} → ${last.to})과 ${CANON} 의 정본 값(${canonVer})이 다르다 — ` +
      '기존 DB 를 마이그레이션한 것과 새로 구축한 것의 버전이 어긋난다');

    return sorted;
  },
};

// 변이 시험·수동 재현이 같은 검사를 쓰도록 내보낸다(러너는 test() 등록만 본다).
export { checks, dropList, createList, maskSql, migrateSrc, canonSql };

// UPDATE cal_schema_meta SET v='M' … WHERE k='schema_version' AND v='N' → [N, M]. 없으면 null.
// 문자열 '값'이 필요하므로 주석만 지운 판에서 찾되, 그 자리가 **문자열 안이 아님**을
// 문자열까지 지운 판으로 대조한다(repo-flag.sql 은 안내 문구 안에 같은 낱말을 담고 있다).
function versionBump(sql) {
  const withStr = maskSql(sql, false);
  const noStr = maskSql(sql, true);
  const re = /\bUPDATE\s+`?cal_schema_meta`?\s+SET\s+v\s*=\s*'(\d+)'[\s\S]*?WHERE\s+k\s*=\s*'schema_version'\s+AND\s+v\s*=\s*'(\d+)'/gi;
  let m;
  const found = [];
  while ((m = re.exec(withStr)) !== null) {
    if (!/^UPDATE$/i.test(noStr.substr(m.index, 6))) continue; // 문자열 안의 흉내는 무시
    found.push([Number(m[2]), Number(m[1])]);                  // [N(가드), M(갱신)]
  }
  if (found.length === 0) return null;
  assert.strictEqual(found.length, 1,
    `한 파일에 schema_version 갱신이 ${found.length}건이다 — 한 파일은 한 칸만 올려야 한다`);
  return found[0];
}

// INSERT INTO cal_schema_meta … VALUES ('schema_version', 'X', …) → X. 없으면 null.
function canonSchemaVersion(sql) {
  const withStr = maskSql(sql, false);
  const noStr = maskSql(sql, true);
  const re = /\bINSERT\s+INTO\s+`?cal_schema_meta`?[\s\S]{0,200}?VALUES\s*\(\s*'schema_version'\s*,\s*'(\d+)'/gi;
  let m;
  while ((m = re.exec(withStr)) !== null) {
    if (!/^INSERT$/i.test(noStr.substr(m.index, 6))) continue;
    return Number(m[1]);
  }
  return null;
}

// ══ 테스트 ════════════════════════════════════════════════════════════

test('스키마 가드 ⓪: SQL 마스커가 실제로 파싱한다(0건이면 아래가 전부 거짓 초록)', () =>
  checks.parserSane(canonSql));

test('스키마 가드 ①: DROP 블록이 CREATE 하는 표를 전부 덮는다(재적용 ERROR 1050 방지)', () =>
  checks.dropCoversCreate(canonSql));

test('스키마 가드 ②: DROP 에만 있는 이름은 허용 목록에 사유와 함께 있다', () =>
  checks.dropOnlyIsAllowed(canonSql));

test('스키마 가드 ③: 이 파일에 FOREIGN_KEY_CHECKS 해제가 없다(순서 검사의 전제)', () =>
  checks.noFkCheckEscape(canonSql));

test('스키마 가드 ④: DROP 순서가 자식 → 부모다(ERROR 3730 방지)', () =>
  checks.dropOrderChildFirst(canonSql));

test('스키마 가드 ⑤: CREATE 순서가 부모 → 자식이다(FK 대상 부재 방지)', () =>
  checks.createOrderParentFirst(canonSql));

test('스키마 가드 ⑥: migrate-*.sql 의 schema_version 체인이 끊김·중복 없이 정본까지 닿는다', () => {
  const chain = checks.migrationChain(migrateSrc, canonSql);
  // 사람이 읽는 표 — 실패했을 때 어디가 끊겼는지 바로 보이도록.
  for (const l of chain) console.log(`      ${l.file} : ${l.from} → ${l.to}`);
});

test('스키마 가드 ⑦: 정본의 명부(CREATE)와 DROP 목록이 문서가 아니라 서로를 정본으로 삼는다', () => {
  const creates = createList(canonSql).map((c) => c.name);
  const drops = dropList(canonSql);
  // 이름 중복 금지 — 같은 표를 두 번 만들거나 두 번 지우면 어느 쪽이 정본인지 알 수 없다.
  assert.strictEqual(new Set(creates).size, creates.length, `CREATE 이름 중복: ${creates.join(', ')}`);
  assert.strictEqual(new Set(drops).size, drops.length, `DROP 이름 중복: ${drops.join(', ')}`);
  // DROP 이 CREATE 보다 길다 — 폐지된 표를 더 지우기 때문(파일 주석 §"DROP 목록은 더 길다").
  assert.ok(drops.length >= creates.length,
    `DROP(${drops.length}) 이 CREATE(${creates.length}) 보다 짧다 — 빠뜨린 표가 있다`);
});

test('스키마 가드 ⑧: 모든 cal_* 표 이름이 cal_ 로 시작한다(오타·오분류 조기 발견)', () => {
  const odd = createList(canonSql).map((c) => c.name).filter((n) => !/^cal_/.test(n));
  assert.deepStrictEqual(odd, [], `cal_ 로 시작하지 않는 표: ${odd.join(', ')}`);
});

// ══ 변이 시험 — 검출기가 정말 잡는지 ══════════════════════════════════
// 소스 문자열을 고쳐 넣고 '빨간불이 나는가'를 본다. 이 절이 없으면 위 8건은
// '아무것도 검사하지 않아서 통과하는' 상태와 구분되지 않는다.

// DROP 블록(연속된 DROP TABLE 줄들)의 시작·끝 인덱스.
function dropBlockRange(sql) {
  const first = sql.indexOf('DROP TABLE IF EXISTS');
  assert.ok(first > 0, '변이 준비 실패: DROP 블록을 찾지 못했다');
  let end = first;
  const re = /DROP TABLE IF EXISTS[^\n]*\n/g;
  re.lastIndex = first;
  let m;
  while ((m = re.exec(sql)) !== null && m.index <= end + 2) end = m.index + m[0].length;
  return [first, end];
}

test('변이①: CREATE 를 하나 늘리고 DROP 을 안 하면 dropCoversCreate 가 실패한다', () => {
  const mutated = canonSql + '\nCREATE TABLE cal_brand_new (\n  user_id SMALLINT UNSIGNED NOT NULL\n);\n';
  assert.doesNotThrow(() => checks.dropCoversCreate(canonSql), '원본은 통과해야 한다');
  assert.throws(() => checks.dropCoversCreate(mutated), /cal_brand_new/);
});

test('변이②: DROP 순서를 뒤집으면 dropOrderChildFirst 가 실패한다', () => {
  const [a, b] = dropBlockRange(canonSql);
  const reversed = canonSql.slice(a, b).trimEnd().split('\n').reverse().join('\n') + '\n';
  const mutated = canonSql.slice(0, a) + reversed + canonSql.slice(b);
  assert.doesNotThrow(() => checks.dropOrderChildFirst(canonSql), '원본은 통과해야 한다');
  assert.throws(() => checks.dropOrderChildFirst(mutated), /DROP 순서 위반/);
});

test('변이③: 마이그레이션 체인에 구멍을 내면 migrationChain 이 실패한다', () => {
  // 5→6(report-daily)을 빼면 repo-flag(4→5) 다음이 report-weekly(6→7) 가 되어 v=5 출발이 사라진다.
  const holed = new Map(migrateSrc);
  holed.delete('migrate-2026-08-31-report-daily.sql');
  assert.doesNotThrow(() => checks.migrationChain(migrateSrc, canonSql), '원본은 통과해야 한다');
  assert.throws(() => checks.migrationChain(holed, canonSql), /체인이 끊겼다/);
});

test('변이④: DROP 만 있고 허용 목록에 없는 표가 생기면 dropOnlyIsAllowed 가 실패한다', () => {
  const [, b] = dropBlockRange(canonSql);
  const mutated = canonSql.slice(0, b) + 'DROP TABLE IF EXISTS cal_ghost;\n' + canonSql.slice(b);
  assert.throws(() => checks.dropOnlyIsAllowed(mutated), /cal_ghost/);
});

test('변이⑤: CREATE 를 부모보다 앞으로 옮기면 createOrderParentFirst 가 실패한다', () => {
  // cal_entry(자식) 블록을 통째로 파일 앞쪽(cal_category CREATE 앞)으로 옮긴다.
  const childAt = canonSql.indexOf('CREATE TABLE cal_entry (');
  const parentAt = canonSql.indexOf('CREATE TABLE cal_category (');
  assert.ok(childAt > 0 && parentAt > 0 && parentAt < childAt, '변이 준비 실패: 두 CREATE 를 찾지 못했다');
  const childEnd = canonSql.indexOf('CREATE TABLE cal_entry_except (');
  assert.ok(childEnd > childAt, '변이 준비 실패: cal_entry 블록의 끝을 찾지 못했다');
  const block = canonSql.slice(childAt, childEnd);
  const mutated = canonSql.slice(0, parentAt) + block +
                  canonSql.slice(parentAt, childAt) + canonSql.slice(childEnd);
  assert.throws(() => checks.createOrderParentFirst(mutated), /CREATE 순서 위반/);
});

test('변이⑥: 정본 버전만 올리고 마이그레이션을 안 쓰면 migrationChain 이 실패한다', () => {
  const bumped = canonSql.replace(/('schema_version',\s*)'8'/, "$1'9'");
  assert.notStrictEqual(bumped, canonSql, '변이 준비 실패: 정본 버전 문자열을 찾지 못했다');
  assert.throws(() => checks.migrationChain(migrateSrc, bumped), /정본 값\(9\)/);
});

test('변이⑦: 버전 도입 전 파일이 버전을 올리기 시작하면 제외 목록이 거짓이라고 알린다', () => {
  const lying = new Map(migrateSrc);
  const victim = 'migrate-2026-07-24-uniqueness.sql';
  lying.set(victim, migrateSrc.get(victim) +
    "\nUPDATE cal_schema_meta SET v = '3', updated_at = UTC_TIMESTAMP(3)\n WHERE k = 'schema_version' AND v = '2';\n");
  assert.throws(() => checks.migrationChain(lying, canonSql), /PRE_VERSION_FILES 에서 빼고/);
});

test('변이⑨: 실제로 났던 결함(보고 기록 3표의 DROP 누락, c4cf813)을 재현하면 잡는다', () => {
  // 8-31 에 새로 만든 3표를 DROP 블록에서만 지워 본다 — 사람이 눈으로 잡았던 그 상태다.
  const mutated = canonSql.replace(/^DROP TABLE IF EXISTS cal_report_(hours|daily|weekly);.*\r?\n/gm, '');
  assert.notStrictEqual(mutated, canonSql, '변이 준비 실패: 보고 기록 DROP 줄을 찾지 못했다');
  assert.throws(() => checks.dropCoversCreate(mutated),
    /cal_report_daily|cal_report_hours|cal_report_weekly/);
});

test('변이⑧: 주석·문자열 안의 DDL 을 세면 안 된다(마스커 회귀)', () => {
  const noise = canonSql +
    "\n-- DROP TABLE IF EXISTS cal_comment_only;\n" +
    "SELECT 'CREATE TABLE cal_string_only (x INT)' AS `안내`;\n";
  const drops = dropList(noise);
  const creates = createList(noise).map((c) => c.name);
  assert.ok(!drops.includes('cal_comment_only'), '주석 안의 DROP 을 셌다');
  assert.ok(!creates.includes('cal_string_only'), '문자열 안의 CREATE 를 셌다');
  // 잡음을 넣어도 원래 검사들은 그대로 통과해야 한다.
  assert.doesNotThrow(() => checks.dropCoversCreate(noise));
  assert.doesNotThrow(() => checks.dropOrderChildFirst(noise));
});
