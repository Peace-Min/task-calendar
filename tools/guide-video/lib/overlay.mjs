// 녹화 중에만 페이지 DOM 에 넣는 겹침 층(자막 막대, 커서, 누름 물결, 강조 테두리, 안내 카드).
//   Runtime.evaluate 로 넣고 녹화가 끝나면 __gv.remove() 로 걷는다. 앱 소스는 바꾸지 않는다.
//   ★ 모든 요소는 pointer-events:none 이라 실제 클릭(CDP Input)을 가로채지 않는다.
//   ★ 화면 문구 규칙: 엠 대시, en 대시, 띄어 쓴 가운데 점, 낫표를 쓰지 않는다(korean-ai-punct).
const CSS = `
/* 녹화 중에만: 앱 토스트가 자막 막대 뒤에 가리지 않게 위로 올린다(겹침 층과 함께 걷힌다). */
#toastWrap { bottom: 118px !important; }
#__gv, #__gv * { pointer-events: none !important; box-sizing: border-box; }
#__gv { position: fixed; inset: 0; z-index: 2147483647; font-family: "Pretendard", "Malgun Gothic", "맑은 고딕", system-ui, sans-serif; }
#__gv .gv-cur { position: absolute; left: 0; top: 0; width: 30px; height: 30px; transform: translate(-100px, -100px); will-change: transform;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); transition-property: transform; transition-timing-function: cubic-bezier(.45,.05,.25,1); }
#__gv .gv-cur svg { width: 30px; height: 30px; display: block; }
#__gv .gv-cur.hidden { opacity: 0; }
#__gv .gv-rip { position: absolute; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
  border: 4px solid #2563eb; background: rgba(37,99,235,.18); animation: gvRip .65s ease-out forwards; }
@keyframes gvRip { from { transform: scale(.25); opacity: 1; } to { transform: scale(1.35); opacity: 0; } }
#__gv .gv-cap { position: absolute; left: 50%; bottom: 30px; transform: translate(-50%, 16px); opacity: 0; max-width: calc(100% - 80px);
  display: flex; align-items: center; gap: 14px; padding: 14px 28px 14px 16px; border-radius: 16px;
  background: rgba(255,255,255,.97); border: 1px solid #cfd8e3; box-shadow: 0 12px 34px rgba(15,23,42,.24), 0 2px 6px rgba(15,23,42,.12);
  color: #0f172a; font-size: 27px; font-weight: 700; letter-spacing: -.2px; line-height: 1.3; white-space: nowrap;
  transition: opacity .28s ease, transform .28s ease; }
#__gv .gv-cap.on { opacity: 1; transform: translate(-50%, 0); }
#__gv .gv-cap.top { bottom: auto; top: 24px; transform: translate(-50%, -16px); }
#__gv .gv-cap.top.on { transform: translate(-50%, 0); }
#__gv .gv-cap .n { flex: none; min-width: 40px; height: 40px; padding: 0 10px; border-radius: 20px; background: #2563eb; color: #fff;
  font-size: 22px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
#__gv .gv-cap .n:empty { display: none; }
#__gv .gv-cap.non .n { display: none; }
#__gv .gv-cap .t { padding-left: 4px; }
#__gv .gv-hl { position: absolute; border: 4px solid #f59e0b; border-radius: 12px; box-shadow: 0 0 0 6px rgba(245,158,11,.22);
  opacity: 0; transition: opacity .25s ease; animation: gvPulse 1.2s ease-in-out infinite; }
#__gv .gv-hl.on { opacity: 1; }
@keyframes gvPulse { 0%,100% { box-shadow: 0 0 0 4px rgba(245,158,11,.20); } 50% { box-shadow: 0 0 0 10px rgba(245,158,11,.08); } }
#__gv .gv-hl .lb { position: absolute; left: -4px; bottom: calc(100% + 8px); padding: 6px 14px; border-radius: 10px; background: #f59e0b; color: #1f1300;
  font-size: 20px; font-weight: 800; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,.18); }
#__gv .gv-hl .lb.below { bottom: auto; top: calc(100% + 8px); }
#__gv .gv-dim { position: absolute; inset: 0; background: rgba(15,23,42,.38); opacity: 0; transition: opacity .3s ease; }
#__gv .gv-dim.on { opacity: 1; }
#__gv .gv-card { position: absolute; left: 50%; top: 50%; width: min(980px, calc(100% - 80px)); transform: translate(-50%, -46%); opacity: 0;
  background: #fff; border-radius: 22px; border: 1px solid #d6dee8; box-shadow: 0 24px 60px rgba(15,23,42,.30); padding: 40px 48px; color: #0f172a;
  transition: opacity .32s ease, transform .32s ease; }
#__gv .gv-card.on { opacity: 1; transform: translate(-50%, -50%); }
#__gv .gv-card h1 { margin: 0 0 10px; font-size: 44px; font-weight: 800; letter-spacing: -.6px; }
#__gv .gv-card h2 { margin: 0 0 22px; font-size: 26px; font-weight: 600; color: #475569; }
#__gv .gv-card .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
#__gv .gv-card .col { border: 1px solid #dbe3ee; border-radius: 16px; padding: 22px 24px; background: #f8fafc; }
#__gv .gv-card .col h3 { margin: 0 0 12px; font-size: 27px; font-weight: 800; display: flex; align-items: center; gap: 10px; }
#__gv .gv-card .col h3 .bd { font-size: 16px; font-weight: 800; padding: 3px 9px; border-radius: 7px; background: #e0e7ff; color: #3949ab; }
#__gv .gv-card .col ul { margin: 0; padding-left: 22px; font-size: 22px; line-height: 1.65; color: #1e293b; }
#__gv .gv-card .brand { display: flex; align-items: center; gap: 18px; margin-bottom: 8px; }
#__gv .gv-card .brand .ic { width: 64px; height: 64px; border-radius: 16px; background: #2563eb; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: 800; }
#__gv .gv-card p { margin: 0; font-size: 24px; line-height: 1.6; color: #334155; }
/* v3 홍보 영상: 굵은 짧은 문구(punch)와 전면 제목 카드(title) */
#__gv .gv-punch { position: absolute; left: 64px; bottom: 64px; display: flex; align-items: stretch; opacity: 0; transform: translateY(26px) scale(.98);
  transition: opacity .26s ease, transform .34s cubic-bezier(.2,.9,.25,1.15); filter: drop-shadow(0 18px 40px rgba(2,6,23,.38)); }
#__gv .gv-punch.on { opacity: 1; transform: none; }
#__gv .gv-punch.right { left: auto; right: 64px; }
#__gv .gv-punch.top { bottom: auto; top: 56px; }
#__gv .gv-punch .bar { width: 14px; border-radius: 14px 0 0 14px; background: #3b82f6; }
#__gv .gv-punch .box { padding: 22px 40px 24px 30px; border-radius: 0 18px 18px 0; background: rgba(15,23,42,.94); color: #fff; }
#__gv .gv-punch .big { font-size: 66px; font-weight: 900; letter-spacing: -1.6px; line-height: 1.08; white-space: nowrap; }
#__gv .gv-punch .big em { font-style: normal; color: #7cc0ff; }
#__gv .gv-punch .sub { margin-top: 8px; font-size: 26px; font-weight: 600; color: #cbd5e1; letter-spacing: -.3px; white-space: nowrap; }
#__gv .gv-punch .sub:empty { display: none; }
#__gv .gv-title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center;
  background: radial-gradient(1200px 700px at 30% 20%, #1d4ed8 0%, rgba(29,78,216,0) 60%), radial-gradient(900px 600px at 85% 90%, #0ea5e9 0%, rgba(14,165,233,0) 55%), #0b1222;
  color: #fff; opacity: 0; transition: opacity .3s ease; }
#__gv .gv-title.on { opacity: 1; }
#__gv .gv-title > * { transform: translateY(18px) scale(1.04); opacity: 0; transition: transform .6s cubic-bezier(.16,1,.3,1), opacity .45s ease; }
#__gv .gv-title.on > * { transform: none; opacity: 1; }
#__gv .gv-title.on > :nth-child(2) { transition-delay: .08s; }
#__gv .gv-title.on > :nth-child(3) { transition-delay: .16s; }
#__gv .gv-title.on > :nth-child(4) { transition-delay: .24s; }
#__gv .gv-title .kick { font-size: 30px; font-weight: 700; letter-spacing: 6px; color: #93c5fd; }
#__gv .gv-title .name { font-size: 120px; font-weight: 900; letter-spacing: -4px; line-height: 1.04; }
#__gv .gv-title .tag { font-size: 40px; font-weight: 600; color: #dbeafe; letter-spacing: -.6px; }
#__gv .gv-title img { width: 132px; height: 132px; border-radius: 30px; box-shadow: 0 20px 50px rgba(0,0,0,.45); }
`;

function overlayMain(CSS) {
  if (window.__gv && window.__gv.alive) return 'exists';
  const root = document.createElement('div');
  root.id = '__gv';
  root.setAttribute('aria-hidden', 'true');
  const css = document.createElement('style');
  css.textContent = CSS;
  root.appendChild(css);
  const dim = document.createElement('div'); dim.className = 'gv-dim'; root.appendChild(dim);
  const card = document.createElement('div'); card.className = 'gv-card'; root.appendChild(card);
  const cap = document.createElement('div'); cap.className = 'gv-cap'; cap.innerHTML = '<span class="n"></span><span class="t"></span>'; root.appendChild(cap);
  const punch = document.createElement('div'); punch.className = 'gv-punch'; punch.innerHTML = '<span class="bar"></span><div class="box"><div class="big"></div><div class="sub"></div></div>'; root.appendChild(punch);
  const title = document.createElement('div'); title.className = 'gv-title'; root.appendChild(title);
  const cur = document.createElement('div'); cur.className = 'gv-cur';
  cur.innerHTML = '<svg viewBox="0 0 30 30"><path d="M5 3 L5 24 L10.2 19.4 L13.6 27 L17.4 25.3 L14 17.9 L21 17.6 Z" fill="#ffffff" stroke="#111827" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  root.appendChild(cur);
  document.documentElement.appendChild(root);
  let cx = -100, cy = -100;
  const hls = new Map();
  const api = {
    alive: true,
    pos() { return [cx, cy]; },
    place(x, y) { cur.style.transitionDuration = '0ms'; cx = x; cy = y; cur.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 3) + 'px)'; void cur.offsetWidth; },
    cursorTo(x, y, ms) {
      cur.classList.remove('hidden');
      cur.style.transitionDuration = (ms | 0) + 'ms'; cx = x; cy = y;
      cur.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 3) + 'px)';
      return new Promise(r => setTimeout(r, (ms | 0) + 20));
    },
    hideCursor(h) { cur.classList.toggle('hidden', !!h); },
    ripple(x, y) { const d = document.createElement('div'); d.className = 'gv-rip'; d.style.left = x + 'px'; d.style.top = y + 'px'; root.appendChild(d); setTimeout(() => d.remove(), 800); },
    caption(text, n, where) {
      if (!text) { cap.classList.remove('on'); return; }
      const same = cap.classList.contains('on') && cap.dataset.k === (n + '|' + text);
      if (same) return;
      const show = () => {
        cap.querySelector('.n').textContent = n ? String(n) : '';
        cap.querySelector('.t').textContent = text;
        cap.classList.toggle('top', where === 'top');
        cap.dataset.k = n + '|' + text; void cap.offsetWidth; cap.classList.add('on');
      };
      if (cap.classList.contains('on')) { cap.classList.remove('on'); setTimeout(show, 200); } else show();
    },
    highlight(id, r, label, below) {
      api.unhighlight(id, true);
      const d = document.createElement('div'); d.className = 'gv-hl';
      const pad = 6;
      d.style.left = (r.x - pad) + 'px'; d.style.top = (r.y - pad) + 'px'; d.style.width = (r.w + pad * 2) + 'px'; d.style.height = (r.h + pad * 2) + 'px';
      if (label) { const l = document.createElement('div'); l.className = 'lb' + (below ? ' below' : ''); l.textContent = label; d.appendChild(l); }
      root.appendChild(d); void d.offsetWidth; d.classList.add('on'); hls.set(id, d);
    },
    unhighlight(id, now) {
      const ids = id == null ? [...hls.keys()] : [id];
      for (const k of ids) { const d = hls.get(k); if (!d) continue; hls.delete(k); if (now) d.remove(); else { d.classList.remove('on'); setTimeout(() => d.remove(), 300); } }
    },
    card(html, withDim) { card.innerHTML = html; dim.classList.toggle('on', withDim !== false); void card.offsetWidth; card.classList.add('on'); },
    hideCard() { card.classList.remove('on'); dim.classList.remove('on'); },
    setVisible(v) { root.style.display = v ? '' : 'none'; },
    // 커서 이동 곡선(v3 는 끝에서 느려지는 ease-out)
    setEase(e) { cur.style.transitionTimingFunction = e || ''; },
    // 굵은 짧은 문구. text 안의 *글자* 는 강조색. where: '', 'right', 'top', 'right top'
    punch(text, sub, where) {
      if (!text) { punch.classList.remove('on'); return; }
      const k = text + '|' + (sub || '') + '|' + (where || '');
      if (punch.classList.contains('on') && punch.dataset.k === k) return;
      const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const show = () => {
        punch.className = 'gv-punch ' + (where || '');
        punch.querySelector('.big').innerHTML = esc(text).replace(/\*(.+?)\*/g, '<em>$1</em>');
        punch.querySelector('.sub').textContent = sub || '';
        punch.dataset.k = k; void punch.offsetWidth; punch.classList.add('on');
      };
      if (punch.classList.contains('on')) { punch.classList.remove('on'); setTimeout(show, 160); } else show();
    },
    // 전면 제목 카드(홍보 영상 처음과 끝)
    title(html) { if (!html) { title.classList.remove('on'); return; } title.innerHTML = html; void title.offsetWidth; title.classList.add('on'); },
    // 화면 확대와 이동: body 에 transform 을 건다(겹침 층은 html 바로 아래라 확대되지 않는다). 다시 그려서 글자가 선명하다.
    //   r = 보여 줄 영역(뷰포트 좌표, 확대 전 기준), s = 배율, ms = 이동 시간
    zoom(r, s, ms) {
      const b = document.body, W = innerWidth, H = innerHeight;
      if (!r || s <= 1) {
        b.style.transition = 'transform ' + (ms | 0) + 'ms cubic-bezier(.45,0,.25,1)'; b.style.transform = 'translate(0px,0px) scale(1)';
        clearTimeout(api._zt); api._zt = setTimeout(() => { if (!api._zon) { b.style.transform = ''; b.style.transition = ''; b.style.transformOrigin = ''; } }, (ms | 0) + 60);
        api._zon = false; api._z = [0, 0, 1]; return [0, 0, 1];
      }
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const tx = Math.max(W - W * s, Math.min(0, W / 2 - cx * s)), ty = Math.max(H - H * s, Math.min(0, H / 2 - cy * s));
      api._zon = true; clearTimeout(api._zt);
      b.style.transformOrigin = '0 0';
      b.style.transition = 'transform ' + (ms | 0) + 'ms cubic-bezier(.45,0,.25,1)';
      b.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(' + s + ')';
      api._z = [tx, ty, s];
      return [tx, ty, s];
    },
    zstate() { return api._z || [0, 0, 1]; },
    remove() {
      api.alive = false; root.remove(); delete window.__gv;
      const b = document.body; b.style.transform = ''; b.style.transition = ''; b.style.transformOrigin = '';
    }
  };
  window.__gv = api;
  return 'ok';
}

export const OVERLAY_JS = `(${overlayMain.toString()})(${JSON.stringify(CSS)})`;
