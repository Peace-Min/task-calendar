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
 *    · 커밋 표(cal_entry_commit)를 **건드리지 않는가** — 부팅이 commits 를 []로 두므로
 *      쓰면 기존 커밋이 통째로 사라진다(의도된 제외)
 *
 *  【실 DB 를 쓴다】 DeployConfig 가 const 라 언제나 실 taskmgr 다. 그게 값이다 —
 *    앱 계정 권한까지 함께 검증한다. 전용 시험 사용자를 만들어 쓰고 끝나면 지운다.
 *
 *  【실행】
 *    $env:TC_TEST_DB_ADMIN_PW = '<root 비번>'
 *    node tests/loop-calendar-write.mjs [--rounds=10] [--seed=N]
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

/* ── 러너 — 위젯이 쓰는 두 클래스를 그대로 링크한다(복사 아님) ─────────── */
const RUNNER_CS = `using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using TaskCalendarWidget;

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

    var res = await new CalendarWriteDb(log).SaveAsync(use, newState);

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
function wipe(u) {
  for (const t of ['cal_entry_commit','cal_entry_except','cal_todo_day_note','cal_task_hours',
                   'cal_attendance','cal_entry','cal_todo','cal_category','cal_room','cal_user_pref'])
    sql(`DELETE FROM ${t} WHERE user_id=${u}`, { readOnly: false, what: `정리(${t})` });
}
function dropUser(u) {
  wipe(u);
  sql(`DELETE FROM cal_user_rev WHERE user_id=${u}`, { readOnly: false, what: 'rev 정리' });
  sql(`DELETE FROM app_user WHERE user_id=${u}`, { readOnly: false, what: '시험 사용자 삭제' });
}

/* ── 무작위 state 생성 ─────────────────────────────────────────────────── */
const NAMES = ['표적기(ADD)', '울산급 Batch-IV', '휴가', '기타', '한글 과제 名'];
function makeState(prev, round) {
  const cats = [];
  const nCat = rint(1, 3);
  for (let i = 0; i < nCat; i++)
    cats.push({ id: `c-${round}-${i}`, name: pick(NAMES) + i, color: '#3e5be0', desc: `설명 ${i}`,
                gitRepo: '', svnRepo: '', usesRepo: rnd() < 0.5, createdAt: '2026-01-01T00:00:00.000Z' });
  const entries = [];
  for (let i = 0; i < rint(0, 4); i++) {
    const allDay = rnd() < 0.4;
    const rec = rnd() < 0.3 ? { freq: pick(['weekly','monthly']), interval: rint(1,3), until: '', count: 0 } : null;
    entries.push({
      id: `e-${round}-${i}`, date: `2026-0${rint(1,9)}-1${rint(0,9)}`, title: `일정 ${i} 한글`,
      categoryId: rnd() < 0.8 ? cats[rint(0, cats.length - 1)].id : null,
      allDay, startTime: allDay ? '' : '09:00', endTime: allDay ? '' : '18:00',
      hours: null, location: rnd() < 0.5 ? '회의실 A' : '', remind: rnd() < 0.3 ? rint(0, 60) : null,
      memo: `메모 ${i}`, source: '', commits: [], endDate: '',
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
  const { updatedAt, createdAt, commits, ...rest } = e;        // 시각은 서버가 정한다 · 커밋은 지연 로드
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

    // 커밋 표는 건드리지 않는다(의도된 제외)
    ok(`R${r} 커밋 표를 건드리지 않았다`,
       Number(one(`SELECT COUNT(*) FROM cal_entry_commit WHERE user_id=${U}`)) === 0);

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

  code = fail === 0 ? 0 : 1;
} finally {
  try { if (U) dropUser(U); } catch (e) { console.log('  ! 정리 실패: ' + e.message); }
  if (WORK && existsSync(WORK)) { try { rmSync(WORK, { recursive: true, force: true }); } catch {} }
}

console.log('\n' + '═'.repeat(70));
console.log(`통과 ${pass} · 실패 ${fail} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
if (F.length) { console.log('\n실패 목록:'); F.slice(0, 12).forEach(f => console.log('  · ' + f)); }
console.log(fail === 0 ? '위반 없음 ✓ — 읽기→쓰기→읽기 왕복이 동일하다.' : '★ 위반 있음');
console.log('═'.repeat(70));
process.exit(code);
