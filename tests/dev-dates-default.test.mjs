// 개발 날짜 기본값(2026-10-23 사용자 결정, docs/MONTHLY-REPORT-PLAN.md §6.5)
//
// 이 파일이 존재하는 이유:
//   관리 창의 공식 과제 폼(#officialEditModal)은 **새 과제를 등록할 때만** 계약 날짜에서 개발 날짜를 채운다.
//     개발시작 = 계약시작 + 1달, 개발종료 = 계약종료 - 1달(그 달 말일로 붙인다. MySQL DATE_ADD/DATE_SUB 와 같다).
//   규칙 넷이 조용히 깨지기 쉽다:
//     ① 손으로 넣거나 지운 칸은 이 폼을 연 동안 다시 채우지 않는다(사람이 넣은 값을 덮으면 말없이 사라진다).
//     ② 기존 과제 편집에서는 채우지 않는다(계약 날짜를 고치다 개발 날짜가 바뀌면 안 된다).
//     ③ 채운 결과가 시작 > 종료면 아무것도 채우지 않는다(DB CHECK chk_project_dev_dates 가 저장을 거절한다).
//     ④ 기존 과제는 db/deploy/oneoff/dev-dates-from-contract.sql 이 같은 규칙으로 채운다(배포 SQL 에 묶이지 않는다).
//
//   ★ 앱 전체를 부팅하지 않는다. 폼 마크업(원본에서 오려 낸 것)과 판정 함수, 바인딩 줄만 jsdom 에 심는다
//     (inline-edit-guard.test.mjs 와 같은 방식). 검사와 변이가 같은 창구를 쓴다.
//   판정 불가 ≠ 통과: 기준 파일을 못 읽으면 그 사실 자체가 실패다.
import { test, skip, assert, loadAppSource, extractFunction, readText, importOptional, useJsdom, runInJsdom, SKIP_NO_JSDOM } from './harness.mjs';
import { stripSqlComments } from './canon-schema.mjs';

const missing = [];
const R = (rel) => new URL('../' + rel, import.meta.url);
function readOr(rel) {
  try { const s = readText(R(rel)); if (!s) { missing.push(rel + '(빈 파일)'); return ''; } return s; }
  catch { missing.push(rel); return ''; }
}
const SQL_PATH = 'db/deploy/oneoff/dev-dates-from-contract.sql';
const sqlSrc = readOr(SQL_PATH);
const releaseSql = readOr('installer/release-sql.ps1');
const publish = readOr('installer/publish-update.ps1');
let app = '';
try { app = loadAppSource(); } catch { missing.push('task-calendar-prototype.html'); }

const FNS = ['offAddMonths', 'offEdDevHintSet', 'offEdDevHintSync', 'offEdDevReset', 'offEdDevTouch', 'offEdAutoDev'];

//  바인딩 한 줄: 앵커가 든 줄이 정확히 하나여야 한다(없거나 둘이면 판정 불가).
function bindLine(src, anchor) {
  const lines = src.split('\n').filter((l) => l.includes(anchor));
  assert.strictEqual(lines.length, 1, `바인딩 줄(${anchor})이 ${lines.length}개다(판정 불가)`);
  return lines[0];
}

//  폼 마크업은 원본에서 오려 낸다(힌트 칸이 빠지면 시험이 안다).
function formMarkup(src) {
  const a = src.indexOf('<div class="overlay hidden" id="officialEditModal">');
  const b = src.indexOf('<div class="modal-foot">', a);
  assert.ok(a >= 0 && b > a, '#officialEditModal 마크업을 찾지 못했다(판정 불가)');
  return '<!doctype html><html><body>' + src.slice(a, b) + '</div></div></body></html>';
}

function harnessJs(src) {
  return [
    'var offEdUid = "";',
    'const $ = s => document.querySelector(s);',
    'let offEdDevTouched = { start: false, end: false };',
    'let offEdDevAuto = { start: false, end: false };',
    ...FNS.map((n) => extractFunction(src, n)),
    //  실제 바인딩 줄 두 개를 그대로 심는다(어느 사건에 무엇이 걸렸는지까지 원본 그대로).
    bindLine(src, "['#offEdStart', '#offEdEnd'].forEach("),
    bindLine(src, "[['#offEdDevStart', 'start'], ['#offEdDevEnd', 'end']].forEach("),
    'function fire(e){ e.dispatchEvent(new window.Event("input", { bubbles: true })); e.dispatchEvent(new window.Event("change", { bubbles: true })); }',
    //  sc = { uid, init:{start,end,devStart,devEnd}, steps:[[칸 id, 값], ...] }. 칸을 사람처럼 바꾼다(값 + input + change).
    'window.__probe = function(sc){',
    '  offEdUid = sc.uid || "";',
    '  const ids = { start: "offEdStart", end: "offEdEnd", devStart: "offEdDevStart", devEnd: "offEdDevEnd" };',
    '  const init = sc.init || {};',
    '  for (const k in ids) document.getElementById(ids[k]).value = init[k] || "";',
    '  offEdDevReset();',
    '  for (const [id, v] of (sc.steps || [])) { const e = document.getElementById(id); e.value = v; fire(e); }',
    '  const h = document.getElementById("offEdDevHint");',
    '  return { devStart: document.getElementById("offEdDevStart").value, devEnd: document.getElementById("offEdDevEnd").value,',
    '           hint: h.hidden ? "" : h.textContent };',
    '};',
    'window.__add = function(ymd, n){ return offAddMonths(ymd, n); };',
  ].join('\n');
}

const AUTO_HINT = '계약 기간에서 자동으로 채웠습니다. 바꿀 수 있습니다.';

const checks = {
  //  ① 새 과제: 계약 날짜 둘 다 고르면 개발 날짜 둘 다 채우고 안내를 보인다. 하나만 골라도 그쪽만 채운다.
  newFill(probe) {
    const r = probe({ steps: [['offEdStart', '2026-03-15'], ['offEdEnd', '2027-02-28']] });
    assert.deepStrictEqual([r.devStart, r.devEnd], ['2026-04-15', '2027-01-28'], '새 과제에서 개발 날짜를 계약 날짜로 채우지 않았다');
    assert.strictEqual(r.hint, AUTO_HINT, '자동으로 채웠는데 안내가 없다');
    const one = probe({ steps: [['offEdEnd', '2027-06-30']] });
    assert.deepStrictEqual([one.devStart, one.devEnd], ['', '2027-05-30'], '계약종료만 골랐을 때 개발종료만 채워야 한다');
    const chg = probe({ steps: [['offEdStart', '2026-01-10'], ['offEdStart', '2026-02-10']] });
    assert.strictEqual(chg.devStart, '2026-03-10', '계약시작을 바꾸면 손대지 않은 개발시작도 따라가야 한다');
  },
  //  말일 붙이기(MySQL INTERVAL 1 MONTH 와 같다), 윤년 포함.
  clamp(add, probe) {
    const cases = [
      ['2026-01-31', 1, '2026-02-28'], ['2028-01-31', 1, '2028-02-29'], ['2026-03-31', -1, '2026-02-28'],
      ['2028-03-31', -1, '2028-02-29'], ['2100-03-31', -1, '2100-02-28'], ['2000-03-30', -1, '2000-02-29'],
      ['2026-12-15', 1, '2027-01-15'], ['2027-01-15', -1, '2026-12-15'], ['2026-05-31', -1, '2026-04-30'],
      ['', 1, ''], ['2026-13-01', 1, ''],
    ];
    for (const [d, n, want] of cases) assert.strictEqual(add(d, n), want, `offAddMonths(${d}, ${n})`);
    const r = probe({ steps: [['offEdStart', '2028-01-31'], ['offEdEnd', '2028-03-31']] });
    assert.deepStrictEqual([r.devStart, r.devEnd], ['2028-02-29', '2028-02-29'], '윤년 말일 붙이기가 폼에서 다르다');
  },
  //  ② 손으로 먼저 넣고 계약 날짜를 고르면 그대로다. 손으로 지운 칸은 비운 채로 둔다.
  manualWins(probe) {
    const r = probe({ steps: [['offEdDevStart', '2026-07-01'], ['offEdDevEnd', '2026-11-30'], ['offEdStart', '2026-03-15'], ['offEdEnd', '2027-02-28']] });
    assert.deepStrictEqual([r.devStart, r.devEnd], ['2026-07-01', '2026-11-30'], '손으로 넣은 개발 날짜를 계약 날짜가 덮었다');
    assert.strictEqual(r.hint, '', '둘 다 손댔는데 안내가 남았다');
    const c = probe({ steps: [['offEdStart', '2026-03-15'], ['offEdEnd', '2027-02-28'], ['offEdDevStart', ''], ['offEdStart', '2026-04-15'], ['offEdEnd', '2027-03-31']] });
    assert.deepStrictEqual([c.devStart, c.devEnd], ['', '2027-02-28'], '손으로 지운 개발시작이 다시 채워졌거나 손대지 않은 개발종료가 따라가지 않았다');
    assert.strictEqual(c.hint, AUTO_HINT, '한쪽은 아직 자동 값인데 안내가 사라졌다');
  },
  //  ③ 기존 과제 편집: 계약 날짜를 바꿔도 채우지 않는다.
  editNoFill(probe) {
    const r = probe({ uid: 'u-1', init: { start: '2026-01-01', end: '2026-12-31' }, steps: [['offEdStart', '2026-03-15'], ['offEdEnd', '2027-02-28']] });
    assert.deepStrictEqual([r.devStart, r.devEnd, r.hint], ['', '', ''], '기존 과제 편집에서 개발 날짜를 채웠다');
    const k = probe({ uid: 'u-1', init: { devStart: '2026-05-05', devEnd: '2026-06-06' }, steps: [['offEdEnd', '2027-02-28']] });
    assert.deepStrictEqual([k.devStart, k.devEnd], ['2026-05-05', '2026-06-06'], '기존 과제의 개발 날짜가 바뀌었다');
  },
  //  ④ 뒤집힌 범위: 아무것도 채우지 않고(앞서 자동으로 채운 값도 비운다) 짧은 안내를 보인다.
  inverted(probe) {
    const r = probe({ steps: [['offEdStart', '2026-03-10'], ['offEdEnd', '2026-04-20']] });
    assert.deepStrictEqual([r.devStart, r.devEnd], ['', ''], '시작 > 종료인 개발 날짜를 채웠다(DB CHECK 가 거절한다)');
    assert.ok(r.hint && r.hint !== AUTO_HINT && /채우지 않았습니다/.test(r.hint), '뒤집힌 범위인데 안내가 없다: ' + r.hint);
    const t = probe({ steps: [['offEdDevStart', '2027-06-01'], ['offEdEnd', '2027-03-31']] });
    assert.deepStrictEqual([t.devStart, t.devEnd], ['2027-06-01', ''], '손으로 넣은 개발시작보다 이른 개발종료를 채웠다');
  },
  //  폼을 열 때 손댐 표시를 새로 시작하고, 열기에서는 채우지 않는다. 저장 길은 그대로다.
  wiring(src) {
    const open = extractFunction(src, 'offEditOpen');
    assert.ok(/\n  offEdDevReset\(\);/.test(open), 'offEditOpen 이 개발 날짜 손댐 표시를 새로 시작하지 않는다');
    assert.ok(!/offEdAutoDev\(/.test(open), 'offEditOpen 이 열면서 개발 날짜를 채운다(기존 과제가 바뀔 수 있다)');
    assert.ok(/^\s*if\(offEdUid\) return;/m.test(extractFunction(src, 'offEdAutoDev')), 'offEdAutoDev 에 기존 과제 편집 차단이 없다');
    assert.ok(/devStartDate: val\('offEdDevStart'\)/.test(extractFunction(src, 'offEdSaveNow')), '저장 payload 의 devStartDate 가 바뀌었다');
    assert.ok(/^let offEdDevTouched = \{ start: false, end: false \};/m.test(src), 'offEdDevTouched 선언이 없다(시험 대역과 갈린다)');
    assert.ok(/^let offEdDevAuto = \{ start: false, end: false \};/m.test(src), 'offEdDevAuto 선언이 없다(시험 대역과 갈린다)');
  },
  //  기존 과제용 SQL: 같은 규칙, 둘 다 NULL 가드, 순수 Workbench SQL, 배포 SQL 에 안 묶임.
  sql(sql, rel, pub) {
    assert.ok(sql, `${SQL_PATH} 가 없다`);
    const code = stripSqlComments(sql);
    assert.ok(/^USE taskcalendar;/m.test(code), 'USE taskcalendar; 가 없다');
    assert.ok(!/DELIMITER|CREATE\s+(PROCEDURE|FUNCTION|TRIGGER)|ALTER\s+TABLE|cal_schema_meta|GRANT\s/i.test(code), '저장 프로그램, 구조 변경, 구조 번호, 권한은 쓰지 않는다');
    assert.ok(!/^--\s*@migration/m.test(sql), '이관 조각 머리표(@migration)가 있다(배포 SQL 조각이 아니다)');
    const upd = /UPDATE project\s+SET([\s\S]*?);/.exec(code);
    assert.ok(upd, 'UPDATE project 문이 없다');
    const u = upd[1];
    assert.ok(/dev_start_date = DATE_ADD\(start_date, INTERVAL 1 MONTH\)/.test(u), '개발시작 = DATE_ADD(start_date, INTERVAL 1 MONTH) 가 아니다');
    assert.ok(/dev_end_date\s+= DATE_SUB\(end_date, INTERVAL 1 MONTH\)/.test(u), '개발종료 = DATE_SUB(end_date, INTERVAL 1 MONTH) 가 아니다');
    for (const g of ['dev_start_date IS NULL', 'dev_end_date IS NULL', 'start_date IS NOT NULL', 'end_date IS NOT NULL',
      'DATE_ADD(start_date, INTERVAL 1 MONTH) <= DATE_SUB(end_date, INTERVAL 1 MONTH)']) {
      assert.ok(u.includes('AND ' + g), `UPDATE 의 WHERE 에 '${g}' 가 없다(다시 돌리기 안전, CHECK)`);
    }
    const txn = code.indexOf('START TRANSACTION;'), up = code.indexOf('UPDATE project'), cm = code.indexOf('COMMIT;');
    assert.ok(txn >= 0 && txn < up && up < cm, 'START TRANSACTION, UPDATE, COMMIT 순서가 아니다');
    assert.ok(code.indexOf('SELECT') < txn, '미리 보기 SELECT 가 UPDATE 앞에 없다');
    assert.ok(/skip_reason/.test(code.slice(cm)), '건너뛴 과제와 이유 SELECT 가 없다');
    //  배포 SQL 은 이관 조각 폴더만 읽는다(이 파일은 그 밖에 있어야 묶이지 않는다).
    assert.ok(!/[\\/]migrations[\\/]/.test(SQL_PATH), 'one-off SQL 이 이관 조각 폴더 안에 있다');
    assert.ok(/\$fragDir = Join-Path \$root 'db\\deploy\\migrations'/.test(pub), 'publish-update.ps1 의 조각 폴더가 db\\deploy\\migrations 가 아니다');
    assert.ok(!/oneoff/i.test(rel) && !/oneoff/i.test(pub), '배포 스크립트가 oneoff 폴더를 읽는다');
  },
};

test('개발 날짜 기본값⓪: 기준 파일이 전부 실재한다', () => {
  assert.deepStrictEqual(missing, [], '기준 파일을 읽지 못했다: ' + missing.join(', '));
});
test('개발 날짜 기본값⑥: 폼을 열 때 손댐을 새로 시작하고, 열기와 기존 과제에서는 채우지 않는다', () => checks.wiring(app));
test('개발 날짜 기본값⑦: 기존 과제용 SQL 은 같은 규칙, 둘 다 NULL 가드, 순수 Workbench SQL 이고 배포 SQL 에 묶이지 않는다', () => checks.sql(sqlSrc, releaseSql, publish));
test('변이⑦: UPDATE 에서 개발종료 NULL 가드를 지우면 ⑦ 이 실패한다', () => {
  const bad = sqlSrc.replace(' WHERE id > 0\n   AND dev_start_date IS NULL\n   AND dev_end_date IS NULL\n', ' WHERE id > 0\n   AND dev_start_date IS NULL\n');
  assert.notStrictEqual(bad, sqlSrc, '변이가 적용되지 않았다(앵커가 낡았다)');
  assert.throws(() => checks.sql(bad, releaseSql, publish), /dev_end_date IS NULL/);
});
test('변이⑥: offEditOpen 에서 손댐 초기화를 지우면 ⑥ 이 실패한다', () => {
  const bad = app.replace('  offEdDevReset();   // 개발 날짜 기본값', '  // 개발 날짜 기본값');
  assert.notStrictEqual(bad, app, '변이가 적용되지 않았다(앵커가 낡았다)');
  assert.throws(() => checks.wiring(bad), /손댐 표시/);
});

const jsdom = useJsdom(await importOptional('jsdom'));
if (!jsdom) {
  skip('개발 날짜 기본값①~⑤(DOM)', SKIP_NO_JSDOM, '이 파일의 DOM 계약 5건과 변이 3건이 세어지지 않음');
} else {
  const mk = (src) => {
    const fx = formMarkup(src), js = harnessJs(src);
    return {
      probe: (sc) => runInJsdom(fx, js, '__probe', sc),
      add: (d, n) => runInJsdom(fx, js, '__add', d, n),
    };
  };
  let real = null;
  try { real = app ? mk(app) : null; } catch (e) { missing.push('jsdom 대역 조립(' + e.message + ')'); }
  const need = () => { assert.ok(real, '대역을 세우지 못했다(판정 불가)'); return real; };
  test('개발 날짜 기본값①: 새 과제는 계약 날짜에서 개발 날짜를 채우고 안내를 보인다', () => checks.newFill(need().probe));
  test('개발 날짜 기본값①-b: 말일 붙이기는 MySQL INTERVAL 1 MONTH 와 같다(윤년 포함)', () => checks.clamp(need().add, need().probe));
  test('개발 날짜 기본값②: 손으로 넣은 값과 손으로 지운 칸은 다시 채우지 않는다', () => checks.manualWins(need().probe));
  test('개발 날짜 기본값③: 기존 과제 편집에서는 채우지 않는다', () => checks.editNoFill(need().probe));
  test('개발 날짜 기본값④: 시작 > 종료가 되면 아무것도 채우지 않고 안내를 보인다', () => checks.inverted(need().probe));

  const mutant = (from, to) => {
    assert.ok(app.includes(from), '변이 앵커가 없다(낡았다): ' + from);
    return mk(app.replace(from, to));
  };
  test('변이③: 기존 과제 차단 줄을 지우면 ③ 이 실패한다', () => {
    const m = mutant('  if(offEdUid) return;   // 기존 과제 편집: 채우지 않는다\n', '');
    assert.throws(() => checks.editNoFill(m.probe), /기존 과제/);
  });
  test('변이②: 손댐 표시를 안 세우면 ② 가 실패한다', () => {
    const m = mutant('  offEdDevTouched[k] = true;\n', '');
    assert.throws(() => checks.manualWins(m.probe), /손으로/);
  });
  test('변이④: 뒤집힌 범위 판정을 끄면 ④ 가 실패한다', () => {
    const m = mutant('  if(ns && ne && ns > ne){', '  if(false){');
    assert.throws(() => checks.inverted(m.probe), /시작 > 종료|손으로 넣은 개발시작/);
  });
}

//  ⑧ 구분을 바꿔도 개발 날짜(자동으로 채운 값 포함)는 그대로다(PROJECT-ADMIN-UX §1.4, 2026-10-26).
//    옛 규칙(선진행으로 바꾸면 자동 개발 날짜를 비운다, 2026-10-23)은 선진행 잠금과 함께 없앴다. 구분, 상태, 날짜는 서로 독립이다.
//    구분 칸에는 바뀜 처리기가 없어야 하고, 선진행 번호(CODE_ID.SECTION_PRE)로 판정하는 코드도 없어야 한다.
function checkNoPreClear(src) {
  assert.ok(!/function\s+offEdApplySectionRule\s*\(/.test(src), '선진행 규칙 함수(offEdApplySectionRule)가 남아 있다');
  assert.ok(!/\$\('#offEdSection'\)[^\n]*addEventListener/.test(src), '구분 칸(#offEdSection)에 바뀜 처리기가 있다(구분을 바꾸면 다른 칸이 움직인다)');
  const code = src.replace(/^const CODE_ID = .*$/m, '');
  assert.ok(!/CODE_ID\.SECTION_PRE/.test(code), '선진행 번호(CODE_ID.SECTION_PRE)로 동작을 가르는 코드가 남아 있다');
}
test('개발 날짜 기본값⑧: 구분을 바꿔도 개발 날짜는 그대로다(선진행 규칙 없음, PROJECT-ADMIN-UX §1.4)', () => checkNoPreClear(app));
test('변이⑧: 구분 칸에 옛 바뀜 처리기를 되살리면 ⑧ 이 실패한다', () => {
  const anchor = "  ['#offEdStart', '#offEdEnd'].forEach(sel =>";
  assert.ok(app.includes(anchor), '변이 준비 실패(앵커가 낡았다)');
  const bad = app.replace(anchor, "  { const s = $('#offEdSection'); if(s) s.addEventListener('change', offEdClearPre); }\n" + anchor);
  assert.throws(() => checkNoPreClear(bad), /바뀜 처리기/);
  const bad2 = app.replace(anchor, "  if(codeIdOf(1) === CODE_ID.SECTION_PRE) offEdDevReset();\n" + anchor);
  assert.throws(() => checkNoPreClear(bad2), /SECTION_PRE/);
});
