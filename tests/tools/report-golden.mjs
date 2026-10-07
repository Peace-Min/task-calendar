#!/usr/bin/env node
/**
 * report-golden.mjs: 보고서 출력 골든(docs/REPORT-INCLUDE-STATE.md A1 '아무것도 바꾸지 않으면 보고서가 지금과 바이트 단위로 같다').
 *
 *   node tests/tools/report-golden.mjs --html <prototype.html 경로> --out <결과 json 경로>
 *
 *   주어진 HTML 을 jsdom 위젯 모드(가짜 호스트)로 부팅하고 고정 픽스처를 __applyState 로 넣은 뒤,
 *   일간(2026-10-07) · 주간(2026-10-05~10-11) · 기간 취합(2026-10-01~10-31) 각각에서
 *   #rptSkipEmpty 켬/끔 × #rptWithDesc 켬/끔 네 조합으로 체크박스를 직접 바꾸고 buildReport() 를 부른 다음
 *     rows       collectReportData(from, to, rptSources()).rows (JSON, hourKeys 제외)
 *     text       buildReportText()
 *     hours      reportDailyHours(rows, from)
 *     weekly     buildWeeklyFields(from, to)
 *     sendDaily  일간 모드에서 #btnRptSend 를 눌러(확인창 #cfOk 통과) 잡은 netcusSubmit 요청(다른 모드는 null)
 *     sendWeekly 주간 모드에서 #btnRptSend 를 눌러 잡은 netcusWeekSubmit 요청(다른 모드는 null)
 *   를 하나의 JSON 으로 쓴다. 키: <F1|F2>.<keys|include>.<daily|weekly|custom>.<skip0|skip1>.<desc0|desc1>.<항목>
 *     F1 = 과제 4개(하나는 이름 '기타') + 미분류 항목 / F2 = '기타' 과제 없음 + 미분류 일정, 할 일, 커밋 + __uncat__ 공수
 *     keys = 과제에 reportGroup 키가 전혀 없는 판(옛 데이터) / include = 전부 'include' 인 판
 *   옛 HTML(키를 모름)과 새 HTML 에 각각 돌려 두 JSON 을 그대로 맞대면 A1 을 증명한다(기준 커밋 비교).
 *   날짜는 #rptFrom/#rptTo 에 직접 넣는다(오늘 날짜에 기대지 않는다).
 *
 *   종료코드: 0 완료 · 1 수집 중 기대한 출력이 없었다(전송 요청을 못 잡음 등) · 2 판정 없음(인자, jsdom, 부팅 실패)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--html') opt.html = args[++i];
  else if (args[i] === '--out') opt.out = args[++i];
  else if (args[i] === '--help' || args[i] === '-h') { console.log('사용법: node tests/tools/report-golden.mjs --html <경로> --out <json>'); process.exit(0); }
  else { console.error('알 수 없는 인자: ' + args[i]); process.exit(2); }
}
if (!opt.html || !opt.out) { console.error('판정 없음: --html 과 --out 이 필요합니다'); process.exit(2); }

let JSDOM = null, VirtualConsole = null;
try { ({ JSDOM, VirtualConsole } = await import('jsdom')); } catch (e) { console.error('판정 없음: jsdom 을 불러오지 못했다(tests/node_modules): ' + e.message); process.exit(2); }

let html;
try { html = readFileSync(resolve(opt.html), 'utf8'); } catch (e) { console.error('판정 없음: HTML 을 읽지 못했다: ' + e.message); process.exit(2); }

/* ── 픽스처 ─────────────────────────────────────────────────────────── */
const CA = '2026-09-01T00:00:00Z';
const META = { schemaVersion: '13', expectedSchema: '13', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
const CAT = (id, name, color) => ({ id, name, color, desc: '', gitRepo: '', svnRepo: '', usesRepo: false, createdAt: CA });
const ENT = (id, date, title, categoryId, extra) => Object.assign({ id, date, title, categoryId, allDay: true, startTime: '', endTime: '',
  memo: '', location: '', source: '', commits: [], hours: null, remind: null, endDate: '', recur: null, recurExcept: [], createdAt: CA, updatedAt: CA }, extra || {});
const TODO = (id, text, categoryId, due, extra) => Object.assign({ id, text, done: false, categoryId, due, endDate: '', prio: 'normal', completedAt: '', note: '', dayNotes: {}, createdAt: CA, updatedAt: CA }, extra || {});
const COMMIT = (n, subject, body) => ({ hash: String(n).repeat(40).slice(0, 40), short: String(n).repeat(7).slice(0, 7), time: '10:0' + (n % 10), subject, body: body || '' });

function fixture(shape) {
  const f1 = shape === 'F1';
  const categories = [CAT('c-1', '알파 개발', '#3e5be0'), CAT('c-2', '베타 점검', '#0f9d58')]
    .concat(f1 ? [CAT('c-g', '기타', '#5b6b7d')] : [])
    .concat([CAT('c-3', '감마 지원', '#e8710a')]);
  const entries = [
    ENT('e-1', '2026-10-07', '알파 설계 검토', 'c-1', { memo: '- 화면 흐름 정리\n- 예외 처리 확인' }),
    ENT('e-2', '2026-10-06', '베타 정기 점검', 'c-2', { memo: '점검표 작성' }),
    ENT('e-3', '2026-10-08', '감마 문의 대응', 'c-3'),
    ENT('e-4', '2026-10-07', '알파 작업일지', 'c-1', { source: 'git', commits: [COMMIT(1, '알파: 로그인 수정', '본문 첫 줄\n둘째 줄'), COMMIT(2, '알파: 테스트 추가')] }),
    ENT('e-5', '2026-10-07', '미분류 회의', null, { memo: '- 회의록 공유' }),
    ENT('e-6', '2026-10-09', '미분류 작업일지', null, { source: 'git', commits: [COMMIT(3, '미분류 커밋 하나', '')] }),
    ENT('e-7', '2026-10-20', '월말 감마 정리', 'c-3', { memo: '정리 메모' }),
    ENT('e-8', '2026-10-02', '알파 반복 회의', 'c-1', { recur: { freq: 'weekly', interval: 1, until: '', count: 0 } }),
  ].concat(f1 ? [ENT('e-g', '2026-10-07', '기타 잡무', 'c-g', { memo: '서류 정리' })] : []);
  const todos = [
    TODO('t-1', '알파 리뷰 반영', 'c-1', '2026-10-07', { note: '리뷰 3건' }),
    TODO('t-2', '미분류 할 일', null, '2026-10-07', { note: '메모 있음' }),
    TODO('t-3', '베타 기간 작업', 'c-2', '2026-10-05', { endDate: '2026-10-09', dayNotes: { '2026-10-06': '1차 점검', '2026-10-08': '2차 점검' } }),
  ];
  const taskHours = {
    '2026-10-05': { 'c-2': 3 },
    '2026-10-07': Object.assign({ 'c-1': 4.5, 'c-3': 0.5 }, f1 ? { 'c-g': 1.25 } : { '__uncat__': 1.5 }),
    '2026-10-08': { 'c-3': 2 },
    '2026-10-09': f1 ? { 'c-1': 1 } : { 'c-1': 1, '__uncat__': 0.75 },
    '2026-10-20': { 'c-3': 6 },
  };
  const attendance = { '2026-10-07': { status: '1', overtime: 1 } };
  return { categories, entries, todos, rooms: ['201호'], taskHours, attendance, gitAuthor: '작성자', svnAuthor: '' };
}
function variant(data, kind) {
  const d = JSON.parse(JSON.stringify(data));
  for (const c of d.categories) { if (kind === 'include') c.reportGroup = 'include'; else delete c.reportGroup; }
  return d;
}

/* ── 부팅(가짜 호스트, 위젯 모드) ───────────────────────────────────── */
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
function boot() {
  const log = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/',
    virtualConsole: VirtualConsole ? new VirtualConsole() : undefined,
    beforeParse(win) {
      win.chrome = { webview: {
        postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} log.push({ post: o && o.cmd, msg: o }); },
        addEventListener() {}, removeEventListener() {},
      } };
      if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
      win.scrollTo = () => {};
      win.setTimeout = () => 0; win.clearTimeout = () => {};
      win.matchMedia = (q) => ({ matches: /prefers-reduced-motion:\s*reduce/.test(String(q)), media: String(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    },
  });
  const w = dom.window;
  w.__fakeReply = (cmd) => { log.push({ req: cmd }); return Promise.resolve(cmd === 'saveState' ? { ok: true } : { ok: false, error: 'no handler' }); };
  w.eval('hostRequest = function(cmd, params){ return window.__fakeReply(cmd, params || {}); };');
  const sess = log.find((x) => x.post === 'userSessionGet');
  if (sess) w.eval('__hostReply(' + JSON.stringify(sess.msg.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'hjlee', name: '이현진' } }) + ')');
  return { w, log, ev: (c) => w.eval(c), evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')), close: () => { try { w.close(); } catch (_) {} } };
}

const MODES = [['daily', '2026-10-07', '2026-10-07'], ['weekly', '2026-10-05', '2026-10-11'], ['custom', '2026-10-01', '2026-10-31']];
let problems = 0;
const out = {};

async function collect(shape, kind) {
  const B = boot();
  try {
    B.ev('__applyState(' + JSON.stringify(JSON.stringify(variant(fixture(shape), kind))) + ',' + JSON.stringify(META) + ')');
    await settle();
    B.ev('openReport();');
    await settle();
    const res = {};
    for (const [mode, from, to] of MODES) {
      res[mode] = {};
      for (const skipOn of [0, 1]) for (const descOn of [0, 1]) {
        B.ev(`setReportMode(${JSON.stringify(mode)});`);
        B.ev(`$('#rptSrcEvent').checked=true; $('#rptSrcTodo').checked=true; $('#rptSrcGit').checked=true;` +
             `$('#rptSkipEmpty').checked=${skipOn ? 'true' : 'false'}; $('#rptWithDesc').checked=${descOn ? 'true' : 'false'};` +
             `$('#rptFrom').value=${JSON.stringify(from)}; $('#rptTo').value=${JSON.stringify(to)}; buildReport();`);
        await settle();
        const F = JSON.stringify(from), T = JSON.stringify(to);
        const rows = B.evJSON(`collectReportData(${F}, ${T}, rptSources()).rows.map(function(r){ var o = {}; Object.keys(r).forEach(function(k){ if(k !== 'hourKeys') o[k] = r[k]; }); return o; })`);
        const cell = {
          rows,
          text: B.ev('buildReportText()'),
          hours: B.evJSON(`reportDailyHours(collectReportData(${F}, ${T}, rptSources()).rows, ${F})`),
          weekly: B.evJSON(`buildWeeklyFields(${F}, ${T})`),
          sendDaily: null,
          sendWeekly: null,
        };
        if (mode === 'daily' || mode === 'weekly') {
          const before = B.log.length;
          B.ev('buildReport();'); await settle();   // 직전 전송이 잠근 버튼을 푼다
          B.ev("$('#btnRptSend').click();"); await settle();
          if (B.ev("!$('#confirmModal').classList.contains('hidden')")) { B.ev("$('#cfOk').click();"); await settle(); }
          const want = mode === 'daily' ? 'netcusSubmit' : 'netcusWeekSubmit';
          const got = B.log.slice(before).filter((x) => x.post === want).map((x) => x.msg);
          if (got.length !== 1) { problems++; console.error(`FAIL ${shape}.${kind}.${mode}.skip${skipOn}.desc${descOn}: ${want} 요청을 ${got.length}건 잡았다(1건이어야 한다)`); }
          cell[mode === 'daily' ? 'sendDaily' : 'sendWeekly'] = got[0] || null;
        }
        res[mode]['skip' + skipOn] = res[mode]['skip' + skipOn] || {};
        res[mode]['skip' + skipOn]['desc' + descOn] = cell;
      }
    }
    return res;
  } finally { B.close(); }
}

try {
  for (const shape of ['F1', 'F2']) {
    out[shape] = {};
    for (const kind of ['keys', 'include']) {
      out[shape][kind] = await collect(shape, kind);
      console.log(`PASS ${shape}.${kind}: 일간, 주간, 기간 취합 x skip 0/1 x desc 0/1 수집`);
    }
  }
} catch (e) {
  console.error('판정 없음: 수집 중 예외: ' + (e && e.stack ? e.stack : e));
  process.exit(2);
}
writeFileSync(resolve(opt.out), JSON.stringify(out, null, 1) + '\n', 'utf8');
console.log(`썼다: ${resolve(opt.out)} (문제 ${problems}건)`);
process.exit(problems ? 1 : 0);
