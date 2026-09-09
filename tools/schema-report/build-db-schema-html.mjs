// schema.json(information_schema 덤프) + col-notes.json(사람이 쓴 설명) → docs/DB-SCHEMA.html 의 생성 구역만 교체.
//   사용: node tools/schema-report/build-db-schema-html.mjs <schema.json> <col-notes.json> <doc.html>
//
// 이 문서는 생성분과 수기 산문이 한 파일에 섞여 있다. 경계는 주석 마커다.
//   <!-- GEN:FACTS:START --> … <!-- GEN:FACTS:END -->    머리 수치 칩
//   <!-- GEN:TABLES:START --> … <!-- GEN:TABLES:END -->   구조 절 전체
//   마커 밖은 한 글자도 건드리지 않는다.
// 생성 구역 안에도 수기 산문이 있다. 그쪽은 각자 마커로 싸 두고 그대로 다시 내보낸다.
//   <!-- PROSE:app_user.intro --> … <!-- /PROSE:app_user.intro -->
// 그래서 이 스크립트는 자기 출력에 다시 돌려도 같은 바이트가 나온다.
//
// 컬럼 표는 information_schema 가 정본이다. 「설명」 열만 col-notes.json 에서 가져오고,
// 없으면 구조에서 문장을 만들어 채운 뒤 td 에 auto 를 달아 둔다(사람이 나중에 손볼 자리).
// 문체는 경어체. 줄끝은 LF.
import { readFileSync, writeFileSync } from 'node:fs';

const [SCHEMA, NOTES, DOC] = process.argv.slice(2);
if (!SCHEMA || !NOTES || !DOC) {
  console.error('사용: node build-db-schema-html.mjs <schema.json> <col-notes.json> <doc.html>');
  process.exit(2);
}
const S = JSON.parse(readFileSync(SCHEMA, 'utf8'));
const NOTE = JSON.parse(readFileSync(NOTES, 'utf8'));
const doc = readFileSync(DOC, 'utf8');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const code = (s) => `<code>${esc(s)}</code>`;
const num = (n) => Number(n).toLocaleString('ko-KR');
// mysql 배치 출력의 이스케이프와 문자셋 접두사를 벗긴다: _utf8mb4\\'viewer\\' → 'viewer'
const unq = (s) => String(s ?? '').replace(/\\+'/g, "'").replace(/_utf8mb4'/g, "'");

const byName = Object.fromEntries(S.tables.map((t) => [t.name, t]));
const AUDIT = new Set(['created_at', 'updated_at']);

/* ── 수기 산문 조각 ── */
const proseRe = /<!-- PROSE:([A-Za-z0-9_.-]+) -->\n([\s\S]*?)\n<!-- \/PROSE:\1 -->/g;
const prose = {};
{
  let m;
  while ((m = proseRe.exec(doc))) {
    if (prose[m[1]] !== undefined) console.warn(`경고: PROSE 키 중복 — ${m[1]}`);
    prose[m[1]] = m[2];
  }
}
const P = (key) => (prose[key] === undefined ? null : `<!-- PROSE:${key} -->\n${prose[key]}\n<!-- /PROSE:${key} -->`);

/* ── 절 구성 ── */
const GROUPS = [
  { label: '과제', ko: '무엇을 하는가', sections: [
    { id: 'project', tables: ['project'] },
    { id: 'customer', tables: ['customer'] },
    { id: 'codes', tables: ['section_code', 'status_code'] },
  ] },
  { label: '사용자 · 조직', ko: '누가 무엇을 할 수 있는가', sections: [
    { id: 'people', tables: [] },
    { id: 'app_user', tables: ['app_user'] },
    { id: 'org_unit', tables: ['org_unit'] },
    { id: 'title_code', tables: ['title_code'] },
  ] },
  { label: '캘린더', ko: '개인 일정 · 할 일 · 근태 · 보고', sections: [
    { id: 'calendar', tables: [] },
  ] },
];
// 어느 절에도 배정되지 않은 표는 이름으로 갈라 붙인다. 새 표가 조용히 빠지지 않게.
{
  const placed = new Set(GROUPS.flatMap((g) => g.sections.flatMap((s) => s.tables)));
  const rest = S.tables.map((t) => t.name).filter((n) => !placed.has(n));
  const cal = GROUPS.find((g) => g.label === '캘린더');
  const etc = [];
  for (const n of rest) (n.startsWith('cal_') ? cal.sections : etc).push(n.startsWith('cal_') ? { id: n, tables: [n] } : n);
  if (etc.length) {
    console.warn(`경고: 묶음이 없는 표 ${etc.length} — ${etc.join(', ')}`);
    GROUPS.push({ label: '기타', ko: '묶음 미지정', sections: etc.map((n) => ({ id: n, tables: [n] })) });
  }
}

/* ── 제약 배지 ── */
function badges(t, c) {
  const pk = t.indexes.find((i) => i.name === 'PRIMARY');
  const pkCols = pk ? pk.cols.split(',') : [];
  const out = [];
  if (pkCols.includes(c.name)) out.push('<span class="k pk">PK</span>');
  if (/auto_increment/i.test(c.extra)) out.push('<span class="k">AUTO_INC</span>');
  const uqs = t.indexes.filter((i) => i.unique && i.name !== 'PRIMARY' && i.cols.split(',').includes(c.name));
  if (uqs.length) out.push('<span class="k uq">UNIQUE</span>');
  if (t.fks.some((f) => f.cols.split(',').includes(c.name))) out.push('<span class="k fk">FK</span>');
  if (!c.nullable && !pkCols.includes(c.name)) out.push('<span class="k nn">NOT NULL</span>');
  if (c.nullable) out.push('<span class="k">NULL 허용</span>');
  if (c.def != null) out.push(`<span class="k">기본 ${esc(unq(c.def)) || "''"}</span>`);
  if (checksOf(t, c).length) out.push('<span class="k">CHECK</span>');
  if (t.indexes.some((i) => !i.unique && i.cols.split(',').includes(c.name))) out.push('<span class="k ix">INDEX</span>');
  return out.join('');
}

const checksOf = (t, c) => t.checks.filter((k) => new RegExp('`' + c.name + '`').test(k.clause));

/* ── 자동 설명 ── */
function autoNote(t, c) {
  const pk = t.indexes.find((i) => i.name === 'PRIMARY');
  const pkCols = pk ? pk.cols.split(',') : [];
  const s = [];
  if (pkCols.includes(c.name)) {
    s.push(pkCols.length === 1 ? '기본키입니다.' : `기본키 ${code('(' + pkCols.join(', ') + ')')}의 일부입니다.`);
  }
  for (const f of t.fks.filter((f) => f.cols.split(',').includes(c.name))) {
    const ref = f.cols.split(',').length > 1
      ? `${code(f.ref)}의 ${code('(' + f.refCols.split(',').join(', ') + ')')}`
      : code(f.ref + '.' + f.refCols);
    s.push(`${ref}에 있는 값만 들어갑니다.`);
    if (f.del === 'CASCADE') s.push('부모 행이 지워지면 이 행도 함께 지워집니다.');
    else if (f.del === 'SET NULL') s.push('부모 행이 지워지면 비워집니다.');
    else s.push('참조하고 있으면 부모 행이 지워지지 않습니다.');
    if (f.upd === 'CASCADE') s.push('부모 값이 바뀌면 따라 바뀝니다.');
  }
  const uqs = t.indexes.filter((i) => i.unique && i.name !== 'PRIMARY' && i.cols.split(',').includes(c.name));
  for (const u of uqs) {
    s.push(u.cols.includes(',')
      ? `${code('(' + u.cols.split(',').join(', ') + ')')} 조합이 유일해야 합니다.`
      : '값이 유일해야 합니다.');
  }
  if (/auto_increment/i.test(c.extra)) s.push('번호는 DB가 발급합니다.');
  if (!pkCols.includes(c.name)) s.push(c.nullable ? '비워 둘 수 있습니다.' : '필수입니다.');
  if (c.def != null) s.push(`기본값은 ${code(unq(c.def) || "''")}입니다.`);
  if (/on update/i.test(c.extra)) s.push('행을 고치면 자동으로 갱신됩니다.');
  for (const k of checksOf(t, c)) {
    const cl = unq(k.clause);
    const inList = new RegExp('`' + c.name + '` in \\(([^)]*)\\)').exec(cl);
    if (inList) s.push('허용값은 ' + inList[1].split(',').map((v) => code(v.trim().replace(/^'|'$/g, ''))).join(' · ') + '뿐입니다.');
    else s.push(`${code(k.name)} 제약이 걸려 있습니다.`);
  }
  return s.join(' ');
}

/* ── 컬럼 표 ── */
const dropped = [];
function columnTable(t) {
  const pk = t.indexes.find((i) => i.name === 'PRIMARY');
  const pkCols = pk ? pk.cols.split(',') : [];
  const kept = NOTE[t.name] || {};
  const rows = t.columns.map((c) => {
    const cls = pkCols.includes(c.name) ? ' class="pk"' : AUDIT.has(c.name) ? ' class="audit"' : '';
    const hand = kept[c.name];
    const note = hand !== undefined
      ? `<td class="note">${hand}</td>`
      : `<td class="note auto">${autoNote(t, c)}</td>`;
    return `<tr${cls}><td class="col">${esc(c.name)}</td><td class="type">${esc(c.type.toUpperCase())}</td><td>${badges(t, c)}</td>${note}</tr>`;
  }).join('\n');
  for (const col of Object.keys(kept)) {
    if (!t.columns.some((c) => c.name === col)) dropped.push(`${t.name}.${col}`);
  }
  const idx = t.indexes.filter((i) => i.name !== 'PRIMARY');
  const extra = [];
  if (idx.length) extra.push(`<p class="sub">인덱스 — ${idx.map((i) => (i.unique ? 'UNIQUE ' : '') + code(i.cols.split(',').join(', ')) + ` <span class="ko">${esc(i.name)}</span>`).join(' · ')}</p>`);
  if (t.checks.length) extra.push(`<p class="sub">CHECK ${t.checks.length}개 — ${t.checks.map((k) => `${code(k.name)} ${code(unq(k.clause))}`).join(' · ')}</p>`);
  return `<div class="tw">
<table>
<thead><tr><th>컬럼</th><th>타입</th><th>제약</th><th>설명</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
${extra.join('\n')}`.replace(/\n+$/, '');
}

/* ── 표 머리 ── */
const firstSentence = (s) => { const m = /^(.+?)[.。](\s|$)/.exec(s); return m ? m[1] : s; };
const restSentence = (s) => { const m = /^.+?[.。]\s+([\s\S]+)$/.exec(s); return m ? m[1] : ''; };
function tableHead(t) {
  const ko = t.comment ? firstSentence(t.comment) : '';
  return `<h2><span class="tname">${esc(t.name)}</span>${ko ? ` <span class="ko">${esc(ko)}</span>` : ''}</h2>`;
}

/* ── 절 ── */
function renderSection(sec) {
  const parts = [];
  const single = sec.tables.length === 1 ? byName[sec.tables[0]] : null;
  parts.push(P(`${sec.id}.head`) || (single ? tableHead(single) : `<h2>${esc(sec.id)}</h2>`));
  const intro = P(`${sec.id}.intro`);
  if (intro) parts.push(intro);
  if (single && !prose[`${sec.id}.intro`] && restSentence(single.comment || '')) {
    parts.push(`<p class="sub">DB 주석 — ${esc(restSentence(single.comment))}</p>`);
  }
  for (const name of sec.tables) {
    const t = byName[name];
    if (!t) { console.warn(`경고: schema.json 에 없는 표 — ${name}`); continue; }
    if (sec.tables.length > 1) parts.push(`<h3><span class="tname">${esc(t.name)}</span>${t.comment ? ` <span class="ko">${esc(firstSentence(t.comment))}</span>` : ''}</h3>`);
    parts.push(columnTable(t));
  }
  const after = P(`${sec.id}.after`);
  if (after) parts.push(after);
  return `<section id="${sec.id}">\n${parts.join('\n\n')}\n</section>`;
}

/* ── 지금 들어 있는 것 ── */
function nowSection() {
  const st = S.meta.stats || {};
  const pair = (o) => Object.entries(o || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
  const groupRows = GROUPS.map((g) => {
    const names = g.sections.flatMap((s) => s.tables);
    if (!names.length) return '';
    const rows = names.reduce((a, n) => a + byName[n].exact, 0);
    return `<tr><td class="col">${esc(g.label)}</td><td class="type">${names.length}표 · ${num(rows)}행</td><td class="note">${names.map((n) => code(n)).join(' · ')}</td></tr>`;
  }).filter(Boolean).join('\n');
  const perTable = S.tables.map((t) => `<tr><td class="col">${esc(t.name)}</td><td class="type">${num(t.exact)}</td><td class="note">${esc(t.comment ? firstSentence(t.comment) : '')}</td></tr>`).join('\n');
  const permRows = [];
  if (st.viewScope) permRows.push(`<tr><td class="col">view_scope</td><td class="type">${esc(pair(st.viewScope))}</td><td class="note">설정이 같아도 소속이 다르면 열람 인원이 다릅니다.</td></tr>`);
  if (st.editRole) permRows.push(`<tr><td class="col">edit_role</td><td class="type">${esc(pair(st.editRole))}</td><td class="note"><code>admin</code>은 직원·조직 정보를 고칠 최소 인원입니다.</td></tr>`);
  if (st.nonDefaultUsers != null) permRows.push(`<tr><td class="col">기본값 아님</td><td class="type">${num(st.nonDefaultUsers)}명</td><td class="note">나머지는 <code>self</code>/<code>viewer</code> 기본값 그대로입니다.</td></tr>`);
  if (st.orgRoots != null) permRows.push(`<tr><td class="col">조직 트리</td><td class="type">최상위 ${num(st.orgRoots)} · 하위 ${num(byName.org_unit.exact - st.orgRoots)}</td><td class="note">조회 범위(<code>unit_tree</code>)가 이 트리를 타고 내려갑니다.</td></tr>`);
  return `<section id="people-now">
${P('people-now.head') || '<h2>지금 들어 있는 것 <span class="ko">숫자만</span></h2>'}

${P('people-now.intro') || ''}

<div class="tw">
<table>
<thead><tr><th>묶음</th><th>규모</th><th>표</th></tr></thead>
<tbody>
${groupRows}
</tbody>
</table>
</div>

<h3>표별 행 수</h3>
<div class="tw">
<table>
<thead><tr><th>표</th><th>행</th><th>목적</th></tr></thead>
<tbody>
${perTable}
</tbody>
</table>
</div>
${permRows.length ? `
<h3>권한 분포 <span class="ko">app_user</span></h3>
<div class="tw">
<table>
<thead><tr><th>항목</th><th>현황</th><th>설명</th></tr></thead>
<tbody>
${permRows.join('\n')}
</tbody>
</table>
</div>` : ''}
${P('people-now.after') || ''}
</section>`.replace(/\n{3,}/g, '\n\n');
}

/* ── 생성 구역 ── */
const tablesRegion = [
  ...GROUPS.map((g) => [
    `<p class="grp">${esc(g.label)} <span class="ko">${g.sections.flatMap((s) => s.tables).length}표 · ${esc(g.ko)}</span></p>`,
    ...g.sections.map(renderSection),
  ].join('\n\n')),
  nowSection(),
].join('\n\n');

const totalCols = S.tables.reduce((a, t) => a + t.columns.length, 0);
const totalFk = S.tables.reduce((a, t) => a + t.fks.length, 0);
const totalChk = S.tables.reduce((a, t) => a + t.checks.length, 0);
const d = new Date(S.meta.dumpedAt);
const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const groupCount = GROUPS.map((g) => `${g.label} ${g.sections.flatMap((s) => s.tables).length}`).join(' · ');
const factsRegion = `<ul class="facts">
  <li>데이터베이스 <b>taskmgr</b></li>
  <li>엔진 <b>MySQL ${esc(S.meta.mysql)} / InnoDB</b></li>
  <li>문자셋 <b>${esc(S.meta.charset[1])}</b></li>
  <li>표 <b>${S.tables.length}</b> <span class="ko">${esc(groupCount)}</span></li>
  <li>컬럼 <b>${totalCols}</b> · 외래키 <b>${totalFk}</b> · CHECK <b>${totalChk}</b></li>
  <li>schema_version <b>${esc(S.meta.schemaVersion)}</b></li>
  <li>기준 <b>${stamp}</b></li>
</ul>`;

/* ── 끼워 넣기 ── */
function splice(src, name, body) {
  const re = new RegExp(`(<!-- GEN:${name}:START -->\\n)[\\s\\S]*?(\\n<!-- GEN:${name}:END -->)`);
  if (!re.test(src)) { console.error(`오류: GEN:${name} 마커를 찾지 못했다`); process.exit(1); }
  return src.replace(re, (_, a, b) => a + body + b);
}
let out = splice(doc, 'FACTS', factsRegion);
out = splice(out, 'TABLES', tablesRegion);
out = out.replace(/\r\n/g, '\n');
writeFileSync(DOC, out, 'utf8');

/* ── 보고 ── */
const covered = new Set(GROUPS.flatMap((g) => g.sections.flatMap((s) => s.tables)));
const missing = S.tables.map((t) => t.name).filter((n) => !covered.has(n));
const handCount = Object.values(NOTE).reduce((a, o) => a + Object.keys(o).length, 0);
let reused = 0;
for (const [tbl, cols] of Object.entries(NOTE)) for (const c of Object.keys(cols)) if (byName[tbl] && byName[tbl].columns.some((x) => x.name === c)) reused++;
console.log(`표 ${S.tables.length}(생성 ${covered.size}) · 컬럼 ${totalCols} · 수기 설명 ${handCount} 중 ${reused} 재사용 · 자동 ${totalCols - reused}`);
if (missing.length) { console.error(`오류: 문서에 빠진 표 ${missing.length} — ${missing.join(', ')}`); process.exit(1); }
if (dropped.length) {
  console.warn(`경고: DB에 없는 컬럼의 설명 ${dropped.length}개 — ${dropped.join(', ')}`);
  console.warn('  문서와 DB가 갈라진 자리다. col-notes.json 에서 지우거나 컬럼을 되살려라.');
}
