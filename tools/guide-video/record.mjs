// 사용 가이드 영상 녹화 도구(이슈 #13 v2, v3). 실제 설치형 앱을 CDP 로 조작하고 화면을 받아 1920x1080, 30fps, 무음 MP4 와 SRT 를 만든다.
//
//   node tools/guide-video/record.mjs <대본.mjs> [--out dist/guide-video] [--dry] [--keep]
//   node tools/guide-video/record.mjs --restore-local      (녹화 전에 백업한 브라우저 저장소 값을 되돌린다)
//
// 앞서 할 일: db/demo/demo-db.cmd -Load 로 데모 데이터를 넣고, 앱을 TC_DEBUG_PORT=9222 로 띄운다(README.md).
// 동작
//   1) 메인 창(웹 영역)을 CDP Page.startScreencast 로 받는다. 다른 사람 일정 창(PeerWindow, url 에 peerwin=1)이 앞에 있는 동안은
//      그 대상으로 바꿔 받고, 창 틀과 제목줄은 PrintWindow 로 찍어(lib/win.ps1) 실제 화면 자리에 합친다.
//   2) 자막 막대, 커서, 누름 물결, 강조 테두리, 안내 카드는 녹화하는 동안만 페이지 DOM 에 넣는다(lib/overlay.mjs, pointer-events:none).
//   3) 받은 프레임은 받은 시각으로 이어 붙여 30fps 고정으로 바꾸고(ffmpeg concat + fps), H.264 yuv420p 로 굽는다.
//      메인 창 웹 영역(1920x1032)은 위아래 24px 띠를 붙여 1920x1080 으로 맞춘다.
//   4) SRT 는 자막을 실제로 바꾼 시각에서 만든다.
// 지키는 것: 회사 보고 전송 단추는 누르지 않는다(대본 검사). 로그아웃하지 않는다. 앱 소스는 바꾸지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect, findTarget, sleep } from './lib/cdp.mjs';
import { OVERLAY_JS } from './lib/overlay.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(REPO, opt('--out', 'dist/guide-video'));
const WORK = path.join(OUT, 'work');
const LS_BACKUP = path.join(WORK, 'localStorage.backup.json');
const DRY = flag('--dry');
const LETTER = 24;                 // 1032 → 1080 위아래 띠
const BAND = '0x161b26';           // 띠 색(앱 위쪽 막대와 어울리는 어두운 남색)
// 회사 사이트로 가는 조작 금지(대본 검사). 자막(cap), 카드 글(html), 강조 이름(label)은 검사하지 않는다(설명은 해도 된다).
//   조작 필드(sel, js, text, if, value)에만 걸고, 강조(highlight)와 커서 이동(move)은 누르지 않으므로 sel 검사를 하지 않는다.
const FORBIDDEN = ['#btnRptSend', 'btnRptSend', 'netcus', '로그아웃', 'logout', 'btnLogout', '주간보고 작성', '일간보고 전송', '보고 전송', 'data-rsrc=net', 'data-rsrc="net"', 'data-rsrc=week', 'data-rsrc="week"'];
// 실제로 누르기 직전에 누를 자리의 요소를 다시 본다(대본 검사를 지나도 막는다).
const GUARD_JS = (x, y) => `(() => {
  const el = document.elementFromPoint(${x}, ${y}); if (!el) return '';
  const b = el.closest('button, a, [role=button], input[type=button], input[type=submit]') || el;
  const id = b.id || '', t = (b.textContent || b.value || '').replace(/\\s+/g, ' ').trim();
  if (id === 'btnRptSend' || id === 'btnLogout' || b.closest('#btnRptSend, #btnLogout')) return id || 'send';
  if (/주간보고 작성|일간보고 전송|보고 전송|로그아웃/.test(t)) return t.slice(0, 30);
  if (b.matches('[data-rsrc=net], [data-rsrc=week]')) return 'netcus 출처';
  return '';
})()`;
const GUARD_FOCUS_JS = `(() => { const b = document.activeElement; if (!b) return ''; const t = (b.textContent || '').replace(/\\s+/g, ' ').trim();
  return (b.id === 'btnRptSend' || /주간보고 작성|일간보고 전송|로그아웃/.test(t) || (b.matches && b.matches('[data-rsrc=net], [data-rsrc=week]'))) ? (b.id || t.slice(0, 30)) : ''; })()`;
function scanForbidden(steps) {
  const ops = ['sel', 'js', 'text', 'if', 'value', 'to', 'label'];
  const walk = (list, where) => {
    for (const st of list || []) {
      for (const f of ops) {
        if (f === 'label' && st.act !== 'select') continue;
        if (f === 'sel' && (st.act === 'highlight' || st.act === 'move')) continue;
        const v = st[f]; if (v == null) continue;
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        for (const bad of FORBIDDEN) if (s.includes(bad)) return `${where} ${st.act} ${f}: ${bad}`;
      }
      if (st.do) { const r = walk(st.do, where + ' > do'); if (r) return r; }
    }
    return null;
  };
  return walk(steps, 'steps');
}
// 속도 기본값(v2 와 같은 값). 대본의 pace 로 덮어쓴다(v3 대본은 더 빠르게).
const PACE_V2 = { capHold: 750, pre: 250, post: 450, dwell: 160, typeMs: 62, typeJitter: 34, curMin: 280, curMax: 950, curBase: 260, curK: 0.42, ease: '', capMin: 0, settle: 900 };

fs.mkdirSync(WORK, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

// ---------- 창 도우미(PowerShell 상주) ----------
class Win {
  constructor(pid) {
    this.p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'lib', 'win.ps1'), '-Op', 'serve', '-AppPid', String(pid)], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.buf = ''; this.q = [];
    this.p.stdout.setEncoding('utf8');
    this.p.stdout.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); const r = this.q.shift(); if (r) r(line); } });
  }
  cmd(op, like = '', out = '') {
    return new Promise(res => { this.q.push(line => { try { res(JSON.parse(line)); } catch { res({ ok: false, raw: line }); } }); this.p.stdin.write([op, like, out].join('\t') + '\n'); });
  }
  quit() { try { this.p.stdin.write('quit\n'); } catch {} }
}
function psOnce(args) {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'lib', 'win.ps1'), ...args], { encoding: 'utf8' });
  return (r.stdout || '').trim();
}
function ff(args, label) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg 실패(${label}): ${r.stderr}`);
}

// ---------- 저장소 백업과 복원 ----------
async function backupLocal(main) {
  if (fs.existsSync(LS_BACKUP)) return;
  const all = await main.ev('JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])))');
  fs.writeFileSync(LS_BACKUP, all);
  log('브라우저 저장소 백업:', LS_BACKUP);
}
async function restoreLocal(main) {
  if (!fs.existsSync(LS_BACKUP)) { log('백업 없음, 되돌릴 것 없음'); return false; }
  const all = fs.readFileSync(LS_BACKUP, 'utf8');
  const r = await main.ev(`(() => { const b = ${all}; let del = 0, set = 0;
    for (const k of Object.keys(localStorage)) if (!(k in b)) { localStorage.removeItem(k); del++; }
    for (const [k, v] of Object.entries(b)) if (localStorage.getItem(k) !== v) { localStorage.setItem(k, v); set++; }
    return JSON.stringify({ del, set }); })()`);
  log('브라우저 저장소 복원:', r);
  // 백업과 똑같아졌는지 확인한 뒤에만 백업 파일을 지운다(실제 이름이 든 '최근 본 사람'을 파일로 남기지 않게).
  const now = await main.ev('JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])))');
  const want = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(all)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
  if (now === want) { fs.rmSync(LS_BACKUP); log('복원 확인 일치, 백업 파일 삭제'); return true; }
  log('복원 뒤 값이 백업과 다릅니다. 백업 파일을 남깁니다:', LS_BACKUP);
  return false;
}

// ---------- 요소 찾기(iframe 'frame:' 접두와 '::text(글자)' 접미 지원) ----------
const RECTS_JS = (sel, scroll) => `(() => {
  let s = ${JSON.stringify(sel)}, doc = document, ox = 0, oy = 0;
  if (s.startsWith('frame:')) { const f = document.querySelector('iframe'); if (!f || !f.contentDocument) return null; const r = f.getBoundingClientRect(); ox = r.left + f.clientLeft; oy = r.top + f.clientTop; doc = f.contentDocument; s = s.slice(6); }
  let sub = null; const si = s.indexOf(' >> '); if (si >= 0) { sub = s.slice(si + 4); s = s.slice(0, si); }
  let want = null; const m = /^(.*?)::text\\((.*)\\)$/.exec(s); if (m) { s = m[1]; want = m[2]; }
  const vis = e => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
  let els = [...doc.querySelectorAll(s)].filter(e => vis(e) && (want == null || e.textContent.replace(/\\s+/g, ' ').trim().includes(want)));
  if (sub) els = els.map(e => e.querySelector(sub)).filter(e => e && vis(e));
  if (!els.length) return null;
  if (${!!scroll}) els[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return els.map(e => { const r = e.getBoundingClientRect(); return { x: r.left + ox, y: r.top + oy, w: r.width, h: r.height }; });
})()`;
const ELEM_JS = (sel, body) => `(() => {
  let s = ${JSON.stringify(sel)}, doc = document;
  if (s.startsWith('frame:')) { doc = document.querySelector('iframe').contentDocument; s = s.slice(6); }
  let sub = null; const si = s.indexOf(' >> '); if (si >= 0) { sub = s.slice(si + 4); s = s.slice(0, si); }
  let want = null; const m = /^(.*?)::text\\((.*)\\)$/.exec(s); if (m) { s = m[1]; want = m[2]; }
  let el = [...doc.querySelectorAll(s)].find(e => want == null || e.textContent.replace(/\\s+/g, ' ').trim().includes(want));
  if (el && sub) el = el.querySelector(sub);
  if (!el) return null;
  ${body}
})()`;
const union = rs => { const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y)); return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y }; };

// ---------- 녹화 세션 ----------
class Session {
  constructor(script, appPid) {
    this.script = script; this.appPid = appPid;
    this.pages = { main: null, peer: null };
    this.active = 'main';
    this.rec = false; this.seg = null; this.segs = []; this.caps = []; this.capOpen = null;
    this.casting = null; this.frameNo = 0;
    this.dir = path.join(WORK, script.name);
    this.peerInfo = null;
    this.events = [];
    this.warnings = [];
    this.P = { ...PACE_V2, ...(script.pace || {}) };
    this.capShownAt = 0;
  }
  get page() { return this.pages[this.active]; }
  async ev(js, which) { return (which ? this.pages[which] : this.page).ev(js); }

  // ----- 화면 받기 -----
  async startCast(which) {
    if (this.casting === which) return;
    if (this.casting) await this.stopCast();
    const pg = this.pages[which];
    pg.on('Page.screencastFrame', p => {
      pg.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
      if (!this.rec || !this.seg || this.seg.page !== which) return;
      this.saveFrame(Buffer.from(p.data, 'base64'));
    });
    await pg.send('Page.enable');
    await pg.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    this.casting = which;
  }
  async stopCast() {
    const pg = this.pages[this.casting];
    if (pg && !pg.closed) { try { await pg.send('Page.stopScreencast'); } catch {} }
    this.casting = null;
  }
  saveFrame(buf, t = Date.now()) {
    const f = path.join(this.seg.dir, `f${String(++this.frameNo).padStart(6, '0')}.jpg`);
    fs.writeFileSync(f, buf);
    this.seg.frames.push({ t, f });
  }
  async beginSeg(ctx) {
    const k = this.segs.length + (this.seg ? 1 : 0);
    const dir = path.join(this.dir, `seg${String(k).padStart(2, '0')}`);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    this.seg = { ctx, page: this.active, start: Date.now(), frames: [], marks: [], dir };
    this.rec = true;
    if (!DRY) {
      await this.startCast(this.active);
      const r = await this.page.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
      this.saveFrame(Buffer.from(r.data, 'base64'), this.seg.start);
    }
  }
  endSeg() {
    if (!this.seg) return;
    this.seg.end = Date.now();
    this.segs.push(this.seg); this.seg = null; this.rec = false;
  }

  // ----- 자막 -----
  // style: '' = 아래 자막 막대, 'punch' = 굵은 짧은 문구(sub = 작은 둘째 줄)
  async caption(text, n, where, style = '', sub = '') {
    // 앞 자막이 최소 시간(capMin)만큼 보이지 않았으면 기다렸다가 바꾼다.
    if (this.capOpen && this.P.capMin && this.rec) { const left = this.P.capMin - (Date.now() - this.capShownAt); if (left > 0) await sleep(left); }
    const now = Date.now();
    if (this.capOpen) { this.capOpen.end = now; this.caps.push(this.capOpen); this.capOpen = null; }
    if (text) { this.capOpen = { text: style === 'punch' && sub ? `${text.replace(/\*/g, '')} ${sub}` : text.replace(/\*/g, ''), n, start: now + 200, style, where, raw: text, sub }; this.capShownAt = now + 200; }
    await this.showCap(text, n, where, style, sub);
  }
  async showCap(text, n, where, style, sub, which) {
    // 막대와 문구는 한 번에 하나만 보인다.
    const js = style === 'punch'
      ? `__gv.caption(''); __gv.punch(${JSON.stringify(text || '')}, ${JSON.stringify(sub || '')}, ${JSON.stringify(where || '')}); 1`
      : `__gv.punch && __gv.punch(''); __gv.caption(${JSON.stringify(text || '')}, ${JSON.stringify(n || '')}, ${JSON.stringify(where || '')}); 1`;
    await this.ev(js, which);
  }
  async reshowCap(which) { const c = this.capOpen; if (c) await this.showCap(c.raw, c.n, c.where, c.style, c.sub, which); }
  async ripple(x, y) { if (!this.quiet) await this.ev(`__gv.ripple(${x},${y}); 1`); }
  async guard(x, y) {
    const hit = await this.ev(GUARD_JS(x, y));
    if (hit) throw new Error('회사 전송/로그아웃 단추를 누르려 해서 멈춤: ' + hit);
  }

  // ----- 겹침 층 -----
  async inject(which) {
    const r = await this.ev(OVERLAY_JS, which);
    if (this.P.ease) await this.ev(`__gv.setEase(${JSON.stringify(this.P.ease)}); 1`, which);
    log('겹침 층', which, r);
  }
  async cursorTo(x, y, ms) {
    const [cx, cy] = await this.ev('__gv.pos()');
    const d = Math.hypot(x - cx, y - cy), P = this.P;
    const dur = ms ?? (cx < -50 ? 0 : Math.max(P.curMin, Math.min(P.curMax, P.curBase + d * P.curK)));
    if (dur === 0) await this.ev(`__gv.place(${x},${y}); __gv.hideCursor(false); 1`);
    else await this.ev(`__gv.cursorTo(${x},${y},${Math.round(dur)})`);
    await this.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  }
  async rects(sel, scroll = true, timeout = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = await this.ev(RECTS_JS(sel, scroll));
      if (r && r.length) return r;
      await sleep(150);
    }
    throw new Error('요소를 찾지 못함: ' + sel);
  }
  async point(step) {
    if (step.xy) return step.xy;
    const r = (await this.rects(step.sel, step.scroll !== false))[step.nth || 0];
    const [fx, fy] = step.at || [0.5, 0.5];
    return [Math.round(r.x + r.w * fx), Math.round(r.y + r.h * fy)];
  }
  async mouseClick(x, y, count = 1) {
    const pg = this.page;
    await this.guard(x, y);
    await pg.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: count });
    await sleep(60);
    await pg.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: count });
  }
  async key(key) {
    const map = { Escape: 27, Enter: 13, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38 };
    const vk = map[key] || 0;
    if (key === 'Enter' || key === ' ') { const f = await this.ev(GUARD_FOCUS_JS); if (f) throw new Error('회사 전송 단추에 초점이 있어 키를 누르지 않음: ' + f); }
    await this.page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(40);
    await this.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  }

  // ----- 창 전환 -----
  async composeBg(info, kind) {
    // 바탕 = 띠 색 캔버스 + 메인 창 웹 영역(겹침 층을 숨기고 찍음) + 열람 창 PrintWindow(틀과 제목줄)
    const bgDir = this.seg ? this.seg.dir : path.join(this.dir, 'bg');
    fs.mkdirSync(bgDir, { recursive: true });
    const stamp = Date.now();
    const back = path.join(this.dir, `back-${stamp}.jpg`), pw = path.join(this.dir, `pw-${stamp}.png`), bg = path.join(this.dir, `bg-${stamp}.png`);
    await this.ev('__gv.setVisible(false); 1', 'main');
    const r = await this.pages.main.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    await this.ev('__gv.setVisible(true); 1', 'main');
    fs.writeFileSync(back, Buffer.from(r.data, 'base64'));
    await this.win.cmd('shot', '님의 일정', pw);
    const [fx, fy] = info.frame;
    ff(['-f', 'lavfi', '-i', `color=c=${BAND}:s=1920x1080`, '-i', back, '-i', pw, '-filter_complex', `[0][1]overlay=0:${LETTER}[a];[a][2]overlay=${fx}:${fy + LETTER}`, '-frames:v', '1', bg], 'bg');
    return bg;
  }
  async peerCtx() {
    let info = null;
    for (let i = 0; i < 30; i++) { info = await this.win.cmd('rect', '님의 일정'); if (info && info.hwnd) break; await sleep(200); }
    if (!info || !info.hwnd) throw new Error('열람 창을 찾지 못함');
    this.peerInfo = info;
    const bg = DRY ? null : await this.composeBg(info);
    return { kind: 'peer', bg, client: info.client, frame: info.frame, zoomed: info.zoomed };
  }
  async toPeer(step) {
    // 사람을 고른 직후: 창이 뜨고 열람 달력이 그려질 때까지는 잘라 낸다(실제로는 1초 안팎).
    const [mx, my] = await this.ev('__gv.pos()', 'main');
    this.endSeg();
    await this.ev('__gv.caption(""); __gv.punch && __gv.punch(""); __gv.hideCursor(true); 1', 'main');
    const t = await findTarget('peer', 15000);
    if (!t) throw new Error('열람 창 CDP 대상 없음');
    this.pages.peer = await connect('peer', 5000);
    for (let i = 0; i < 80; i++) {
      const ok = await this.pages.peer.ev(`(() => { const f = document.querySelector('iframe'); const d = f && f.contentDocument; return !!(d && d.querySelector('.cell') && /님의 일정/.test(document.title)); })()`).catch(() => false);
      if (ok) break; await sleep(150);
    }
    await sleep(step.settle ?? this.P.settle);
    await this.inject('peer');
    this.active = 'peer';
    const ctx = await this.peerCtx();
    const [cx, cy] = ctx.client;
    const px = Math.max(10, Math.min(ctx.client[2] - 10, mx - cx)), py = Math.max(10, Math.min(ctx.client[3] - 10, my - cy));
    await this.ev(`__gv.place(${px},${py}); 1`);
    await this.reshowCap('peer');
    await this.beginSeg(ctx);
  }
  async toMain() {
    this.endSeg();
    if (this.casting === 'peer') this.casting = null;
    try { this.pages.peer && this.pages.peer.close(); } catch {}
    this.pages.peer = null; this.active = 'main';
    for (let i = 0; i < 40; i++) { const t = await findTarget('peer', 200); if (!t) break; await sleep(150); }
    await sleep(300);
    const info = this.lastOs;
    if (info) await this.ev(`__gv.place(${info.x},${info.y}); __gv.hideCursor(false); 1`);
    await this.reshowCap('main');
    await this.beginSeg({ kind: 'main' });
  }
  // 열람 창의 제목줄 단추(Windows 틀). 웹 밖이라 커서와 강조는 합칠 때 ffmpeg 가 그린다.
  async osAction(step) {
    const info = this.peerInfo;
    const [fx, fy, fw] = info.frame; const ch = info.client[1] - fy;     // 제목줄 높이
    const idx = { close: 0, max: 1, restore: 1, min: 2 }[step.btn || (step.op === 'close' ? 'close' : 'max')];
    const bw = 46, bx = fx + fw - bw * (idx + 1), by = fy;
    const tx = bx + Math.round(bw / 2) + 3, ty = by + Math.round(ch / 2) + 2;
    // 웹 커서를 단추 바로 아래 웹 가장자리까지 옮긴 뒤 감추고, 그 자리부터 ffmpeg 커서가 이어 받는다.
    await this.cursorTo(Math.max(4, tx - info.client[0]), 3);
    await this.ev('__gv.hideCursor(true); 1');
    const t0 = Date.now();
    if (this.seg) this.seg.marks.push({ t0, t1: t0 + (step.ms ?? 900), cur: [tx, ty], box: [bx, by, bw, ch] });
    await sleep(step.pre ?? 520);
    this.lastOs = { x: tx, y: Math.max(4, ty) };
    // 창 상태가 바뀌기 전에 구간을 닫는다(바뀐 뒤 프레임이 옛 자리로 합성되지 않게).
    this.endSeg();
    await this.win.cmd(step.op === 'close' ? 'close' : (step.op === 'restore' ? 'restore' : 'maximize'), '님의 일정');
    await sleep(380);
    if (step.op === 'close') { await this.toMain(); return; }
    await sleep(step.settle ?? 900);
    const ctx = await this.peerCtx();
    // 새 자리의 같은 단추 아래로 웹 커서를 옮겨 둔다.
    const ni = this.peerInfo; const nbx = ni.frame[0] + ni.frame[2] - bw * (idx + 1) + bw / 2;
    await this.ev(`__gv.place(${Math.round(nbx - ni.client[0])},4); __gv.hideCursor(false); 1`);
    await this.beginSeg(ctx);
  }

  // 오류, 경고 토스트를 잡아 기록한다(검증 목록에 쓴다).
  async checkToasts(label) {
    const t = await this.ev(`(() => [...document.querySelectorAll('#toastWrap .toast.error, #toastWrap .toast.warn')].filter(e => e.classList.contains('show')).map(e => e.textContent.trim()).join(' / '))()`).catch(() => '');
    if (t) { this.warnings.push({ at: label, toast: t }); log('경고 토스트:', t); }
  }

  // ----- 단계 실행 -----
  async run(steps) {
    let i = 0;
    for (const st of steps) {
      i++;
      if (st.if && !(await this.ev(st.if).catch(() => false))) { log(`${i}/${steps.length} 건너뜀(if)`); continue; }
      const label = `${i}/${steps.length} ${st.act}${st.sel ? ' ' + st.sel : ''}${st.cap ? ' [' + st.cap + ']' : ''}`;
      log(label);
      this.events.push({ i, act: st.act, sel: st.sel || null, cap: st.cap || null, t: Date.now() });
      if (st.cap !== undefined) { await this.caption(st.cap, st.n, st.where); await sleep(st.capHold ?? this.P.capHold); }
      if (st.punch !== undefined) { await this.caption(st.punch, null, st.where, 'punch', st.sub); await sleep(st.capHold ?? this.P.capHold); }
      await sleep(st.pre ?? this.P.pre);
      await this.step(st);
      await sleep(st.post ?? this.P.post);
      await this.checkToasts(label);
    }
  }
  async step(st) {
    switch (st.act) {
      case 'caption': case 'wait': await sleep(st.ms ?? 1200); break;
      case 'move': case 'hover': { const [x, y] = await this.point(st); await this.cursorTo(x, y, st.ms); break; }
      case 'click': {
        const [x, y] = await this.point(st);
        await this.cursorTo(x, y, st.ms);
        await sleep(st.dwell ?? this.P.dwell);
        await this.ripple(x, y);
        if (st.js) { await this.guard(x, y); await this.ev(ELEM_JS(st.sel, 'el.click(); return true;')); }
        else await this.mouseClick(x, y);
        break;
      }
      case 'type': {
        if (!st.noClick) { const [x, y] = await this.point(st); await this.cursorTo(x, y); await sleep(Math.min(120, this.P.dwell)); await this.ripple(x, y); await this.mouseClick(x, y); await sleep(Math.min(200, this.P.dwell + 60)); }
        if (st.replace) await this.ev(ELEM_JS(st.sel, 'el.focus(); el.select && el.select(); return true;'));
        for (const ch of [...st.text]) { await this.page.send('Input.insertText', { text: ch }); await sleep((st.cps ? 1000 / st.cps : this.P.typeMs) + Math.random() * this.P.typeJitter); }
        if (st.commit) await this.ev(ELEM_JS(st.sel, `el.dispatchEvent(new Event('change', { bubbles: true })); return true;`));
        break;
      }
      case 'select': {
        // 네이티브 <select> 목록은 따로 뜨는 창이라 화면 받기에 안 잡히고 녹화를 막는다. 커서로 가리킨 뒤 값만 바꾼다.
        const [x, y] = await this.point(st);
        await this.cursorTo(x, y); await sleep(Math.min(150, this.P.dwell)); await this.ripple(x, y);
        const ok = await this.ev(ELEM_JS(st.sel, `const pick = ${JSON.stringify(st.label ?? st.value)};
          const o = [...el.options].find(o => o.value === pick || o.textContent.trim() === pick || o.textContent.trim().includes(pick));
          if (!o) return false; el.focus(); el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true;`));
        if (!ok) throw new Error('선택지 없음: ' + st.sel + ' ' + (st.label ?? st.value));
        break;
      }
      case 'key': await this.key(st.key); break;
      case 'wheel': {
        const [x, y] = await this.point(st);
        await this.cursorTo(x, y);
        for (let k = 0; k < (st.times ?? 4); k++) { await this.page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: st.dy ?? 120 }); await sleep(st.every ?? 160); }
        break;
      }
      case 'scrollTo': await this.ev(ELEM_JS(st.sel, `el.scrollIntoView({ behavior: 'smooth', block: ${JSON.stringify(st.block || 'center')} }); return true;`)); await sleep(st.ms ?? 800); break;
      case 'highlight': {
        let rs = await this.rects(st.sel, st.scroll !== false);
        if (st.slice) rs = rs.slice(st.slice[0], st.slice[1]);
        const r = st.all ? union(rs) : rs[st.nth || 0];
        const below = st.below ?? (r.y < 70);
        await this.ev(`__gv.highlight(${JSON.stringify(st.id || st.sel)}, ${JSON.stringify(r)}, ${JSON.stringify(st.label || '')}, ${below}); 1`);
        if (st.ms) { await sleep(st.ms); if (!st.keep) await this.ev(`__gv.unhighlight(${JSON.stringify(st.id || st.sel)}); 1`); }
        break;
      }
      case 'unhighlight': await this.ev(`__gv.unhighlight(${st.id ? JSON.stringify(st.id) : 'null'}); 1`); break;
      case 'card': await this.ev(`__gv.card(${JSON.stringify(st.html)}, ${st.dim !== false}); 1`); await sleep(st.ms ?? 3500); if (!st.keep) { await this.ev('__gv.hideCard(); 1'); await sleep(350); } break;
      case 'hideCard': await this.ev('__gv.hideCard(); 1'); await sleep(350); break;
      case 'cursor': await this.ev(`__gv.hideCursor(${!!st.hide}); 1`); break;
      case 'waitFor': {
        const t0 = Date.now();
        while (!(await this.ev(st.js).catch(() => false))) { if (Date.now() - t0 > (st.timeout ?? 8000)) throw new Error('waitFor 시간 초과: ' + st.js); await sleep(120); }
        break;
      }
      case 'js': { const v = await this.ev(st.js); if (st.expect !== undefined && v !== st.expect) throw new Error(`js 결과 ${v} (기대 ${st.expect}): ${st.js}`); break; }
      case 'toPeer': await this.toPeer(st); break;
      case 'os': await this.osAction(st); break;
      case 'cut': {
        // 화면에 넣지 않을 구간: 구간을 닫고 js 와 do(단계 목록)를 녹화 없이 실행한 뒤 새 구간을 연다(빠른 장면 전환).
        this.endSeg(); await sleep(st.ms ?? 300);
        if (st.js) await this.ev(st.js);
        this.quiet = true;
        if (st.do) for (const d of st.do) {
          if (d.cap !== undefined) await this.caption(d.cap, d.n, d.where);
          if (d.punch !== undefined) await this.caption(d.punch, null, d.where, 'punch', d.sub);
          await this.step(d); await sleep(d.post ?? 60);
        }
        this.quiet = false;
        await sleep(st.settle ?? 300);
        await this.beginSeg(this.active === 'main' ? { kind: 'main' } : await this.peerCtx()); break;
      }
      case 'punch': await this.caption(st.text, null, st.where, 'punch', st.sub); await sleep(st.ms ?? 0); break;
      case 'title': {
        // 전면 제목 카드. html 이 비면 걷는다.
        await this.ev(`__gv.hideCursor(true); __gv.title(${JSON.stringify(st.html || '')}); 1`);
        await sleep(st.ms ?? 2200);
        if (!st.keep && st.html) { await this.ev('__gv.title(""); 1'); await sleep(st.fade ?? 320); }
        break;
      }
      case 'zoom': {
        // 화면 확대와 이동(body transform). sel 이나 rect([x,y,w,h], 확대 전 좌표)를 가운데로, scale 배. reset 이면 원래대로.
        //   확대된 동안 rects() 는 확대된 좌표를 돌려주므로, 다른 곳으로 옮길 때는 rect 로 주거나 먼저 reset 한다.
        let r = st.rect ? { x: st.rect[0], y: st.rect[1], w: st.rect[2], h: st.rect[3] } : null;
        if (!r && st.sel) {
          const rs = await this.rects(st.sel, false); r = st.all ? union(rs) : rs[st.nth || 0];
          // 이미 확대된 상태면 확대 전 좌표로 되돌려 계산한다.
          const [tx, ty, zs] = await this.ev('__gv.zstate()');
          if (zs !== 1) r = { x: (r.x - tx) / zs, y: (r.y - ty) / zs, w: r.w / zs, h: r.h / zs };
        }
        if (r && st.pad) r = { x: r.x - st.pad, y: r.y - st.pad, w: r.w + st.pad * 2, h: r.h + st.pad * 2 };
        const s = st.reset ? 1 : (st.scale ?? 1.5);
        await this.ev(`__gv.zoom(${JSON.stringify(r)}, ${s}, ${st.ms ?? 900}); 1`);
        if (st.wait !== false) await sleep(st.ms ?? 900);
        break;
      }
      case 'setValue': {
        // 날짜 칸처럼 펼침 창이 따로 뜨는 입력: 커서로 가리키고 값을 넣은 뒤 input, change 를 보낸다.
        const [x, y] = await this.point(st);
        await this.cursorTo(x, y); await sleep(this.P.dwell); await this.ripple(x, y);
        const ok = await this.ev(ELEM_JS(st.sel, `el.focus(); el.value = ${JSON.stringify(st.value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return !!el.value;`));   // 주간은 월요일로 맞춰지므로 같은 값인지는 보지 않는다
        if (!ok) throw new Error('값 넣기 실패: ' + st.sel);
        break;
      }
      case 'caret': {
        // 글 칸(textarea)에서 after 글자가 있는 줄 끝(없으면 글 끝)에 글자 커서를 둔다. 화면 커서는 그 줄 끝을 누른다.
        const xy = await this.ev(ELEM_JS(st.sel, `const v = el.value, aft = ${JSON.stringify(st.after ?? null)};
          const lines = v.split('\\n'); let idx = lines.length - 1; if (aft != null) { const k = lines.findIndex(l => l.includes(aft)); if (k >= 0) idx = k; }
          let pos = 0; for (let i = 0; i < idx; i++) pos += lines[i].length + 1; pos += lines[idx].length;
          el.scrollIntoView({ block: 'nearest' });
          const cs = getComputedStyle(el), r = el.getBoundingClientRect(); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
          const cv = document.createElement('canvas').getContext('2d'); cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
          const k = el.offsetWidth ? r.width / el.offsetWidth : 1;   // 확대(zoom) 중이면 배율만큼 늘린다
          const x = r.left + k * (parseFloat(cs.paddingLeft) + Math.min(el.offsetWidth - 30, cv.measureText(lines[idx]).width + 4));
          const y = r.top + k * (parseFloat(cs.paddingTop) + (idx + 0.5) * lh - el.scrollTop);
          window.__gvCaret = pos; return [Math.round(x), Math.round(y)];`));
        if (!xy) throw new Error('글 칸 없음: ' + st.sel);
        const [x, y] = xy;
        await this.cursorTo(x, y); await sleep(this.P.dwell); await this.ripple(x, y);
        await this.mouseClick(x, y); await sleep(80);
        await this.ev(ELEM_JS(st.sel, `el.focus(); el.setSelectionRange(window.__gvCaret, window.__gvCaret); return true;`));
        break;
      }
      case 'drag': {
        // 끌어 놓기(포인터 이벤트로 받는 화면용). sel 에서 to 까지 마우스를 누른 채 steps 번 나눠 옮긴다.
        const [x0, y0] = await this.point(st);
        const [x1, y1] = await this.point({ sel: st.to, at: st.toAt, nth: st.toNth, scroll: false });
        await this.cursorTo(x0, y0); await sleep(this.P.dwell);
        await this.guard(x0, y0);
        await this.ripple(x0, y0);
        const pg = this.page;
        await pg.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
        await sleep(st.hold ?? 160);
        const n = st.steps ?? 24, dur = st.ms ?? 900;
        for (let k = 1; k <= n; k++) {
          const t = k / n, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const x = Math.round(x0 + (x1 - x0) * e), y = Math.round(y0 + (y1 - y0) * e);
          await this.ev(`__gv.place(${x},${y}); 1`);
          await pg.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
          await sleep(dur / n);
        }
        await sleep(st.over ?? 350);
        await pg.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
        break;
      }
      default: throw new Error('모르는 동작: ' + st.act);
    }
  }

  // ----- 굽기 -----
  mapT(w) {
    let acc = 0;
    for (const s of this.segs) {
      if (w < s.start) return acc;
      if (w <= s.end) return acc + (w - s.start);
      acc += s.end - s.start;
    }
    return acc;
  }
  encode(cursorPng) {
    const parts = [];
    this.segs.forEach((s, k) => {
      const dur = (s.end - s.start) / 1000;
      if (dur < 0.05 || !s.frames.length) return;
      const list = path.join(s.dir, 'list.txt');
      const lines = ['ffconcat version 1.0'];
      s.frames.forEach((fr, j) => {
        const nt = j + 1 < s.frames.length ? s.frames[j + 1].t : s.end;
        lines.push(`file '${fr.f.replace(/\\/g, '/')}'`, `duration ${Math.max(0.001, (nt - fr.t) / 1000).toFixed(4)}`);
      });
      lines.push(`file '${s.frames[s.frames.length - 1].f.replace(/\\/g, '/')}'`);
      fs.writeFileSync(list, lines.join('\n'));
      const out = path.join(s.dir, 'seg.mp4');
      const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', '30', '-t', dur.toFixed(3), out];
      if (s.ctx.kind === 'main') {
        ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=${BAND},scale=out_range=tv:out_color_matrix=bt709,format=yuv420p`, ...enc], 'main seg ' + k);
      } else {
        const [cx, cy] = s.ctx.client;
        let fc = `[1:v]fps=30,setpts=PTS-STARTPTS[c];[0:v][c]overlay=${cx}:${cy + LETTER}[v0]`;
        let last = 'v0';
        const ins = ['-loop', '1', '-framerate', '30', '-i', s.ctx.bg, '-f', 'concat', '-safe', '0', '-i', list];
        if (s.marks.length) {
          ins.push('-loop', '1', '-framerate', '30', '-i', cursorPng);
          fc += `;[2:v]split=${s.marks.length}${s.marks.map((_, j) => `[k${j}]`).join('')}`;
          s.marks.forEach((m, j) => {
            const a = ((m.t0 - s.start) / 1000).toFixed(3), b = ((Math.min(m.t1, s.end) - s.start) / 1000 + 0.05).toFixed(3);
            const [bx, by, bw, bh] = m.box;
            fc += `;[${last}]drawbox=x=${bx + 2}:y=${by + LETTER + 2}:w=${bw - 4}:h=${bh - 4}:color=0x2563eb@0.95:t=3:enable='between(t,${a},${b})'[d${j}]`;
            fc += `;[d${j}][k${j}]overlay=${m.cur[0] - 5}:${m.cur[1] - 3 + LETTER}:enable='between(t,${a},${b})'[m${j}]`;
            last = `m${j}`;
          });
        }
        fc += `;[${last}]scale=out_range=tv:out_color_matrix=bt709,format=yuv420p[out]`;
        ff([...ins, '-filter_complex', fc, '-map', '[out]', ...enc], 'peer seg ' + k);
      }
      parts.push(out);
    });
    const cl = path.join(this.dir, 'parts.txt');
    fs.writeFileSync(cl, parts.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
    const mp4 = path.join(OUT, this.script.name + '.mp4');
    ff(['-f', 'concat', '-safe', '0', '-i', cl, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', '-metadata', `title=${this.script.title}`, mp4], 'final');
    return mp4;
  }
  srt() {
    if (this.capOpen) { this.capOpen.end = Date.now(); this.caps.push(this.capOpen); this.capOpen = null; }
    const fmt = ms => { ms = Math.max(0, Math.round(ms)); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
    const total = this.segs.reduce((a, s) => a + (s.end - s.start), 0);
    const rows = this.caps.map(c => ({ a: this.mapT(c.start), b: Math.min(total, this.mapT(c.end)), t: (c.n ? c.n + '. ' : '') + c.text })).filter(r => r.b - r.a > 300);
    const txt = rows.map((r, i) => `${i + 1}\n${fmt(r.a)} --> ${fmt(r.b)}\n${r.t}\n`).join('\n');
    const f = path.join(OUT, this.script.name + '.srt');
    fs.writeFileSync(f, txt, 'utf8');
    return { f, rows, total };
  }
}

// ---------- 시작 ----------
async function main() {
  const mainPg = await connect('main', 10000);
  if (!mainPg) { console.error('메인 창 CDP 대상을 찾지 못했습니다. 앱을 TC_DEBUG_PORT=9222 로 띄웠는지 확인하세요.'); process.exit(2); }
  if (flag('--restore-local')) { await restoreLocal(mainPg); mainPg.close(); return; }
  const file = argv.find(a => a.endsWith('.mjs'));
  if (!file) { console.error('대본 파일을 주세요: node tools/guide-video/record.mjs tools/guide-video/scripts/overview.mjs'); process.exit(2); }
  const mod = await import(pathToFileURL(path.resolve(file)).href);
  const env = makeEnv();
  const script = typeof mod.default === 'function' ? mod.default(env) : mod.default;
  const bad = scanForbidden(script.steps) || scanForbidden((script.prepare || []).concat(script.cleanup || []));
  if (bad) { console.error('대본에 금지 대상이 있습니다(회사 전송, 로그아웃): ' + bad); process.exit(2); }

  const booted = await mainPg.ev('typeof __bootMeta !== "undefined" && !!__bootMeta && typeof APP_VERSION === "string" ? APP_VERSION : ""');
  if (!booted) { console.error('앱이 부팅되지 않았습니다(DB 연결 확인).'); process.exit(2); }
  const demo = await mainPg.ev('state.categories.some(c => /^\\(예시\\)/.test(c.name))');
  if (!demo) { console.error('데모 데이터가 아닙니다. db/demo/demo-db.cmd -Load 를 먼저 하세요.'); process.exit(2); }
  log('앱', booted, '대본', script.name);

  const pid = Number(opt('--app-pid', psOnce(['-Op', 'pid'])));
  const S = new Session(script, pid);
  S.pages.main = mainPg;
  S.win = new Win(pid);
  fs.rmSync(S.dir, { recursive: true, force: true }); fs.mkdirSync(S.dir, { recursive: true });
  const cursorPng = path.join(S.dir, 'cursor.png');
  psOnce(['-Op', 'cursor', '-Out', cursorPng]);

  if (await findTarget('peer', 500)) { log('열려 있던 열람 창을 닫습니다'); await S.win.cmd('restore', '님의 일정'); await sleep(500); await S.win.cmd('close', '님의 일정'); await sleep(1200); }
  // 열람 창은 닫을 때의 최대화 여부를 기억한다(widget.settings.json 의 Peer). 녹화가 '처음 크기로 열림'을 전제하면 미리 풀어 둔다.
  if (script.resetPeer) await resetPeerWindow(S, script.resetPeer);
  await backupLocal(mainPg);
  // 녹화용 저장소: 실제 이름이 남은 '최근 본 사람'과 즐겨찾기를 비운다(끝나고 --restore-local 로 되돌림).
  await mainPg.ev(`(() => { for (const k of Object.keys(localStorage)) if (/^tc_peer(Recent|Fav):/.test(k)) localStorage.removeItem(k); return 1; })()`);

  // 메인 창 최대화(0.22.0 창 버튼), 열린 창 정리
  const w = await mainPg.ev('innerWidth');
  if (w < 1900) { await mainPg.ev('document.getElementById("hbMax").click(); 1'); await sleep(1500); }
  S.active = 'main';
  if (script.prepare) for (const st of script.prepare) { log('준비', st.act || 'js'); await S.ev(st.js); await sleep(st.ms ?? 200); }
  await S.inject('main');
  await S.ev(`__gv.place(${script.cursorStart?.[0] ?? 960},${script.cursorStart?.[1] ?? 560}); 1`);
  await sleep(600);

  let failed = null;
  try {
    await S.beginSeg({ kind: 'main' });
    await S.run(script.steps);
    await sleep(script.tail ?? 800);
  } catch (e) { failed = e; log('실패:', e.message); }
  S.endSeg();
  const srt = S.srt();
  // 겹침 층 걷기
  for (const k of ['main', 'peer']) if (S.pages[k] && !S.pages[k].closed) await S.ev('window.__gv && __gv.remove(); 1', k).catch(() => {});
  if (S.casting) await S.stopCast();
  if (script.closePeerAfter && await findTarget('peer', 500)) { await S.win.cmd('close', '님의 일정'); await sleep(1000); }
  if (script.resetPeer) await resetPeerWindow(S, script.resetPeer).catch(e => log('열람 창 크기 되돌리기 실패', e.message));
  if (script.cleanup) for (const st of script.cleanup) { try { await S.ev(st.js, 'main'); } catch (e) { log('정리 실패', e.message); } await sleep(st.ms ?? 200); }
  fs.writeFileSync(path.join(S.dir, 'timeline.json'), JSON.stringify({ script: script.name, segs: S.segs.map(s => ({ ctx: { ...s.ctx, bg: s.ctx.bg ? path.basename(s.ctx.bg) : null }, start: s.start, end: s.end, frames: s.frames.length, marks: s.marks })), caps: srt.rows, events: S.events, warnings: S.warnings }, null, 1));
  S.win.quit();
  if (failed) { console.error('녹화 실패: ' + failed.stack); process.exit(1); }
  if (DRY) { log('dry 끝(굽지 않음)'); return; }
  log('굽는 중...', S.segs.length, '구간', S.segs.reduce((a, s) => a + s.frames.length, 0), '프레임');
  const mp4 = S.encode(cursorPng);
  log('완료', mp4, (srt.total / 1000).toFixed(1) + 's', srt.f);
  if (!flag('--keep')) for (const s of S.segs) for (const fr of s.frames) fs.rmSync(fr.f, { force: true });
  mainPg.close();
}
// 녹화 밖에서 열람 창을 한 번 열고, 최대화돼 있으면 이전 크기로 돌린 뒤 닫는다(다음에 처음 크기로 열리게).
async function resetPeerWindow(S, login) {
  await S.ev(`(() => { document.querySelectorAll('.overlay:not(.hidden) .x').forEach(b => b.click()); document.getElementById('btnPeerPick').click(); return 1; })()`, 'main');
  for (let i = 0; i < 30; i++) { if (await S.ev(`!!document.querySelector('#pkBody [data-act=open][data-login=${login}]')`, 'main')) break; await sleep(150); }
  await S.ev(`(() => { document.querySelector('#pkBody [data-act=open][data-login=${login}]').click(); return 1; })()`, 'main');
  let info = null;
  for (let i = 0; i < 40; i++) { info = await S.win.cmd('rect', '님의 일정'); if (info && info.hwnd) break; await sleep(200); }
  if (!info || !info.hwnd) { log('열람 창이 안 열림(크기 되돌리기 건너뜀)'); return; }
  await sleep(900);
  if (info.zoomed) { await S.win.cmd('restore', '님의 일정'); await sleep(700); }
  await S.win.cmd('close', '님의 일정'); await sleep(1000);
  log('열람 창 크기 기억을 처음 크기로 맞춤', info.zoomed ? '(최대화 풀었음)' : '');
}
function makeEnv() {
  const d = new Date(); const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  // 새 일정을 넣을 날: 오늘에서 2~4일 뒤의 평일(이번 달 안). 미리알림이 녹화 중에 뜨지 않게 미래 날짜.
  let t = new Date(d); let add = 0;
  for (let k = 0; k < 8; k++) { t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 + k); if (t.getDay() !== 0 && t.getDay() !== 6) break; }
  if (t.getMonth() !== d.getMonth()) for (let k = 1; k < 8; k++) { const u = new Date(d.getFullYear(), d.getMonth(), d.getDate() - k); if (u.getDay() !== 0 && u.getDay() !== 6) { t = u; break; } }
  void add;
  return { today: iso(d), day: iso(t), dayLabel: `${t.getMonth() + 1}월 ${t.getDate()}일` };
}
main().catch(e => { console.error(e); process.exit(1); });
