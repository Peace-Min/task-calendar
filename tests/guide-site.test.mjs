// Layer 1: 사용 가이드 영상 소개 페이지(tools/guide-video/build-site.mjs, site/template.html, 이슈 #13).
//   영상 파일 없이 틀과 순수 함수만 본다(dist 가 없는 새 클론에서도 돈다).
//
// 왜 있나
//   이 페이지는 폐쇄망 사내 서버나 공유 폴더에 폴더째 올린다. 외부 주소가 하나라도 끼면 그 자리가 깨지거나
//   밖으로 요청이 나간다. 자막 변환이 틀리면 자막이 안 나오고, 단계 목록이 실행마다 달라지면 검토가 어렵다.
//   그래서 못 박는다:
//     (A) 틀과 만든 페이지에 외부 주소가 없다(http, https, //로 시작하는 주소, @import, 외부 url())
//     (B) SRT 를 WebVTT 로 바르게 바꾼다(BOM, CRLF, 여러 줄, &와 <, 시각 형식)
//     (C) 단계 만들기는 결정적이고 규칙대로 묶는다(같은 번호 묶기, 10개 넘으면 가장 짧은 단계를 앞에 합침)
//     (D) 보이는 글에 줄표, 띄운 가운데 점, 낫표가 없다(korean-ai-punct)
//     (E) 페이지 골격: 단계는 button, 자막 트랙 속성, 영상 없음 안내, 배포 담당자 설정 한 곳
//   (A)와 (D)는 변이 주입으로 검사가 정말 잡는지 함께 본다.
import { test, assert } from './harness.mjs';
import { readFileSync } from 'node:fs';
import {
  TEMPLATE_PATH, GUIDES, SITE_TEXT, parseSrt, srtToVtt, cuesToVtt, buildChapters, renderPage, fmtVttTime,
} from '../tools/guide-video/build-site.mjs';

const template = readFileSync(TEMPLATE_PATH, 'utf8');

// ── 검사기 ───────────────────────────────────────────────────────────
function externalRefs(html) {
  const hits = [];
  const add = (re, what) => { for (const m of html.matchAll(re)) hits.push(`${what}: ${m[0].slice(0, 60)}`); };
  add(/https?:\/\//gi, '절대 주소');
  add(/\b(?:src|href|poster|action|data)\s*=\s*["']?\s*\/\//gi, '// 주소');
  add(/@import/gi, '@import');
  add(/url\(\s*["']?(?!data:)[^)"']+/gi, 'CSS url()');
  add(/<(?:link)\b[^>]*rel=["']?stylesheet/gi, '외부 스타일시트');
  add(/<script\b[^>]*\bsrc=/gi, '외부 스크립트');
  return hits;
}
const PUNCT = [
  [/—/, '엠 대시'], [/–/, 'en 대시'], [/「|」|『|』/, '낫표'], [/(^|\s)·|·(\s|$)/m, '띄운 가운데 점'],
];
const punctOf = (text) => PUNCT.filter(([re]) => re.test(text)).map(([, n]) => n);
function visibleText(html) {
  const attrs = [...html.matchAll(/\b(?:title|aria-label|alt|placeholder|label)="([^"]*)"/g)].map((m) => m[1]);
  const body = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
  const scriptStrings = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .flatMap((m) => [...m[1].matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((x) => x[1]));
  return [body, ...attrs, ...scriptStrings].join('\n');
}

// ── 시험용 자료 ─────────────────────────────────────────────────────
const SAMPLE_SRT = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\n1. 첫 줄 & <b>\r\n둘째 줄\r\n\r\n2\r\n00:01:02,050 --> 00:01:04,000\r\n2. 다음\r\n';
const cue = (n, s, e, t) => `${n}\n00:00:${String(s).padStart(2, '0')},000 --> 00:00:${String(e).padStart(2, '0')},000\n${t}\n`;
function sampleVideos() {
  const cues = [
    { start: 3, end: 5, text: '1. 툴바의 내 과제를 엽니다' },
    { start: 5.2, end: 7, text: '1. 과제는 두 가지입니다' },
    { start: 7.2, end: 9, text: '2. 날짜를 고릅니다' },
    { start: 9.2, end: 12, text: '3. 일정을 추가합니다' },
    { start: 12.2, end: 15, text: '4. 할 일을 체크합니다' },
    { start: 15.2, end: 18, text: '5. 다시 누르면 되돌아옵니다' },
  ];
  return GUIDES.map((g) => ({
    ...g, desc: g.desc || [], mp4: `${g.base}_v9.mp4`, vtt: `${g.base}_v9.vtt`, size: 12345678,
    cues: g.hero ? [{ start: 1, end: 2, text: '한 달이 한눈에' }] : cues,
    chapters: g.hero ? [] : buildChapters(cues),
  }));
}
const rendered = renderPage(template, { videos: sampleVideos(), version: 'v9', builtOn: '2026-10-19' });

// ── (A) 외부 주소 ───────────────────────────────────────────────────
test('guide-site(A): 틀(template.html)에 외부 주소가 하나도 없다', () => {
  assert.deepStrictEqual(externalRefs(template), []);
});
test('guide-site(A): 만든 페이지에 외부 주소가 없고, src/href 는 같은 폴더 파일, #, data: 뿐이다', () => {
  assert.deepStrictEqual(externalRefs(rendered), []);
  const refs = [...rendered.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 10, '주소 수집이 너무 적다: ' + refs.length);
  const bad = refs.filter((r) => !(r.startsWith('#') || r.startsWith('data:') || /^[\w.-]+\.(mp4|vtt)$/.test(r)));
  assert.deepStrictEqual(bad, []);
});
test('guide-site(A) 변이: 외부 주소를 넣으면 검사기가 잡는다', () => {
  assert.ok(externalRefs(template.replace('</head>', '<link rel="stylesheet" href="https://cdn.example/x.css"></head>')).length > 0);
  assert.ok(externalRefs(template.replace('</head>', '<script src="//cdn.example/x.js"></script></head>')).length > 0);
  assert.ok(externalRefs(template.replace('</style>', 'body{background:url(img/bg.png)}</style>')).length > 0);
});

// ── (B) SRT 를 WebVTT 로 ────────────────────────────────────────────
test('guide-site(B): SRT 를 WebVTT 로 바르게 바꾼다', () => {
  const expected = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\n1. 첫 줄 &amp; &lt;b&gt;\n둘째 줄\n\n2\n00:01:02.050 --> 00:01:04.000\n2. 다음\n';
  assert.strictEqual(srtToVtt(SAMPLE_SRT), expected);
  const cues = parseSrt(SAMPLE_SRT);
  assert.deepStrictEqual(cues, [
    { start: 1, end: 2.5, text: '1. 첫 줄 & <b>\n둘째 줄' },
    { start: 62.05, end: 64, text: '2. 다음' },
  ]);
  assert.strictEqual(fmtVttTime(3725.5), '01:02:05.500');
  assert.strictEqual(cuesToVtt([]), 'WEBVTT\n');
  assert.deepStrictEqual(parseSrt(''), []);
});

// ── (C) 단계 만들기 ─────────────────────────────────────────────────
test('guide-site(C): 같은 번호의 자막을 한 단계로 묶고, 번호를 떼고, 나머지는 설명 줄이 된다', () => {
  const ch = buildChapters(parseSrt(
    cue(1, 1, 2, '1. 열기') + '\n' + cue(2, 3, 4, '1. 고르기') + '\n' + cue(3, 5, 6, '2. 저장') + '\n' + cue(4, 7, 8, '번호 없음')));
  assert.deepStrictEqual(ch, [
    { start: 1, end: 4, title: '열기', details: ['고르기'] },
    { start: 5, end: 6, title: '저장', details: [] },
    { start: 7, end: 8, title: '번호 없음', details: [] },
  ]);
});
test('guide-site(C): 10개를 넘으면 가장 짧은 단계를 앞 단계에 합치고(첫 단계면 뒤에), 결과는 늘 같다', () => {
  // 12단계: 길이 2초씩, 5번(1초)과 1번(1.5초)이 짧다. 먼저 5번이 4번에, 그다음 1번이 2번에 합쳐진다.
  const cs = [];
  let t = 0;
  for (let n = 1; n <= 12; n++) { const d = n === 5 ? 1 : n === 1 ? 1.5 : 2; cs.push({ start: t, end: t + d, text: `${n}. 단계 ${n}` }); t += d + 0.5; }
  const a = buildChapters(cs), b = buildChapters(cs.map((c) => ({ ...c })));
  assert.deepStrictEqual(a, b, '같은 입력이면 같은 결과');
  assert.strictEqual(a.length, 10);
  assert.strictEqual(a[0].title, '단계 1');
  assert.deepStrictEqual(a[0].details, ['단계 2']);
  assert.strictEqual(a[2].title, '단계 4');
  assert.deepStrictEqual(a[2].details, ['단계 5']);
  assert.strictEqual(JSON.stringify(buildChapters(cs, { max: 10 })), JSON.stringify(a));
  // 시작 시각은 오름차순
  for (let i = 1; i < a.length; i++) assert.ok(a[i].start > a[i - 1].start);
});

// ── (D) 기호 ────────────────────────────────────────────────────────
test('guide-site(D): 보이는 글(틀, 만든 페이지, 영상 설명)에 줄표, 띄운 가운데 점, 낫표가 없다', () => {
  const texts = {
    template: template,
    rendered: visibleText(rendered),
    guides: JSON.stringify(GUIDES) + JSON.stringify(SITE_TEXT),
  };
  for (const [k, v] of Object.entries(texts)) assert.deepStrictEqual(punctOf(v), [], k);
  // 화면 글이 실제로 수집되는지(검사기가 눈을 감지 않게)
  const vis = visibleText(rendered);
  for (const must of ['수행과제 캘린더', '일정과 할 일', '다른 사람 일정 보기', '보고서 작성', '영상 파일을 찾을 수 없습니다', '배포 담당자 입력', '한국어']) {
    assert.ok(vis.includes(must), '보이는 글에 없음: ' + must);
  }
});
test('guide-site(D) 변이: 보이는 글에 금지 기호를 넣으면 잡는다', () => {
  assert.deepStrictEqual(punctOf(visibleText(rendered.replace('보고서 작성</h2>', '보고서 「작성」</h2>'))), ['낫표']);
  assert.deepStrictEqual(punctOf(visibleText(rendered.replace('설치와 문의</a>', '설치 · 문의</a>'))), ['띄운 가운데 점']);
  assert.deepStrictEqual(punctOf(visibleText(rendered.replace("'다시 보기'", "'다시 — 보기'"))), ['엠 대시']);
  assert.deepStrictEqual(punctOf('직급·소속'), [], '붙여 쓴 짝 이름은 허용');
});

// ── (E) 골격 ────────────────────────────────────────────────────────
test('guide-site(E): 영상 네 편, 단계는 button, 자막 트랙 속성, 데이터 자리 표시가 모두 채워졌다', () => {
  assert.strictEqual((rendered.match(/<video\b/g) || []).length, 4);
  const tracks = rendered.match(/<track\b[^>]*>/g) || [];
  assert.strictEqual(tracks.length, 4);
  for (const t of tracks) {
    for (const a of ['kind="subtitles"', 'srclang="ko"', 'label="한국어"', ' default']) assert.ok(t.includes(a), t + ' 에 ' + a + ' 없음');
  }
  const steps = rendered.match(/<button type="button" class="step" data-t="[\d.]+">/g) || [];
  assert.strictEqual(steps.length, 15, '세 가이드 x 5단계');
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(rendered), '남은 자리 표시');
  assert.ok(!rendered.includes('/*__GUIDE_DATA__*/'), '데이터 자리 표시가 남음');
  assert.ok(/<\/script>/.test(rendered) && !/<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/.test(rendered), '스크립트는 한 덩어리');
  assert.ok(/<a class="dl" href="TaskCalendar_Guide_Report_v9\.mp4" download>/.test(rendered));
});
test('guide-site(E): 배포 담당자가 고칠 곳은 SITE_CONFIG 한 곳이고, 회사 주소나 이름이 박혀 있지 않다', () => {
  assert.strictEqual((template.match(/var SITE_CONFIG = \{/g) || []).length, 1);
  const cfg = /var SITE_CONFIG = (\{[\s\S]*?\n\});/.exec(template)[1];
  for (const k of ['installTitle', 'installText', 'installLink', 'contactTitle', 'contactText', 'subtitles']) assert.ok(cfg.includes(k + ':'), k);
  assert.ok(/installText: ''/.test(cfg) && /contactText: ''/.test(cfg) && /installLink: ''/.test(cfg), '배포 전 빈칸으로 둔다');
  assert.ok(!/netcus|넷커스/i.test(template + JSON.stringify(GUIDES)), '회사 이름');
});
test('guide-site(E): 데이터 JSON 이 </script> 로 스크립트를 끊지 못한다', () => {
  const vs = sampleVideos();
  vs[1].cues = [{ start: 1, end: 2, text: '</script><b>x' }];
  const html = renderPage(template, { videos: vs, version: 'v9', builtOn: '2026-10-19' });
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  assert.ok(!script.includes('</script'), 'JSON 안의 </script>');
  assert.ok(script.includes('\\u003c/script>'));
});
