// schema.json(information_schema 덤프) → db/table-design-report.html
//   사용: node tools/schema-report/build-schema-html.mjs <schema.json> <out.html>
// 2026-07-24 판의 보고서 형식(논지 상자 · 통계 타일 · 개체 관계도 · 지킨다/하지 않는다 · 연혁)을 그대로 잇는다.
// 표별 컬럼 상세는 접어 두고, 펼친 뒤에는 「컬럼 · 타입 · 설명」 세 열로만 보여 준다.
// 문장은 서술체로 짧게. 수치·식별자·DB 주석은 그대로 둔다.
import { readFileSync, writeFileSync } from 'node:fs';
const IN = process.argv[2], OUT = process.argv[3];
if (!IN || !OUT) { console.error('사용: node build-schema-html.mjs <schema.json> <out.html>'); process.exit(2); }
const S = JSON.parse(readFileSync(IN, 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Number(n).toLocaleString('ko-KR');
const d = new Date(S.meta.dumpedAt);
const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const PROJECT = ['project', 'customer', 'section_code', 'status_code', 'app_user', 'org_unit', 'title_code'];
const byName = Object.fromEntries(S.tables.map((t) => [t.name, t]));
const calendar = S.tables.map((t) => t.name).filter((n) => !PROJECT.includes(n));
const PURPOSE_FALLBACK = {
  section_code: '과제 구분 코드값. name 이 자연키이고 project.section 이 참조한다.',
  status_code: '과제 상태 코드값. name 이 자연키이고 project.status 가 참조한다.',
};
const purpose = (t) => t.comment || PURPOSE_FALLBACK[t.name] || '';
// 표 주석의 첫 문장만 — 목록에서는 한 줄이면 된다
const firstSentence = (s) => { const m = /^(.+?[.。])\s/.exec(s + ' '); return (m ? m[1] : s).replace(/\s*[.。]$/, ''); };

// 권한
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const grantMap = {};
for (const g of S.meta.grants) { const m = /GRANT (.+?) ON `taskmgr`\.`([a-z_]+)`/.exec(g); if (m) grantMap[m[2]] = m[1].split(',').map((x) => x.trim()); }
const privWord = (t) => { const g = grantMap[t] || []; if (!g.length) return '없음'; if (g.length === 1) return '읽기'; if (g.includes('DELETE')) return '전부'; return g.includes('UPDATE') ? '읽기·추가·수정' : '읽기·추가'; };
const groupBy = (word) => S.tables.map((t) => t.name).filter((n) => privWord(n) === word);

// FK
const edges = [];
for (const t of S.tables) for (const fk of t.fks) edges.push({ from: t.name, to: fk.ref, cols: fk.cols, refCols: fk.refCols, upd: fk.upd, del: fk.del });
const fksOf = (n) => edges.filter((e) => e.from === n);
const ownerFks = edges.filter((e) => e.to === 'app_user' && e.cols === 'user_id');
const ownerRestrict = ownerFks.filter((e) => e.del === 'RESTRICT' || e.del === 'NO ACTION');
const ownerCascade = ownerFks.filter((e) => e.del === 'CASCADE');
const kidsOf = (n) => edges.filter((e) => e.to === n);
const ruleWord = (e) => (e.del === 'CASCADE' ? '부모를 지우면 함께 지워진다' : e.del === 'RESTRICT' || e.del === 'NO ACTION' ? '참조 중이면 부모를 지울 수 없다' : e.del === 'SET NULL' ? '부모가 지워지면 비워진다' : e.del);

// 컬럼 한 줄 설명 — 키·FK·CHECK·기본값을 문장 하나로 접는다
function colDesc(t, c) {
  const parts = [];
  if (c.key === 'PRI') parts.push('<span class="chip pk">PK</span>');
  if (c.key === 'UNI') parts.push('<span class="chip uq">UNIQUE</span>');
  const fk = t.fks.find((f) => f.cols.split(',').includes(c.name));
  if (fk) parts.push(`<span class="chip fk">FK</span> ${esc(fk.ref)}.${esc(fk.refCols)} · ${esc(ruleWord(fk))}`);
  const uq = t.indexes.filter((i) => i.unique && i.name !== 'PRIMARY' && i.cols.split(',').includes(c.name) && i.cols.includes(','));
  if (uq.length) parts.push('UNIQUE(' + esc(uq[0].cols) + ')');
  if (!c.nullable && c.key !== 'PRI') parts.push('필수');
  if (c.def != null && c.def !== '' && c.extra !== 'DEFAULT_GENERATED') parts.push('기본 ' + esc(c.def));
  if (c.extra === 'DEFAULT_GENERATED' && c.def) parts.push('기본 ' + esc(c.def) + '()');
  if (/auto_increment/i.test(c.extra)) parts.push('자동 증가');
  if (/on update/i.test(c.extra)) parts.push('수정 시 자동 갱신');
  const chk = t.checks.filter((k) => new RegExp('`' + c.name + '`').test(k.clause));
  if (chk.length) parts.push(`CHECK ${chk.length}개`);
  return parts.join(' · ');
}

function tableDetails(t) {
  const pk = t.indexes.find((i) => i.name === 'PRIMARY');
  const rows = t.columns.map((c) => `<tr><td><span class="col">${esc(c.name)}</span></td><td><span class="ty">${esc(c.type)}</span></td><td class="desc-td">${colDesc(t, c)}</td></tr>`).join('');
  const chks = t.checks.length ? `<p class="note">CHECK ${t.checks.length}개: ${t.checks.map((k) => `<code>${esc(k.clause)}</code>`).join(' · ')}</p>` : '';
  const idx = t.indexes.filter((i) => i.name !== 'PRIMARY');
  return `
      <details id="t-${t.name}">
        <summary><span class="mono name">${esc(t.name)}</span><span class="pk">PK ${esc(pk ? pk.cols : '없음')}</span><span class="cnt">${num(t.exact)}행</span><span class="pv">${esc(privWord(t.name))}</span></summary>
        <div class="body">
          ${purpose(t) ? `<p class="purpose">${esc(purpose(t))}</p>` : ''}
          <div class="tbl-wrap"><table><thead><tr><th>컬럼</th><th>타입</th><th>설명</th></tr></thead><tbody>${rows}</tbody></table></div>
          ${idx.length ? `<p class="note">인덱스: ${idx.map((i) => (i.unique ? 'UNIQUE ' : '') + '<code>' + esc(i.cols) + '</code>').join(' · ')}</p>` : ''}
          ${chks}
          ${kidsOf(t.name).length ? `<p class="note">이 표를 참조: ${kidsOf(t.name).map((k) => `<a href="#t-${k.from}"><code>${esc(k.from)}</code></a>`).join(' · ')}</p>` : ''}
        </div>
      </details>`;
}

// 관계도 — 개체 상자
const ent = (name, keys, small) => `<div class="ent"><div class="h">${esc(name)}${small ? `<small>${esc(small)}</small>` : ''}</div><ul>${keys.map((k) => `<li>${k}</li>`).join('')}</ul></div>`;
const rel = (label, note) => `<div class="rel"><div class="line">──▶</div>${esc(label)}${note ? `<span class="card-note">${esc(note)}</span>` : ''}</div>`;

const totalCols = S.tables.reduce((a, t) => a + t.columns.length, 0);
const totalChk = S.tables.reduce((a, t) => a + t.checks.length, 0);
const calRows = calendar.reduce((a, n) => a + byName[n].exact, 0);
const MIGRATIONS = [
  ['08-24', 'user_id 대리키', 'app_user 에 user_id 를 두고 login_id 는 UNIQUE 로 내렸다. cal_* 의 소유자 키가 전부 user_id 로 바뀌었다. login_id 는 사내 보고 사이트의 값이라 우리가 못 바꾸는데 참조가 여러 경로라 개명이 실행조차 안 됐기 때문이다.'],
  ['08-24', 'org_unit 대리키', 'PK 를 name 에서 org_id 로 옮겼다. 자기참조 FK 에는 InnoDB 가 CASCADE 를 수행하지 않아 본부 개명이 1451 로 막히던 것을 실측하고 바꿨다. 이름 미러는 남기지 않았다.'],
  ['08-27', 'uses_repo', 'cal_category 에 저장소 사용 여부를 더했다.'],
  ['08-27', 'sort_order', 'cal_category · cal_entry · cal_todo · cal_room 에 순서 컬럼을 더해 부팅 조회의 순서를 앱의 문서 순서와 맞췄다.'],
  ['08-31', '보고 기록 3표', 'cal_report_daily · cal_report_hours(v6) · cal_report_weekly(v7) 를 만들고, 주간은 보낸 것만 담도록 다시 만들었다(v8). 캘린더가 만든 것만 담고 사이트의 현재 상태는 담지 않는다.'],
];

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>taskmgr 스키마 v${esc(S.meta.schemaVersion)} 설계 보고</title>
<style>
  :root{
    --bg:#eceff4; --surface:#ffffff; --surface-2:#f4f7fb; --surface-3:#eef2f7;
    --ink:#16202e; --muted:#5a6678; --faint:#8894a6;
    --line:#d8e0ea; --line-strong:#c3cedb;
    --accent:#2a5d8f; --accent-soft:#e6eff8;
    --good:#1f7a4d; --good-soft:#e2f2ea; --warn:#9c6410; --warn-soft:#f6ecd8; --bad:#a53a30; --bad-soft:#f6e3e0;
    --shadow:0 1px 2px rgba(20,32,48,.04), 0 8px 24px rgba(20,32,48,.06);
    --mono:ui-monospace,"Cascadia Code","SF Mono",Consolas,"D2Coding",monospace;
    --sans:-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",system-ui,sans-serif;
  }
  @media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
    --bg:#0d131c; --surface:#141d29; --surface-2:#19232f; --surface-3:#1e2836;
    --ink:#e7edf5; --muted:#95a3b6; --faint:#6f7d92; --line:#263243; --line-strong:#334254;
    --accent:#6ba4dd; --accent-soft:#152941; --good:#4cbb89; --good-soft:#13291f; --warn:#d69b45; --warn-soft:#2b2312; --bad:#dd7d72; --bad-soft:#2c1613;
    --shadow:0 1px 2px rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.35);
  }}
  :root[data-theme="dark"]{
    --bg:#0d131c; --surface:#141d29; --surface-2:#19232f; --surface-3:#1e2836;
    --ink:#e7edf5; --muted:#95a3b6; --faint:#6f7d92; --line:#263243; --line-strong:#334254;
    --accent:#6ba4dd; --accent-soft:#152941; --good:#4cbb89; --good-soft:#13291f; --warn:#d69b45; --warn-soft:#2b2312; --bad:#dd7d72; --bad-soft:#2c1613;
    --shadow:0 1px 2px rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.35);
  }
  *{box-sizing:border-box}
  body{margin:0; background:var(--bg); color:var(--ink); font-family:var(--sans); font-size:16px; line-height:1.7; letter-spacing:-.003em; -webkit-font-smoothing:antialiased}
  .wrap{max-width:980px; margin:0 auto; padding:clamp(28px,5vw,64px) clamp(18px,4vw,40px) 80px}
  .eyebrow{font-size:12px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--accent)}
  header.report{border-bottom:1px solid var(--line); padding-bottom:26px; margin-bottom:34px}
  h1{font-size:clamp(26px,4.4vw,40px); line-height:1.15; margin:.35em 0 .15em; letter-spacing:-.02em; text-wrap:balance; font-weight:800}
  .scope{font-size:13px; color:var(--muted); background:var(--surface-2); border:1px solid var(--line); border-radius:8px; padding:8px 12px; margin:10px 0 14px}
  .scope b{color:var(--ink)}
  .lede{font-size:clamp(16px,2vw,18px); color:var(--muted); max-width:64ch; margin:.2em 0 0}
  .meta{display:flex; flex-wrap:wrap; gap:8px; margin-top:22px}
  .meta .m{display:inline-flex; align-items:center; gap:7px; font-size:12.5px; color:var(--muted); background:var(--surface); border:1px solid var(--line); border-radius:999px; padding:5px 12px}
  .meta .m b{color:var(--ink); font-weight:650}
  .meta .m .dot{width:6px;height:6px;border-radius:50%;background:var(--accent)}
  .thesis{background:var(--surface); border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:12px; padding:22px 24px; box-shadow:var(--shadow); margin-bottom:14px}
  .thesis .k{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
  .thesis p{margin:0; font-size:clamp(17px,2.1vw,19px); line-height:1.6}
  .thesis .hl{color:var(--accent); font-weight:700; white-space:nowrap}
  .stats{display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:22px 0 8px}
  @media (max-width:680px){.stats{grid-template-columns:repeat(2,1fr)}}
  .stat{background:var(--surface); border:1px solid var(--line); border-radius:11px; padding:16px 16px 14px}
  .stat .n{font-size:30px; font-weight:800; line-height:1; letter-spacing:-.02em; font-variant-numeric:tabular-nums}
  .stat .u{font-size:12px; color:var(--faint); font-weight:600; margin-left:2px}
  .stat .l{font-size:12.5px; color:var(--muted); margin-top:8px; line-height:1.4}
  section{margin-top:52px}
  h2{font-size:22px; font-weight:750; letter-spacing:-.015em; margin:0 0 4px; display:flex; align-items:baseline; gap:10px}
  h2 .idx{font-family:var(--mono); font-size:13px; color:var(--accent); font-weight:600}
  .sub{color:var(--muted); margin:0 0 20px; max-width:66ch}
  h3{font-size:15px; font-weight:700; margin:26px 0 10px; letter-spacing:-.01em}
  .tbl-wrap{overflow-x:auto; border:1px solid var(--line); border-radius:12px; background:var(--surface); box-shadow:var(--shadow)}
  table{border-collapse:collapse; width:100%; font-size:14px; min-width:520px}
  thead th{background:var(--surface-2); text-align:left; font-weight:700; font-size:12px; letter-spacing:.03em; text-transform:uppercase; color:var(--muted); padding:11px 14px; border-bottom:1px solid var(--line-strong); white-space:nowrap}
  tbody td{padding:10px 14px; border-top:1px solid var(--line); vertical-align:top}
  tbody tr:first-child td{border-top:none}
  code,.mono{font-family:var(--mono); font-size:.88em}
  td .col{font-family:var(--mono); font-weight:600; color:var(--ink); white-space:nowrap}
  td .ty{font-family:var(--mono); font-size:12.5px; color:var(--muted); white-space:nowrap}
  .desc-td{color:var(--muted); min-width:220px; font-size:13.5px}
  .chip{display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:700; padding:2.5px 9px; border-radius:999px; white-space:nowrap; line-height:1.5}
  .chip.pk{color:var(--accent); background:var(--accent-soft)}
  .chip.uq{color:var(--accent); background:transparent; border:1px solid var(--accent)}
  .chip.fk{color:var(--muted); background:var(--surface-3); border:1px solid var(--line)}
  .chip.warn{color:var(--warn); background:var(--warn-soft)}
  /* 관계도 */
  .er{display:flex; align-items:center; gap:0; flex-wrap:wrap; margin:6px 0 2px; font-family:var(--mono); font-size:13px}
  .er .ent{border:1px solid var(--line-strong); border-radius:10px; background:var(--surface); box-shadow:var(--shadow); overflow:hidden; min-width:190px; margin:6px 0}
  .er .ent .h{background:var(--surface-2); padding:8px 13px; font-weight:700; border-bottom:1px solid var(--line); color:var(--ink); display:flex; justify-content:space-between; align-items:center; gap:10px}
  .er .ent .h small{font-family:var(--sans); font-size:11px; font-weight:600; color:var(--faint)}
  .er .ent ul{margin:0; padding:8px 13px; list-style:none; font-size:12px; color:var(--muted)}
  .er .ent li{padding:2px 0}
  .er .ent li .key{color:var(--accent); font-weight:700}
  .er .rel{padding:0 14px; color:var(--muted); text-align:center; font-family:var(--sans); font-size:12px; min-width:110px; flex:0 0 auto}
  .er .rel .card-note{display:block; font-size:11px; color:var(--faint); margin-top:2px}
  .er .rel .line{font-size:19px; color:var(--accent); letter-spacing:-1px}
  @media (max-width:640px){.er{flex-direction:column; align-items:stretch} .er .rel{padding:10px 0}}
  /* 표 목록(접기) */
  details{background:var(--surface); border:1px solid var(--line); border-radius:12px; margin:8px 0; box-shadow:var(--shadow)}
  details > summary{list-style:none; cursor:pointer; display:grid; grid-template-columns:minmax(150px,1.2fr) minmax(160px,1.6fr) 80px 96px; gap:12px; align-items:baseline; padding:12px 16px; font-size:14px}
  details > summary::-webkit-details-marker{display:none}
  details > summary .name{font-weight:700; color:var(--ink)}
  details > summary .pk{font-family:var(--mono); font-size:12px; color:var(--muted)}
  details > summary .cnt{font-variant-numeric:tabular-nums; font-size:12.5px; color:var(--faint); text-align:right}
  details > summary .pv{font-size:12px; color:var(--muted); text-align:right}
  details > summary:hover{background:var(--surface-2)}
  details[open] > summary{border-bottom:1px solid var(--line); background:var(--surface-2)}
  details .body{padding:14px 16px 16px}
  details .purpose{margin:0 0 12px; color:var(--ink); font-size:14.5px}
  details .body .tbl-wrap{box-shadow:none}
  details .body table{min-width:0}
  .note{font-size:12.5px; color:var(--faint); margin:10px 0 0; font-style:italic}
  .toolbar{display:flex; gap:8px; justify-content:flex-end; margin:0 0 6px}
  .toolbar button{font:600 12px/1 var(--sans); color:var(--accent); background:var(--surface); border:1px solid var(--line); border-radius:999px; padding:6px 12px; cursor:pointer}
  .toolbar button:hover{background:var(--accent-soft)}
  @media (max-width:640px){ details > summary{grid-template-columns:1fr 1fr} details > summary .pk{grid-column:1/-1} }
  /* 지킨다 / 하지 않는다 */
  .grid2{display:grid; grid-template-columns:1fr 1fr; gap:14px}
  @media (max-width:720px){.grid2{grid-template-columns:1fr}}
  .panel{background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:18px 20px; box-shadow:var(--shadow)}
  .panel h4{margin:0 0 12px; font-size:14px; font-weight:700; display:flex; align-items:center; gap:8px}
  .panel h4 .bar{width:3px; height:15px; border-radius:2px; background:var(--accent)}
  .panel.dont h4 .bar{background:var(--bad)}
  .lst{margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:9px}
  .lst li{position:relative; padding-left:22px; font-size:13.5px; color:var(--ink); line-height:1.5}
  .lst li::before{content:""; position:absolute; left:2px; top:.62em; width:6px; height:6px; border-radius:50%; background:var(--good)}
  .panel.dont .lst li::before{background:none; content:"×"; width:auto; height:auto; top:0; left:2px; color:var(--bad); font-weight:800; font-size:13px}
  .lst li b{font-weight:700} .lst li .why{color:var(--muted); font-weight:400}
  /* 배포 점검 · 연혁 */
  .road{display:flex; flex-direction:column}
  .road .r{display:grid; grid-template-columns:110px 1fr; gap:16px; padding:14px 0; border-top:1px solid var(--line)}
  .road .r:first-child{border-top:none}
  .road .when{font-family:var(--mono); font-size:12.5px; font-weight:700; color:var(--accent); padding-top:2px}
  .road .what b{font-weight:700} .road .what p{margin:3px 0 0; font-size:13.5px; color:var(--muted)}
  footer{margin-top:56px; padding-top:22px; border-top:1px solid var(--line); color:var(--faint); font-size:12.5px; line-height:1.7}
  footer code{color:var(--muted)}
  a{color:var(--accent); text-decoration:none} a:hover{text-decoration:underline}
  :focus-visible{outline:2px solid var(--accent); outline-offset:2px; border-radius:4px}
  @media print{ body{background:#fff} .thesis,.stat,.panel,.tbl-wrap,.er .ent,details{box-shadow:none} section{break-inside:avoid} details{break-inside:avoid} .toolbar{display:none} }
</style>
</head>
<body>
<div class="wrap">
<header class="report">
  <div class="eyebrow">과제관리 시스템 · 데이터 설계 보고</div>
  <h1>taskmgr 스키마 v${esc(S.meta.schemaVersion)}</h1>
  <div class="scope"><b>범위·시점</b> ${esc(stamp)} 개발 PC 의 실제 DB 에서 읽은 구조. 2026-07-24 판(과제 마스터 5표)을 잇되 캘린더 표 16개와 사용자·조직 표까지 <b>23표 전부</b>를 다룬다. 설계의 근거와 결정 이력은 <a href="CALENDAR-TABLE-DESIGN.md">CALENDAR-TABLE-DESIGN.md</a> 가 정본이고, 이 문서는 배포 전 검토용으로 현재 DB 구조를 한 장에 정리했다.</div>
  <p class="lede">테이블은 두 그룹으로 나뉜다. 회사가 관리하는 마스터 테이블은 이름을 자연키로 쓰고, 사용자별 캘린더 테이블은 user_id 로 시작하는 복합 키를 쓴다. 앱 계정 권한도 이 구분을 따른다.</p>
  <div class="meta">
    <span class="m"><span class="dot"></span>DB <b>taskmgr</b> · MySQL <b>${esc(S.meta.mysql)}</b> · ${esc(S.meta.charset[0])}</span>
    <span class="m">스키마 버전 <b>${esc(S.meta.schemaVersion)}</b></span>
    <span class="m">캡처 <b>${esc(stamp)}</b></span>
    <span class="m">트리거 <b>${S.meta.triggers}</b> · 루틴 <b>${S.meta.routines}</b> · 뷰 <b>${S.meta.views}</b></span>
  </div>
</header>

<div class="thesis">
  <div class="k">핵심 결정</div>
  <p>과제 트랙 <span class="hl">${PROJECT.length}표</span>는 이름으로 식별하고 앱 계정은 대부분 읽기 권한만 갖는다. 캘린더 트랙 <span class="hl">${calendar.length}표</span>는 전부 <span class="hl">user_id</span> 로 시작하는 복합 PK 를 쓰고, 앱은 자기 user_id 의 행만 쓴다. 사용자 한 명을 지워도 캘린더가 따라 사라지지 않도록 소유자 FK <span class="hl">${ownerFks.length}개 중 ${ownerRestrict.length}개</span>가 RESTRICT 다. 예외는 보고 기록 ${ownerCascade.length}표뿐이다. 사용자를 지우면 같이 지워도 되는 부속 테이블이라 CASCADE 로 두었다.</p>
</div>

<div class="stats">
  <div class="stat"><div class="n">${S.tables.length}<span class="u">표</span></div><div class="l">과제 ${PROJECT.length} + 캘린더 ${calendar.length} · 컬럼 ${totalCols}</div></div>
  <div class="stat"><div class="n">${edges.length}<span class="u">개</span></div><div class="l">외래키 · 소유자 FK ${ownerFks.length}개 중 RESTRICT ${ownerRestrict.length}</div></div>
  <div class="stat"><div class="n">${totalChk}<span class="u">개</span></div><div class="l">CHECK 제약 · 값 형식을 DB 가 지킨다</div></div>
  <div class="stat"><div class="n">${MIGRATIONS.length}<span class="u">건</span></div><div class="l">8월 24일 이후 구조 변경</div></div>
</div>

<section>
  <h2><span class="idx">01</span>테이블 구성과 관계</h2>
  <p class="sub">과제 트랙은 project 를 중심으로 코드표 셋이 FK 로 연결된다. 캘린더 트랙은 app_user 를 부모로 과제(cal_category)와 일정(cal_entry)이 이어진다.</p>
  <h3>과제 트랙</h3>
  <div class="er">
    ${ent('customer', ['<span class="key">PK</span> name', 'is_active'], '발주처')}${rel('project.customer', 'UPDATE CASCADE · DELETE 막힘')}
    ${ent('project', ['<span class="key">PK</span> id · <span class="key">UQ</span> uid', 'section · status · customer', 'is_active'], '과제')}${rel('section · status', 'UPDATE CASCADE · DELETE RESTRICT')}
    ${ent('section_code · status_code', ['<span class="key">PK</span> name', 'sort_order'], '코드표')}
  </div>
  <div class="er">
    ${ent('org_unit', ['<span class="key">PK</span> org_id · <span class="key">UQ</span> name', 'parent_id (자기참조)'], '조직')}${rel('app_user.org_id', 'RESTRICT')}
    ${ent('app_user', ['<span class="key">PK</span> user_id · <span class="key">UQ</span> login_id', 'org_id · title · view_scope · edit_role'], '사용자 ' + num(byName.app_user.exact) + '명')}${rel('app_user.title', 'title_code.name')}
    ${ent('title_code', ['<span class="key">PK</span> name', 'sort_order'], '직급')}
  </div>
  <h3>캘린더 트랙</h3>
  <div class="er">
    ${ent('app_user', ['<span class="key">PK</span> user_id'], '소유자')}${rel('user_id 전파', '모든 cal_* 의 선두 키')}
    ${ent('cal_category', ['<span class="key">PK</span> user_id · cat_no', '<span class="key">UQ</span> user_id · uid', 'source · uses_repo · sort_order'], '과제')}${rel('(user_id, cat_no)', 'RESTRICT')}
    ${ent('cal_entry', ['<span class="key">PK</span> user_id · entry_no', '<span class="key">UQ</span> user_id · uid', 'entry_date · recur_* · sort_order', 'updated_at = 낙관적 잠금'], '일정')}${rel('entry_no', 'CASCADE')}
    ${ent('cal_entry_except · cal_entry_commit', ['<span class="key">PK</span> user_id · entry_no · (날짜|seq)'], '부속')}
  </div>
  <p class="note">그림에는 관계를 읽는 데 필요한 키만 적었다. 전체 컬럼과 CHECK 는 03 절에서 표를 펼치면 나온다. 소유자 FK 가 걸린 표: cal_todo(→ cal_todo_day_note CASCADE) · cal_room · cal_task_hours(과제 FK RESTRICT) · cal_attendance · cal_user_pref · cal_user_rev · cal_migration_log · cal_report_daily(→ cal_report_hours CASCADE) · cal_report_weekly. 보고 기록 두 표만 소유자 FK 가 CASCADE 다.</p>
</section>

<section>
  <h2><span class="idx">02</span>배포 전 점검 항목</h2>
  <p class="sub">개발 PC 에서 확인한 현재 상태와 폐쇄망 서버에서 달라져야 할 항목.</p>
  <div class="road">
    <div class="r"><div class="when">접속 범위</div><div class="what"><b>${esc(S.meta.users.join(' · '))}</b><p>taskmgr_app@% 는 어디서든 붙는다. 사내 서브넷으로 좁힐지 배포 때 정한다(ROADMAP 미결).</p></div></div>
    <div class="r"><div class="when">버전</div><div class="what"><b>cal_schema_meta.schema_version = ${esc(S.meta.schemaVersion)}</b><p>위젯 빌드 상수와 같아야 부팅한다. 다르면 파괴적 연산만 막고 읽기는 한다.</p></div></div>
    <div class="r"><div class="when">트리거</div><div class="what"><b>${S.meta.triggers}개</b><p>감사 트리거는 8월 11일에 없앴다. 서버에 트리거가 하나라도 있으면 폐기 전 DB 를 쓰고 있다는 뜻이다.</p></div></div>
    <div class="r"><div class="when">행 수</div><div class="what"><b>cal_* 합 ${num(calRows)}행</b><p>대부분 더미(seed-dummy.mjs)다. 실서비스 전에 <code>seed-dummy.mjs --purge --all-users</code> 로 삭제한다. 03 절의 행 수도 같은 기준으로 볼 것.</p></div></div>
    <div class="r"><div class="when">구축</div><div class="what"><b>schema-calendar.sql 한 번</b><p>서버는 처음 세우므로 마이그레이션 파일은 쓰지 않는다. migrate-*.sql 은 이미 선 DB 를 옮길 때만 쓴다.</p></div></div>
    <div class="r"><div class="when">백업</div><div class="what"><b>backup-taskmgr -Install · restore-taskmgr</b><p>주 1회 백업을 등록하고 첫 회차를 복구해 확인한다. 절차는 deploy/README.md 의 복구 절.</p></div></div>
  </div>
</section>

<section>
  <h2><span class="idx">03</span>테이블 상세</h2>
  <p class="sub">이름 · PK · 개발 DB 행 수 · 앱 계정 권한 순이다. 항목을 누르면 컬럼과 제약이 펼쳐진다. 테이블 설명은 DB 의 테이블 주석 그대로다.</p>
  <div class="toolbar"><button type="button" data-open="1">모두 펼치기</button><button type="button" data-open="0">모두 접기</button></div>
  <h3>과제 트랙 ${PROJECT.length}</h3>
  ${PROJECT.map((n) => tableDetails(byName[n])).join('')}
  <h3>캘린더 트랙 ${calendar.length}</h3>
  ${calendar.map((n) => tableDetails(byName[n])).join('')}
</section>

<section>
  <h2><span class="idx">04</span>앱 계정 권한</h2>
  <p class="sub">taskmgr_app 의 GRANT 를 권한 조합별로 묶었다. DELETE 가 없는 테이블은 앱에 삭제 경로가 없다.</p>
  <div class="tbl-wrap"><table>
    <thead><tr><th>권한</th><th>표</th></tr></thead>
    <tbody>
      <tr><td><b>전부</b></td><td class="desc-td">${groupBy('전부').map((n) => `<code>${esc(n)}</code>`).join(' · ')}</td></tr>
      <tr><td><b>읽기·추가·수정</b></td><td class="desc-td">${groupBy('읽기·추가·수정').map((n) => `<code>${esc(n)}</code>`).join(' · ')}<br><span class="note">cal_user_rev 는 단조증가 카운터라 지우면 안 되고, 보고 기록은 보낸 사실이라 지우지 않는다.</span></td></tr>
      <tr><td><b>읽기·추가</b></td><td class="desc-td">${groupBy('읽기·추가').map((n) => `<code>${esc(n)}</code>`).join(' · ')}</td></tr>
      <tr><td><b>읽기</b></td><td class="desc-td">${groupBy('읽기').map((n) => `<code>${esc(n)}</code>`).join(' · ')}</td></tr>
      ${groupBy('없음').length ? `<tr><td><b>없음</b></td><td class="desc-td">${groupBy('없음').map((n) => `<code>${esc(n)}</code>`).join(' · ')}</td></tr>` : ''}
    </tbody>
  </table></div>
  <p class="note">원문은 <a href="deploy/grants-calendar.sql">deploy/grants-calendar.sql</a>. 백업 계정 taskmgr_backup@localhost 는 SELECT 와 TRIGGER 만 갖는다.</p>
</section>

<section>
  <h2><span class="idx">05</span>유지보수 원칙</h2>
  <p class="sub">유지보수 시 지켜야 할 규칙. 어기면 오류 없이 데이터가 어긋난다.</p>
  <div class="grid2">
    <div class="panel"><h4><span class="bar"></span>지킨다</h4><ul class="lst">
      <li><b>쓰기 트랜잭션의 첫 문장은 cal_user_rev 의 rev 증가</b> <span class="why">그 행의 락이 번호 발급과 동시 편집을 막는다.</span></li>
      <li><b>UPDATE·DELETE 는 updated_at 을 비교한다</b> <span class="why">영향 행이 0 이면 충돌이다. 덮어쓰지 않는다.</span></li>
      <li><b>읽기는 REPEATABLE READ, 쓰기는 READ COMMITTED</b> <span class="why">부팅 조회 한 트랜잭션이 한 시점을 본다.</span></li>
      <li><b>새 컬럼은 NULL 허용이거나 DEFAULT 가 있어야 한다</b> <span class="why">구버전 위젯이 같은 DB 를 쓰는 기간이 있다.</span></li>
      <li><b>cal_attendance 는 미기록이면 행이 없다</b> <span class="why">되돌리기는 DELETE 다. 기본값을 두면 이 계약이 깨진다.</span></li>
    </ul></div>
    <div class="panel dont"><h4><span class="bar"></span>하지 않는다</h4><ul class="lst">
      <li><b>cal_user_rev 를 지우지 않는다</b> <span class="why">단조증가가 동기화의 기준이다.</span></li>
      <li><b>데이터 표의 소유자 FK 를 CASCADE 로 바꾸지 않는다</b> <span class="why">app_user 한 행 삭제가 캘린더 침묵 삭제가 된다. CASCADE 는 보고 기록 ${ownerCascade.map((e) => e.from).join(' · ')} 두 표에만 있다.</span></li>
      <li><b>login_id 를 키로 다시 쓰지 않는다</b> <span class="why">사내 사이트의 값이라 바뀔 수 있고, 그래서 user_id 를 두었다.</span></li>
      <li><b>이름에 하드 유니크를 걸지 않는다</b> <span class="why">발주처·사업명 중복은 정상 업무 패턴이다(07-24 판의 실데이터 검수).</span></li>
      <li><b>보고 기록 표를 사이트 상태의 거울로 보지 않는다</b> <span class="why">캘린더가 보낸 것만 담는다.</span></li>
    </ul></div>
  </div>
</section>

<section>
  <h2><span class="idx">06</span>변경 이력</h2>
  <p class="sub">07-24 판 이후의 구조 변경. 9월 7일의 겹쳐보기는 화면 기능이라 스키마 변경이 없다.</p>
  <div class="road">
    ${MIGRATIONS.map(([w, t, p]) => `<div class="r"><div class="when">${esc(w)}</div><div class="what"><b>${esc(t)}</b><p>${esc(p)}</p></div></div>`).join('')}
  </div>
</section>

<footer>
  정본 <a href="CALENDAR-TABLE-DESIGN.md">CALENDAR-TABLE-DESIGN.md</a> · DDL 단일 소스 <a href="deploy/schema-calendar.sql">deploy/schema-calendar.sql</a> · 마이그레이션 <a href="deploy/">deploy/migrate-*.sql</a><br>
  이 문서는 <code>information_schema</code> 에서 생성했다. 다시 만들려면 <code>TC_TEST_DB_ADMIN_PW=&lt;root 비번&gt; node tools/schema-report/dump-schema.mjs tools/schema-report/schema.json</code> 뒤에 <code>node tools/schema-report/build-schema-html.mjs tools/schema-report/schema.json db/table-design-report.html</code>.<br>
  컬럼 주석은 DB 에 없어(0/${totalCols}) 설명 열은 키·제약·기본값으로 채웠다. 컬럼의 뜻은 정본 md 의 5.3 절과 schema-calendar.sql 의 주석에 있다.
</footer>
</div>
<script>
  for (const b of document.querySelectorAll('.toolbar button')) b.addEventListener('click', () => { const open = b.dataset.open === '1'; for (const d of document.querySelectorAll('details')) d.open = open; });
  if (location.hash) { const t = document.querySelector(location.hash); if (t && t.tagName === 'DETAILS') t.open = true; }
  document.addEventListener('click', (e) => { const a = e.target.closest('a[href^="#t-"]'); if (!a) return; const t = document.querySelector(a.getAttribute('href')); if (t) t.open = true; });
</script>
</body>
</html>
`;
writeFileSync(OUT, html, 'utf8');
console.log(`→ ${OUT} (${Math.round(html.length / 1024)}KB) · 표 ${S.tables.length} · 컬럼 ${totalCols} · FK ${edges.length} · CHECK ${totalChk}`);
