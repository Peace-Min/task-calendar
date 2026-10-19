// 사용 가이드 영상 소개 페이지 만들기(이슈 #13).
//   dist/guide-video 의 MP4 네 편과 SRT 로 사내 배포용 폴더 하나(dist/guide-site)를 만든다.
//   결과 폴더: index.html(CSS, JS, 데이터가 모두 안에 있음) + MP4 네 편 + 같은 이름의 .vtt 자막.
//   외부 자원(CDN, 웹 글꼴, 외부 그림)을 쓰지 않는다. 폐쇄망의 웹 서버나 공유 폴더(file://)에 그대로 올린다.
//
// 실행(저장소 루트 기준 경로, 어디서 실행해도 같다):
//   node tools/guide-video/build-site.mjs [--version v3] [--out dist/guide-site] [--src dist/guide-video]
//
// 이 파일은 시험(tests/guide-site.test.mjs)이 순수 함수만 가져다 쓸 수 있게 export 하고,
// 직접 실행했을 때만 빌드한다.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const TEMPLATE_PATH = join(HERE, 'site', 'template.html');

// 영상 목록. 보이는 글은 korean-ai-punct 규칙을 따른다(줄표, 띄운 가운데 점, 낫표 없음).
export const GUIDES = [
  {
    id: 'overview', base: 'TaskCalendar_Overview', hero: true,
    title: '수행과제 캘린더 소개',
  },
  {
    id: 'schedule', base: 'TaskCalendar_Guide_ScheduleTodo',
    title: '일정과 할 일',
    desc: [
      '먼저 내 과제를 준비합니다. 회사 목록의 공식 과제를 연결하거나 일반 과제를 직접 만듭니다.',
      '그다음 날짜를 골라 그 과제로 일정을 추가하고, 할 일을 적어 체크로 완료합니다.',
    ],
  },
  {
    id: 'peer', base: 'TaskCalendar_Guide_PeerSchedules',
    title: '다른 사람 일정 보기',
    desc: [
      '같은 팀 동료의 일정을 따로 뜨는 창에서 읽기 전용으로 봅니다.',
      '겹쳐 보기와 나란히 보기로 내 일정과 견주고, 즐겨찾기로 자주 보는 사람을 빨리 엽니다.',
    ],
  },
  {
    id: 'report', base: 'TaskCalendar_Guide_Report',
    title: '보고서 작성',
    desc: [
      '캘린더에 남긴 기록으로 일간보고와 주간보고 초안을 만듭니다.',
      '과제마다 시간을 적고 글을 고친 뒤 복사해 씁니다. 영상에서는 회사 사이트로 보내지 않습니다.',
    ],
  },
];

export const SITE_TEXT = {
  product: '수행과제 캘린더',
  pageTitle: '수행과제 캘린더 사용 가이드',
  value: '과제별 일정과 할 일을 한 달 달력에 모으고, 그 기록으로 보고서 초안까지 만듭니다.',
  heroNote: '영상 네 편으로 주요 기능을 살펴봅니다. 소리 없이 화면 자막으로 안내합니다.',
};

// ── SRT 읽기와 WebVTT 바꾸기 ─────────────────────────────────────────
const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
function toSec(s) {
  const m = TIME_RE.exec(s);
  if (!m) throw new Error('시각을 읽지 못함: ' + s);
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000;
}
const r3 = (x) => Math.round(x * 1000) / 1000;

// SRT 글을 [{ start, end, text }] 로 읽는다(초 단위, 줄바꿈 CRLF 와 BOM 허용, 여러 줄 글은 \n 으로 잇는다).
export function parseSrt(src) {
  const text = String(src).replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  const cues = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').map((l) => l.trimEnd());
    let i = 0;
    if (lines[i] !== undefined && /^\d+$/.test(lines[i].trim()) && !lines[i].includes('-->')) i++;
    const tl = lines[i] || '';
    const parts = tl.split('-->');
    if (parts.length !== 2) continue;
    const body = lines.slice(i + 1).join('\n').trim();
    cues.push({ start: r3(toSec(parts[0])), end: r3(toSec(parts[1])), text: body });
  }
  return cues;
}

export function fmtVttTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, f = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(f, 3)}`;
}

// WebVTT 본문에서 & 와 < 는 그대로 쓸 수 없다.
const vttEscape = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function cuesToVtt(cues) {
  let out = 'WEBVTT\n';
  cues.forEach((c, i) => {
    out += `\n${i + 1}\n${fmtVttTime(c.start)} --> ${fmtVttTime(c.end)}\n${vttEscape(c.text)}\n`;
  });
  return out;
}
export const srtToVtt = (src) => cuesToVtt(parseSrt(src));

// ── 단계(장) 만들기 ────────────────────────────────────────────────
//  가이드 자막은 "3. 사람을 누르면 ..." 처럼 단계 번호로 시작한다. 같은 번호가 이어지는 자막을 한 단계로 묶는다.
//  번호가 없는 자막은 한 줄이 한 단계다. 단계가 max 보다 많으면 가장 짧은 단계(같으면 앞쪽)를
//  앞 단계에 합친다(첫 단계면 뒤 단계에). 입력이 같으면 결과도 늘 같다.
const NUM_RE = /^(\d+)\.\s*/;
const stripNum = (t) => t.replace(NUM_RE, '').replace(/\s*\n\s*/g, ' ').trim();

export function buildChapters(cues, { max = 10 } = {}) {
  const groups = [];
  let prevKey = null;
  for (const c of cues) {
    const m = NUM_RE.exec(c.text);
    const key = m ? m[1] : null;
    const last = groups[groups.length - 1];
    if (key !== null && last && prevKey === key) last.cues.push(c);
    else groups.push({ cues: [c] });
    prevKey = key;
  }
  const dur = (g) => g.cues[g.cues.length - 1].end - g.cues[0].start;
  while (groups.length > Math.max(1, max)) {
    let k = 0;
    for (let i = 1; i < groups.length; i++) if (dur(groups[i]) < dur(groups[k]) - 1e-9) k = i;
    const into = k === 0 ? 1 : k - 1;
    if (into < k) groups[into].cues.push(...groups[k].cues);
    else groups[into].cues.unshift(...groups[k].cues);
    groups.splice(k, 1);
  }
  return groups.map((g) => {
    const texts = g.cues.map((c) => stripNum(c.text)).filter(Boolean);
    const title = texts[0] || '';
    const details = [];
    for (const t of texts.slice(1)) if (t !== title && !details.includes(t)) details.push(t);
    return { start: g.cues[0].start, end: g.cues[g.cues.length - 1].end, title, details };
  });
}

// ── 화면 조각 ────────────────────────────────────────────────────
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtSize(bytes) {
  if (!(bytes > 0)) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)}MB` : `${mb.toFixed(1)}MB`;
}

function videoBlock(v, { hero = false } = {}) {
  const label = hero ? `${v.title} 영상` : `${v.title} 사용 가이드 영상`;
  const overlay = hero
    ? `\n        <button type="button" class="play-cover" data-play>
          <span class="play-icon" aria-hidden="true"></span>
          <span class="play-text">소개 영상 보기</span>
          <span class="play-dur" data-dur-short></span>
        </button>`
    : '';
  return `<div class="vslot${hero ? ' vslot-hero' : ''}" data-video="${esc(v.id)}">
      <div class="vframe">
        <video src="${esc(v.mp4)}" preload="metadata" muted playsinline controls aria-label="${esc(label)}">
          <track kind="subtitles" srclang="ko" label="한국어" src="${esc(v.vtt)}" default>
        </video>${overlay}
        <p class="vmsg" role="status" hidden></p>
      </div>
      <div class="vmeta">
        <span class="vdur" data-dur>길이 확인 중</span>
        ${v.size ? `<a class="dl" href="${esc(v.mp4)}" download>MP4 내려받기 <span class="dl-size">${esc(fmtSize(v.size))}</span></a>` : ''}
      </div>
    </div>`;
}

function stepsBlock(v) {
  const items = v.chapters.map((c, i) => {
    const sub = c.details.length ? `<span class="step-sub">${c.details.map(esc).join('<br>')}</span>` : '';
    return `<li><button type="button" class="step" data-t="${c.start}">
            <span class="step-no" aria-hidden="true">${i + 1}</span>
            <span class="step-body"><span class="step-title">${esc(c.title)}</span>${sub}</span>
            <span class="step-time"><span class="sr">시작 </span>${fmtClock(c.start)}</span>
          </button></li>`;
  }).join('\n          ');
  return `<div class="steps-panel">
      <div class="steps-scroll">
        <p class="steps-head" id="${esc(v.id)}-steps-h">단계 <span class="steps-count">${v.chapters.length}</span> <span class="steps-hint">누르면 그 장면부터 재생합니다</span></p>
        <ol class="steps" aria-labelledby="${esc(v.id)}-steps-h">
          ${items}
        </ol>
      </div>
    </div>`;
}

export function renderPage(template, { videos, version, builtOn }) {
  const hero = videos.find((v) => v.hero);
  const guides = videos.filter((v) => !v.hero);
  const nav = guides.map((v, i) => `<a href="#${esc(v.id)}">${i + 1}. ${esc(v.title)}</a>`).join('\n        ')
    + '\n        <a href="#help">설치와 문의</a>';
  const sections = guides.map((v, i) => `<section class="guide" id="${esc(v.id)}" aria-labelledby="${esc(v.id)}-h">
    <header class="guide-head">
      <span class="guide-no" aria-hidden="true">${i + 1}</span>
      <div>
        <h2 id="${esc(v.id)}-h">${esc(v.title)}</h2>
        ${v.desc.map((d) => `<p>${esc(d)}</p>`).join('\n        ')}
      </div>
    </header>
    <div class="guide-grid">
    ${videoBlock(v)}
    ${stepsBlock(v)}
    </div>
  </section>`).join('\n\n  ');

  const data = {
    version,
    videos: Object.fromEntries(videos.map((v) => [v.id, { mp4: v.mp4, cues: v.cues.map((c) => [c.start, c.end, c.text]) }])),
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));

  const map = {
    '{{PAGE_TITLE}}': esc(SITE_TEXT.pageTitle),
    '{{PRODUCT}}': esc(SITE_TEXT.product),
    '{{VALUE}}': esc(SITE_TEXT.value),
    '{{HERO_NOTE}}': esc(SITE_TEXT.heroNote),
    '{{NAV}}': nav,
    '{{HERO_VIDEO}}': hero ? videoBlock(hero, { hero: true }) : '',
    '{{SECTIONS}}': sections,
    '{{BUILD_INFO}}': esc(`영상 ${version}, 페이지 생성 ${builtOn}`),
  };
  let out = template;
  for (const [k, val] of Object.entries(map)) {
    if (!out.includes(k)) throw new Error('템플릿에 자리 표시가 없음: ' + k);
    out = out.split(k).join(val);
  }
  const DATA_MARK = '/*__GUIDE_DATA__*/null';
  if (!out.includes(DATA_MARK)) throw new Error('템플릿에 데이터 자리 표시가 없음');
  out = out.replace(DATA_MARK, () => json);
  return out;
}

// 빌드에 쓰는 영상 정보(파일이 없으면 cues 는 빈 배열, size 는 0).
export function collectVideos(srcDir, version) {
  return GUIDES.map((g) => {
    const name = `${g.base}_${version}`;
    const mp4Path = join(srcDir, name + '.mp4');
    const srtPath = join(srcDir, name + '.srt');
    const cues = existsSync(srtPath) ? parseSrt(readFileSync(srtPath, 'utf8')) : [];
    return {
      ...g, desc: g.desc || [],
      name, mp4: name + '.mp4', vtt: name + '.vtt', mp4Path, srtPath,
      size: existsSync(mp4Path) ? statSync(mp4Path).size : 0,
      cues, chapters: g.hero ? [] : buildChapters(cues),
    };
  });
}

function parseArgs(argv) {
  const o = { version: 'v3', out: 'dist/guide-site', src: 'dist/guide-video' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => { const v = argv[++i]; if (v === undefined) throw new Error(a + ' 뒤에 값이 필요합니다'); return v; };
    if (a === '--version') o.version = take();
    else if (a === '--out') o.out = take();
    else if (a === '--src') o.src = take();
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error('알 수 없는 인자: ' + a);
  }
  return o;
}
const fromRepo = (p) => (isAbsolute(p) ? p : resolve(REPO, p));
const localDate = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

export function build({ version = 'v3', out = 'dist/guide-site', src = 'dist/guide-video', log = console.log } = {}) {
  const srcDir = fromRepo(src), outDir = fromRepo(out);
  if (!existsSync(srcDir)) throw new Error('영상 폴더가 없습니다: ' + srcDir);
  mkdirSync(outDir, { recursive: true });
  // 지난 빌드가 남긴 결과물만 지운다(다른 파일은 건드리지 않는다).
  for (const f of readdirSync(outDir)) {
    if (f === 'index.html' || /\.(mp4|vtt)$/i.test(f)) unlinkSync(join(outDir, f));
  }
  const videos = collectVideos(srcDir, version);
  const warnings = [];
  for (const v of videos) {
    if (v.size > 0) copyFileSync(v.mp4Path, join(outDir, v.mp4));
    else warnings.push(`영상 없음: ${v.mp4Path} (페이지는 그 자리에 안내 문구를 보여 줍니다)`);
    if (existsSync(v.srtPath)) writeFileSync(join(outDir, v.vtt), srtToVtt(readFileSync(v.srtPath, 'utf8')), 'utf8');
    else warnings.push(`자막 없음: ${v.srtPath}`);
    if (!v.hero && v.chapters.length && (v.chapters.length < 5 || v.chapters.length > 10)) warnings.push(`${v.name}: 단계 ${v.chapters.length}개(5~10 밖)`);
  }
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const html = renderPage(template, { videos, version, builtOn: localDate() });
  writeFileSync(join(outDir, 'index.html'), html, 'utf8');

  const files = readdirSync(outDir).filter((f) => statSync(join(outDir, f)).isFile()).sort();
  let total = 0;
  log(`출력 폴더: ${outDir}`);
  for (const f of files) {
    const sz = statSync(join(outDir, f)).size; total += sz;
    log(`  ${f.padEnd(48)} ${(sz / 1024).toFixed(1).padStart(10)} KB`);
  }
  log(`합계 ${files.length}개, ${(total / (1024 * 1024)).toFixed(1)} MB`);
  for (const v of videos.filter((x) => !x.hero)) log(`  단계 ${String(v.chapters.length).padStart(2)}개: ${v.title}`);
  for (const w of warnings) log('경고: ' + w);
  return { outDir, files, total, videos, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.help) {
      console.log('node tools/guide-video/build-site.mjs [--version v3] [--out dist/guide-site] [--src dist/guide-video]');
      process.exit(0);
    }
    build(o);
  } catch (e) {
    console.error('실패: ' + e.message);
    process.exit(1);
  }
}
