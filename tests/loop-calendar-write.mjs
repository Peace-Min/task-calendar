#!/usr/bin/env node
/* =====================================================================
 *  loop-calendar-write.mjs — 캘린더 쓰기 경로 루프 테스트 (설계 §3.1~3.4)
 * =====================================================================
 *
 *  【가장 강한 증명은 왕복이다】
 *    읽기(CalendarDb) → 쓰기(CalendarWriteDb) → 읽기 가 **같은 state 를 돌려주는가**.
 *    한쪽이라도 매핑이 어긋나면 즉시 드러난다. 컬럼 하나를 빠뜨려도, 타입을 잘못 넣어도,
 *    순서를 잃어도 왕복이 깨진다.
 *
 *  【그리고 동시성 계약을 실제로 친다】
 *    · rev 는 저장마다 정확히 1 증가하는가(§3.1)
 *    · 낡은 토큰으로 저장하면 거부되고 **아무것도 바뀌지 않는가**(§3.3 — 부분 적용 금지)
 *    · 자식(예외일·날짜메모)이 부모와 함께 정리되는가(§3.4)
 *    · 커밋(cal_entry_commit)이 **왕복에서 보존되는가** — G-7 개정(2026-09-01) 전에는
 *      정반대 계약이었다("건드리지 않는가"). 부팅이 commits 를 [] 로 두던 시절의 방어였고,
 *      그 방어 때문에 커밋 편집·삭제가 DB 에 영영 반영되지 않았다. 이제 순서까지 대조한다
 *
 *  【그리고 진짜로 겹치는 저장을 친다 — op=parallel(2026-09-07 추가)】
 *    아래 [동시 편집](op=concurrent)은 **순차**다: A 가 끝난 뒤 B 가 같은 낡은 스냅샷으로 저장한다.
 *    낡은 토큰이 거부된다는 것은 그것으로 증명되지만, **겹치지 않으면 원리적으로 안 보이는 것**이 있다:
 *      · §3.1 「rev 선점」(트랜잭션 첫 문장의 rev 증가)이 실제로 직렬화를 만드는가
 *      · 겹친 트랜잭션에서 데드락(1213)·락 대기 초과(1205)가 나지 않는가
 *      · 진 트랜잭션이 rev 를 올린 채 남지 않는가(rev 가 정확히 +1 인가)
 *    그래서 N개(기본 4)를 대기선에 세웠다가 한꺼번에 풀고, **각자의 시작·종료 시각을 재서**
 *    정말 겹쳤는지까지 판정한다. 안 겹쳤으면 통과가 아니라 '판정 불가' 다 — 그건 순차를 한 번 더 돈 것이다.
 *
 *  【실 DB 를 쓴다】 DeployConfig 가 const 라 언제나 실 taskmgr 다. 그게 값이다 —
 *    앱 계정 권한까지 함께 검증한다. 전용 시험 사용자를 만들어 쓰고 끝나면 지운다.
 *    ★ 파괴적 조작(wipe/dropUser) 앞에는 assertTestUser 가 있다 — 대상 login_id 를 DB 에 되묻고
 *      시험 계정이 아니면 즉시 중단한다. 실사용자 데이터를 지운 사고(2026-09-07)에서 없던 문이다.
 *
 *  【실행】
 *    $env:TC_TEST_DB_ADMIN_PW = '<root 비번>'
 *    node tests/loop-calendar-write.mjs [--rounds=10] [--seed=N] [--parN=4] [--parRounds=5]
 *    종료코드: 0 통과 · 1 실패 · 2 판정 불가(전제가 안 서서 증명하지 못함 — 초록 아님)
 * ===================================================================== */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARG = new Map(process.argv.slice(2).map(a => {
  const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const OPT = {
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',
  db: process.env.TC_TEST_DB_NAME || 'taskmgr',
  rounds: Number(ARG.get('rounds') || 10),
  seed: Number(ARG.get('seed') || 20260901),
};
if (!OPT.adminPw) {
  console.error("[중단] TC_TEST_DB_ADMIN_PW 가 필요합니다.  $env:TC_TEST_DB_ADMIN_PW = '<비번>'");
  process.exit(2);
}

const EOF = '__TCEOF__';
function sql(q, { readOnly = true, what = 'SQL' } = {}) {
  for (let i = 1; i <= (readOnly ? 3 : 1); i++) {
    const r = spawnSync(OPT.mysql, ['-u' + OPT.adminUser, '-p' + OPT.adminPw, '--get-server-public-key',
      '--default-character-set=utf8mb4', '-N', '-B', '-D', OPT.db],
      { input: Buffer.from(q + `;\nSELECT '${EOF}';\n`, 'utf8'), maxBuffer: 64 << 20 });
    const out = (r.stdout || Buffer.alloc(0)).toString('utf8');
    if (r.status !== 0) throw new Error(`${what} 실패: ${(r.stderr || '').toString().trim()}`);
    if (!out.includes(EOF)) { if (i < 3) continue; throw new Error(`${what}: mysql 출력이 잘렸다`); }
    return out.split(/\r?\n/).filter(l => l.length && l !== EOF).map(l => l.split('\t'));
  }
}
const one = (q, w) => { const r = sql(q, { what: w }); return r.length ? r[0][0] : null; };

let _s = OPT.seed >>> 0;
const rnd = () => ((_s = (_s * 1664525 + 1013904223) >>> 0) / 4294967296);
const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];

let pass = 0, fail = 0; const F = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; F.push(n + (d ? ' — ' + d : '')); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
//  ★ '판정 불가' 는 통과가 아니다. 전제가 안 서서 아무것도 증명하지 못한 경우를 따로 센다 —
//    실패 0 이라고 초록으로 끝내면 "시험이 돌았지만 아무 말도 안 했다" 를 통과로 읽게 된다.
//    실패가 없고 판정 불가만 있으면 exit 2 로 끝낸다(run-tests.mjs 의 skip 규약과 같은 뜻).
let undecided = 0; const UD = [];
const undecide = (n, d = '') => { undecided++; UD.push(n + (d ? ' — ' + d : '')); console.log(`  ? ${n} — 판정 불가${d ? ': ' + d : ''}`); };

/* ── 러너 — 위젯이 쓰는 두 클래스를 그대로 링크한다(복사 아님) ─────────── */
const RUNNER_CS = `using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TaskCalendarWidget;

//  ★ 컴파일 전용 대역 — UserSession.cs 가 Dpapi 를 참조하는데 그 클래스는 NetcusService.cs 안에
//    있고, 그 파일을 링크하면 WebView2 의존이 통째로 딸려온다. 이 시험은 세션 경로를 타지 않는다.
//    ★ 실제로 불리면 시험이 거짓이 되므로, 불리면 즉시 터뜨린다.
internal static class Dpapi
{
    public static byte[] Protect(byte[] b) => throw new InvalidOperationException("시험 대역이 불렸다");
    public static byte[] Unprotect(byte[] b) => throw new InvalidOperationException("시험 대역이 불렸다");
}

//  병렬 저장 한 건의 결과. 익명형 대신 이름을 붙인 이유: 예외로 끝난 경우와 정상 반환이
//  **같은 모양**이어야 JS 가 "충돌인가 · 알 수 없는 오류인가" 를 한 자리에서 가른다.
//  ★ startMs/endMs 를 함께 싣는다 — 이게 없으면 "정말 겹쳤는가" 를 증명할 길이 없고,
//    안 겹친 병렬 시험은 **순차를 한 번 더 돈 것**이라 아무것도 증명하지 못한다.
class PR {
  public int i { get; set; }
  public bool ok { get; set; }
  public bool conflict { get; set; }
  public string msg { get; set; } = "";
  public string ex { get; set; } = "";      // 예외 형식 이름. ""이 아니면 그건 충돌이 아니라 사고다
  public long rev { get; set; }
  public double startMs { get; set; }
  public double endMs { get; set; }
}

class R {
  static async Task<int> Main() {
    string raw = Console.In.ReadToEnd();
    using var doc = JsonDocument.Parse(raw);
    var e = doc.RootElement;
    string op = e.GetProperty("op").GetString() ?? "";
    string login = e.GetProperty("loginId").GetString() ?? "";
    var logs = new List<string>();
    Action<string> log = m => logs.Add(m);

    var snap = await new CalendarDb(log).LoadSnapshotAsync(login, null);
    if (snap == null) { Console.Out.Write(JsonSerializer.Serialize(new { ok=false, err="snapshot null", logs })); return 0; }

    if (op == "read") {
      Console.Out.Write(JsonSerializer.Serialize(new {
        ok = true, state = snap.StateJson, rev = snap.Rev, userId = snap.UserId,
        tokens = snap.Tokens, logs }));
      return 0;
    }

    // op == "save" : 주어진 state 를 저장한다. staleTokens=true 면 토큰을 일부러 낡게 만들어
    //   충돌 검출을 시험한다(§3.3).
    string newState = e.GetProperty("state").GetRawText();
    if (e.TryGetProperty("stateJson", out var sj) && sj.ValueKind == JsonValueKind.String)
      newState = sj.GetString() ?? newState;

    CalendarSnapshot use = snap;
    if (e.TryGetProperty("staleTokens", out var stEl) && stEl.ValueKind == JsonValueKind.True) {
      var bad = new Dictionary<string,string>();
      foreach (var kv in snap.Tokens) bad[kv.Key] = "2000-01-01 00:00:00.000";
      use = new CalendarSnapshot(snap.StateJson, bad, snap.Rev, snap.SchemaVersion, snap.UserId,
                                 snap.CategoryNoByUid, snap.EntryNoByUid, snap.TodoNoByUid);
    }

    // op == "concurrent" : 같은 스냅샷을 든 두 클라이언트가 **차례로** 저장한다(순차).
    //   토큰을 인위적으로 조작하지 않는다는 것이 값이다 — "낡은 토큰이 현실에서 이렇게 생긴다" 를
    //   조작 없이 보여 준다. 두 PC 가 같은 계정으로 붙어 있는 상황의 **결과**가 이 모양이다.
    //   ★ 그러나 이것은 **동시가 아니다.** A 가 끝난 뒤에 B 가 시작하므로 두 트랜잭션이 한 번도
    //     겹치지 않는다. 그래서 이 경로로는 원리적으로 볼 수 없는 것들이 있다:
    //       · §3.1 「rev 선점」이 **직렬화를 만드는가**(겹쳐야 락 경합이 생긴다)
    //       · 겹친 트랜잭션에서 데드락(1213)·락 대기 초과(1205)가 나지 않는가
    //       · 진 트랜잭션이 rev 를 올린 채 남지 않는가(rev 가 정확히 +1 인가)
    //     그것들은 op == "parallel" 이 본다. **둘 다 남긴다** — 증명하는 명제가 다르다.
    if (op == "concurrent") {
      string a = e.GetProperty("stateA").GetString() ?? "";
      string b = e.GetProperty("stateB").GetString() ?? "";
      var ra = await new CalendarWriteDb(log).SaveAsync(snap, a);   // 클라이언트 1 — 먼저 저장
      var rb = await new CalendarWriteDb(log).SaveAsync(snap, b);   // 클라이언트 2 — **같은(이제 낡은) 스냅샷**으로
      Console.Out.Write(JsonSerializer.Serialize(new {
        ok = true,
        aOk = ra.Ok, aMsg = ra.Message, aRev = ra.Rev,
        bOk = rb.Ok, bConflict = rb.Conflict, bMsg = rb.Message, logs }));
      return 0;
    }

    // op == "parallel" : **정말 겹치는** 동시 저장. 같은 user_id 에 N개의 SaveAsync 를 한꺼번에 띄운다.
    //   ★ Task.WhenAll 만으로는 안 된다 — 만드는 순간 도는 첫 Task 가 뒤 Task 가 시작하기도 전에
    //     끝나 버리면 그건 그냥 순차다(그러면 이 시험은 concurrent 를 한 번 더 돈 것이 된다).
    //     그래서 전원이 대기선에 설 때까지 센 뒤(armed == n) TaskCompletionSource 로 **동시에** 푼다.
    //   ★ 각자의 시작·종료 시각을 함께 돌려준다. "겹쳤다" 는 시험자가 믿을 일이 아니라 **재는 일**이다.
    //   ★ 로그 List 는 스레드 안전하지 않다 — 여기서만 잠근다(제품 코드가 아니라 이 러너의 문제다).
    if (op == "parallel") {
      var arr = e.GetProperty("states");
      int n = arr.GetArrayLength();
      var payloads = new List<string>();
      for (int k = 0; k < n; k++)
        payloads.Add(arr[k].ValueKind == JsonValueKind.String ? (arr[k].GetString() ?? "") : arr[k].GetRawText());

      var gate = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
      var armedAll = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
      int armed = 0;
      object logLock = new object();
      Action<string> plog = m => { lock (logLock) logs.Add(m); };
      var sw = System.Diagnostics.Stopwatch.StartNew();

      var tasks = new List<Task<PR>>();
      for (int k = 0; k < n; k++) {
        int idx = k;
        string sj3 = payloads[k];
        tasks.Add(Task.Run(async () => {
          if (Interlocked.Increment(ref armed) == n) armedAll.TrySetResult(true);
          await gate.Task;                                  // ← 전원 동시 출발
          double t0 = sw.Elapsed.TotalMilliseconds;
          try {
            var rr = await new CalendarWriteDb(plog).SaveAsync(snap, sj3);
            return new PR { i = idx, ok = rr.Ok, conflict = rr.Conflict, msg = rr.Message ?? "", ex = "",
                            rev = rr.Rev, startMs = Math.Round(t0, 1), endMs = Math.Round(sw.Elapsed.TotalMilliseconds, 1) };
          } catch (Exception ex2) {
            //  ★ 예외는 **충돌이 아니다.** 사용자에게 '충돌' 과 '알 수 없는 오류' 는 전혀 다른 사건이라
            //    여기서 섞으면 시험이 거짓 초록을 낸다. 형식 이름을 그대로 실어 올린다.
            return new PR { i = idx, ok = false, conflict = false, msg = ex2.Message, ex = ex2.GetType().Name,
                            rev = 0, startMs = Math.Round(t0, 1), endMs = Math.Round(sw.Elapsed.TotalMilliseconds, 1) };
          }
        }));
      }
      //  전원이 대기선에 서기를 기다린다. 못 서면(비정상) 그냥 출발시키고, JS 가 겹침 측정으로 잡는다.
      await Task.WhenAny(armedAll.Task, Task.Delay(10000));
      gate.TrySetResult(true);
      var results = await Task.WhenAll(tasks);
      Console.Out.Write(JsonSerializer.Serialize(new { ok = true, results, logs }));
      return 0;
    }

    //  replaceAll : 「XML 가져오기」·「전체 초기화」가 쓰는 전량 교체.
    bool replaceAll = e.TryGetProperty("replaceAll", out var raEl) && raEl.ValueKind == JsonValueKind.True;
    var res = await new CalendarWriteDb(log).SaveAsync(use, newState, replaceAll);

    // op == "saveChain" : **한 스냅샷으로 연속 저장**한다. 위젯이 실제로 하는 일이다 —
    //   매 저장마다 DB 를 다시 읽지 않고, 앞 저장이 돌려준 토큰/번호로 다음 저장을 친다.
    //   ★ 이 경로가 없으면 'UPDATE 뒤 토큰 갱신 누락' 같은 결함을 **영영 못 잡는다**
    //     (매번 새로 읽는 테스트에서는 낡은 토큰이 생길 수가 없다. 2026-09-01 실측으로 겪었다).
    if (op == "saveChain" && res.Ok && e.TryGetProperty("more", out var more) && more.ValueKind == JsonValueKind.Array) {
      var cur = new CalendarSnapshot(newState, res.Tokens, res.Rev, snap.SchemaVersion, snap.UserId,
                                     res.CategoryNoByUid, res.EntryNoByUid, res.TodoNoByUid);
      int step = 1;
      foreach (var nx in more.EnumerateArray()) {
        string sj2 = nx.ValueKind == JsonValueKind.String ? (nx.GetString() ?? "") : nx.GetRawText();
        var r2 = await new CalendarWriteDb(log).SaveAsync(cur, sj2);
        if (!r2.Ok) {
          Console.Out.Write(JsonSerializer.Serialize(new {
            ok = false, conflict = r2.Conflict, msg = $"연속 저장 {step}단계에서 실패: {r2.Message}", rev = r2.Rev, logs }));
          return 0;
        }
        cur = new CalendarSnapshot(sj2, r2.Tokens, r2.Rev, snap.SchemaVersion, snap.UserId,
                                   r2.CategoryNoByUid, r2.EntryNoByUid, r2.TodoNoByUid);
        res = r2; step++;
      }
    }

    Console.Out.Write(JsonSerializer.Serialize(new {
      ok = res.Ok, conflict = res.Conflict, msg = res.Message, rev = res.Rev,
      ins = res.Inserted, upd = res.Updated, del = res.Deleted, logs }));
    return 0;
  }
}`;

const PROJ = root => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable><LangVersion>latest</LangVersion>
    <AssemblyName>cw</AssemblyName><RootNamespace>CW</RootNamespace>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems><NoWarn>CS0649</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="R.cs" />
    <Compile Include="${root}/widget/CalendarDb.cs" />
    <Compile Include="${root}/widget/CalendarWriteDb.cs" />
    <!-- ★ C4(2026-09-03)부터 CalendarDb 가 ProjectDb.CanViewScheduleAsync 를 쓴다(인가 판정을
         **한 벌**로 두려고 거기 뒀다). 그래서 이 러너도 그 사슬을 함께 링크해야 한다.
         빠뜨리면 CS0103 으로 빌드가 죽는데, 빌드 로그가 길어 통과로 오인하기 쉽다 — 실제로 그랬다. -->
    <Compile Include="${root}/widget/ProjectDb.cs" />
    <Compile Include="${root}/widget/RepoPaths.cs" />
    <Compile Include="${root}/widget/UserSession.cs" />
    <Compile Include="${root}/widget/DeployConfig.cs" />
  </ItemGroup>
  <ItemGroup><PackageReference Include="MySqlConnector" Version="2.3.7" /></ItemGroup>
</Project>`;

let WORK = null;
function buildRunner() {
  WORK = mkdtempSync(join(tmpdir(), 'tc-cw-'));
  writeFileSync(join(WORK, 'R.cs'), RUNNER_CS, 'utf8');
  writeFileSync(join(WORK, 'cw.csproj'), PROJ(ROOT.replace(/\\/g, '/')), 'utf8');
  const b = spawnSync('dotnet', ['build', '-v', 'q', '--nologo'], { cwd: WORK, encoding: 'utf8' });
  if (b.status !== 0) { console.error('[중단] 러너 빌드 실패:\n' + (b.stdout || '') + (b.stderr || '')); process.exit(2); }
}
function run(payload) {
  const r = spawnSync('dotnet', ['run', '--no-build', '-v', 'q', '--nologo'],
    { cwd: WORK, input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error('러너 실행 실패: ' + (r.stderr || r.stdout));
  const m = (r.stdout || '').match(/\{[\s\S]*\}$/);
  if (!m) throw new Error('러너 출력이 JSON 이 아니다: ' + (r.stdout || '').slice(0, 300));
  return JSON.parse(m[0]);
}

/* ── 전용 시험 사용자 ──────────────────────────────────────────────────── */
const LOGIN = '__cwtest__';
function makeUser() {
  sql(`INSERT IGNORE INTO app_user (login_id, name, is_active) VALUES ('${LOGIN}', '쓰기시험', 1)`,
      { readOnly: false, what: '시험 사용자 생성' });
  const uid = one(`SELECT user_id FROM app_user WHERE login_id='${LOGIN}'`, 'user_id');
  sql(`INSERT IGNORE INTO cal_user_rev (user_id, rev) VALUES (${uid}, 0)`, { readOnly: false, what: 'rev 시딩' });
  return Number(uid);
}
//  ★★ 파괴적 조작 앞의 마지막 문 — 대상이 **정말 시험 계정인가** 를 매번 DB 에 되묻는다.
//    2026-09-07 에 컨텍스트를 잘못 골라 실사용자 데이터를 지운 사고가 있었다. 그때 없던 것이 이 줄이다.
//    ★ 58(phmin) 을 이름으로 막는 것만으로는 부족하다 — 다음에 다른 실계정이 걸리면 또 지운다.
//      그래서 **화이트리스트**로 잠근다: login_id 가 시험 계정이 아니면 무조건 중단한다.
const REAL_USER_IDS = new Set([58]);   // phmin — 개발자 본인의 실데이터(cal_entry 34 · cal_category 10)
function assertTestUser(u, what) {
  const n = Number(u);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${what} 중단 — 대상 user_id 가 이상하다: ${u}`);
  if (REAL_USER_IDS.has(n)) throw new Error(`${what} 중단 — user_id=${n} 은 실사용자다. 시험이 건드릴 대상이 아니다`);
  const lid = one(`SELECT login_id FROM app_user WHERE user_id=${n}`, 'login_id 확인');
  if (lid !== LOGIN)
    throw new Error(`${what} 중단 — user_id=${n}(login_id=${lid ?? '없음'}) 는 시험 계정 '${LOGIN}' 이 아니다`);
  return n;
}
function wipe(u) {
  assertTestUser(u, '정리(wipe)');
  for (const t of ['cal_entry_commit','cal_entry_except','cal_todo_day_note','cal_task_hours',
                   'cal_attendance','cal_entry','cal_todo','cal_category','cal_room','cal_user_pref'])
    sql(`DELETE FROM ${t} WHERE user_id=${u}`, { readOnly: false, what: `정리(${t})` });
}
function dropUser(u) {
  assertTestUser(u, '시험 사용자 삭제');
  wipe(u);
  sql(`DELETE FROM cal_user_rev WHERE user_id=${u}`, { readOnly: false, what: 'rev 정리' });
  sql(`DELETE FROM app_user WHERE user_id=${u}`, { readOnly: false, what: '시험 사용자 삭제' });
}

/* ── 무작위 state 생성 ─────────────────────────────────────────────────── */
const NAMES = ['표적기(ADD)', '울산급 Batch-IV', '휴가', '기타', '한글 과제 名'];
//  git 일정과 그 커밋. 커밋은 **순서가 곧 표시 순서**(seq)라 왕복에서 자리까지 봐야 한다.
//  시각 없는 커밋('' → TIME NULL)과 여러 줄 본문을 일부러 섞는다 — 둘 다 실제로 나온다.
function gitBits(round, i) {
  if (rnd() < 0.55) return { source: '', commits: [] };
  const n = rint(1, 4);
  const commits = [];
  for (let k = 0; k < n; k++) {
    const h = String(round).padStart(2, '0') + String(i) + String(k);
    //  ★ 해시 없는 커밋을 일부러 섞는다 — 손으로 적어 넣은 작업일지 줄이 그렇다.
    //    실 data.xml 3종에 실제로 있었고(9K 5건 중 3건 · demobak 74건 중 8건),
    //    쓰기 계층이 그걸 조용히 버리고 있었다(2026-09-02). 픽스처에 없으면 다시 못 잡는다.
    const noHash = rnd() < 0.3;
    commits.push({
      hash: noHash ? '' : (h + 'abcdef0123456789abcdef0123456789abcdef').slice(0, 40),
      short: noHash ? '' : (h + 'abcdef').slice(0, 7),
      time: rnd() < 0.3 ? '' : `${String(rint(0, 23)).padStart(2, '0')}:${String(rint(0, 59)).padStart(2, '0')}`,
      subject: `커밋 제목 ${round}-${i}-${k} 한글`,
      body: rnd() < 0.5 ? '' : `본문 첫 줄 ${k}\n둘째 줄`,
    });
  }
  return { source: 'git', commits };
}

function makeState(prev, round) {
  const cats = [];
  const nCat = rint(1, 3);
  for (let i = 0; i < nCat; i++)
    cats.push({ id: `c-${round}-${i}`, name: pick(NAMES) + i, color: '#3e5be0', desc: `설명 ${i}`,
                gitRepo: '', svnRepo: '', usesRepo: rnd() < 0.5, createdAt: '2026-01-01T00:00:00.000Z' });
  const entries = [];
  for (let i = 0; i < rint(0, 4); i++) {
    const allDay = rnd() < 0.4;
    //  ★ git 일정은 기간·반복을 가질 수 없다 — chk_cal_entry_git.
    //    "재수집이 [from,to] 범위를 통째로 지우고 다시 넣기 때문에, 기간/반복이 섞이면
    //    무엇을 지울지가 정의되지 않는다"(schema-calendar.sql:1245). 그래서 git 이면 recur 를 막는다.
    const git = gitBits(round, i);
    const rec = (git.source !== 'git' && rnd() < 0.3)
      ? { freq: pick(['weekly','monthly']), interval: rint(1,3), until: '', count: 0 } : null;
    entries.push({
      id: `e-${round}-${i}`, date: `2026-0${rint(1,9)}-1${rint(0,9)}`, title: `일정 ${i} 한글`,
      categoryId: rnd() < 0.8 ? cats[rint(0, cats.length - 1)].id : null,
      allDay, startTime: allDay ? '' : '09:00', endTime: allDay ? '' : '18:00',
      hours: null, location: rnd() < 0.5 ? '회의실 A' : '', remind: rnd() < 0.3 ? rint(0, 60) : null,
      memo: `메모 ${i}`, ...git, endDate: '',
      recur: rec, recurExcept: rec ? [`2026-03-0${rint(1,9)}`] : [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
  }
  const todos = [];
  for (let i = 0; i < rint(0, 3); i++)
    todos.push({ id: `t-${round}-${i}`, text: `할 일 ${i}`, done: rnd() < 0.5,
      categoryId: rnd() < 0.7 ? cats[0].id : null, due: rnd() < 0.6 ? '2026-05-01' : '', endDate: '',
      prio: pick(['normal','high']), completedAt: '', note: `비고 ${i}`,
      dayNotes: rnd() < 0.5 ? { '2026-05-01': '그날 메모' } : {},
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

  const taskHours = {}, attendance = {};
  if (cats.length && rnd() < 0.8) taskHours['2026-06-15'] = { [cats[0].id]: Math.round(rnd() * 800) / 100 || 1 };
  if (rnd() < 0.8) attendance['2026-06-15'] = { status: pick(['1','12','11']), overtime: rint(0, 5) };   // '8'(결근)은 CHECK 에 없다 — 읽기 경로가 생길 때 확장 예정(schema-calendar.sql 주석)

  return {
    categories: cats, entries, todos,
    gitAuthor: '작성자', svnAuthor: 'svn작성자',
    rooms: ['회의실 A', '회의실 B'].slice(0, rint(1, 2)),
    reportMarker: '-', reportMarkerCustom: '', reportIndent: 2, gitCommitBody: rnd() < 0.5,
    reportFormatPrefs: { daily: { marker: '-', markerCustom: '', indent: 2 },
                         weekly: { marker: '·', markerCustom: '', indent: 3 } },
    reportSource: 'cal', taskHours, attendance, lsMigrated: true,
    reportFont: { family: pick(['Malgun Gothic','Gulim','']), size: rint(10, 16) },   // chk_cal_user_pref_font_family 허용값
  };
}

/* ── 왕복 비교 — 저장 후 다시 읽은 state 가 보낸 것과 같은가 ───────────── */
const IGNORE_TOP = new Set(['reportSource', 'lsMigrated']);   // 읽기가 상수로 채우는 값
function normEntry(e) {
  //  ★ commits 를 빼지 않는다(G-7 개정) — 예전에는 여기서 통째로 빼서 왕복 비교가
  //    커밋을 아예 안 봤다. 그래서 쓰기가 커밋을 지워도 이 테스트는 초록이었다.
  const { updatedAt, createdAt, ...rest } = e;                 // 시각만 서버가 정한다
  return rest;
}
function normTodo(t) { const { updatedAt, createdAt, ...rest } = t; return rest; }
function normCat(c) { const { createdAt, ...rest } = c; return rest; }

function compare(sent, got) {
  const diffs = [];
  const cmp = (path, a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${path}: 보냄=${JSON.stringify(a)} 받음=${JSON.stringify(b)}`);
  };
  cmp('categories', sent.categories.map(normCat), (got.categories || []).map(normCat));
  cmp('entries', sent.entries.map(normEntry), (got.entries || []).map(normEntry));
  cmp('todos', sent.todos.map(normTodo), (got.todos || []).map(normTodo));
  for (const k of ['gitAuthor','svnAuthor','rooms','reportMarker','reportMarkerCustom','reportIndent',
                   'gitCommitBody','reportFormatPrefs','taskHours','attendance','reportFont'])
    if (!IGNORE_TOP.has(k)) cmp(k, sent[k], got[k]);
  return diffs;
}

/* ── main ──────────────────────────────────────────────────────────────── */
const t0 = Date.now();
console.log('═'.repeat(70));
console.log(`캘린더 쓰기 루프 테스트 — DB=${OPT.db} · seed=${OPT.seed} · 라운드 ${OPT.rounds}`);
console.log('═'.repeat(70));
console.log('러너 빌드 중(CalendarDb + CalendarWriteDb 를 링크)…');
buildRunner();

let U = null, code = 0;
try {
  U = makeUser();
  wipe(U);
  console.log(`시험 사용자 user_id=${U}\n`);

  let prevRev = Number(one(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`));

  for (let r = 1; r <= OPT.rounds; r++) {
    const want = makeState(null, r);
    const res = run({ op: 'save', loginId: LOGIN, state: {}, stateJson: JSON.stringify(want) });
    ok(`R${r} 저장 성공`, res.ok === true, res.msg || (res.logs || []).join(' / '));
    if (!res.ok) continue;

    // §3.1 — rev 는 저장마다 정확히 1 증가
    const rev = Number(one(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`));
    ok(`R${r} rev 가 1 증가했다`, rev === prevRev + 1, `${prevRev} → ${rev}`);
    prevRev = rev;

    // ★ 왕복 — 이게 핵심 검사다
    const back = run({ op: 'read', loginId: LOGIN });
    ok(`R${r} 다시 읽기 성공`, back.ok === true, back.err || '');
    if (back.ok) {
      const diffs = compare(want, JSON.parse(back.state));
      ok(`R${r} 왕복이 동일하다(읽기→쓰기→읽기)`, diffs.length === 0, diffs.slice(0, 3).join(' | '));
    }

    // 커밋이 보존된다(G-7 개정). 왕복 비교가 내용·순서를 이미 보므로 여기서는 DB 사실을 본다.
    {
      const wantN = (want.entries || []).reduce((a, e) => a + (e.commits || []).length, 0);
      const gotN = Number(one(`SELECT COUNT(*) FROM cal_entry_commit WHERE user_id=${U}`));
      ok(`R${r} 커밋 행수가 보낸 것과 같다`, gotN === wantN, `보냄 ${wantN} · DB ${gotN}`);
      //  seq 가 0..n-1 로 빈틈없이 붙어야 한다 — 표시 순서의 유일한 근거(G-5)다.
      ok(`R${r} 커밋 seq 가 0 부터 빈틈없다`,
         Number(one(`SELECT COUNT(*) FROM (SELECT entry_no, MAX(seq)+1 AS mx, COUNT(*) AS c ` +
           `FROM cal_entry_commit WHERE user_id=${U} GROUP BY entry_no HAVING mx <> c) q`)) === 0);
      ok(`R${r} 커밋 고아 0`,
         Number(one(`SELECT COUNT(*) FROM cal_entry_commit c LEFT JOIN cal_entry e ON e.user_id=c.user_id AND e.entry_no=c.entry_no WHERE c.user_id=${U} AND e.entry_no IS NULL`)) === 0);
    }

    // 자식이 부모와 함께만 존재한다(고아 0)
    ok(`R${r} 예외일 고아 0`,
       Number(one(`SELECT COUNT(*) FROM cal_entry_except x LEFT JOIN cal_entry e ON e.user_id=x.user_id AND e.entry_no=x.entry_no WHERE x.user_id=${U} AND e.entry_no IS NULL`)) === 0);
    ok(`R${r} 날짜메모 고아 0`,
       Number(one(`SELECT COUNT(*) FROM cal_todo_day_note d LEFT JOIN cal_todo t ON t.user_id=d.user_id AND t.todo_no=d.todo_no WHERE d.user_id=${U} AND t.todo_no IS NULL`)) === 0);

    if (r % 3 === 0) process.stdout.write(`  … ${r}/${OPT.rounds} (실패 ${fail})\n`);
  }

  // ── ★ 연속 저장 — 한 스냅샷으로 이어서 쓴다(위젯이 실제로 하는 일) ──────
  //    매 저장마다 DB 를 새로 읽는 위 라운드들은 'UPDATE 뒤 토큰 갱신 누락'을 못 잡는다.
  //    실제로 그 결함이 과제(cal_category)에만 있었고, 위젯에서 두 번째 저장이 충돌해서야 드러났다.
  console.log('\n[연속 저장] 한 스냅샷으로 3회 이어서 — 매 표의 토큰이 갱신되는지');
  wipe(U);
  const base = makeState(null, 500);
  const s2 = JSON.parse(JSON.stringify(base));      // 1) 값만 수정(전 표를 UPDATE 로 통과시킨다)
  if (s2.entries[0]) { s2.entries[0].title = '연속-수정'; s2.entries[0].memo = '2회차'; }
  if (s2.todos[0]) s2.todos[0].text = '연속-할일';
  s2.categories[0].name = '연속-과제';
  s2.gitAuthor = '연속작성자';
  for (const d of Object.keys(s2.attendance)) s2.attendance[d].overtime = 7;
  for (const d of Object.keys(s2.taskHours)) for (const c of Object.keys(s2.taskHours[d])) s2.taskHours[d][c] = 3.25;
  const s3 = JSON.parse(JSON.stringify(s2));        // 2) 삭제까지(낡은 토큰이면 여기서 터진다)
  s3.todos = []; s3.taskHours = {}; s3.attendance = {};
  if (s3.entries.length) s3.entries.pop();

  const chain = run({ op: 'saveChain', loginId: LOGIN, state: {},
                      stateJson: JSON.stringify(base), more: [JSON.stringify(s2), JSON.stringify(s3)] });
  ok('연속 저장 3회가 전부 성공한다', chain.ok === true, chain.msg || '');
  ok('연속 저장 뒤 rev 가 3 증가했다',
     Number(one(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`)) >= 3,
     `rev=${one(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`)}`);
  if (chain.ok) {
    const back = run({ op: 'read', loginId: LOGIN });
    const diffs = back.ok ? compare(s3, JSON.parse(back.state)) : ['읽기 실패'];
    ok('연속 저장의 마지막 상태가 그대로 남았다', diffs.length === 0, diffs.slice(0, 3).join(' | '));
  }
  // ── §3.3 충돌 — 낡은 토큰으로 저장하면 거부되고 아무것도 안 바뀐다 ──────
  //    ★ 여기서 DB 를 비우면 안 된다 — 빈 DB 에는 낡을 토큰이 없어 전부 INSERT 로 성공해 버리고,
  //      검사가 조용히 무의미해진다(실측으로 겪었다). 바로 위 연속 저장이 남긴 데이터를 그대로 쓴다.
  console.log('\n[충돌] 낡은 토큰으로 저장 시도');
  ok('충돌 시험 전제: DB 에 데이터가 있다',
     Number(one(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${U}`)) +
     Number(one(`SELECT COUNT(*) FROM cal_category WHERE user_id=${U}`)) > 0,
     '빈 DB 에서는 이 검사가 아무것도 증명하지 못한다');
  const before = one(`SELECT CONCAT(
      (SELECT COUNT(*) FROM cal_entry WHERE user_id=${U}),'/',
      (SELECT COUNT(*) FROM cal_todo WHERE user_id=${U}),'/',
      (SELECT COUNT(*) FROM cal_category WHERE user_id=${U}),'/',
      (SELECT IFNULL(SUM(CRC32(CONCAT(uid,title,IFNULL(memo,'')))),0) FROM cal_entry WHERE user_id=${U}))`);
  const revBefore = Number(one(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`));
  const stale = run({ op: 'save', loginId: LOGIN, state: {}, stateJson: JSON.stringify(makeState(null, 999)), staleTokens: true });
  ok('낡은 토큰 저장이 거부된다', stale.ok === false && stale.conflict === true, `ok=${stale.ok} conflict=${stale.conflict} msg=${stale.msg}`);
  const after = one(`SELECT CONCAT(
      (SELECT COUNT(*) FROM cal_entry WHERE user_id=${U}),'/',
      (SELECT COUNT(*) FROM cal_todo WHERE user_id=${U}),'/',
      (SELECT COUNT(*) FROM cal_category WHERE user_id=${U}),'/',
      (SELECT IFNULL(SUM(CRC32(CONCAT(uid,title,IFNULL(memo,'')))),0) FROM cal_entry WHERE user_id=${U}))`);
  ok('거부됐을 때 데이터가 하나도 안 바뀌었다(부분 적용 없음)', before === after, `${before} → ${after}`);
  ok('거부돼도 rev 는 롤백된다', Number(one(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`)) === revBefore,
     `${revBefore} → ${one(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`)}`);

  // ── ★ 진짜 동시 편집 — 두 클라이언트가 같은 스냅샷으로 각자 저장 ────────
  //    위 '낡은 토큰' 시험은 토큰을 인위적으로 조작한 것이라 "현실에서 이렇게 되나"를 증명하지
  //    못한다. 여기서는 조작 없이, 두 PC 가 같은 계정으로 붙어 있는 상황을 그대로 재현한다.
  console.log('\n[동시 편집] 두 클라이언트가 같은 스냅샷으로 각자 저장');
  wipe(U);
  const seed = makeState(null, 700);
  const seedRes = run({ op: 'save', loginId: LOGIN, state: {}, stateJson: JSON.stringify(seed) });
  ok('바탕 상태 저장', seedRes.ok === true, seedRes.msg || '');

  const cA = JSON.parse(JSON.stringify(seed)); cA.categories[0].name = 'A가 고친 이름';
  const cB = JSON.parse(JSON.stringify(seed)); cB.categories[0].name = 'B가 고친 이름';
  const con = run({ op: 'concurrent', loginId: LOGIN, state: {},
                    stateA: JSON.stringify(cA), stateB: JSON.stringify(cB) });
  ok('먼저 저장한 쪽은 성공한다', con.aOk === true, con.aMsg || '');
  ok('나중 저장한 쪽은 충돌로 거부된다', con.bOk === false && con.bConflict === true,
     `bOk=${con.bOk} bConflict=${con.bConflict} msg=${con.bMsg}`);
  //  ★ 거부된 쪽이 이긴 쪽 데이터를 덮지 않았는지 — '마지막 쓴 사람이 이긴다'가 되면 안 된다
  const nameNow = one(`SELECT name FROM cal_category WHERE user_id=${U} ORDER BY cat_no LIMIT 1`);
  ok('먼저 저장한 쪽의 값이 남아 있다(덮이지 않았다)', nameNow === 'A가 고친 이름', `현재="${nameNow}"`);
  wipe(U);

  // ── 전량 교체(가져오기) — 지우고 통째로 다시 넣는가 ─────────────────────
  console.log('\n[전량 교체] 「XML 가져오기」 — 지우고 통째로 다시 넣는다');
  {
    //  ① 바탕: 커밋까지 있는 상태를 하나 만들어 둔다.
    const base = makeState(null, 90);
    const r0 = run({ op: 'save', loginId: LOGIN, state: {}, stateJson: JSON.stringify(base) });
    ok('바탕 상태 저장', r0.ok === true, r0.msg || r0.error || '');

    //  ② 지우면 안 되는 것에 표식을 남긴다 — 전량 교체가 건드리면 바로 드러난다.
    const revBefore = Number(one(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`));
    sql(`INSERT IGNORE INTO cal_migration_log (user_id, source_host, migrated_at) VALUES (${U}, 'LOOPTEST', '2026-01-01 00:00:00.000')`,
        { readOnly: false, what: '이관 마커 심기' });

    //  ③ 전혀 다른 내용으로 전량 교체(= 가져오기 '교체').
    const imported = makeState(null, 91);
    const r1 = run({ op: 'save', loginId: LOGIN, state: {}, stateJson: JSON.stringify(imported), replaceAll: true });
    ok('전량 교체 저장이 성공한다', r1.ok === true, r1.msg || r1.error || '');

    const rback = run({ op: 'read', loginId: LOGIN });
    if (rback.ok) {
      const got = JSON.parse(rback.state);
      ok('교체 결과가 보낸 state 와 같다', compare(imported, got).length === 0,
         compare(imported, got).slice(0, 3).join(' | '));
      //  ★ 옛 데이터가 **한 조각도** 남으면 안 된다 — 교체인데 병합이 되면 사용자는 모른다.
      const oldIds = new Set((base.categories || []).map((c) => c.id));
      const leaked = (got.categories || []).filter((c) => oldIds.has(c.id));
      ok('옛 과제가 남아 있지 않다', leaked.length === 0, leaked.map((c) => c.id).join(','));
    }

    //  ④ 번호가 1 부터 다시 붙는다 — 삭제가 발번보다 먼저 왔다는 증거다.
    if (imported.categories.length) {
      ok('과제 번호가 1 부터 다시 붙었다',
         Number(one(`SELECT IFNULL(MIN(cat_no),0) FROM cal_category WHERE user_id=${U}`)) === 1);
    }

    //  ⑤ 지우면 안 되는 것들이 그대로다.
    ok('rev 는 줄지 않고 늘었다(단조증가)',
       Number(one(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`)) > revBefore);
    ok('이관 마커가 살아 있다',
       Number(one(`SELECT COUNT(*) FROM cal_migration_log WHERE user_id=${U}`)) === 1);

    //  ⑥ 커밋도 함께 갈렸다(고아 없이).
    ok('교체 뒤 커밋 고아 0',
       Number(one(`SELECT COUNT(*) FROM cal_entry_commit c LEFT JOIN cal_entry e ON e.user_id=c.user_id AND e.entry_no=c.entry_no WHERE c.user_id=${U} AND e.entry_no IS NULL`)) === 0);
    ok('교체 뒤 커밋 행수가 보낸 것과 같다',
       Number(one(`SELECT COUNT(*) FROM cal_entry_commit WHERE user_id=${U}`)) ===
       (imported.entries || []).reduce((a, e) => a + (e.commits || []).length, 0));

    sql(`DELETE FROM cal_migration_log WHERE user_id=${U}`, { readOnly: false, what: '마커 정리' });
    wipe(U);
  }

  // ── 전량 삭제 — 빈 state 를 저장하면 다 지워지는가 ──────────────────────
  console.log('\n[삭제] 빈 state 저장');
  const empty = makeState(null, 0); empty.categories = []; empty.entries = []; empty.todos = [];
  empty.taskHours = {}; empty.attendance = {}; empty.rooms = [];
  const delRes = run({ op: 'save', loginId: LOGIN, state: {}, stateJson: JSON.stringify(empty) });
  ok('빈 state 저장 성공', delRes.ok === true, delRes.msg || '');
  const left = Number(one(`SELECT (SELECT COUNT(*) FROM cal_entry WHERE user_id=${U})
    + (SELECT COUNT(*) FROM cal_todo WHERE user_id=${U}) + (SELECT COUNT(*) FROM cal_category WHERE user_id=${U})
    + (SELECT COUNT(*) FROM cal_entry_except WHERE user_id=${U}) + (SELECT COUNT(*) FROM cal_todo_day_note WHERE user_id=${U})
    + (SELECT COUNT(*) FROM cal_task_hours WHERE user_id=${U}) + (SELECT COUNT(*) FROM cal_attendance WHERE user_id=${U})`));
  ok('전부 지워졌다(자식 포함)', left === 0, `${left}행 남음`);

  // ── ★★ 진짜 병렬 쓰기 — 같은 계정에 N개를 **동시에** 던진다 ────────────────
  //    위 [동시 편집](op=concurrent)은 순차다. 순차로는 원리적으로 볼 수 없는 것 셋을 여기서 본다:
  //      ① §3.1 「rev 선점」— 트랜잭션 첫 문장의 rev 증가가 **실제로 직렬화를 만드는가**.
  //         만들지 않으면 두 트랜잭션이 나란히 통과해 "정확히 하나만 성공" 이 깨진다.
  //      ② 격리 비대칭(§3.2, 쓰기 READ-COMMITTED)에서 데드락(1213)·락 대기 초과(1205)가 나지 않는가.
  //         이건 겹쳐야만 관측된다. 나면 사용자에게는 '충돌' 이 아니라 '알 수 없는 오류' 로 보인다.
  //      ③ 진 트랜잭션이 rev 를 올린 채 남지 않는가 — 롤백이 rev 까지 되돌리는가.
  //    ★ 89명이 한 MySQL 을 쓰고 같은 사람이 두 PC 를 켜 두는 구성이라, 이 자리는 가정이 아니라 일상이다.
  //    ★ 경합은 **한 번 통과가 증거가 못 된다.** 5회 반복하고 매회 전부 본다.
  {
    const PAR_N = Number(ARG.get('parN') || 4);
    const PAR_ROUNDS = Number(ARG.get('parRounds') || 5);
    console.log(`\n[병렬 저장] 같은 스냅샷으로 ${PAR_N}개를 **동시에** — ${PAR_ROUNDS}회 반복`);
    const BAD_LOCK = /Deadlock|1213|Lock wait timeout|1205/i;

    //  겹침 측정 — 구간 [start,end] 가 한 시점에 몇 개나 동시에 열려 있었나(최대 깊이).
    //  ★ 같은 시각에서는 종료(-1)를 시작(+1)보다 **먼저** 센다. 끝점만 닿은 두 구간을
    //    '겹쳤다' 로 세면 순차를 병렬로 오판한다 — 이 시험이 가장 피해야 할 거짓이다.
    const maxOverlap = (iv) => {
      const ev = [];
      for (const x of iv) { ev.push([x.s, 1]); ev.push([x.e, -1]); }
      ev.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
      let cur = 0, mx = 0;
      for (const [, d] of ev) { cur += d; if (cur > mx) mx = cur; }
      return mx;
    };

    for (let r = 1; r <= PAR_ROUNDS; r++) {
      wipe(U);
      const seed = makeState(null, 800 + r);
      const seedRes = run({ op: 'save', loginId: LOGIN, state: {}, stateJson: JSON.stringify(seed) });
      ok(`P${r} 바탕 상태 저장`, seedRes.ok === true, seedRes.msg || '');
      if (!seedRes.ok) continue;

      const revBefore = Number(one(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`));
      //  각 클라이언트는 **같은 스냅샷**을 들고 **서로 다른 값**으로 저장한다.
      //  이름을 서로 다르게 하는 이유: 이긴 사람의 값만 남았는지(P3)를 값으로 판정하려면 구별돼야 한다.
      const names = [];
      const states = [];
      for (let k = 0; k < PAR_N; k++) {
        const s = JSON.parse(JSON.stringify(seed));
        const nm = `병렬-${r}-${k}`;
        s.categories[0].name = nm;
        names.push(nm); states.push(JSON.stringify(s));
      }

      const par = run({ op: 'parallel', loginId: LOGIN, state: {}, states });
      const rs = Array.isArray(par.results) ? par.results : [];
      if (rs.length !== PAR_N) {
        undecide(`P${r} 병렬 결과 수집`, `결과 ${rs.length}건 / ${PAR_N}건 — 러너가 전부 돌리지 못했다`);
        continue;
      }

      //  ★ **겹침 측정이 먼저다.** 안 겹쳤으면 아래 P1~P5 는 순차를 다시 잰 것이라
      //    통과해도 아무것도 증명하지 못한다. 그래서 그 경우는 '판정 불가' 로 끊는다.
      const iv = rs.map(x => ({ s: Number(x.startMs), e: Number(x.endMs) }));
      const depth = maxOverlap(iv);
      const span = Math.max(...iv.map(x => x.e)) - Math.min(...iv.map(x => x.s));
      console.log(`  · P${r} 구간(ms): ` + rs.map(x => `#${x.i}[${x.startMs}→${x.endMs}]`).join(' ') +
                  ` · 최대 동시 ${depth}/${PAR_N} · 전체 ${span.toFixed(1)}ms`);
      if (depth < 2) {
        undecide(`P${r} 병렬이 실제로 겹쳤다`,
                 `최대 동시 ${depth}개 — 이건 순차다. 이 라운드는 아무것도 증명하지 못했다`);
        continue;
      }
      ok(`P${r} ${PAR_N}개 구간이 한 시점에 모두 열려 있었다(진짜 병렬)`, depth === PAR_N,
         `최대 동시 ${depth}/${PAR_N}`);

      // P1 — 정확히 하나만 성공한다
      const wins = rs.filter(x => x.ok === true);
      ok(`P${r} **정확히 하나만 성공한다**`, wins.length === 1,
         `성공 ${wins.length}건 — 0이면 전부 실패한 것이고, 2 이상이면 잠금이 샌다: ` +
         rs.map(x => `#${x.i} ok=${x.ok} conflict=${x.conflict} ${x.ex || ''}${x.msg ? ' "' + x.msg + '"' : ''}`).join(' | '));

      // P2 — 나머지는 전부 Conflict. 예외·타임아웃·데드락은 **충돌이 아니다**
      const losers = rs.filter(x => x.ok !== true);
      const notConflict = losers.filter(x => x.conflict !== true);
      ok(`P${r} 진 쪽은 전부 '충돌' 이다(예외·타임아웃이 아니다)`, notConflict.length === 0,
         notConflict.map(x => `#${x.i} ex=${x.ex || '없음'} msg="${x.msg}"`).join(' | '));
      const crashed = rs.filter(x => x.ex);
      ok(`P${r} 예외로 죽은 저장이 없다`, crashed.length === 0,
         crashed.map(x => `#${x.i} ${x.ex}: ${x.msg}`).join(' | '));

      // P3 — DB 에 이긴 사람의 값만 남는다
      if (wins.length === 1) {
        const winName = names[wins[0].i];
        const nameNow = one(`SELECT name FROM cal_category WHERE user_id=${U} ORDER BY cat_no LIMIT 1`);
        ok(`P${r} DB 에 이긴 쪽(#${wins[0].i})의 값만 남았다`, nameNow === winName,
           `기대="${winName}" 현재="${nameNow}"`);
        //  진 쪽의 값이 한 조각이라도 섞이면 '부분 적용' 이다 — §3.3 이 금지하는 바로 그것.
        const others = names.filter((_, k) => k !== wins[0].i);
        const leaked = Number(one(`SELECT COUNT(*) FROM cal_category WHERE user_id=${U} AND name IN (` +
          others.map(n => `'${n.replace(/'/g, "''")}'`).join(',') + `)`));
        ok(`P${r} 진 쪽의 값이 섞이지 않았다`, leaked === 0, `${leaked}행`);
      }

      // P4 — rev 가 정확히 1 만 올랐다(§3.1 「rev 선점」이 직렬화를 만드는 자리)
      const revAfter = Number(one(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`));
      ok(`P${r} **rev 가 정확히 1 올랐다**`, revAfter === revBefore + 1,
         `${revBefore} → ${revAfter} (+${revAfter - revBefore}) — ` +
         '2 이상이면 진 트랜잭션도 rev 를 올린 것이고(롤백이 안 됐다), 0 이면 선점이 안 걸렸다');

      // P5 — 데드락·락 대기 초과가 없다
      const locky = rs.filter(x => BAD_LOCK.test(x.msg || ''));
      ok(`P${r} 데드락·락 대기 초과가 없다`, locky.length === 0,
         locky.map(x => `#${x.i} "${x.msg}"`).join(' | ') + ' — 겹친 트랜잭션이 락에서 갈렸다(설계가 알아야 할 사실)');

      //  ★ 실측값을 통과할 때도 찍는다 — 초록 한 줄은 "무엇이 일어났는지" 를 말해 주지 않는다.
      console.log(`    승자 #${wins.length === 1 ? wins[0].i : '?'} · 충돌 ${losers.filter(x => x.conflict).length}/${losers.length}` +
                  ` · rev ${revBefore}→${revAfter}(+${revAfter - revBefore}) · 예외 ${crashed.length} · 락사고 ${locky.length}`);
    }
    wipe(U);
  }

  code = fail === 0 ? (undecided === 0 ? 0 : 2) : 1;
} finally {
  try { if (U) dropUser(U); } catch (e) { console.log('  ! 정리 실패: ' + e.message); }
  if (WORK && existsSync(WORK)) { try { rmSync(WORK, { recursive: true, force: true }); } catch {} }
}

console.log('\n' + '═'.repeat(70));
console.log(`통과 ${pass} · 실패 ${fail} · 판정 불가 ${undecided} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
if (F.length) { console.log('\n실패 목록:'); F.slice(0, 12).forEach(f => console.log('  · ' + f)); }
if (UD.length) { console.log('\n판정 불가 목록(통과가 아니다):'); UD.slice(0, 12).forEach(f => console.log('  · ' + f)); }
console.log(fail === 0
  ? (undecided === 0
      ? '위반 없음 ✓ — 읽기→쓰기→읽기 왕복이 동일하고, 동시 저장은 하나만 이긴다.'
      : '★ 판정 불가 — 실패는 없지만 전제가 서지 않아 증명하지 못한 것이 있다(초록 아님)')
  : '★ 위반 있음');
console.log('═'.repeat(70));
process.exit(code);
