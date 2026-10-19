// 아주 작은 CDP 클라이언트(Node 22+ 내장 WebSocket, 추가 의존성 없음).
//   설치형 앱을 TC_DEBUG_PORT 로 띄우면 WebView2 가 원격 디버깅 포트를 연다.
//   메인 창 = url 이 tcapp.local 이고 peerwin=1 이 없는 page, 다른 사람 일정 창 = url 에 peerwin=1.
export const PORT = process.env.TC_DEBUG_PORT || '9222';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function listTargets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  return (await r.json()).filter(t => t.type === 'page');
}

export async function findTarget(kind = 'main', timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await listTargets();
      const hit = list.find(t => kind === 'peer' ? /peerwin=1/.test(t.url) : (/tcapp\.local/.test(t.url) && !/peerwin=1|peer=1/.test(t.url)));
      if (hit) return hit;
    } catch {}
    await sleep(300);
  }
  return null;
}

export class Cdp {
  constructor(target) { this.target = target; this.id = 0; this.pend = new Map(); this.handlers = new Map(); }
  async open() {
    this.ws = new WebSocket(this.target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', rej, { once: true }); });
    this.ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pend.has(m.id)) { const p = this.pend.get(m.id); this.pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
      else if (m.method) { const h = this.handlers.get(m.method); if (h) h(m.params); }
    });
    this.closed = false;
    this.ws.addEventListener('close', () => { this.closed = true; for (const p of this.pend.values()) p.rej(new Error('closed')); this.pend.clear(); });
    return this;
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('closed'));
    const i = ++this.id;
    return new Promise((res, rej) => { this.pend.set(i, { res, rej }); this.ws.send(JSON.stringify({ id: i, method, params })); });
  }
  on(method, fn) { this.handlers.set(method, fn); }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

export async function connect(kind = 'main', timeoutMs = 30000) {
  const t = await findTarget(kind, timeoutMs);
  if (!t) return null;
  return new Cdp(t).open();
}
