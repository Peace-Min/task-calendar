// 소개 페이지(dist/guide-site) 확인: 헤드리스 Edge 를 CDP 로 띄워 file:// 과 http:// 로 열어 본다.
//   확인하는 것: 콘솔 오류 없음, 외부 호스트 요청 없음, 영상 메타데이터(길이 > 0), 자막 트랙 읽힘,
//   단계 누르기(마우스와 키보드)로 재생 위치가 바뀌고 현재 단계가 표시됨, 좁은 화면에서 가로 넘침 없음,
//   영상 파일이 없을 때 그 자리에 안내 문구가 나옴. 스크린샷(밝은 화면, 어두운 화면, 390px)을 남긴다.
//
// 실행(저장소 루트 기준, 먼저 build-site.mjs 로 만든다):
//   node tools/guide-video/site/check-site.mjs [--site dist/guide-site] [--shots dist/guide-site-shots] [--scratch <임시 폴더>] [--port 9566]
// 종료코드: 0 통과, 1 실패. 띄운 Edge 는 끝에서 닫는다(이 스크립트가 띄운 것만).
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, readdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, isAbsolute, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Cdp, sleep } from '../lib/cdp.mjs';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const fromRepo = (p) => (isAbsolute(p) ? p : resolve(REPO, p));
const SITE = fromRepo(opt('--site', 'dist/guide-site'));
const SHOTS = fromRepo(opt('--shots', 'dist/guide-site-shots'));
const PORT = Number(opt('--port', '9566'));
const SCRATCH = resolve(opt('--scratch', join(tmpdir(), 'guide-site-check-' + Math.random().toString(36).slice(2, 8))));
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

if (!existsSync(join(SITE, 'index.html'))) { console.error('index.html 이 없습니다. 먼저 build-site.mjs 를 실행하세요: ' + SITE); process.exit(1); }
if (!EDGE) { console.error('msedge.exe 를 찾지 못했습니다'); process.exit(1); }
mkdirSync(SCRATCH, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

// ── 아주 작은 정적 서버(Range 지원, 영상 탐색에 필요) ──────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8' };
function serve(root) {
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const f = join(root, p);
    if (!f.startsWith(root) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
    const size = statSync(f).size;
    const type = TYPES[extname(f).toLowerCase()] || 'application/octet-stream';
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 });
      createReadStream(f, { start: a, end: b }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
      createReadStream(f).pipe(res);
    }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// ── Edge ─────────────────────────────────────────────────────────────
const profile = join(SCRATCH, 'profile');
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

async function waitJson(path, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch {}
    await sleep(250);
  }
  throw new Error('Edge 디버그 포트 응답 없음');
}

let cdp, browserWs, server;
const reqs = [], consoleErrors = [];

async function openTarget() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  const t = await r.json();
  const c = await new Cdp(t).open();
  c.on('Network.requestWillBeSent', (p) => reqs.push(p.request.url));
  c.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') consoleErrors.push('console.' + p.type + ': ' + p.args.map((a) => a.value ?? a.description).join(' ')); });
  c.on('Runtime.exceptionThrown', (p) => consoleErrors.push('exception: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text)));
  c.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') consoleErrors.push('log: ' + p.entry.text + (p.entry.url ? ' ' + p.entry.url : '')); });
  await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable'); await c.send('Log.enable');
  return c;
}

async function load(url) {
  reqs.length = 0; consoleErrors.length = 0;
  let loaded = false;
  cdp.on('Page.loadEventFired', () => { loaded = true; });
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 100 && !loaded; i++) await sleep(100);
  // 메타데이터와 자막을 기다린다(최대 15초).
  for (let i = 0; i < 60; i++) {
    const done = await cdp.ev(`[...document.querySelectorAll('video')].every(v => v.closest('.is-missing') || (v.readyState >= 1 && v.duration > 0 && v.textTracks[0] && v.textTracks[0].cues && v.textTracks[0].cues.length > 0))`);
    if (done) break;
    await sleep(250);
  }
}

const state = () => cdp.ev(`[...document.querySelectorAll('.vslot')].map(s => { const v = s.querySelector('video'); const tr = v.querySelector('track'); const t = v.textTracks[0];
  return { id: s.dataset.video, missing: s.classList.contains('is-missing'), msg: s.querySelector('.vmsg').hidden ? '' : s.querySelector('.vmsg').textContent,
    dur: v.duration, rs: v.readyState, cues: t && t.cues ? t.cues.length : 0, mode: t ? t.mode : '', inline: !!tr.getAttribute('data-inline'), trackState: tr.readyState,
    firstLine: t && t.cues && t.cues[0] ? t.cues[0].line : null }; })`);

function externalOf(list, allowHttpOrigin) {
  return list.filter((u) => !(u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:') || (allowHttpOrigin && u.startsWith(allowHttpOrigin))));
}

async function clickCenter(sel) {
  const box = await cdp.ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); b.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await sleep(150);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  }
}

async function checkSteps(label) {
  // 마우스: 일정과 할 일의 5번째 단계
  const sel = '#schedule .step:nth-child(1)';
  const t5 = await cdp.ev(`+document.querySelectorAll('#schedule .step')[4].dataset.t`);
  const before = await cdp.ev(`document.querySelector('#schedule video').currentTime`);
  await clickCenter('#schedule li:nth-child(5) .step');
  await sleep(1200);
  const after = await cdp.ev(`(() => { const v = document.querySelector('#schedule video'); const cur = [...document.querySelectorAll('#schedule .step')].findIndex(b => b.classList.contains('is-current')); return { t: v.currentTime, paused: v.paused, cur, aria: document.querySelectorAll('#schedule .step[aria-current=step]').length }; })()`);
  ok(`${label}: 단계 누르기(마우스)로 재생 위치 이동`, after.t >= t5 - 0.4 && after.t < t5 + 3 && after.t !== before, `단계 시작 ${t5}s, 이동 후 ${after.t.toFixed(2)}s, 재생 중 ${!after.paused}`);
  ok(`${label}: 현재 단계 표시`, after.cur === 4 && after.aria === 1, `is-current 위치 ${after.cur + 1}`);
  // 재생 중 다음 단계로 넘어가면 표시도 따라간다
  const t6 = await cdp.ev(`+document.querySelectorAll('#schedule .step')[5].dataset.t`);
  await cdp.ev(`(() => { const v = document.querySelector('#schedule video'); v.currentTime = ${t6} + 0.5; return 1; })()`);
  await sleep(700);
  const cur2 = await cdp.ev(`[...document.querySelectorAll('#schedule .step')].findIndex(b => b.classList.contains('is-current'))`);
  ok(`${label}: 재생 위치를 따라 현재 단계가 바뀜`, cur2 === 5, `is-current 위치 ${cur2 + 1}`);
  // 키보드: 보고서 3번째 단계에 초점을 두고 Enter
  const t3 = await cdp.ev(`(() => { const b = document.querySelectorAll('#report .step')[2]; b.scrollIntoView({ block: 'center' }); b.focus(); return +b.dataset.t; })()`);
  for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
  await sleep(1000);
  const k = await cdp.ev(`(() => { const v = document.querySelector('#report video'); return { t: v.currentTime, focus: document.activeElement && document.activeElement.classList.contains('step'), sch: document.querySelector('#schedule video').paused }; })()`);
  ok(`${label}: 단계 누르기(키보드 Enter)로 재생 위치 이동`, k.t >= t3 - 0.4 && k.t < t3 + 3 && k.focus, `단계 시작 ${t3}s, 이동 후 ${k.t.toFixed(2)}s`);
  ok(`${label}: 다른 영상이 재생되면 앞 영상은 멈춤`, k.sch === true);
  await cdp.ev(`document.querySelectorAll('video').forEach(v => v.pause()), 1`);
}

async function shot(name, { width, height = 900, mobile = false, dark = false }) {
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await cdp.ev(`(() => { window.scrollTo(0, 0); document.activeElement && document.activeElement.blur(); document.querySelectorAll('video').forEach(v => { v.pause(); if (v.duration > 6) v.currentTime = v.closest('.vslot-hero') ? 3 : 7; }); return 1; })()`);
  await sleep(1200);
  const full = await cdp.ev(`Math.ceil(document.documentElement.scrollHeight)`);
  const overflowX = await cdp.ev(`document.documentElement.scrollWidth - window.innerWidth`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: full, deviceScaleFactor: 1, mobile });
  await sleep(900);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = join(SHOTS, name);
  writeFileSync(file, Buffer.from(data, 'base64'));
  // 첫 화면만 따로(보기 편하게)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await sleep(400);
  const top = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const topFile = file.replace(/\.png$/, '_top.png');
  writeFileSync(topFile, Buffer.from(top.data, 'base64'));
  return { file, topFile, overflowX, full };
}

let exitCode = 1;
try {
  const ver = await waitJson('/json/version');
  browserWs = ver.webSocketDebuggerUrl;
  console.log(`Edge: ${ver.Browser}, 사이트: ${SITE}`);
  cdp = await openTarget();
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // 1) file://
  const fileUrl = pathToFileURL(join(SITE, 'index.html')).href;
  await load(fileUrl);
  let st = await state();
  console.log(JSON.stringify(st));
  ok('file: 영상 네 편 메타데이터(길이 > 0)', st.length === 4 && st.every((s) => s.dur > 0 && !s.missing), st.map((s) => `${s.id} ${s.dur?.toFixed(1)}s`).join(', '));
  ok('file: 자막 트랙 읽힘(cue 수 > 0, 기본은 꺼 둠: 영상 화면에 자막이 이미 있다)', st.every((s) => s.cues > 0 && s.mode === 'hidden'), st.map((s) => `${s.id} ${s.cues}개${s.inline ? '(페이지 안 자막)' : ''}`).join(', '));
  ok('file: 자막을 위쪽에 띄움(line 0)', st.every((s) => s.firstLine === 0));
  await checkSteps('file');
  const helpTodo = await cdp.ev(`document.querySelectorAll('#help .todo').length`);
  ok('file: 설치 안내와 문의 자리 표시(배포 담당자 입력) 보임', helpTodo === 2);
  ok('file: 외부 호스트 요청 없음', externalOf(reqs).length === 0, `요청 ${reqs.length}건, 외부 ${externalOf(reqs).length}건 ${externalOf(reqs).slice(0, 3).join(' ')}`);
  ok('file: 콘솔 오류 없음', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  // 스크린샷(file:// 상태로)
  const light = await shot('guide-site_light_1440.png', { width: 1440 });
  const dark = await shot('guide-site_dark_1440.png', { width: 1440, dark: true });
  const mob = await shot('guide-site_mobile_390.png', { width: 390, height: 844, mobile: true });
  const laptop = await shot('guide-site_light_1280x720.png', { width: 1280, height: 720 });
  ok('390px: 가로 넘침 없음', mob.overflowX <= 0, `scrollWidth - innerWidth = ${mob.overflowX}`);
  ok('1440px, 1280px: 가로 넘침 없음', light.overflowX <= 0 && laptop.overflowX <= 0 && dark.overflowX <= 0);
  const mobLayout = await (async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(300);
    return cdp.ev(`(() => { const f = document.querySelector('#schedule .vframe').getBoundingClientRect(); const s = document.querySelector('#schedule .steps-panel').getBoundingClientRect(); return { ratio: f.width / f.height, below: s.top >= f.bottom - 1, w: f.width }; })()`);
  })();
  ok('390px: 영상 16:9, 단계 목록은 영상 아래', Math.abs(mobLayout.ratio - 16 / 9) < 0.02 && mobLayout.below, JSON.stringify(mobLayout));
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // 소개 영상: 처음에는 덮개만(재생 막대 없음), 누르면 소리 없이 재생
  const heroCover = () => cdp.ev(`(() => { const v = document.querySelector('.vslot-hero video'); return { t: v.currentTime, paused: v.paused, muted: v.muted, coverShown: getComputedStyle(document.querySelector('[data-play]')).display !== 'none', controls: v.controls }; })()`);
  const h0 = await heroCover();
  ok('file: 소개 영상은 저절로 재생하지 않고 덮개를 보여 줌', h0.paused && h0.coverShown && !h0.controls, JSON.stringify(h0));
  await cdp.ev(`(() => { const v = document.querySelector('.vslot-hero video'); v.currentTime = 0; return 1; })()`);
  await clickCenter('[data-play]');
  await sleep(1200);
  const h1 = await heroCover();
  ok('file: 덮개를 누르면 소리 끈 채 재생, 덮개 사라지고 재생 막대 나옴', !h1.paused && h1.t > 0.3 && h1.muted && !h1.coverShown && h1.controls, JSON.stringify(h1));
  await cdp.ev(`document.querySelectorAll('video').forEach(v => v.pause()), 1`);
  ok('file: 콘솔 오류 없음(소개 영상 재생 뒤)', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  // 2) http:// (Range 지원 정적 서버, .vtt 를 그대로 받는지)
  server = await serve(SITE);
  const origin = `http://127.0.0.1:${server.address().port}/`;
  await load(origin + 'index.html');
  st = await state();
  ok('http: 영상 네 편 메타데이터(길이 > 0)', st.every((s) => s.dur > 0 && !s.missing));
  ok('http: 옆의 .vtt 자막을 그대로 읽음(cue 수 > 0)', st.every((s) => s.cues > 0 && !s.inline && s.trackState === 2), st.map((s) => `${s.id} ${s.cues}개`).join(', '));
  await checkSteps('http');
  ok('http: 외부 호스트 요청 없음', externalOf(reqs, origin).length === 0, `요청 ${reqs.length}건 ${externalOf(reqs, origin).slice(0, 3).join(' ')}`);
  ok('http: 콘솔 오류 없음', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  server.close();

  // 3) 영상 하나가 없을 때(보고서 영상을 뺀 사본)
  const partial = join(SCRATCH, 'missing-one');
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  for (const f of readdirSync(SITE)) if (!/Report_.*\.mp4$/.test(f)) copyFileSync(join(SITE, f), join(partial, f));
  await load(pathToFileURL(join(partial, 'index.html')).href);
  await sleep(500);
  st = await state();
  const rep = st.find((s) => s.id === 'report');
  const others = st.filter((s) => s.id !== 'report');
  const stepsDisabled = await cdp.ev(`[...document.querySelectorAll('#report .step')].every(b => b.disabled)`);
  ok('영상 없음: 그 자리에 안내 문구, 단계 버튼 꺼짐', rep.missing && /찾을 수 없습니다/.test(rep.msg) && stepsDisabled, rep.msg);
  ok('영상 없음: 나머지 영상은 정상', others.every((s) => s.dur > 0 && !s.missing));
  ok('영상 없음: 스크립트 예외 없음', !consoleErrors.some((e) => e.startsWith('exception')), consoleErrors.filter((e) => e.startsWith('exception')).join(' | '));
  await cdp.ev(`document.getElementById('report').scrollIntoView(), 1`);
  await sleep(300);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, 'guide-site_missing_video.png'), Buffer.from(data, 'base64'));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
  console.log(`스크린샷: ${SHOTS}`);
  exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error('실패: ' + (e.stack || e.message));
  exitCode = 1;
} finally {
  try { server && server.close(); } catch {}
  try { cdp && cdp.close(); } catch {}
  // 띄운 Edge 만 닫는다: CDP Browser.close, 그래도 남으면 그 프로세스 트리만 끝낸다.
  try {
    if (browserWs) {
      const b = await new Cdp({ webSocketDebuggerUrl: browserWs }).open();
      await Promise.race([b.send('Browser.close').catch(() => {}), sleep(2000)]);
      b.close();
    }
  } catch {}
  await sleep(800);
  if (edge.exitCode === null) { try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  process.exit(exitCode);
}
