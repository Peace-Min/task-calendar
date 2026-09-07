/*  app-context.test.mjs (계약 190건) 변이 감사.
 *
 *  왜: 이 파일은 jsdom 으로 **실제 앱을 부팅해 진짜 함수를 호출**한다(toXML/fromXML 왕복 ·
 *  collectReportData · expandOccurrences …). 이 저장소에서 가장 값진 구역인데 **변이 시험이 0** 이다.
 *  앞선 감사에서 내가 계약 수를 4로 잘못 세어(들여쓴 test() 를 안 셌다) "규모 작음" 으로 빠뜨렸다.
 *
 *  방법: 각 변이를 **자기 사본**에서 돌린다(공유 소스를 안 건드리니 병렬 가능).
 *  ★ 판정 불가는 통과가 아니다 — 앵커를 못 찾거나 러너가 요약을 못 내면 그렇게 적는다.
 *  ★ 접미사 변이(foo → foo_X) 금지 — 부분문자열 검사에 그대로 걸린다.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

//  ★ 저장소 경로 — 다른 곳에서 쓰려면 여기만 고친다.
const R = 'C:/Users/CEO/Desktop/console/task-calendar-db/';
const TMP = 'C:/Users/CEO/AppData/Local/Temp/appctx-';
const H = 'task-calendar-prototype.html';
const ONLY = process.argv[2] || '';

//  [이름, 찾을것, 바꿀것, 무엇이 깨지는가]
const MUT = [
  ['A1 toXML 이 memo 를 안 쓴다',
   "const m = doc.createElement('memo');  m.textContent = e.memo || '';",
   "const m = doc.createElement('memo');  m.textContent = '';",
   '내보내기에서 메모가 통째로 사라진다 — 왕복이 깨진다'],

  ['A2 toXML 이 location 을 안 쓴다',
   "if(e.location) el.setAttribute('location', e.location);",
   "if(false) el.setAttribute('location', e.location);",
   '장소가 내보내기에서 빠진다'],

  ['A3 toXML 이 remind 를 안 쓴다',
   "if(e.remind != null) el.setAttribute('remind', String(e.remind));",
   "if(false) el.setAttribute('remind', String(e.remind));",
   '일정별 알림 시점이 저장 안 된다 — 재시작하면 기본으로 되돌아간다'],

  ['A4 mergeGitSvnCommits 의 hash 중복제거 제거',
   'if(h){ if(seen.has(h)) continue; seen.add(h); }',
   'if(h){ }',
   '같은 커밋이 git·svn 양쪽에서 와서 보고서에 두 번 실린다'],

  ['A5 remindMinsFor 의 기본 사다리 변조',
   'if(r == null) return REMIND_DEFAULT.slice();',
   'if(r == null) return [];',
   '알림 미설정 일정이 아무 알림도 안 준다(기본 사다리 소실)'],

  ['A6 remindMinsFor 가 0(알림 없음)을 무시',
   'if(r === 0) return null;',
   'if(false) return null;',
   "사용자가 '알림 없음' 으로 꺼 둔 일정이 다시 울린다"],

  //  ── 2차 표본: 파일이 스스로 '최고 가치' 라 부르는 구역 ──────────────
  ['A7  expandOccurrences 가 예외일(recurExcept)을 무시',
   'if((e.recurExcept||[]).includes(os)) return;',
   'if(false) return;',
   '삭제한 반복 날짜가 보고서·달력에 되살아난다'],

  //  ★ until·count 검사는 주간·월간 두 분기에 같은 줄로 있다. 앞뒤 줄을 붙여 **주간만** 겨냥한다
  //    (유일하지 않으면 이 스크립트가 판정 불가로 거부한다 — 그게 맞는 동작이다).
  ['A8  expandOccurrences(주간) 이 반복 종료일(until)을 무시',
   'const os = addDays(e.date, 7*iv*k);\n      if(r.until && os > r.until) break;',
   'const os = addDays(e.date, 7*iv*k);\n      if(false) break;',
   '끝난 반복 일정이 영원히 이어진다'],

  ['A9  expandOccurrences(주간) 이 반복 횟수(count)를 무시',
   'if(r.count && k >= r.count) break;\n      const os = addDays',
   'if(false) break;\n      const os = addDays',
   'N회 반복이 무한이 된다'],

  ['A10 collectReportData 의 skipEmpty 무력화',
   'const skipEmpty = !!src.skipEmpty;',
   'const skipEmpty = false;',
   '내용 없는 과제·할일이 보고서에 빈 줄로 실린다'],

  ['A11 fromXML 이 memo 를 안 읽는다',
   "memo: txt(e,'memo'),",
   "memo: '',",
   '가져오기에서 메모가 통째로 사라진다'],

  ['A12 fromXML 이 remind 를 안 읽는다',
   "remind: normRemind(e.getAttribute('remind')),",
   'remind: null,',
   '가져오면 모든 일정의 알림 설정이 기본으로 리셋된다'],
];

const run = (dir) => {
  const r = spawnSync('node', [dir + '/tests/run-tests.mjs'], { encoding: 'utf8', timeout: 900000, cwd: dir });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = /(\d+) pass \/ (\d+) fail/.exec(out);
  if (!m) return { ok: false, raw: out.slice(-300) };
  return { ok: true, pass: +m[1], fail: +m[2],
           names: [...out.matchAll(/  ✗ ([^\n]{0,72})/g)].map((x) => x[1].trim()) };
};

const mkCopy = (tag) => {
  const d = TMP + tag;
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d + '/widget', { recursive: true });
  cpSync(R + 'tests', d + '/tests', { recursive: true });
  cpSync(R + 'db', d + '/db', { recursive: true });
  cpSync(R + H, d + '/' + H);
  //  ★ 파일 목록을 손으로 적지 말 것 — Reminders.cs 를 빠뜨려 기준선이 ENOENT 로 죽었다(실측).
  //    최상위 파일을 **전부** 가져온다(bin/obj 는 디렉터리라 안 딸려온다).
  for (const e of readdirSync(R + 'widget', { withFileTypes: true }))
    if (e.isFile()) cpSync(R + 'widget/' + e.name, d + '/widget/' + e.name);
  return d;
};

const list = ONLY ? MUT.filter((m) => m[0].includes(ONLY)) : MUT;

//  기준선 — 사본에서
console.log('app-context(190건) 변이 감사 — 사본 격리\n');
const base0 = mkCopy('base');
const base = run(base0);
rmSync(base0, { recursive: true, force: true });
if (!base.ok) { console.error('[중단] 기준선 요약을 못 읽었다\n' + base.raw); process.exit(2); }
console.log(`기준선: ${base.pass} pass / ${base.fail} fail`);
if (base.fail !== 0) { console.error('[중단] 기준선이 빨간불 — 이 뒤 측정은 무의미하다'); process.exit(2); }

//  ★ jsdom 이 없으면 app-context 는 skip 된다 = 이 감사 전체가 무의미하다. 먼저 확인.
const hasJsdom = spawnSync('node', ['-e', "import('jsdom').then(()=>console.log('OK'),()=>console.log('NO'))"],
  { encoding: 'utf8', cwd: R + 'tests', timeout: 60000 });
if (!/OK/.test(hasJsdom.stdout || '')) {
  console.error('[중단] jsdom 이 없다 — app-context 는 skip 되고, 이 감사는 아무것도 재지 못한다.');
  process.exit(2);
}
console.log('jsdom 있음 — app-context 가 실제로 돈다\n');

let caught = 0, missed = 0, bad = 0;
const results = await Promise.all(list.map(async ([name, find, repl, why], i) => {
  const d = mkCopy('m' + i);
  try {
    const p = d + '/' + H;
    const s = readFileSync(p, 'utf8');
    if (!s.includes(find)) return { name, why, verdict: 'bad', note: '앵커 없음' };
    if (s.indexOf(find) !== s.lastIndexOf(find)) return { name, why, verdict: 'bad', note: '앵커가 여러 곳' };
    writeFileSync(p, s.split(find).join(repl), 'utf8');
    const r = run(d);
    if (!r.ok) return { name, why, verdict: 'bad', note: '요약을 못 읽었다: ' + r.raw.slice(0, 120) };
    return { name, why, verdict: r.fail > 0 ? 'caught' : 'missed', pass: r.pass, fail: r.fail, names: r.names };
  } finally { rmSync(d, { recursive: true, force: true }); }
}));

for (const x of results) {
  if (x.verdict === 'caught') { caught++;
    console.log(`  ✓ 잡음   ${x.name}`);
    console.log(`      ${x.pass} pass / ${x.fail} fail · 운 계약: ${(x.names || []).slice(0, 2).join(' | ').slice(0, 80)}`);
  } else if (x.verdict === 'missed') { missed++;
    console.log(`  ✗ 못 잡음 ${x.name}`);
    console.log(`      ${x.pass} pass / ${x.fail} fail ← 침묵 · 실제 결함: ${x.why}`);
  } else { bad++;
    console.log(`  ? ${x.name}  — 판정 불가: ${x.note}`);
  }
}
console.log(`\n잡음 ${caught} · 못 잡음 ${missed} · 판정 불가 ${bad}`);
process.exit(missed || bad ? 1 : 0);
