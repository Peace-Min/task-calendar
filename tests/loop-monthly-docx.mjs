#!/usr/bin/env node
/* ============================================================================
 *  tests/loop-monthly-docx.mjs: 월간보고 DOCX 생성기(widget/DocxWriter.cs) 산출물 검사
 * ----------------------------------------------------------------------------
 *  기본 실행(run-tests.mjs)에 들지 않는다. dotnet 빌드가 필요하기 때문이다(이름이 *.test.mjs 가 아니라 러너가 줍지 않는다).
 *  하는 일:
 *    1) tests/tools/monthly-docx-mock 을 dotnet run 으로 돌려 임시 폴더에 mock.docx 를 만든다(지어낸 값).
 *    2) 외부 패키지 없이 ZIP 을 직접 읽는다(끝 레코드 EOCD, 중앙 디렉터리, inflateRawSync).
 *    3) 모든 .xml, .rels 를 jsdom DOMParser(application/xml)로 파싱한다. parsererror 면 실패.
 *    4) 구조를 본다: [Content_Types].xml 첫 엔트리, 제목 문단, 과제 표 수와 기타 표, 줄마다 gridSpan 합 = 7,
 *       tcW = 걸친 격자 폭 합, 세로 병합 모양, 기대 글자, 그림 관계와 콘텐츠 형식, A4 가로 구역.
 *  Word 나 한컴에서 실제로 열어 보는 것은 대신하지 못한다(스키마 순서와 렌더링은 사람이 확인).
 *
 *  실행(저장소 루트에서): node tests/loop-monthly-docx.mjs
 *  종료코드: 0 통과, 1 실패, 2 판정 불가(dotnet 실행 실패, jsdom 없음).
 * ==========================================================================*/
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const work = mkdtempSync(join(tmpdir(), 'monthly-docx-'));
const out = join(work, 'mock.docx');
console.log('[1] dotnet run (monthly-docx-mock)');
const run = spawnSync('dotnet', ['run', '--project', join(root, 'tests', 'tools', 'monthly-docx-mock'), '--', out],
  { cwd: root, encoding: 'utf8', timeout: 300000 });
if (run.status !== 0) {
  console.error(run.stdout || ''); console.error(run.stderr || '');
  console.error(`[판정 불가] 목업 실행 실패(exit ${run.status})`);
  rmSync(work, { recursive: true, force: true });
  process.exit(2);
}
let buf;
try { buf = readFileSync(out); } finally { rmSync(work, { recursive: true, force: true }); }
console.log(`  mock.docx ${buf.length} bytes`);

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

console.log('[2] ZIP 구조');
let entries = [];
try { entries = readZip(buf); ok('ZIP 을 읽었다', true, `${entries.length}개 엔트리`); }
catch (e) { ok('ZIP 을 읽었다', false, e.message); }
const byName = new Map(entries.map((e) => [e.name, e]));
ok('[Content_Types].xml 이 중앙 디렉터리 첫 엔트리', entries[0] && entries[0].name === '[Content_Types].xml', entries[0] && entries[0].name);
const firstLocal = entries.slice().sort((a, b) => a.local - b.local)[0];
ok('[Content_Types].xml 이 파일 맨 앞(로컬 헤더 0)', firstLocal && firstLocal.name === '[Content_Types].xml' && firstLocal.local === 0);
ok('디렉터리 엔트리가 없다', entries.every((e) => !e.name.endsWith('/')));
ok('경로에 역슬래시가 없다', entries.every((e) => !e.name.includes('\\')));
for (const need of ['_rels/.rels', 'docProps/core.xml', 'docProps/app.xml', 'word/document.xml', 'word/styles.xml',
  'word/settings.xml', 'word/_rels/document.xml.rels']) {
  ok(`파트 있음: ${need}`, byName.has(need));
}

// ── 3) XML 파싱 ──────────────────────────────────────────────────────
console.log('[3] XML 파싱');
const docs = new Map();
for (const e of entries) {
  if (!/\.(xml|rels)$/.test(e.name)) continue;
  const bom = e.data[0] === 0xef && e.data[1] === 0xbb && e.data[2] === 0xbf;
  const text = e.data.toString('utf8');
  const d = new DOMParser().parseFromString(text, 'application/xml');
  const bad = d.getElementsByTagName('parsererror').length > 0;
  const decl = /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>/.test(text);
  ok(`파싱: ${e.name}`, !bad && !bom && decl, bad ? 'parsererror' : bom ? 'BOM 있음' : decl ? '' : '선언 없음');
  docs.set(e.name, { d, text });
}

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
ok('과제 표 3개(목업 과제 수) + 기타 표 1개', projTables.length === 3 && etcTables.length === 1 && tables.length === 4,
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
  ok(`${label}: tblW 13788 dxa, 고정 레이아웃`, wattr(tblW, 'w') === '13788' && wattr(tblW, 'type') === 'dxa'
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

finish();

function finish() {
  console.log('');
  console.log(`결과: 통과 ${pass} / 실패 ${fail}`);
  if (fail) { for (const f of F) console.log('  - ' + f); process.exit(1); }
  process.exit(0);
}
