#!/usr/bin/env node
/* =====================================================================
 *  dryrun-xml-to-db.mjs — 3단계 이관의 **예행연습** (설계 §3.9 · §8)
 * =====================================================================
 *
 *  【무엇을 하나】
 *    실 data.xml 을 **읽기만** 해서 앱의 fromXML() 로 state 를 만들고, 그것을
 *    CalendarWriteDb 로 **시험 사용자에게** 저장한 뒤 CalendarDb 로 다시 읽어 대조한다.
 *
 *    즉 3단계 이관과 **같은 데이터·같은 경로**를 돌되, 쓰기 대상만 시험 사용자다.
 *    여기서 깨지면 이관도 깨진다. 여기가 깨끗하면 이관은 "같은 걸 진짜 사용자에게 한 번 더"다.
 *
 *  【실 파일은 절대 건드리지 않는다】 읽기 전용으로 연다. 쓰기는 전부 시험 사용자에게 하고
 *    끝나면 그 사용자를 통째로 지운다.
 *
 *  【fromXML 이 정본이다】 문서가 아니라 코드가 정본이므로 재구현하지 않고 **실행**한다
 *    (jsdom 으로 같은 prototype.html 을 부팅 — tests/calendar-adapter.mjs 와 같은 방식).
 *
 *  【실행】
 *    $env:TC_TEST_DB_ADMIN_PW = '<root 비번>'
 *    node tests/dryrun-xml-to-db.mjs [--xml=PATH]
 * ===================================================================== */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_HTML = join(ROOT, 'task-calendar-prototype.html');
const ARG = new Map(process.argv.slice(2).map(a => {
  const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const OPT = {
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',
  db: process.env.TC_TEST_DB_NAME || 'taskmgr',
  xml: ARG.get('xml') || join(process.env.APPDATA || '', 'TaskCalendar', 'data.xml'),
};
if (!OPT.adminPw) { console.error("[중단] TC_TEST_DB_ADMIN_PW 가 필요합니다."); process.exit(2); }
if (!existsSync(OPT.xml)) { console.error('[중단] data.xml 이 없다: ' + OPT.xml); process.exit(2); }

const EOF = '__TCEOF__';
function sql(q, { readOnly = true, what = 'SQL' } = {}) {
  for (let i = 1; i <= (readOnly ? 3 : 1); i++) {
    const r = spawnSync(OPT.mysql, ['-u' + OPT.adminUser, '-p' + OPT.adminPw, '--get-server-public-key',
      '--default-character-set=utf8mb4', '-N', '-B', '-D', OPT.db],
      { input: Buffer.from(q + `;\nSELECT '${EOF}';\n`, 'utf8'), maxBuffer: 64 << 20 });
    const out = (r.stdout || Buffer.alloc(0)).toString('utf8');
    if (r.status !== 0) throw new Error(`${what} 실패: ${(r.stderr || '').toString().trim()}`);
    if (!out.includes(EOF)) { if (i < 3) continue; throw new Error(`${what}: 출력이 잘렸다`); }
    return out.split(/\r?\n/).filter(l => l.length && l !== EOF).map(l => l.split('\t'));
  }
}
const one = (q, w) => { const r = sql(q, { what: w }); return r.length ? r[0][0] : null; };

let pass = 0, fail = 0; const F = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`); }
                               else { fail++; F.push(n + (d ? ' — ' + d : '')); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const note = (m) => console.log(`  · ${m}`);

/* ── 1. fromXML 실행(정본) ─────────────────────────────────────────────── */
async function stateFromXml(xmlText) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(readFileSync(APP_HTML, 'utf8'), {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/',
    beforeParse(w) {
      if (typeof w.crypto === 'undefined') w.crypto = {};
      if (!w.crypto.randomUUID) w.crypto.randomUUID = () => 'x-' + Math.random().toString(16).slice(2);
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    },
  });
  await new Promise(r => { if (dom.window.document.readyState === 'complete') r(); else dom.window.addEventListener('load', r); });
  const w = dom.window;
  if (typeof w.fromXML !== 'function') throw new Error('fromXML 을 찾지 못했다(앱 부팅 실패)');
  const data = w.fromXML(xmlText);
  //  앱의 __applyXml 이 하는 조립을 그대로 쓴다(buildStateFrom 공유 — 계약 ④)
  const st = typeof w.buildStateFrom === 'function' ? w.buildStateFrom(data) : data;
  const json = JSON.parse(JSON.stringify(st));
  dom.window.close();
  return json;
}

/* ── 2. 러너(CalendarDb + CalendarWriteDb) ─────────────────────────────── */
const RUNNER_CS = `using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using TaskCalendarWidget;

//  ★ 컴파일 전용 대역 — UserSession 이 참조하는 Dpapi 는 NetcusService.cs 안에 있고
//    그 파일을 링크하면 WebView2 의존이 딸려온다. 이 시험은 세션 경로를 타지 않는다.
internal static class Dpapi
{
    public static byte[] Protect(byte[] b) => throw new InvalidOperationException("시험 대역이 불렸다");
    public static byte[] Unprotect(byte[] b) => throw new InvalidOperationException("시험 대역이 불렸다");
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
    if (op == "read") { Console.Out.Write(JsonSerializer.Serialize(new { ok=true, state=snap.StateJson, rev=snap.Rev, logs })); return 0; }
    var res = await new CalendarWriteDb(log).SaveAsync(snap, e.GetProperty("stateJson").GetString() ?? "");
    Console.Out.Write(JsonSerializer.Serialize(new {
      ok=res.Ok, conflict=res.Conflict, msg=res.Message, rev=res.Rev,
      ins=res.Inserted, upd=res.Updated, del=res.Deleted, logs }));
    return 0;
  }
}`;
const PROJ = root => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable><LangVersion>latest</LangVersion><AssemblyName>dr</AssemblyName>
    <RootNamespace>DR</RootNamespace><EnableDefaultCompileItems>false</EnableDefaultCompileItems><NoWarn>CS0649</NoWarn></PropertyGroup>
  <ItemGroup><Compile Include="R.cs" />
    <Compile Include="${root}/widget/CalendarDb.cs" />
    <Compile Include="${root}/widget/CalendarWriteDb.cs" />
    <!-- ★ C4(2026-09-03)부터 CalendarDb 가 ProjectDb.CanViewScheduleAsync 를 쓴다 —
         인가 판정을 한 벌로 두려고 거기 뒀다. 이 러너도 그 사슬을 링크해야 한다. -->
    <Compile Include="${root}/widget/ProjectDb.cs" />
    <Compile Include="${root}/widget/RepoPaths.cs" />
    <Compile Include="${root}/widget/UserSession.cs" />
    <Compile Include="${root}/widget/DeployConfig.cs" /></ItemGroup>
  <ItemGroup><PackageReference Include="MySqlConnector" Version="2.3.7" /></ItemGroup>
</Project>`;
let WORK = null;
function buildRunner() {
  WORK = mkdtempSync(join(tmpdir(), 'tc-dr-'));
  writeFileSync(join(WORK, 'R.cs'), RUNNER_CS, 'utf8');
  writeFileSync(join(WORK, 'dr.csproj'), PROJ(ROOT.replace(/\\/g, '/')), 'utf8');
  const b = spawnSync('dotnet', ['build', '-v', 'q', '--nologo'], { cwd: WORK, encoding: 'utf8' });
  if (b.status !== 0) { console.error('[중단] 러너 빌드 실패:\n' + (b.stdout || '') + (b.stderr || '')); process.exit(2); }
}
function run(p) {
  const r = spawnSync('dotnet', ['run', '--no-build', '-v', 'q', '--nologo'],
    { cwd: WORK, input: JSON.stringify(p), encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error('러너 실행 실패: ' + (r.stderr || r.stdout));
  const m = (r.stdout || '').match(/\{[\s\S]*\}$/);
  if (!m) throw new Error('러너 출력이 JSON 이 아니다: ' + (r.stdout || '').slice(0, 300));
  return JSON.parse(m[0]);
}

/* ── 3. 시험 사용자 ────────────────────────────────────────────────────── */
const LOGIN = '__dryrun__';
function makeUser() {
  sql(`INSERT IGNORE INTO app_user (login_id, name, is_active) VALUES ('${LOGIN}', '이관예행', 1)`, { readOnly: false, what: '사용자 생성' });
  const u = one(`SELECT user_id FROM app_user WHERE login_id='${LOGIN}'`);
  sql(`INSERT IGNORE INTO cal_user_rev (user_id, rev) VALUES (${u}, 0)`, { readOnly: false, what: 'rev 시딩' });
  return Number(u);
}
function dropUser(u) {
  for (const t of ['cal_entry_commit','cal_entry_except','cal_todo_day_note','cal_task_hours','cal_attendance',
                   'cal_entry','cal_todo','cal_category','cal_room','cal_user_pref','cal_user_rev'])
    sql(`DELETE FROM ${t} WHERE user_id=${u}`, { readOnly: false, what: `정리(${t})` });
  sql(`DELETE FROM app_user WHERE user_id=${u}`, { readOnly: false, what: '사용자 삭제' });
}

/* ── 4. 대조 ───────────────────────────────────────────────────────────── */
//  대조에서 빼는 키. **빼는 것과 잃는 것은 다르다** — 여기 있는 키 중 XML 에 값이 있는 것은
//  아래 [6] 이 "이관 도구가 따로 처리해야 할 일" 로 반드시 보고한다. 조용히 빼면 안 된다.
const DROP_CAT   = ['usesRepo', 'createdAt',
                    'gitRepo', 'svnRepo'];                // §4 — 경로는 DB 에 없다(로컬 repo-paths.json 전용)
const DROP_ENTRY = ['createdAt', 'updatedAt',
                    'commits',                            // 지연 로드라 쓰기 계층이 안 건드린다(의도된 제외)
                    'hours'];                             // G-6 — 컬럼 폐지(공수는 cal_task_hours 로 간다)
const DROP_TODO  = ['createdAt', 'updatedAt'];
const strip = (o, keys) => { const c = { ...o }; for (const k of keys) delete c[k]; return c; };

function diffList(name, a, b, drop) {
  const d = [];
  if (a.length !== b.length) { d.push(`${name} 개수 ${a.length} → ${b.length}`); return d; }
  for (let i = 0; i < a.length; i++) {
    const x = JSON.stringify(strip(a[i], drop)), y = JSON.stringify(strip(b[i], drop));
    if (x !== y) d.push(`${name}[${i}] (${a[i].id})\n        원본: ${x}\n        읽기: ${y}`);
  }
  return d;
}

/* ── main ──────────────────────────────────────────────────────────────── */
const t0 = Date.now();
console.log('═'.repeat(72));
console.log('3단계 이관 예행연습 — 실 data.xml → DB → 다시 읽기');
console.log('  XML(읽기 전용): ' + OPT.xml);
console.log('═'.repeat(72));

let U = null, code = 0;
try {
  console.log('\n[1] 앱의 fromXML() 로 state 만들기(정본)');
  const xmlText = readFileSync(OPT.xml, 'utf8');
  const s0 = await stateFromXml(xmlText);
  console.log(`  과제 ${s0.categories.length} · 일정 ${s0.entries.length} · 할 일 ${s0.todos.length} · 회의실 ${s0.rooms.length}` +
              ` · 근태 ${Object.keys(s0.attendance || {}).length}일 · 공수 ${Object.keys(s0.taskHours || {}).length}일`);
  const srcCommits = s0.entries.reduce((n, e) => n + ((e.commits || []).length), 0);
  const srcExcept  = s0.entries.reduce((n, e) => n + ((e.recurExcept || []).length), 0);
  const srcNotes   = s0.todos.reduce((n, t) => n + Object.keys(t.dayNotes || {}).length, 0);
  console.log(`  커밋 ${srcCommits} · 예외일 ${srcExcept} · 날짜메모 ${srcNotes}`);

  buildRunner();
  U = makeUser();
  console.log(`\n[2] 시험 사용자(user_id=${U})에게 저장`);
  const w = run({ op: 'save', loginId: LOGIN, stateJson: JSON.stringify(s0) });
  ok('저장 성공', w.ok === true, w.msg || (w.logs || []).join(' / '));
  if (!w.ok) throw new Error('저장 실패로 중단');
  console.log(`  추가 ${w.ins} · 수정 ${w.upd} · 삭제 ${w.del} · rev ${w.rev}`);

  console.log('\n[3] 다시 읽어 원본과 대조');
  const r1 = run({ op: 'read', loginId: LOGIN });
  ok('읽기 성공', r1.ok === true);
  const s1 = JSON.parse(r1.state);

  const dc = diffList('과제', s0.categories, s1.categories, DROP_CAT);
  ok(`과제 ${s0.categories.length}건이 그대로`, dc.length === 0, dc.slice(0, 2).join('\n      '));
  const de = diffList('일정', s0.entries, s1.entries, DROP_ENTRY);
  ok(`일정 ${s0.entries.length}건이 그대로`, de.length === 0, de.slice(0, 2).join('\n      '));
  const dt = diffList('할 일', s0.todos, s1.todos, DROP_TODO);
  ok(`할 일 ${s0.todos.length}건이 그대로`, dt.length === 0, dt.slice(0, 2).join('\n      '));

  for (const k of ['rooms', 'attendance', 'taskHours', 'gitAuthor', 'svnAuthor',
                   'reportMarker', 'reportMarkerCustom', 'reportIndent', 'gitCommitBody',
                   'reportFormatPrefs', 'reportFont'])
    ok(`${k} 가 그대로`, JSON.stringify(s0[k]) === JSON.stringify(s1[k]),
       `원본=${JSON.stringify(s0[k])} 읽기=${JSON.stringify(s1[k])}`);

  console.log('\n[4] 배열 순서 — 이관의 핵심(§5.3 sort_order)');
  ok('과제 순서 보존', s0.categories.map(c => c.id).join(',') === s1.categories.map(c => c.id).join(','));
  ok('일정 순서 보존', s0.entries.map(e => e.id).join(',') === s1.entries.map(e => e.id).join(','),
     `원본=${s0.entries.map(e => e.id).slice(0, 5).join(',')}… 읽기=${s1.entries.map(e => e.id).slice(0, 5).join(',')}…`);
  ok('할 일 순서 보존', s0.todos.map(t => t.id).join(',') === s1.todos.map(t => t.id).join(','));
  ok('회의실 순서 보존', JSON.stringify(s0.rooms) === JSON.stringify(s1.rooms));

  console.log('\n[5] 멱등 — 읽은 것을 다시 저장해도 같은가');
  const w2 = run({ op: 'save', loginId: LOGIN, stateJson: JSON.stringify(s1) });
  ok('2회차 저장 성공(연속 저장 경로)', w2.ok === true, w2.msg || '');
  const r2 = run({ op: 'read', loginId: LOGIN });
  const s2 = JSON.parse(r2.state);
  const idem = ['categories', 'entries', 'todos'].flatMap(k =>
    diffList(k, s1[k], s2[k], k === 'entries' ? DROP_ENTRY : k === 'todos' ? DROP_TODO : DROP_CAT));
  ok('두 번 저장해도 내용이 같다(멱등)', idem.length === 0, idem.slice(0, 2).join('\n      '));
  ok('행이 늘지 않았다', Number(one(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${U}`)) === s0.entries.length,
     `일정 ${one(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${U}`)}행`);

  console.log('\n[6] ★ 이관 도구가 따로 해야 할 일 — 이 XML 에서 실제로 드러난 것');
  const todo = [];
  const gotCommits = s1.entries.reduce((n, e) => n + ((e.commits || []).length), 0);
  if (srcCommits > 0)
    todo.push(`커밋 ${srcCommits}건 — 이관은 앱 상태(save)를 거치지 않는다 — 쓰기 계층이 커밋을 다루게 된 뒤에도(G-7 개정) 그렇다.\n` +
              `      → 이관 도구가 **직접** INSERT 해야 한다. 안 하면 커밋 ${srcCommits}건이 사라진다(읽기 ${gotCommits}건 확인).`);

  const repoCats = s0.categories.filter(c => (c.gitRepo || '') || (c.svnRepo || ''));
  if (repoCats.length)
    todo.push(`저장소 경로 ${repoCats.length}건 — DB 에는 '쓰는가' 비트(uses_repo)만 있고 경로는 없다(§4).\n` +
              `      → 이관 도구가 %APPDATA%\\TaskCalendar\\repo-paths.json 으로 옮기고 uses_repo 를 세워야 한다.\n` +
              `      → 대상: ${repoCats.map(c => c.id).join(', ')}`);

  const hourEntries = s0.entries.filter(e => e.hours != null);
  if (hourEntries.length)
    todo.push(`일정별 hours ${hourEntries.length}건 — 컬럼이 폐지됐다(G-6, 공수는 cal_task_hours 로 간다).\n` +
              `      → **결정된 손실**이다. 이관 전에 사용자에게 알릴 것: 값 ${[...new Set(hourEntries.map(e => e.hours))].join(', ')}`);

  if (todo.length) todo.forEach(t => note('★ ' + t));
  else note('이 XML 에는 따로 처리할 것이 없다.');

  if (srcCommits === 0) note('커밋 0건 — 이 XML 로는 커밋 이관을 검증할 수 없다(합성 픽스처 필요).');
  if (srcExcept === 0) note('예외일 0건 — 이 XML 로는 검증되지 않는다(loop-calendar-write 의 합성 데이터가 덮는다).');
  if (srcNotes === 0) note('날짜메모 0건 — 위와 같다.');

  code = fail === 0 ? 0 : 1;
} catch (e) {
  console.log('\n[중단] ' + e.message);
  code = 2;
} finally {
  try { if (U) dropUser(U); } catch (e) { console.log('  ! 정리 실패: ' + e.message); }
  if (WORK) { try { rmSync(WORK, { recursive: true, force: true }); } catch {} }
}

console.log('\n' + '═'.repeat(72));
console.log(`통과 ${pass} · 실패 ${fail} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
if (F.length) { console.log('\n실패 목록:'); F.slice(0, 8).forEach(f => console.log('  · ' + f)); }
console.log(fail === 0 ? '예행연습 통과 ✓ — 실 데이터가 DB 를 왕복해도 그대로다.' : '★ 실패 — 이관 전에 고칠 것.');
console.log('═'.repeat(72));
process.exit(code);
