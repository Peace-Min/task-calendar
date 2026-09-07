// schema.json(information_schema 덤프) → db/table-design-report.html
// 문장 규칙: humanize-korean taxonomy 를 손으로 적용 — 번역투(A)·기계적 서식(C)·상투구(D)·장식(J)을 피하고,
// 서술체(한다/이다)로 통일한다. 수치·식별자는 그대로 둔다.
import { readFileSync, writeFileSync } from 'node:fs';
//   사용: node tools/schema-report/build-schema-html.mjs <schema.json> <out.html>
const IN = process.argv[2], OUT = process.argv[3];
if(!IN||!OUT){ console.error('사용: node build-schema-html.mjs <schema.json> <out.html>'); process.exit(2); }
const S = JSON.parse(readFileSync(IN, 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const code = (s) => `<code>${esc(s)}</code>`;
const num = (n) => Number(n).toLocaleString('ko-KR');
const today = new Date(S.meta.dumpedAt);
const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')} ${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`;

// 두 트랙
const PROJECT = ['project', 'customer', 'section_code', 'status_code', 'app_user', 'org_unit', 'title_code'];
const byName = Object.fromEntries(S.tables.map((t) => [t.name, t]));
const calendar = S.tables.map((t) => t.name).filter((n) => !PROJECT.includes(n));

// 주석이 비어 있는 표의 목적(FK 로 확인한 사실만 적는다)
const PURPOSE_FALLBACK = {
  section_code: '과제 구분 코드값. name 이 자연키이고 project.section 이 참조한다. 이름을 바꾸면 project 가 따라오고(ON UPDATE CASCADE), 참조 중이면 지울 수 없다(ON DELETE RESTRICT).',
  status_code: '과제 상태 코드값. name 이 자연키이고 project.status 가 참조한다. 참조 동작은 section_code 와 같다.',
};
const purpose = (t) => t.comment || PURPOSE_FALLBACK[t.name] || '';

// 권한 행렬
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const grantMap = {};
for (const g of S.meta.grants) {
  const m = /GRANT (.+?) ON `taskmgr`\.`([a-z_]+)`/.exec(g);
  if (!m) continue;
  grantMap[m[2]] = m[1].split(',').map((x) => x.trim());
}

// 참조 그래프(자식 → 부모)
const edges = [];
for (const t of S.tables) for (const fk of t.fks) edges.push({ from: t.name, to: fk.ref, cols: fk.cols, refCols: fk.refCols, upd: fk.upd, del: fk.del, name: fk.name });
const parentsOf = (n) => edges.filter((e) => e.from === n);
const childrenOf = (n) => edges.filter((e) => e.to === n);

// 8/24 이후 마이그레이션(파일명이 곧 기록)
const MIGRATIONS = [
  ['2026-08-24', 'migrate-2026-08-24-user-id.sql', 'app_user 에 대리키 user_id 를 두고 login_id 는 UNIQUE 로 내렸다. cal_* 의 소유자 키가 전부 user_id 로 바뀌었다.'],
  ['2026-08-24', 'migrate-2026-08-24-org-id.sql', 'org_unit 의 PK 를 name 에서 org_id 로 옮겼다. 자기참조 FK 에는 InnoDB 가 CASCADE 를 수행하지 않아 본부 개명이 1451 로 막히던 것이 계기다. 이름 미러는 남기지 않았다.'],
  ['2026-08-27', 'migrate-2026-08-27-repo-flag.sql', 'cal_category 에 uses_repo 를 더했다.'],
  ['2026-08-27', 'migrate-2026-08-27-sort-order.sql', 'cal_category · cal_entry · cal_todo · cal_room 등에 sort_order 를 더해 부팅 조회의 순서를 fromXML() 의 문서 순서와 맞췄다.'],
  ['2026-08-31', 'migrate-2026-08-31-report-daily.sql', 'cal_report_daily · cal_report_hours 신설(v5→6). 캘린더가 보낸 일간보고와 과제별 시간.'],
  ['2026-08-31', 'migrate-2026-08-31-report-weekly.sql', 'cal_report_weekly 신설(v6→7).'],
  ['2026-08-31', 'migrate-2026-08-31-sent-only.sql', 'cal_report_weekly 를 보낸 것만 담도록 다시 만들었다(v7→8).'],
];

// ── 표 한 개의 상세 ──
function tableSection(t) {
  const pk = t.indexes.find((i) => i.name === 'PRIMARY');
  const uniques = t.indexes.filter((i) => i.unique && i.name !== 'PRIMARY');
  const plain = t.indexes.filter((i) => !i.unique);
  const g = grantMap[t.name] || [];
  const cols = t.columns.map((c) => `
      <tr>
        <td class="mono">${esc(c.name)}${c.key === 'PRI' ? ' <span class="tag pk">PK</span>' : ''}${c.key === 'UNI' ? ' <span class="tag uq">UQ</span>' : ''}${c.key === 'MUL' ? ' <span class="tag ix">IX</span>' : ''}</td>
        <td class="mono">${esc(c.type)}</td>
        <td>${c.nullable ? 'NULL' : '<span class="nn">NOT NULL</span>'}</td>
        <td class="mono">${c.def == null ? '' : esc(c.def)}</td>
        <td class="mono muted">${esc(c.extra)}</td>
      </tr>`).join('');
  const fkRows = t.fks.map((f) => `<tr><td class="mono">${esc(f.cols)}</td><td>→ ${code(f.ref)}.${code(f.refCols)}</td><td class="mono">UPDATE ${esc(f.upd)} · DELETE ${esc(f.del)}</td></tr>`).join('');
  const kids = childrenOf(t.name);
  const checks = t.checks.map((c) => `<tr><td class="mono">${esc(c.name)}</td><td class="mono small">${esc(c.clause)}</td></tr>`).join('');
  return `
  <section class="tbl" id="t-${t.name}">
    <h3><span class="mono">${esc(t.name)}</span><span class="rows" title="개발 DB 행 수 · 더미 포함">${num(t.exact)}행</span></h3>
    ${purpose(t) ? `<p class="purpose">${esc(purpose(t))}</p>` : ''}
    <div class="kv">
      <div><span>PK</span><b class="mono">${esc(pk ? pk.cols : '없음')}</b></div>
      ${uniques.length ? `<div><span>UNIQUE</span><b class="mono">${uniques.map((u) => esc(u.cols)).join(' · ')}</b></div>` : ''}
      ${plain.length ? `<div><span>인덱스</span><b class="mono">${plain.map((u) => esc(u.cols)).join(' · ')}</b></div>` : ''}
      <div><span>앱 권한</span><b class="mono">${g.length ? esc(g.join(', ')) : '<span class="muted">없음</span>'}</b></div>
      ${kids.length ? `<div><span>참조하는 표</span><b>${kids.map((k) => `<a href="#t-${k.from}" class="mono">${esc(k.from)}</a>`).join(' · ')}</b></div>` : ''}
    </div>
    <table class="cols">
      <thead><tr><th>컬럼</th><th>타입</th><th>NULL</th><th>기본값</th><th>extra</th></tr></thead>
      <tbody>${cols}</tbody>
    </table>
    ${fkRows ? `<table class="sub"><thead><tr><th>FK 컬럼</th><th>참조</th><th>동작</th></tr></thead><tbody>${fkRows}</tbody></table>` : ''}
    ${checks ? `<table class="sub"><thead><tr><th>CHECK</th><th>조건</th></tr></thead><tbody>${checks}</tbody></table>` : ''}
  </section>`;
}

const totalCols = S.tables.reduce((a, t) => a + t.columns.length, 0);
const totalFk = edges.length, totalChk = S.tables.reduce((a, t) => a + t.checks.length, 0), totalIx = S.tables.reduce((a, t) => a + t.indexes.length, 0);
const dummyRows = S.tables.filter((t) => t.name.startsWith('cal_')).reduce((a, t) => a + t.exact, 0);

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>taskmgr 스키마 v${esc(S.meta.schemaVersion)} 검토본</title>
<style>
  :root{
    --ground:#eceff4; --panel:#ffffff; --panel2:#f4f7fb; --ink:#16202e; --muted:#5a6678; --faint:#8894a6;
    --line:#d8e0ea; --line2:#c3cedb; --accent:#2a5d8f; --accent-bg:#e6eff8; --ok:#1f7a4d; --warn:#9a5b00; --warn-bg:#fff4e0;
    --mono:"Cascadia Code","D2Coding","Consolas",ui-monospace,monospace;
    --sans:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;
  }
  @media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
    --ground:#14171c; --panel:#1c2027; --panel2:#232830; --ink:#e6e9ef; --muted:#9aa3b2; --faint:#6f7a8b;
    --line:#2b313c; --line2:#3a4250; --accent:#7ea2ff; --accent-bg:#1e2a44; --ok:#5fc48a; --warn:#e2b46a; --warn-bg:#2a2214;
  }}
  :root[data-theme="dark"]{
    --ground:#14171c; --panel:#1c2027; --panel2:#232830; --ink:#e6e9ef; --muted:#9aa3b2; --faint:#6f7a8b;
    --line:#2b313c; --line2:#3a4250; --accent:#7ea2ff; --accent-bg:#1e2a44; --ok:#5fc48a; --warn:#e2b46a; --warn-bg:#2a2214;
  }
  *{ box-sizing:border-box }
  html,body{ margin:0; background:var(--ground); color:var(--ink); font:14px/1.6 var(--sans) }
  a{ color:var(--accent); text-decoration:none } a:hover{ text-decoration:underline }
  code,.mono{ font-family:var(--mono); font-size:.92em }
  .wrap{ display:grid; grid-template-columns:230px minmax(0,1fr); gap:24px; max-width:1360px; margin:0 auto; padding:24px 20px 80px }
  nav{ position:sticky; top:16px; align-self:start; max-height:calc(100vh - 32px); overflow:auto; font-size:12.5px; padding-right:6px }
  nav h4{ margin:14px 0 4px; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--faint); font-weight:600 }
  nav a{ display:block; padding:2px 6px; border-radius:4px; color:var(--muted) }
  nav a:hover{ background:var(--panel); color:var(--ink); text-decoration:none }
  main{ min-width:0 }
  header.top{ background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:20px 24px; margin-bottom:18px }
  h1{ margin:0 0 6px; font-size:22px; letter-spacing:-.01em }
  .meta{ color:var(--muted); font-size:13px; display:flex; flex-wrap:wrap; gap:6px 18px; font-variant-numeric:tabular-nums }
  .meta b{ color:var(--ink); font-weight:600 }
  h2{ font-size:16px; margin:34px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--line2) }
  h2 small{ color:var(--faint); font-weight:400; font-size:12px; margin-left:8px }
  p{ margin:8px 0; max-width:78ch }
  .note{ background:var(--warn-bg); color:var(--warn); border-radius:6px; padding:10px 14px; font-size:13px; max-width:none }
  table{ border-collapse:collapse; width:100%; font-size:13px; background:var(--panel) }
  th,td{ text-align:left; padding:6px 10px; border-bottom:1px solid var(--line); vertical-align:top }
  th{ font-weight:600; color:var(--muted); font-size:12px; background:var(--panel2) }
  .grid{ overflow-x:auto; border:1px solid var(--line); border-radius:8px }
  .grid table td:first-child, .grid table th:first-child{ white-space:nowrap }
  .muted{ color:var(--faint) } .small{ font-size:12px } .nn{ color:var(--ink); font-weight:600 }
  .tag{ display:inline-block; font:600 10px/1 var(--sans); padding:2px 5px; border-radius:3px; vertical-align:1px; margin-left:4px }
  .tag.pk{ background:var(--accent-bg); color:var(--accent) } .tag.uq{ background:var(--panel2); color:var(--muted); border:1px solid var(--line2) } .tag.ix{ background:var(--panel2); color:var(--faint) }
  .tbl{ background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px 18px 14px; margin:14px 0 }
  .tbl h3{ margin:0 0 4px; font-size:15px; display:flex; align-items:baseline; gap:12px }
  .tbl h3 .rows{ font:12px/1 var(--sans); color:var(--faint); font-variant-numeric:tabular-nums }
  .purpose{ color:var(--muted); font-size:13px; margin:2px 0 10px }
  .kv{ display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:4px 18px; font-size:12.5px; margin-bottom:10px }
  .kv div{ display:flex; gap:8px; min-width:0 } .kv span{ color:var(--faint); flex:0 0 64px } .kv b{ font-weight:500; word-break:break-all }
  table.cols td:nth-child(1){ white-space:nowrap }
  table.sub{ margin-top:8px } table.sub th{ background:transparent }
  .matrix td.y{ color:var(--ok); font-weight:600; text-align:center } .matrix td.n{ color:var(--line2); text-align:center }
  .matrix td:first-child{ white-space:nowrap }
  .graph{ display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:8px 24px; font-size:13px }
  .graph div{ padding:4px 0; border-bottom:1px dashed var(--line) }
  .graph .rule{ color:var(--faint); font-size:11.5px; margin-left:6px }
  @media (max-width:900px){ .wrap{ grid-template-columns:1fr } nav{ position:static; max-height:none } }
  @media print{ nav{ display:none } .wrap{ grid-template-columns:1fr } .tbl{ break-inside:avoid } }
</style>
</head>
<body>
<div class="wrap">
<nav>
  <h4>문서</h4>
  <a href="#check">배포 전에 볼 것</a>
  <a href="#shape">구성</a>
  <a href="#graph">참조 그래프</a>
  <a href="#grant">앱 계정 권한</a>
  <a href="#history">8월 24일 이후 바뀐 것</a>
  <a href="#about">이 문서</a>
  <h4>과제 트랙 ${PROJECT.length}</h4>
  ${PROJECT.map((n) => `<a href="#t-${n}" class="mono">${esc(n)}</a>`).join('')}
  <h4>캘린더 트랙 ${calendar.length}</h4>
  ${calendar.map((n) => `<a href="#t-${n}" class="mono">${esc(n)}</a>`).join('')}
</nav>
<main>
<header class="top">
  <h1>taskmgr 스키마 v${esc(S.meta.schemaVersion)} 검토본</h1>
  <div class="meta">
    <span>캡처 <b>${esc(stamp)}</b></span><span>MySQL <b>${esc(S.meta.mysql)}</b></span><span>${esc(S.meta.charset[0])} / ${esc(S.meta.charset[1])}</span>
    <span>표 <b>${S.tables.length}</b></span><span>컬럼 <b>${totalCols}</b></span><span>FK <b>${totalFk}</b></span><span>CHECK <b>${totalChk}</b></span><span>인덱스 <b>${totalIx}</b></span>
    <span>트리거 <b>${S.meta.triggers}</b> · 루틴 <b>${S.meta.routines}</b> · 뷰 <b>${S.meta.views}</b></span>
  </div>
  <p>개발 PC 의 실제 DB 에서 <code>information_schema</code> 를 읽어 만들었다. 설계의 근거와 결정 이력은 <a href="CALENDAR-TABLE-DESIGN.md">CALENDAR-TABLE-DESIGN.md</a> 가 정본이고, DDL 의 단일 소스는 <a href="deploy/schema-calendar.sql">deploy/schema-calendar.sql</a> 이다. 이 문서는 그 둘을 대신하지 않고, 배포 직전에 실제로 선 구조를 한 장에서 훑는 용도다.</p>
</header>

<h2 id="check">배포 전에 볼 것</h2>
<p>아래는 개발 PC 에서 확인한 지금 상태다. 오른쪽 칸에는 폐쇄망 서버에서 달라져야 할 점을 적었다.</p>
<div class="grid"><table>
  <thead><tr><th>항목</th><th>지금(개발 PC)</th><th>서버에서</th></tr></thead>
  <tbody>
    <tr><td>앱 계정 접속 범위</td><td class="mono">${esc(S.meta.users.join(' · '))}</td><td><code>taskmgr_app@%</code> 는 어디서든 붙는다. 사내 서브넷으로 좁힐지 배포 때 정한다(ROADMAP 미결).</td></tr>
    <tr><td>스키마 버전</td><td class="mono">cal_schema_meta.schema_version = ${esc(S.meta.schemaVersion)}</td><td>위젯 빌드 상수와 같아야 부팅한다. 다르면 파괴적 연산만 막고 읽기는 한다.</td></tr>
    <tr><td>트리거 · 루틴 · 뷰</td><td class="mono">${S.meta.triggers} · ${S.meta.routines} · ${S.meta.views}</td><td>감사 트리거는 8월 11일에 없앴다. 서버에 트리거가 하나라도 있으면 폐기 전 DB 를 쓰고 있다는 뜻이다.</td></tr>
    <tr><td>행 수</td><td class="mono">cal_* 합 ${num(dummyRows)}행</td><td>대부분 더미(seed-dummy.mjs)다. 실서비스 전에 <code>seed-dummy.mjs --purge --all-users</code> 로 걷어낸다. 표별 행 수는 아래 상세의 숫자를 그 눈으로 읽을 것.</td></tr>
    <tr><td>신규 구축 vs 마이그레이션</td><td>마이그레이션 7건을 순서대로 적용한 상태</td><td>서버는 처음 세우므로 <code>schema-calendar.sql</code> 한 번으로 끝난다. migrate-*.sql 은 이미 선 DB 를 옮길 때만 쓴다.</td></tr>
    <tr><td>백업</td><td class="mono">taskmgr_backup@localhost 계정 · .cnf 방식</td><td><code>backup-taskmgr -Install</code> 로 주 1회 등록하고 첫 회차를 <code>restore-taskmgr</code> 로 되살려 본다(deploy/README.md 복구 절).</td></tr>
  </tbody>
</table></div>

<h2 id="shape">구성</h2>
<p>표는 두 무리로 나뉜다. 과제 트랙 ${PROJECT.length}개는 회사 차원의 마스터(과제·발주처·코드·사용자·조직)이고 이름이 자연키다. 캘린더 트랙 ${calendar.length}개는 사람마다 따로 쌓이는 데이터이고, 전부 <code>user_id</code> 로 시작하는 복합 PK 를 쓴다. 이 구분이 권한에도 그대로 나타난다. 과제 트랙은 앱 계정이 대부분 읽기만 하고, 캘린더 트랙은 제 행을 마음대로 쓴다.</p>
<p>캘린더 트랙의 소유자 키는 8월 24일에 <code>login_id</code> 에서 <code>user_id</code> 로 바뀌었다. <code>login_id</code> 는 사내 보고 사이트의 값이라 우리가 바꿀 수 없는데 FK 참조가 여러 경로라 개명이 실행조차 안 됐고, 그래서 대리키를 두고 <code>login_id</code> 는 UNIQUE 로 내렸다. 소유자 FK 는 전부 <code>ON DELETE RESTRICT</code> 다. 사용자 한 행을 지웠을 때 캘린더가 조용히 사라지지 않게 하려고 그렇게 두었다.</p>

<h2 id="graph">참조 그래프 <small>자식 → 부모 · ${totalFk}개</small></h2>
<div class="graph">
  ${edges.map((e) => `<div><a href="#t-${e.from}" class="mono">${esc(e.from)}</a>.<span class="mono">${esc(e.cols)}</span> → <a href="#t-${e.to}" class="mono">${esc(e.to)}</a><span class="rule">${esc(e.upd)} / ${esc(e.del)}</span></div>`).join('')}
</div>
<p class="small muted">규칙은 UPDATE / DELETE 순이다. CASCADE 가 걸린 곳은 부모 행을 지우면 자식이 함께 사라지는 자리이므로 배포 전에 한 번 더 읽어 둘 것.</p>

<h2 id="grant">앱 계정 권한 <small>${esc(S.meta.users[0] || 'taskmgr_app@%')}</small></h2>
<div class="grid"><table class="matrix">
  <thead><tr><th>표</th>${PRIVS.map((p) => `<th style="text-align:center">${p}</th>`).join('')}<th>비고</th></tr></thead>
  <tbody>${S.tables.map((t) => { const g = grantMap[t.name] || []; const note = !g.length ? '앱이 접근하지 않는다' : (g.length === 1 ? '읽기만' : (g.includes('DELETE') ? '' : '지우지 않는다')); return `<tr><td class="mono">${esc(t.name)}</td>${PRIVS.map((p) => `<td class="${g.includes(p) ? 'y' : 'n'}">${g.includes(p) ? '●' : '·'}</td>`).join('')}<td class="small muted">${esc(note)}</td></tr>`; }).join('')}</tbody>
</table></div>
<p class="small muted">GRANT 원문은 <a href="deploy/grants-calendar.sql">deploy/grants-calendar.sql</a>. DELETE 가 없는 표는 앱에 그 경로가 없다는 뜻이다(예: <code>cal_user_rev</code> 는 단조증가 카운터라 지우면 안 된다).</p>

<h2 id="t-project-track">과제 트랙 <small>${PROJECT.length}개</small></h2>
${PROJECT.map((n) => tableSection(byName[n])).join('')}

<h2 id="t-calendar-track">캘린더 트랙 <small>${calendar.length}개</small></h2>
<p class="note">행 수는 개발 DB 의 값이고 더미가 섞여 있다. 구조를 볼 때만 쓰고 용량 산정에는 쓰지 말 것.</p>
${calendar.map((n) => tableSection(byName[n])).join('')}

<h2 id="history">8월 24일 이후 바뀐 것 <small>마이그레이션 ${MIGRATIONS.length}건</small></h2>
<div class="grid"><table>
  <thead><tr><th>날짜</th><th>파일</th><th>내용</th></tr></thead>
  <tbody>${MIGRATIONS.map(([d, f, s]) => `<tr><td class="mono">${d}</td><td class="mono small"><a href="deploy/${f}">${f}</a></td><td>${esc(s)}</td></tr>`).join('')}</tbody>
</table></div>
<p>9월 7일의 겹쳐보기(C4.1)는 스키마를 바꾸지 않았다. 열람 창 안에서만 도는 화면 기능이다.</p>

<h2 id="about">이 문서</h2>
<p>이전 판(2026-07-24)은 과제 트랙 5개 표만 다뤘고, 그 뒤의 변경 7건과 캘린더 트랙 16개 표가 빠져 있었다. 이 판은 실제 DB 를 읽어 만들었으므로 손으로 옮기다 어긋날 자리가 없다. 다시 만들려면 개발 PC 에서 아래 두 줄이면 된다.</p>
<pre class="mono small" style="background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:10px 14px;overflow-x:auto">TC_TEST_DB_ADMIN_PW=&lt;root 비번&gt; node tools/schema-report/dump-schema.mjs tools/schema-report/schema.json
node tools/schema-report/build-schema-html.mjs tools/schema-report/schema.json db/table-design-report.html</pre>
<p class="small muted">컬럼 주석은 DB 에 없어서(0/${totalCols}) 이 문서에도 없다. 컬럼의 뜻은 정본 md 의 §5.3 과 schema-calendar.sql 의 주석이 담고 있다.</p>
</main>
</div>
</body>
</html>
`;
writeFileSync(OUT, html, 'utf8');
console.log(`→ ${OUT} (${Math.round(html.length / 1024)}KB) · 표 ${S.tables.length} · 컬럼 ${totalCols} · FK ${totalFk} · CHECK ${totalChk}`);
