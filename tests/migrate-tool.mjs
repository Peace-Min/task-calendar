#!/usr/bin/env node
/* =====================================================================
 *  migrate-tool.mjs — 이관 도구(xml-to-db) 검증 (설계 §8)
 * =====================================================================
 *
 *  실제 이관 전에 **도구 자체**를 시험한다. 버려질 사용자에게 진짜로 이관하고,
 *  그 결과를 앱의 읽기 계층(CalendarDb)으로 되읽어 대조한 뒤 지운다.
 *
 *  【검사하는 것】
 *    ① 실 data.xml 로 진짜 이관 → 되읽어 대조(건수·값·순서)
 *    ② 재실행 거부(cal_migration_log) — 두 번째 PC 에서 또 돌리면 지운 일정이 되살아난다
 *    ③ 기존 데이터가 있으면 거부(INSERT 전용이라 덮어쓰지 않는다)
 *    ④ 근태 규약 — status 가 유효 코드 밖이면 **행을 만들지 않는다**('1' 로 흡수 금지)
 *    ⑤ project_uid 중단 — source='db' 인데 id 가 'db-'+36자가 아니면 **멈춘다**
 *    ⑥ 중복 예외일 dedup — 1062 로 이관 전체가 롤백되지 않는다
 *    ⑦ 커밋·저장소 경로가 실제로 옮겨진다(CalendarWriteDb 는 못 하는 것)
 *
 *  【실행】
 *    $env:TC_TEST_DB_ADMIN_PW = '<root 비번>'
 *    node tests/migrate-tool.mjs
 * ===================================================================== */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'db', 'deploy', 'xml-to-db');
const OPT = {
  mysql: process.env.TC_TEST_MYSQL || 'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe',
  adminUser: process.env.TC_TEST_DB_ADMIN_USER || 'root',
  adminPw: process.env.TC_TEST_DB_ADMIN_PW || '',
  db: process.env.TC_TEST_DB_NAME || 'taskmgr',
  xml: join(process.env.APPDATA || '', 'TaskCalendar', 'data.xml'),
};
if (!OPT.adminPw) { console.error("[중단] TC_TEST_DB_ADMIN_PW 가 필요합니다."); process.exit(2); }

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

//  ★ 저장소 경로 파일은 PC 단위라 대상 사용자와 무관하게 %APPDATA% 를 덮는다.
//    시험이 사용자의 실 파일을 건드리면 안 되므로 **반드시** 임시 경로로 돌린다.
//    (2026-09-01 실측: 이 옵션이 없어서 시험이 실 repo-paths.json 을 만들었다.)
function tool(args) {
  if (!args.some(a => a.startsWith('--repo-paths-out='))) args = [...args, `--repo-paths-out=${join(WORK, 'repo-paths.json')}`];
  const r = spawnSync('dotnet', ['run', '--no-build', '-v', 'q', '--', ...args],
    { cwd: TOOL, encoding: 'utf8', env: { ...process.env, TC_MIGRATE_DB_PW: OPT.adminPw }, maxBuffer: 32 << 20 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const WORK = mkdtempSync(join(tmpdir(), 'tc-mt-'));
const LOGIN = '__migtest__';
function makeUser() {
  sql(`INSERT IGNORE INTO app_user (login_id, name, is_active) VALUES ('${LOGIN}','이관도구시험',1)`, { readOnly: false, what: '사용자' });
  return Number(one(`SELECT user_id FROM app_user WHERE login_id='${LOGIN}'`));
}
function wipe(u) {
  for (const t of ['cal_entry_commit','cal_entry_except','cal_todo_day_note','cal_task_hours','cal_attendance',
                   'cal_entry','cal_todo','cal_category','cal_room','cal_user_pref','cal_migration_log','cal_user_rev'])
    sql(`DELETE FROM ${t} WHERE user_id=${u}`, { readOnly: false, what: `정리(${t})` });
}
function dropUser(u) { wipe(u); sql(`DELETE FROM app_user WHERE user_id=${u}`, { readOnly: false, what: '사용자 삭제' }); }

/* ── 합성 XML — 실 파일이 못 덮는 경우를 만든다 ─────────────────────────── */
function synthXml({ badStatus = false, dupExcept = false, badDbId = false } = {}) {
  const cat = badDbId
    ? `<category id="db-TOOSHORT" source="db" color="#111111" createdAt="2026-01-01T00:00:00.000Z"><name>잘못된 DB 과제</name><description/></category>`
    : `<category id="cA" color="#111111" createdAt="2026-01-01T00:00:00.000Z"><name>합성 과제</name><description/></category>`;
  const exc = dupExcept
    ? `<recur freq="weekly"><except date="2026-03-02"/><except date="2026-03-02"/><except date="2026-03-09"/></recur>`
    : '';
  const att = badStatus
    ? `<attendance><day date="2026-02-01" status="" overtime="2"/><day date="2026-02-02" status="99" overtime="1"/><day date="2026-02-03" status="12" overtime="3"/></attendance>`
    : `<attendance><day date="2026-02-03" status="12" overtime="3"/></attendance>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<taskCalendar version="1" gitAuthor="합성" svnAuthor="합성" lsMigrated="1"><categories>${cat}</categories><entries><entry id="eA" date="2026-03-01" categoryId="${badDbId ? 'db-TOOSHORT' : 'cA'}" allDay="false" startTime="" endTime="" createdAt="2026-01-01T00:00:00.000Z" updatedAt="2026-01-01T00:00:00.000Z"><title>합성 일정</title><memo/>${exc}<commits><commit hash="abc123" short="abc" time="09:30" subject="합성 커밋">본문 줄1
본문 줄2</commit></commits></entry></entries><todos><todo id="tA" done="false" categoryId="${badDbId ? 'db-TOOSHORT' : 'cA'}" createdAt="2026-01-01T00:00:00.000Z" updatedAt="2026-01-01T00:00:00.000Z"><text>합성 할 일</text><dayNotes><dayNote date="2026-03-05">그날</dayNote></dayNotes></todo></todos><rooms><room>합성실</room></rooms><prefs reportMarker="•" reportIndent="4"/>${att}</taskCalendar>`;
}

/* ── main ──────────────────────────────────────────────────────────────── */
const t0 = Date.now();
console.log('═'.repeat(72));
console.log('이관 도구(xml-to-db) 검증');
console.log('═'.repeat(72));

// 도구를 한 번 빌드해 둔다(--no-build 로 돌리므로)
{
  const b = spawnSync('dotnet', ['build', '-v', 'q'], { cwd: TOOL, encoding: 'utf8' });
  if (b.status !== 0) { console.error('[중단] 도구 빌드 실패:\n' + b.stdout + b.stderr); process.exit(2); }
}

let U = null;
try {
  U = makeUser(); wipe(U);
  console.log(`\n시험 사용자 user_id=${U}\n`);

  /* ① 실 data.xml 로 진짜 이관 */
  console.log('[①] 실 data.xml 이관');
  const r1 = tool([`--login-id=${LOGIN}`, `--xml=${OPT.xml}`]);
  ok('이관 성공', r1.code === 0, r1.code !== 0 ? r1.out.split('\n').slice(-6).join(' / ') : '');
  ok('왕복 대조 통과(도구 내장)', /건수·서명 일치/.test(r1.out), (r1.out.match(/✗[^\n]*/g) || []).slice(0, 2).join(' | '));

  const xml = readFileSync(OPT.xml, 'utf8');
  const nCat = (xml.match(/<category /g) || []).length, nEnt = (xml.match(/<entry /g) || []).length;
  const nTodo = (xml.match(/<todo /g) || []).length, nCommit = (xml.match(/<commit /g) || []).length;
  ok('과제 건수', Number(one(`SELECT COUNT(*) FROM cal_category WHERE user_id=${U}`)) === nCat, `DB=${one(`SELECT COUNT(*) FROM cal_category WHERE user_id=${U}`)} XML=${nCat}`);
  ok('일정 건수', Number(one(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${U}`)) === nEnt);
  ok('할 일 건수', Number(one(`SELECT COUNT(*) FROM cal_todo WHERE user_id=${U}`)) === nTodo);
  ok('★ 커밋이 옮겨졌다(쓰기 계층은 못 하는 것)',
     Number(one(`SELECT COUNT(*) FROM cal_entry_commit WHERE user_id=${U}`)) === nCommit,
     `DB=${one(`SELECT COUNT(*) FROM cal_entry_commit WHERE user_id=${U}`)} XML=${nCommit}`);
  //  §8 — category.updated_at 은 created_at 복사다(이관 시각이 아니다). 아니면 첫 편집이 전부 충돌 오탐.
  ok('과제 updated_at = created_at (이관 시각 아님)',
     Number(one(`SELECT COUNT(*) FROM cal_category WHERE user_id=${U} AND updated_at<>created_at`)) === 0);
  ok('sort_order 가 0부터 연속(문서 순서)',
     Number(one(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${U}`)) - 1 === Number(one(`SELECT MAX(sort_order) FROM cal_entry WHERE user_id=${U}`)));
  ok('rev 가 0 으로 시딩됐다', Number(one(`SELECT rev FROM cal_user_rev WHERE user_id=${U}`)) === 0);
  ok('이관 로그가 남았다', Number(one(`SELECT COUNT(*) FROM cal_migration_log WHERE user_id=${U}`)) === 1);

  /* ② 재실행 거부 */
  console.log('\n[②] 재실행 거부');
  const r2 = tool([`--login-id=${LOGIN}`, `--xml=${OPT.xml}`]);
  ok('두 번째 실행이 거부된다', r2.code !== 0 && /이미 이관된 사용자/.test(r2.out),
     r2.out.split('\n').filter(l => l.includes('중단')).join(' '));
  ok('거부돼도 데이터가 안 늘었다', Number(one(`SELECT COUNT(*) FROM cal_entry WHERE user_id=${U}`)) === nEnt);

  /* ③ 기존 데이터가 있으면 거부 */
  console.log('\n[③] 기존 데이터가 있으면 거부');
  sql(`DELETE FROM cal_migration_log WHERE user_id=${U}`, { readOnly: false, what: '로그만 제거' });
  const r3 = tool([`--login-id=${LOGIN}`, `--xml=${OPT.xml}`]);
  ok('데이터가 남아 있으면 거부한다(INSERT 전용)', r3.code !== 0 && /이미 캘린더 데이터가/.test(r3.out));

  /* ④⑥⑦ 합성 XML — 근태 규약 · dedup · 경로 */
  console.log('\n[④] 근태 규약 — 무효 status 는 행을 만들지 않는다');
  wipe(U);
  const xBad = join(WORK, 'bad-status.xml'); writeFileSync(xBad, synthXml({ badStatus: true }), 'utf8');
  const r4 = tool([`--login-id=${LOGIN}`, `--xml=${xBad}`]);
  ok('이관 성공', r4.code === 0 || /경고/.test(r4.out), r4.out.split('\n').slice(-4).join(' / '));
  const att = sql(`SELECT work_date, status FROM cal_attendance WHERE user_id=${U} ORDER BY work_date`);
  ok('유효 코드 1건만 행이 생겼다(빈 값·99 는 행 없음)', att.length === 1 && att[0][1] === '12',
     att.map(a => a.join('=')).join(', ') || '(행 없음)');
  ok("'1'(정근)으로 흡수하지 않았다", Number(one(`SELECT COUNT(*) FROM cal_attendance WHERE user_id=${U} AND status='1'`)) === 0);
  //  ★ '근태 N일' 은 [1] 의 입력 건수 줄에도 나온다 — 보고 줄만 잡으려면 ⚠ 접두로 고정한다.
  ok('버린 건수를 보고했다', /⚠ 근태 2일/.test(r4.out),
     (r4.out.match(/⚠ 근태 \d+일[^\n]*/) || ['(보고 없음)'])[0]);

  console.log('\n[⑥] 중복 예외일 dedup — 1062 로 전체 롤백되지 않는다');
  wipe(U);
  const xDup = join(WORK, 'dup-except.xml'); writeFileSync(xDup, synthXml({ dupExcept: true }), 'utf8');
  const r6 = tool([`--login-id=${LOGIN}`, `--xml=${xDup}`]);
  ok('이관이 롤백되지 않았다', r6.code === 0 || /경고/.test(r6.out));
  ok('예외일 2건(중복 제거)', Number(one(`SELECT COUNT(*) FROM cal_entry_except WHERE user_id=${U}`)) === 2,
     `DB=${one(`SELECT COUNT(*) FROM cal_entry_except WHERE user_id=${U}`)}`);
  ok('제거 건수를 보고했다', /중복 예외일 1건/.test(r6.out));
  ok('커밋 본문(줄바꿈 포함)이 옮겨졌다',
     (one(`SELECT body FROM cal_entry_commit WHERE user_id=${U} LIMIT 1`) || '').includes('본문 줄1'),
     one(`SELECT REPLACE(body,'\n','⏎') FROM cal_entry_commit WHERE user_id=${U} LIMIT 1`) || '(없음)');
  //  §8 — 종류별 속성이 없으면 전역으로 메운다. '-'/'2' 로 채우면 사용자 서식이 조용히 바뀐다.
  const pf = sql(`SELECT report_marker, report_marker_daily, report_indent_daily FROM cal_user_pref WHERE user_id=${U}`)[0] || [];
  ok('서식 폴백: 종류별 속성이 없으면 전역값을 쓴다', pf[0] === '•' && pf[1] === '•' && Number(pf[2]) === 4,
     `전역=${pf[0]} daily=${pf[1]}/${pf[2]}`);

  /* ⑤ project_uid 중단 */
  console.log('\n[⑤] project_uid — 고칠 수 없는 것은 멈춘다');
  wipe(U);
  const xBadDb = join(WORK, 'bad-dbid.xml'); writeFileSync(xBadDb, synthXml({ badDbId: true }), 'utf8');
  const r5 = tool([`--login-id=${LOGIN}`, `--xml=${xBadDb}`]);
  ok("source='db' 인데 id 가 규격 밖이면 중단한다", r5.code !== 0 && /db-'\+36자가 아니다|36자가 아니다/.test(r5.out),
     (r5.out.match(/\[중단\][^\n]*/) || [''])[0]);
  ok('중단했으면 아무것도 안 들어갔다', Number(one(`SELECT COUNT(*) FROM cal_category WHERE user_id=${U}`)) === 0);

  /* ⑦b 저장소 경로 파일 — **앱이 읽을 수 있는 모양**이어야 한다 */
  //  ★ 2026-09-01 실측: 도구가 맵을 최상위에 썼고 앱(RepoPaths.Load)은 "paths" 아래를 요구했다.
  //    앱은 그 파일을 '손상' 으로 보고 **빈 맵으로 시작**한 뒤 원본을 .bak 로 밀어냈다 —
  //    이관 직후부터 저장소 경로가 통째로 사라지는데 아무도 모른다(uses_repo=true 인 과제가
  //    영원히 '이 PC 에는 저장소 경로가 설정되지 않았습니다' 를 띄운다).
  console.log('\n[⑦b] 저장소 경로 파일 모양');
  {
    const rp = join(WORK, 'repo-paths.json');
    if (!existsSync(rp)) {
      ok('저장소 경로 파일이 생성됐다', false, '파일 없음 — 픽스처에 gitRepo/svnRepo 가 있는지 확인');
    } else {
      const j = JSON.parse(readFileSync(rp, 'utf8'));
      ok('최상위에 version 이 있다', j.version === 1, JSON.stringify(Object.keys(j)));
      ok('경로 맵이 paths 아래에 있다',
         !!j.paths && typeof j.paths === 'object' && !Array.isArray(j.paths),
         '최상위에 맵을 쓰면 앱이 손상으로 보고 빈 맵으로 시작한다');
      const keys = Object.keys(j.paths || {});
      ok('키가 과제 uid 다(번호가 아니다)',
         keys.length > 0 && keys.every((k) => /^(c-|db-)/.test(k)),
         keys.join(','));
    }
  }

  /* ⑦ 없는 사용자 거부 */
  console.log('\n[⑦] 없는 사용자');
  const r7 = tool([`--login-id=__없는사람__`, `--xml=${OPT.xml}`]);
  ok('app_user 에 없으면 거부한다', r7.code !== 0 && /app_user 에/.test(r7.out));

} catch (e) {
  console.log('\n[중단] ' + e.message); fail++;
} finally {
  try { if (U) dropUser(U); } catch (e) { console.log('  ! 정리 실패: ' + e.message); }
  try { rmSync(WORK, { recursive: true, force: true }); } catch {}
}

console.log('\n' + '═'.repeat(72));
console.log(`통과 ${pass} · 실패 ${fail} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
if (F.length) { console.log('\n실패 목록:'); F.forEach(f => console.log('  · ' + f)); }
console.log(fail === 0 ? '이관 도구 검증 통과 ✓' : '★ 실패 — 실제 이관 전에 고칠 것.');
console.log('═'.repeat(72));
process.exit(fail === 0 ? 0 : 1);
