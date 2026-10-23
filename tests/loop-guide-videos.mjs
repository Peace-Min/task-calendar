/* ============================================================================
 *  tests/loop-guide-videos.mjs: 사용 영상 안내 실 위젯 확인(docs/GUIDE-VIDEOS.md)
 * ----------------------------------------------------------------------------
 *  준비(PM, 한 번)
 *    1) 시험용 업데이트 폴더를 만든다. dist\guide-video\*_v3.mp4 와 같은 이름의 .srt 를 <폴더>\guide\ 로 복사하고
 *       guide.json(판 번호, 영상 넷, 자막에서 뽑은 장면)을 쓴다. 위젯은 필요 없다.
 *         node tests/loop-guide-videos.mjs --make=C:\tc-guide-test [--from=<dist\guide-video>] [--version=loop-1]
 *       --from 을 주지 않으면 이 저장소의 dist\guide-video, 없으면 주 체크아웃(워크트리의 세 단계 위)의 dist\guide-video 를 쓴다.
 *    2) 이 브랜치로 빌드한 위젯을 디버그 포트로 띄우고 로그인한다(TC_DEBUG_PORT=9222).
 *    3) 업데이트 폴더를 시험 폴더로. 둘 중 하나:
 *         a) 설정 창의 업데이트 폴더 칸에 C:\tc-guide-test 를 넣고 저장한다.
 *         b) 아래 실행에 --source=C:\tc-guide-test 를 준다. 루프가 앱의 설정 명령(updateSetSource)으로 바꿨다가 끝나면 원래 값으로 되돌린다.
 *  실행
 *    node tests/loop-guide-videos.mjs [--port=9222] [--source=C:\tc-guide-test]
 *  보는 것
 *    G0 호스트가 guide.json 을 읽는다(guideManifest)
 *    G1 새 실행처럼 되돌린 뒤(이 계정의 tc_guideSeen, 실행 안 기억을 비움) 묻는 창이 뜬다. 문구는 기록 유무 규칙대로
 *    G2 [보기] 가 판을 기록하고 보기 창을 연다. 목록이 guide.json 과 같다
 *    G3 영상이 가상 호스트(https://guide.tcapp.local/)로 실제로 읽힌다(readyState >= 1)
 *    G4 장면을 누르면 그 초로 간다. 자막이 있는 영상이면 트랙이 붙는다
 *    G5 [다시 묻지 않기] 가 기록되고 페이지를 다시 읽어도(Page.reload) 남는다. 다시 읽은 뒤에는 묻지 않는다
 *    끝나면 이 계정의 tc_guideSeen 과 실행 안 기억(sessionStorage)을 처음 값으로 되돌린다. DB 는 건드리지 않는다.
 *  종료코드: 0 통과, 1 실패, 2 판정 없음(위젯 없음, 업데이트 폴더 미설정, guide 폴더 없음)
 * ==========================================================================*/
import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// ── 1) 시험 폴더 만들기(--make) ─────────────────────────────────────────
if (arg('make', '')) {
  const out = resolve(arg('make', ''));
  const cands = [arg('from', ''), join(REPO, 'dist', 'guide-video'), resolve(REPO, '..', '..', '..', 'dist', 'guide-video')].filter(Boolean);
  const from = cands.find((p) => existsSync(p) && statSync(p).isDirectory());
  if (!from) { console.log('dist\\guide-video 를 찾지 못했다. --from=<폴더> 로 알려 주세요. 찾아본 곳: ' + cands.join(', ')); process.exit(2); }
  const { GUIDES, parseSrt, buildChapters } = await import('../tools/guide-video/build-site.mjs');
  const tag = arg('tag', 'v3');
  const dir = join(out, 'guide');
  mkdirSync(dir, { recursive: true });
  const videos = [];
  for (const g of GUIDES) {
    const mp4 = `${g.base}_${tag}.mp4`, srt = `${g.base}_${tag}.srt`;
    if (!existsSync(join(from, mp4))) { console.log('  없음, 건너뜀: ' + mp4); continue; }
    copyFileSync(join(from, mp4), join(dir, mp4));
    let chapters = [];
    if (existsSync(join(from, srt))) {
      copyFileSync(join(from, srt), join(dir, srt));
      chapters = buildChapters(parseSrt(readFileSync(join(from, srt), 'utf8')), { max: 6 })
        .filter((c) => c.title).map((c) => ({ t: Math.floor(c.start), title: c.title }));
    }
    videos.push({ id: g.id, file: mp4, title: g.title, ...(chapters.length > 1 ? { chapters } : {}) });
  }
  if (!videos.length) { console.log('복사한 영상이 없다(' + from + '\\*_' + tag + '.mp4)'); process.exit(2); }
  const manifest = { version: arg('version', 'loop-1'), videos };
  writeFileSync(join(dir, 'guide.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`시험 폴더를 만들었다: ${dir}`);
  console.log(`  영상 ${videos.length}편, 판 번호 ${manifest.version}, 자막 ${readdirSync(dir).filter((f) => f.endsWith('.srt')).length}개`);
  console.log(`다음: 위젯(TC_DEBUG_PORT=9222)에 로그인한 뒤  node tests/loop-guide-videos.mjs --source=${out}`);
  process.exit(0);
}

// ── 2) 실 위젯 확인 ─────────────────────────────────────────────────────
const PORT = arg('port', '9222');
const SOURCE = arg('source', '');
let pass = 0, fail = 0, und = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}${d ? ' (' + d + ')' : ''}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' (' + d + ')' : ''}`); } };
const undecide = (n, d) => { und++; console.log(`  ? ${n}: 판정 불가, ${d}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, id = 0; const pend = new Map();
async function connect() {
  let list; try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { return false; }
  const p = list.find((x) => x.type === 'page' && /tcapp\.local/.test(x.url || '') && !/peerwin=1|[?&]win=admin/.test(x.url || ''));
  if (!p) return false;
  ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  return true;
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = (x) => new Promise((r, j) => { const i = ++id; pend.set(i, (m) => (m.result?.exceptionDetails ? j(new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300))) : r(m.result?.result?.value))); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: x, awaitPromise: true, returnByValue: true } })); });
//  식이 Promise 여도 기다린 값을 직렬화한다(JSON.stringify(Promise) 는 {} 다)
const J = async (x) => JSON.parse(await ev(`Promise.resolve(${x}).then(v => JSON.stringify(v))`));
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(fn)) return true; } catch { /* 다시 읽는 중 */ } await sleep(250); } return false; }
const healthy = `(typeof gvOnBootApplied === 'function' && typeof conn !== 'undefined' && conn === 'ok' && bootOk && !!pkMe() && !__gateOn)`;
const isOpen = (id) => `(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.classList.contains('hidden') && !e.classList.contains('closing'); })()`;
//  업데이트 폴더 주소를 앱에서 읽는다(설정 창과 같은 길: updateSourceGet → __updateSource).
const readSource = () => ev(`new Promise(res => { const o = window.__updateSource; const t = setTimeout(() => { window.__updateSource = o; res(null); }, 5000);
  window.__updateSource = function(u){ clearTimeout(t); window.__updateSource = o; try{ o && o.apply(this, arguments); }catch(_){} res(String(u || '')); }; hpost({ cmd:'updateSourceGet' }); })`);
const setSource = (u) => ev(`(hpost({ cmd:'updateSetSource', url: ${JSON.stringify(u)} }), true)`);
//  모든 창을 닫는다(묻는 창이 뜰 자리를 비운다). 닫히지 않는 창이 남으면 false.
const closeAll = async () => { for (let i = 0; i < 8; i++) { if (!(await ev('openOverlays().length'))) return true; await ev('closeTopModal()'); await sleep(250); } return !(await ev('openOverlays().length')); };

(async () => {
  if (!(await connect())) { console.log('판정 없음: CDP 페이지 없음(이 브랜치 위젯을 TC_DEBUG_PORT=9222 로 띄우고 로그인하세요)'); process.exit(2); }
  console.log(`[loop-guide-videos] port=${PORT}${SOURCE ? ' source=' + SOURCE : ''}`);
  let me = '', seen0 = null, asked0 = null, src0 = null, version = '';
  try {
    if (!(await ev(`typeof gvOnBootApplied === 'function'`))) { undecide('O0 앱', '사용 영상 코드가 없다(이 브랜치로 빌드한 위젯인가)'); return; }
    if (!(await waitFor(healthy, 30000))) { undecide('O0 정상 연결과 로그인', JSON.stringify(await J(`{ conn, bootOk, me: pkMe(), gate: __gateOn }`))); return; }
    me = await ev('pkMe()');
    seen0 = await ev(`(() => { try{ return localStorage.getItem('tc_guideSeen:' + pkMe()); }catch(_){ return null; } })()`);
    asked0 = await ev(`(() => { try{ return sessionStorage.getItem('tc_guideAsked'); }catch(_){ return null; } })()`);
    if (SOURCE) {
      src0 = await readSource();
      if (src0 == null) { undecide('O0 업데이트 폴더 읽기', '__updateSource 회신이 없다'); return; }
      await setSource(SOURCE); await sleep(500);
    }
    ok('O0 conn ok, 로그인, 사용 영상 코드', true, 'me=' + me);

    // G0 호스트가 guide.json 을 읽는다
    const man = await J(`hostRequest('guideManifest', {}, 20000)`);
    if (!man || !man.ok) { undecide('G0 guideManifest', JSON.stringify(man) + '. 업데이트 폴더에 guide\\guide.json 이 있는지 보세요(--make, --source)'); return; }
    version = String(man.version);
    ok('G0 guide.json 을 읽었다', man.videos.length >= 1, `판 ${version}, 영상 ${man.videos.length}편, ${man.source}`);

    // G1 새 실행처럼 되돌리고 묻기
    if (!(await closeAll())) { undecide('G1 묻는 창', '닫히지 않는 창이 있다'); return; }
    await ev(`(() => { try{ localStorage.removeItem('tc_guideSeen:' + pkMe()); }catch(_){} try{ sessionStorage.removeItem('tc_guideAsked'); }catch(_){} GV.asked.clear(); GV.pending = ''; gvOnBootApplied(); return 1; })()`);
    ok('G1 묻는 창이 뜬다', await waitFor(isOpen('gvAskModal'), 15000));
    const g1 = await J(`({ text: document.getElementById('gvAskText').textContent, first: !(state.entries || []).length && !(state.todos || []).length })`);
    ok('G1 문구가 기록 유무 규칙대로', g1.text === (g1.first ? '사용 영상을 보시겠습니까?' : '새 기능 가이드가 추가되었습니다'), g1.text);

    // G2 [보기]
    await ev(`(document.getElementById('btnGvOpen').click(), 1)`);
    ok('G2 [보기] 가 판을 기록한다', (await ev(`localStorage.getItem('tc_guideSeen:' + pkMe())`)) === version);
    ok('G2 보기 창이 열린다', await waitFor(isOpen('gvModal'), 5000));
    ok('G2 목록이 guide.json 과 같다', await waitFor(`document.querySelectorAll('#gvList .gv-item').length === ${man.videos.length}`, 20000),
      String(await ev(`document.querySelectorAll('#gvList .gv-item').length`)));

    // G3 가상 호스트로 재생 준비
    await ev(`(document.getElementById('gvVideo').muted = true, 1)`);
    const loadMs = man.source === 'net' ? 300000 : 30000;
    const ready = await waitFor(`(() => { const v = document.getElementById('gvVideo'); return v.readyState >= 1 && /^https:\\/\\/guide\\.tcapp\\.local\\//.test(v.currentSrc); })()`, loadMs);
    const g3 = await J(`(() => { const v = document.getElementById('gvVideo'); return { src: v.currentSrc, rs: v.readyState, dur: v.duration, err: v.error && v.error.code, msg: document.getElementById('gvMsg').textContent }; })()`);
    ok('G3 첫 영상이 guide.tcapp.local 로 읽힌다(readyState >= 1)', ready, JSON.stringify(g3));

    // G4 장면 이동과 자막
    const withCh = man.videos.find((v) => (v.chapters || []).some((c) => c.t > 1));
    if (!withCh) undecide('G4 장면 이동', 'guide.json 에 장면이 있는 영상이 없다');
    else {
      await ev(`(document.querySelector('#gvList .gv-item[data-gvid=${JSON.stringify(withCh.id)}]').click(), 1)`);
      const r4 = await waitFor(`(() => { const v = document.getElementById('gvVideo'); return v.readyState >= 1 && decodeURIComponent(v.currentSrc).endsWith(${JSON.stringify('/' + withCh.file)}); })()`, loadMs);
      if (!r4) undecide('G4 장면 이동', withCh.file + ' 이 준비되지 않았다');
      else {
        const ch = withCh.chapters.filter((c) => c.t > 1).at(-1);
        await ev(`(() => { const b = [...document.querySelectorAll('#gvChapters .gv-ch')].find(x => Number(x.dataset.t) === ${ch.t}); if(b) b.click(); return !!b; })()`);
        const moved = await waitFor(`(() => { const t = document.getElementById('gvVideo').currentTime; return t >= ${ch.t - 0.5} && t <= ${ch.t + 4}; })()`, 5000);
        ok('G4 장면을 누르면 그 초로 간다', moved, `${ch.t}초 ${ch.title}, 지금 ${(await ev(`document.getElementById('gvVideo').currentTime`)).toFixed(1)}초`);
        await ev(`(document.getElementById('gvVideo').pause(), 1)`);
      }
      const fr = await J(`hostRequest('guideFetch', { file: ${JSON.stringify(withCh.file)} }, 30000)`);
      const tracks = await ev(`document.querySelectorAll('#gvVideo track').length`);
      if (fr && fr.ok && fr.srt) ok('G4 자막이 있는 영상은 트랙이 붙는다', tracks === 1, 'track=' + tracks);
      else undecide('G4 자막', '이 영상에 같은 이름의 .srt 가 없다');
    }
    await ev(`(closeModal('#gvModal'), 1)`); await sleep(400);

    // G5 [다시 묻지 않기] 가 다시 읽어도 남는다
    if (!(await closeAll())) { undecide('G5', '닫히지 않는 창이 있다'); return; }
    await ev(`(() => { try{ localStorage.removeItem('tc_guideSeen:' + pkMe()); }catch(_){} try{ sessionStorage.removeItem('tc_guideAsked'); }catch(_){} GV.asked.clear(); GV.pending = ''; gvOnBootApplied(); return 1; })()`);
    if (!(await waitFor(isOpen('gvAskModal'), 15000))) { fail++; console.log('  ✗ G5 묻는 창이 다시 뜨지 않는다'); return; }
    await ev(`(document.getElementById('btnGvNever').click(), 1)`);
    ok('G5 [다시 묻지 않기] 가 판을 기록하고 보기 창은 열지 않는다', (await ev(`localStorage.getItem('tc_guideSeen:' + pkMe())`)) === version && !(await ev(isOpen('gvModal'))));
    await send('Page.reload', { ignoreCache: false });
    await sleep(1500);
    if (!(await waitFor(healthy, 60000))) { undecide('G5 다시 읽기', '다시 읽은 뒤 정상 연결과 로그인으로 돌아오지 않았다'); return; }
    ok('G5 다시 읽은 뒤에도 기록이 남는다', (await ev(`localStorage.getItem('tc_guideSeen:' + pkMe())`)) === version);
    await sleep(6000);
    ok('G5 다시 읽은 뒤 묻지 않는다(실행당 한 번, 본 판)', !(await ev(isOpen('gvAskModal'))));
    await ev(`(() => { try{ sessionStorage.removeItem('tc_guideAsked'); }catch(_){} GV.asked.clear(); GV.pending = ''; gvOnBootApplied(); return 1; })()`);
    await sleep(5000);
    ok('G5 실행 안 기억을 비워도 본 판이라 묻지 않는다', !(await ev(isOpen('gvAskModal'))));
  } catch (e) { fail++; console.log('  ✗ 예외: ' + e.message); }
  finally {
    try {
      if (me) {
        await ev(`(() => { try{ ${seen0 == null ? `localStorage.removeItem('tc_guideSeen:' + ${JSON.stringify(me)})` : `localStorage.setItem('tc_guideSeen:' + ${JSON.stringify(me)}, ${JSON.stringify(seen0)})`}; }catch(_){}
          try{ ${asked0 == null ? `sessionStorage.removeItem('tc_guideAsked')` : `sessionStorage.setItem('tc_guideAsked', ${JSON.stringify(asked0)})`}; }catch(_){}
          try{ closeModal('#gvModal'); closeModal('#gvAskModal'); }catch(_){} return 1; })()`);
        const back = await ev(`(() => { try{ return localStorage.getItem('tc_guideSeen:' + ${JSON.stringify(me)}); }catch(_){ return 'X'; } })()`);
        ok('정리: tc_guideSeen 을 처음 값으로', back === seen0, String(back));
      }
      if (SOURCE && src0 != null) { await setSource(src0); await sleep(300); ok('정리: 업데이트 폴더를 처음 값으로', (await readSource()) === src0, src0 || '(빈 값)'); }
    } catch (e) { console.log('  !!! 정리 실패: ' + e.message + '. 설정의 업데이트 폴더와 localStorage tc_guideSeen:<로그인> 을 직접 확인하세요'); }
    console.log(`\n통과 ${pass}, 실패 ${fail}, 판정 불가 ${und}`);
    try { ws.close(); } catch {}
    process.exit(fail ? 1 : (und ? 2 : 0));
  }
})();
