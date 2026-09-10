// 보고 기록 배선 계약 — "전송이 성공했을 때 DB 저장이 실제로 불리는가" (설계 §5.9.9)
//
// 이 파일이 존재하는 이유:
//   loop-report-wiring.mjs 는 ReportDb 가 '불렸을 때' 무엇을 쓰는지를 반복 검증한다.
//   그러나 **불리는가** 는 검증하지 못한다 — 그 링크는 NetcusService 안에 있고, 실제로
//   확인하려면 netcus 로 진짜 보고서를 쏴야 하기 때문이다. 그건 회사 시스템에 가짜 보고를
//   남기거나 사람이 쓴 기존 보고를 덮어쓴다. 테스트가 그래선 안 된다.
//
//   그래서 호출 지점을 **구조로** 못박는다. 이 저장소가 이미 쓰는 방식이다
//   (attendance-unrecorded.test.mjs 의 변이⑥ 이 같은 파일을 같은 방식으로 잠근다).
//
// 잠그는 계약 여섯:
//   ① 일간 저장은 vr==1(전송 성공 + 되읽어 검증) 분기 **안에서만** 불린다
//   ② 미제출(DryRun)은 그 앞에서 return 한다 — 테스트 모드가 DB 를 건드리면 안 된다
//   ③ 저장 실패가 전송을 깨지 않는다(호스트 훅은 void — 예외를 위로 던지지 않는다)
//   ④ 주간 저장은 폼 채우기 성공 뒤에 불린다
//   ⑤ 웹→호스트 경계가 hours 를 실어 나른다(파싱이 아니라 전달 · §5.9.3)
//   ⑥ 앱 계정에 세 표의 권한이 있다 — 없으면 런타임 ERROR 1142 로 죽는다
//   ⑨ (2026-09-10) 쓰기 직전에 09-09 CHECK 도메인 셋(근태코드·잔업·공수)을 호스트가 한 번 더 거른다.
//     값 하나가 3819 를 내면 **그 날 보고 저장 트랜잭션 전체가 롤백**되는데, 전송은 이미 성공한 뒤다
//     (ReportDb 가 "가장 나쁜 실패"라고 적어 둔 자리). 그래서 도메인 밖 값은 기록 직전에 안전한 값으로 내린다.
import { readFileSync } from 'node:fs';
import { test, assert, loadAppSource } from './harness.mjs';
import { canonSql, canonStatusCodes } from './canon-schema.mjs';

const src = loadAppSource();
const netcus = readFileSync(new URL('../widget/NetcusService.cs', import.meta.url), 'utf8');
const mainwin = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
const reportdb = readFileSync(new URL('../widget/ReportDb.cs', import.meta.url), 'utf8');
const grants = readFileSync(new URL('../db/deploy/grants-calendar.sql', import.meta.url), 'utf8');

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

// ── 검사기 ───────────────────────────────────────────────────────────
// NetcusSubmit 본문만 잘라낸다(다른 메서드의 우연한 일치를 배제).
function submitBody(cs) {
  const i = cs.indexOf('private async Task NetcusSubmit(');
  assert.ok(i > 0, 'NetcusSubmit 을 찾지 못했다');
  const j = cs.indexOf('private async Task NetcusWeekFill(', i);
  assert.ok(j > i, 'NetcusWeekFill 을 찾지 못했다(경계 없음)');
  return cs.slice(i, j);
}

const checks = {
  // ① 일간 저장이 vr==1 분기 안에 있다
  dailySaveInsideVerified(cs) {
    const b = submitBody(cs);
    const call = b.indexOf('_host.SaveDailyReport(');
    assert.ok(call > 0, 'NetcusSubmit 안에서 SaveDailyReport 호출을 찾지 못했다 — 배선이 끊겼다');
    const branch = b.indexOf('else if (vr == 1)');
    assert.ok(branch > 0, 'vr == 1 분기를 찾지 못했다');
    assert.ok(call > branch, '저장 호출이 vr==1 분기보다 앞에 있다 — 실패한 전송도 기록된다');
    // 분기 블록의 끝을 찾아 그 안에 있는지 확인(중괄호 균형)
    let k = b.indexOf('{', branch), depth = 0, end = -1;
    for (let p = k; p < b.length; p++) {
      if (b[p] === '{') depth++;
      else if (b[p] === '}') { depth--; if (depth === 0) { end = p; break; } }
    }
    assert.ok(end > 0, 'vr==1 분기의 끝을 찾지 못했다');
    assert.ok(call < end, '저장 호출이 vr==1 분기 밖에 있다 — 검증되지 않은 전송도 기록된다');
  },

  // ② 미제출(DryRun)은 저장에 도달할 수 없다
  dryRunReturnsBeforeSave(cs) {
    const b = submitBody(cs);
    //  ★ 'if (req.DryRun)' 으로 블록을 찾으면 안 된다 — 같은 조건문이 위쪽에 한 줄짜리로 또 있어서
    //    (detach 정리) 검사 구역이 통째로 어긋난다. 그러면 그 넓은 구역에 우연히 들어온 다른
    //    return 들 때문에 **검사가 무의미하게 통과한다**(2026-08-31 실측 — 변이③ 이 잡았다).
    //    미제출 통지 문구가 그 블록의 유일한 표식이므로 거기에 고정한다.
    const msgAt = b.indexOf('NetcusResult(true, "미제출');
    assert.ok(msgAt > 0, '미제출(테스트) 통지를 찾지 못했다 — DryRun 분기가 사라졌나');
    const call = b.indexOf('_host.SaveDailyReport(');
    assert.ok(call > 0, 'SaveDailyReport 호출을 찾지 못했다');
    assert.ok(msgAt < call, 'DryRun 분기가 저장 호출보다 뒤에 있다 — 순서가 뒤집혔다');
    // 통지와 블록 닫는 괄호 사이에 return 이 있어야 아래(실제 제출·저장)로 못 내려간다
    const tail = b.slice(msgAt, b.indexOf('}', msgAt));
    assert.ok(/\breturn\s*;/.test(tail),
      'DryRun 블록에 return 이 없다 — 미제출(테스트) 모드가 DB 에 기록하게 된다');
  },

  // ③ 저장 실패가 전송을 깨지 않는다
  saveNeverBreaksSend(cs, rdb) {
    assert.ok(/void SaveDailyReport\(/.test(cs) && /void SaveWeeklyReport\(/.test(cs),
      '호스트 훅이 void 가 아니다 — 저장 실패가 전송 흐름으로 전파될 수 있다');
    // ReportDb 의 두 공개 메서드가 각각 catch 를 갖는다
    for (const m of ['SaveDailyAsync', 'SaveWeeklyAsync']) {
      const i = rdb.indexOf('public async Task<bool> ' + m);
      assert.ok(i > 0, `${m} 을 찾지 못했다`);
      const seg = rdb.slice(i, i + 6000);
      assert.ok(/catch \(Exception ex\)/.test(seg) && /return false;/.test(seg),
        `${m} 이 예외를 잡아 false 로 돌려주지 않는다 — 전송 성공 뒤에 예외를 던지면 사용자가 재전송한다`);
    }
  },

  // ④ 주간 저장은 폼 채우기 성공 뒤에 불린다
  weeklySaveAfterFill(cs) {
    const i = cs.indexOf('private async Task NetcusWeekFill(');
    assert.ok(i > 0, 'NetcusWeekFill 을 찾지 못했다');
    const b = cs.slice(i, i + 12000);
    const okMsg = b.indexOf('주간보고 작성 폼을 채웠습니다');
    const call = b.indexOf('_host.SaveWeeklyReport(');
    assert.ok(call > 0, 'NetcusWeekFill 안에서 SaveWeeklyReport 호출을 찾지 못했다 — 배선이 끊겼다');
    assert.ok(okMsg > 0 && call > okMsg,
      '주간 저장이 폼 채우기 성공 통지보다 앞에 있다 — 실패한 채우기도 기록된다');
    // 채우기 실패 경로(return)보다 뒤여야 한다
    const failRet = b.indexOf('주간보고 폼 채우기 실패');
    assert.ok(failRet > 0 && call > failRet, '저장이 채우기 실패 분기보다 앞에 있다');
  },

  // ⑤ 웹→호스트 경계가 hours 를 실어 나른다
  hoursCrossesBoundary(app, cs) {
    // 웹: 페이로드를 만들 때 getTaskHours 로 구조화한다(본문 되파싱이 아니다)
    assert.ok(/const rptHours = \(state\.categories \|\| \[\]\)/.test(app),
      '웹이 hours 를 만들지 않는다 — 호스트가 본문을 되파싱하게 되어 전각 콜론·&nbsp; 문제를 다시 만난다');
    assert.ok(/getTaskHours\(from, c && c\.id\)/.test(app),
      'hours 를 getTaskHours 에서 가져오지 않는다 — 이미 아는 값을 다시 파싱하는 셈이다');
    assert.ok(/hours: p\.hours \|\| \[\]/.test(app),
      '어댑터가 hours 를 호스트로 넘기지 않는다');
    // 호스트: 받아서 SubmitDaily 로 넘긴다
    assert.ok(/TryGetProperty\("hours", out var hrsEl\)/.test(cs),
      '호스트가 hours 를 읽지 않는다');
    assert.ok(/req\.HoursJson/.test(readFileSync(new URL('../widget/NetcusService.cs', import.meta.url), 'utf8')),
      'NetcusService 가 HoursJson 을 저장 호출로 넘기지 않는다');
  },

  // ⑥ 앱 계정 권한 — 없으면 런타임 ERROR 1142
  grantsCoverReportTables(sqlText) {
    const need = [
      [/GRANT[^;]*INSERT[^;]*ON\s+taskmgr\.cal_report_daily/i, 'cal_report_daily INSERT'],
      [/GRANT[^;]*UPDATE[^;]*ON\s+taskmgr\.cal_report_daily/i, 'cal_report_daily UPDATE'],
      [/GRANT[^;]*INSERT[^;]*ON\s+taskmgr\.cal_report_hours/i, 'cal_report_hours INSERT'],
      [/GRANT[^;]*DELETE[^;]*ON\s+taskmgr\.cal_report_hours/i, 'cal_report_hours DELETE(재삽입 계약)'],
      [/GRANT[^;]*INSERT[^;]*ON\s+taskmgr\.cal_report_weekly/i, 'cal_report_weekly INSERT'],
    ];
    for (const [re, what] of need)
      assert.ok(re.test(sqlText), `grants-calendar.sql 에 ${what} 권한이 없다 — 배선이 ERROR 1142 로 죽는다`);
  },

  // ⑨ 쓰기 직전 재검증 — 도메인은 **정본에서** 온다(값을 시험에도 호스트에도 박제하지 않는다).
  revalidatesCheckDomains(mainCs, rdb, canonText, canonCodes) {
    // (a) 근태 코드 집합 = 정본 chk_crd_status
    const m = /private static readonly string\[\] ReportStatusCodes\s*=\s*\{([\s\S]*?)\};/.exec(mainCs);
    assert.ok(m, 'MainWindow 에서 ReportStatusCodes 배열을 찾지 못했다 — 이름이 바뀌었다면 여기도 함께 고칠 것(판정 불가)');
    const host = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    assert.deepStrictEqual([...host].sort(), [...canonCodes].sort(),
      `호스트의 근태 코드 집합이 정본(chk_crd_status)과 다르다.\n  정본: [${canonCodes.join(', ')}]\n  호스트: [${host.join(', ')}]\n` +
      '  집합 밖 값이 그대로 내려가면 3819 로 그 날 보고 저장이 통째로 롤백된다 — 전송은 이미 나간 뒤라 가장 나쁜 실패다.');
    assert.ok(/Array\.IndexOf\(ReportStatusCodes, v\) >= 0/.test(mainCs),
      '근태 코드를 집합과 대조하지 않는다 — 배열이 장식이 된다');
    assert.ok(/private string SafeReportStatus\([\s\S]{0,400}?return "";/.test(mainCs),
      "집합 밖 근태 코드를 ''(미기록)으로 내리지 않는다 — 3819 로 그 날 기록 전체가 사라진다");

    // (b) 잔업 범위 = 정본 chk_crd_overtime (숫자를 시험에 적지 않는다)
    const ot = /CONSTRAINT\s+chk_crd_overtime\s+CHECK\s*\(\s*overtime\s*>=\s*(\d+)\s+AND\s+overtime\s*<=\s*(\d+)\s*\)/i.exec(canonText);
    assert.ok(ot, '정본에서 chk_crd_overtime 의 범위를 읽지 못했다(판정 불가 ≠ 통과)');
    assert.ok(new RegExp('overtime >= ' + ot[1] + ' && overtime <= ' + ot[2]).test(mainCs),
      `호스트의 잔업 검증이 정본 범위(${ot[1]}~${ot[2]})와 다르다 — 범위 밖 값이 3819 를 낸다`);
    assert.ok(/private int SafeOvertime\([\s\S]{0,300}?return 0;/.test(mainCs),
      '범위 밖 잔업을 0 으로 내리지 않는다');

    // (c) 두 검증이 **저장 호출 앞**에 실제로 끼어 있고, 내린 값이 저장으로 간다(안 그러면 장식이다).
    const i = mainCs.indexOf('void INetcusHost.SaveDailyReport(');
    assert.ok(i > 0, 'INetcusHost.SaveDailyReport 를 찾지 못했다');
    const hook = mainCs.slice(i, i + 1600);
    assert.ok(/SafeReportStatus\(status\)/.test(hook) && /SafeOvertime\(overtime\)/.test(hook),
      '저장 훅이 재검증을 부르지 않는다 — 웹이 보낸 값이 그대로 DB 로 간다');
    assert.ok(/SaveDailyAsync\(loginId, y, m, d, st, ot, content, hours\)/.test(hook),
      '재검증한 값(st·ot)이 아니라 원본을 저장한다 — 검증이 장식이 된다');

    // (d) 공수 줄은 CHECK 범위 밖이면 **버린다**(줄 하나 때문에 그 날 기록 전체를 잃지 않게).
    const h = /CONSTRAINT\s+chk_crh_hours\s+CHECK\s*\(\s*hours\s*>\s*(\d+)\s+AND\s+hours\s*<=\s*(\d+)\s*\)/i.exec(canonText);
    assert.ok(h, '정본에서 chk_crh_hours 의 범위를 읽지 못했다(판정 불가 ≠ 통과)');
    assert.ok(new RegExp('h <= ' + h[1] + ' \\|\\| h > ' + h[2]).test(mainCs),
      `ParseHoursJson 이 정본 범위(${h[1]} 초과 ~ ${h[2]} 이하) 밖 줄을 버리지 않는다 — 그 한 줄이 그 날 저장 전체를 롤백시킨다`);
    assert.ok(new RegExp('h\\.Hours > ' + h[2]).test(rdb),
      `ReportDb 의 마지막 관문이 상한(${h[2]})을 보지 않는다 — 들어오는 자리와 저장하는 자리가 같은 판정을 해야 한다`);
  },
};

// ── 계약 ─────────────────────────────────────────────────────────────
test('배선①: 일간 저장은 vr==1(전송 성공+되읽어 검증) 분기 안에서만 불린다', () => {
  checks.dailySaveInsideVerified(netcus);
});

test('배선②: 미제출(DryRun)은 저장에 도달하지 못한다', () => {
  checks.dryRunReturnsBeforeSave(netcus);
});

test('배선③: 저장 실패가 전송을 깨지 않는다(훅은 void · ReportDb 가 예외를 잡는다)', () => {
  checks.saveNeverBreaksSend(netcus, reportdb);
});

test('배선④: 주간 저장은 폼 채우기 성공 뒤에 불린다', () => {
  checks.weeklySaveAfterFill(netcus);
});

test('배선⑤: hours 가 웹→호스트 경계를 그대로 건넌다(파싱이 아니라 전달)', () => {
  checks.hoursCrossesBoundary(src, mainwin);
});

test('배선⑥: 앱 계정에 보고 3표 권한이 있다', () => {
  checks.grantsCoverReportTables(grants);
});

test('배선⑦: ReportDb 는 쓰기 격리수준(READ-COMMITTED)을 쓴다', () => {
  //  ★ 파일 전체에서 REPEATABLE-READ 를 금지하면 안 된다 — 주석에 '읽기와 합치지 말 것'
  //    경고로 그 낱말이 **있어야** 정상이다(그게 이 설계의 핵심 경고다). 프리앰블 상수만 본다.
  const m = /WritePreambleSql\s*=([\s\S]*?);/.exec(reportdb);
  assert.ok(m, 'WritePreambleSql 상수를 찾지 못했다');
  assert.ok(/transaction_isolation='READ-COMMITTED'/.test(m[1]),
    '쓰기 프리앰블이 READ-COMMITTED 가 아니다 — 읽기(REPEATABLE-READ)와 섞이면 조용히 틀린다(설계 §3.2)');
  assert.ok(!/REPEATABLE-READ/.test(m[1]),
    '쓰기 프리앰블에 읽기 격리수준이 들어 있다 — 둘이 섞였다');
});

test('배선⑧: 시간줄은 그 날짜를 비우고 다시 넣는다(사라진 줄이 남지 않게)', () => {
  assert.ok(/DELETE FROM cal_report_hours WHERE user_id=@u AND work_date=@dt/.test(reportdb),
    '재삽입 전 DELETE 가 없다 — 재전송 때 사라진 줄이 그대로 남는다');
  const i = reportdb.indexOf('DELETE FROM cal_report_hours');
  const j = reportdb.indexOf('INSERT INTO cal_report_hours');
  assert.ok(i > 0 && j > i, 'DELETE 가 INSERT 보다 뒤에 있다 — 방금 넣은 줄을 지운다');
  assert.ok(/BeginTransactionAsync/.test(reportdb) && /CommitAsync/.test(reportdb),
    'DELETE→INSERT 가 한 트랜잭션이 아니다 — 중간에 죽으면 시간줄이 통째로 사라진다');
});

// ── 변이 시험 — 위 검사가 정말 잡는지 ───────────────────────────────
test('변이①: 저장 호출을 vr==1 밖으로 빼면 배선① 이 실패한다', () => {
  //  ★ 위젯 C# 소스는 CRLF 다 — 변이 문자열에 '\n' 을 쓰면 절대 일치하지 않는다(2026-08-31 실측).
  //    줄바꿈은 정규식으로만 다루고, 들여쓰기는 원본에서 그대로 떠 온다.
  const m = /([ \t]*)else if \(vr == 1\)/.exec(netcus);
  assert.ok(m, 'vr == 1 분기를 찾지 못했다');
  const inject = m[1] + '_host.SaveDailyReport(req.Y, req.M, req.D, req.Status, req.Overtime, req.Content, req.HoursJson);\r\n' + m[0];
  const bad = netcus.slice(0, m.index) + inject + netcus.slice(m.index + m[0].length);
  assert.notStrictEqual(bad, netcus, '변이가 원본을 바꾸지 못했다');
  assert.throws(() => checks.dailySaveInsideVerified(bad), /vr==1 분기보다 앞에 있다|분기 밖에 있다/);
});

test('변이②: 저장 호출을 지우면 배선① 이 실패한다(배선 끊김)', () => {
  const bad = mutate('_host.SaveDailyReport(req.Y, req.M, req.D, req.Status, req.Overtime, req.Content, req.HoursJson);',
    '// 지워짐', netcus);
  assert.throws(() => checks.dailySaveInsideVerified(bad), /배선이 끊겼다/);
});

test('변이③: DryRun 의 return 을 빼면 배선② 가 실패한다(테스트 모드가 DB 를 건드린다)', () => {
  //  ★ 'if (req.DryRun)' 에 고정하면 안 된다 — 같은 조건문이 위쪽에 한 줄짜리로 또 있어서
  //    (detach 정리) 엉뚱한 return 을 집는다(2026-08-31 실측). 미제출 메시지에 고정한다.
  const m = /(NetcusResult\(true, "미제출[\s\S]*?)\breturn\s*;/.exec(netcus);
  assert.ok(m, 'DryRun 블록의 return 을 찾지 못했다');
  const bad = netcus.slice(0, m.index) + m[1] + '/* return 제거 */' + netcus.slice(m.index + m[0].length);
  assert.notStrictEqual(bad, netcus, '변이가 원본을 바꾸지 못했다');
  assert.throws(() => checks.dryRunReturnsBeforeSave(bad), /return 이 없다/);
});

test('변이④: 주간 저장을 채우기 성공 통지 앞으로 옮기면 배선④ 가 실패한다', () => {
  const call = '                _host.SaveWeeklyReport(req.Sdate, req.Edate, req.Subject, req.Content, req.Endwork, req.Planwork);';
  const msg = '                NetcusResult(true, "주간보고 작성 폼을 채웠습니다';
  assert.ok(netcus.includes(call), '주간 저장 호출을 찾지 못했다');
  const bad = mutate(msg, call + '\n' + msg, netcus).replace(call + '\n', (m, off) => off > netcus.indexOf(msg) ? '' : m);
  // 위 치환이 애매하면 단순히 호출을 지운 변이로 대체(둘 다 배선④ 를 깨야 한다)
  const bad2 = mutate(call, '                // 옮겨짐', netcus);
  assert.throws(() => checks.weeklySaveAfterFill(bad2), /배선이 끊겼다/);
});

test('변이⑤: 웹이 hours 를 안 실으면 배선⑤ 가 실패한다', () => {
  const bad = mutate('hours: p.hours || []', 'dummy: 0', src);
  assert.throws(() => checks.hoursCrossesBoundary(bad, mainwin), /호스트로 넘기지 않는다/);
});

test('변이⑥: 호스트가 hours 를 안 읽으면 배선⑤ 가 실패한다', () => {
  const bad = mutate('TryGetProperty("hours", out var hrsEl)', 'TryGetProperty("nope", out var hrsEl)', mainwin);
  assert.throws(() => checks.hoursCrossesBoundary(src, bad), /hours 를 읽지 않는다/);
});

test('변이⑦: cal_report_hours 의 DELETE 권한을 빼면 배선⑥ 이 실패한다', () => {
  const bad = mutate('GRANT SELECT, INSERT, UPDATE, DELETE ON taskmgr.cal_report_hours',
    'GRANT SELECT, INSERT, UPDATE ON taskmgr.cal_report_hours', grants);
  assert.throws(() => checks.grantsCoverReportTables(bad), /DELETE\(재삽입 계약\) 권한이 없다/);
});

// ── 계약⑨ (2026-09-10) — 쓰기 직전 재검증 ────────────────────────────
test('배선⑨: 근태코드·잔업·공수를 쓰기 직전에 정본 CHECK 도메인으로 한 번 더 거른다', () => {
  checks.revalidatesCheckDomains(mainwin, reportdb, canonSql(), canonStatusCodes('chk_crd_status'));
});

test('변이⑧: 호스트의 근태 코드 집합에서 하나를 빼면 배선⑨ 가 실패한다(정본 파생이 아니면 통과할 변이)', () => {
  const bad = mutate('"", "1", "2",', '"", "1",', mainwin);
  assert.throws(() => checks.revalidatesCheckDomains(bad, reportdb, canonSql(), canonStatusCodes('chk_crd_status')),
    /근태 코드 집합이 정본/);
  assert.doesNotThrow(() => checks.revalidatesCheckDomains(mainwin, reportdb, canonSql(), canonStatusCodes('chk_crd_status')));
});

test('변이⑨: 재검증한 값 대신 원본을 저장하면 배선⑨ 가 실패한다(검증이 장식이 된다)', () => {
  const bad = mutate('SaveDailyAsync(loginId, y, m, d, st, ot, content, hours)',
    'SaveDailyAsync(loginId, y, m, d, status, overtime, content, hours)', mainwin);
  assert.throws(() => checks.revalidatesCheckDomains(bad, reportdb, canonSql(), canonStatusCodes('chk_crd_status')),
    /재검증한 값\(st·ot\)이 아니라 원본을 저장한다/);
});

test('변이⑩: 공수 줄 필터를 옛 `h < 0` 으로 되돌리면 배선⑨ 가 실패한다(0·24 초과가 통과한다)', () => {
  const bad = mutate('if (h <= 0 || h > 24)', 'if (h < 0)', mainwin);
  assert.throws(() => checks.revalidatesCheckDomains(bad, reportdb, canonSql(), canonStatusCodes('chk_crd_status')),
    /정본 범위[\s\S]*밖 줄을 버리지 않는다/);
});

test('변이⑪: 잔업 상한을 정본과 다르게 넓히면 배선⑨ 가 실패한다', () => {
  const bad = mutate('overtime >= 0 && overtime <= 11', 'overtime >= 0 && overtime <= 24', mainwin);
  assert.throws(() => checks.revalidatesCheckDomains(bad, reportdb, canonSql(), canonStatusCodes('chk_crd_status')),
    /잔업 검증이 정본 범위/);
});
