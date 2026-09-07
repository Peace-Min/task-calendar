#!/usr/bin/env node
/* ============================================================================
 *  tests/loop-peer-view.mjs — 타인 일정 열람의 **권한 경계** 검증 (C4)
 * ----------------------------------------------------------------------------
 *  증명하는 명제:
 *    **볼 수 있는 사람만 보고, 볼 수 없는 사람은 못 본다 — 실 DB 에서.**
 *
 *  왜 실 DB 인가:
 *    이건 인가(authorization) 경계다. 소스 대조로는 "규칙이 적혀 있다" 까지만 알 수 있고,
 *    그 규칙이 **실제 조직 트리와 실제 view_scope 에서 무엇을 허용하는지**는 돌려 봐야 안다.
 *    그리고 DeployConfig 가 const 라 앱 계정(taskmgr_app) 권한까지 함께 검증된다.
 *
 *  ★ 무엇을 특히 보나 — **거짓 음성이 아니라 거짓 양성**이다.
 *    "볼 수 있는데 안 보인다" 는 불편이고, "볼 수 없는데 보인다" 는 사고다.
 *    그래서 self·범위 밖·미등록 세 갈래를 각각 따로 세운다.
 *
 *  ★ 조직 트리는 **시험용을 새로 만든다** — 실 조직(89명)에 기대면 사람이 팀을 옮기는 순간
 *    테스트가 깨지고, 무엇보다 실 데이터를 건드리게 된다.
 *
 *  실행:  TC_TEST_DB_ADMIN_PW=… node tests/loop-peer-view.mjs
 * ==========================================================================*/
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MYSQL = process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe';
const PW = process.env.TC_TEST_DB_ADMIN_PW || '';
const USER = process.env.TC_TEST_DB_ADMIN_USER || 'root';
if (!PW) { console.error('[중단] TC_TEST_DB_ADMIN_PW 가 없습니다.'); process.exit(2); }

let pass = 0, fail = 0; const F = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`); }
  else { fail++; F.push(n + (d ? ' — ' + d : '')); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); }
};
function sql(q, { readOnly = true, what = 'SQL' } = {}) {
  const r = spawnSync(MYSQL, [`-u${USER}`, `-p${PW}`, 'taskmgr', '-N', '-B', '-e', q], { encoding: 'utf8' });
  //  ★ stderr 첫 줄은 거의 항상 '비번을 명령줄에' 경고다 — 그걸 오류로 보고하면 진짜 원인이 가려진다.
  if (r.status !== 0) {
    const lines = (r.stderr || '').split('\n').filter((l) => l.trim() && !/Using a password/.test(l));
    throw new Error(`${what} 실패: ${lines[0] || (r.stderr || '').trim() || '(stderr 없음)'}`);
  }
  //  ★ /\r?\n/ 로 자른다 — mysql.exe 는 Windows 에서 \r\n 을 내므로 '\n' 으로만 자르면
  //    각 행의 마지막 열에 \r 가 남는다. 한 행짜리 결과는 바깥 .trim() 이 가려 주기 때문에
  //    지금껏 조용했고, Number() 는 \r 를 공백으로 먹어 더 조용하다 — 여러 행 문자열 비교에서만
  //    어긋난다. 그런 종류의 결함은 '언젠가 이상한 실패' 로 돌아온다. 다른 러너는 이미 /\r?\n/ 다.
  const rows = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  //  재발하면 조용히 틀리는 대신 크게 실패시킨다(판정 불가 ≠ 통과).
  for (const row of rows) for (const cell of row) {
    if (cell.includes('\r')) throw new Error(`${what}: 결과 셀에 CR 가 남았다 — 줄 자르기가 다시 좁아졌다: ${JSON.stringify(cell)}`);
  }
  return rows;
}
const one = (q) => { const r = sql(q); return r.length ? r[0][0] : null; };
const num = (q) => Number(one(q));

/* ── 러너 — 위젯이 쓰는 클래스를 그대로 링크한다(복사본이 아니다) ─────── */
const RUNNER_CS = `using System;
using System.Text.Json;
using System.Threading.Tasks;
using TaskCalendarWidget;

//  ★ 컴파일 전용 대역 — UserSession.cs 가 Dpapi 를 참조하는데 그 클래스는 NetcusService.cs 안에
//    있고, 그 파일을 링크하면 WebView2 의존이 통째로 딸려온다. 이 시험은 세션 경로를 **한 번도
//    타지 않는다**(loginId 를 직접 넘긴다). 그래서 통과만 하는 대역을 둔다 —
//    ★ 이 대역이 실제로 불리면 시험이 거짓이 되므로, 불리면 즉시 터지게 만든다.
internal static class Dpapi
{
    public static byte[] Protect(byte[] b) => throw new InvalidOperationException("시험 대역이 실제로 불렸다 — 이 경로는 타면 안 된다");
    public static byte[] Unprotect(byte[] b) => throw new InvalidOperationException("시험 대역이 실제로 불렸다 — 이 경로는 타면 안 된다");
}

internal static class PeerRunner
{
    static async Task<int> Main()
    {
        string input = await Console.In.ReadToEndAsync();
        var e = JsonDocument.Parse(input).RootElement;
        string viewer = e.GetProperty("viewer").GetString() ?? "";
        string target = e.GetProperty("target").GetString() ?? "";
        var db = new CalendarDb(_ => { });
        string json = await db.LoadPeerScheduleJsonAsync(viewer, target);
        Console.Out.Write(json ?? "{\\"error\\":\\"null\\"}");
        return 0;
    }
}`;
const PROJ = (root) => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable><LangVersion>latest</LangVersion>
    <AssemblyName>peerrunner</AssemblyName><RootNamespace>PeerRunner</RootNamespace>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems><NoWarn>CS0649</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="R.cs" />
    <Compile Include="${root}/widget/CalendarDb.cs" />
    <Compile Include="${root}/widget/CalendarWriteDb.cs" />
    <Compile Include="${root}/widget/ProjectDb.cs" />
    <Compile Include="${root}/widget/RepoPaths.cs" />
    <Compile Include="${root}/widget/DeployConfig.cs" />
    <Compile Include="${root}/widget/UserSession.cs" />
  </ItemGroup>
  <ItemGroup><PackageReference Include="MySqlConnector" Version="2.3.7" /></ItemGroup>
</Project>`;

let WORK = null;
function buildRunner() {
  WORK = mkdtempSync(join(tmpdir(), 'tc-peer-'));
  writeFileSync(join(WORK, 'R.cs'), RUNNER_CS, 'utf8');
  writeFileSync(join(WORK, 'peer.csproj'), PROJ(ROOT.replace(/\\/g, '/')), 'utf8');
  const b = spawnSync('dotnet', ['build', '-v', 'q', '--nologo'], { cwd: WORK, encoding: 'utf8' });
  if (b.status !== 0) { console.error('[중단] 러너 빌드 실패:\n' + (b.stdout || '') + (b.stderr || '')); process.exit(2); }
}
function peek(viewer, target) {
  const r = spawnSync('dotnet', ['run', '--no-build', '-v', 'q', '--nologo'],
    { cwd: WORK, input: JSON.stringify({ viewer, target }), encoding: 'utf8', maxBuffer: 32 << 20 });
  if (r.status !== 0) throw new Error('러너 실행 실패: ' + (r.stderr || r.stdout));
  const m = (r.stdout || '').match(/\{[\s\S]*\}$/);
  if (!m) throw new Error('러너 출력이 JSON 이 아니다: ' + (r.stdout || '').slice(0, 200));
  return JSON.parse(m[0]);
}

/* ── 시험용 조직·사용자 ────────────────────────────────────────────────── */
//  이름은 실 조직과 부딪히지 않게 접두어를 둔다.
const U_ALL = '__pv_all__', U_TREE = '__pv_tree__', U_SELF = '__pv_self__';
const U_IN = '__pv_in__', U_OUT = '__pv_out__';
const O_ROOT = '__PV루트__', O_MID = '__PV중간__', O_LEAF = '__PV잎__', O_FAR = '__PV딴곳__';
const ALL_USERS = [U_ALL, U_TREE, U_SELF, U_IN, U_OUT];
const ALL_UNITS = [O_ROOT, O_MID, O_LEAF, O_FAR];

function orgId(name) { return one(`SELECT org_id FROM org_unit WHERE name='${name}'`); }
function userId(login) { return one(`SELECT user_id FROM app_user WHERE login_id='${login}'`); }

function setup() {
  cleanup();
  //  조직: 루트 → 중간 → 잎 , 그리고 트리 밖의 딴곳
  sql(`INSERT INTO org_unit (name, parent_id, sort_order, is_active) VALUES ('${O_ROOT}', NULL, 900, 1)`,
      { readOnly: false, what: '조직 루트' });
  sql(`INSERT INTO org_unit (name, parent_id, sort_order, is_active) VALUES ('${O_MID}', ${orgId(O_ROOT)}, 901, 1)`,
      { readOnly: false, what: '조직 중간' });
  sql(`INSERT INTO org_unit (name, parent_id, sort_order, is_active) VALUES ('${O_LEAF}', ${orgId(O_MID)}, 902, 1)`,
      { readOnly: false, what: '조직 잎' });
  sql(`INSERT INTO org_unit (name, parent_id, sort_order, is_active) VALUES ('${O_FAR}', NULL, 903, 1)`,
      { readOnly: false, what: '조직 딴곳' });

  const mk = (login, org, scope) =>
    sql(`INSERT INTO app_user (login_id, name, org_id, view_scope, edit_role, is_active) ` +
        `VALUES ('${login}', '${login}', ${orgId(org)}, '${scope}', 'viewer', 1)`,
        { readOnly: false, what: '시험 사용자 ' + login });
  mk(U_ALL, O_FAR, 'all');        // 전원 열람
  mk(U_TREE, O_MID, 'unit_tree'); // 중간 팀장 — 중간·잎이 범위
  mk(U_SELF, O_MID, 'self');      // 자기만
  mk(U_IN, O_LEAF, 'self');       // U_TREE 의 범위 **안**
  mk(U_OUT, O_FAR, 'self');       // U_TREE 의 범위 **밖**

  for (const u of ALL_USERS)
    sql(`INSERT IGNORE INTO cal_user_rev (user_id, rev) VALUES (${userId(u)}, 0)`, { readOnly: false, what: 'rev 시딩' });

  //  대상(U_IN)에게 일정 2건 — 하나는 반복, 하나는 단발. 과제도 하나.
  const t = userId(U_IN);
  sql(`INSERT INTO cal_category (user_id,cat_no,uid,source,name,color,sort_order,created_at,updated_at) ` +
      `VALUES (${t},1,'c-pv-1','local','열람시험과제','#3e5be0',0,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000')`,
      { readOnly: false, what: '대상 과제' });
  sql(`INSERT INTO cal_entry (user_id,entry_no,uid,cat_no,entry_date,all_day,start_time,end_time,title,memo,source,location,sort_order,created_at,updated_at) ` +
      `VALUES (${t},1,'e-pv-1',1,'2026-09-10',0,'09:00','10:00','열람시험 단발','비밀메모','','',0,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000')`,
      { readOnly: false, what: '대상 일정1' });
  sql(`INSERT INTO cal_entry (user_id,entry_no,uid,cat_no,entry_date,all_day,title,memo,source,location,recur_freq,recur_interval,recur_count,sort_order,created_at,updated_at) ` +
      `VALUES (${t},2,'e-pv-2',1,'2026-09-01',1,'열람시험 반복','','','','weekly',1,0,1,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000')`,
      { readOnly: false, what: '대상 일정2' });
  sql(`INSERT INTO cal_entry_except (user_id,entry_no,except_date) VALUES (${t},2,'2026-09-08')`,
      { readOnly: false, what: '대상 예외일' });
  //  ★ 새어 나오면 안 되는 것들도 심는다 — '안 준다'를 증명하려면 있어야 한다.
  sql(`INSERT INTO cal_entry_commit (user_id,entry_no,seq,hash,short_hash,subject,body) ` +
      `VALUES (${t},1,0,'deadbeef','deadbee','비밀 커밋 제목','비밀 본문')`, { readOnly: false, what: '대상 커밋' });
  sql(`INSERT INTO cal_todo (user_id,todo_no,uid,todo_text,note,done,prio,sort_order,created_at,updated_at) ` +
      `VALUES (${t},1,'t-pv-1','비밀 할일','비밀 비고',0,'normal',0,'2026-01-01 00:00:00.000','2026-01-01 00:00:00.000')`,
      { readOnly: false, what: '대상 할일' });
}
function cleanup() {
  for (const u of ALL_USERS) {
    const id = userId(u);
    if (!id) continue;
    for (const t of ['cal_entry_commit', 'cal_entry_except', 'cal_todo_day_note', 'cal_task_hours',
                     'cal_attendance', 'cal_entry', 'cal_todo', 'cal_category', 'cal_room', 'cal_user_pref'])
      sql(`DELETE FROM ${t} WHERE user_id=${id}`, { readOnly: false, what: `정리(${t})` });
    sql(`DELETE FROM cal_user_rev WHERE user_id=${id}`, { readOnly: false, what: 'rev 정리' });
    sql(`DELETE FROM app_user WHERE user_id=${id}`, { readOnly: false, what: '사용자 정리' });
  }
  //  조직은 자식부터
  for (const o of [O_LEAF, O_MID, O_ROOT, O_FAR])
    sql(`DELETE FROM org_unit WHERE name='${o}'`, { readOnly: false, what: `조직 정리(${o})` });
}

/* ── main ──────────────────────────────────────────────────────────────── */
const t0 = Date.now();
console.log('═'.repeat(72));
console.log('타인 일정 열람 — 권한 경계 검증 (실 DB · 앱 계정)');
console.log('═'.repeat(72));
console.log('러너 빌드 중(CalendarDb + ProjectDb 를 링크)…');
buildRunner();

try {
  setup();
  console.log('시험 조직·사용자 준비 완료\n');

  console.log('[1] 허용 — 볼 수 있어야 한다');
  const a = peek(U_ALL, U_IN);
  ok('all 은 남을 본다', a.allowed === true, JSON.stringify(a).slice(0, 80));
  ok('일정 2건이 온다', (a.entries || []).length === 2, `${(a.entries || []).length}건`);
  ok('과제 1건이 온다', (a.categories || []).length === 1);
  ok('반복 일정의 예외일이 붙어 온다',
     (a.entries || []).some((e) => (e.recurExcept || []).includes('2026-09-08')));
  const tree = peek(U_TREE, U_IN);
  ok('unit_tree 는 자기 하위 조직을 본다', tree.allowed === true);
  const selfme = peek(U_SELF, U_SELF);
  ok('자기 자신은 언제나 본다', selfme.allowed === true);

  console.log('\n[2] 거부 — ★ 여기가 사고 자리다');
  ok('self 는 남을 못 본다', peek(U_SELF, U_IN).allowed === false);
  ok('unit_tree 는 트리 **밖** 을 못 본다', peek(U_TREE, U_OUT).allowed === false);
  ok('미등록 대상은 못 본다', peek(U_ALL, '__없는사람__').allowed === false);
  ok('미등록 요청자는 못 본다', peek('__없는사람__', U_IN).allowed === false);
  ok('빈 대상은 못 본다', peek(U_ALL, '').allowed === false);

  console.log('\n[3] 최소 payload — 목적에 없는 것은 아예 안 온다');
  const blob = JSON.stringify(a);
  for (const [needle, why] of [
    ['비밀메모', '메모'], ['비밀 커밋', '커밋 제목'], ['비밀 본문', '커밋 본문'],
    ['비밀 할일', '할 일'], ['비밀 비고', '할 일 비고'],
  ]) ok(`${why} 가 새지 않는다`, !blob.includes(needle));
  ok('일정에 memo 키 자체가 없다', (a.entries || []).every((e) => !('memo' in e)));
  ok('일정에 commits 키 자체가 없다', (a.entries || []).every((e) => !('commits' in e)));
  ok('거부 응답에는 데이터가 없다',
     Object.keys(peek(U_SELF, U_IN)).join(',') === 'allowed');

} catch (e) {
  fail++; F.push('중단: ' + e.message);
  console.log('\n[중단] ' + e.message);
} finally {
  try { cleanup(); } catch (e) { console.log('  ! 정리 실패: ' + e.message); }
  if (WORK && existsSync(WORK)) { try { rmSync(WORK, { recursive: true, force: true }); } catch {} }
}

console.log('\n' + '═'.repeat(72));
console.log(`통과 ${pass} · 실패 ${fail} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
if (F.length) { console.log('\n실패 목록:'); F.forEach((f) => console.log('  · ' + f)); }
console.log(fail === 0
  ? '권한 경계 통과 ✓ — 볼 수 있는 사람만 보고, 목적에 없는 것은 오지 않는다.'
  : '★ 실패 — 인가 경계다. 거짓 양성(볼 수 없는데 보임)은 사고다.');
console.log('═'.repeat(72));
process.exit(fail === 0 ? 0 : 1);
