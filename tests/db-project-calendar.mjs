#!/usr/bin/env node
/* =====================================================================
 *  db-project-calendar.mjs: 과제 캘린더 P1 DB 계약 시험(두 사람)
 *  docs/PROJECT-CALENDAR-PLAN.md §8.2 P1 "DB 계약 시험"
 * =====================================================================
 *
 *  ★ 이 파일은 `node tests/run-tests.mjs` 의 기본 스위트에 **포함되지 않는다**(loop-*.mjs 와 같은 실 DB 시험).
 *    이름이 *.test.mjs 가 아니라 러너가 수집하지 않는다. 그래서 strict 게이트에 skip 을 만들지 않는다.
 *
 *  【무엇을 증명하나】 위젯이 쓰는 호스트 클래스(widget/ProjectCalendarDb.cs, CalendarWriteDb.cs, ProjectDb.cs)를
 *    소스째 링크한 작은 C# 러너로, **두 사람의 세션**을 번갈아(또는 동시에) 써서 실제 MySQL 에 친다.
 *      - 내 과제에 없는 과제는 읽기 제외, 쓰기와 복사 거부(forbidden)
 *      - viewer(edit_role) 도 공용 쓰기를 한다
 *      - 같은 판으로 동시에 고치면 하나만 성공하고 하나는 conflict(최신 행 동봉)
 *      - 응답을 잃고 같은 mutationUid 로 다시 보내면 중복이 없다(생성과 수정 둘 다, 같은 생성 재시도가 동시에 와도)
 *      - 바뀐 것이 없는 저장은 이력도 판도 남기지 않는다(과제별 감시점 표는 없다, 2026-10-22 저녁 결정)
 *      - 삭제는 소프트 삭제이고 이력에 그때 제목이 남는다. 최근 변경 조회(종류 필터, 커서)
 *      - 숨긴(비활성) 과제는 읽기 전용(쓰기 forbidden, 읽기와 개인 복사는 된다). 비활성 사용자는 forbidden
 *      - 공용 일정이 있는 과제는 휴지통에서 영구 삭제가 거부되고, 없는 과제는 지워진다. 지워진 과제에 쓰면 원문 오류가 아니라 forbidden
 *      - 개인 복사: 한 번 찍는 사본(대응표 없음). 같은 원본을 두 번 등록하면 개인 일정 두 건, 부트스트랩에 copies 없음,
 *        복사본을 지워도 공용 일정은 그대로, 복사가 중간에 실패하면 개인 행 0
 *      - 글자 상한 초과는 invalid(자르지 않고 아무것도 쓰지 않는다)
 *
 *  【어디에 치나】 공용 개발 DB(taskcalendar)가 아니라 **복사본**(기본 zz_pc_dev, 이름이 zz_ 로 시작해야 한다)이다.
 *    구조 번호가 정확히 같아야 동작하는 관문 때문에 공용 DB 를 16 으로 올리면 다른 세션의 위젯이 막힌다(§8.1).
 *    복사본 만들기(이 스크립트는 하지 않는다, 비밀번호는 표준입력이나 환경 변수로만):
 *      mysqldump --single-transaction --routines --triggers --set-gtid-purged=OFF --no-tablespaces taskcalendar > dump.sql
 *      CREATE DATABASE zz_pc_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; 그 DB 에 dump.sql
 *      installer/release-sql.ps1 로 만든 release SQL 을 그 DB 에 돌려 구조 16 으로(또는 v16 조각만 닫고 열어서)
 *
 *  【계정】 앱 계정(taskmgr_app)의 권한은 건드리지 않는다. 일회용 계정(zz_pc_app_<pid>)을 만들어
 *    db/deploy/server-app-account.sql 의 권한(DB 이름만 바꿔서)을 그대로 주고, 끝나면(실패해도) 지운다.
 *    그래서 새 표에 DELETE 권한이 없어도 FK CASCADE 가 도는지까지 함께 본다. 일회용 계정의 비밀번호는 실행마다
 *    무작위로 만들고 환경 변수로만 러너에 넘긴다(파일에 남기지 않는다).
 *
 *  【실행】
 *    TC_TEST_DB_ADMIN_PW=<root 비번>(환경 변수로만) node tests/db-project-calendar.mjs [--db=zz_pc_dev]
 *    종료코드: 0 통과, 1 실패, 2 판정 불가(전제가 안 섰다. 초록이 아니다)
 *  시험 데이터 이름은 모두 zz_pc 로 시작한다(app_user.login_id, project.project_name).
 * ===================================================================== */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARG = new Map(process.argv.slice(2).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const OPT = {
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',
  db: String(ARG.get('db') || process.env.TC_TEST_DB_NAME || 'zz_pc_dev'),
};
if (!OPT.adminPw) { console.error('[중단] TC_TEST_DB_ADMIN_PW 가 필요합니다(환경 변수로만).'); process.exit(2); }
if (!/^zz_[A-Za-z0-9_]+$/.test(OPT.db)) { console.error(`[중단] 시험 DB 이름은 zz_ 로 시작해야 합니다(공용 DB 보호): ${OPT.db}`); process.exit(2); }

// ── root SQL(비밀번호는 MYSQL_PWD 환경 변수로만. 명령줄에 두지 않는다) ─────────────
const EOF = '__TCEOF__';
function sql(q, what = 'SQL') {
  const r = spawnSync(OPT.mysql, ['-u' + OPT.adminUser, '--default-character-set=utf8mb4', '-N', '-B', '-D', OPT.db],
    { input: Buffer.from(q + `;\nSELECT '${EOF}';\n`, 'utf8'), env: { ...process.env, MYSQL_PWD: OPT.adminPw }, maxBuffer: 64 << 20 });
  const out = (r.stdout || Buffer.alloc(0)).toString('utf8');
  if (r.status !== 0) throw new Error(`${what} 실패: ${(r.stderr || '').toString().trim()}`);
  if (!out.includes(EOF)) throw new Error(`${what}: mysql 출력이 잘렸다`);
  return out.split(/\r?\n/).filter((l) => l.length && l !== EOF).map((l) => l.split('\t'));
}
const one = (q, w) => { const r = sql(q, w); return r.length ? r[0][0] : null; };
const num = (q, w) => Number(one(q, w));
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");

let pass = 0, fail = 0; const F = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; F.push(n); console.log(`  ✗ ${n}${d ? ' : ' + d : ''}`); } };

// ── 러너(위젯 소스를 그대로 링크) ────────────────────────────────────────
const RUNNER_CS = String.raw`using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using TaskCalendarWidget;

//  시험 대역: 세션 파일을 평문으로 둔다(DPAPI 대신). 위젯의 UserSession.Save/Load 경로는 그대로 탄다.
internal static class Dpapi
{
    public static byte[] Protect(byte[] b) => b;
    public static byte[] Unprotect(byte[] b) => b;
}

class R
{
    static async Task<object?> One(JsonElement s, Action<string> log)
    {
        string op = s.GetProperty("op").GetString() ?? "";
        string dir = s.TryGetProperty("dataDir", out var d) ? d.GetString() ?? "" : "";
        switch (op)
        {
            case "login":
            {
                System.IO.Directory.CreateDirectory(dir);
                var (ok, msg) = UserSession.Save(dir, s.GetProperty("loginId").GetString() ?? "", "zz", "", "", log);
                return new { ok, msg };
            }
            case "cmd":
            {
                var r = await new ProjectCalendarDb(dir, log).HandleAsync(s.GetProperty("cmd").GetString() ?? "", s.GetProperty("payload").GetRawText());
                return new { reply = r.ToPayload(), reload = r.ReloadPersonal };
            }
            case "parallel":
            {
                var a = s.GetProperty("a"); var b = s.GetProperty("b");
                var gate = new TaskCompletionSource();
                async Task<object> Go(JsonElement x)
                {
                    await gate.Task;
                    var r = await new ProjectCalendarDb(x.GetProperty("dataDir").GetString() ?? "", log).HandleAsync(x.GetProperty("cmd").GetString() ?? "", x.GetProperty("payload").GetRawText());
                    return r.ToPayload();
                }
                var ta = Task.Run(() => Go(a)); var tb = Task.Run(() => Go(b));
                await Task.Delay(50); gate.SetResult();
                return new { a = await ta, b = await tb };
            }
            case "trashDelete":
            {
                var (ok, msg) = await new ProjectDb(dir, log).DeleteTrashAsync("project", s.GetProperty("key").GetString(), s.GetProperty("confirm").GetString());
                return new { ok, msg };
            }
            case "deletePersonalEntry":
            {
                //  개인 저장 경로(CalendarWriteDb.SaveAsync)로 개인 일정 한 건을 지운다. 앱 계정 권한 그대로다.
                string login = s.GetProperty("loginId").GetString() ?? "";
                string uid = s.GetProperty("entryUid").GetString() ?? "";
                var snap = await new CalendarDb(log).LoadSnapshotAsync(login, null);
                if (snap == null) return new { ok = false, msg = "snapshot null" };
                var st = JsonNode.Parse(snap.StateJson)!.AsObject();
                var arr = st["entries"]!.AsArray();
                int removed = 0;
                for (int i = arr.Count - 1; i >= 0; i--) if ((string?)arr[i]!["id"] == uid) { arr.RemoveAt(i); removed++; }
                var r = await new CalendarWriteDb(log).SaveAsync(snap, st.ToJsonString());
                return new { ok = r.Ok, msg = r.Message, removed, del = r.Deleted };
            }
        }
        return new { ok = false, msg = "unknown op " + op };
    }

    static async Task<int> Main()
    {
        //  표준 입출력은 UTF-8 바이트로 직접 읽고 쓴다(콘솔 코드 페이지가 한글을 깨뜨리지 않게).
        string raw;
        using (var sr = new System.IO.StreamReader(Console.OpenStandardInput(), new System.Text.UTF8Encoding(false))) raw = sr.ReadToEnd();
        using var doc = JsonDocument.Parse(raw);
        var logs = new List<string>();
        var results = new List<object?>();
        foreach (var s in doc.RootElement.EnumerateArray()) results.Add(await One(s, m => logs.Add(m)));
        var bytes = new System.Text.UTF8Encoding(false).GetBytes(JsonSerializer.Serialize(new { results, logs }));
        using (var so = Console.OpenStandardOutput()) so.Write(bytes, 0, bytes.Length);
        return 0;
    }
}
`;

//  배포 구성 대체본: 시험 DB 와 일회용 계정을 환경 변수에서 읽는다(파일에 비밀번호를 쓰지 않는다).
const DEPLOY_CS = String.raw`using System;
namespace TaskCalendarWidget
{
    internal static class DeployConfig
    {
        private static string Env(string k) => Environment.GetEnvironmentVariable(k) ?? "";
        public static readonly string DbHost = "127.0.0.1";
        public static readonly int DbPort = 3306;
        public static readonly string DbName = Env("TC_PC_DB");
        public static readonly string DbUser = Env("TC_PC_USER");
        public static readonly string DbPassword = Env("TC_PC_PW");
        public const string UpdateSourceUrl = "";
        public const bool XmlRetired = true;
    }
}
`;

const WIDGET = ['ProjectCalendarDb.cs', 'CalendarWriteDb.cs', 'CalendarDb.cs', 'ProjectDb.cs', 'RepoPaths.cs', 'UserSession.cs', 'DbErrors.cs', 'DbFault.cs', 'DbGate.cs'];
const PROJ = (root) => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable><LangVersion>latest</LangVersion><ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>pcr</AssemblyName><RootNamespace>PCR</RootNamespace>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems><NoWarn>CS0649</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="R.cs" /><Compile Include="DeployConfig.cs" />
${WIDGET.map((f) => `    <Compile Include="${root}/widget/${f}" />`).join('\n')}
  </ItemGroup>
  <ItemGroup><PackageReference Include="MySqlConnector" Version="2.3.7" /></ItemGroup>
</Project>`;

let WORK = null, APP_USER = null;
const APP_PW = randomBytes(18).toString('base64url');
function buildRunner() {
  WORK = mkdtempSync(join(tmpdir(), 'tc-pc-'));
  writeFileSync(join(WORK, 'R.cs'), RUNNER_CS, 'utf8');
  writeFileSync(join(WORK, 'DeployConfig.cs'), DEPLOY_CS, 'utf8');
  writeFileSync(join(WORK, 'pcr.csproj'), PROJ(ROOT.replace(/\\/g, '/')), 'utf8');
  const b = spawnSync('dotnet', ['build', '-v', 'q', '--nologo', '-o', join(WORK, 'out')], { cwd: WORK, encoding: 'utf8' });
  if (b.status !== 0) { console.error('[중단] 러너 빌드 실패:\n' + (b.stdout || '') + (b.stderr || '')); process.exit(2); }
}
function run(steps) {
  const r = spawnSync(join(WORK, 'out', 'pcr.exe'), [], {
    input: JSON.stringify(steps), encoding: 'utf8', maxBuffer: 64 << 20,
    env: { ...process.env, TC_PC_DB: OPT.db, TC_PC_USER: APP_USER, TC_PC_PW: APP_PW, TC_TEST_DB_ADMIN_PW: '' },
  });
  if (r.status !== 0) throw new Error('러너 실행 실패: ' + (r.stderr || r.stdout));
  const out = JSON.parse(r.stdout);
  out.results.logs = out.logs;
  return out.results;
}
const DIRS = {};
const cmd = (who, c, payload) => run([{ op: 'cmd', dataDir: DIRS[who], cmd: c, payload }])[0].reply;
const cmdFull = (who, c, payload) => run([{ op: 'cmd', dataDir: DIRS[who], cmd: c, payload }])[0];

// ── 일회용 계정: server-app-account.sql 의 권한을 DB 이름만 바꿔 준다 ───────────
function makeAppAccount() {
  APP_USER = 'zz_pc_app_' + process.pid;
  const src = readFileSync(join(ROOT, 'db', 'deploy', 'server-app-account.sql'), 'utf8');
  const grants = [...src.matchAll(/^GRANT ([A-Z, ]+) ON `taskcalendar`\.`(\w+)` TO 'taskmgr_app'@'%';$/gm)]
    .map((m) => `GRANT ${m[1]} ON \`${OPT.db}\`.\`${m[2]}\` TO '${APP_USER}'@'%'`);
  if (grants.length < 20) throw new Error('server-app-account.sql 에서 권한 줄을 읽지 못했다');
  sql(`CREATE USER '${APP_USER}'@'%' IDENTIFIED BY '${esc(APP_PW)}';\n${grants.join(';\n')}`, '일회용 계정 만들기');
}
function dropAppAccount() {
  if (!APP_USER) return;
  try { sql(`DROP USER IF EXISTS '${APP_USER}'@'%'`, '일회용 계정 지우기'); } catch (e) { console.error('일회용 계정을 지우지 못했다: ' + e.message); }
}

// ── 시험 데이터(이름은 zz_pc) ────────────────────────────────────────────
const D = {};
function seed() {
  const tag = String(Date.now()).slice(-6);
  const users = { u1: ['zz_pc_u1_' + tag, 'zz공용일', 'viewer', 1], u2: ['zz_pc_u2_' + tag, 'zz공용이', 'viewer', 1],
    admin: ['zz_pc_ad_' + tag, 'zz관리', 'admin', 1], out: ['zz_pc_out_' + tag, 'zz퇴사', 'viewer', 0] };
  for (const [k, [login, name, role, act]] of Object.entries(users)) {
    sql(`INSERT INTO app_user (login_id, name, edit_role, is_active) VALUES ('${login}', '${esc(name)}', '${role}', ${act})`, '사용자');
    const id = num(`SELECT user_id FROM app_user WHERE login_id='${login}'`);
    sql(`INSERT IGNORE INTO cal_user_rev (user_id, rev) VALUES (${id}, 0)`, 'rev 시딩');
    D[k] = { login, name, id };
  }
  const sec = num('SELECT MIN(section_id) FROM section_code'), cus = num('SELECT MIN(customer_id) FROM customer');
  for (const k of ['p1', 'p2', 'p3']) {
    const name = `zz_pc ${k} ${tag}`;
    sql(`INSERT INTO project (section_id, customer_id, project_name) VALUES (${sec}, ${cus}, '${esc(name)}')`, '과제');
    const [id, uid] = sql(`SELECT id, uid FROM project WHERE project_name='${esc(name)}'`)[0];
    D[k] = { id: Number(id), uid, name };
  }
  //  내 과제: u1 은 p1, p3. u2 는 p1. out 은 p1. p2 는 아무도 넣지 않았다.
  const addCat = (who, p) => {
    const u = D[who].id;
    const no = num(`SELECT IFNULL(MAX(cat_no),0)+1 FROM cal_category WHERE user_id=${u}`);
    sql(`INSERT INTO cal_category (user_id, cat_no, uid, source, name, color, project_uid, sort_order, created_at, updated_at)
         VALUES (${u}, ${no}, 'db-${D[p].uid}', 'db', '${esc(D[p].name)}', '#336699', '${D[p].uid}', ${no}, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, '내 과제');
  };
  addCat('u1', 'p1'); addCat('u1', 'p3'); addCat('u2', 'p1'); addCat('out', 'p1');
}

const ev = (title, extra = {}) => ({ title, startDate: '2026-11-02', endDate: '2026-11-02', startTime: '', endTime: '', location: '', memo: '', ...extra });
const nChanges = (where) => num(`SELECT COUNT(*) FROM cal_project_change WHERE ${where}`);

async function main() {
  //  전제: 시험 DB 가 있고 구조 16, 새 표 둘
  let v;
  try { v = one("SELECT v FROM cal_schema_meta WHERE k='db_structure_version'"); } catch (e) { console.error('[중단] 시험 DB 에 붙지 못했다: ' + e.message); process.exit(2); }
  const nt = num(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${OPT.db}' AND TABLE_NAME IN ('cal_project_event','cal_project_change')`);
  const upd = one("SELECT v FROM cal_schema_meta WHERE k='db_updating'");
  //  구조 번호는 앱(DbGate.AppStructureVersion)과 정확히 같아야 관문이 연다. 2026-10-22 월간보고(v17)로 17 이다.
  const appv = /public const int AppStructureVersion = (\d+);/.exec(readFileSync(join(ROOT, 'widget', 'DbGate.cs'), 'utf8'))[1];
  if (v !== appv || nt !== 2 || upd !== '0') { console.error(`[중단] ${OPT.db} 가 구조 ${appv}(앱과 같은 번호, 과제 캘린더 표 둘, 열림)이 아니다: v=${v} 표=${nt} db_updating=${upd}`); process.exit(2); }
  console.log(`DB ${OPT.db}: 구조 ${v}, 새 표 ${nt}`);

  buildRunner();
  makeAppAccount();
  try {
    seed();
    for (const k of ['u1', 'u2', 'admin', 'out']) {
      DIRS[k] = join(WORK, 'data-' + k); mkdirSync(DIRS[k], { recursive: true });
      const r = run([{ op: 'login', dataDir: DIRS[k], loginId: D[k].login }])[0];
      if (!r.ok) throw new Error('세션 저장 실패: ' + r.msg);
    }

    console.log('\n[판정과 신원]');
    let r = cmd('u1', 'projectCalendarBootstrap', {});
    const mine = r.ok ? r.data.projects.map((p) => p.projectUid) : [];
    ok('부트스트랩: 내 과제의 공식 과제만(p1, p3), p2 없음', r.ok && mine.includes(D.p1.uid) && mine.includes(D.p3.uid) && !mine.includes(D.p2.uid), JSON.stringify(r).slice(0, 300));
    ok('부트스트랩: 참여자 수는 내 과제에 넣은 활성 사용자 수(p1 = 2)', r.ok && r.data.projects.find((p) => p.projectUid === D.p1.uid).members === 2);
    ok('부트스트랩: 글자 상한을 함께 준다(200, 200, 8000)', r.ok && r.data.limits.title === 200 && r.data.limits.location === 200 && r.data.limits.memo === 8000);
    r = cmd('u1', 'projectCalendarLoad', { projectUids: [D.p1.uid, D.p2.uid], from: '2026-11-01', to: '2026-11-30' });
    ok('내 과제에 없는 과제 읽기: 제외하고 알린다(excluded)', r.ok && r.data.excluded.includes(D.p2.uid) && r.data.projects.length === 1);
    const evX = randomUUID();
    r = cmd('u1', 'projectCalendarSave', { projectUid: D.p2.uid, eventUid: evX, mutationUid: randomUUID(), event: ev('zz 남의 과제') });
    ok('내 과제에 없는 과제 쓰기: forbidden, 아무것도 쓰지 않음', !r.ok && r.error.kind === 'forbidden' && num(`SELECT COUNT(*) FROM cal_project_event WHERE uid='${evX}'`) === 0 && nChanges(`project_id=${D.p2.id}`) === 0, JSON.stringify(r));
    r = cmd('out', 'projectCalendarBootstrap', {});
    ok('비활성 사용자: forbidden', !r.ok && r.error.kind === 'forbidden', JSON.stringify(r));
    r = cmd('u1', 'projectCalendarSave', { projectUid: D.p1.uid, eventUid: randomUUID(), mutationUid: randomUUID(), event: ev('zz 사용자값'), loginId: D.u2.login, userId: D.u2.id });
    ok('웹이 보낸 사용자 값은 무시(글쓴이는 세션의 사람)', r.ok && r.data.event.createdBy === D.u1.name, JSON.stringify(r).slice(0, 300));

    console.log('\n[공용 쓰기]');
    const e1 = randomUUID();
    r = cmd('u1', 'projectCalendarSave', { projectUid: D.p1.uid, eventUid: e1, mutationUid: randomUUID(), event: ev('zz 일정1', { endDate: '2026-11-04', memo: '첫 줄\n둘째 줄' }) });
    ok('viewer 가 공용 일정을 만든다(rowVersion 1)', r.ok && r.data.rowVersion === 1 && r.data.event.endDate === '2026-11-04', JSON.stringify(r).slice(0, 300));
    r = cmd('u2', 'projectCalendarLoad', { projectUids: [D.p1.uid], from: '2026-11-01', to: '2026-11-30' });
    ok('다른 사람(u2)이 같은 일정을 읽는다', r.ok && r.data.events.some((x) => x.eventUid === e1) && !('rev' in r.data.projects[0]), JSON.stringify(r).slice(0, 300));

    const par = run([{ op: 'parallel',
      a: { dataDir: DIRS.u1, cmd: 'projectCalendarSave', payload: { projectUid: D.p1.uid, eventUid: e1, expectedVersion: 1, mutationUid: randomUUID(), event: ev('zz 일정1 가', { endDate: '2026-11-04' }) } },
      b: { dataDir: DIRS.u2, cmd: 'projectCalendarSave', payload: { projectUid: D.p1.uid, eventUid: e1, expectedVersion: 1, mutationUid: randomUUID(), event: ev('zz 일정1 나', { endDate: '2026-11-04' }) } } }])[0];
    const oks = [par.a, par.b].filter((x) => x.ok), cons = [par.a, par.b].filter((x) => !x.ok && x.error.kind === 'conflict');
    ok('같은 판으로 동시에 고치면 하나만 성공, 하나는 conflict', oks.length === 1 && cons.length === 1, JSON.stringify(par).slice(0, 400));
    ok('conflict 에 최신 행(판 2)을 함께 준다', cons.length === 1 && cons[0].data && cons[0].data.latest && cons[0].data.latest.rowVersion === 2);
    ok('동시 수정 뒤 판 2, 이력 2(create, update)', num(`SELECT row_version FROM cal_project_event WHERE uid='${e1}'`) === 2 && nChanges(`event_id=(SELECT event_id FROM cal_project_event WHERE uid='${e1}')`) === 2);

    const m1 = randomUUID();
    const upPayload = { projectUid: D.p1.uid, eventUid: e1, expectedVersion: 2, mutationUid: m1, event: ev('zz 일정1 고침', { endDate: '2026-11-05', location: '3층 회의실' }) };
    r = cmd('u2', 'projectCalendarSave', upPayload);
    const r2 = cmd('u2', 'projectCalendarSave', upPayload);
    ok('수정 재시도(같은 mutationUid): 중복 없음, 같은 결과(replayed)', r.ok && r2.ok && r2.data.replayed === true && r2.data.rowVersion === 3 &&
      nChanges(`mutation_uid='${m1}'`) === 1 && num(`SELECT row_version FROM cal_project_event WHERE uid='${e1}'`) === 3, JSON.stringify(r2).slice(0, 300));
    const before = JSON.parse(one(`SELECT JSON_OBJECT('b', before_json, 'a', after_json) FROM cal_project_change WHERE mutation_uid='${m1}'`));
    ok('이력에는 바뀐 필드만(title, endDate, location)', JSON.stringify(Object.keys(before.a).sort()) === JSON.stringify(['endDate', 'location', 'title']) &&
      before.b.location === '' && before.a.location === '3층 회의실', JSON.stringify(before));

    const e2 = randomUUID(), c2 = randomUUID();
    const crPayload = { projectUid: D.p1.uid, eventUid: e2, mutationUid: c2, event: ev('zz 지울 일정', { startTime: '09:00', endTime: '10:30' }) };
    r = cmd('u1', 'projectCalendarSave', crPayload);
    const rr = cmd('u1', 'projectCalendarSave', crPayload);
    ok('생성 재시도(같은 eventUid, mutationUid): 행 1, 이력 1', r.ok && rr.ok && rr.data.replayed === true &&
      num(`SELECT COUNT(*) FROM cal_project_event WHERE uid='${e2}'`) === 1 && nChanges(`mutation_uid='${c2}'`) === 1);
    const e3 = randomUUID(), c3 = randomUUID();
    const crPar = { projectUid: D.p1.uid, eventUid: e3, mutationUid: c3, event: ev('zz 동시 재시도') };
    const parC = run([{ op: 'parallel', a: { dataDir: DIRS.u1, cmd: 'projectCalendarSave', payload: crPar }, b: { dataDir: DIRS.u1, cmd: 'projectCalendarSave', payload: crPar } }])[0];
    ok('같은 생성 재시도가 동시에 와도: 둘 다 ok(하나는 replayed), 행 1, 이력 1(과제별 감시점 없이)', parC.a.ok && parC.b.ok && [parC.a, parC.b].filter((x) => x.data.replayed === true).length === 1 &&
      num(`SELECT COUNT(*) FROM cal_project_event WHERE uid='${e3}'`) === 1 && nChanges(`mutation_uid='${c3}'`) === 1, JSON.stringify(parC).slice(0, 400));
    //  서로 다른 두 생성이 같은 과제에 동시에 와도 둘 다 들어간다(없는 uid 를 잠금 읽기하면 색인 빈틈 교착, 1213)
    for (let k = 0; k < 3; k++) {
      const ea = randomUUID(), eb = randomUUID();
      const parD = run([{ op: 'parallel', a: { dataDir: DIRS.u1, cmd: 'projectCalendarSave', payload: { projectUid: D.p1.uid, eventUid: ea, mutationUid: randomUUID(), event: ev('zz 동시 생성 가' + k) } },
        b: { dataDir: DIRS.u2, cmd: 'projectCalendarSave', payload: { projectUid: D.p1.uid, eventUid: eb, mutationUid: randomUUID(), event: ev('zz 동시 생성 나' + k) } } }])[0];
      ok('다른 두 생성이 동시에 와도 둘 다 저장(교착 없음) #' + (k + 1), parD.a.ok && parD.b.ok &&
        num(`SELECT COUNT(*) FROM cal_project_event WHERE uid IN ('${ea}','${eb}')`) === 2, JSON.stringify({ a: parD.a.error || 'ok', b: parD.b.error || 'ok' }));
    }
    const rr2 = cmd('u1', 'projectCalendarSave', { ...crPayload, mutationUid: randomUUID() });
    ok('생성 재시도(같은 eventUid, 새 mutationUid): 행 1 그대로', rr2.ok && rr2.data.replayed === true && num(`SELECT COUNT(*) FROM cal_project_event WHERE uid='${e2}'`) === 1);

    const chBefore = nChanges(`project_id=${D.p1.id}`);
    r = cmd('u1', 'projectCalendarSave', { projectUid: D.p1.uid, eventUid: e1, expectedVersion: 3, mutationUid: randomUUID(), event: ev('zz 일정1 고침', { endDate: '2026-11-05', location: '3층 회의실' }) });
    ok('바뀐 것 없는 저장: 이력 없음, 판 그대로, 회신에 과제별 판 없음', r.ok && r.data.unchanged === true && r.data.rowVersion === 3 && !('projectRev' in r.data) &&
      nChanges(`project_id=${D.p1.id}`) === chBefore, JSON.stringify(r).slice(0, 300));
    r = cmd('u1', 'projectCalendarSave', { projectUid: D.p1.uid, eventUid: e1, expectedVersion: 2, mutationUid: randomUUID(), event: ev('zz 낡은 판') });
    ok('낡은 판으로 저장: conflict, 자동 덮어쓰기 없음', !r.ok && r.error.kind === 'conflict' && one(`SELECT title FROM cal_project_event WHERE uid='${e1}'`) === 'zz 일정1 고침');

    r = cmd('u2', 'projectCalendarDelete', { projectUid: D.p1.uid, eventUid: e2, expectedVersion: 1, mutationUid: randomUUID() });
    ok('삭제: 소프트 삭제(행은 남고 is_deleted 1)', r.ok && num(`SELECT is_deleted FROM cal_project_event WHERE uid='${e2}'`) === 1 && one(`SELECT deleted_at IS NOT NULL FROM cal_project_event WHERE uid='${e2}'`) === '1');
    ok('삭제 이력에 그때 제목(title_snapshot)과 앞 값만', one(`SELECT title_snapshot FROM cal_project_change WHERE action='delete' AND event_id=(SELECT event_id FROM cal_project_event WHERE uid='${e2}')`) === 'zz 지울 일정' &&
      one(`SELECT after_json IS NULL AND before_json IS NOT NULL FROM cal_project_change WHERE action='delete' AND event_id=(SELECT event_id FROM cal_project_event WHERE uid='${e2}')`) === '1');
    r = cmd('u1', 'projectCalendarLoad', { projectUids: [D.p1.uid], from: '2026-11-01', to: '2026-11-30' });
    ok('지운 일정은 범위 조회에 없다', r.ok && !r.data.events.some((x) => x.eventUid === e2) && r.data.events.some((x) => x.eventUid === e1));
    r = cmd('u1', 'projectCalendarChanges', { projectUids: [D.p1.uid], kind: 'delete' });
    ok('최근 변경(종류 delete): 지운 일정 한 줄, 제목 남음', r.ok && r.data.rows.length === 1 && r.data.rows[0].title === 'zz 지울 일정' && r.data.rows[0].after === null);
    const all = cmd('u1', 'projectCalendarChanges', { projectUids: [D.p1.uid], limit: 2 });
    const next = all.ok && all.data.nextCursor ? cmd('u1', 'projectCalendarChanges', { projectUids: [D.p1.uid], limit: 50, cursor: all.data.nextCursor }) : null;
    const total = nChanges(`project_id=${D.p1.id}`);
    ok('최근 변경 커서: 2건 + 나머지 = 전체, 겹침 없음', all.ok && all.data.hasMore === true && next && next.ok &&
      all.data.rows.length + next.data.rows.length === total &&
      !next.data.rows.some((x) => all.data.rows.some((y) => y.changeNo === x.changeNo)), `total=${total}`);
    r = cmd('u1', 'projectCalendarChanges', { projectUids: [D.p2.uid] });
    ok('내 과제에 없는 과제의 이력: 제외(excluded)', r.ok && r.data.rows.length === 0 && r.data.excluded.includes(D.p2.uid));

    console.log('\n[글자 상한]');
    const big = randomUUID();
    r = cmd('u1', 'projectCalendarSave', { projectUid: D.p1.uid, eventUid: big, mutationUid: randomUUID(), event: ev('가'.repeat(201)) });
    ok('제목 201자: invalid, 쓰지 않음', !r.ok && r.error.kind === 'invalid' && num(`SELECT COUNT(*) FROM cal_project_event WHERE uid='${big}'`) === 0);
    r = cmd('u1', 'projectCalendarSave', { projectUid: D.p1.uid, eventUid: big, mutationUid: randomUUID(), event: ev('zz 메모', { memo: 'm'.repeat(8001) }) });
    ok('메모 8,001자: invalid', !r.ok && r.error.kind === 'invalid');
    r = cmd('u1', 'projectCalendarSave', { projectUid: D.p1.uid, eventUid: big, mutationUid: randomUUID(), event: ev('가'.repeat(199) + '😀', { memo: '가'.repeat(8000), location: '장'.repeat(200) }) });
    ok('상한 그대로(제목 200자, 이모지 한 글자, 메모 8,000, 장소 200): 저장되고 자르지 않음', r.ok &&
      num(`SELECT CHAR_LENGTH(title) FROM cal_project_event WHERE uid='${big}'`) === 200 && num(`SELECT CHAR_LENGTH(memo) FROM cal_project_event WHERE uid='${big}'`) === 8000, JSON.stringify(r).slice(0, 200));
    r = cmd('u1', 'projectCalendarSave', { projectUid: D.p1.uid, eventUid: randomUUID(), mutationUid: randomUUID(), event: ev('zz 시각', { endDate: '2026-11-03', startTime: '09:00', endTime: '10:00' }) });
    ok('여러 날 일정에 시각: invalid', !r.ok && r.error.kind === 'invalid');

    console.log('\n[숨긴 과제]');
    sql(`UPDATE project SET is_active=0 WHERE id=${D.p1.id}`, '과제 숨김');
    r = cmd('u1', 'projectCalendarSave', { projectUid: D.p1.uid, eventUid: randomUUID(), mutationUid: randomUUID(), event: ev('zz 숨김 뒤') });
    ok('숨긴 과제 쓰기: forbidden(읽기 전용)', !r.ok && r.error.kind === 'forbidden', JSON.stringify(r));
    r = cmd('u1', 'projectCalendarLoad', { projectUids: [D.p1.uid], from: '2026-11-01', to: '2026-11-30' });
    ok('숨긴 과제 읽기: 되고 writable false', r.ok && r.data.projects[0].writable === false && r.data.events.length >= 1);

    console.log('\n[개인 복사]');
    const u1Entries = () => num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${D.u1.id}`);
    const n0 = u1Entries();
    let c = cmdFull('u1', 'projectCalendarCopy', { projectUid: D.p1.uid, eventUid: e1, expectedVersion: 3, mutationUid: randomUUID() });
    const entryUid = c.reply.ok ? c.reply.data.entryUid : '';
    ok('숨긴 과제의 일정도 개인 복사가 된다(새 개인 일정, 재적재 표시)', c.reply.ok && !('existed' in c.reply.data) && c.reload === true && u1Entries() === n0 + 1, JSON.stringify(c).slice(0, 300));
    const pe = sql(`SELECT e.title, DATE_FORMAT(e.entry_date,'%Y-%m-%d'), DATE_FORMAT(e.end_date,'%Y-%m-%d'), e.location, e.remind, c.project_uid FROM cal_entry e JOIN cal_category c ON c.user_id=e.user_id AND c.cat_no=e.cat_no WHERE e.user_id=${D.u1.id} AND e.uid='${entryUid}'`)[0] || [];
    ok('복사본: 제목, 기간, 장소 그대로, 알림 없음(0), 분류는 그 공식 과제', pe[0] === 'zz 일정1 고침' && pe[1] === '2026-11-02' && pe[2] === '2026-11-05' && pe[3] === '3층 회의실' && pe[4] === '0' && pe[5] === D.p1.uid, JSON.stringify(pe));
    //  한 번 찍는 사본(2026-10-22 저녁 결정): 대응표가 없어 같은 원본을 다시 등록하면 개인 일정이 하나 더 생긴다
    c = cmdFull('u1', 'projectCalendarCopy', { projectUid: D.p1.uid, eventUid: e1, mutationUid: randomUUID() });
    const entryUid2 = c.reply.ok ? c.reply.data.entryUid : '';
    ok('같은 원본 다시 등록: 새 개인 일정이 하나 더(막지 않는다, 재적재 표시)', c.reply.ok && !!entryUid2 && entryUid2 !== entryUid && c.reload === true && u1Entries() === n0 + 2, JSON.stringify(c).slice(0, 300));
    ok('과제 캘린더 표가 둘뿐이다(대응표, 감시점 없음)', num(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${OPT.db}' AND TABLE_NAME LIKE 'cal_project%'`) === 2);
    r = cmd('u1', 'projectCalendarBootstrap', {});
    ok('부트스트랩이 복사 대응(copies)을 돌려주지 않는다', r.ok && !('copies' in r.data), JSON.stringify(r).slice(0, 200));
    r = cmd('u1', 'projectCalendarCopy', { projectUid: D.p2.uid, eventUid: e1, mutationUid: randomUUID() });
    ok('내 과제에 없는 과제로 복사: forbidden', !r.ok && r.error.kind === 'forbidden');
    const del = run([{ op: 'deletePersonalEntry', loginId: D.u1.login, entryUid }])[0];
    ok('복사본을 개인 저장으로 지워도 공용 일정과 다른 복사본은 그대로', del.ok && del.removed === 1 &&
      num(`SELECT COUNT(*) FROM cal_project_event WHERE uid='${e1}' AND is_deleted=0`) === 1 && u1Entries() === n0 + 1, JSON.stringify(del));

    //  복사가 중간(개인 rev 를 올린 뒤의 개인 일정 INSERT)에서 실패하면 한 트랜잭션이라 아무것도 남지 않는다
    const u2n = num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${D.u2.id}`), u2rev = num(`SELECT rev FROM cal_user_rev WHERE user_id=${D.u2.id}`);
    sql(`REVOKE INSERT ON \`${OPT.db}\`.\`cal_entry\` FROM '${APP_USER}'@'%'`, '개인 일정 INSERT 회수');
    try {
      r = cmd('u2', 'projectCalendarCopy', { projectUid: D.p1.uid, eventUid: e1, mutationUid: randomUUID() });
      ok('복사가 개인 일정 넣기에서 실패하면 개인 일정도 rev 도 남지 않는다', !r.ok && num(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${D.u2.id}`) === u2n &&
        num(`SELECT rev FROM cal_user_rev WHERE user_id=${D.u2.id}`) === u2rev, JSON.stringify(r));
    } finally {
      sql(`GRANT INSERT ON \`${OPT.db}\`.\`cal_entry\` TO '${APP_USER}'@'%'`, '개인 일정 INSERT 되돌리기');
    }

    console.log('\n[휴지통 영구 삭제]');
    r = run([{ op: 'trashDelete', dataDir: DIRS.admin, key: D.p1.uid, confirm: D.p1.name }])[0];
    ok('공용 일정이 있는 과제는 영구 삭제 거부(고정 문구), 과제와 일정 그대로', !r.ok && /과제 캘린더 일정이 있는 과제는 지울 수 없습니다/.test(r.msg) &&
      num(`SELECT COUNT(*) FROM project WHERE id=${D.p1.id}`) === 1, JSON.stringify(r));
    sql(`UPDATE project SET is_active=0 WHERE id=${D.p3.id}`, 'p3 숨김');
    r = run([{ op: 'trashDelete', dataDir: DIRS.admin, key: D.p3.uid, confirm: D.p3.name }])[0];
    ok('공용 일정이 없는 과제는 지워진다', r.ok && num(`SELECT COUNT(*) FROM project WHERE id=${D.p3.id}`) === 0, JSON.stringify(r));
    r = cmd('u1', 'projectCalendarSave', { projectUid: D.p3.uid, eventUid: randomUUID(), mutationUid: randomUUID(), event: ev('zz 지워진 과제') });
    ok('지워진 과제에 일정 등록: 원문 오류가 아니라 forbidden(고정 문구), 아무것도 쓰지 않음', !r.ok && r.error.kind === 'forbidden' && !!r.error.message &&
      num(`SELECT COUNT(*) FROM cal_project_event WHERE project_id=${D.p3.id}`) === 0, JSON.stringify(r));
    sql(`UPDATE project SET is_active=1 WHERE id=${D.p1.id}`, '과제 복구');
  } finally {
    dropAppAccount();
    try { rmSync(WORK, { recursive: true, force: true }); } catch (_) { }
  }

  console.log(`\n${pass} pass / ${fail} fail`);
  if (fail) { console.log('실패: ' + F.join(' | ')); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error('[판정 불가] ' + (e && e.stack || e)); dropAppAccount(); process.exit(2); });
