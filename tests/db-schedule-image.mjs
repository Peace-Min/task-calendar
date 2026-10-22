#!/usr/bin/env node
/* =====================================================================
 *  db-schedule-image.mjs: 월간보고 개발 일정 그림 DB 계약 시험(docs/MONTHLY-REPORT-PLAN.md §6, §10.2)
 * =====================================================================
 *
 *  ★ 이 파일은 `node tests/run-tests.mjs` 의 기본 스위트에 **포함되지 않는다**(loop-*.mjs, db-project-calendar.mjs 와 같은 실 DB 시험).
 *    이름이 *.test.mjs 가 아니라 러너가 수집하지 않는다. 그래서 strict 게이트에 skip 을 만들지 않는다.
 *
 *  【무엇을 증명하나】 위젯이 쓰는 호스트 클래스(widget/ScheduleImageDb.cs, ProjectDb.cs 등)를 소스째 링크한 작은 C# 러너
 *    (net9.0-windows, WPF 이미징 포함)로, 세 사람의 세션을 번갈아 써서 실제 MySQL 에 친다.
 *      - 추가: PNG, JPEG 를 받고 seq 1, 2 … 를 매기며 등록자(세션의 사람)와 시각을 남긴다. 같은 그림, 그림이 아닌 바이트,
 *        5MB 넘는 바이트, 과제당 6장째는 invalid 이고 아무것도 쓰지 않는다. 비활성 사용자는 forbidden.
 *      - 목록: 메타만(바이트 없음), seq 순서. 받기(get): DB 바이트의 해시가 메타와 같고, 두 번째부터는 PC 사본에서 읽는다.
 *      - 미리 보기: JPEG, 40KB 이하. 순서 바꾸기: 자리가 바뀌고 seq 가 1..n 그대로. 삭제: 올린 사람이 아니어도 된다(관리자 검사 없음),
 *        남은 그림은 1..n 으로 다시 매긴다.
 *      - 그림을 올린 사람은 휴지통에서 지울 수 없다(기록 표, FK RESTRICT). 과제를 휴지통에서 지우면 그림도 지워진다(CASCADE).
 *      - DB 를 못 쓰면(일부러 틀린 비밀번호): DOCX 그림은 PC 사본으로, 목록은 사본 색인(stale)으로, 추가와 삭제는 막힌다.
 *      - mysqldump --hex-blob 으로 그림 행을 떠서 지우고 다시 부으면 바이트(SHA-256, 길이)가 같다.
 *
 *  【어디에 치나】 공용 개발 DB(taskcalendar)가 아니라 **복사본**(기본 zz_si_dev, 이름이 zz_ 로 시작해야 한다)이다.
 *    구조 번호가 정확히 같아야 동작하는 관문 때문에 공용 DB 를 17 로 올리면 다른 세션의 위젯이 막힌다.
 *    복사본 만들기(이 스크립트는 하지 않는다, 비밀번호는 표준입력이나 환경 변수로만):
 *      mysqldump --single-transaction --routines --triggers --hex-blob --set-gtid-purged=OFF --no-tablespaces taskcalendar > dump.sql
 *      CREATE DATABASE zz_si_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; 그 DB 에 dump.sql
 *      installer/release-sql.ps1 로 만든 release SQL 을 그 DB 에 돌려 구조 17 로
 *
 *  【계정】 앱 계정(taskmgr_app)의 권한은 건드리지 않는다. 일회용 계정(zz_si_app_<pid>)을 만들어
 *    db/deploy/server-app-account.sql 의 권한(DB 이름만 바꿔서)을 그대로 주고, 끝나면(실패해도) 지운다.
 *
 *  【실행】
 *    TC_TEST_DB_ADMIN_PW=<root 비번>(환경 변수로만) node tests/db-schedule-image.mjs [--db=zz_si_dev]
 *    종료코드: 0 통과, 1 실패, 2 판정 불가(전제가 안 섰다. 초록이 아니다)
 *  시험 데이터 이름은 모두 zz_si 로 시작한다(app_user.login_id, project.project_name). 그림은 이 스크립트가 만든 무늬와
 *  저장소의 지어낸 시료(tests/fixtures/monthly-docx/gantt-b.jpg)다.
 * ===================================================================== */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARG = new Map(process.argv.slice(2).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const OPT = {
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',
  db: String(ARG.get('db') || process.env.TC_TEST_DB_NAME || 'zz_si_dev'),
};
OPT.mysqldump = process.env.TC_TEST_MYSQLDUMP || OPT.mysql.replace(/mysql\.exe$/i, 'mysqldump.exe');
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
const sha = (b) => createHash('sha256').update(b).digest('hex');

let pass = 0, fail = 0; const F = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; F.push(n); console.log(`  ✗ ${n}${d ? ' : ' + d : ''}`); } };

// ── 시험 그림: 의존성 없이 PNG 를 만든다(무늬가 seed 마다 달라 해시가 다르다) ─────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, seed) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 7 + seed * 31) & 0xff; raw[o + 1] = (y * 5 + seed * 17) & 0xff; raw[o + 2] = ((x ^ y) + seed * 3) & 0xff;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const JPG = readFileSync(join(ROOT, 'tests', 'fixtures', 'monthly-docx', 'gantt-b.jpg'));

// ── 러너(위젯 소스를 그대로 링크, WPF 이미징 때문에 net9.0-windows) ─────────────────
const RUNNER_CS = String.raw`using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
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
        var db = new ScheduleImageDb(dir, log);
        switch (op)
        {
            case "login":
            {
                Directory.CreateDirectory(dir);
                var (ok, msg) = UserSession.Save(dir, s.GetProperty("loginId").GetString() ?? "", "zz", "", "", log);
                return new { ok, msg };
            }
            case "cmd":
                return (await db.HandleAsync(s.GetProperty("cmd").GetString() ?? "", s.GetProperty("payload").GetRawText())).ToPayload();
            case "add":
                return (await db.AddAsync(s.GetProperty("projectUid").GetString() ?? "", Convert.FromBase64String(s.GetProperty("b64").GetString() ?? ""))).ToPayload();
            case "probe":
                return (await db.ProbeAddAsync(s.GetProperty("projectUid").GetString() ?? "")).ToPayload();
            case "get":
            {
                try
                {
                    var g = await db.GetAsync(s.GetProperty("id").GetInt64());
                    return new { ok = true, sha = g.meta.Sha256, hash = ScheduleImageDb.Sha256Hex(g.bytes), len = g.bytes.Length, fromCache = g.fromCache };
                }
                catch (Exception ex) { return new { ok = false, err = ex.GetType().Name + ": " + ex.Message }; }
            }
            case "export":
            {
                var uids = s.GetProperty("uids").EnumerateArray().Select(x => x.GetString() ?? "").ToList();
                var r = await db.ImagesForExportAsync(uids);
                var shas = r.ByProject.ToDictionary(kv => kv.Key, kv => kv.Value.Select(ScheduleImageDb.Sha256Hex).ToList());
                return new { source = r.Source, count = r.Count, note = r.Note, shas };
            }
            case "trashDelete":
            {
                var (ok, msg) = await new ProjectDb(dir, log).DeleteTrashAsync(s.GetProperty("kind").GetString(), s.GetProperty("key").GetString(), s.GetProperty("confirm").GetString());
                return new { ok, msg };
            }
            case "cacheFiles":
            {
                string cd = Path.Combine(dir, "schedule-images");
                return Directory.Exists(cd) ? Directory.GetFiles(cd).Select(Path.GetFileName).ToArray() : Array.Empty<string>();
            }
        }
        return new { ok = false, msg = "unknown op " + op };
    }

    static async Task<int> Main()
    {
        string raw;
        using (var sr = new StreamReader(Console.OpenStandardInput(), new System.Text.UTF8Encoding(false))) raw = sr.ReadToEnd();
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
        public static readonly string DbName = Env("TC_SI_DB");
        public static readonly string DbUser = Env("TC_SI_USER");
        public static readonly string DbPassword = Env("TC_SI_PW");
        public const string UpdateSourceUrl = "";
        public const bool XmlRetired = true;
    }
}
`;

const WIDGET = ['ScheduleImageDb.cs', 'ProjectCalendarDb.cs', 'CalendarWriteDb.cs', 'CalendarDb.cs', 'ProjectDb.cs', 'RepoPaths.cs', 'UserSession.cs', 'DbErrors.cs', 'DbFault.cs', 'DbGate.cs'];
const PROJ = (root) => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net9.0-windows</TargetFramework><UseWPF>true</UseWPF>
    <Nullable>enable</Nullable><LangVersion>latest</LangVersion><ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>sir</AssemblyName><RootNamespace>SIR</RootNamespace>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems><EnableDefaultPageItems>false</EnableDefaultPageItems><NoWarn>CS0649</NoWarn>
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
  WORK = mkdtempSync(join(tmpdir(), 'tc-si-'));
  writeFileSync(join(WORK, 'R.cs'), RUNNER_CS, 'utf8');
  writeFileSync(join(WORK, 'DeployConfig.cs'), DEPLOY_CS, 'utf8');
  writeFileSync(join(WORK, 'sir.csproj'), PROJ(ROOT.replace(/\\/g, '/')), 'utf8');
  const b = spawnSync('dotnet', ['build', '-v', 'q', '--nologo', '-o', join(WORK, 'out')], { cwd: WORK, encoding: 'utf8' });
  if (b.status !== 0) { console.error('[중단] 러너 빌드 실패:\n' + (b.stdout || '') + (b.stderr || '')); process.exit(2); }
}
function run(steps, { badPw = false } = {}) {
  const r = spawnSync(join(WORK, 'out', 'sir.exe'), [], {
    input: JSON.stringify(steps), encoding: 'utf8', maxBuffer: 256 << 20,
    env: { ...process.env, TC_SI_DB: OPT.db, TC_SI_USER: APP_USER, TC_SI_PW: badPw ? APP_PW + 'x' : APP_PW, TC_TEST_DB_ADMIN_PW: '' },
  });
  if (r.status !== 0) throw new Error('러너 실행 실패: ' + (r.stderr || r.stdout));
  const out = JSON.parse(r.stdout);
  out.results.logs = out.logs;
  return out.results;
}
const DIRS = {};
const step = (who, s, o) => run([{ ...s, dataDir: DIRS[who] }], o)[0];
const cmd = (who, c, payload, o) => step(who, { op: 'cmd', cmd: c, payload }, o);
const add = (who, projectUid, bytes, o) => step(who, { op: 'add', projectUid, b64: Buffer.from(bytes).toString('base64') }, o);

// ── 일회용 계정: server-app-account.sql 의 권한을 DB 이름만 바꿔 준다 ───────────
function makeAppAccount() {
  APP_USER = 'zz_si_app_' + process.pid;
  const src = readFileSync(join(ROOT, 'db', 'deploy', 'server-app-account.sql'), 'utf8');
  const grants = [...src.matchAll(/^GRANT ([A-Z, ]+) ON `taskcalendar`\.`(\w+)` TO 'taskmgr_app'@'%';$/gm)]
    .map((m) => `GRANT ${m[1]} ON \`${OPT.db}\`.\`${m[2]}\` TO '${APP_USER}'@'%'`);
  if (grants.length < 20 || !grants.some((g) => g.includes('project_schedule_image'))) throw new Error('server-app-account.sql 에서 권한 줄(그림 표 포함)을 읽지 못했다');
  sql(`CREATE USER '${APP_USER}'@'%' IDENTIFIED BY '${esc(APP_PW)}';\n${grants.join(';\n')}`, '일회용 계정 만들기');
}
function dropAppAccount() {
  if (!APP_USER) return;
  try { sql(`DROP USER IF EXISTS '${APP_USER}'@'%'`, '일회용 계정 지우기'); } catch (e) { console.error('일회용 계정을 지우지 못했다: ' + e.message); }
}

// ── 시험 데이터(이름은 zz_si) ────────────────────────────────────────────
const D = {};
function seed() {
  const tag = String(Date.now()).slice(-6);
  const users = { u1: ['zz_si_u1_' + tag, 'zz그림일', 'viewer', 1], u2: ['zz_si_u2_' + tag, 'zz그림이', 'viewer', 1],
    admin: ['zz_si_ad_' + tag, 'zz그림관리', 'admin', 1], out: ['zz_si_out_' + tag, 'zz그림퇴사', 'viewer', 0] };
  for (const [k, [login, name, role, act]] of Object.entries(users)) {
    sql(`INSERT INTO app_user (login_id, name, edit_role, is_active) VALUES ('${login}', '${esc(name)}', '${role}', ${act})`, '사용자');
    const id = num(`SELECT user_id FROM app_user WHERE login_id='${login}'`);
    sql(`INSERT IGNORE INTO cal_user_rev (user_id, rev) VALUES (${id}, 0)`, 'rev 시딩');
    D[k] = { login, name, id };
  }
  const sec = num('SELECT MIN(section_id) FROM section_code'), cus = num('SELECT MIN(customer_id) FROM customer');
  for (const k of ['p1', 'p2']) {
    const name = `zz_si ${k} ${tag}`;
    sql(`INSERT INTO project (section_id, customer_id, project_name) VALUES (${sec}, ${cus}, '${esc(name)}')`, '과제');
    const [id, uid] = sql(`SELECT id, uid FROM project WHERE project_name='${esc(name)}'`)[0];
    D[k] = { id: Number(id), uid, name };
  }
}
const seqs = (pid) => sql(`SELECT id, seq FROM project_schedule_image WHERE project_id=${pid} ORDER BY seq`).map(([i, s]) => [Number(i), Number(s)]);
const count = (pid) => num(`SELECT COUNT(*) FROM project_schedule_image WHERE project_id=${pid}`);

async function main() {
  //  전제: 시험 DB 가 있고 구조 17, 그림 표, 개발 시작일 칸
  let v;
  try { v = one("SELECT v FROM cal_schema_meta WHERE k='db_structure_version'"); } catch (e) { console.error('[중단] 시험 DB 에 붙지 못했다: ' + e.message); process.exit(2); }
  const nt = num(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${OPT.db}' AND TABLE_NAME='project_schedule_image'`);
  const nc = num(`SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${OPT.db}' AND TABLE_NAME='project' AND COLUMN_NAME='dev_start_date'`);
  const upd = one("SELECT v FROM cal_schema_meta WHERE k='db_updating'");
  if (v !== '17' || nt !== 1 || nc !== 1 || upd !== '0') { console.error(`[중단] ${OPT.db} 가 구조 17(그림 표, 개발 시작일, 열림)이 아니다: v=${v} 표=${nt} 칸=${nc} db_updating=${upd}`); process.exit(2); }
  if (!existsSync(OPT.mysqldump)) { console.error(`[중단] mysqldump 가 없다: ${OPT.mysqldump}`); process.exit(2); }
  console.log(`DB ${OPT.db}: 구조 ${v}`);

  buildRunner();
  makeAppAccount();
  try {
    seed();
    for (const k of ['u1', 'u2', 'admin', 'out']) {
      DIRS[k] = join(WORK, 'data-' + k); mkdirSync(DIRS[k], { recursive: true });
      const r = run([{ op: 'login', dataDir: DIRS[k], loginId: D[k].login }])[0];
      if (!r.ok) throw new Error('세션 저장 실패: ' + r.msg);
    }
    const P = [png(64, 32, 1), png(48, 48, 2), png(40, 20, 3), png(30, 60, 4), png(20, 20, 5), png(22, 22, 6)];

    console.log('\n[추가와 목록]');
    let r = add('u1', D.p1.uid, P[0]);
    const id1 = r.ok ? r.data.image.id : 0;
    ok('PNG 추가: seq 1, 등록자는 세션의 사람, 가로세로와 해시', r.ok && r.data.image.seq === 1 && r.data.image.uploadedBy === D.u1.name &&
      r.data.image.width === 64 && r.data.image.height === 32 && r.data.image.sha256 === sha(P[0]), JSON.stringify(r).slice(0, 300));
    ok('DB 행: uploaded_by = u1, mime image/png, 바이트 해시 = sha256 칸', num(`SELECT uploaded_by FROM project_schedule_image WHERE id=${id1}`) === D.u1.id &&
      one(`SELECT mime FROM project_schedule_image WHERE id=${id1}`) === 'image/png' &&
      one(`SELECT SHA2(bytes, 256) = sha256 FROM project_schedule_image WHERE id=${id1}`) === '1');
    r = add('u2', D.p1.uid, JPG);
    const id2 = r.ok ? r.data.image.id : 0;
    ok('JPEG 추가(다른 사람): seq 2, mime image/jpeg', r.ok && r.data.image.seq === 2 && r.data.image.mime === 'image/jpeg' && r.data.image.uploadedBy === D.u2.name, JSON.stringify(r).slice(0, 300));
    r = cmd('u2', 'scheduleImageList', { projectUid: 'db-' + D.p1.uid });
    ok('목록: 메타만(바이트 없음), seq 순서, db- 머리 붙은 id 도 받는다', r.ok && r.data.images.length === 2 && r.data.images[0].id === id1 && r.data.images[1].id === id2 &&
      !('b64' in r.data.images[0]) && r.data.images[0].bytes === P[0].length && r.data.stale === false, JSON.stringify(r).slice(0, 300));
    const before = count(D.p1.id);
    r = add('u2', D.p1.uid, P[0]);
    ok('같은 그림 다시 추가: invalid, 쓰지 않음', !r.ok && r.error.kind === 'invalid' && count(D.p1.id) === before, JSON.stringify(r));
    r = add('u1', D.p1.uid, Buffer.from('zz 그림이 아닌 글자'));
    ok('그림이 아닌 바이트: invalid(PNG 또는 JPEG), 쓰지 않음', !r.ok && r.error.kind === 'invalid' && /PNG 또는 JPEG/.test(r.error.message) && count(D.p1.id) === before, JSON.stringify(r));
    const big = Buffer.concat([P[1].subarray(0, 8), Buffer.alloc(5 * 1024 * 1024 + 1 - 8)]);
    r = add('u1', D.p1.uid, big);
    ok('5MB 넘는 바이트: invalid(5MB), 쓰지 않음', !r.ok && r.error.kind === 'invalid' && /5MB/.test(r.error.message) && count(D.p1.id) === before, JSON.stringify(r));
    r = add('out', D.p1.uid, P[1]);
    ok('비활성 사용자의 추가: forbidden, 쓰지 않음', !r.ok && r.error.kind === 'forbidden' && count(D.p1.id) === before, JSON.stringify(r));
    for (const b of [P[1], P[2], P[3]]) add('u1', D.p1.uid, b);
    ok('다섯 장까지 들어간다(seq 1..5)', JSON.stringify(seqs(D.p1.id).map((x) => x[1])) === '[1,2,3,4,5]', JSON.stringify(seqs(D.p1.id)));
    r = add('u2', D.p1.uid, P[4]);
    ok('여섯 장째: invalid(5장까지), 쓰지 않음', !r.ok && r.error.kind === 'invalid' && /5장/.test(r.error.message) && count(D.p1.id) === 5, JSON.stringify(r));
    r = step('u2', { op: 'probe', projectUid: D.p1.uid });
    ok('미리 보기(파일 창 전 확인)도 다섯 장이면 막는다', !r.ok && r.error.kind === 'invalid', JSON.stringify(r));

    console.log('\n[받기, 미리 보기, 순서, 삭제]');
    r = step('u2', { op: 'get', id: id1 });
    ok('받기(사본 없는 사람): DB 바이트의 해시가 메타와 원본과 같다', r.ok && !r.fromCache && r.hash === r.sha && r.sha === sha(P[0]) && r.len === P[0].length, JSON.stringify(r));
    r = step('u2', { op: 'get', id: id1 });
    ok('다시 받기: PC 사본에서 읽는다(해시가 같으면 DB 바이트를 받지 않는다)', r.ok && r.fromCache && r.hash === sha(P[0]), JSON.stringify(r));
    const files = step('u2', { op: 'cacheFiles' });
    ok('PC 사본 이름은 <sha256>.png 와 색인', files.includes(sha(P[0]) + '.png') && files.includes('index.json'), JSON.stringify(files));
    r = cmd('u1', 'scheduleImageThumb', { id: id2 });
    const tb = r.ok ? Buffer.from(r.data.dataUrl.replace(/^data:image\/jpeg;base64,/, ''), 'base64') : Buffer.alloc(0);
    ok('미리 보기: JPEG data URL, 40KB 이하', r.ok && tb[0] === 0xff && tb[1] === 0xd8 && tb.length <= 40 * 1024 && r.data.width > 0, JSON.stringify(r).slice(0, 200));
    r = cmd('u1', 'scheduleImageMove', { id: id1, seq: 3 });
    const afterMove = seqs(D.p1.id);
    ok('순서 바꾸기: 1번이 3번 자리로, seq 는 1..5 그대로', r.ok && afterMove[2][0] === id1 && afterMove[0][0] === id2 && JSON.stringify(afterMove.map((x) => x[1])) === '[1,2,3,4,5]', JSON.stringify(afterMove));
    r = cmd('u2', 'scheduleImageDelete', { id: id1 });
    const afterDel = seqs(D.p1.id);
    ok('삭제(올린 사람이 아니어도, 관리자 아님): 실제 행 삭제, 남은 그림 1..4', r.ok && num(`SELECT COUNT(*) FROM project_schedule_image WHERE id=${id1}`) === 0 &&
      JSON.stringify(afterDel.map((x) => x[1])) === '[1,2,3,4]', JSON.stringify(r).slice(0, 200));
    r = cmd('u2', 'scheduleImageDelete', { id: id1 });
    ok('지운 그림을 또 지우기: notFound', !r.ok && r.error.kind === 'notFound', JSON.stringify(r));

    console.log('\n[사람과 과제 삭제]');
    sql(`UPDATE app_user SET is_active=0 WHERE user_id=${D.u2.id}`, 'u2 퇴사');
    r = step('admin', { op: 'trashDelete', kind: 'user', key: String(D.u2.id), confirm: D.u2.name });
    ok('그림을 올린 사람은 휴지통에서 지울 수 없다(기록 표, 고정 문구)', !r.ok && /기록 \d+건이 있어 지울 수 없습니다/.test(r.msg) && num(`SELECT COUNT(*) FROM app_user WHERE user_id=${D.u2.id}`) === 1, JSON.stringify(r));
    let fk = '';
    try { sql(`DELETE FROM app_user WHERE user_id=${D.u2.id}`, '등록자 직접 삭제'); } catch (e) { fk = e.message; }
    ok('DB 도 막는다(등록자 FK RESTRICT, 1451)', /1451/.test(fk), fk);
    sql(`UPDATE app_user SET is_active=1 WHERE user_id=${D.u2.id}`, 'u2 복직');

    console.log('\n[DOCX 그림, DB 를 못 쓸 때]');
    add('u1', D.p2.uid, P[5]);
    r = step('u1', { op: 'export', uids: [D.p1.uid, D.p2.uid] });
    const want1 = sql(`SELECT sha256 FROM project_schedule_image WHERE project_id=${D.p1.id} ORDER BY seq`).map((x) => x[0]);
    ok('DOCX 그림(DB): 과제마다 seq 순서의 바이트, 출처 db', r.source === 'db' && r.count === 5 && JSON.stringify(r.shas[D.p1.uid]) === JSON.stringify(want1) && r.shas[D.p2.uid][0] === sha(P[5]), JSON.stringify(r).slice(0, 300));
    r = step('u1', { op: 'export', uids: [D.p1.uid, D.p2.uid] }, { badPw: true });
    ok('DOCX 그림(DB 실패): PC 사본으로 같은 바이트, 출처 cache, 안내 문구', r.source === 'cache' && r.count === 5 && JSON.stringify(r.shas[D.p1.uid]) === JSON.stringify(want1) && /PC 에 받아 둔/.test(r.note), JSON.stringify(r).slice(0, 300));
    r = cmd('u1', 'scheduleImageList', { projectUid: D.p1.uid }, { badPw: true });
    ok('목록(DB 실패): 실패 회신에 사본 색인의 마지막 목록(stale)', !r.ok && r.data && r.data.stale === true && r.data.images.length === 4, JSON.stringify(r).slice(0, 300));
    const n2 = count(D.p2.id);
    r = add('u1', D.p2.uid, P[4], { badPw: true });
    ok('추가(DB 실패): 막힌다(연결 분류 kind), 쓰지 않음', !r.ok && ['auth', 'network', 'unknown'].includes(r.error.kind) && count(D.p2.id) === n2, JSON.stringify(r));
    const pid2img = Number(one(`SELECT id FROM project_schedule_image WHERE project_id=${D.p2.id} LIMIT 1`));
    r = cmd('u1', 'scheduleImageDelete', { id: pid2img }, { badPw: true });
    ok('삭제(DB 실패): 막힌다, 행 그대로', !r.ok && count(D.p2.id) === n2, JSON.stringify(r));

    console.log('\n[mysqldump --hex-blob 되살리기]');
    const before2 = sql(`SELECT id, seq, SHA2(bytes, 256), LENGTH(bytes), sha256 FROM project_schedule_image WHERE project_id=${D.p1.id} ORDER BY id`);
    const dumpPath = join(WORK, 'si-dump.sql');
    const d = spawnSync(OPT.mysqldump, ['-u' + OPT.adminUser, '--default-character-set=utf8mb4', '--single-transaction', '--no-tablespaces', '--hex-blob',
      '--no-create-info', '--skip-triggers', `--where=project_id=${D.p1.id}`, `--result-file=${dumpPath}`, OPT.db, 'project_schedule_image'],
      { env: { ...process.env, MYSQL_PWD: OPT.adminPw }, encoding: 'utf8' });
    const dumpText = existsSync(dumpPath) ? readFileSync(dumpPath, 'utf8') : '';
    ok('덤프가 끝났고 바이트가 16진 리터럴(0x89504E47…)로 들어 있다', d.status === 0 && /-- Dump completed/.test(dumpText) && /0x89504E470D0A1A0A/i.test(dumpText), (d.stderr || '').slice(0, 200));
    sql(`DELETE FROM project_schedule_image WHERE project_id=${D.p1.id}`, '그림 행 지우기');
    const imp = spawnSync(OPT.mysql, ['-u' + OPT.adminUser, '--default-character-set=utf8mb4', '-D', OPT.db],
      { input: readFileSync(dumpPath), env: { ...process.env, MYSQL_PWD: OPT.adminPw }, encoding: 'utf8' });
    const after2 = sql(`SELECT id, seq, SHA2(bytes, 256), LENGTH(bytes), sha256 FROM project_schedule_image WHERE project_id=${D.p1.id} ORDER BY id`);
    ok('되살린 행의 바이트(SHA-256, 길이)와 번호, 순서가 덤프 전과 같다', imp.status === 0 && after2.length === 4 && JSON.stringify(after2) === JSON.stringify(before2) &&
      after2.every((x) => x[2] === x[4]), (imp.stderr || '').slice(0, 200));

    console.log('\n[과제 삭제는 그림까지]');
    sql(`UPDATE project SET is_active=0 WHERE id=${D.p1.id}`, 'p1 숨김');
    r = step('admin', { op: 'trashDelete', kind: 'project', key: D.p1.uid, confirm: D.p1.name });
    ok('과제를 휴지통에서 지우면 그림도 지워진다(CASCADE, 앱 계정 권한 그대로)', r.ok && num(`SELECT COUNT(*) FROM project WHERE id=${D.p1.id}`) === 0 && count(D.p1.id) === 0, JSON.stringify(r));
    r = cmd('u1', 'scheduleImageList', { projectUid: D.p1.uid });
    ok('지워진 과제의 목록: notFound', !r.ok && r.error.kind === 'notFound', JSON.stringify(r));
  } finally {
    //  시험 데이터 정리(그림, 과제, 사람). 실패해도 일회용 계정은 지운다.
    try {
      for (const k of ['p1', 'p2']) if (D[k]) sql(`DELETE FROM project WHERE id=${D[k].id}`, '과제 정리');
      for (const k of ['u1', 'u2', 'admin', 'out']) if (D[k]) sql(`DELETE FROM cal_user_rev WHERE user_id=${D[k].id}; DELETE FROM cal_user_pref WHERE user_id=${D[k].id}; DELETE FROM app_user WHERE user_id=${D[k].id}`, '사람 정리');
    } catch (e) { console.error('시험 데이터를 다 지우지 못했다(zz_si 이름으로 남음): ' + e.message); }
    dropAppAccount();
    try { rmSync(WORK, { recursive: true, force: true }); } catch (_) { }
  }

  console.log(`\n${pass} pass / ${fail} fail`);
  if (fail) { console.log('실패: ' + F.join(' | ')); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error('[판정 불가] ' + (e && e.stack || e)); dropAppAccount(); process.exit(2); });
