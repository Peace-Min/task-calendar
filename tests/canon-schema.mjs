/* ============================================================================
 *  tests/canon-schema.mjs — 정본(db/deploy/schema-calendar.sql)에서 **판본**과
 *  **허용 코드 목록**을 읽어 주는 작은 헬퍼
 * ----------------------------------------------------------------------------
 *  왜 이 파일이 생겼나(2026-09-09, 같은 날 사고 두 건이 원인이 같았다):
 *    ① 정본이 schema_version 8 → 9 로 올랐는데 loop-schema-gate.mjs 가 '8' 을 박아
 *       두고 있었다. 선행조건에서 중단했는데도 finally 가 무조건 '8' 을 써서
 *       **실 DB 를 v8 로 강등**시켰다(구조는 v9 그대로). 그 상태의 DB 를 보는 위젯은
 *       전량 교체(가져오기·초기화)를 전부 거부한다.
 *    ② cal_report_daily 에 chk_crd_status 가 새로 들어오자, loop-report-wiring.mjs 가
 *       박아 두고 있던 근태코드 '8'(결근 — 앱이 만들 수 없는 값)이 CHECK 에 걸렸다.
 *    둘 다 "정본에 있는 값을 시험 코드가 따로 적어 두었다" 는 한 가지 원인이다.
 *    그래서 **읽는 자리를 하나로 모은다.** 정본이 움직이면 시험은 따라 움직이고,
 *    못 읽으면 통과가 아니라 중단이다.
 *
 *  구성 규칙:
 *    · parse* 는 **순수 함수**다(인자로 받은 SQL 문자열만 본다). 변이 시험이 '고친 사본'을
 *      먹여 계약이 실제로 우는지 확인해야 하기 때문이다 — 전역을 읽는 검사는 변이시킬 수가 없다.
 *      (schema-integrity.test.mjs 가 그 방식으로 쓴다.)
 *    · canon* 은 정본 파일을 읽어 parse* 에 먹이고, **못 읽거나 못 읽어내면 던진다.**
 *      판정 불가 ≠ 통과.
 *    · 파일 읽기는 **지연**이다(첫 호출 때 읽고 캐시). 최상위에서 던지면
 *      run-tests.mjs 의 import 루프가 죽어 전 스위트 판정이 증발한다
 *      (schema-integrity.test.mjs 머리 주석이 같은 이유로 같은 규칙을 쓴다).
 * ==========================================================================*/
import { readFileSync } from 'node:fs';

const CANON_URL = new URL('../db/deploy/schema-calendar.sql', import.meta.url);
export const CANON_PATH = 'db/deploy/schema-calendar.sql';

//  주석 제거 — 이 저장소의 SQL 주석에는 "schema_version 5", "CASCADE 였다" 같은
//  **옛 상태 서술**이 일부러 남아 있다(그 기록이 재론을 막는 장치다). 그대로 파싱하면
//  옛 값을 정본으로 읽을 수 있다.
//  ★ 줄을 \r*\n 으로 자른다 — \r?\n 으로 자르면 줄끝이 \r\r\n 인 파일에서 \r 가 남아
//    줄 주석 정규식이 거기서 멈춘다(schema-integrity.test.mjs 의 stripSql 과 같은 규칙).
export function stripSqlComments(text) {
  return String(text).split(/\r*\n/).map((l) => l.replace(/--.*$/, '')).join('\n');
}

//  CHECK (status IN ('','1',…)) 의 코드 목록. 없으면 null(있는지 없는지를 부르는 쪽이 판단한다).
export function parseStatusCodes(sql, constraintName) {
  const re = new RegExp('CONSTRAINT\\s+' + constraintName + '\\s+CHECK\\s*\\(\\s*status\\s+IN\\s*\\(([^)]*)\\)', 'i');
  const m = re.exec(sql);
  if (!m) return null;
  const codes = [];
  const lit = /'([^']*)'/g;
  let x;
  while ((x = lit.exec(m[1])) !== null) codes.push(x[1]);
  return codes;
}

//  정본이 시딩하는 schema_version. **문자열 그대로** 돌려준다 —
//  DB 의 cal_schema_meta.v 도 위젯의 비교도 문자열이라(utf8mb4_bin 정확 비교),
//  숫자로 바꾸면 '09' 같은 값이 조용히 같아진다.
export function parseSeededSchemaVersion(sql) {
  const m = /INSERT\s+INTO\s+cal_schema_meta[\s\S]{0,200}?VALUES\s*\(\s*'schema_version'\s*,\s*'(\d+)'/i.exec(sql);
  return m ? m[1] : null;
}

let _canon = null;
export function canonSql() {
  if (_canon === null) {
    let raw;
    try {
      raw = readFileSync(CANON_URL, 'utf8');
    } catch (e) {
      throw new Error(`정본을 읽지 못했다(${CANON_PATH}): ${e.message} — 값을 못 읽으면 측정 못 한 것이다`);
    }
    if (!raw) throw new Error(`정본이 비어 있다(${CANON_PATH}) — 측정 못 함`);
    _canon = stripSqlComments(raw);
  }
  return _canon;
}

export function canonSchemaVersion() {
  const v = parseSeededSchemaVersion(canonSql());
  if (v === null) {
    throw new Error(`${CANON_PATH} 의 schema_version 시딩(INSERT INTO cal_schema_meta … 'schema_version', 'N')을 ` +
                    '읽지 못했다 — 문장 형태가 바뀌었다면 여기 정규식을 함께 고칠 것. 못 읽으면 측정 못 함이다.');
  }
  return v;
}

export function canonStatusCodes(constraintName) {
  const codes = parseStatusCodes(canonSql(), constraintName);
  if (!codes || codes.length === 0) {
    throw new Error(`${CANON_PATH} 에서 ${constraintName} 의 코드 목록을 읽지 못했다 — ` +
                    'CHECK 가 사라졌거나 형태가 바뀌었다. 목록을 시험에 다시 박지 말고 여기를 고칠 것.');
  }
  return codes;
}
