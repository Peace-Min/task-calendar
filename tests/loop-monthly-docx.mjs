#!/usr/bin/env node
/* ============================================================================
 *  tests/loop-monthly-docx.mjs: 월간보고 DOCX 생성기(widget/DocxWriter.cs) 산출물 검사
 * ----------------------------------------------------------------------------
 *  기본 실행(run-tests.mjs)에 들지 않는다. dotnet 빌드가 필요하기 때문이다(이름이 *.test.mjs 가 아니라 러너가 줍지 않는다).
 *  하는 일:
 *    1) tests/tools/monthly-docx-mock 을 dotnet run 으로 돌려 dist/monthly-docx-loop/ 에 mock-sw.docx, mock-hw.docx 를 만든다(지어낸 값, 남겨 둔다).
 *    2) 외부 패키지 없이 ZIP 을 직접 읽는다(끝 레코드 EOCD, 중앙 디렉터리, inflateRawSync).
 *    3) 모든 .xml, .rels 를 jsdom DOMParser(application/xml)로 파싱한다. parsererror 면 실패.
 *    4) 구조를 본다: [Content_Types].xml 첫 엔트리, 제목 문단, 과제 표 수와 기타 표, 줄마다 gridSpan 합 = 7,
 *       tcW = 걸친 격자 폭 합, 세로 병합 모양, 기대 글자, 그림 관계와 콘텐츠 형식, A4 가로 구역.
 *    5) HW 양식(7절): 제목과 기간 줄, 격자 7열 폭, 파랑 없음, 개발 일정 머리 넷, 변경이력과 그림 없음, 기타 3칸, 여백이 표 폭을 담는다.
 *  Word 나 한컴에서 실제로 열어 보는 것은 대신하지 못한다(스키마 순서와 렌더링은 사람이 확인).
 *
 *  실행(저장소 루트에서): node tests/loop-monthly-docx.mjs
 *  종료코드: 0 통과, 1 실패, 2 판정 불가(dotnet 실행 실패, jsdom 없음).
 * ==========================================================================*/
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch (e) { console.error('[판정 불가] jsdom 이 없습니다(tests/node_modules): ' + e.message); process.exit(2); }
const { DOMParser } = new JSDOM('').window;

let pass = 0, fail = 0; const F = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  ✓ ${n}${d ? ': ' + d : ''}`); }
  else { fail++; F.push(n + (d ? ': ' + d : '')); console.log(`  ✗ ${n}${d ? ': ' + d : ''}`); }
};

// ── 1) 목업 실행 ─────────────────────────────────────────────────────
//  만든 문서는 dist/monthly-docx-loop/ 에 남긴다(dist 는 gitignore). Word 나 한컴으로 직접 열어 볼 수 있게.
const work = join(root, 'dist', 'monthly-docx-loop');
mkdirSync(work, { recursive: true });
const out = join(work, 'mock-sw.docx');
const outHw = join(work, 'mock-hw.docx');
for (const f of [out, outHw]) rmSync(f, { force: true });
console.log('[1] dotnet run (monthly-docx-mock) SW, HW');
const run = spawnSync('dotnet', ['run', '--project', join(root, 'tests', 'tools', 'monthly-docx-mock'), '--', out, outHw],
  { cwd: root, encoding: 'utf8', timeout: 300000 });
if (run.status !== 0) {
  console.error(run.stdout || ''); console.error(run.stderr || '');
  console.error(`[판정 불가] 목업 실행 실패(exit ${run.status})`);
  process.exit(2);
}
const buf = readFileSync(out);
const bufHw = readFileSync(outHw);
console.log(`  ${out} ${buf.length} bytes`);
console.log(`  ${outHw} ${bufHw.length} bytes`);

// ── 2) 최소 ZIP 읽기 ─────────────────────────────────────────────────
function readZip(b) {
  // EOCD(50 4B 05 06)는 끝에서 22바이트 + 주석(최대 65535) 안에 있다.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD 를 찾지 못함');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('중앙 디렉터리 서명이 아님');
    const method = b.readUInt16LE(p + 10);
    const csize = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commLen;
    if (b.readUInt32LE(local) !== 0x04034b50) throw new Error('로컬 헤더 서명이 아님: ' + name);
    const lnLen = b.readUInt16LE(local + 26), lxLen = b.readUInt16LE(local + 28);
    const start = local + 30 + lnLen + lxLen;
    const raw = b.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`지원하지 않는 압축 방식 ${method}: ${name}`);
    entries.push({ name, local, data });
  }
  return entries;
}

//  ZIP 구조와 XML 파싱(두 양식 공통). tag 는 항목 이름 머리.
function openDocx(b, tag) {
  console.log(`[2] ZIP 구조${tag}`);
  let entries = [];
  try { entries = readZip(b); ok(`${tag}ZIP 을 읽었다`, true, `${entries.length}개 엔트리`); }
  catch (e) { ok(`${tag}ZIP 을 읽었다`, false, e.message); }
  const byName = new Map(entries.map((e) => [e.name, e]));
  ok(`${tag}[Content_Types].xml 이 중앙 디렉터리 첫 엔트리`, entries[0] && entries[0].name === '[Content_Types].xml', entries[0] && entries[0].name);
  const firstLocal = entries.slice().sort((a, c) => a.local - c.local)[0];
  ok(`${tag}[Content_Types].xml 이 파일 맨 앞(로컬 헤더 0)`, firstLocal && firstLocal.name === '[Content_Types].xml' && firstLocal.local === 0);
  ok(`${tag}디렉터리 엔트리가 없다`, entries.every((e) => !e.name.endsWith('/')));
  ok(`${tag}경로에 역슬래시가 없다`, entries.every((e) => !e.name.includes('\\')));
  for (const need of ['_rels/.rels', 'docProps/core.xml', 'docProps/app.xml', 'word/document.xml', 'word/styles.xml',
    'word/settings.xml', 'word/_rels/document.xml.rels']) {
    ok(`${tag}파트 있음: ${need}`, byName.has(need));
  }

  console.log(`[3] XML 파싱${tag}`);
  const docs = new Map();
  for (const e of entries) {
    if (!/\.(xml|rels)$/.test(e.name)) continue;
    const bom = e.data[0] === 0xef && e.data[1] === 0xbb && e.data[2] === 0xbf;
    const text = e.data.toString('utf8');
    const d = new DOMParser().parseFromString(text, 'application/xml');
    const bad = d.getElementsByTagName('parsererror').length > 0;
    const decl = /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>/.test(text);
    ok(`${tag}파싱: ${e.name}`, !bad && !bom && decl, bad ? 'parsererror' : bom ? 'BOM 있음' : decl ? '' : '선언 없음');
    docs.set(e.name, { d, text });
  }
  return { entries, byName, docs };
}
const { byName, docs } = openDocx(buf, '');

// ── 4) 본문 구조 ─────────────────────────────────────────────────────
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const kids = (el, local) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.namespaceURI === W && (!local || n.localName === local));
const kid = (el, local) => kids(el, local)[0];
const wattr = (el, a) => (el ? el.getAttributeNS(W, a) : null);
const textOf = (el) => Array.from(el.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join('');

console.log('[4] 본문 구조');
const docEntry = docs.get('word/document.xml');
if (!docEntry) { ok('document.xml 있음', false); finish(); }
const body = docEntry.d.getElementsByTagNameNS(W, 'body')[0];
const blocks = kids(body);
const tables = blocks.filter((n) => n.localName === 'tbl');

// 제목 문단 1개 + 빈 문단, 그 뒤 표마다 빈 문단, 마지막 sectPr
ok('본문 첫 요소는 제목 문단', blocks[0] && blocks[0].localName === 'p' && textOf(blocks[0]).startsWith('월간보고'));
const TITLE = '월간보고 (홍길동) \u2013 2026년 10월 20일';
ok('제목 글자(구분 기호 U+2013, 0 채운 월일)', blocks[0] && textOf(blocks[0]) === TITLE, blocks[0] && JSON.stringify(textOf(blocks[0])));
const titleRun = blocks[0] && blocks[0].getElementsByTagNameNS(W, 'r')[0];
const trp = titleRun && kid(titleRun, 'rPr');
ok('제목은 굵게, 12pt, 밑줄, 가운데', !!(trp && kid(trp, 'b') && wattr(kid(trp, 'sz'), 'val') === '24' && wattr(kid(trp, 'u'), 'val') === 'single'
  && wattr(kid(kid(blocks[0], 'pPr'), 'jc'), 'val') === 'center'));
ok('제목 뒤 빈 문단', blocks[1] && blocks[1].localName === 'p' && textOf(blocks[1]) === '');
ok('제목 문단은 하나뿐', blocks.filter((n) => n.localName === 'p' && textOf(n).startsWith('월간보고')).length === 1);
ok('마지막 요소는 sectPr', blocks[blocks.length - 1] && blocks[blocks.length - 1].localName === 'sectPr');
const everyTableFollowedByP = tables.every((t) => { const i = blocks.indexOf(t); return blocks[i + 1] && blocks[i + 1].localName === 'p'; });
ok('표마다 뒤에 문단이 있다', everyTableFollowedByP);

const gridOf = (t) => kids(kid(t, 'tblGrid'), 'gridCol').map((g) => Number(wattr(g, 'w')));
const projTables = tables.filter((t) => gridOf(t).length === 7);
const etcTables = tables.filter((t) => gridOf(t).length === 2);
ok('과제 표 4개(목업 과제 수) + 기타 표 1개', projTables.length === 4 && etcTables.length === 1 && tables.length === 5,
  `과제 ${projTables.length}, 기타 ${etcTables.length}, 전체 ${tables.length}`);
ok('기타 표가 마지막 표', tables[tables.length - 1] === etcTables[0]);

const GRID7 = [1126, 1116, 2394, 1548, 1270, 2692, 3642];
const rowsOf = (t) => kids(t, 'tr');
const cellsOf = (tr) => kids(tr, 'tc');
const spanOf = (tc) => { const g = kid(kid(tc, 'tcPr'), 'gridSpan'); return g ? Number(wattr(g, 'val')) : 1; };
const vmOf = (tc) => { const v = kid(kid(tc, 'tcPr'), 'vMerge'); return v ? (wattr(v, 'val') || 'continue') : null; };

function checkGridAndWidths(t, grid, label) {
  ok(`${label}: tblGrid 열 = [${grid.join(',')}]`, JSON.stringify(gridOf(t)) === JSON.stringify(grid), gridOf(t).join(','));
  const tblW = kid(kid(t, 'tblPr'), 'tblW');
  const sum = grid.reduce((a, b) => a + b, 0);
  ok(`${label}: tblW ${sum} dxa(격자 합), 고정 레이아웃`, wattr(tblW, 'w') === String(sum) && wattr(tblW, 'type') === 'dxa'
    && wattr(kid(kid(t, 'tblPr'), 'tblLayout'), 'type') === 'fixed');
  let spanOk = true, wOk = true, pOk = true; const bad = [];
  rowsOf(t).forEach((tr, ri) => {
    let col = 0;
    for (const tc of cellsOf(tr)) {
      const s = spanOf(tc);
      const want = grid.slice(col, col + s).reduce((a, b) => a + b, 0);
      const tcW = kid(kid(tc, 'tcPr'), 'tcW');
      if (Number(wattr(tcW, 'w')) !== want || wattr(tcW, 'type') !== 'dxa') { wOk = false; bad.push(`r${ri + 1}c${col + 1} tcW ${wattr(tcW, 'w')}!=${want}`); }
      if (kids(tc, 'p').length < 1) pOk = false;
      if (kids(tc)[0] && kids(tc)[0].localName !== 'tcPr') pOk = false;
      col += s;
    }
    if (col !== grid.length) { spanOk = false; bad.push(`r${ri + 1} gridSpan 합 ${col}`); }
  });
  ok(`${label}: 줄마다 gridSpan 합 = ${grid.length}`, spanOk, bad.filter((x) => x.includes('gridSpan')).join(' '));
  ok(`${label}: tcW = 걸친 격자 폭 합(dxa)`, wOk, bad.filter((x) => x.includes('tcW')).slice(0, 3).join(' '));
  ok(`${label}: tc 는 tcPr 로 시작하고 문단이 하나 이상`, pOk);
}

// 목업 과제별 이력 수(없으면 빈 줄 1개)
const MOCK = [
  { title: '(예시) 관제 시뮬레이터 고도화', term: '2025/08 ~ 2026/12', changes: 2, images: 2 },
  { title: '(예시) 시험장비 운용SW', term: '2026/03 ~ 2027/06', changes: 1, images: 0 },
  { title: '(예시) 신규 과제 착수', term: '', changes: 1, images: 1 },
  //  2026-10-23 월간 탭 모양: 계획 두 칸과 이력이 빈 목록. 표 모양은 그대로, 계획 칸은 빈 문단 하나, 이력은 빈 줄 하나
  { title: '(예시) 계획 칸을 비운 과제', term: '2026/01 ~ 2026/12', changes: 1, images: 0, emptyPlans: true, actual: ['- 자료 정리 화면 보완', '; 필터 저장'] },
];

projTables.forEach((t, k) => {
  const m = MOCK[k];
  const label = `과제 표 ${k + 1}`;
  checkGridAndWidths(t, GRID7, label);
  const rows = rowsOf(t);
  const expectRows = 4 + m.changes + 2;
  ok(`${label}: 줄 수 ${expectRows}`, rows.length === expectRows, String(rows.length));
  // 1열 세로 병합: 2줄 시작, 마지막 줄까지 계속
  const c1 = rows.map((tr) => vmOf(cellsOf(tr)[0]));
  ok(`${label}: 1열 세로 병합(2줄 restart, 3줄~끝 continue, 1줄 없음)`,
    c1[0] === null && c1[1] === 'restart' && c1.slice(2).every((v) => v === 'continue'), JSON.stringify(c1));
  // 일정 변경이력 칸: 4줄 시작, 이력 줄 계속, 그 다음 줄은 병합 없음
  const c2 = rows.map((tr) => vmOf(cellsOf(tr)[1]));
  const histEnd = 4 + m.changes;
  ok(`${label}: 변경이력 칸 세로 병합(4줄 restart, 이력 ${m.changes}줄 continue, 다음 줄 끊김)`,
    c2[3] === 'restart' && c2.slice(4, histEnd).every((v) => v === 'continue') && c2[histEnd] === null
      && c2[0] === null && c2[1] === null && c2[2] === null,
    JSON.stringify(c2));
  ok(`${label}: 변경이력 칸 이름 두 줄(일정 / 변경이력)`,
    JSON.stringify(kids(cellsOf(rows[3])[1], 'p').map(textOf)) === JSON.stringify(['일정', '변경이력']));
  ok(`${label}: 개발 일정 칸 이름 두 줄(개발 / 일정)`,
    JSON.stringify(kids(cellsOf(rows[2])[1], 'p').map(textOf)) === JSON.stringify(['개발', '일정']));
  ok(`${label}: 과제명 칸 = ${m.title}`, textOf(cellsOf(rows[1])[0]) === m.title);
  ok(`${label}: 과제 수행 기간 값 = '${m.term}'`, textOf(cellsOf(rows[1])[2]) === m.term);
  ok(`${label}: 머리 줄 글자`, textOf(cellsOf(rows[0])[1]) === '월간 실적: 08월 31일 ~ 10월 16일'
    && textOf(cellsOf(rows[0])[2]) === '월간 계획: 10월 19일 ~ 12월 04일' && textOf(cellsOf(rows[0])[0]) === '과제명');
  const shd = (tc) => wattr(kid(kid(tc, 'tcPr'), 'shd'), 'fill');
  ok(`${label}: 머리 줄 연파랑 DBE5F1`, cellsOf(rows[0]).every((tc) => shd(tc) === 'DBE5F1'));
  const cant = rows.map((tr) => !!kid(kid(tr, 'trPr'), 'cantSplit'));
  ok(`${label}: 본문 줄만 쪽 나눔 허용(마지막 줄 cantSplit 없음)`, cant[rows.length - 1] === false && cant[0] && cant[3] && cant[rows.length - 2]);
  const drawings = cellsOf(rows[2])[2].getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip').length;
  ok(`${label}: 그림 ${m.images}장`, drawings === m.images, String(drawings));
  if (m.emptyPlans) {
    const body = cellsOf(rows[rows.length - 1]);
    const paras = (tc) => kids(tc, 'p').map(textOf);
    ok(`${label}: 본문 줄 칸 4개(병합 계속, 계획, 실적, 계획)`, body.length === 4 && vmOf(body[0]) === 'continue' && spanOf(body[1]) === 2 && spanOf(body[2]) === 3 && spanOf(body[3]) === 1);
    ok(`${label}: 빈 계획 두 칸은 빈 문단 하나씩`, JSON.stringify(paras(body[1])) === '[""]' && JSON.stringify(paras(body[3])) === '[""]', JSON.stringify([paras(body[1]), paras(body[3])]));
    ok(`${label}: 실적 칸 글 그대로`, JSON.stringify(paras(body[2])) === JSON.stringify(m.actual), JSON.stringify(paras(body[2])));
    const ch = cellsOf(rows[4]);
    ok(`${label}: 변경이력 빈 줄 하나(칸 셋이 비어 있다)`, ch.length === 5 && [2, 3, 4].every((i) => textOf(ch[i]) === ''), String(ch.length));
  }
});
if (etcTables[0]) {
  const t = etcTables[0];
  checkGridAndWidths(t, [1126, 12662], '기타 표');
  const rows = rowsOf(t);
  ok('기타 표: 2줄, 기타 칸', rows.length === 2 && textOf(cellsOf(rows[1])[0]) === '기타');
  ok('기타 표: 본문 4줄', kids(cellsOf(rows[1])[1], 'p').length === 4);
}

// 글자
const allText = textOf(body);
ok('이스케이프 시료가 그대로 돌아온다: A&B <태그> "따옴표"', allText.includes('A&B <태그> "따옴표"'));
ok('원문 XML 에서는 이스케이프돼 있다', docEntry.text.includes('A&amp;B &lt;태그&gt; &quot;따옴표&quot;'));
ok('제어 문자(\\u0007)가 제거됐다', !docEntry.text.includes('\u0007') && allText.includes('제어 문자 제거 확인( 이 글자 앞의'));
ok('들여쓰기 3단계 = 852 dxa', docEntry.text.includes('<w:ind w:left="852"/>'));
ok('w:t 는 모두 xml:space="preserve"', Array.from(body.getElementsByTagNameNS(W, 't'))
  .every((t) => t.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space') === 'preserve'));

// ── 5) 그림 관계 ─────────────────────────────────────────────────────
console.log('[5] 그림 관계');
const RELNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const rels = docs.get('word/_rels/document.xml.rels');
const ct = docs.get('[Content_Types].xml');
const CTNS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const defaults = new Map(ct ? Array.from(ct.d.getElementsByTagNameNS(CTNS, 'Default')).map((e) => [e.getAttribute('Extension'), e.getAttribute('ContentType')]) : []);
const overrides = new Map(ct ? Array.from(ct.d.getElementsByTagNameNS(CTNS, 'Override')).map((e) => [e.getAttribute('PartName'), e.getAttribute('ContentType')]) : []);
for (const p of ['/word/document.xml', '/word/styles.xml', '/word/settings.xml', '/docProps/core.xml', '/docProps/app.xml'])
  ok(`Override 있음: ${p}`, overrides.has(p));
const relMap = new Map();
for (const r of rels ? Array.from(rels.d.getElementsByTagNameNS(RELNS, 'Relationship')) : []) relMap.set(r.getAttribute('Id'), r);
const imgRels = Array.from(relMap.values()).filter((r) => r.getAttribute('Type').endsWith('/image'));
ok('그림 관계 3개(목업 그림 수)', imgRels.length === 3, String(imgRels.length));
for (const r of imgRels) {
  const target = 'word/' + r.getAttribute('Target');
  const e = byName.get(target);
  const ext = target.split('.').pop();
  const ctype = defaults.get(ext);
  let magic = false;
  if (e && ctype === 'image/png') magic = e.data[0] === 0x89 && e.data[1] === 0x50;
  if (e && ctype === 'image/jpeg') magic = e.data[0] === 0xff && e.data[1] === 0xd8;
  ok(`그림 ${r.getAttribute('Id')} → ${target}`, !!e && !!ctype && magic, `${ctype || '콘텐츠 형식 없음'}`);
}
const ANS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const blips = Array.from(body.getElementsByTagNameNS(ANS, 'blip'));
ok('모든 a:blip 의 r:embed 가 그림 관계를 가리킨다', blips.length === 3 && blips.every((b) => {
  const r = relMap.get(b.getAttributeNS(RNS, 'embed'));
  return r && r.getAttribute('Type').endsWith('/image');
}));
const WPNS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const docPrIds = Array.from(body.getElementsByTagNameNS(WPNS, 'docPr')).map((e) => e.getAttribute('id'));
ok('docPr id 가 서로 다르다', new Set(docPrIds).size === docPrIds.length && docPrIds.length === 3, docPrIds.join(','));
const extents = Array.from(body.getElementsByTagNameNS(WPNS, 'extent')).map((e) => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]);
ok('그림 폭이 칸 폭(11330 dxa)을 넘지 않는다', extents.every(([cx]) => cx > 0 && cx <= 11330 * 635), JSON.stringify(extents));
// gantt-a.png 1200x420 → 줄어든다(비율 유지), gantt-b.jpg 900x260 → 96 dpi 크기 그대로(8572500 > 7194550 이라 이것도 줄어든다)
ok('첫 그림 비율 유지(1200:420)', extents[0] && Math.abs(extents[0][0] / extents[0][1] - 1200 / 420) < 0.001);
ok('둘째 그림 비율 유지(900:260)', extents[1] && Math.abs(extents[1][0] / extents[1][1] - 900 / 260) < 0.001);

// ── 6) 구역, 스타일, 메타 ────────────────────────────────────────────
console.log('[6] 구역, 스타일, 메타');
const sect = blocks[blocks.length - 1];
const pgSz = sect && kid(sect, 'pgSz');
ok('A4 가로 16838 x 11906', wattr(pgSz, 'w') === '16838' && wattr(pgSz, 'h') === '11906' && wattr(pgSz, 'orient') === 'landscape');
const pgMar = sect && kid(sect, 'pgMar');
ok('여백 1440/1440/1800/1440, 머리말 꼬리말 851', wattr(pgMar, 'top') === '1440' && wattr(pgMar, 'bottom') === '1440'
  && wattr(pgMar, 'left') === '1800' && wattr(pgMar, 'right') === '1440' && wattr(pgMar, 'header') === '851' && wattr(pgMar, 'footer') === '851');
const styles = docs.get('word/styles.xml');
ok('기본 글꼴 맑은 고딕 10pt', !!styles && /<w:rPrDefault><w:rPr><w:rFonts w:ascii="맑은 고딕" w:eastAsia="맑은 고딕" w:hAnsi="맑은 고딕" w:cs="맑은 고딕"\/><w:sz w:val="20"\/>/.test(styles.text));
const settings = docs.get('word/settings.xml');
ok('compatibilityMode 15', !!settings && /w:name="compatibilityMode"[^>]*w:val="15"/.test(settings.text));
const core = docs.get('docProps/core.xml');
ok('core.xml 제목 월간보고, 작성자 홍길동', !!core && core.text.includes('<dc:title>월간보고</dc:title>') && core.text.includes('<dc:creator>홍길동</dc:creator>'));

// ── 7) HW 양식(docs/MONTHLY-TEMPLATE-HW.md 3장, MONTHLY-UX-V2 11~13) ─────
//  목업은 HW 가 쓰지 않는 값(그림, 변경이력, 계획 두 칸, 계획 기간)을 일부러 채워 보낸다. 문서에 나오면 안 된다.
console.log('[7] HW 양식');
const hw = openDocx(bufHw, 'HW ');
const hwDoc = hw.docs.get('word/document.xml');
if (!hwDoc) { ok('HW document.xml 있음', false); finish(); }
const hb = hwDoc.d.getElementsByTagNameNS(W, 'body')[0];
const hbl = kids(hb);
const ht = hbl.filter((n) => n.localName === 'tbl');
const runRPr = (p) => { const r = p && p.getElementsByTagNameNS(W, 'r')[0]; return r && kid(r, 'rPr'); };
const markRPr = (p) => p && kid(p, 'pPr') && kid(kid(p, 'pPr'), 'rPr');
const jcOf = (p) => wattr(kid(kid(p, 'pPr') || p, 'jc'), 'val');
const szOf = (rp) => wattr(rp && kid(rp, 'sz'), 'val');

const HW_TITLE = '월간보고 \u2013 H/W팀 (홍길동) \u2013 2026년 10월 6일';
ok('HW 제목 글자(H/W팀, U+2013, 앞 0 없음)', hbl[0] && textOf(hbl[0]) === HW_TITLE, hbl[0] && JSON.stringify(textOf(hbl[0])));
const hrp = runRPr(hbl[0]);
ok('HW 제목은 굵게 14pt, 밑줄, 가운데', !!(hrp && kid(hrp, 'b') && szOf(hrp) === '28' && wattr(kid(hrp, 'u'), 'val') === 'single' && jcOf(hbl[0]) === 'center'));
ok('HW 실적 기간 줄 [ 2026. 8. 17 ~ 2026. 10. 2 ] 11pt 가운데, 굵게 아님', hbl[1] && textOf(hbl[1]) === '[ 2026. 8. 17 ~ 2026. 10. 2 ]'
  && szOf(runRPr(hbl[1])) === '22' && !kid(runRPr(hbl[1]), 'b') && jcOf(hbl[1]) === 'center', hbl[1] && JSON.stringify(textOf(hbl[1])));
const isBold12Empty = (p) => !!p && p.localName === 'p' && textOf(p) === '' && !!markRPr(p) && !!kid(markRPr(p), 'b') && szOf(markRPr(p)) === '24';
ok('HW 기간 줄 뒤 빈 문단(굵게 12pt)', isBold12Empty(hbl[2]));
ok('HW 표 4개(과제 3 + 기타 1)', ht.length === 4, String(ht.length));
ok('HW 표마다 뒤에 빈 문단(굵게 12pt)', ht.every((t) => isBold12Empty(hbl[hbl.indexOf(t) + 1])));
ok('HW 마지막 요소는 sectPr', hbl[hbl.length - 1] && hbl[hbl.length - 1].localName === 'sectPr');

const HWGRID = [1416, 992, 2974, 1274, 1132, 2268, 4670];
ht.forEach((t, i) => checkGridAndWidths(t, HWGRID, i < 3 ? `HW 과제 표 ${i + 1}` : 'HW 기타 표'));
ok('HW 격자 합 14726', HWGRID.reduce((a, b) => a + b, 0) === 14726);

ok('HW 파랑(DBE5F1) 없음', !hwDoc.text.includes('DBE5F1'));
ok('HW 그림 없음(blip, 그림 관계, media 파트)', hb.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip').length === 0
  && !hw.docs.get('word/_rels/document.xml.rels').text.includes('/image"') && hw.entries.every((e) => !e.name.startsWith('word/media/')));
const hwAll = textOf(hb);
ok('HW 변경이력, 계획 머리, 계획 칸 값이 없다', !/변경|월간 계획|월간 실적|쓰이면 안 되는/.test(hwAll));

const shdOf = (tc) => wattr(kid(kid(tc, 'tcPr'), 'shd'), 'fill');
const pTexts = (tc) => kids(tc, 'p').map(textOf);
const hasKeepNext = (tc) => kids(tc, 'p').every((p) => !!(kid(p, 'pPr') && kid(kid(p, 'pPr'), 'keepNext')));
const heightOf = (tr) => { const h = kid(kid(tr, 'trPr'), 'trHeight'); return [Number(wattr(h, 'val')), wattr(h, 'hRule')]; };
const HW_PROJ = [
  { title: '(예시) 장비 유지보수', term: '2026년 3월 ~ 2026년 12월',
    actual: ['● 정기점검', '- 운용센터 점검 (9/2)', ': 점검 확인서 작성', '. 서명 받기 (~ 9/30)', '', '● 문의 대응', '- 비교 기호 확인: A&B <태그> "따옴표" (w. 김예시 선임)'] },
  { title: '(예시) 시험장비 설계', term: '2026년 3월 ~', actual: ['● 설계', '- 회로 검토'] },
  { title: '(예시) 신규 과제', term: '', actual: [''] },
];
ht.slice(0, 3).forEach((t, k) => {
  const m = HW_PROJ[k], label = `HW 과제 표 ${k + 1}`;
  const rows = rowsOf(t);
  ok(`${label}: 줄 5개`, rows.length === 5, String(rows.length));
  if (rows.length !== 5) return;
  const c1 = rows.map((tr) => vmOf(cellsOf(tr)[0]));
  ok(`${label}: 과제명 칸 1줄부터 끝까지 세로 병합`, c1[0] === 'restart' && c1.slice(1).every((v) => v === 'continue'), JSON.stringify(c1));
  const r0 = cellsOf(rows[0]);
  ok(`${label}: 과제명 = ${m.title}, 흰 바탕 10.5pt`, textOf(r0[0]) === m.title && !shdOf(r0[0]) && szOf(runRPr(kids(r0[0], 'p')[0])) === '21');
  ok(`${label}: 과제 수행 기간 칸(2~3열 회색)`, r0.length === 3 && textOf(r0[1]) === '과제 수행 기간' && spanOf(r0[1]) === 2 && shdOf(r0[1]) === 'F2F2F2');
  ok(`${label}: 기간 값 '${m.term}'(4~7열 회색)`, textOf(r0[2]) === m.term && spanOf(r0[2]) === 4 && shdOf(r0[2]) === 'F2F2F2', JSON.stringify(textOf(r0[2])));
  const r1 = cellsOf(rows[1]);
  ok(`${label}: 개발 일정 머리(개발 일정 / 개발 항목 / 시작 / 종료 / 상세 내용)`, r1.length === 6
    && JSON.stringify(pTexts(r1[1])) === JSON.stringify(['개발', '일정']) && vmOf(r1[1]) === 'restart'
    && JSON.stringify(r1.slice(2).map(textOf)) === JSON.stringify(['개발 항목', '시작', '종료', '상세 내용'])
    && JSON.stringify(r1.map(spanOf)) === '[1,1,1,1,1,2]' && r1.slice(1).every((tc) => shdOf(tc) === 'F2F2F2'),
    JSON.stringify(r1.map(textOf)));
  const r2 = cellsOf(rows[2]);
  ok(`${label}: 개발 일정 빈 줄 하나(회색, 칸 이름 병합 계속)`, r2.length === 6 && vmOf(r2[1]) === 'continue'
    && r2.slice(1).every((tc) => shdOf(tc) === 'F2F2F2' && textOf(tc) === '') && JSON.stringify(r2.map(spanOf)) === '[1,1,1,1,1,2]');
  const r3 = cellsOf(rows[3]);
  ok(`${label}: 본문 칸 이름 줄 흰 바탕(수행 계획 2 / 수행 실적 3 / 수행 계획 1)`, r3.length === 4
    && JSON.stringify(r3.slice(1).map(textOf)) === JSON.stringify(['수행 계획', '수행 실적', '수행 계획'])
    && JSON.stringify(r3.slice(1).map(spanOf)) === '[2,3,1]' && r3.every((tc) => !shdOf(tc))
    && r3.slice(1).every((tc) => !!kid(runRPr(kids(tc, 'p')[0]), 'b')));
  const r4 = cellsOf(rows[4]);
  ok(`${label}: 본문 세 칸(계획 빈칸, 실적 글 그대로, 계획 빈칸)`, r4.length === 4 && JSON.stringify(r4.slice(1).map(spanOf)) === '[2,3,1]'
    && JSON.stringify(pTexts(r4[1])) === '[""]' && JSON.stringify(pTexts(r4[3])) === '[""]'
    && JSON.stringify(pTexts(r4[2])) === JSON.stringify(m.actual), JSON.stringify(pTexts(r4[2])));
  const hs = rows.map(heightOf);
  ok(`${label}: 줄 높이 348/344/346/380/6180(본문 최소 309pt)`, JSON.stringify(hs.map((h) => h[0])) === '[348,344,346,380,6180]' && hs[4][1] === 'atLeast');
  const cant = rows.map((tr) => !!kid(kid(tr, 'trPr'), 'cantSplit'));
  ok(`${label}: 머리 넷은 cantSplit, 본문 줄은 쪽 나눔 허용`, JSON.stringify(cant) === '[true,true,true,true,false]');
  ok(`${label}: 머리 넷의 모든 문단에 keepNext(본문 첫머리와 같은 쪽)`, rows.slice(0, 4).every((tr) => cellsOf(tr).every(hasKeepNext)));
});
if (ht[0] && rowsOf(ht[0]).length === 5) {
  const body0 = kids(cellsOf(rowsOf(ht[0])[4])[2], 'p');
  const ind = (p) => wattr(kid(kid(p, 'pPr') || p, 'ind'), 'left');
  ok('HW 본문 들여쓰기 0/284/568/852(글자는 그대로)', JSON.stringify(body0.slice(0, 4).map(ind)) === JSON.stringify([null, '284', '568', '852']),
    JSON.stringify(body0.slice(0, 4).map(ind)));
}
const he = ht[3];
if (he) {
  const rows = rowsOf(he);
  ok('HW 기타 표: 줄 3개', rows.length === 3, String(rows.length));
  if (rows.length === 3) {
    const r0 = cellsOf(rows[0]);
    ok('HW 기타 표: 기타 칸 세로 병합(끝까지)', textOf(r0[0]) === '기타' && vmOf(r0[0]) === 'restart'
      && rows.slice(1).every((tr) => vmOf(cellsOf(tr)[0]) === 'continue'));
    ok('HW 기타 표: 1줄 얇은 회색 빈 줄(2~3열, 4~7열, 글자 5pt, 높이 274)', r0.length === 3 && JSON.stringify(r0.map(spanOf)) === '[1,2,4]'
      && r0.slice(1).every((tc) => shdOf(tc) === 'F2F2F2' && textOf(tc) === '' && szOf(markRPr(kids(tc, 'p')[0])) === '10')
      && heightOf(rows[0])[0] === 274);
    const r1 = cellsOf(rows[1]);
    ok('HW 기타 표: 이름 줄(수행 계획 / 수행 실적 / 수행 계획, 흰 바탕)', r1.length === 4
      && JSON.stringify(r1.slice(1).map(textOf)) === JSON.stringify(['수행 계획', '수행 실적', '수행 계획']) && r1.every((tc) => !shdOf(tc)));
    const r2 = cellsOf(rows[2]);
    ok('HW 기타 표: 본문 세 칸(실적 = 기타 글, 계획 빈칸), 최소 156pt', r2.length === 4 && JSON.stringify(r2.slice(1).map(spanOf)) === '[2,3,1]'
      && JSON.stringify(pTexts(r2[1])) === '[""]' && JSON.stringify(pTexts(r2[3])) === '[""]'
      && JSON.stringify(pTexts(r2[2])) === JSON.stringify(['● 교육 참석', '- 사내 보안 교육 (9/24)', '● 매뉴얼 작성'])
      && heightOf(rows[2])[0] === 3120 && heightOf(rows[2])[1] === 'atLeast', JSON.stringify(pTexts(r2[2])));
  }
}
ok('HW 이스케이프 시료가 그대로 돌아오고 원문은 이스케이프돼 있다', hwAll.includes('A&B <태그> "따옴표"') && hwDoc.text.includes('A&amp;B &lt;태그&gt; &quot;따옴표&quot;'));

const hsect = hbl[hbl.length - 1];
const hsz = hsect && kid(hsect, 'pgSz'), hmar = hsect && kid(hsect, 'pgMar');
ok('HW A4 가로 16838 x 11906', wattr(hsz, 'w') === '16838' && wattr(hsz, 'h') === '11906' && wattr(hsz, 'orient') === 'landscape');
const mar = (a) => Number(wattr(hmar, a));
ok('HW 여백 왼쪽 1134, 위 1134, 아래 1134, 오른쪽 960', mar('left') === 1134 && mar('top') === 1134 && mar('bottom') === 1134 && mar('right') === 960,
  ['left', 'right', 'top', 'bottom'].map((a) => `${a}=${mar(a)}`).join(' '));
ok('HW 글 영역이 표 폭을 담는다(16838 - 왼쪽 - 오른쪽 >= 14726)', 16838 - mar('left') - mar('right') >= 14726, String(16838 - mar('left') - mar('right')));

finish();

function finish() {
  console.log('');
  console.log(`결과: 통과 ${pass} / 실패 ${fail}`);
  if (fail) { for (const f of F) console.log('  - ' + f); process.exit(1); }
  process.exit(0);
}
