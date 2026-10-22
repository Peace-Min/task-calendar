// 버전 관문 웹 차단 카드(docs/VERSION-GATE.md §3, 시안 docs/prototypes/version-gate.html).
//
// 이 파일이 지키는 것:
//   (S) 정적: 제목줄을 덮지 않는 자리(top 32px), 막힌 동안 상단 업데이트 알림 숨김, 열람 창 allowlist 에 카드, 열람 창 명령에 gateRecheck,
//       모든 회신이 관문 실패를 카드로 보내는 자리(hostRequest), 막힌 동안 오류 토스트 끄기, 열람 창 닫기(window.close)를 호스트가 받는다,
//       없앤 것이 되살아나지 않는다("새 버전 준비 중", 저장되지 않은 변경 목록 복사, 스키마 불일치 띠).
//   (R) jsdom(위젯 모드): 상태별 카드(제목, 버튼 있고 없음), 주 버튼 포커스, 뒤 화면 inert(제목줄은 살림), 저장되지 않은 변경 경고는
//       unsaved 일 때만, 'ok' 로 카드가 닫히고 다시 읽기(reloadState)는 한 번, 열람 창 변형(업데이트 버튼 없음, [이 창 닫기]),
//       관문 회신(저장, 일반 요청, 부팅 실패, 회사 보고 전송)이 일반 오류 토스트와 상자를 띄우지 않는다, 막힌 동안 배너 숨김,
//       화면 문구 기호 규칙(엠 대시, en 대시, 띄어 쓴 가운데 점, 낫표 없음).
//   (M) 변이: 핵심 줄을 빼면 위 검사가 잡는다.
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM, readText } from './harness.mjs';

const src = loadAppSource();
const peerCs = readText(new URL('../widget/AppWindow.cs', import.meta.url)).replace(/\r/g, '');

function mutate(from, to, base = src) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}

//  화면 문구 기호 규칙(tests/ui-copy-punct 와 같은 규칙, korean-ai-punct).
const PUNCT = [[/—/, '엠 대시'], [/–/, 'en 대시'], [/「|」/, '낫표'], [/(^|\s)·|·(\s|$)/, '띄어 쓴 가운데 점']];
const punctBad = (t) => PUNCT.filter(([re]) => re.test(t)).map(([, n]) => n);

/* ── (S) 정적 ─────────────────────────────────────────────────────────── */
const statics = {
  layout(app) {
    assert.ok(/body\.host #vgGate\{top:32px\}/.test(app), '위젯에서 카드가 제목줄(32px)을 덮는다. 막힌 동안 창 이동, 최소화, 닫기가 안 된다(2026-10-21 결정)');
    assert.ok(/body\.vg-on #updateBanner\{display:none !important\}/.test(app), '막힌 동안 상단 업데이트 알림을 숨기지 않는다(카드의 버튼을 쓴다)');
    assert.ok(/html\[data-peerwin\] body > :not\(#peerWin\):not\(#peerPicker\):not\(#toastWrap\):not\(#vgGate\)\{ display:none !important \}/.test(app),
      '열람 창 allowlist 에 차단 카드(#vgGate)가 없다. 열람 창에서 카드가 감춰진다');
    assert.ok(/<div class="hidden" id="vgGate"><\/div>/.test(app), '차단 카드 자리(#vgGate)가 마크업에 없다');
    assert.ok(/body\.vg-on #appSurface > :not\(#hostbar\)\{filter:/.test(app), '뒤 화면을 흐리게 보이지 않는다(가리기가 아니라 흐리게, 2026-10-21 결정)');
  },
  wiring(app) {
    assert.ok(/const PEERWIN_CMD = new Set\(\[[^\]]*'gateRecheck'[^\]]*\]\)/.test(app), '열람 창 명령(PEERWIN_CMD)에 gateRecheck 가 없다. 열람 창 카드가 다시 확인하지 못한다');
    const hr = extractFunction(app, 'hostRequest');
    assert.ok(/__hostPending\[reqId\] = res => \{ clearTimeout\(to\); try\{ vgNoteReply\(res\); \}catch\(_\)\{\} resolve\(res\); \};/.test(hr),
      'hostRequest 가 관문 실패 회신을 호출부보다 먼저 카드로 보내지 않는다');
    const t = extractFunction(app, 'toast');
    assert.ok(/if\(\(kind === 'error' \|\| kind === 'warn'\) && vgBlocked\(\)\) return;/.test(t), '막힌 동안 오류 토스트를 끄지 않는다(관문 실패마다 일반 오류가 뜬다)');
    assert.ok(/vgBlocked\(\)/.test(extractFunction(app, 'editLocked')), '편집 잠금이 버전 관문을 보지 않는다');
    assert.ok(/if\(vgBlocked\(\)\)\{ if\(HOST && !PEER\) setUnsaved\(true\); return Promise\.resolve\(false\); \}/.test(extractFunction(app, 'dbSave')),
      '막힌 동안 저장을 보낸다(관문이 거절할 것을 안다). 편집은 미저장으로 남겨야 한다');
    assert.ok(/core\.WindowCloseRequested \+= /.test(peerCs), '열람 창이 웹의 window.close() 를 받지 않는다. [이 창 닫기]가 동작하지 않는다');
  },
  removed(app) {
    assert.ok(!app.includes('새 버전 준비 중'), '"새 버전 준비 중" 상태가 되살아났다(2026-10-21 결정으로 뺐다)');
    assert.ok(!/목록 복사/.test(app.slice(app.indexOf('function vgRender('), app.indexOf('function vgOnUpdateResult('))),
      '저장되지 않은 변경 목록 복사가 되살아났다(문구만, 2026-10-21 결정)');
    assert.ok(!/function schemaBlocked\(|function schemaServerOlder\(/.test(app), '옛 스키마 불일치 띠와 토스트(schemaBlocked, schemaServerOlder)가 남았다');
  },
};
test('정적①: 카드는 제목줄 아래, 뒤 화면은 흐리게, 막힌 동안 업데이트 알림 숨김, 열람 창 allowlist 에 카드', () => statics.layout(src));
test('정적②: 회신 가로채기, 오류 토스트 끄기, 편집 잠금, 저장 정지, 열람 창 gateRecheck 와 창 닫기', () => statics.wiring(src));
test('정적③: 없앤 것(새 버전 준비 중, 변경 목록 복사, 불일치 띠)이 되살아나지 않는다', () => statics.removed(src));
test('변이V①: 카드가 제목줄을 덮으면(top 32px 를 빼면) 정적① 이 실패한다', () => {
  assert.throws(() => statics.layout(mutate('body.host #vgGate{top:32px}\n', '')), /제목줄\(32px\)을 덮는다/);
});
test('변이V②: 회신 가로채기나 토스트 끄기를 빼면 정적② 가 실패한다', () => {
  assert.throws(() => statics.wiring(mutate(' try{ vgNoteReply(res); }catch(_){}', '')), /먼저 카드로 보내지 않는다/);
  assert.throws(() => statics.wiring(mutate("  if((kind === 'error' || kind === 'warn') && vgBlocked()) return;\n", '')), /오류 토스트를 끄지 않는다/);
});

/* ── (R) jsdom 위젯 모드 ──────────────────────────────────────────────── */
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('version-gate-web: jsdom 미설치 — 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  function fakeClock() {
    let seq = 0, now = 0;
    const timers = new Map();
    return {
      setTimeout(fn, d, ...args) { const id = ++seq; timers.set(id, { fn, args, at: now + (Number(d) || 0) }); return id; },
      clearTimeout(id) { timers.delete(id); },
      advance(ms) {
        const end = now + ms;
        for (;;) {
          let best = null;
          for (const [id, t] of timers) if (t.at <= end && (best === null || t.at < timers.get(best).at)) best = id;
          if (best === null) { now = end; return; }
          const t = timers.get(best); timers.delete(best); now = t.at;
          try { t.fn(...t.args); } catch (_) { /* 앱의 일 */ }
        }
      },
    };
  }
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '14', expectedSchema: '14', schemaMismatch: false, gate: 'ok', rev: 1, canWrite: true, userId: 7 };
  const DATA = {
    categories: [{ id: 'c-1', name: '과제 A', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: '2026-09-01T00:00:00Z' }],
    entries: [{ id: 'e-1', date: '2026-10-01', title: '기존 기록', categoryId: 'c-1', allDay: true, startTime: '', endTime: '',
      memo: '', location: '', source: '', commits: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }],
    todos: [], rooms: [],
  };
  const PUSH = {
    needUpdate: { state: 'needUpdate', appVersion: '0.23.0', appStructure: 14, dbStructure: '15', latestVersion: '0.24.0',
      installerPath: '\\\\srv\\share\\TaskCalendar\\TaskCalendarWidget-Setup-v0.24.0.exe' },
    updating: { state: 'updating', appVersion: '0.23.0', appStructure: 14, dbStructure: '14', latestVersion: '', installerPath: '' },
    serverOld: { state: 'serverOld', appVersion: '0.23.0', appStructure: 14, dbStructure: '13', latestVersion: '', installerPath: '' },
    unknown: { state: 'unknown', appVersion: '0.23.0', appStructure: 14, dbStructure: '', latestVersion: '', installerPath: '' },
    installFailed: { state: 'installFailed', appVersion: '0.23.0', appStructure: 14, dbStructure: '15', latestVersion: '0.24.0',
      installerPath: '\\\\srv\\share\\TaskCalendar\\TaskCalendarWidget-Setup-v0.24.0.exe', installFailedTarget: '0.24.0', attemptCount: 1 },
  };

  //  앱을 위젯 모드로 띄운다. 호스트로 나간 메시지는 posts 에 쌓이고, 회신은 reply(cmd, res) 로 진짜 __hostReply 를 거쳐 준다
  //  (hostRequest 를 갈아끼우지 않는다. 회신 가로채기 vgNoteReply 를 그대로 지나게 하려고).
  async function boot({ peerwin = false, login = true, source = src } = {}) {
    const clock = fakeClock();
    const posts = [];
    const dom = new JSDOM(source, {
      runScripts: 'dangerously', pretendToBeVisual: true,
      url: 'https://tcapp.local/' + (peerwin ? '?peerwin=1' : ''),
      virtualConsole: quietConsole(),
      beforeParse(win) {
        win.chrome = { webview: {
          postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posts.push(o || {}); },
          addEventListener() {}, removeEventListener() {},
        } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.setTimeout = clock.setTimeout;
        win.clearTimeout = clock.clearTimeout;
      },
    });
    const w = dom.window;
    const realClose = w.close.bind(w);
    let closed = 0;
    w.close = () => { closed++; };
    const W = {
      w, clock, posts,
      ev: (code) => w.eval(code),
      el: (id) => w.document.getElementById(id),
      text: (id) => { const e = w.document.getElementById(id); return e ? e.textContent : null; },
      cmds: (cmd) => posts.filter((p) => p.cmd === cmd),
      reply(cmd, res) {
        const p = [...posts].reverse().find((x) => x.cmd === cmd && x.reqId);
        assert.ok(p, `${cmd} 요청이 나가지 않았다`);
        w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify(res) + ')');
      },
      push: (g) => w.eval('__versionGate(' + JSON.stringify(g) + ')'),
      applyState: (data = DATA, meta = META) => w.eval('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(meta) + ')'),
      card: () => w.document.querySelector('#vgGate .vg-card'),
      shown: () => !w.document.getElementById('vgGate').classList.contains('hidden'),
      errToasts: () => w.document.querySelectorAll('#toastStackErr .toast').length,
      warnToasts: () => [...w.document.querySelectorAll('#toastStack .toast.warn')].map((t) => t.textContent),
      closed: () => closed,
      async run(ms, step = 1000) { for (let t = 0; t < ms; t += step) { clock.advance(Math.min(step, ms - t)); await settle(); } },
      close: () => { try { realClose(); } catch (_) {} },
    };
    if (!peerwin && login) { W.reply('userSessionGet', { ok: true, user: { loginId: 'hjlee', name: '이현진' } }); await settle(); }
    return W;
  }
  async function withBoot(opts, fn) { const W = await boot(opts); try { return await fn(W); } finally { W.close(); } }
  //  카드의 보이는 글과 접근성 이름 전부(기호 규칙 검사용).
  function cardText(W) {
    const c = W.card(); if (!c) return '';
    const attrs = [...c.querySelectorAll('[aria-label],[title]')].map((e) => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || ''));
    return c.textContent + ' ' + attrs.join(' ');
  }
  const buttons = (W) => [...W.card().querySelectorAll('button')].map((b) => b.textContent.trim());

  test('카드①: 업데이트 필요 — 제목, 버전 줄, [지금 업데이트]에 포커스, 자세한 정보, 수동 설치 경로와 복사, 담당자 안내', () => withBoot({}, async (W) => {
    W.applyState();
    W.push(PUSH.needUpdate);
    assert.ok(W.shown(), '카드가 뜨지 않았다');
    const c = W.card();
    assert.strictEqual(c.getAttribute('role'), 'alertdialog');
    assert.strictEqual(c.getAttribute('aria-modal'), 'true');
    assert.strictEqual(c.getAttribute('aria-labelledby'), 'vgTitle');
    assert.strictEqual(c.getAttribute('aria-describedby'), 'vgBody');
    assert.strictEqual(W.text('vgTitle'), '새 버전이 필요합니다');
    assert.ok(/일정을 읽거나 저장할 수 없습니다/.test(W.text('vgBody')), W.text('vgBody'));
    assert.strictEqual(c.querySelector('.vg-ver').textContent, '현재 0.23.0 → 새 버전 0.24.0');
    assert.deepStrictEqual(buttons(W), ['지금 업데이트', '복사']);
    assert.strictEqual(W.w.document.activeElement && W.w.document.activeElement.id, 'vgPrimary', '주 버튼에 포커스가 없다');
    const more = c.querySelector('details.vg-more');
    assert.ok(more && !more.open, '"자세한 정보" 가 접혀 있지 않다');
    assert.ok(/서버 구조 번호15/.test(more.textContent) && /앱 구조 번호14/.test(more.textContent) && /앱 버전0\.23\.0/.test(more.textContent), more.textContent);
    assert.strictEqual(W.text('vgPath'), PUSH.needUpdate.installerPath);
    assert.ok(/버튼이 동작하지 않으면/.test(c.textContent) && /담당자에게 문의해 주세요/.test(c.textContent), c.textContent);
    assert.ok(!W.el('vgWarn'), '저장되지 않은 변경이 없는데 경고가 떴다');
  }));

  test('카드②: 업데이트 필요 — 새 버전 번호를 모르면 버전 줄 오른쪽을 뺀다, 경로를 모르면 설정의 폴더를 보인다', () => withBoot({}, async (W) => {
    W.applyState();
    W.push(Object.assign({}, PUSH.needUpdate, { latestVersion: '', installerPath: '' }));
    assert.strictEqual(W.card().querySelector('.vg-ver').textContent, '현재 0.23.0');
    assert.strictEqual(W.el('vgPath'), null, '경로를 모르는데 경로 줄이 있다');
    assert.ok(W.cmds('updateSourceGet').length >= 1, '설정의 설치 파일 폴더를 묻지 않는다');
    W.ev("__updateSource('\\\\\\\\srv\\\\share\\\\TaskCalendar')");
    assert.strictEqual(W.text('vgPath'), '\\\\srv\\share\\TaskCalendar', '설치 파일 경로를 모를 때 폴더를 대신 보이지 않는다');
    W.ev("__updateAvailable(JSON.stringify({ version:'0.24.0', notes:'' }))");
    assert.strictEqual(W.card().querySelector('.vg-ver').textContent, '현재 0.23.0 → 새 버전 0.24.0', '알게 된 새 버전 번호를 보이지 않는다');
  }));

  test('카드③: [지금 업데이트] → updateApply, 진행 문구, 실패 문구는 버튼 아래(토스트 없음), 버튼이 다시 살아난다', () => withBoot({}, async (W) => {
    W.applyState();
    W.push(PUSH.needUpdate);
    W.el('vgPrimary').click();
    assert.strictEqual(W.cmds('updateApply').length, 1, '배너와 같은 업데이트 명령(updateApply)을 보내지 않는다');
    assert.ok(W.el('vgPrimary').disabled, '진행 중인데 버튼이 잠기지 않았다');
    W.ev("__updateProgress('내려받는 중…')");
    assert.ok(/내려받는 중/.test(W.text('vgSteps')) && /내려받는 중/.test(W.text('vgRunLive')), W.text('vgSteps'));
    W.ev("__updateResult(false, '새 버전 파일을 찾을 수 없습니다. 관리자에게 문의해 주세요.')");
    assert.strictEqual(W.text('vgErr'), '새 버전 파일을 찾을 수 없습니다. 관리자에게 문의해 주세요.');
    assert.strictEqual(W.el('vgErr').getAttribute('role'), 'alert');
    assert.ok(!W.el('vgPrimary').disabled, '실패했는데 버튼이 잠긴 채다');
    assert.strictEqual(W.errToasts(), 0, '카드의 업데이트 실패를 토스트로도 띄웠다');
  }));

  test('카드④: 갱신 중 — 버튼 없음, 카드에 포커스, 마지막 확인 줄, 30초마다 gateRecheck, ok 면 닫고 다시 읽기는 한 번', () => withBoot({}, async (W) => {
    W.applyState();
    W.posts.length = 0;
    W.push(PUSH.updating);
    assert.strictEqual(W.text('vgTitle'), '서버를 갱신하고 있습니다');
    assert.strictEqual(W.text('vgBody'), '잠시 후 자동으로 다시 연결합니다. 앱을 끄지 않아도 됩니다.');
    assert.deepStrictEqual(buttons(W), [], '갱신 중 카드에 버튼이 있다');
    assert.ok(W.w.document.activeElement === W.card(), '버튼이 없으면 카드 자체에 포커스가 가야 한다');
    assert.ok(/^마지막 확인 \d\d:\d\d, 30초마다 다시 확인$/.test(W.text('vgStatusText')), W.text('vgStatusText'));
    assert.ok(W.card().querySelector('.vg-pbar'), '진행 막대가 없다');
    await W.run(30000);
    assert.strictEqual(W.cmds('gateRecheck').length, 1, '30초 뒤 다시 확인하지 않는다');
    W.reply('gateRecheck', { ok: true, state: 'updating' });
    await settle();
    assert.ok(W.shown(), '아직 갱신 중인데 카드가 닫혔다');
    await W.run(30000);
    assert.strictEqual(W.cmds('gateRecheck').length, 2, '두 번째 30초에 다시 확인하지 않는다');
    W.reply('gateRecheck', { ok: true, state: 'ok' });
    await settle();
    assert.ok(!W.shown(), '서버가 돌아왔는데 카드가 닫히지 않았다');
    W.push({ state: 'ok' });                          // 호스트의 'ok' 푸시가 뒤따라온다
    await settle();
    assert.strictEqual(W.cmds('reloadState').length, 1, '다시 읽기(reloadState)가 정확히 한 번이 아니다');
    assert.ok(!W.w.document.body.classList.contains('vg-on'));
    assert.strictEqual(W.ev('editLocked()'), false, '카드가 닫혔는데 편집이 잠긴 채다');
  }));

  test('카드⑤: 서버 갱신 전과 버전 정보 없음 — 관리자 문의, 버튼 없음, 5분마다 확인', () => withBoot({}, async (W) => {
    W.applyState();
    W.push(PUSH.serverOld);
    assert.strictEqual(W.text('vgTitle'), '서버 갱신 전입니다');
    assert.strictEqual(W.text('vgBody'), '관리자가 서버 DB를 갱신하면 자동으로 이어집니다. 관리자에게 문의해 주세요.');
    assert.deepStrictEqual(buttons(W), []);
    assert.ok(/5분마다 다시 확인$/.test(W.text('vgStatusText')), W.text('vgStatusText'));
    W.push(PUSH.unknown);
    assert.strictEqual(W.text('vgBody'), '서버의 버전 정보를 읽을 수 없습니다. 관리자에게 문의해 주세요.');
    assert.deepStrictEqual(buttons(W), []);
  }));

  test('카드⑥: 설치 실패 — 한 번 실패면 [다시 시도], 두 번이면 버튼 없이 직접 설치 안내만', () => withBoot({}, async (W) => {
    W.applyState();
    W.push(PUSH.installFailed);
    assert.strictEqual(W.text('vgTitle'), '업데이트를 마치지 못했습니다');
    assert.strictEqual(W.card().dataset.tone, 'danger');
    assert.deepStrictEqual(buttons(W), ['다시 시도', '복사']);
    assert.ok(/직접 설치하기/.test(W.card().textContent) && W.text('vgPath'), '직접 설치 경로가 없다');
    W.push(Object.assign({}, PUSH.installFailed, { attemptCount: 2 }));
    assert.deepStrictEqual(buttons(W), ['복사'], '두 번 실패했는데 [다시 시도]가 남았다');
    assert.ok(/담당자에게 문의해 주세요/.test(W.card().textContent));
  }));

  test('카드⑦: 서버는 멀쩡한데 지난 설치만 실패했다 — 막지 않고 안내 한 줄(부팅 전이면 부팅이 관문을 지난 뒤에)', () => withBoot({}, async (W) => {
    W.push(Object.assign({}, PUSH.installFailed, { dbStructure: '' }));   // 웹 준비 때의 푸시(서버 판정 모름)
    assert.ok(!W.shown(), '서버 판정을 모르는데 설치 실패만으로 막았다');
    W.applyState();
    assert.ok(!W.shown());
    assert.ok(W.warnToasts().some((t) => /지난 업데이트를 마치지 못했습니다/.test(t)), '부팅이 관문을 지났는데 설치 실패를 알리지 않는다');
    W.push(Object.assign({}, PUSH.installFailed, { dbStructure: '14' }));  // 구조 번호가 같다 = 서버는 정상
    assert.ok(!W.shown(), '서버가 정상인데 설치 실패 카드로 막았다');
  }));

  test('격리: 막히면 뒤 화면 inert(제목줄, 리사이즈 손잡이는 살림), 편집 잠금, 배너 숨김, 풀리면 걷는다', () => withBoot({}, async (W) => {
    W.ev('buildHostBar()');
    W.applyState();
    W.ev("__updateAvailable(JSON.stringify({ version:'0.24.1', notes:'' }))");
    const banner = W.el('updateBanner');
    assert.ok(!banner.classList.contains('hidden'), '정상 상태의 배너가 뜨지 않았다');
    assert.ok(/새 버전 0\.24\.1이 있습니다/.test(W.text('updMsg')), W.text('updMsg'));
    assert.ok(W.el('updClose'), '배너에 닫기(✕)가 없다');
    W.push(PUSH.needUpdate);
    const doc = W.w.document;
    assert.ok(doc.body.classList.contains('vg-on'));
    assert.strictEqual(W.w.getComputedStyle(banner).display, 'none', '막힌 동안 상단 업데이트 알림이 보인다');
    const surf = W.el('appSurface');
    assert.ok(!surf.hasAttribute('inert'), '#appSurface 전체를 inert 로 만들었다(제목줄까지 죽는다)');
    assert.ok(!W.el('hostbar').hasAttribute('inert'), '제목줄이 inert 다(창 이동, 최소화, 닫기가 안 된다)');
    const others = [...surf.children].filter((c) => c.id !== 'hostbar');
    assert.ok(others.length > 0 && others.every((c) => c.hasAttribute('inert')), '뒤 화면에 inert 가 없다');
    assert.ok(!W.el('vgGate').hasAttribute('inert') && !W.el('toastWrap').hasAttribute('inert'));
    assert.ok(doc.body.classList.contains('db-locked'), '편집 잠금 표시(db-locked)가 없다');
    assert.strictEqual(W.ev('editLocked()'), true);
    assert.strictEqual(W.ev('guardEdit()'), true);
    W.posts.length = 0;
    W.ev('dbSave()');
    await settle();
    assert.strictEqual(W.cmds('saveState').length, 0, '막힌 동안 저장을 보냈다');
    assert.strictEqual(W.errToasts() + W.warnToasts().length, 0, '막힌 동안 잠금 토스트가 떴다(카드가 이미 말한다)');
    W.push({ state: 'ok' });
    assert.ok(others.every((c) => !c.hasAttribute('inert')), '풀렸는데 inert 가 남았다');
    assert.notStrictEqual(W.w.getComputedStyle(banner).display, 'none', '풀렸는데 업데이트 알림이 다시 보이지 않는다');
  }));

  test('경고: 저장되지 않은 변경이 있을 때만 카드에 경고 문구(목록 없음), 풀리면 먼저 저장한 뒤 다시 읽기 한 번', () => withBoot({}, async (W) => {
    W.applyState();
    W.push(PUSH.needUpdate);
    assert.ok(!W.el('vgWarn'), '미저장이 없는데 경고가 떴다');
    W.ev('setUnsaved(true)');
    assert.strictEqual(W.text('vgWarn'), '저장되지 않은 변경이 있습니다. 업데이트하거나 앱을 다시 켜면 사라지니 필요한 내용은 따로 적어 두세요.');
    assert.strictEqual(W.el('vgWarn').querySelectorAll('li,button').length, 0, '경고에 목록이나 버튼이 있다(문구만, 2026-10-21 결정)');
    W.posts.length = 0;
    W.push({ state: 'ok' });
    await settle();
    assert.strictEqual(W.cmds('saveState').length, 1, '풀렸는데 남은 편집을 먼저 저장하지 않는다');
    assert.strictEqual(W.cmds('reloadState').length, 0, '저장이 끝나기 전에 다시 읽었다(편집을 덮는다)');
    W.reply('saveState', { ok: true, rev: 2 });
    await settle();
    assert.strictEqual(W.cmds('reloadState').length, 1, '저장 뒤 다시 읽기가 한 번이 아니다');
  }));

  test('회신: 관문 회신(일반 요청, 저장, 부팅 실패, 회사 보고 전송)은 카드로 가고 일반 오류 토스트와 상자를 띄우지 않는다', () => withBoot({}, async (W) => {
    const GATE = { ok: false, kind: 'gate', error: '앱과 서버의 버전이 맞지 않습니다', gate: { state: 'needUpdate', dbStructure: '15', appStructure: 14 } };
    //  ① 부팅 실패
    W.ev("__applyStateError('앱과 서버의 버전이 맞지 않습니다', " + JSON.stringify({ retryable: false, kind: 'gate', detail: '', gate: GATE.gate }) + ')');
    assert.ok(W.shown() && W.text('vgTitle') === '새 버전이 필요합니다', '부팅이 관문에 막혔는데 카드가 뜨지 않았다');
    assert.strictEqual(W.el('dsError'), null, '관문 부팅 실패에 연결 상자를 띄웠다');
    assert.strictEqual(W.errToasts(), 0, '관문 부팅 실패에 오류 토스트를 띄웠다');
    await W.run(120000, 5000);
    assert.strictEqual(W.cmds('reloadState').length, 0, '관문 부팅 실패를 자동 재시도했다(호스트의 재확인이 맡는다)');
    W.push({ state: 'ok' });
    await settle();
    assert.strictEqual(W.cmds('reloadState').length, 1, '관문이 풀렸는데 다시 읽지 않는다');
    W.applyState();
    //  ② 일반 요청(호출부는 자기 실패 토스트를 띄우려 한다)
    W.ev("hostRequest('membersGet', {}).then(r => { if(!r.ok) toast('명부를 읽지 못했습니다: ' + r.error, 'error'); })");
    W.reply('membersGet', GATE);
    await settle();
    assert.ok(W.shown(), '일반 요청의 관문 회신이 카드로 가지 않았다');
    assert.strictEqual(W.errToasts(), 0, '관문 회신에 일반 오류 토스트가 떴다');
    W.push({ state: 'ok' }); await settle();
    //  ③ 회사 보고 전송
    W.ev("__netcusResult(false, '앱과 서버의 버전이 맞지 않아 회사 사이트로 보내지 않았습니다.', " + JSON.stringify({ kind: 'gate', gate: GATE.gate }) + ')');
    assert.ok(W.shown(), '회사 보고 전송의 관문 결과가 카드로 가지 않았다');
    assert.strictEqual(W.errToasts(), 0, '회사 보고 전송의 관문 결과에 오류 토스트가 떴다');
  }));

  test('로그인: 로그인 화면 위로 막히면 로그인 화면을 걷고, 풀리면 로그인 화면으로 돌아간다(다시 읽기 없음)', () => withBoot({ login: false }, async (W) => {
    W.reply('userSessionGet', { ok: true, user: null });
    await settle();
    assert.ok(!W.el('loginGate').classList.contains('hidden'), '로그인 화면이 뜨지 않았다(시험 준비)');
    W.push(PUSH.serverOld);
    assert.ok(W.el('loginGate').classList.contains('hidden'), '카드를 띄우며 로그인 화면을 걷지 않았다(카드를 덮는다)');
    W.posts.length = 0;
    W.push({ state: 'ok' });
    await settle();
    assert.ok(!W.el('loginGate').classList.contains('hidden'), '풀렸는데 로그인 화면으로 돌아가지 않았다');
    assert.ok(!W.el('lgForm').classList.contains('hidden'), '로그인 입력칸이 돌아오지 않았다');
    assert.strictEqual(W.cmds('reloadState').length, 0, '로그인 전인데 다시 읽었다');
  }));

  test('열람 창: 작은 카드, 같은 제목, "메인 창에서 업데이트해 주세요", 버튼은 [이 창 닫기] 하나(창을 닫는다)', () => withBoot({ peerwin: true }, async (W) => {
    for (const st of ['needUpdate', 'installFailed']) {
      W.push(PUSH[st]);
      const c = W.card();
      assert.ok(c && c.classList.contains('vg-peer'), st + ': 열람 창용 작은 카드가 아니다');
      assert.ok(/메인 창에서 업데이트해 주세요\.$/.test(W.text('vgBody')), st + ': ' + W.text('vgBody'));
      assert.deepStrictEqual(buttons(W), ['이 창 닫기'], st + ': 열람 창 카드에 다른 버튼이 있다');
      assert.strictEqual(c.querySelector('[data-vg-act="update"]'), null);
      assert.strictEqual(W.el('vgPath'), null, st + ': 열람 창에 수동 설치 경로가 있다');
      assert.strictEqual(W.w.document.activeElement && W.w.document.activeElement.id, 'vgPrimary');
    }
    assert.strictEqual(W.text('vgTitle'), '업데이트를 마치지 못했습니다');
    W.push(PUSH.updating);
    assert.strictEqual(W.text('vgTitle'), '서버를 갱신하고 있습니다');
    assert.ok(W.el('peerWin').hasAttribute('inert'), '열람 창 본문이 inert 가 아니다');
    W.el('vgPrimary').click();
    assert.strictEqual(W.closed(), 1, '[이 창 닫기]가 창을 닫지 않는다(window.close)');
    await W.run(30000);
    assert.strictEqual(W.cmds('gateRecheck').length, 1, '열람 창 카드가 다시 확인하지 못한다(PEERWIN_CMD 에 gateRecheck)');
    assert.ok(W.cmds('gateRecheck')[0].reqId.startsWith('pw:'), '열람 창의 요청 번호가 아니다');
  }));

  test('기호: 모든 상태의 카드 문구에 엠 대시, en 대시, 띄어 쓴 가운데 점, 낫표가 없다(메인 창, 열람 창)', async () => {
    for (const peerwin of [false, true]) {
      await withBoot({ peerwin }, async (W) => {
        if (!peerwin) { W.applyState(); W.ev('setUnsaved(true)'); }
        for (const st of ['updating', 'needUpdate', 'installFailed', 'serverOld', 'unknown']) {
          W.push(PUSH[st]);
          const t = cardText(W);
          assert.ok(t.length > 20, st + ': 카드 글이 없다');
          assert.deepStrictEqual(punctBad(t), [], `${peerwin ? '열람 창 ' : ''}${st}: ${t}`);
        }
        if (!peerwin) {
          W.push(PUSH.needUpdate);
          W.el('vgPrimary').click();
          W.ev("__updateResult(false, '새 버전 파일을 찾을 수 없습니다. 관리자에게 문의해 주세요.')");
          assert.deepStrictEqual(punctBad(cardText(W)), []);
        }
      });
    }
    //  배너와 설정의 바뀐 문구
    const set = src.slice(src.indexOf('<div class="set-lb">자동 업데이트'), src.indexOf('id="updSrcMsg"'));
    assert.ok(/설치 파일 폴더\(공유 폴더 또는 FTP\)/.test(set), '설정 칸 이름이 설치 파일 폴더를 뜻하지 않는다');
    assert.ok(!/latest\.json/.test(set.replace(/<!--[\s\S]*?-->/g, '')), '설정 안내가 아직 latest.json 을 말한다');
    assert.deepStrictEqual(punctBad(set.replace(/<!--[\s\S]*?-->/g, '')), []);
  });

  test('변이V③: 회신 가로채기를 빼면 일반 요청의 관문 회신이 카드로 가지 않는다(회신 시험이 잡는다)', () =>
    withBoot({ source: mutate(' try{ vgNoteReply(res); }catch(_){}', '') }, async (W) => {
      W.applyState();
      W.ev("hostRequest('membersGet', {})");
      W.reply('membersGet', { ok: false, kind: 'gate', gate: { state: 'needUpdate', dbStructure: '15', appStructure: 14 } });
      await settle();
      assert.ok(!W.shown(), '변이가 효과가 없다. 회신 가로채기 없이도 카드가 떴다(회신 시험이 판정하지 못한다)');
    }));
}
