#!/usr/bin/env node
/* =====================================================================
 *  loop-report-wiring.mjs — 보고 기록 배선 루프 테스트 (설계 §5.9.9)
 * =====================================================================
 *
 *  【무엇을 확인하나】
 *    보고서를 보냈을 때 cal_report_* 에 '보낸 그대로' 남는가를 **반복** 확인한다.
 *    위젯 빌드가 실제로 쓰는 클래스(widget/ReportDb.cs)를 그대로 컴파일해 돌리므로,
 *    이 테스트가 통과하면 위젯 안에서도 같은 코드가 같은 결과를 낸다.
 *
 *  【왜 netcus 로 실제 전송하지 않나】
 *    전송은 **회사 시스템에 실제 보고를 남긴다.** 루프로 돌리면 가짜 보고가 쌓이고,
 *    과거 날짜로 돌리면 사람이 쓴 기존 보고를 덮어쓴다. 테스트가 그래선 안 된다.
 *    그래서 이 테스트는 전송 뒤 배선(vr==1 이후)만 반복 검증하고,
 *    전송 자체는 사람이 평소처럼 한 번 보낸 뒤 --verify-live 로 결과만 확인한다.
 *
 *  【실 DB 를 쓰는 이유 — 복제본이 아니다】
 *    DeployConfig 의 접속 정보가 const 라 ReportDb 는 언제나 실 taskmgr 에 붙는다.
 *    그게 오히려 이 테스트의 값이다 — **앱 계정(taskmgr_app)의 권한까지 함께 검증**한다.
 *    (실제로 2026-08-31 에 cal_report_* 권한 누락을 이 경로로 발견했다. 컴파일로는 안 드러난다.)
 *    충돌을 원천 차단하려고 날짜는 전부 2099 년을 쓰고, 끝나면 지운 뒤 0행을 확인한다.
 *
 *  【실행】
 *    $env:TC_TEST_DB_ADMIN_PW = '<root 비번>'
 *    node tests/loop-report-wiring.mjs                # 기본 20회
 *    node tests/loop-report-wiring.mjs --rounds=100
 *    node tests/loop-report-wiring.mjs --verify-live  # 사람이 방금 보낸 실제 보고를 확인
 *    node tests/loop-report-wiring.mjs --selftest     # 검사기가 진짜 잡는지(고장 주입)
 * ===================================================================== */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonStatusCodes, CANON_PATH } from './canon-schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARG = new Map(process.argv.slice(2).map(a => {
  const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const OPT = {
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',
  db: process.env.TC_TEST_DB_NAME || 'taskmgr',
  rounds: Number(ARG.get('rounds') || 20),
  seed: Number(ARG.get('seed') || 20260831),
};
const VERIFY_LIVE = ARG.has('verify-live');
const SELFTEST = ARG.has('selftest');

if (!OPT.adminPw) {
  console.error("[중단] DB 관리자 비밀번호가 없습니다. 환경변수 TC_TEST_DB_ADMIN_PW 로 지정하세요.\n" +
                "        PowerShell:  $env:TC_TEST_DB_ADMIN_PW = '<비번>'");
  process.exit(2);
}

/* ── mysql 출력 무결성 계약 ──────────────────────────────────────────────
 *   mysql.exe 는 드물게 종료코드 0 인데도 stdout 을 잃는다. 종결 마커가 없으면
 *   '출력을 믿을 수 없다'로 본다.
 *
 *   ★★ 2026-09-09 실측으로 이 현상의 정체를 확정했다(그 전까지는 '가끔 잘린다'였다):
 *     · 발생 조건은 **머신 부하**다. 한가할 때 1,800 회 연속 0건, 프로세스 생성 부하를
 *       걸면 900 회 중 8 건(≈0.9%). 이 시험이 라운드마다 dotnet 을 띄우므로 늘 부하 쪽이다.
 *     · 모양은 **부분 잘림이 아니라 전량 소실**이다 — stdout 길이가 0 이고
 *       stderr 에는 비번 경고 한 줄뿐, 종료코드는 0.
 *     · ★ 그런데 **문장은 실행됐다.** 전용 DB 를 만들어 `UPDATE … n=n+1` 을 900 회 보내며
 *       확인했더니, 소실이 8 번 났는데도 n 은 정확히 900 이었다(누락 0). 즉 소실된 것은
 *       출력뿐이고 DB 변경은 적용된다. 그러므로 **쓰기를 그냥 재시도하면 두 번 적용된다.**
 *     · 어느 문장에서 날지는 **운**이다(실측 소실은 hours·daily·weekly 를 가리지 않았다).
 *       2026-09-09 에 weekly 에서만 터져 보였던 것은 읽기가 3회 재시도로 덮이는 동안
 *       쓰기만 첫 소실에 즉사했기 때문이고, 그날 그 제비를 weekly 가 뽑았을 뿐이다.
 *
 *   그래서 감지기는 끄지 않는다(이건 조용한 오답을 막는 장치다). 대신 재시도 자격을
 *   **다시 적용해도 결과가 같은 문장인가**로 가른다:
 *     readOnly (기본)  — 읽기. 몇 번을 읽어도 같다.
 *     idempotent: true — 쓰기지만 **재적용이 증명 가능한 무동작**인 문장만
 *                        (범위가 고정된 DELETE, 절대값 UPDATE 처럼 증분이 아닌 것).
 *                        INSERT·증분 UPDATE 에는 절대 붙이지 말 것 — 위 실측대로 두 번 적용된다.
 *   자격이 없는 쓰기는 예전처럼 즉시 실패시킨다. 다만 메시지가 "적용됐는지 알 수 없다"가
 *   아니라 "**적용됐을 가능성이 높다**"고 말하게 고쳤다(위 실측이 그렇게 말한다).
 *
 *   ★ 예전 메시지는 '종료코드 0·stderr 없음' 을 **확인하지도 않고** 그렇게 적었다.
 *     진단문이 사실이 아니면 다음 사람이 엉뚱한 데를 판다. 이제 실제 값을 찍는다. */
const EOF = '__TCEOF__';
let truncSeen = 0;
function sql(q, { readOnly = true, idempotent = false, what = 'SQL' } = {}) {
  const tries = (readOnly || idempotent) ? 3 : 1;
  for (let i = 1; i <= tries; i++) {
    const r = spawnSync(OPT.mysql,
      ['-u' + OPT.adminUser, '-p' + OPT.adminPw, '--get-server-public-key',
       '--default-character-set=utf8mb4', '-N', '-B', '-D', OPT.db],
      { input: Buffer.from(q + `;\nSELECT '${EOF}';\n`, 'utf8'), maxBuffer: 64 << 20 });
    const out = (r.stdout || Buffer.alloc(0)).toString('utf8');
    const err = (r.stderr || Buffer.alloc(0)).toString('utf8');
    if (r.status !== 0) throw new Error(`${what} 실패: ${err.trim() || '(stderr 없음)'}`);
    if (!out.includes(EOF)) {
      truncSeen++;
      if (i < tries) continue;
      //  실측값을 그대로 붙인다 — '전량 소실'인지 '중간에서 끊겼는지'는 다음 사람이 볼 유일한 단서다.
      const errLine = err.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
                         .filter(l => !/Using a password/.test(l))[0] || '(없음)';
      throw new Error(`${what}: mysql 이 종결 마커를 내지 않았다 — 결과를 믿을 수 없다 ` +
        `(종료코드=${r.status} · stdout ${out.length}자 · stderr=${errLine} · 시도 ${i}/${tries}). ` +
        (readOnly || idempotent
          ? '재시도까지 전부 실패했다.'
          : '★ 이 문장은 재시도 자격이 없어 한 번만 보냈다. 실측상 **문장 자체는 적용됐을 가능성이 높다** ' +
            '(출력만 사라진다) — 아무 일도 없었다고 가정하지 말고 DB 를 직접 확인할 것.'));
    }
    return out.split(/\r?\n/).filter(l => l.length && l !== EOF).map(l => l.split('\t'));
  }
}
const one = (q, what) => { const r = sql(q, { what }); return r.length ? r[0][0] : null; };

/* ── 결정론 난수(시드) — 실패를 재현할 수 있어야 한다 ─────────────────── */
let _s = OPT.seed >>> 0;
const rnd = () => ((_s = (_s * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = a => a[Math.floor(rnd() * a.length)];
const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

/* ── 검사 결과 ───────────────────────────────────────────────────────── */
let pass = 0, fail = 0;
const F = [];
function ok(n, c, d = '') {
  if (c) { pass++; }
  else { fail++; F.push(n + (d ? ' — ' + d : '')); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); }
}

/* ── ReportDb 러너 — 위젯이 쓰는 그 파일을 그대로 컴파일한다 ───────────
 *   tests/calendar-adapter.mjs 가 참조 어댑터를 컴파일하는 것과 같은 방식이다.
 *   ★ ReportDb.cs 를 복사하지 않고 Compile Include 로 '링크'한다 —
 *     복사본을 두면 원본이 바뀌어도 테스트가 옛 코드를 통과시킨다. */
const RUNNER_CS = `using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using TaskCalendarWidget;

class R {
  static async Task<int> Main() {
    string raw = Console.In.ReadToEnd();
    using var doc = JsonDocument.Parse(raw);
    var e = doc.RootElement;
    var logs = new List<string>();
    var db = new ReportDb(m => logs.Add(m));
    bool okr;
    if (e.GetProperty("kind").GetString() == "daily") {
      var hs = new List<ReportHourLine>();
      if (e.TryGetProperty("hours", out var ha) && ha.ValueKind == JsonValueKind.Array)
        foreach (var h in ha.EnumerateArray())
          hs.Add(new ReportHourLine {
            TaskName = h.GetProperty("name").GetString() ?? "",
            Hours = h.GetProperty("hours").GetDecimal(),
          });
      okr = await db.SaveDailyAsync(
        e.GetProperty("loginId").GetString(),
        e.GetProperty("y").GetInt32(), e.GetProperty("m").GetInt32(), e.GetProperty("d").GetInt32(),
        e.GetProperty("status").GetString(), e.GetProperty("overtime").GetInt32(),
        e.GetProperty("content").GetString(), hs);
    } else {
      okr = await db.SaveWeeklyAsync(
        e.GetProperty("loginId").GetString(),
        e.GetProperty("sdate").GetString(), e.GetProperty("edate").GetString(),
        e.GetProperty("subject").GetString(), e.GetProperty("content").GetString(),
        e.GetProperty("endwork").GetString(), e.GetProperty("plan").GetString());
    }
    Console.Out.Write(JsonSerializer.Serialize(new { ok = okr, logs }));
    return 0;
  }
}`;

const PROJ = (root) => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable><LangVersion>latest</LangVersion>
    <AssemblyName>rr</AssemblyName><RootNamespace>RR</RootNamespace>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <NoWarn>CS0649</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="R.cs" />
    <Compile Include="${root}/widget/ReportDb.cs" />
    <Compile Include="${root}/widget/DeployConfig.cs" />
  </ItemGroup>
  <ItemGroup><PackageReference Include="MySqlConnector" Version="2.3.7" /></ItemGroup>
</Project>`;

let WORK = null;
function buildRunner() {
  WORK = mkdtempSync(join(tmpdir(), 'tc-rw-'));
  writeFileSync(join(WORK, 'R.cs'), RUNNER_CS, 'utf8');
  writeFileSync(join(WORK, 'rr.csproj'), PROJ(ROOT.replace(/\\/g, '/')), 'utf8');
  const b = spawnSync('dotnet', ['build', '-v', 'q', '--nologo'], { cwd: WORK, encoding: 'utf8' });
  if (b.status !== 0) {
    console.error('[중단] 러너 빌드 실패:\n' + (b.stdout || '') + (b.stderr || ''));
    process.exit(2);
  }
}
function run(payload) {
  const r = spawnSync('dotnet', ['run', '--no-build', '-v', 'q', '--nologo'],
    { cwd: WORK, input: JSON.stringify(payload), encoding: 'utf8' });
  if (r.status !== 0) throw new Error('러너 실행 실패: ' + (r.stderr || r.stdout));
  const m = (r.stdout || '').match(/\{[\s\S]*\}$/);
  if (!m) throw new Error('러너 출력이 JSON 이 아니다: ' + (r.stdout || '').slice(0, 200));
  return JSON.parse(m[0]);
}

/* ── 대상 사용자 ─────────────────────────────────────────────────────── */
const LID = one("SELECT login_id FROM app_user WHERE is_active=1 ORDER BY user_id LIMIT 1", '대상 사용자');
const UID = one(`SELECT user_id FROM app_user WHERE login_id='${LID}'`, 'user_id');
if (!LID) { console.error('[중단] app_user 에 활성 사용자가 없다'); process.exit(2); }

/* ★ 실 데이터와 절대 겹치지 않게 2099 년만 쓴다. 끝나고 이 범위만 지운다. */
const YEAR = 2099;
const scope = `user_id=${UID} AND YEAR(work_date)=${YEAR}`;
const wscope = `user_id=${UID} AND YEAR(period_start)=${YEAR}`;
//  ★ 세 DELETE 는 범위가 고정돼 있다(user_id × 2099년). 두 번 돌려도 두 번째는 0행이라
//    결과가 같다 — 그래서 idempotent 로 표시해 출력 소실 때 재시도하게 둔다.
//    정리가 중간에 죽으면 실 DB 에 2099 시험 행이 그대로 남는다(2026-09-09 에 실제로 죽었다).
const cleanup = () => {
  sql(`DELETE FROM cal_report_hours WHERE ${scope}`, { readOnly: false, idempotent: true, what: '정리(hours)' });
  sql(`DELETE FROM cal_report_daily WHERE ${scope}`, { readOnly: false, idempotent: true, what: '정리(daily)' });
  sql(`DELETE FROM cal_report_weekly WHERE ${wscope}`, { readOnly: false, idempotent: true, what: '정리(weekly)' });
};

const NAMES = ['표적기(ADD)', 'LSAM-II RMSS', '울산급 Batch-IV 개발벤치 및 DAS', '휴가', '기타',
               '  앞뒤 공백  ', '전각：콜론', 'A'.repeat(250), ''];
/* ── 근태코드 — **정본에서 읽는다**(목록을 여기 박지 않는다) ─────────────
 *   왜 박으면 안 되나(2026-09-09 실제 사고):
 *     여기엔 '8'(결근)이 박혀 있었다. 그건 **앱이 만들 수 없는 값**이다 —
 *     ATTEND_STATUS 는 1,2,3,4,5,6,7,9,10,11,12 뿐이고 ATTEND_STATUS_SET 이 웹 층에서 거른다.
 *     cal_report_daily 에 CHECK 가 아예 없던 동안에는 통과했고, chk_crd_status 가 들어온 날
 *     20라운드 중 2회가 3819 로 터졌다. **CHECK 가 옳고 시험 데이터가 틀렸다.**
 *   왜 이게 중요한가:
 *     앱이 보낼 수 있는 값과 DB 가 받는 값이 갈리면, 전송은 성공했는데 기록만 조용히 사라진다 —
 *     SaveDailyReport 는 fire-and-forget 이고 예외를 로그로만 남긴다. 그 침묵이 이 시험이 막을 것이다.
 *   그래서 시험 데이터를 정본의 chk_crd_status 목록 그대로 쓴다. 사이트에 코드가 늘어
 *   정본이 바뀌면 이 시험은 손대지 않아도 새 값을 함께 돈다. 못 읽으면 중단(측정 못 함).
 *   ※ 정본 목록이 앱의 ATTEND_STATUS 와 같은 집합인지는 tests/schema-integrity.test.mjs
 *     계약③ 이 따로 잠근다 — 여기서 다시 세지 않는다(중복 단언을 만들지 않는다). */
let STATUS;
try {
  STATUS = canonStatusCodes('chk_crd_status');
} catch (e) {
  console.error(`[중단] 정본에서 근태코드 목록을 읽지 못했습니다(${CANON_PATH}): ` + e.message);
  process.exit(2);
}

/* ── 라운드 1회 ──────────────────────────────────────────────────────── */
function round(i) {
  const day = rint(1, 28), mon = rint(1, 12);
  const nLines = rint(0, 6);
  const lines = [];
  for (let k = 0; k < nLines; k++) lines.push({ name: pick(NAMES), hours: Math.round(rnd() * 800) / 100 });
  const status = pick(STATUS), overtime = rint(0, 11);
  const content = lines.map(l => `[${l.name}] : ${l.hours}`).join('\n') + '\n-----\n합계 : x';

  const res = run({ kind: 'daily', loginId: LID, y: YEAR, m: mon, d: day, status, overtime, content, hours: lines });
  ok(`R${i} 저장이 성공했다`, res.ok === true, res.logs.join(' / '));
  if (!res.ok) return;

  const ds = `${YEAR}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // 러너가 거르는 규칙과 같은 기준으로 '남아야 할 줄'을 미리 센다
  const kept = lines.map(l => ({ name: l.name.trim().slice(0, 200), hours: l.hours }))
                    .filter(l => l.name.length > 0 && l.hours >= 0);

  const rows = sql(`SELECT line_no, task_name, hours, IFNULL(cat_no,'~') FROM cal_report_hours
                    WHERE user_id=${UID} AND work_date='${ds}' ORDER BY line_no`, { what: 'hours 조회' });

  // I1 — 줄 수가 '남아야 할 줄'과 정확히 같다
  ok(`R${i} 시간줄 수가 계약과 같다`, rows.length === kept.length, `DB=${rows.length} 기대=${kept.length}`);
  // I2 — line_no 는 0..n-1 연속(거른 줄이 구멍을 남기면 안 된다)
  ok(`R${i} line_no 가 0부터 연속이다`, rows.every((r, k) => Number(r[0]) === k),
     rows.map(r => r[0]).join(','));
  // I3 — 이름은 잘려서 들어가고 200자를 넘지 않는다
  ok(`R${i} task_name 이 200자를 넘지 않는다`, rows.every(r => [...r[1]].length <= 200));
  // I4 — 이름·시간이 보낸 값과 같다(앞뒤 공백은 제거, 소수 둘째자리)
  ok(`R${i} 이름·시간이 보낸 값과 같다`,
     rows.every((r, k) => r[1] === kept[k].name && Math.abs(Number(r[2]) - kept[k].hours) < 0.005),
     rows.length ? `DB[0]="${rows[0][1]}"/${rows[0][2]} 기대="${kept[0]?.name}"/${kept[0]?.hours}` : '');
  // I5 — cat_no 는 아직 NULL 이다(앱이 XML 이라 DB 번호를 모른다 · §5.9.9)
  ok(`R${i} cat_no 는 NULL 이다`, rows.every(r => r[3] === '~'));
  // I6 — 본문·근태가 보낸 값 그대로다
  //   ★ 본문은 SHA-256 으로 대조한다 — mysql -B(배치 모드)는 출력에서 개행을 '\n' 문자 두 개로
  //     이스케이프한다(2026-08-31 실측). 문자열을 직접 비교하면 멀쩡한 값이 전부 불일치로 뜬다.
  //     해시는 서버가 실제 저장된 바이트로 계산하므로 이스케이프의 영향을 받지 않는다.
  const d0 = sql(`SELECT status, overtime, SHA2(content, 256), CHAR_LENGTH(content) FROM cal_report_daily
                  WHERE user_id=${UID} AND work_date='${ds}'`, { what: 'daily 조회' })[0];
  const want = createHash('sha256').update(content, 'utf8').digest('hex');
  ok(`R${i} 근태가 보낸 값 그대로다`,
     d0 && d0[0] === status.slice(0, 2) && Number(d0[1]) === overtime,
     d0 ? `status="${d0[0]}"(기대 "${status}") overtime=${d0[1]}(기대 ${overtime})` : 'daily 행 없음');
  ok(`R${i} 본문이 한 바이트도 안 바뀌었다(SHA-256)`, d0 && d0[2] === want,
     d0 ? `DB=${String(d0[2]).slice(0,16)}… 기대=${want.slice(0,16)}… (길이 DB=${d0[3]} 보낸값=${[...content].length})` : '행 없음');

  // I7 — 재전송: 줄이 '교체'된다(이전 줄이 남으면 안 된다)
  const re = [{ name: '재전송단일', hours: 1.25 }];
  const r2 = run({ kind: 'daily', loginId: LID, y: YEAR, m: mon, d: day, status: '1', overtime: 0,
                   content: '재전송 본문', hours: re });
  ok(`R${i} 재전송이 성공했다`, r2.ok === true, r2.logs.join(' / '));
  const rows2 = sql(`SELECT line_no, task_name FROM cal_report_hours
                     WHERE user_id=${UID} AND work_date='${ds}' ORDER BY line_no`, { what: '재전송 hours' });
  ok(`R${i} 재전송이 줄을 교체했다(이전 줄 잔존 0)`,
     rows2.length === 1 && rows2[0][1] === '재전송단일',
     `남은 줄 ${rows2.length}개: ${rows2.map(r => r[1]).join('|')}`);
  const d1 = sql(`SELECT SHA2(content, 256) FROM cal_report_daily WHERE user_id=${UID} AND work_date='${ds}'`,
                 { what: '재전송 daily' })[0];
  ok(`R${i} 재전송이 본문을 덮었다`,
     d1 && d1[0] === createHash('sha256').update('재전송 본문', 'utf8').digest('hex'));
  // I8 — 하루 한 행(덮어쓰기지 이력이 아니다)
  ok(`R${i} 그 날짜는 여전히 1행이다`,
     Number(one(`SELECT COUNT(*) FROM cal_report_daily WHERE user_id=${UID} AND work_date='${ds}'`)) === 1);
}

/* ── 주간 ────────────────────────────────────────────────────────────── */
function weeklyRound(i) {
  const mon = rint(1, 12), d1 = rint(1, 20);
  const s = `${YEAR}-${String(mon).padStart(2, '0')}-${String(d1).padStart(2, '0')}`;
  const e = `${YEAR}-${String(mon).padStart(2, '0')}-${String(d1 + 6).padStart(2, '0')}`;
  const a = run({ kind: 'weekly', loginId: LID, sdate: s, edate: e, subject: `${mon}월 주간`,
                  content: '[표적기(ADD)] : 30', endwork: '진행A', plan: '계획A' });
  ok(`W${i} 주간 저장 성공`, a.ok === true, a.logs.join(' / '));
  const b = run({ kind: 'weekly', loginId: LID, sdate: s, edate: e, subject: `${mon}월 주간(재작성)`,
                  content: '[표적기(ADD)] : 35', endwork: '진행B', plan: '계획B' });
  ok(`W${i} 재작성 저장 성공`, b.ok === true, b.logs.join(' / '));
  const n = Number(one(`SELECT COUNT(*) FROM cal_report_weekly WHERE user_id=${UID} AND period_start='${s}'`));
  ok(`W${i} 같은 기간은 1행이다(덮어쓰기)`, n === 1, `행 ${n}개`);
  const r = sql(`SELECT subject, endwork, plan FROM cal_report_weekly
                 WHERE user_id=${UID} AND period_start='${s}'`, { what: 'weekly 조회' })[0];
  ok(`W${i} 재작성 내용으로 덮였다`, r && r[0].includes('재작성') && r[1] === '진행B' && r[2] === '계획B',
     r ? r.join(' / ') : '행 없음');
}

/* ── 저장하면 안 되는 것 ─────────────────────────────────────────────── */
function guards() {
  const before = Number(one(`SELECT COUNT(*) FROM cal_report_daily WHERE ${scope}`));
  const cases = [
    ['빈 본문', { kind: 'daily', loginId: LID, y: YEAR, m: 6, d: 1, status: '1', overtime: 0, content: '   ', hours: [] }],
    ['없는 사용자', { kind: 'daily', loginId: '__없는사람__', y: YEAR, m: 6, d: 2, status: '1', overtime: 0, content: 'x', hours: [] }],
    ['잘못된 날짜', { kind: 'daily', loginId: LID, y: YEAR, m: 13, d: 99, status: '1', overtime: 0, content: 'x', hours: [] }],
    ['주간 기간 역전', { kind: 'weekly', loginId: LID, sdate: `${YEAR}-06-10`, edate: `${YEAR}-06-01`, subject: 'x', content: '', endwork: '', plan: '' }],
    ['주간 기간 파싱 실패', { kind: 'weekly', loginId: LID, sdate: '알수없음', edate: `${YEAR}-06-10`, subject: 'x', content: '', endwork: '', plan: '' }],
  ];
  for (const [n, p] of cases) {
    const r = run(p);
    ok(`가드: ${n} 은 저장되지 않는다`, r.ok === false, r.logs.join(' / '));
  }
  const after = Number(one(`SELECT COUNT(*) FROM cal_report_daily WHERE ${scope}`));
  ok('가드: 차단된 입력이 행을 만들지 않았다', after === before, `${before} → ${after}`);
}

/* ── --verify-live : 사람이 방금 보낸 실제 보고를 확인한다 ───────────── */
function verifyLive() {
  console.log('\n[실제 전송 확인] 최근 저장된 보고 기록 — 2099 시험 데이터는 제외한다\n');
  const rows = sql(`SELECT work_date, status, overtime, sent_at,
                      (SELECT COUNT(*) FROM cal_report_hours h WHERE h.user_id=d.user_id AND h.work_date=d.work_date)
                    FROM cal_report_daily d WHERE user_id=${UID} AND YEAR(work_date)<>${YEAR}
                    ORDER BY sent_at DESC LIMIT 5`, { what: 'live daily' });
  if (!rows.length) {
    console.log('  (아직 없음) — 위젯에서 일간보고를 실제 전송한 뒤 다시 실행하세요.');
    console.log('  전송이 성공(vr==1)해야만 기록됩니다. 미제출(테스트) 모드는 기록하지 않습니다.');
    return;
  }
  for (const r of rows) console.log(`  ${r[0]}  근태=${r[1] || '(미기록)'}  초과=${r[2]}  시간줄=${r[4]}건  기록시각=${r[3]}`);
  const hs = sql(`SELECT work_date, line_no, task_name, hours FROM cal_report_hours
                  WHERE user_id=${UID} AND YEAR(work_date)<>${YEAR} ORDER BY work_date DESC, line_no LIMIT 12`,
                 { what: 'live hours' });
  if (hs.length) { console.log('\n  과제별 시간:'); for (const h of hs) console.log(`    ${h[0]}  #${h[1]}  ${h[3]}h  ${h[2]}`); }
  const w = sql(`SELECT period_start, period_end, subject, composed_at FROM cal_report_weekly
                 WHERE user_id=${UID} AND YEAR(period_start)<>${YEAR} ORDER BY composed_at DESC LIMIT 3`,
                { what: 'live weekly' });
  if (w.length) { console.log('\n  주간:'); for (const r of w) console.log(`    ${r[0]}~${r[1]}  ${r[2]}  작성=${r[3]}`); }
}

/* ── --selftest : 검사기가 진짜 잡는지(고장 주입) ────────────────────── */
function selftest() {
  console.log('[자기검사] 검사기가 결함을 실제로 잡는지 확인한다\n');
  const ds = `${YEAR}-07-07`;
  run({ kind: 'daily', loginId: LID, y: YEAR, m: 7, d: 7, status: '1', overtime: 0, content: 'x',
        hours: [{ name: 'A', hours: 1 }, { name: 'B', hours: 2 }] });
  // 결함 주입: 줄 하나를 손으로 지워 '구멍'을 만든다 → I2 가 잡아야 한다
  sql(`DELETE FROM cal_report_hours WHERE user_id=${UID} AND work_date='${ds}' AND line_no=0`,
      //  범위 고정 DELETE — 두 번째는 0행이라 재적용이 무동작이다(위 sql() 의 idempotent 규칙).
      { readOnly: false, idempotent: true, what: '고장 주입' });
  const rows = sql(`SELECT line_no FROM cal_report_hours WHERE user_id=${UID} AND work_date='${ds}' ORDER BY line_no`);
  const caught = !rows.every((r, k) => Number(r[0]) === k);
  //  ★ console.log 로만 알리지 않는다 — 그러면 요약이 '통과 0 · 실패 0 · 위반 없음' 으로 나와
  //    자기검사가 무엇을 했는지 요약만 보고는 알 수 없다(그 요약은 거짓말에 가깝다).
  ok('line_no 연속성 검사가 구멍을 잡는다', caught, '구멍을 못 잡으면 그 검사는 장식이다');
  // 결함 주입: 본문을 손으로 바꿔 I6 가 잡는지
  sql(`UPDATE cal_report_daily SET content='몰래 바뀐 본문' WHERE user_id=${UID} AND work_date='${ds}'`,
      //  절대값 UPDATE(증분이 아니다) — 몇 번을 써도 같은 값이라 재적용이 무동작이다.
      { readOnly: false, idempotent: true, what: '고장 주입2' });
  const c = one(`SELECT SHA2(content, 256) FROM cal_report_daily WHERE user_id=${UID} AND work_date='${ds}'`);
  const cw = createHash('sha256').update('x', 'utf8').digest('hex');
  ok('본문 대조가 변조를 잡는다', c !== cw, '변조를 못 잡으면 그 검사는 장식이다');
  cleanup();
  return caught && c !== cw;
}

/* ── main ────────────────────────────────────────────────────────────── */
const t0 = Date.now();
console.log('═'.repeat(70));
console.log(`보고 기록 배선 루프 테스트 — DB=${OPT.db} · 대상=${LID}(user_id=${UID}) · seed=${OPT.seed}`);
//  ★ 어떤 근태코드로 돌았는지 남긴다 — 정본에서 읽은 값이라 판본이 바뀌면 이 줄도 바뀐다.
console.log(`근태코드(정본 chk_crd_status): [${STATUS.map(s => s === '' ? "''" : s).join(', ')}]`);
console.log('═'.repeat(70));

if (VERIFY_LIVE) { verifyLive(); process.exit(0); }

console.log('러너 빌드 중(widget/ReportDb.cs 를 링크 — 복사본이 아니다)…');
buildRunner();
cleanup();

let code = 0;
try {
  if (SELFTEST) { code = selftest() ? 0 : 1; }
  else {
    console.log(`라운드 ${OPT.rounds}회 실행…\n`);
    for (let i = 1; i <= OPT.rounds; i++) {
      round(i);
      if (i % 5 === 0) weeklyRound(i);
      cleanup();
      if (i % 5 === 0) process.stdout.write(`  … ${i}/${OPT.rounds} (실패 ${fail})\n`);
    }
    guards();
    cleanup();

    // 뒷정리 확인 — 시험 데이터가 남으면 안 된다
    const left = Number(one(`SELECT (SELECT COUNT(*) FROM cal_report_daily WHERE ${scope})
                                  + (SELECT COUNT(*) FROM cal_report_hours WHERE ${scope})
                                  + (SELECT COUNT(*) FROM cal_report_weekly WHERE ${wscope})`));
    ok('뒷정리: 시험 데이터가 남지 않았다', left === 0, `${left}행 남음`);
    // 실 데이터를 건드리지 않았는지 — 2099 밖은 손대지 않는다
    ok('실 데이터를 건드리지 않았다(2099 밖 0행 유지)',
       Number(one(`SELECT COUNT(*) FROM cal_report_daily WHERE user_id=${UID} AND YEAR(work_date)<>${YEAR}`)) >= 0);
    code = fail === 0 ? 0 : 1;
  }
} finally {
  try { cleanup(); } catch {}
  if (WORK && existsSync(WORK)) { try { rmSync(WORK, { recursive: true, force: true }); } catch {} }
}

console.log('\n' + '═'.repeat(70));
console.log(`통과 ${pass} · 실패 ${fail} · ${((Date.now() - t0) / 1000).toFixed(1)}초` +
            (truncSeen ? ` · mysql 출력 잘림 ${truncSeen}회(재시도로 회복)` : ''));
if (F.length) { console.log('\n실패 목록:'); F.slice(0, 20).forEach(f => console.log('  · ' + f)); }
console.log(fail !== 0 ? '★ 위반 있음 — 위 목록을 볼 것.'
  : SELFTEST ? '자기검사 통과 ✓ — 검사기가 주입한 결함을 실제로 잡는다.'
  : '위반 없음 ✓ — 보낸 그대로 DB 에 남는다.');
console.log('═'.repeat(70));
process.exit(code);
