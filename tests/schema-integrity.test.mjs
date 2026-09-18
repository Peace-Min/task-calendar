// 스키마 무결성 계약 게이트 (2026-09-09)
//
// 이 파일이 존재하는 이유:
//   2026-09-09 전면 검수에서 나온 결함 다섯은 전부 **같은 모양**이었다 —
//   "장치 A 는 이렇게 지키자고 하는데 장치 B 가 반대로 하고 있다".
//     · GRANT 는 보고 이력을 못 지우게 하는데 FK 가 CASCADE 로 지웠다.
//     · cal_task_hours 는 과제 참조를 RESTRICT 로 잠갔는데 쌍둥이 cal_report_hours 는 안 잠갔다.
//     · cal_attendance 는 근태 코드를 CHECK 로 잠갔는데 cal_report_daily 는 안 잠갔다.
//     · 모든 DB 접근 코드가 프리앰블을 거는데 ProjectDb 만 안 걸어 감사 시각이 KST 로 적혔다.
//     · 정본 SQL 이 시딩하는 schema_version 과 마이그레이션이 올리는 값이 갈릴 수 있었다.
//   다섯 다 사람이 눈으로 대조해야 보이는 종류다. 한 번 고쳐 놓아도 다음 표·다음 파일에서
//   같은 모양으로 되살아난다. 그래서 **짝을 기계가 붙잡게** 한다.
//
//   ★ 이 게이트는 살아 있는 DB 에 붙지 않는다 — 파일(정본 SQL · 호스트 .cs)만 읽는다.
//     DB 를 읽는 검사는 개발 PC 에서만 돌고 폐쇄망·CI 에서는 조용히 자기 때문이다.
//     "판정 못 함"을 통과로 만들지 않는 것이 이 저장소의 규칙이다(계약⑦ 참조).
import { readFileSync, readdirSync } from 'node:fs';
import { test, assert, stripCsComments } from './harness.mjs';
//  ★ 정본 파싱은 tests/canon-schema.mjs 한 곳에만 둔다. 여기 있던 두 정규식을 루프 시험들이
//    베껴 가면서 2026-09-09 사고 둘이 났다(판본·근태코드를 각자 박아 둔 결과). 파서를 나눠 쓰면
//    정본의 문장 형태가 바뀌어도 고칠 곳이 하나다.
//  ★ 이 모듈의 canon* 접근자는 **쓰지 않는다** — 이 파일은 최상위에서 던지지 않는 것이 규칙이라
//    (readOr 참조) 파일 읽기는 계속 여기서 하고, 순수 파서만 가져다 쓴다.
import { parseStatusCodes, parseSeededSchemaVersion } from './canon-schema.mjs';

const DEPLOY_DIR = new URL('../db/deploy/', import.meta.url);
const WIDGET_DIR = new URL('../widget/', import.meta.url);

//  ★ 최상위에서 throw 하지 않는다 — run-tests.mjs 의 import 루프에서 던지면 프로세스가 죽고
//    **전 스위트 판정이 증발**한다(xml-retirement.test.mjs 가 같은 이유로 같은 구조를 쓴다).
//    읽기 실패는 계약⑦ 한 건의 실패로 강등하고 나머지 커버리지는 살린다.
const missing = [];
function readOr(url, label) {
  try {
    const s = readFileSync(url, 'utf8');
    if (!s || s.length === 0) { missing.push(label + '(내용 없음)'); return ''; }
    return s;
  } catch (_) {
    missing.push(label);
    return '';
  }
}

const CANON = readOr(new URL('schema-calendar.sql', DEPLOY_DIR), 'db/deploy/schema-calendar.sql');
const REPORT_DB = readOr(new URL('ReportDb.cs', WIDGET_DIR), 'widget/ReportDb.cs');

// widget/ 의 .cs 를 **디렉터리로 열거**한다 — 파일 목록을 하드코딩하면 새 파일이 조용히 빠진다.
let widgetFiles = [];
try {
  widgetFiles = readdirSync(WIDGET_DIR).filter((f) => f.endsWith('.cs')).sort();
} catch (_) {
  missing.push('widget/ (디렉터리 열거 실패)');
}
const widgets = widgetFiles.map((f) => ({
  name: 'widget/' + f,
  src: readOr(new URL(f, WIDGET_DIR), 'widget/' + f),
}));

// db/deploy 의 migrate-*.sql 도 열거한다(파일이 늘어도 손댈 곳이 없어야 한다).
let migrateFiles = [];
try {
  migrateFiles = readdirSync(DEPLOY_DIR)
    .filter((f) => /^migrate-.*\.sql$/.test(f))
    .sort();
} catch (_) {
  missing.push('db/deploy/ (디렉터리 열거 실패)');
}

// ── 주석 제거 ────────────────────────────────────────────────────────
//  주석에 남긴 설명 문구가 검사 대상에 섞이면 계약이 거짓으로 만족된다 —
//  이 저장소의 SQL 주석은 "CASCADE 였다", "FK 를 걸지 않았다" 같은 **옛 상태 서술**을
//  일부러 남겨 두기 때문에 특히 그렇다(그 기록이 재론을 막는 장치다).
//
//  ★ **SQL 과 C# 은 다른 기계로 지운다.** SQL 주석은 -- 이고 C# 주석은 // · /* */ 다 — 한 함수로
//    묶을 수 없다. 그래서 여기 남는 것은 stripSql 하나뿐이고, C# 쪽은 하네스의 정본
//    (stripCsComments)을 가져다 쓴다.
//  ★ stripSql 은 줄을 \r*\n 으로 자른다 — 줄끝이 \r\r\n 인 파일이 섞이면 \r?\n 으로 자른 줄 끝에
//    \r 가 남고, 줄 주석 정규식이 거기서 멈춰 **주석이 하나도 안 지워진다.**
//  ★ 2026-09-18 — C# 쪽 사본(줄 단위 정규식)을 없앴다. 뜻이 **한 군데 달랐다**: 옛 사본은 문자열
//    리터럴을 보존하지 않아 리터럴 안의 // 도 주석으로 지웠다(앞이 줄머리나 공백일 때). 정본은
//    리터럴을 통째로 보존한다. 이 파일이 stripCs 로 보던 것 넷(접속 문자열 열거 · 시각 프리앰블 ·
//    HoursInDomain 정의와 그 호출 관문)과 변이① · 변이④ 는 **양쪽이 같은 답**임을 widget/*.cs
//    전수 대조로 확인하고 옮겼다. 게다가 이 파일의 계약은 프리앰블처럼 **문자열 리터럴 안에 있는
//    것을 찾는** 쪽이라, 리터럴을 보존하는 정본이 오히려 안전하다.
function stripSql(text) {
  return text
    .split(/\r*\n/)
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

const canonSql = stripSql(CANON);
const reportCode = stripCsComments(REPORT_DB);

// ── 계약별 순수 검사 함수 ────────────────────────────────────────────
//  변이 시험이 같은 함수를 '바꾼 사본'에 먹여야 하므로, 검사는 전부 인자로 소스를 받는다.
//  (전역을 읽는 검사는 변이시킬 수가 없어 계약이 있는지 없는지를 증명하지 못한다.)

const PREAMBLE_TZ = "time_zone='+00:00'";

//  계약① — DB 접속 문자열을 만드는 파일은 전부 시각 프리앰블을 갖는다.
function checkPreamble(list) {
  const conns = list.filter((w) => /MySqlConnectionStringBuilder/.test(stripCsComments(w.src)));
  assert.ok(conns.length >= 4,
    'DB 접속 문자열을 만드는 .cs 를 ' + conns.length + '개만 찾았다 — 열거가 빗나가면 이 계약은 ' +
    '아무것도 안 보고 통과한다(판정 불가는 통과가 아니다). 지금 알려진 것만 4개다: ' +
    'CalendarDb · CalendarWriteDb · ProjectDb · ReportDb');
  const bad = conns.filter((w) => !stripCsComments(w.src).includes(PREAMBLE_TZ)).map((w) => w.name);
  assert.deepStrictEqual(bad, [],
    "DB 에 접속하면서 SET SESSION " + PREAMBLE_TZ + " 을 걸지 않는 파일이 있다 — 그 세션이 쓰는 " +
    '서버 기본값(CURRENT_TIMESTAMP)은 SYSTEM=KST 로 평가되어 같은 컬럼에 KST 와 UTC 가 섞인다. ' +
    'DATETIME 은 사후에 둘을 구분하지 못한다(복구 불가). 빠진 것: ' + bad.join(', '));
}

//  계약② — app_user 를 가리키는 FK 중 ON DELETE CASCADE 가 0건.
//    FK 절은 줄을 넘어갈 수 있어(REFERENCES 다음 줄에 ON UPDATE/ON DELETE) 뒤 문맥을 함께 본다.
//    다음 CONSTRAINT / 표 끝(ENGINE=) 을 만나면 자른다 — 옆 제약의 CASCADE 를 오독하지 않게.
function ownerFkClauses(sql) {
  const out = [];
  const re = /REFERENCES\s+app_user\s*\(\s*user_id\s*\)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    let tail = sql.slice(m.index, m.index + 200);
    for (const stop of [/\bCONSTRAINT\b/i, /\bENGINE\s*=/i, /\bPRIMARY\s+KEY\b/i]) {
      const s = stop.exec(tail.slice(1));
      if (s) tail = tail.slice(0, s.index + 1);
    }
    out.push(tail);
  }
  return out;
}
function checkOwnerFkRestrict(sql) {
  const clauses = ownerFkClauses(sql);
  assert.ok(clauses.length >= 11,
    'app_user 를 가리키는 FK 를 ' + clauses.length + '개만 찾았다 — 2026-09-09 실측은 11개다. ' +
    '못 찾았으면 판정한 것이 아니다(정규식이 빗나갔거나 표가 사라졌다).');
  const cascades = clauses.filter((c) => /ON\s+DELETE\s+CASCADE/i.test(c));
  assert.strictEqual(cascades.length, 0,
    '소유자 FK 에 ON DELETE CASCADE 가 남아 있다(' + cascades.length + '건) — grants-calendar.sql 은 ' +
    '보고 표에 DELETE 권한을 주지 않는데, FK 의 참조 동작은 GRANT 검사를 거치지 않으므로 ' +
    'CASCADE 는 그 방어를 우회해 app_user 삭제만으로 기록을 지운다. 문제의 절: ' +
    cascades.map((c) => c.replace(/\s+/g, ' ').slice(0, 90)).join(' | '));
}

//  계약③ — 보고 표 CHECK 가 쌍둥이 원본과 같은 규율인가.
//    ★ 코드 목록을 문자열로 하드코딩하지 않는다. 원본(cal_attendance)이 바뀌면 사본도
//      함께 바뀌어야 하고, 안 바뀌면 여기서 실패해야 한다 — 그것이 이 계약의 존재 이유다.
const statusCodes = parseStatusCodes;
function checkReportChecks(sql) {
  const twin = statusCodes(sql, 'chk_cal_attendance_status');
  const mine = statusCodes(sql, 'chk_crd_status');
  assert.ok(twin && twin.length > 0, 'chk_cal_attendance_status 의 코드 목록을 읽지 못했다 — 원본이 사라졌거나 형태가 바뀌었다(판정 불가)');
  assert.ok(mine && mine.length > 0, 'chk_crd_status 가 없다 — cal_report_daily 의 근태 코드가 잠기지 않았다');

  //  '' 는 사본에만 있는 값이고 그것이 유일한 차이여야 한다:
  //  cal_attendance 는 '미기록 = 행 없음' 이라 '' 가 필요 없지만, cal_report_daily 는 보고를
  //  보내면 하루 한 행이 반드시 생기므로 '근태 미기재' 를 표현할 값이 필요하다.
  assert.ok(mine.includes(''),
    "chk_crd_status 에 '' 가 없다 — ReportDb 는 status 를 검증하지 않고 길이만 자르므로, " +
    '근태 미기재일의 보고 저장이 통째로 3819 로 죽는다(전송은 이미 나간 뒤다).');
  assert.ok(!twin.includes(''),
    "chk_cal_attendance_status 에 '' 가 들어갔다 — 그 표의 계약은 '미기록 = 행 없음' 이다(그 목록 주석 참조).");

  const sorted = (a) => [...new Set(a)].sort();
  assert.deepStrictEqual(sorted(mine.filter((c) => c !== '')), sorted(twin),
    "chk_crd_status 의 코드 목록이 chk_cal_attendance_status 와 다르다('' 제외하면 같아야 한다) — " +
    '두 컬럼은 "같은 타입이라 대조 가능" 을 노리고 만든 것이라, 한쪽에만 들어갈 수 있는 값이 ' +
    '생기면 대조 자체가 성립하지 않는다. 사이트에 코드가 늘면 **두 목록을 함께** 고칠 것. ' +
    'report=[' + mine.join(',') + '] attendance=[' + twin.join(',') + ']');

  //  패드 가드 — utf8mb4_bin 은 PAD SPACE 라 IN 목록만으로는 '1 '(뒤 공백)이 통과한다(실측 8.4.9).
  assert.ok(/CONSTRAINT\s+chk_crd_status[\s\S]{0,300}?status\s+NOT\s+LIKE\s+'% '/i.test(sql),
    "chk_crd_status 에 패드 가드(status NOT LIKE '% ')가 없다 — 근거는 chk_cal_attendance_status 주석에 있다");

  assert.ok(/CONSTRAINT\s+chk_crd_overtime\s+CHECK\s*\(\s*overtime\s*>=\s*0\s+AND\s+overtime\s*<=\s*11\s*\)/i.test(sql),
    'chk_crd_overtime 이 없거나 범위가 다르다 — 앱 규약 `if(!(ot >= 0 && ot <= 11)) ot = 0` 및 ' +
    'cal_attendance 와 같은 0..11 이어야 한다');
}

//  계약④ — 공수 상한. 정본의 CHECK 와 앱의 필터는 **함께 움직여야 한다.**
function checkHoursPair(sql, cs) {
  const m = /CONSTRAINT\s+chk_crh_hours\s+CHECK\s*\(([^)]*)\)/i.exec(sql);
  assert.ok(m, 'chk_crh_hours 를 찾지 못했다 — cal_report_hours 의 공수 범위가 잠기지 않았다(판정 불가)');
  const body = m[1];
  assert.ok(/hours\s*>\s*0/i.test(body),
    "chk_crh_hours 가 'hours > 0' 을 담지 않는다 — 0 은 '기록할 것이 없다' 이지 '0시간을 일했다' 가 아니다");
  assert.ok(/hours\s*<=\s*24/i.test(body),
    "chk_crh_hours 가 'hours <= 24' 를 담지 않는다 — 상한이 없으면 파서가 잘못 읽은 240 이 회사 보고 집계로 나간다");

  //  ★ 2026-09-11 적대 검토(R5) — 앱 쪽 필터는 ReportDb.HoursInDomain **한 줄**이다. 전에는
  //    `h.Hours <= 0` 과 `h.Hours > 24` 가 여기에, 그리고 MainWindow.ParseHoursJson 에 또 한 벌
  //    적혀 있어 한쪽만 고치면 두 관문이 갈렸다. 그래서 정본과 짝지어 볼 대상도 그 한 줄이다.
  assert.ok(/internal static bool HoursInDomain\(decimal h\) => h > 0m && h <= 24m;/.test(cs),
    'ReportDb 의 공수 도메인 판정(HoursInDomain)이 정본 CHECK(`hours > 0 AND hours <= 24`)와 다르다 — ' +
    '범위 밖 줄이 통과하면 그 한 줄이 3819 를 내고 **그 날 보고 저장 트랜잭션 전체가 죽는다** ' +
    '(전송은 이미 나간 뒤라 가장 나쁜 실패다).');
  assert.ok(/if \(!HoursInDomain\(h\.Hours\)\) continue;/.test(cs),
    'ReportDb 의 저장 직전 관문이 HoursInDomain 으로 거르지 않는다 — 판정이 있어도 부르지 않으면 장식이다.');
}

//  계약⑤ — cat_no 가드. 번호 재사용(MAX()+1 발번) 때문에 참조가 없으면 과거 공수가
//    같은 번호를 받은 다른 과제로 흡수된다. 오늘은 cat_no 가 항상 NULL 이라 무동작이지만,
//    이 FK 는 '나중에 채우는 사람' 을 향한 가드다.
function checkCatNoFk(sql) {
  assert.ok(/CONSTRAINT\s+fk_crh_cat\s+FOREIGN\s+KEY\s*\(\s*user_id\s*,\s*cat_no\s*\)\s*REFERENCES\s+cal_category/i.test(sql),
    'fk_crh_cat 이 없다 — cal_report_hours.cat_no 가 cal_category 를 가리키지 않는다. ' +
    'cat_no 는 MAX()+1 발번이라 번호가 재사용되므로, 참조가 없으면 이미 회사로 나간 공수가 ' +
    '나중에 같은 번호를 받은 다른 과제의 것으로 조용히 흡수된다(쌍둥이 cal_task_hours 는 ' +
    '2026-08-24 에 같은 문제를 RESTRICT 로 풀었다).');
  assert.ok(/CONSTRAINT\s+fk_crh_cat[\s\S]{0,200}?ON\s+DELETE\s+RESTRICT/i.test(sql),
    'fk_crh_cat 이 RESTRICT 가 아니다 — CASCADE 는 침묵 삭제와 같은 말인데 이 값은 회사로 나간 보고 숫자다');
}

//  계약⑥ — 정본이 시딩하는 schema_version 과 마이그레이션 최댓값이 같다.
//    갈라지면 "새로 세운 DB" 와 "마이그레이션으로 온 DB" 가 서로 다른 버전을 자칭한다.
//  ★ 파서는 문자열을 준다(DB·위젯의 비교가 문자열이라 그쪽이 정본이다). 이 계약만 마이그레이션의
//    최댓값과 크기 비교를 하므로 여기서 숫자로 바꾼다.
function seededVersion(sql) {
  const v = parseSeededSchemaVersion(sql);
  return v === null ? null : Number(v);
}
function migratedVersions(files, readFn) {
  const out = [];
  for (const f of files) {
    const src = stripSql(readFn(f));
    const re = /UPDATE\s+cal_schema_meta\s+SET\s+v\s*=\s*'(\d+)'/gi;
    let m;
    while ((m = re.exec(src)) !== null) out.push({ file: f, v: Number(m[1]) });
  }
  return out;
}
function checkVersionParity(sql, versions) {
  const seeded = seededVersion(sql);
  assert.ok(seeded !== null, 'schema-calendar.sql 의 schema_version 시딩을 읽지 못했다(판정 불가)');
  assert.ok(versions.length >= 5,
    'migrate-*.sql 에서 버전 상향을 ' + versions.length + '건만 찾았다 — 열거·파싱이 빗나가면 ' +
    '이 계약은 아무것도 대조하지 않는다(2026-09-09 기준 6건)');
  const top = versions.reduce((a, b) => (b.v > a.v ? b : a));
  assert.strictEqual(seeded, top.v,
    'schema-calendar.sql 이 시딩하는 schema_version(' + seeded + ')과 가장 높은 마이그레이션(' +
    top.file + ' → ' + top.v + ')이 다르다. 구조를 고칠 때 정본과 마이그레이션 중 한쪽만 ' +
    '올리면 두 배포 경로가 서로 다른 버전을 자칭하게 되고, 앱의 버전 가드가 어느 쪽을 믿을지 모른다.');
}

// ── 계약 ────────────────────────────────────────────────────────────
test('계약⑦: 게이트의 기준 파일이 전부 실재한다(못 읽었으면 통과가 아니라 측정 실패다)', () => {
  assert.deepStrictEqual(missing, [],
    '스키마 무결성 게이트가 기준 파일을 읽지 못했다 — 개명·이동됐다면 이 파일의 경로를 갱신할 것. ' +
    '읽지 못한 것을 통과로 넘기면 그 순간부터 이 게이트는 아무것도 지키지 않는다. 없는 것: ' +
    missing.join(', '));
});

test('계약①: DB 접속 문자열을 만드는 widget/*.cs 는 전부 시각 프리앰블을 건다', () => {
  checkPreamble(widgets);
});

test('계약②: app_user 를 가리키는 FK 에 ON DELETE CASCADE 가 하나도 없다', () => {
  checkOwnerFkRestrict(canonSql);
});

test('계약③: cal_report_daily 의 CHECK 가 쌍둥이 cal_attendance 와 같은 규율이다', () => {
  checkReportChecks(canonSql);
});

test('계약④: 공수 상한(정본 CHECK)과 0시간 필터(ReportDb)가 짝을 이룬다', () => {
  checkHoursPair(canonSql, reportCode);
});

test('계약⑤: cal_report_hours.cat_no 에 제한 외래키 fk_crh_cat 이 있다', () => {
  checkCatNoFk(canonSql);
});

test('계약⑥: 정본 시딩 버전 = 최신 migrate-*.sql 의 상향 버전', () => {
  checkVersionParity(CANON, migratedVersions(migrateFiles, (f) => readOr(new URL(f, DEPLOY_DIR), 'db/deploy/' + f)));
});

// ── 변이 시험 — 계약이 정말 발화하는지 ────────────────────────────────
//  ★ 접미사 변이(foo → foo_MUTATED)는 쓰지 않는다. 부분문자열 검사에 그대로 걸려 무의미하다.
//    값을 실제로 뒤집거나 지운다.

test('변이①: 프리앰블 문자열을 지운 사본은 계약① 이 잡는다 + 원본은 통과한다(통제군)', () => {
  const ANCHOR = 'widget/ProjectDb.cs';
  assert.ok(widgets.some((w) => w.name === ANCHOR), ANCHOR + ' 가 열거에서 빠졌다 — 변이 앵커가 없으면 증명이 아니다');
  const planted = widgets.map((w) =>
    w.name === ANCHOR ? { name: w.name, src: w.src.split(PREAMBLE_TZ).join("time_zone='SYSTEM'") } : w);
  assert.notDeepStrictEqual(planted.find((w) => w.name === ANCHOR).src,
    widgets.find((w) => w.name === ANCHOR).src, '변이가 원본을 바꾸지 못했다');
  assert.throws(() => checkPreamble(planted), /widget\/ProjectDb\.cs/,
    '프리앰블을 잃은 파일 이름이 실패 메시지에 나와야 한다 — 어디를 고칠지가 답이다');
  //  통제군: 손대지 않은 원본은 통과한다(위 실패가 '변이 때문' 임을 증명. 봉인이 과하지 않다)
  assert.doesNotThrow(() => checkPreamble(widgets));
});

test('변이②: 소유자 FK 하나를 CASCADE 로 되돌리면 계약② 가 실패한다', () => {
  const bad = canonSql.replace(
    'CONSTRAINT fk_crd_user FOREIGN KEY (user_id) REFERENCES app_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT',
    'CONSTRAINT fk_crd_user FOREIGN KEY (user_id) REFERENCES app_user (user_id) ON DELETE CASCADE ON UPDATE CASCADE');
  assert.notStrictEqual(bad, canonSql, '변이가 원본을 바꾸지 못했다 — fk_crd_user 의 선언 형태가 바뀌었다');
  assert.throws(() => checkOwnerFkRestrict(bad), /ON DELETE CASCADE 가 남아 있다/);
});

test('변이③: 원본(cal_attendance) 목록에서 코드 하나를 빼면 계약③ 이 실패한다', () => {
  //  ★ 사본이 아니라 **원본**을 건드린다. 사이트에 코드가 늘거나 줄 때 한쪽만 고치는 것이
  //    실제로 일어나는 사고이고, 그 사고를 이 계약이 잡아야 한다.
  const m = /CONSTRAINT\s+chk_cal_attendance_status\s+CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/i.exec(canonSql);
  assert.ok(m, '변이 대상(chk_cal_attendance_status)을 찾지 못했다');
  const shrunk = m[0].replace(",'12'", '');
  assert.notStrictEqual(shrunk, m[0], "코드 '12' 를 빼지 못했다 — 목록 형태가 바뀌었다");
  const bad = canonSql.replace(m[0], shrunk);
  assert.throws(() => checkReportChecks(bad), /코드 목록이 chk_cal_attendance_status 와 다르다/);
});

test('변이③b: chk_crd_status 를 통째로 지우면 계약③ 이 실패한다', () => {
  const bad = canonSql.replace(/CONSTRAINT\s+chk_crd_status/i, 'CONSTRAINT chk_없음');
  assert.notStrictEqual(bad, canonSql, '변이가 원본을 바꾸지 못했다');
  assert.throws(() => checkReportChecks(bad), /chk_crd_status 가 없다/);
});

test('변이④: 공수 도메인을 `>= 0` 으로 되돌리면 계약④ 가 실패한다(0시간 줄이 통과한다)', () => {
  const bad = reportCode.replace('h > 0m && h <= 24m', 'h >= 0m');
  assert.notStrictEqual(bad, reportCode, '변이가 원본을 바꾸지 못했다 — 도메인 판정의 표현이 바뀌었다');
  assert.throws(() => checkHoursPair(canonSql, bad), /공수 도메인 판정\(HoursInDomain\)이 정본 CHECK/);
});

test('변이④b: chk_crh_hours 의 상한(<= 24)을 지우면 계약④ 가 실패한다', () => {
  //  ★ 이름을 앵커로 잡는다. 단순히 'CHECK (hours > 0 AND hours <= 24)' 를 replace 하면
  //    같은 문장을 가진 **쌍둥이 chk_cal_task_hours_range 가 파일에서 먼저 나와** 그쪽이 바뀐다.
  //    그러면 소스는 바뀌었는데(notStrictEqual 통과) 계약④ 는 멀쩡히 통과해, 변이 시험이
  //    "계약이 없어도 통과한다"를 증명하는 대신 아무것도 증명하지 못한다. 실제로 그렇게 잡혔다.
  const m = /CONSTRAINT\s+chk_crh_hours\s+CHECK\s*\([^)]*\)/i.exec(canonSql);
  assert.ok(m, '변이 대상(chk_crh_hours)을 찾지 못했다');
  const bad = canonSql.replace(m[0], 'CONSTRAINT chk_crh_hours CHECK (hours > 0)');
  assert.notStrictEqual(bad, canonSql, '변이가 원본을 바꾸지 못했다 — chk_crh_hours 의 표현이 바뀌었다');
  assert.throws(() => checkHoursPair(bad, reportCode), /hours <= 24/);
});

test('변이⑤: fk_crh_cat 선언을 지우면 계약⑤ 가 실패한다', () => {
  const bad = canonSql.replace(/CONSTRAINT\s+fk_crh_cat\s+FOREIGN\s+KEY[^;]*?RESTRICT\s*,/i, '');
  assert.notStrictEqual(bad, canonSql, '변이가 원본을 바꾸지 못했다 — fk_crh_cat 의 선언 형태가 바뀌었다');
  assert.throws(() => checkCatNoFk(bad), /fk_crh_cat 이 없다/);
});

test('변이⑥: 정본 시딩 값만 바꾸면 계약⑥ 이 실패한다(마이그레이션과 갈라짐)', () => {
  const seeded = seededVersion(CANON);
  assert.ok(seeded !== null, '시딩 값을 읽지 못했다');
  const bad = CANON.replace("VALUES ('schema_version', '" + seeded + "'", "VALUES ('schema_version', '" + (seeded - 1) + "'");
  assert.notStrictEqual(bad, CANON, '변이가 원본을 바꾸지 못했다 — 시딩 문장의 형태가 바뀌었다');
  const versions = migratedVersions(migrateFiles, (f) => readOr(new URL(f, DEPLOY_DIR), 'db/deploy/' + f));
  assert.throws(() => checkVersionParity(bad, versions), /시딩하는 schema_version/);
  //  통제군 — 손대지 않은 원본은 통과한다
  assert.doesNotThrow(() => checkVersionParity(CANON, versions));
});

test('변이⑦: 마이그레이션 목록이 비면 계약⑥ 이 통과하지 않는다(판정 불가 ≠ 통과)', () => {
  assert.throws(() => checkVersionParity(CANON, []), /버전 상향을 0건만 찾았다/);
});
