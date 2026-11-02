#!/usr/bin/env node
// demo-load.sql 생성기(이슈 #13 사용 설명 영상용 데모 DB). 정의는 demo-data.mjs, 실행과 백업, 되돌리기는 demo-db.ps1.
//
// 쓰는 법
//   node db/demo/build-demo-sql.mjs --my-login <녹화 계정 login_id> [--base-date YYYY-MM-DD] [--out <파일>]
//   --base-date 를 빼면 오늘(이 PC 의 날짜). 일정은 기준 날짜의 지난달 1일부터 이번 달 말일까지 만든다.
//   --out 을 빼면 표준 출력으로 낸다.
//
// 약속
//   - 결정적이다. 같은 --my-login 과 --base-date 면 바이트까지 같은 SQL 이 나온다(시각, 난수 원천을 쓰지 않는다.
//     created_at 과 updated_at 은 SQL 안의 UTC_TIMESTAMP(3) 로 넣는다).
//   - 녹화 계정의 user_id 는 SQL 안에서 login_id 로 찾는다. login_id 는 16진 리터럴로만 들어간다(따옴표 이스케이프에 기대지 않는다).
//   - 녹화 계정은 이름도 login_id 도 바꾸지 않는다. 바꾸기 전 값을 SQL 안에서 잡아 두고 COMMIT 앞에서 그대로인지 본다.
//     생성기는 녹화 계정의 이름을 모르므로, 가상 이름이 그 이름과 같은지는 SQL 안에서(트랜잭션 전) 본다.
//   - 가드가 하나라도 틀리면 '없는 표 이름' 을 SELECT 해 ERROR 1146 으로 멈춘다(db/deploy/migrate-2026-10-15-code-ids.sql 과 같은 수법).
//     mysql 은 --force 없이 첫 오류에서 끝나고, 열린 트랜잭션은 연결이 끊기며 되돌려진다.
//   - 바꾸는 것은 DML 뿐이고 트랜잭션 하나다(임시 표 말고는 DDL 이 없다). 계정과 권한(GRANT, CREATE USER)은 건드리지 않는다.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import * as D from './demo-data.mjs';

export const SCHEMA_VERSION = '20';   // cal_schema_meta.db_structure_version(2026-10-21 부터, 옛 키 schema_version)
export const LOGIN_RE = /^[A-Za-z0-9._@-]{1,50}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 지우고 다시 채우는 cal_* 표(자식 먼저). cal_user_rev 는 지우지 않고 올린다(DELETE 금지 표). cal_schema_meta 는 그대로.
// 과제 캘린더 두 표(2026-10-22, 구조 16)가 맨 앞이다. 공용 일정이 project 를 RESTRICT 로 붙들어 아래 DELETE FROM project 가
//   막히지 않게 먼저 지운다. 데모는 공용 일정을 채우지 않는다.
// 월간보고 개발 일정 그림(project_schedule_image, 구조 17)도 맨 앞이다. 과제를 지우면 CASCADE 로 함께 지워지지만 데모가 빌려 쓰는
//   실제 사용자(app_user)를 주인(user_id)으로 RESTRICT 로 붙들고 실제 그림 바이트가 데모에 남지 않게 먼저 비운다. 데모는 그림을 채우지 않는다.
// 주간 과제투입시간(cal_report_weekly_hours, 구조 20)은 cal_report_weekly 의 자식이라 그 앞에서 지운다(CASCADE 로도 지워지지만
//   표를 이름으로 적어 두어야 시험이 정본의 cal_* 명부와 대조할 수 있다). 데모는 주간보고를 채우지 않는다.
// 과제 반복 일정의 예외일(cal_project_event_except, 구조 20)은 cal_project_event 의 자식이라 그 앞에서 지운다(같은 까닭으로 이름을 적는다).
export const WIPE_TABLES = [
  'project_schedule_image',
  'cal_project_change', 'cal_project_event_except', 'cal_project_event',
  'cal_report_hours', 'cal_report_daily', 'cal_report_weekly_hours', 'cal_report_weekly',
  'cal_task_hours', 'cal_todo_day_note', 'cal_todo',
  'cal_entry_except', 'cal_entry', 'cal_category',
  'cal_attendance', 'cal_user_pref', 'cal_migration_log',
];
// 가드가 있는지 보는 표 전부.
export const REQUIRED_TABLES = [
  'app_user', 'org_unit', 'title_code', 'customer', 'section_code', 'status_code', 'project', 'room_code',
  'cal_schema_meta', 'cal_user_rev', ...WIPE_TABLES,
];

// ── 작은 도구 ───────────────────────────────────────────────────────────
function uuidFrom(seed) {
  const h = createHash('sha1').update('task-calendar-demo:' + seed, 'utf8').digest('hex');
  const v = '5' + h.slice(13, 16);
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${v}-${variant}-${h.slice(20, 32)}`;
}
function mulberry32(a) {
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const addDays = (d, n) => utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);
const isWorkday = (d) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;

// SQL 문자열 리터럴. 정의 파일의 글만 들어온다. 제어 문자는 받지 않는다.
export function sqlStr(s) {
  const t = String(s);
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(t)) throw new Error('SQL 문자열에 제어 문자가 있습니다: ' + JSON.stringify(t));
  return "'" + t.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}
// 줄바꿈이 든 글: 줄마다 따옴표 글자로 쓰고 CHAR(10)으로 잇는다(SQL 문자열에 제어 문자를 넣지 않는다).
export const sqlMulti = (s) => { const parts = String(s).split('\n'); return parts.length === 1 ? sqlStr(s) : `CONCAT(${parts.map(sqlStr).join(', CHAR(10 USING utf8mb4), ')})`; };
const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : sqlStr(v));
const hexUtf8 = (s) => Buffer.from(String(s), 'utf8').toString('hex').toUpperCase();
// 가드: 조건이 참이면 DO 0, 거짓이면 없는 표를 SELECT 해 ERROR 1146 으로 멈춘다. 표 이름 자리의 문장은 64자 이내.
function guard(cond, why) {
  const msg = '중단: ' + why;
  if ([...msg].length > 64) throw new Error('가드 문장이 64자를 넘습니다: ' + msg);
  if (/[`']/.test(msg)) throw new Error('가드 문장에 따옴표가 있습니다: ' + msg);
  return `SET @g := IF(${cond}, 'DO 0', 'SELECT 1 FROM \`${msg}\`');\nPREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;`;
}

// ── 사람 이름 명단(녹화 계정 다음 순서) ───────────────────────────────────
// 고정 명단 넷 다음에 성과 이름을 엮는다. (s, r) 마다 이름 번호 g = (5s + r) mod G 라 같은 조합이 두 번 나오지 않는다.
export function peopleNames() {
  const out = D.FIXED_PEOPLE.map((p) => ({ name: p.name, login: p.login }));
  const avoid = new Set([...D.AVOID_NAMES, ...out.map((p) => p.name)]);
  const S = D.SURNAMES.length, G = D.GIVEN_NAMES.length;
  for (let r = 0; r < G; r++) {
    for (let s = 0; s < S; s++) {
      const [sn, sr] = D.SURNAMES[s];
      const [gn, gr] = D.GIVEN_NAMES[(5 * s + r) % G];
      const name = sn + gn;
      if (avoid.has(name)) continue;
      avoid.add(name);
      out.push({ name, login: sr + gr });
    }
  }
  const logins = new Set();
  for (const p of out) {
    if (logins.has(p.login)) throw new Error('명단의 login_id 가 겹칩니다: ' + p.login);
    if (!/^[a-z0-9]{2,50}$/.test(p.login)) throw new Error('명단의 login_id 모양이 이상합니다: ' + p.login);
    logins.add(p.login);
  }
  return out;
}

// ── 날짜 범위 ───────────────────────────────────────────────────────────
export function dateRange(baseDate) {
  if (!DATE_RE.test(baseDate)) throw new Error('기준 날짜는 YYYY-MM-DD 여야 합니다: ' + baseDate);
  const [y, m, d] = baseDate.split('-').map(Number);
  const base = utc(y, m - 1, d);
  if (ymd(base) !== baseDate) throw new Error('없는 날짜입니다: ' + baseDate);
  const prevStart = utc(y, m - 2, 1);
  const curStart = utc(y, m - 1, 1);
  const curEnd = utc(y, m, 0);
  return { base, prevStart, curStart, curEnd };
}
const monthStart = (base, off) => utc(base.getUTCFullYear(), base.getUTCMonth() + off, 1);
const monthEnd = (base, off) => utc(base.getUTCFullYear(), base.getUTCMonth() + off + 1, 0);

// ── 공식 과제 ───────────────────────────────────────────────────────────
export function projectRows(baseDate) {
  const { base } = dateRange(baseDate);
  //  과제 순서(구조 19, sort_no): 구분마다 PROJECTS 에 적은 순서대로 1 부터(관리 화면의 No).
  const seen = {};
  return D.PROJECTS.map((p, i) => ({
    id: i + 1,
    sortNo: (seen[p.section] = (seen[p.section] || 0) + 1),
    key: p.key,
    uid: uuidFrom('project:' + p.key),
    sectionId: p.section,
    customerId: p.customer,
    projectName: p.common + D.PROJECT_NAME_SUFFIX,
    contractName: p.section === 2 ? '' : p.common + D.CONTRACT_NAME_SUFFIX,
    commonName: p.common,
    startDate: p.start === null ? null : ymd(monthStart(base, p.start)),
    endDate: p.end === null ? null : ymd(monthEnd(base, p.end)),
    devEndDate: p.devEnd === null ? null : ymd(monthEnd(base, p.devEnd)),
    statusId: p.status,
    color: p.color,
  }));
}

// ── 한 사람의 캘린더 ─────────────────────────────────────────────────────
const SLOTS = [['09:00', '10:00'], ['11:00', '12:00'], ['13:30', '15:00'], ['15:30', '17:00'], ['17:00', '18:00']];
const MORNING = [0, 1];

export function personCalendar(person, baseDate, projects) {
  const { base, prevStart, curStart, curEnd } = dateRange(baseDate);
  const rng = mulberry32(person.seed);
  const projByKey = new Map(projects.map((p) => [p.key, p]));

  // 과제: 공식 과제, 개인 과제, 휴가, 기타 순서. cat_no 는 1 부터, sort_order 는 0 부터(앱이 쓰는 것과 같은 모양).
  const cats = [];
  for (const k of person.projects) {
    const p = projByKey.get(k);
    if (!p) throw new Error('없는 공식 과제 key: ' + k);
    cats.push({ key: 'p:' + k, uid: 'db-' + p.uid, source: 'db', name: p.commonName, color: p.color, desc: '', projectUid: p.uid, proj: p });
  }
  for (const k of [...person.personal, 'leave', 'etc']) {
    const t = D.PERSONAL_TASKS[k];
    if (!t) throw new Error('없는 개인 과제 key: ' + k);
    cats.push({ key: k, uid: 'c-' + uuidFrom(person.who + ':cat:' + k), source: 'local', name: t.name, color: t.color, desc: t.desc, projectUid: null });
  }
  cats.forEach((c, i) => { c.no = i + 1; c.sort = i; });
  const catOf = (key) => cats.find((c) => c.key === key);
  const has = (key) => !!catOf(key);

  const days = [];
  for (let d = prevStart; d <= curEnd; d = addDays(d, 1)) if (isWorkday(d)) days.push(d);
  const prevDays = days.filter((d) => d < curStart);
  const curDays = days.filter((d) => d >= curStart);

  const entries = [];
  const dayInfo = new Map(days.map((d) => [ymd(d), { cats: [], busy: new Set(), leaveAll: false, leaveHalf: false, blocked: false }]));
  const mark = (d, catKey) => { const x = dayInfo.get(ymd(d)); if (x) x.cats.push(catKey); };
  const add = (e) => entries.push({ endDate: null, allDay: 0, start: null, end: null, memo: '', location: '', recur: null, ...e });

  // 1) 주간 회의: 반복 일정 하나(매주, 끝 없음)
  if (has('meeting')) {
    let d = prevStart;
    while (d.getUTCDay() !== person.meetingDay) d = addDays(d, 1);
    add({ cat: 'meeting', date: ymd(d), title: '주간 팀 회의', start: '10:00', end: '11:00', location: D.ROOMS[0], recur: { freq: 'weekly', interval: 1, count: 0 } });
    for (const x of days) if (x.getUTCDay() === person.meetingDay) { mark(x, 'meeting'); dayInfo.get(ymd(x)).busy.add('10:00'); }
  }
  // 2) 휴가: 지난달 이틀 연속(종일 기간 일정), 이번 달 오후 반차 하루
  {
    // 바로 다음 날도 평일인 날(월 ~ 목)에서 고른다
    const pairs = prevDays.filter((d, k) => k + 1 < prevDays.length && ymd(addDays(d, 1)) === ymd(prevDays[k + 1]));
    const a = pairs[Math.floor(rng() * pairs.length)], b = addDays(a, 1);
    add({ cat: 'leave', date: ymd(a), endDate: ymd(b), allDay: 1, title: '연차 휴가' });
    for (const x of [a, b]) { const info = dayInfo.get(ymd(x)); info.leaveAll = true; info.blocked = true; }
    const half = curDays[Math.floor(rng() * curDays.length)];
    const hi = dayInfo.get(ymd(half));
    if (!hi.blocked) {
      add({ cat: 'leave', date: ymd(half), title: '오후 반차', start: '13:00', end: '18:00' });
      hi.leaveHalf = true; mark(half, 'leave');
    }
  }
  // 3) 첫 공식 과제의 고객사 현장 지원: 이번 달 사흘(월, 화, 수 중 하루에 시작하는 종일 기간 일정)
  {
    const first = cats.find((c) => c.source === 'db');
    const free = (d) => { const x = dayInfo.get(ymd(d)); return !!x && !x.blocked && !x.leaveHalf && d >= curStart; };
    const starts = curDays.filter((d) => d.getUTCDay() <= 3 && [0, 1, 2].every((k) => free(addDays(d, k))));
    if (first && starts.length) {
      const s = starts[Math.floor(rng() * starts.length)];
      add({ cat: first.key, date: ymd(s), endDate: ymd(addDays(s, 2)), allDay: 1, title: '고객사 현장 지원', location: D.ROOMS[3],
        memo: '(예시) 현장 점검 목록은 공유 폴더에 있습니다.' });
      for (let k = 0; k < 3; k++) { const info = dayInfo.get(ymd(addDays(s, k))); info.blocked = true; info.cats.push(first.key); }
    }
  }
  // 4) 교육: 지난달 오후 교육 하루
  if (has('edu')) {
    const cand = prevDays.filter((d) => !dayInfo.get(ymd(d)).blocked);
    const d = cand[Math.floor(rng() * cand.length)];
    add({ cat: 'edu', date: ymd(d), title: pick(rng, D.PERSONAL_TITLES.edu), start: '14:00', end: '17:00', location: D.ROOMS[2] });
    const info = dayInfo.get(ymd(d)); info.busy.add('13:30'); info.busy.add('15:30'); mark(d, 'edu');
  }
  // 5) 평일 업무: 하루 1~3개. 시각이 있는 일정은 겹치지 않는 칸에만 둔다.
  const personalPool = ['docs', 'etc'].filter(has);
  for (const d of days) {
    const info = dayInfo.get(ymd(d));
    if (info.blocked) continue;
    let n = 1 + Math.floor(rng() * 3);
    if (info.cats.includes('meeting') || info.cats.includes('edu')) n = Math.max(1, n - 1);
    const free = SLOTS.map((_, k) => k).filter((k) => !info.busy.has(SLOTS[k][0]) && (!info.leaveHalf || MORNING.includes(k)));
    for (let j = 0; j < n; j++) {
      const live = cats.filter((c) => c.source === 'db'
        && (!c.proj.startDate || c.proj.startDate <= ymd(d)) && (!c.proj.endDate || ymd(d) <= c.proj.endDate));
      let cat, title;
      if (live.length && rng() < 0.75) { cat = pick(rng, live).key; title = pick(rng, D.PROJECT_TITLES); }
      else if (personalPool.length) { const k = pick(rng, personalPool); cat = k; title = pick(rng, D.PERSONAL_TITLES[k]); }
      else { cat = 'etc'; title = pick(rng, D.PERSONAL_TITLES.etc); }
      const e = { cat, date: ymd(d), title };
      if (free.length && rng() < 0.7) {
        const k = free.splice(Math.floor(rng() * free.length), 1)[0];
        e.start = SLOTS[k][0]; e.end = SLOTS[k][1];
        if (rng() < 0.35) e.location = pick(rng, D.ROOMS.slice(0, 2));
      } else {
        e.allDay = 1;
      }
      if (rng() < 0.2) e.memo = pick(rng, D.ENTRY_MEMOS);
      add(e);
      mark(d, cat);
    }
  }
  // 날짜, 시각 순으로 번호를 붙인다(종일이 먼저).
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.start || '') < (b.start || '') ? -1 : (a.start || '') > (b.start || '') ? 1 : 0));
  entries.forEach((e, i) => { e.no = i + 1; e.sort = i; e.uid = 'e-' + uuidFrom(person.who + ':entry:' + i + ':' + e.date); });

  // 할 일: 끝낸 것 셋, 남은 것 넷, 기간 할 일 하나
  const T = D.TODO_TEXTS;
  const off = D.DEMO_PEOPLE.indexOf(person) * 3;
  const workCats = cats.filter((c) => c.key !== 'leave');
  const tcat = (k) => workCats[k % workCats.length].key;
  const prevPick = prevDays[Math.floor(rng() * prevDays.length)];
  const beforeBase = days.filter((d) => d < base && d >= curStart);
  const curPick = beforeBase.length ? beforeBase[Math.floor(rng() * beforeBase.length)] : prevDays[prevDays.length - 1];
  const todos = [
    { text: T[(off + 0) % T.length], cat: tcat(0), due: ymd(prevPick), done: 1, completedAt: ymd(prevPick) + ' 08:00:00.000' },
    { text: T[(off + 1) % T.length], cat: tcat(1), due: ymd(curPick), done: 1, completedAt: ymd(curPick) + ' 07:30:00.000' },
    { text: T[(off + 2) % T.length], cat: tcat(2), done: 1, completedAt: ymd(addDays(base, -3)) + ' 06:00:00.000' },
    { text: T[(off + 3) % T.length], cat: tcat(3), due: ymd(addDays(base, 2)), prio: 'high' },
    { text: T[(off + 4) % T.length], cat: tcat(4), due: ymd(addDays(base, 6)) },
    { text: T[(off + 5) % T.length], cat: tcat(5), due: ymd(addDays(base, -3)), prio: 'high' },
    { text: T[(off + 6) % T.length], cat: tcat(6), due: ymd(addDays(base, -2)), endDate: ymd(addDays(base, 4)),
      notes: [[ymd(addDays(base, -2)), '(예시) 자료 수집 시작'], [ymd(base), '(예시) 초안 검토 요청']] },
    { text: T[(off + 7) % T.length], cat: tcat(7), note: '(예시) 기한 없이 틈틈이' },
  ].map((t, i) => ({ due: null, endDate: null, done: 0, prio: 'normal', completedAt: null, note: '', notes: [], ...t,
    no: i + 1, sort: i, uid: 't-' + uuidFrom(person.who + ':todo:' + i) }));

  // 과제별 시간: 기준 날짜까지의 평일. 종일 휴가 8시간, 반차 4시간, 나머지는 그날 일정의 과제에 0.5 단위로 나눈다.
  const hours = [];
  for (const d of days) {
    if (d > base) break;
    const info = dayInfo.get(ymd(d));
    const row = new Map();
    if (info.leaveAll) row.set('leave', 8);
    else {
      if (rng() >= 0.85) continue;                      // 적지 않은 날도 있다
      let left = 8;
      if (info.leaveHalf) { row.set('leave', 4); left = 4; }
      const work = [...new Set(info.cats.filter((k) => k !== 'leave'))];
      if (work.includes('meeting') && left > 1) { row.set('meeting', 1); left -= 1; }
      const rest = work.filter((k) => k !== 'meeting');
      if (!rest.length) rest.push(has('etc') ? 'etc' : work[0]);
      const units = left * 2;
      const share = rest.map(() => 1);
      for (let u = rest.length; u < units; u++) share[Math.floor(rng() * rest.length)] += 1;
      rest.forEach((k, i) => row.set(k, (row.get(k) || 0) + share[i] / 2));
    }
    for (const [k, h] of row) hours.push({ date: ymd(d), cat: k, hours: h });
  }
  return { cats, entries, todos, hours, catNo: (key) => catOf(key).no };
}

// ── 과제 공용 일정(구조 16, 20: cal_project_event, cal_project_event_except, cal_project_change) ──────────
// 2026-11-02(사용 영상 v5): 과제 탭, 최근 변경, 날짜 목록, 참여자 명단이 비지 않도록 공식 과제마다 공용 일정을 만든다.
//   글쓴이는 그 과제를 내 과제로 가진 사람(녹화 계정과 동료 셋). 이름은 SQL 안에서 app_user 에서 읽는다(실제 이름을 파일에 적지 않는다).
const hhmm = (s) => s;
export function projectEvents(baseDate, projects) {
  const { base, prevStart, curEnd } = dateRange(baseDate);
  const rng = mulberry32(7001);
  const wdays = [];
  for (let d = prevStart; d <= curEnd; d = addDays(d, 1)) if (isWorkday(d)) wdays.push(d);
  const rows = [], excepts = [], changes = [];
  let id = 0;
  const bd = ymd(base);
  const clampDay = (d) => (ymd(d) < bd ? d : addDays(base, -1));
  const mk = (p, who, f, extra = {}) => {
    id += 1;
    const created = ymd(clampDay(addDays(utc(+f.startDate.slice(0, 4), +f.startDate.slice(5, 7) - 1, +f.startDate.slice(8, 10)), -4)));
    const e = { id, uid: uuidFrom('pevent:' + id), projectId: p.id, who, f: { endDate: null, startTime: null, endTime: null, location: '', memo: '', recurFreq: null, ...f },
      version: 1, deleted: 0, createdAt: created + ' 00:30:00.000', updatedAt: created + ' 00:30:00.000', deletedAt: null, ...extra };
    rows.push(e);
    changes.push({ projectId: p.id, eventId: id, uid: uuidFrom('pchange:' + id + ':c'), action: 'create', who, title: e.f.title, before: null, after: e.f, at: e.createdAt });
    return e;
  };
  for (const p of projects) {
    const members = D.DEMO_PEOPLE.filter((x) => x.projects.includes(p.key)).map((x) => x.who);
    const creators = members.length ? members : ['c1'];
    const lo = p.startDate && p.startDate > ymd(prevStart) ? p.startDate : ymd(prevStart);
    const hi = p.endDate && p.endDate < ymd(curEnd) ? p.endDate : ymd(curEnd);
    const elig = wdays.filter((d) => ymd(d) >= lo && ymd(d) <= hi);
    if (!elig.length) continue;
    const n = p.statusId === 2 ? 2 : 5;
    for (let k = 0; k < n; k++) {
      const d = elig[Math.floor(rng() * elig.length)];
      const who = creators[k % creators.length];
      const title = pick(rng, D.PROJECT_TITLES);
      const timed = rng() < 0.6;
      if (timed) {
        const s = SLOTS[Math.floor(rng() * SLOTS.length)];
        mk(p, who, { title, startDate: ymd(d), startTime: hhmm(s[0]), endTime: hhmm(s[1]), location: rng() < 0.5 ? pick(rng, D.ROOMS.slice(0, 2)) : '', memo: rng() < 0.3 ? '(예시) 자료는 공유 폴더에 있습니다.' : '' });
      } else {
        const multi = rng() < 0.25 && elig.some((x) => ymd(x) === ymd(addDays(d, 1)));
        mk(p, who, { title, startDate: ymd(d), endDate: multi ? ymd(addDays(d, 1)) : null, location: '', memo: '' });
      }
    }
    // 대표 반복 일정: 장비 개발은 매주 화요일 점검(지난달 한 회차는 건너뜀), 그룹웨어 개선은 매월 운영 회의
    if (p.key === 'equip') {
      let d = prevStart; while (d.getUTCDay() !== 2) d = addDays(d, 1);
      const e = mk(p, creators[0], { title: '주간 진행 점검', startDate: ymd(d), startTime: '14:00', endTime: '15:00', location: D.ROOMS[0], recurFreq: 'weekly', memo: '(예시) 매주 화요일 진행 상황을 점검합니다.' });
      excepts.push({ eventId: e.id, date: ymd(addDays(d, 14)) });
    }
    if (p.key === 'gw') {
      // 매월 같은 날짜에 오므로 지난달과 이번 달 모두 평일인 날(12일부터 한 칸씩)을 고른다
      let d = utc(prevStart.getUTCFullYear(), prevStart.getUTCMonth(), 12);
      for (let k = 0; k < 8; k++, d = addDays(d, 1)) {
        const nx = utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
        if (isWorkday(d) && isWorkday(nx)) break;
      }
      mk(p, creators[0], { title: '월간 운영 회의', startDate: ymd(d), startTime: '10:00', endTime: '11:00', location: D.ROOMS[1], recurFreq: 'monthly' });
    }
  }
  // 최근 변경: 시각이나 장소를 바꾼 수정 넷과 지운 일정 하나(삭제 이력). 기준 날짜 가까이에 둔다.
  const pickIdx = [3, 8, 13, 20].filter((i) => i < rows.length);
  pickIdx.forEach((i, j) => {
    const e = rows[i];
    const before = { ...e.f };
    const after = e.f.startTime ? { ...e.f, location: e.f.location ? '' : D.ROOMS[0] } : { ...e.f, memo: '(예시) 일정 범위를 확인했습니다.' };
    const diff = (a, b) => Object.fromEntries(Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => [k, a[k]]));
    const at = ymd(addDays(base, -(j + 1))) + ` 0${2 + j}:10:00.000`;
    changes.push({ projectId: e.projectId, eventId: e.id, uid: uuidFrom('pchange:' + e.id + ':u'), action: 'update', who: e.who === 'me' ? 'c1' : e.who, title: e.f.title,
      before: diff(before, after), after: diff(after, before), at });
    e.f = after; e.version = 2; e.updatedAt = at;
  });
  if (rows.length > 6) {
    const e = rows[6];
    const at = ymd(addDays(base, -2)) + ' 05:40:00.000';
    changes.push({ projectId: e.projectId, eventId: e.id, uid: uuidFrom('pchange:' + e.id + ':d'), action: 'delete', who: e.who, title: e.f.title, before: null, after: null, at });
    e.deleted = 1; e.version = 2; e.deletedAt = at; e.updatedAt = at;
  }
  return { rows, excepts, changes };
}

// ── 근태와 보낸 보고(cal_attendance, cal_report_daily, cal_report_hours, cal_report_weekly, cal_report_weekly_hours) ──
// 2026-11-02(사용 영상 v5): 근태 탭 달력과 주간보고 목록이 비지 않도록 녹화 계정에게만 만든다. 보낸 글은 가상 일정 제목만 쓴다.
//   일간 보고는 기준 날짜 전날까지, 주간 보고는 기준 날짜가 든 주의 두 주 전까지(그 뒤는 영상에서 직접 쓴다).
function entriesOn(cal, dayStr) {
  const d = utc(+dayStr.slice(0, 4), +dayStr.slice(5, 7) - 1, +dayStr.slice(8, 10));
  return cal.entries.filter((e) => {
    if (e.recur) { const s = utc(+e.date.slice(0, 4), +e.date.slice(5, 7) - 1, +e.date.slice(8, 10)); return d >= s && d.getUTCDay() === s.getUTCDay(); }
    if (e.endDate) return e.date <= dayStr && dayStr <= e.endDate;
    return e.date === dayStr;
  });
}
const fmtH = (h) => (Number.isInteger(h) ? String(h) : String(h));
export function attendanceReports(cal, baseDate) {
  const { base, prevStart } = dateRange(baseDate);
  const rng = mulberry32(9101);
  const bd = ymd(base);
  const attend = new Map();   // date -> { status, overtime }
  for (const e of cal.entries) {
    if (e.cat === 'leave') {
      if (e.allDay) for (let d = utc(+e.date.slice(0, 4), +e.date.slice(5, 7) - 1, +e.date.slice(8, 10)); ymd(d) <= (e.endDate || e.date); d = addDays(d, 1)) attend.set(ymd(d), { status: '6', overtime: 0 });
      else attend.set(e.date, { status: '12', overtime: 0 });
    } else if (e.allDay && e.endDate && e.title === '고객사 현장 지원') {
      for (let d = utc(+e.date.slice(0, 4), +e.date.slice(5, 7) - 1, +e.date.slice(8, 10)); ymd(d) <= e.endDate; d = addDays(d, 1)) attend.set(ymd(d), { status: '4', overtime: 0 });
    }
  }
  const hoursByDate = new Map();
  for (const h of cal.hours) { if (!hoursByDate.has(h.date)) hoursByDate.set(h.date, []); hoursByDate.get(h.date).push(h); }
  const days = [...hoursByDate.keys()].sort().filter((d) => d < bd);
  // 야근 사흘(정근인 날 중에서)
  const plain = days.filter((d) => !attend.has(d));
  for (let k = 0; k < 3 && plain.length; k++) attend.set(plain.splice(Math.floor(rng() * plain.length), 1)[0], { status: '2', overtime: 2 + (k % 2) });
  const attendRows = [...attend.entries()].filter(([d]) => d <= bd).sort().map(([date, v]) => ({ date, ...v }));

  const catByNo = new Map(cal.cats.map((c) => [c.no, c]));
  const daily = [];
  for (const date of days) {
    if (rng() < 0.05) continue;   // 보고하지 않은 날도 있다
    const hs = hoursByDate.get(date).slice().sort((a, b) => cal.catNo(a.cat) - cal.catNo(b.cat));
    const ents = entriesOn(cal, date);
    const lines = [], parts = [];
    for (const h of hs) {
      const c = cal.cats.find((x) => x.key === h.cat);
      const titles = [...new Set(ents.filter((e) => e.cat === h.cat).map((e) => e.title))].slice(0, 3);
      parts.push(`[${c.name}] : ${fmtH(h.hours)}` + (h.cat === 'leave' ? '' : '\n' + (titles.length ? titles.map((t) => '- ' + t).join('\n') : '- 업무 진행')));
      lines.push({ name: c.name, catNo: c.no, hours: h.hours });
    }
    const a = attend.get(date) || { status: '1', overtime: 0 };
    daily.push({ date, status: a.status, overtime: a.overtime, content: parts.join('\n\n'), lines, sentAt: date + ' 09:30:00.000' });
  }

  // 주간: 월요일 시작, 기준 날짜가 든 주의 두 주 전 월요일까지
  const mondayOf = (d) => addDays(d, -((d.getUTCDay() + 6) % 7));
  const lastMonday = addDays(mondayOf(base), -14);
  const weekly = [];
  for (let m = mondayOf(prevStart); m <= lastMonday; m = addDays(m, 7)) {
    if (m < prevStart) continue;
    const start = ymd(m), end = ymd(addDays(m, 6));
    const first = mondayOf(utc(m.getUTCFullYear(), m.getUTCMonth(), 1));
    const nth = Math.floor((m - first) / 86400000 / 7) + 1;
    const ORD = ['', '첫째', '둘째', '셋째', '넷째', '다섯째'];
    const byCat = new Map();
    for (const h of cal.hours) if (h.date >= start && h.date <= end) byCat.set(h.cat, (byCat.get(h.cat) || 0) + h.hours);
    const cats = cal.cats.filter((c) => byCat.has(c.key));
    const hoursRows = cats.map((c) => ({ name: c.name, projectUid: c.projectUid, hours: byCat.get(c.key) }));
    const total = hoursRows.reduce((a, x) => a + x.hours, 0);
    const content = hoursRows.map((x) => `[${x.name}] : ${fmtH(x.hours)}`).join('\n') + '\n-----\n합계 : ' + fmtH(total);
    const prog = [], plan = [];
    for (const c of cats.filter((x) => x.key !== 'leave' && x.key !== 'meeting')) {
      const ts = new Set();
      for (let d = m; ymd(d) <= end; d = addDays(d, 1)) for (const e of entriesOn(cal, ymd(d))) if (e.cat === c.key) ts.add(e.title);
      prog.push(`[${c.name}]\n` + ([...ts].slice(0, 3).map((t) => '- ' + t).join('\n') || '- 업무 진행'));
      plan.push(`[${c.name}]\n- ` + pick(rng, D.PROJECT_TITLES));
    }
    weekly.push({ start, end, subject: `${m.getUTCMonth() + 1}월 ${ORD[nth] || nth + '번째'}주`, content, endwork: prog.join('\n\n'), plan: plan.join('\n\n'),
      meeting: '(예시) 주간 팀 회의\n- 일정 점검, 이슈 공유', composedAt: ymd(addDays(m, 4)) + ' 08:50:00.000', hours: hoursRows });
  }
  return { attendRows, daily, weekly, catByNo };
}

// ── SQL 조립 ───────────────────────────────────────────────────────────
export function buildDemoSql({ myLogin, baseDate }) {
  if (!LOGIN_RE.test(String(myLogin || ''))) throw new Error('--my-login 이 login_id 모양이 아닙니다(영문, 숫자, . _ @ - 1~50자).');
  dateRange(baseDate);
  const names = peopleNames();
  if (names.some((p) => p.login.toLowerCase() === String(myLogin).toLowerCase())) {
    throw new Error('녹화 계정 login_id 가 가상 명단의 login_id 와 같습니다: ' + myLogin);
  }
  const projects = projectRows(baseDate);
  const people = D.DEMO_PEOPLE.map((p) => ({ person: p, cal: personCalendar(p, baseDate, projects) }));
  const uvar = (who) => '@u_' + who;
  const L = [];
  const push = (...xs) => L.push(...xs);
  const tblList = REQUIRED_TABLES.map((t) => `'${t}'`).join(',');

  push(
    '-- =====================================================================',
    '--  demo-load.sql: 사용 설명 영상(이슈 #13)용 데모 데이터. db/demo/build-demo-sql.mjs 가 만든 파일이다. 손으로 고치지 말 것.',
    `--  기준 날짜 ${baseDate}, 녹화 계정 login_id 16진 ${hexUtf8(myLogin)}`,
    '--  실행은 db/demo/demo-db.ps1 -Load 가 한다(백업을 먼저 뜬다). 손으로 돌리지 말 것. --force 금지.',
    '--  바꾸는 것: app_user 의 name, login_id(녹화 계정은 그대로), customer, project, cal_* 사용자 데이터, cal_user_rev(올림).',
    '--  그대로 두는 것: org_unit, title_code, section_code, status_code, cal_schema_meta, 계정과 권한.',
    '-- =====================================================================',
    'SET NAMES utf8mb4;',
    "SET SESSION time_zone = '+00:00';",
    'SET SESSION lock_wait_timeout = 10;',
    'SET SESSION innodb_lock_wait_timeout = 10;',
    'SET SESSION group_concat_max_len = 4194304;',
    '',
    '-- 0) 가드: 여기까지는 아무것도 바꾸지 않는다',
    guard("HEX('가나다') = 'EAB080EB8298EB8BA4'", '문자셋이 utf8mb4 가 아니다'),
    `SET @n_tbl := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME IN (${tblList}));`,
    guard(`@n_tbl = ${REQUIRED_TABLES.length}`, '필요한 표가 다 있지 않다(DB 이름 확인)'),
    "SET @v := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');",
    guard(`@v <=> '${SCHEMA_VERSION}'`, `구조 번호가 ${SCHEMA_VERSION} 이 아니다`),
    `SET @my_login := CONVERT(X'${hexUtf8(myLogin)}' USING utf8mb4) COLLATE utf8mb4_0900_ai_ci;`,
    'SET @n_me := (SELECT COUNT(*) FROM app_user WHERE login_id = @my_login);',
    guard('@n_me = 1', '녹화 계정 login_id 가 app_user 에 없다'),
    'SET @u_me := (SELECT user_id FROM app_user WHERE login_id = @my_login);',
    'SET @my_login_hex := (SELECT HEX(login_id) FROM app_user WHERE user_id = @u_me);',
    'SET @my_name_hex := (SELECT HEX(name) FROM app_user WHERE user_id = @u_me);',
    'SET @my_org := (SELECT org_id FROM app_user WHERE user_id = @u_me);',
    'SET @n_user := (SELECT COUNT(*) FROM app_user);',
    'SET @n_other_active := (SELECT COUNT(*) FROM app_user WHERE user_id <> @u_me AND is_active = 1);',
    guard('@n_other_active >= 3', '재직 중인 다른 사람이 셋 미만이다'),
    guard(`@n_user - 1 <= ${names.length}`, '가상 이름 명단보다 사람이 많다'),
    guard('(SELECT COUNT(*) FROM section_code WHERE section_id IN (1,2,3)) = 3', '구분 코드 1, 2, 3 이 다 있지 않다'),
    guard('(SELECT COUNT(*) FROM status_code WHERE status_id IN (1,2,3,4)) = 4', '상태 코드 1 ~ 4 가 다 있지 않다'),
    '',
    '-- 가상 이름 명단(녹화 계정 다음 순서)',
    'DROP TEMPORARY TABLE IF EXISTS _demo_names;',
    'CREATE TEMPORARY TABLE _demo_names (rn INT NOT NULL PRIMARY KEY, name VARCHAR(50) NOT NULL, login_id VARCHAR(50) NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;',
  );
  for (let i = 0; i < names.length; i += 50) {
    const chunk = names.slice(i, i + 50).map((p, k) => `(${i + k + 1},${sqlStr(p.name)},${sqlStr(p.login)})`);
    push('INSERT INTO _demo_names (rn, name, login_id) VALUES ' + chunk.join(',') + ';');
  }
  push(
    'SET @n_my_dummy := (SELECT COUNT(*) FROM _demo_names WHERE login_id = @my_login);',
    guard('@n_my_dummy = 0', '녹화 계정 login_id 가 가상 명단과 겹친다'),
    '-- 녹화 계정의 지금 이름과 같은 가상 이름이 있으면 멈춘다(녹화 계정과 다른 사람이 같은 이름으로 보이지 않게)',
    'SET @n_my_name_dummy := (SELECT COUNT(*) FROM _demo_names WHERE name = TRIM(CONVERT(UNHEX(@my_name_hex) USING utf8mb4)) COLLATE utf8mb4_0900_ai_ci);',
    guard('@n_my_name_dummy = 0', '녹화 계정 이름이 가상 명단의 이름과 같다'),
    '',
    '-- 이름 받을 순서. 재직 중이고 같은 조직인 사람이 앞에 온다. 앞의 셋(김철수, 이영희, 박민수)이 일정 데이터를 받는 동료다.',
    '-- 임시 표는 트랜잭션 밖에서 만든다(GTID 일관성 모드에서도 막히지 않게).',
    'DROP TEMPORARY TABLE IF EXISTS _demo_rank;',
    'CREATE TEMPORARY TABLE _demo_rank (PRIMARY KEY (user_id)) AS',
    '  SELECT user_id, ROW_NUMBER() OVER (ORDER BY is_active DESC, (org_id <=> @my_org) DESC, (sort_order IS NULL), sort_order, user_id) AS rn',
    '    FROM app_user WHERE user_id <> @u_me;',
    'SET @u_c1 := (SELECT user_id FROM _demo_rank WHERE rn = 1);',
    'SET @u_c2 := (SELECT user_id FROM _demo_rank WHERE rn = 2);',
    'SET @u_c3 := (SELECT user_id FROM _demo_rank WHERE rn = 3);',
    guard('(SELECT COUNT(*) FROM app_user WHERE user_id IN (@u_c1,@u_c2,@u_c3) AND is_active = 1) = 3', '동료 셋이 재직 중이 아니다'),
    '',
    '-- 1) 트랜잭션 시작. 사람: 녹화 계정은 그대로, 나머지는 명단 순서대로 이름과 login_id',
    'START TRANSACTION;',
    "SELECT CONCAT('lock:', COUNT(*)) FROM app_user FOR UPDATE;",
    guard('(SELECT COUNT(*) FROM app_user) = @n_user AND (SELECT COUNT(*) FROM _demo_rank) = @n_user - 1', '준비하는 사이 사람 수가 바뀌었다'),
    "SET @fp_user := (SELECT SHA2(GROUP_CONCAT(CONCAT_WS(',', user_id, IFNULL(title_id,'-'), IFNULL(org_id,'-'), view_scope, edit_role, is_active, IFNULL(sort_order,'-')) ORDER BY user_id SEPARATOR ';'), 256) FROM app_user);",
    "SET @fp_org := (SELECT SHA2(IFNULL(GROUP_CONCAT(CONCAT_WS(',', org_id, HEX(name), IFNULL(parent_id,'-'), sort_order, is_active) ORDER BY org_id SEPARATOR ';'),''), 256) FROM org_unit);",
    "SET @fp_title := (SELECT SHA2(IFNULL(GROUP_CONCAT(CONCAT_WS(',', title_id, HEX(name), sort_order, is_active) ORDER BY title_id SEPARATOR ';'),''), 256) FROM title_code);",
    "UPDATE app_user u JOIN _demo_rank r ON r.user_id = u.user_id SET u.login_id = CONCAT('~demo~', u.user_id);",
    'UPDATE app_user u JOIN _demo_rank r ON r.user_id = u.user_id JOIN _demo_names n ON n.rn = r.rn SET u.name = n.name, u.login_id = n.login_id;',
    'SET @n_renamed := ROW_COUNT();',
    guard('@n_renamed = @n_user - 1', '이름을 바꾼 사람 수가 맞지 않는다'),
    '',
    '-- 2) cal_* 사용자 데이터 비우기(자식 먼저). cal_user_rev 와 cal_schema_meta 는 지우지 않는다',
    ...WIPE_TABLES.map((t) => `DELETE FROM ${t};`),
    '',
    '-- 3) 발주처와 공식 과제 바꾸기',
    'DELETE FROM project;',
    'DELETE FROM customer;',
    'INSERT INTO customer (customer_id, name, is_active) VALUES',
    D.CUSTOMERS.map((c, i) => `  (${i + 1}, ${sqlStr(c)}, 1)`).join(',\n') + ';',
    'INSERT INTO project (id, uid, section_id, customer_id, project_name, contract_name, common_name, start_date, end_date, dev_end_date, status_id, sort_no, note, is_active) VALUES',
    projects.map((p) => `  (${p.id}, ${sqlStr(p.uid)}, ${p.sectionId}, ${p.customerId}, ${sqlStr(p.projectName)}, ${sqlStr(p.contractName)}, ${sqlStr(p.commonName)}, ${lit(p.startDate)}, ${lit(p.endDate)}, ${lit(p.devEndDate)}, ${lit(p.statusId)}, ${p.sortNo}, '', 1)`).join(',\n') + ';',
    '',
    '-- 3b) 회사 공용 회의실(room_code, 2026-10-21 SHARED-ROOMS). 사람마다 두던 cal_room 은 없어졌다',
    'DELETE FROM room_code;',
    'INSERT INTO room_code (room_id, name, sort_order) VALUES',
    D.ROOMS.map((r, i) => `  (${i + 1}, ${sqlStr(r)}, ${(i + 1) * 10})`).join(',\n') + ';',
    '',
    '-- 4) 캘린더 데이터',
    'SET @now := UTC_TIMESTAMP(3);',
  );

  const expect = {};
  for (const { person, cal } of people) {
    const u = uvar(person.who);
    const no = cal.catNo;
    push('', `-- ${person.who}`);
    push('INSERT INTO cal_category (user_id, cat_no, uid, source, name, color, description, project_uid, sort_order, created_at, updated_at) VALUES',
      cal.cats.map((c) => `  (${u}, ${c.no}, ${sqlStr(c.uid)}, '${c.source}', ${sqlStr(c.name)}, ${sqlStr(c.color)}, ${sqlStr(c.desc)}, ${lit(c.projectUid)}, ${c.sort}, @now, @now)`).join(',\n') + ';');
    push('INSERT INTO cal_entry (user_id, entry_no, uid, cat_no, entry_date, end_date, all_day, start_time, end_time, title, memo, location, remind, recur_freq, recur_interval, recur_until, recur_count, sort_order, created_at, updated_at) VALUES',
      cal.entries.map((e) => `  (${u}, ${e.no}, ${sqlStr(e.uid)}, ${no(e.cat)}, ${sqlStr(e.date)}, ${lit(e.endDate)}, ${e.allDay}, ${lit(e.start)}, ${lit(e.end)}, ${sqlStr(e.title)}, ${sqlStr(e.memo)}, ${sqlStr(e.location)}, 0, `
        + (e.recur ? `'${e.recur.freq}', ${e.recur.interval}, NULL, ${e.recur.count}` : 'NULL, NULL, NULL, NULL')
        + `, ${e.sort}, @now, @now)`).join(',\n') + ';');
    push('INSERT INTO cal_todo (user_id, todo_no, uid, cat_no, todo_text, note, due, end_date, done, prio, completed_at, sort_order, created_at, updated_at) VALUES',
      cal.todos.map((t) => `  (${u}, ${t.no}, ${sqlStr(t.uid)}, ${no(t.cat)}, ${sqlStr(t.text)}, ${sqlStr(t.note)}, ${lit(t.due)}, ${lit(t.endDate)}, ${t.done}, '${t.prio}', ${lit(t.completedAt)}, ${t.sort}, @now, @now)`).join(',\n') + ';');
    const notes = cal.todos.flatMap((t) => t.notes.map(([d, s]) => `  (${u}, ${t.no}, ${sqlStr(d)}, ${sqlStr(s)})`));
    if (notes.length) push('INSERT INTO cal_todo_day_note (user_id, todo_no, note_date, note_text) VALUES', notes.join(',\n') + ';');
    if (cal.hours.length) {
      push('INSERT INTO cal_task_hours (user_id, work_date, cat_no, hours, updated_at) VALUES',
        cal.hours.map((h) => `  (${u}, ${sqlStr(h.date)}, ${no(h.cat)}, ${h.hours.toFixed(2)}, @now)`).join(',\n') + ';');
    }
    expect[person.who] = { cats: cal.cats.length, entries: cal.entries.length, todos: cal.todos.length, notes: notes.length, hours: cal.hours.length };
  }

  // 4b) 과제 공용 일정(구조 16, 20), 근태와 보낸 보고(녹화 계정만). 이름은 SQL 안에서 읽는다.
  const pe = projectEvents(baseDate, projects);
  // 글쓴이 이름은 변수로 먼저 읽어 둔다(INSERT 문 안에서 app_user 를 읽지 않는다)
  const nameOf = (who) => `@pn_${who}`;
  push('', '-- 글쓴이 이름(사람은 이미 가상 이름으로 바뀐 뒤다. 녹화 계정은 그대로)', ...D.DEMO_PEOPLE.map((p) => `SET @pn_${p.who} := (SELECT name FROM app_user WHERE user_id = ${uvar(p.who)});`),
    '', '-- 과제 공용 일정', 'INSERT INTO cal_project_event (event_id, uid, project_id, title, start_date, end_date, start_time, end_time, location, memo, recur_freq, row_version, is_deleted, created_by_name, updated_by_name, created_at, updated_at, deleted_at) VALUES',
    pe.rows.map((e) => `  (${e.id}, ${sqlStr(e.uid)}, ${e.projectId}, ${sqlStr(e.f.title)}, ${sqlStr(e.f.startDate)}, ${lit(e.f.endDate)}, ${lit(e.f.startTime)}, ${lit(e.f.endTime)}, ${sqlStr(e.f.location)}, ${sqlStr(e.f.memo)}, ${lit(e.f.recurFreq)}, ${e.version}, ${e.deleted}, ${nameOf(e.who)}, ${nameOf(e.who)}, ${sqlStr(e.createdAt)}, ${sqlStr(e.updatedAt)}, ${lit(e.deletedAt)})`).join(',\n') + ';');
  if (pe.excepts.length) push('INSERT INTO cal_project_event_except (event_id, except_date) VALUES', pe.excepts.map((x) => `  (${x.eventId}, ${sqlStr(x.date)})`).join(',\n') + ';');
  push('INSERT INTO cal_project_change (project_id, event_id, mutation_uid, action, actor_name, title_snapshot, before_json, after_json, changed_at) VALUES',
    pe.changes.map((c) => `  (${c.projectId}, ${c.eventId}, ${sqlStr(c.uid)}, '${c.action}', ${nameOf(c.who)}, ${sqlStr(c.title)}, ${c.before ? sqlStr(JSON.stringify(c.before)) : 'NULL'}, ${c.after ? sqlStr(JSON.stringify(c.after)) : 'NULL'}, ${sqlStr(c.at)})`).join(',\n') + ';');
  const meCal = people.find((x) => x.person.who === 'me').cal;
  const ar = attendanceReports(meCal, baseDate);
  const um = uvar('me');
  push('', '-- 근태와 보낸 보고(녹화 계정)');
  push('INSERT INTO cal_attendance (user_id, work_date, status, overtime, updated_at) VALUES',
    ar.attendRows.map((a) => `  (${um}, ${sqlStr(a.date)}, ${sqlStr(a.status)}, ${a.overtime}, @now)`).join(',\n') + ';');
  push('INSERT INTO cal_report_daily (user_id, work_date, status, overtime, content, sent_at) VALUES',
    ar.daily.map((r) => `  (${um}, ${sqlStr(r.date)}, ${sqlStr(r.status)}, ${r.overtime}, ${sqlMulti(r.content)}, ${sqlStr(r.sentAt)})`).join(',\n') + ';');
  push('INSERT INTO cal_report_hours (user_id, work_date, line_no, task_name, cat_no, hours) VALUES',
    ar.daily.flatMap((r) => r.lines.map((l, i) => `  (${um}, ${sqlStr(r.date)}, ${i}, ${sqlStr(l.name)}, ${l.catNo}, ${l.hours.toFixed(2)})`)).join(',\n') + ';');
  if (ar.weekly.length) {
    push('INSERT INTO cal_report_weekly (user_id, period_start, period_end, subject, content, endwork, plan, meeting, composed_at) VALUES',
      ar.weekly.map((w) => `  (${um}, ${sqlStr(w.start)}, ${sqlStr(w.end)}, ${sqlStr(w.subject)}, ${sqlMulti(w.content)}, ${sqlMulti(w.endwork)}, ${sqlMulti(w.plan)}, ${sqlMulti(w.meeting)}, ${sqlStr(w.composedAt)})`).join(',\n') + ';');
    push('INSERT INTO cal_report_weekly_hours (user_id, period_start, line_no, task_name, project_uid, hours) VALUES',
      ar.weekly.flatMap((w) => w.hours.map((h, i) => `  (${um}, ${sqlStr(w.start)}, ${i}, ${sqlStr(h.name)}, ${lit(h.projectUid)}, ${h.hours.toFixed(2)})`)).join(',\n') + ';');
  }
  const extra = { events: pe.rows.length, changes: pe.changes.length, attend: ar.attendRows.length, daily: ar.daily.length, weekly: ar.weekly.length };

  const tot = (k) => Object.values(expect).reduce((a, x) => a + x[k], 0);
  push(
    '',
    '-- 5) 사용자별 리비전: 모든 사람에게 행이 있고, 있던 행은 하나 올린다(단조 증가. 낡은 화면이 바뀐 것을 알게)',
    'INSERT INTO cal_user_rev (user_id, rev) SELECT user_id, 1 FROM app_user ON DUPLICATE KEY UPDATE rev = cal_user_rev.rev + 1;',
    '',
    '-- 6) 검증: 하나라도 어긋나면 COMMIT 전에 멈춘다(트랜잭션은 되돌려진다)',
    guard('(SELECT COUNT(*) FROM app_user) = @n_user', '사람 수가 바뀌었다'),
    guard('(SELECT COUNT(*) FROM app_user WHERE user_id = @u_me AND HEX(name) = @my_name_hex AND HEX(login_id) = @my_login_hex) = 1', '녹화 계정의 이름이나 login_id 가 바뀌었다'),
    guard('(SELECT COUNT(*) FROM app_user WHERE user_id <> @u_me AND CAST(name AS BINARY) = UNHEX(@my_name_hex)) = 0', '녹화 계정과 같은 이름의 다른 사람이 남았다'),
    guard('(SELECT COUNT(*) FROM app_user u WHERE u.user_id <> @u_me AND NOT EXISTS (SELECT 1 FROM _demo_names n WHERE CAST(n.name AS BINARY) = CAST(u.name AS BINARY) AND CAST(n.login_id AS BINARY) = CAST(u.login_id AS BINARY))) = 0', '가상 명단에 없는 이름이 남았다'),
    "SET @fp_user2 := (SELECT SHA2(GROUP_CONCAT(CONCAT_WS(',', user_id, IFNULL(title_id,'-'), IFNULL(org_id,'-'), view_scope, edit_role, is_active, IFNULL(sort_order,'-')) ORDER BY user_id SEPARATOR ';'), 256) FROM app_user);",
    "SET @fp_org2 := (SELECT SHA2(IFNULL(GROUP_CONCAT(CONCAT_WS(',', org_id, HEX(name), IFNULL(parent_id,'-'), sort_order, is_active) ORDER BY org_id SEPARATOR ';'),''), 256) FROM org_unit);",
    "SET @fp_title2 := (SELECT SHA2(IFNULL(GROUP_CONCAT(CONCAT_WS(',', title_id, HEX(name), sort_order, is_active) ORDER BY title_id SEPARATOR ';'),''), 256) FROM title_code);",
    guard('@fp_user2 = @fp_user', '사람의 소속, 직급, 권한, 순서가 바뀌었다'),
    guard('@fp_org2 = @fp_org AND @fp_title2 = @fp_title', '조직이나 직급 표가 바뀌었다'),
    guard(`(SELECT COUNT(*) FROM customer) = ${D.CUSTOMERS.length} AND (SELECT COUNT(*) FROM customer WHERE name NOT LIKE '(예시)%') = 0`, '발주처가 데모 목록과 다르다'),
    guard(`(SELECT COUNT(*) FROM project) = ${projects.length} AND (SELECT COUNT(*) FROM project WHERE common_name NOT LIKE '(예시)%' OR project_name NOT LIKE '(예시)%') = 0`, '공식 과제가 데모 목록과 다르다'),
    guard(`(SELECT COUNT(*) FROM cal_category) = ${tot('cats')} AND (SELECT COUNT(*) FROM cal_entry) = ${tot('entries')}`, '과제나 일정 행 수가 기대와 다르다'),
    guard(`(SELECT COUNT(*) FROM cal_todo) = ${tot('todos')} AND (SELECT COUNT(*) FROM cal_task_hours) = ${tot('hours')}`, '할 일이나 과제별 시간 행 수가 기대와 다르다'),
    guard("(SELECT COUNT(*) FROM cal_category c LEFT JOIN project p ON p.uid = c.project_uid WHERE c.source = 'db' AND p.id IS NULL) = 0", '공식 과제를 가리키지 않는 내 과제가 있다'),
    guard("(SELECT COUNT(*) FROM cal_category WHERE source = 'local' AND name IN ('휴가','기타')) = 8", '기본 과제(휴가, 기타)가 네 사람에게 하나씩 있지 않다'),
    guard(`(SELECT COUNT(*) FROM cal_project_event) = ${extra.events} AND (SELECT COUNT(*) FROM cal_project_change) = ${extra.changes}`, '과제 공용 일정 행 수가 기대와 다르다'),
    guard(`(SELECT COUNT(*) FROM cal_attendance) = ${extra.attend} AND (SELECT COUNT(*) FROM cal_report_daily) = ${extra.daily} AND (SELECT COUNT(*) FROM cal_report_weekly) = ${extra.weekly}`, '근태나 보낸 보고 행 수가 기대와 다르다'),
    guard('(SELECT COUNT(*) FROM app_user u LEFT JOIN cal_user_rev r ON r.user_id = u.user_id WHERE r.user_id IS NULL) = 0', 'cal_user_rev 행이 없는 사람이 있다'),
    guard(`(SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version') <=> '${SCHEMA_VERSION}'`, '구조 번호가 바뀌었다'),
    'COMMIT;',
    "SELECT 'demo:committed';",
    'DROP TEMPORARY TABLE IF EXISTS _demo_rank;',
    'DROP TEMPORARY TABLE IF EXISTS _demo_names;',
    '',
    '-- 7) 요약(demo-db.ps1 이 읽는다)',
    "SELECT CONCAT('demo:me_user_id=', @u_me);",
    "SELECT CONCAT('demo:peer_user_ids=', @u_c1, ',', @u_c2, ',', @u_c3);",
    "SELECT CONCAT('demo:renamed=', @n_renamed);",
    "SELECT CONCAT('demo:users=', @n_user);",
    `SELECT 'demo:projects=${projects.length}';`,
    `SELECT 'demo:customers=${D.CUSTOMERS.length}';`,
    ...D.DEMO_PEOPLE.map((p) => { const x = expect[p.who]; return `SELECT 'demo:cal_${p.who}=cats ${x.cats}, entries ${x.entries}, todos ${x.todos}, hours ${x.hours}';`; }),
    `SELECT 'demo:project_events=${extra.events}, changes ${extra.changes}, attendance ${extra.attend}, daily ${extra.daily}, weekly ${extra.weekly}';`,
    "SELECT CONCAT('demo:my_view_scope=', view_scope) FROM app_user WHERE user_id = @u_me;",
    '',
  );
  return L.join('\n');
}

// ── 명령줄 ─────────────────────────────────────────────────────────────
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseArgs(argv) {
  const a = { myLogin: '', baseDate: '', out: '' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--my-login') { a.myLogin = v ?? ''; i++; }
    else if (k === '--base-date') { a.baseDate = v ?? ''; i++; }
    else if (k === '--out') { a.out = v ?? ''; i++; }
    else throw new Error('모르는 인자: ' + k);
  }
  if (!a.baseDate) a.baseDate = todayLocal();
  return a;
}

const isMain = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  try {
    const a = parseArgs(process.argv.slice(2));
    const sql = buildDemoSql({ myLogin: a.myLogin, baseDate: a.baseDate });
    if (a.out) writeFileSync(a.out, sql, 'utf8');
    else process.stdout.write(sql);
  } catch (e) {
    process.stderr.write('build-demo-sql: ' + e.message + '\n');
    process.exit(1);
  }
}
