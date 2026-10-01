// 서버(DB) 연결 장애 대응 — 웹 쪽 계약(docs/OFFLINE-RESILIENCE.md §2·§4·§5·§6 웹 몫).
//
// 이 파일이 지키는 것:
//   ① 편집 잠금(§4) — editLocked() = !bootOk || unsaved || conn !== 'ok' (위젯에서만). 진입점은 guardEdit() 로
//      토스트 한 줄을 띄우고 끝난다. save()/saveFull() 은 마지막 방어 — 잠겼으면 보내지 않는다
//      (부팅 스냅샷이 없으면 빈 상태로 되돌리고, 끊김·미저장이면 메모리에 남긴다).
//   ② 연결 상자(S1·S6·S7) — 원인 종류(kind)별 문구·재시도 정책. network·unknown 은 15·30·60 뒤 300초 꼬리,
//      auth·schema·unregistered 는 자동 재시도 0회 + db@host + 「자세히」.
//   ③ 「저장되지 않은 변경」 막대(S3) — 네트워크 저장 실패면 편집을 남기고 막대를 세운다(충돌이면 아니다).
//      unsaved 가 바뀔 때마다 unsavedState 를 호스트에 알린다(§6 닫기 경고).
//   ④ 재연결 확인(§5) — 끊긴 뒤에만 dbPing 을 15·30·60·300… 으로. 루프는 하나. 정상이면 타이머 0(A11).
//      붙으면 회복 순서(S5): 미저장 저장 → (부팅 실패였다면) reloadState → loadProjects → 알림 → 토스트 1회.
//   ⑤ 로그인 성공 → reloadState·loadProjects(S2·A8) · 「사용자 정보」 DB 한 줄의 실시간 상태 ·
//      불일치 배지 방향(S7) · 보고 기록 실패 경고(S10) · 열람 창(PEER) 면제.
//
// 행동 검사는 실제 앱을 jsdom 에 **위젯 모드(HOST=true)** 로 띄운다 — chrome.webview 를 심어 나가는 메시지를
// 기록하고, hostRequest 를 갈아끼워 호스트 회신을 만들고, setTimeout 을 가짜 시계로 바꿔 시간을 직접 흘린다.
// 검사 함수(checks)는 변이 시험이 **같은 함수를** 변이된 소스에 다시 돌린다 — 검사가 정말 잡는지 증명한다.
import vm from 'node:vm';
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}

/* ── 정적 계약 — 진입점 목록(jsdom 불필요) ───────────────────────────── */

//  함수 단위 관문 — 본문에 guardEdit() 이 있고, 그것이 첫 쓰기보다 **앞**이다.
const GATED_FUNCTIONS = [
  'openEntryModal', 'openQuickAdd', 'saveEntryFromForm', 'qaSave', 'saveCatFromForm', 'deleteCommitRow',
  'addRoom', 'deleteRoom', 'startImport', 'showImportPreview', 'applyImport', 'clearAll',
  'offSubscribeFromCatalog', 'offUnsubscribeFromCatalog', 'runGitImport',
  'setCommitSubject', 'setCommitMessage', 'setEntryTitle', 'setTodoText', 'commitDayNoteEdit',
  'legacyPromptImport',   // 이전 기록 「가져오기」 = 바로 교체(2026-10-01) — 읽기 전에 막는다
];
const WRITE_TOKENS = ['save()', 'saveFull()', 'dbSave(', 'addEntry(', 'updateEntry(', 'deleteEntry(', 'addTodo(',
  'updateTodo(', 'addCategory(', 'updateCategory(', 'deleteCategory(', 'subscribeDbCat(', 'unsubscribeDbCat(',
  'pendingImport =', '.push(', '.splice(', 'openModal(', "hostRequest('pickImportXml'"];
//  배선(bind 등) 단위 관문 — [이름, 시작 앵커, 첫 쓰기 표지]. 앵커와 표지 사이에 guardEdit() 이 있어야 한다.
const GATED_HANDLERS = [
  ['끌어 옮기기(drop)', "grid.addEventListener('drop', ev => {", 'save();'],
  ['날짜 패널 카드 삭제', "if(act === 'edit') editEntry(card.dataset.id);", 'deleteEntry(e.id)'],
  ['할 일 인라인 편집 저장·삭제', 'const id = box.dataset.id, act = ev.target.dataset.act;', 'updateTodo(id,'],
  ['할 일 행 완료·삭제·중요', "const row = ev.target.closest('.todo-row'); if(!row) return;", 'toggleTodo(row.dataset.id)'],
  ['과제 목록 제거(unsub)', "$('#catList').addEventListener('click'", 'unsubscribeDbCat(c.id)'],
  ['과제 목록 삭제(del)', "$('#catList').addEventListener('click'", 'deleteCategory(c.id)'],
  ['근태(보고서)', 'const svGuarded = () =>', 'sv(); };'],
  ['과제별 시간(보고서)', "const from = $('#rptFrom').value; const cat = inp.dataset.hcat;", 'setTaskHours(from, cat, inp.value)'],
  ['머리기호', "$('#rptMarker').addEventListener('change'", 'save()'],
  ['머리기호(직접 입력)', "$('#rptMarkerCustom').addEventListener('change'", 'save()'],
  ['들여쓰기', 'const _setRptInd = d => {', 'save()'],
  ['보고서 글꼴', "if(_ff) _ff.addEventListener('change'", 'save()'],
  ['보고서 글자 크기', "if(_fs) _fs.addEventListener('change'", 'save()'],
  ['보고서 줄 삭제', "} else if(b.dataset.ract === 'del'){", 'deleteCommitRow(rid'],
  ['기록 모달 삭제 버튼', "$('#btnEntryDelete').addEventListener('click'", 'deleteEntry(e.id)'],
  ['빠른 편집 → 자세히 편집', "$('#qaAdvanced').addEventListener('click'", 'updateEntry(id, d)'],
];

const statics = {
  functionsGated(app) {
    for (const fn of GATED_FUNCTIONS) {
      const b = extractFunction(app, fn);
      const g = b.indexOf('guardEdit()');
      assert.ok(g > 0, `${fn}() 에 연결 잠금 관문(guardEdit)이 없다 — 끊긴 채로 편집이 된다(§4)`);
      const firstWrite = Math.min(...WRITE_TOKENS.map((t) => { const i = b.indexOf(t); return i < 0 ? Infinity : i; }));
      assert.ok(g < firstWrite, `${fn}() 의 관문이 첫 쓰기보다 뒤에 있다 — 막기 전에 이미 바꾼다`);
    }
  },
  handlersGated(app) {
    for (const [name, anchor, end] of GATED_HANDLERS) {
      const i = app.indexOf(anchor);
      assert.ok(i > 0, `${name}: 앵커를 찾지 못했다 — ${anchor}`);
      const j = app.indexOf(end, i);
      assert.ok(j > i, `${name}: 쓰기 표지(${end})를 찾지 못했다`);
      assert.ok(app.slice(i, j).includes('guardEdit()'), `${name} 에 연결 잠금 관문(guardEdit)이 없다`);
    }
    assert.ok(/a\.addEventListener\('change', svGuarded\)/.test(app) && /b\.addEventListener\('change', svGuarded\)/.test(app),
      '근태 셀렉트가 관문 없는 sv 로 직접 배선돼 있다');
    assert.ok(app.includes("$('#btnNew').addEventListener('click', () => openQuickAdd(selectedDate));"),
      '「＋ 새 기록」 이 openQuickAdd(관문 있음)로 가지 않는다');
  },
  //  메모리 전용 — 못 보낸 편집을 로컬 저장소에 쌓지 않는다(ADR-18 · 기획 §9).
  memoryOnly(app) {
    for (const fn of ['editLocked', 'guardEdit', 'setUnsaved', 'connSyncUi', 'connLost', 'connPing', 'connRecover',
                      'lockedSaveRefused', 'connOnBootApplied', 'renderUnsavedBar', 'connAfterLogin']) {
      const b = extractFunction(app, fn);
      assert.ok(!/localStorage|sessionStorage|indexedDB/.test(b), `${fn}() 가 브라우저 저장소에 닿는다 — 오프라인 대기열은 금지(ADR-18)`);
    }
  },
};

test('정적①: 편집 진입점 함수 21곳이 첫 쓰기 전에 guardEdit() 을 지난다', () => statics.functionsGated(src));
test('정적②: 배선 진입점 16곳(끌어 옮기기·할 일·과제·보고서 서식·근태·시간·삭제)이 guardEdit() 을 지난다', () => statics.handlersGated(src));
test('정적③: 연결 상태 경로는 메모리 전용이다(로컬 저장소 대기열 없음)', () => statics.memoryOnly(src));
test('정적④: 브라우저(!HOST)·열람 창(PEER)에서는 잠금이 늘 false 다', () => {
  for (const [HOST, PEER] of [[false, false], [true, true], [false, true]]) {
    const ctx = { HOST, PEER, bootOk: false, unsaved: true, conn: 'offline', out: null };
    vm.runInNewContext(extractFunction(src, 'editLocked') + '\nout = editLocked();', ctx);
    assert.strictEqual(ctx.out, false, `HOST=${HOST} PEER=${PEER} 인데 잠갔다 — 브라우저 저장·열람 창이 막힌다`);
  }
});
test('변이①s: openQuickAdd 의 관문을 지우면 정적① 이 실패한다', () => {
  const bad = mutate('  if(!entryId && guardEdit()) return;', '', src);
  assert.throws(() => statics.functionsGated(bad), /openQuickAdd\(\) 에 연결 잠금 관문/);
});

/* ── 행동 — jsdom 위젯 모드 ──────────────────────────────────────────── */

const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
//  앱의 console.* 를 시험 출력으로 흘리지 않는다(경고 문구는 위에서 따로 본다).
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('offline-web: jsdom 미설치 — 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  // 가짜 시계 — 시간은 advance() 로만 흐른다.
  function fakeClock() {
    let seq = 0, now = 0;
    const timers = new Map();
    return {
      at: () => now,
      setTimeout(fn, d, ...args) { const id = ++seq; timers.set(id, { fn, args, at: now + (Number(d) || 0) }); return id; },
      clearTimeout(id) { timers.delete(id); },
      advance(ms) {
        const end = now + ms;
        for (;;) {
          let best = null;
          for (const [id, t] of timers) if (t.at <= end && (best === null || t.at < timers.get(best).at)) best = id;
          if (best === null) { now = end; return; }
          const t = timers.get(best); timers.delete(best); now = t.at;
          try { t.fn(...t.args); } catch (_) { /* 앱 쪽 예외는 앱의 일 */ }
        }
      },
    };
  }
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const DATA = {
    categories: [{ id: 'c-1', name: '과제 A', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: '2026-09-01T00:00:00Z' }],
    entries: [{ id: 'e-1', date: '2026-10-01', title: '기존 기록', categoryId: 'c-1', allDay: true, startTime: '', endTime: '',
      memo: '', location: '', source: '', commits: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }],
    todos: [], rooms: ['201호'],
  };

  //  앱을 위젯 모드로 띄운다. log 하나에 [나간 메시지(post)·호스트 요청(req)·토스트(toast)] 를 순서대로 쌓는다.
  function boot(source = src, { peer = false } = {}) {
    const clock = fakeClock();
    const log = [];
    const handlers = {};
    const dom = new JSDOM(source, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://tcapp.local/' + (peer ? '?peer=1' : ''),
      virtualConsole: quietConsole(),
      beforeParse(win) {
        win.chrome = { webview: {
          postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} log.push({ post: o && o.cmd, msg: o }); },
          addEventListener() {}, removeEventListener() {},
        } };
        if (typeof win.crypto === 'undefined') {
          win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        }
        win.scrollTo = () => {};
        win.setTimeout = clock.setTimeout;
        win.clearTimeout = clock.clearTimeout;
      },
    });
    const w = dom.window;
    //  호스트 회신 — handlers[cmd] 가 값이면 그대로, 함수면 그 결과(Promise 가능). 없으면 실패 회신.
    w.__fakeReply = (cmd, params) => {
      log.push({ req: cmd, params });
      const h = handlers[cmd];
      const r = typeof h === 'function' ? h(params) : h;
      return (r && typeof r.then === 'function') ? r : Promise.resolve(r === undefined ? { ok: false, error: 'no handler' } : r);
    };
    w.eval('hostRequest = function(cmd, params){ return window.__fakeReply(cmd, params || {}); };');
    w.eval('(function(){ var t = toast; toast = function(m, k, a, ms){ window.__fakeToast(String(m), k); return t(m, k, a, ms); }; })();');
    w.__fakeToast = (m, k) => log.push({ toast: m, kind: k });
    //  부팅 때 이미 나간 세션 조회에 답해 로그인 게이트를 내린다(실제 hostRequest 로 나갔던 요청이다).
    if (!peer) {
      const sess = log.find((x) => x.post === 'userSessionGet');
      if (sess) w.eval('__hostReply(' + JSON.stringify(sess.msg.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'hjlee', name: '이현진' } }) + ')');
    }
    const W = {
      w, clock, log, handlers,
      ev: (code) => w.eval(code),
      call: (fn, ...args) => w.eval(fn + '(' + args.map((a) => JSON.stringify(a)).join(',') + ')'),
      posts: (cmd) => log.filter((x) => x.post === cmd),
      reqs: (cmd) => log.filter((x) => x.req === cmd),
      toasts: () => log.filter((x) => x.toast).map((x) => x.toast),
      el: (id) => w.document.getElementById(id),
      text: (id) => { const e = w.document.getElementById(id); return e ? e.textContent : null; },
      applyState: (data = DATA, meta = META) => w.eval('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(meta) + ')'),
      applyError: (msg, opt) => w.eval('__applyStateError(' + JSON.stringify(msg) + ',' + JSON.stringify(opt) + ')'),
      clear: () => { log.length = 0; },
      async run(ms, step = 1000) { for (let t = 0; t < ms; t += step) { clock.advance(Math.min(step, ms - t)); await settle(); } },
      close: () => { try { w.close(); } catch (_) {} },
    };
    return W;
  }
  async function withBoot(source, fn, opts) {
    const W = boot(source, opts);
    try { return await fn(W); } finally { W.close(); }
  }
  const LOCK = '서버에 연결되지 않아 지금은 편집할 수 없습니다';
  const NET = { ok: false, kind: 'network', error: '서버에 연결할 수 없습니다', detail: 'Unable to connect to any of the specified MySQL hosts.' };
  //  사용 중 끊김을 만든다 — 저장이 네트워크로 실패한다(S3).
  async function goOfflineBySave(W) {
    W.handlers.saveState = NET;
    W.handlers.dbPing = { ok: false, kind: 'network', error: 'Unable to connect' };
    W.ev("addEntry({ date:'2026-10-02', title:'끊긴 사이 편집' })");
    await settle();
  }

  // ── 검사 함수(변이 시험이 같은 함수를 다시 돌린다) ──
  const checks = {
    //  부팅 실패(빈 캘린더) — 새 기록 진입점이 토스트로 막히고 메모리 변화가 0 이다(A1).
    async newEntryBlocked(source) {
      await withBoot(source, async (W) => {
        W.applyError('서버에 연결하지 못했습니다', { retryable: true, kind: 'network' });
        W.clear();
        W.call('openQuickAdd', '2026-10-01');
        assert.ok(W.el('quickAdd').classList.contains('hidden'), '부팅 실패 중인데 빠른 등록이 열렸다 — 그 편집은 갈 곳이 없다');
        assert.ok(W.toasts().includes(LOCK), '막았는데 이유를 말하지 않는다');
        W.call('openEntryModal', 'new', '2026-10-01');
        assert.ok(W.el('entryModal').classList.contains('hidden'), '부팅 실패 중인데 새 기록 창이 열렸다');
        assert.strictEqual(W.ev('state.entries.length'), 0, '메모리가 바뀌었다');
      });
    },
    //  잠긴 채 save() 가 불려도 보내지 않는다 — 부팅 실패면 빈 상태로, 끊김이면 메모리에 남긴다.
    async saveRefusedWhileLocked(source) {
      await withBoot(source, async (W) => {
        W.applyError('서버에 연결하지 못했습니다', { retryable: true, kind: 'network' });
        W.clear();
        W.ev("state.entries.push({ id:'x1', date:'2026-10-01', title:'샌 편집' }); save();");
        await settle();
        assert.strictEqual(W.reqs('saveState').length, 0, '부팅 실패 중인데 save() 가 저장을 보냈다');
        assert.strictEqual(W.ev('state.entries.length'), 0, '부팅 스냅샷이 없는데 샌 편집이 화면에 남았다 — 재시도가 붙으면 말없이 사라진다');
        assert.ok(W.toasts().includes(LOCK), '되돌렸는데 이유를 말하지 않는다');
        W.ev("state.entries.push({ id:'x2', date:'2026-10-01', title:'샌 편집' }); saveFull();");
        await settle();
        assert.strictEqual(W.reqs('replaceAllState').length, 0, '부팅 실패 중인데 saveFull() 이 전량 교체를 보냈다');
      });
      await withBoot(source, async (W) => {
        W.applyState();
        W.ev("__dbConnLost({ kind:'network', detail:'socket closed' })");
        W.clear();
        W.ev("state.entries.push({ id:'x3', date:'2026-10-01', title:'끊긴 사이' }); save();");
        await settle();
        assert.strictEqual(W.reqs('saveState').length, 0, '끊긴 상태인데 save() 가 저장을 보냈다');
        assert.ok(W.ev("state.entries.some(function(e){ return e.id === 'x3'; })"), '끊긴 상태의 편집이 메모리에서 사라졌다 — 다시 연결되면 함께 가야 한다');
        assert.strictEqual(W.ev('unsaved'), true, '메모리에 차이가 남았는데 미저장 표시가 없다(닫기 경고가 안 뜬다)');
        assert.ok(W.el('dbUnsaved'), '미저장 막대가 없다');
      });
    },
    //  권한 거부 — 자동 재시도 0회(A4) · 문구 · db@host · 「자세히」 · 수동은 된다.
    async authNeverRetries(source) {
      await withBoot(source, async (W) => {
        W.applyError('DB 접근 거부', { retryable: true, kind: 'auth', detail: "Access denied for user 'tc'@'10.0.0.9'", db: 'taskcalendar', host: '10.0.0.5' });
        W.clear();
        await W.run(30 * 60 * 1000, 5000);
        assert.strictEqual(W.posts('reloadState').length, 0, '권한 거부인데 자동으로 다시 걸었다 — 몇 번을 걸어도 같은 답이다');
        assert.strictEqual(W.reqs('dbPing').length, 0, '권한 거부인데 핑을 돌렸다');
        const t = W.text('dsErrorText');
        assert.ok(/DB 접근이 거부되었습니다/.test(t), '접근 거부 문구가 없다: ' + t);
        assert.ok(t.includes('taskcalendar@10.0.0.5'), 'DB 이름·호스트를 보여 주지 않는다: ' + t);
        assert.strictEqual(W.ev('conn'), 'denied');
      });
    },
    //  정상이면 아무 타이머도 돌지 않는다(A11) — 한 시간을 흘려도 핑 0 · reloadState 0.
    async noTimerWhileOk(source) {
      await withBoot(source, async (W) => {
        W.applyState();
        W.clear();
        W.w.document.dispatchEvent(new W.w.Event('visibilitychange'));
        await W.run(60 * 60 * 1000, 10000);
        assert.strictEqual(W.reqs('dbPing').length, 0, '정상 상태인데 dbPing 을 보냈다 — 폴링 없음 원칙 위반(A11)');
        assert.strictEqual(W.posts('reloadState').length, 0, '정상 상태인데 reloadState 를 보냈다');
        assert.ok(W.ev('!__pingRetry || !__pingRetry.state().pending'), '정상 상태인데 재연결 타이머가 걸려 있다');
        assert.ok(W.ev('!__bootRetry || !__bootRetry.state().pending'), '정상 상태인데 부팅 재시도 타이머가 걸려 있다');
      });
    },
    //  재연결 확인 박자 — 15·30·60 → 300·300 (끊김 시점 기준 15·45·105·405·705초).
    async pingSchedule(source) {
      await withBoot(source, async (W) => {
        W.applyState();
        await goOfflineBySave(W);
        const t0 = W.clock.at();
        W.clear();
        const at = [];
        const seen = () => { while (at.length < W.reqs('dbPing').length) at.push(Math.round((W.clock.at() - t0) / 1000)); };
        for (let s = 0; s < 720; s++) { await W.run(1000); seen(); }
        assert.deepStrictEqual(at, [15, 45, 105, 405, 705], '재연결 확인 박자가 15·30·60 → 300 꼬리가 아니다: ' + JSON.stringify(at));
      });
    },
    //  미저장 표시를 호스트에 알린다(§6) — 켤 때 on:true.
    async unsavedPosted(source) {
      await withBoot(source, async (W) => {
        W.applyState();
        W.clear();
        await goOfflineBySave(W);
        const on = W.posts('unsavedState');
        assert.ok(on.length === 1 && on[0].msg.on === true, '미저장이 켜졌는데 호스트에 unsavedState{on:true} 를 보내지 않았다: ' + JSON.stringify(on.map((x) => x.msg)));
      });
    },
    //  네트워크 저장 실패 → 막대(편집 남김), 충돌 → 막대 없음(충돌 상자).
    async barOnNetworkNotConflict(source) {
      await withBoot(source, async (W) => {
        W.applyState();
        //  회신 프라미스를 붙잡아 둔다 — dbSave 의 .then 이 먼저 걸렸으므로, 그 프라미스를 기다린 직후
        //  (타이머·다음 매크로태스크 없이)가 곧 '회신과 같은 틱' 이다.
        let resolve, pending = null;
        W.handlers.saveState = () => (pending = new Promise((r) => { resolve = r; }));
        W.ev("addEntry({ date:'2026-10-02', title:'끊긴 사이 편집' })");
        assert.strictEqual(W.reqs('saveState').length, 1, '저장이 나가지 않았다');
        resolve(NET);
        await pending;
        assert.ok(W.el('dbUnsaved'), '네트워크 저장 실패인데 막대가 같은 틱에 서지 않았다');
        assert.ok(/저장되지 않은 변경이 있습니다/.test(W.text('dbUnsavedText')), '막대 문구가 다르다: ' + W.text('dbUnsavedText'));
        assert.ok(W.ev("state.entries.some(function(e){ return e.title === '끊긴 사이 편집'; })"), '실패한 편집이 화면에서 사라졌다');
        assert.strictEqual(W.ev('conn'), 'offline');
        assert.strictEqual(W.ev('editLocked()'), true, '막대가 섰는데 새 편집이 열려 있다');
      });
      await withBoot(source, async (W) => {
        W.applyState();
        W.handlers.saveState = { ok: false, conflict: true, error: '다른 곳에서 먼저 수정되었습니다' };
        W.ev("addEntry({ date:'2026-10-02', title:'충돌 편집' })");
        await settle();
        assert.ok(!W.el('dbUnsaved'), '충돌인데 미저장 막대가 섰다 — 기다려도 풀리지 않는다(새로고침이 답이다)');
        assert.ok(W.el('dbConflict'), '충돌 상자가 없다');
        assert.strictEqual(W.ev('unsaved'), false);
        assert.strictEqual(W.posts('unsavedState').length, 0, '충돌인데 미저장 알림을 보냈다');
      });
    },
    //  부팅 뒤 + 부팅 재시도(reloadState) 대기 중에 잠긴 save() 가 남긴 미저장분 — 재시도가 붙어도 **덮이지 않는다**.
    //  루프를 재연결 확인(dbPing)으로 넘겨, 붙으면 그 편집을 먼저 저장한다(S5). 2026-10-01 loop-offline O1s 가 잡은 구멍.
    async unsavedSurvivesBootRetry(source) {
      await withBoot(source, async (W) => {
        W.applyState();
        W.applyError('서버에 연결하지 못했습니다', { retryable: true, kind: 'network' });   // 사용 중 reloadState 실패 → 부팅 재시도 루프
        assert.strictEqual(W.ev('bootOk'), true, '전제: 부팅 스냅샷은 화면에 남는다');
        W.clear();
        W.ev("state.entries.push({ id:'x9', date:'2026-10-01', title:'재시도 사이 편집' }); save();");
        await settle();
        assert.strictEqual(W.reqs('saveState').length, 0, '잠긴 save() 가 저장을 보냈다');
        assert.strictEqual(W.ev('unsaved'), true, '편집이 남았는데 미저장 표시가 없다');
        W.handlers.dbPing = { ok: true };
        W.handlers.saveState = { ok: true };
        await W.run(20000);
        assert.strictEqual(W.posts('reloadState').length, 0, '미저장분이 있는데 부팅 재시도가 reloadState 를 보냈다 — 붙으면 그 편집을 덮는다');
        const sv = W.reqs('saveState');
        assert.ok(sv.length === 1 && sv[0].params.state.entries.some((e) => e.id === 'x9'), '재연결이 미저장분을 저장하지 않았다: ' + sv.length);
        assert.strictEqual(W.ev('unsaved'), false);
        assert.ok(W.ev("state.entries.some(function(e){ return e.id === 'x9'; })"), '편집이 메모리에서 사라졌다');
      });
    },
  };

  // ── 잠금 진리표 ──
  test('잠금①: editLocked 진리표 — !bootOk || unsaved || conn !== ok (위젯)', () => withBoot(src, async (W) => {
    for (const b of [true, false]) for (const u of [true, false]) for (const c of ['ok', 'offline', 'denied']) {
      W.ev(`bootOk = ${b}; unsaved = ${u}; conn = '${c}';`);
      assert.strictEqual(W.ev('editLocked()'), (!b || u || c !== 'ok'), `bootOk=${b} unsaved=${u} conn=${c}`);
    }
  }));
  test('잠금②: 부팅 실패 중 새 기록 진입점은 토스트로 막히고 메모리 변화 0(A1)', () => checks.newEntryBlocked(src));
  test('잠금③: 있는 기록 열기는 된다(읽기) — 저장·제목 줄편집·회의실·초기화·가져오기는 막힌다', () => withBoot(src, async (W) => {
    W.applyState();
    W.ev("__dbConnLost({ kind:'network' })");
    W.clear();
    W.call('openEntryModal', 'edit', 'e-1');
    assert.ok(!W.el('entryModal').classList.contains('hidden'), '끊긴 상태에서 있는 기록을 열 수도 없다 — 읽기는 막지 않는다');
    W.ev("$('#fTitle').value = '고친 제목'; saveEntryFromForm();");
    await settle();
    assert.strictEqual(W.ev("entryById('e-1').title"), '기존 기록', '끊긴 상태에서 기록 수정이 메모리에 들어갔다');
    assert.strictEqual(W.call('setEntryTitle', 'e-1', '줄편집'), false, '보고서 줄편집이 막히지 않았다');
    W.call('addRoom', '새 회의실');
    assert.ok(!W.ev("state.rooms.includes('새 회의실')"), '회의실 추가가 막히지 않았다');
    await W.ev('clearAll()');
    assert.strictEqual(W.ev('state.entries.length'), 1, '전체 초기화가 막히지 않았다');
    W.ev('startImport()');
    assert.strictEqual(W.reqs('pickImportXml').length, 0, '가져오기 파일창이 열렸다');
    W.call('showImportPreview', 'old.xml', '<taskCalendar/>');
    assert.ok(W.el('importModal').classList.contains('hidden'), '가져오기 미리보기가 열렸다(이전 버전 물음의 「가져오기」도 이 문을 지난다)');
    assert.strictEqual(W.reqs('saveState').length, 0, '잠긴 상태에서 저장이 나갔다');
    assert.ok(W.toasts().includes(LOCK), '막았는데 이유를 말하지 않는다');
    assert.ok(W.w.document.body.classList.contains('db-locked'), 'body.db-locked 가 없다 — 주 버튼이 흐려지지 않는다');
  }));
  test('잠금④: save()·saveFull() 마지막 방어 — 부팅 실패면 빈 상태로, 끊김이면 메모리에 남기고 보내지 않는다', () => checks.saveRefusedWhileLocked(src));
  test('잠금⑤: 부팅 재시도 대기 중(부팅 뒤) 잠긴 save() 의 미저장분은 reloadState 로 덮이지 않고 재연결 저장으로 간다(S5)', () => checks.unsavedSurvivesBootRetry(src));

  // ── 연결 상자 — 종류별 문구·재시도 정책 ──
  test('상자①: network — 문구 · 15·30·60 뒤 300초 꼬리 · 꼬리 문구 「다음 재시도 N분 N초 후」(A3)', () => withBoot(src, async (W) => {
    const opt = { retryable: true, kind: 'network', detail: 'Unable to connect to any of the specified MySQL hosts.', db: 'taskcalendar', host: '10.0.0.5' };
    W.applyError('서버에 연결하지 못했습니다: Unable to connect', opt);
    assert.ok(/서버에 연결할 수 없습니다\(꺼져 있거나 네트워크 문제\)/.test(W.text('dsErrorText')), W.text('dsErrorText'));
    assert.ok(/15초 후 자동 재시도 \(1\/3\)/.test(W.text('dsErrorText')), W.text('dsErrorText'));
    assert.strictEqual(W.ev('conn'), 'offline');
    const sent = [];
    for (const wait of [15, 30, 60]) {
      await W.run(wait * 1000);
      sent.push(W.posts('reloadState').length);
      W.applyError('서버에 연결하지 못했습니다: Unable to connect', opt);   // 그 재시도도 실패
    }
    assert.deepStrictEqual(sent, [1, 2, 3], '빠른 3회가 15·30·60초에 한 번씩 가지 않았다');
    assert.ok(/다음 재시도 5분 0초 후/.test(W.text('dsErrorText')), '빠른 3회 뒤 꼬리 문구가 아니다: ' + W.text('dsErrorText'));
    assert.ok(W.ev('__bootRetry.state().pending'), '빠른 3회 뒤 꼬리가 예약되지 않았다 — 서버가 늦게 뜬 아침에 수동으로 남는다');
    await W.run(300 * 1000, 5000);
    assert.strictEqual(W.posts('reloadState').length, 4, '300초 꼬리에 다시 걸지 않았다');
    assert.ok(!W.el('dsErrorMore').hidden, '원문(detail)이 있는데 「자세히」가 없다');
  }));
  test('상자②: auth — 자동 재시도 0회 · 접근 거부 문구 · db@host · 「자세히」 · [다시 시도]는 된다(A4·S6)', async () => {
    await checks.authNeverRetries(src);
    await withBoot(src, async (W) => {
      W.applyError('DB 접근 거부', { retryable: true, kind: 'auth', detail: "Access denied for user 'tc'", db: 'taskcalendar', host: '10.0.0.5' });
      const more = W.el('dsErrorMore'), det = W.el('dsErrorDetail');
      assert.ok(!more.hidden && det.hidden, '「자세히」가 없거나 원문이 처음부터 펼쳐져 있다');
      more.click();
      assert.ok(!det.hidden && /Access denied/.test(det.textContent), '「자세히」를 눌러도 원문이 보이지 않는다');
      W.clear();
      W.el('dsErrorRetry').click();
      assert.strictEqual(W.posts('reloadState').length, 1, '[다시 시도]가 남아 있어야 한다(설정을 고친 사람이 이어 갈 문)');
    });
  });
  test('상자③: schema · unregistered — 재시도 없음 · 종류 문구(schema) / 호스트 문구(unregistered)', async () => {
    await withBoot(src, async (W) => {
      W.applyError('Table taskcalendar.cal_entry doesn\'t exist', { retryable: true, kind: 'schema', detail: "Table 'cal_entry' doesn't exist" });
      assert.ok(/DB 구조가 이 버전과 맞지 않습니다/.test(W.text('dsErrorText')), W.text('dsErrorText'));
      W.clear(); await W.run(20 * 60 * 1000, 10000);
      assert.strictEqual(W.posts('reloadState').length, 0, '구조 불일치인데 자동으로 다시 걸었다');
      assert.strictEqual(W.ev('conn'), 'denied');
    });
    await withBoot(src, async (W) => {
      W.applyError('이 계정이 서버에 등록돼 있지 않습니다 — 관리자에게 문의하세요', { retryable: false, kind: 'unregistered' });
      assert.ok(/등록돼 있지 않습니다/.test(W.text('dsErrorText')), '미등록은 호스트 문구를 그대로 써야 한다: ' + W.text('dsErrorText'));
      W.clear(); await W.run(20 * 60 * 1000, 10000);
      assert.strictEqual(W.posts('reloadState').length, 0);
    });
  });
  test('상자④: kind 없음(옛 호스트) — 문구는 그대로, 재시도는 예전처럼(unknown 취급)', () => withBoot(src, async (W) => {
    W.applyError('서버에서 캘린더를 받지 못했습니다');
    assert.ok(W.text('dsErrorText').includes('서버에서 캘린더를 받지 못했습니다'), W.text('dsErrorText'));
    assert.ok(W.el('dsErrorMore').hidden, '원문이 문구 자체인데 「자세히」가 떴다');
    W.clear(); await W.run(15000);
    assert.strictEqual(W.posts('reloadState').length, 1, '종류 없는 실패를 재시도하지 않는다 — 옛 호스트와의 동작이 바뀌었다');
  }));

  // ── 미저장 막대 · unsavedState ──
  test('막대①: 네트워크 저장 실패 → 같은 틱에 막대 · 편집은 남고 잠긴다 / 충돌 → 막대 없음(S3)', () => checks.barOnNetworkNotConflict(src));
  test('막대②: 스키마 불일치·종류 없는 실패는 막대가 아니라 토스트(예전 동작)', async () => {
    for (const reply of [{ ok: false, schemaMismatch: true, kind: 'schema', error: '위젯 업데이트가 필요합니다' }, { ok: false, error: '편집 권한이 없습니다' }]) {
      await withBoot(src, async (W) => {
        W.applyState();
        W.handlers.saveState = reply;
        W.ev("addEntry({ date:'2026-10-02', title:'x' })");
        await settle();
        assert.ok(!W.el('dbUnsaved'), '기다려도 풀리지 않는 실패인데 막대가 섰다: ' + JSON.stringify(reply));
        assert.strictEqual(W.ev('conn'), 'ok', '저장 거절을 연결 끊김으로 올렸다 — 핑 성공·저장 거절의 헛바퀴가 된다');
        assert.ok(W.toasts().some((m) => /저장 실패|업데이트/.test(m)), '실패를 알리지 않았다');
      });
    }
  });
  test('막대③: unsaved 가 켜지고 꺼질 때마다 unsavedState{on} 을 호스트에 보낸다(§6)', async () => {
    await checks.unsavedPosted(src);
    await withBoot(src, async (W) => {
      W.applyState();
      await goOfflineBySave(W);
      W.handlers.dbPing = { ok: true };
      W.handlers.saveState = { ok: true };
      W.clear();
      await W.run(15000);
      const offs = W.posts('unsavedState');
      assert.ok(offs.length === 1 && offs[0].msg.on === false, '저장이 붙었는데 unsavedState{on:false} 를 보내지 않았다 — 닫기 경고가 계속 뜬다');
    });
  });
  test('막대④: 응답 시간 초과(종류 없음 + timeout) 는 네트워크로 본다(S8)', () => withBoot(src, async (W) => {
    W.applyState();
    W.handlers.saveState = { ok: false, error: '호스트 응답 시간 초과', timeout: true };
    W.ev("addEntry({ date:'2026-10-02', title:'느린 서버' })");
    await settle();
    assert.ok(W.el('dbUnsaved'), '시간 초과인데 막대가 없다');
    assert.ok(/function hostRequest[\s\S]*?timeout:true/.test(src), 'hostRequest 의 시간 초과 회신에 timeout 표지가 없다');
  }));

  // ── 재연결 확인 ──
  test('재연결①: 끊긴 뒤 dbPing 박자 15·30·60 → 300 꼬리', () => checks.pingSchedule(src));
  test('재연결②: 루프는 하나 — 끊김 통지가 겹쳐도 핑이 두 배가 되지 않고, 부팅 실패 단계엔 핑이 없다', async () => {
    await withBoot(src, async (W) => {
      W.applyState();
      await goOfflineBySave(W);
      W.clear();
      await W.run(5000);
      W.ev("__dbConnLost({ kind:'network' })");   // 다른 화면의 실패가 또 온다
      W.ev("__dbConnLost({ kind:'network' })");
      await W.run(10000);
      assert.strictEqual(W.reqs('dbPing').length, 1, '끊김 통지가 겹치자 핑이 두 번 나갔다 — 루프가 둘이다');
    });
    await withBoot(src, async (W) => {
      W.applyError('서버에 연결하지 못했습니다', { retryable: true, kind: 'network' });
      W.ev("__dbConnLost({ kind:'network' })");
      W.clear();
      await W.run(15000);
      assert.strictEqual(W.reqs('dbPing').length, 0, '부팅 재시도가 도는데 핑 루프가 또 섰다');
      assert.strictEqual(W.posts('reloadState').length, 1, '부팅 재시도가 그 단계의 루프다');
    });
  });
  test('재연결③: 정상이면 타이머 0 · 핑 0(A11) — 창 복귀 이벤트도 아무것도 하지 않는다', () => checks.noTimerWhileOk(src));
  test('재연결④: 끊긴 상태에서 창이 다시 보이면 기다리지 않고 한 번 확인한다(10초 안 반복은 무시)', () => withBoot(src, async (W) => {
    W.applyState();
    await goOfflineBySave(W);
    W.clear();
    await W.run(2000);
    W.w.document.dispatchEvent(new W.w.Event('visibilitychange'));
    await settle();
    W.w.document.dispatchEvent(new W.w.Event('visibilitychange'));
    await settle();
    assert.strictEqual(W.reqs('dbPing').length, 1, '창 복귀 때 즉시 확인하지 않았다(또는 10초 안에 두 번 보냈다)');
  }));
  test('재연결⑤: 회복 순서 — 핑 → 미저장 저장 → loadProjects → loadCodes → 알림 → 토스트 1회 · 막대·잠금 해제(S5)', () => withBoot(src, async (W) => {
    W.applyState();
    await goOfflineBySave(W);
    W.handlers.dbPing = { ok: true };
    W.handlers.saveState = { ok: true };
    W.clear();
    await W.run(15000);
    const key = (x) => x.req || x.post || (x.toast ? 'toast:' + x.toast : '');
    const seq = W.log.map(key);
    //  알림(reminderSync)은 저장 성공 경로도 한 번 보낸다 — 회복 단계의 것(마지막)을 본다.
    const idx = (k) => (k === 'reminderSync' ? seq.lastIndexOf(k) : seq.indexOf(k));
    const order = ['dbPing', 'saveState', 'loadProjects', 'loadCodes', 'reminderSync', 'toast:서버에 다시 연결되었습니다'];
    for (const k of order) assert.ok(idx(k) >= 0, `회복 순서에 ${k} 가 없다: ${JSON.stringify(seq)}`);
    for (let i = 1; i < order.length; i++) assert.ok(idx(order[i - 1]) < idx(order[i]), `${order[i - 1]} 가 ${order[i]} 보다 뒤다: ${JSON.stringify(seq)}`);
    assert.strictEqual(W.posts('reloadState').length, 0, '부팅 스냅샷이 있는데 reloadState 를 보냈다 — 방금 저장한 것을 다시 읽을 이유가 없다');
    assert.strictEqual(W.toasts().filter((m) => m === '서버에 다시 연결되었습니다').length, 1, '회복 토스트가 한 번이 아니다');
    assert.ok(!W.el('dbUnsaved') && !W.el('dsError'), '회복했는데 막대·상자가 남았다');
    assert.strictEqual(W.ev('editLocked()'), false, '회복했는데 잠금이 안 풀렸다');
    assert.ok(!W.w.document.body.classList.contains('db-locked'));
    await W.run(30 * 60 * 1000, 30000);
    assert.strictEqual(W.reqs('dbPing').length, 1, '회복한 뒤에도 핑이 돈다(A11)');
  }));
  test('재연결⑥: 부팅 스냅샷이 없던 회복은 reloadState 를 loadProjects 보다 먼저 보낸다', () => withBoot(src, async (W) => {
    W.ev("conn = 'offline'; bootOk = false;");
    W.clear();
    await W.ev('connRecover()');
    const seq = W.log.map((x) => x.post || x.req);
    assert.ok(seq.indexOf('reloadState') >= 0 && seq.indexOf('reloadState') < seq.indexOf('loadProjects'), JSON.stringify(seq));
  }));
  test('재연결⑦: 회복 저장이 또 네트워크로 실패하면 막대는 남고 루프는 15초부터 다시 선다', () => withBoot(src, async (W) => {
    W.applyState();
    await goOfflineBySave(W);
    W.handlers.dbPing = { ok: true };      // 핑은 붙는데 저장 순간 다시 끊긴다
    W.clear();
    await W.run(15000);
    assert.strictEqual(W.reqs('saveState').length, 1, '회복이 미저장분을 보내지 않았다');
    assert.ok(W.el('dbUnsaved'), '저장이 또 실패했는데 막대가 걷혔다');
    assert.ok(!W.toasts().includes('서버에 다시 연결되었습니다'), '저장이 실패했는데 「다시 연결되었습니다」가 떴다');
    W.clear();
    await W.run(15000);
    assert.strictEqual(W.reqs('dbPing').length, 1, '다시 끊긴 뒤 루프가 15초에 다시 서지 않았다');
  }));
  test('재연결⑧: 핑이 권한 거부를 받으면 루프를 멈추고 접근 거부 상자를 띄운다', () => withBoot(src, async (W) => {
    W.applyState({ ...DATA }, { ...META, db: 'taskcalendar', host: '10.0.0.5' });
    W.ev("__dbConnLost({ kind:'network' })");
    W.handlers.dbPing = { ok: false, kind: 'auth', error: 'Access denied', detail: "Access denied for user 'tc'" };
    W.clear();
    await W.run(15000);
    assert.strictEqual(W.ev('conn'), 'denied');
    assert.ok(/DB 접근이 거부되었습니다/.test(W.text('dsErrorText')) && W.text('dsErrorText').includes('taskcalendar@10.0.0.5'), W.text('dsErrorText'));
    await W.run(30 * 60 * 1000, 30000);
    assert.strictEqual(W.reqs('dbPing').length, 1, '권한 거부 뒤에도 핑을 계속 돌렸다');
  }));

  // ── 부팅 성공 · 로그인 ──
  test('부팅①: 실패 뒤의 부팅 성공은 과제 목록·코드를 다시 읽고 「다시 연결되었습니다」 — 첫 성공은 아니다', async () => {
    await withBoot(src, async (W) => {
      W.applyError('서버에 연결하지 못했습니다', { retryable: true, kind: 'network' });
      W.ev("__applyProjects('')");
      W.clear();
      W.applyState();
      assert.strictEqual(W.posts('loadProjects').length, 1, '부팅 재시도가 성공했는데 과제 목록을 다시 읽지 않는다(기획 §1-4)');
      assert.strictEqual(W.posts('loadCodes').length, 1);
      assert.ok(W.toasts().includes('서버에 다시 연결되었습니다'));
      assert.ok(!W.el('dsError'), '상자가 남았다');
      assert.strictEqual(W.ev('bootOk'), true);
      assert.strictEqual(W.ev('editLocked()'), false);
    });
    await withBoot(src, async (W) => {
      W.clear();
      W.applyState();
      assert.strictEqual(W.posts('loadProjects').length, 0, '첫 부팅 성공인데 과제 목록을 한 번 더 읽는다(부팅이 이미 보냈다)');
      assert.ok(!W.toasts().includes('서버에 다시 연결되었습니다'), '아무 일도 없었는데 「다시 연결되었습니다」가 떴다');
    });
  });
  test('로그인①: 로그인 성공 → reloadState · loadProjects 를 보낸다(S2·A8)', () => withBoot(src, async (W) => {
    W.handlers.userLogin = { ok: true, user: { loginId: 'hjlee', name: '이현진' } };
    W.ev("$('#lgId').value = 'hjlee'; $('#lgPw').value = 'test-pass';");
    W.clear();
    await W.ev('submitLogin()');
    const seq = W.log.map((x) => x.post || x.req);
    assert.ok(seq.includes('userLogin'), '로그인 요청이 나가지 않았다');
    const r = seq.indexOf('reloadState'), p = seq.indexOf('loadProjects');
    assert.ok(r > seq.indexOf('userLogin') && p > r, '로그인 성공 뒤 reloadState→loadProjects 가 나가지 않았다: ' + JSON.stringify(seq));
  }));
  test('로그인②: 로그인 실패는 아무것도 다시 읽지 않는다', () => withBoot(src, async (W) => {
    W.handlers.userLogin = { ok: false, msg: 'DB 에 연결하지 못했습니다', kind: 'network' };
    W.ev("$('#lgId').value = 'hjlee'; $('#lgPw').value = 'test-pass';");
    W.clear();
    await W.ev('submitLogin()');
    assert.strictEqual(W.posts('reloadState').length + W.posts('loadProjects').length, 0);
    assert.strictEqual(W.text('lgMsg'), 'DB 에 연결하지 못했습니다', '호스트 문구(msg)를 그대로 보여 주지 않는다');
  }));

  // ── 「사용자 정보」 DB 한 줄 · 배지 방향 · 보고 기록 실패 ──
  test('표시①: 「사용자 정보」 DB 한 줄 — 연결됨(db@host) / 연결 끊김 / 접근 거부를 실시간으로', () => withBoot(src, async (W) => {
    W.applyState(DATA, { ...META, db: 'taskcalendar', host: '10.0.0.5' });
    assert.strictEqual(W.ev('usDbLineText(__bootMeta)'), '캘린더 DB(taskcalendar@10.0.0.5) 연결됨 · 스키마 v12 · rev 1');
    W.ev("__dbConnLost({ kind:'network' })");
    assert.strictEqual(W.text('usDbLine'), '캘린더 DB 연결 끊김 — 다시 연결을 시도하는 중', '끊겼는데 「사용자 정보」가 여전히 연결됨이라고 말한다');
    W.ev("conn = 'denied';");
    assert.strictEqual(W.ev('usDbLineText(__bootMeta)'), '캘린더 DB 접근 거부');
    W.ev("conn = 'ok';");
    assert.ok(/^캘린더 DB\(taskcalendar@10\.0\.0\.5\) 연결됨/.test(W.ev('usDbLineText(__bootMeta)')));
  }));
  test('표시②: 불일치 배지 방향 — 서버가 낮으면 「서버 DB 업데이트 필요(관리자)」, 높으면 「위젯 업데이트 필요」(S7)', () => withBoot(src, async (W) => {
    W.call('renderDataSourceBadge', { schemaMismatch: true, schemaVersion: '11', expectedSchema: '12', rev: 3 });
    assert.ok(/^서버 DB 업데이트 필요\(관리자\) · 서버 v11 · 위젯 v12/.test(W.text('dsBadge')), W.text('dsBadge'));
    assert.ok(!/위젯 업데이트 필요/.test(W.text('dsBadge')), '서버가 낮은데 위젯을 업데이트하라고 한다');
    W.call('renderDataSourceBadge', { schemaMismatch: true, schemaVersion: '13', expectedSchema: '12', rev: 3 });
    assert.ok(/위젯 업데이트 필요/.test(W.text('dsBadge')) && !/서버 DB 업데이트/.test(W.text('dsBadge')), W.text('dsBadge'));
  }));
  test('표시③: 보고 기록 저장 실패 통지 → 오래 남는 오류 토스트 · 웹은 다시 보내지 않는다(S10)', () => withBoot(src, async (W) => {
    W.applyState();
    W.clear();
    W.call('__reportRecordFailed', { which: 'daily', date: '2026-10-01', error: 'Unable to connect' });
    const msg = W.toasts().find((m) => /보고는 전송됐지만 기록 저장에 실패했습니다/.test(m));
    assert.ok(msg && msg.includes('2026-10-01'), '경고가 없거나 날짜가 없다: ' + JSON.stringify(W.toasts()));
    assert.strictEqual(W.log.filter((x) => x.req || x.post).length, 0, '웹이 무언가를 다시 보냈다 — 재시도는 호스트가 이미 했다');
    await W.run(5000);
    const el = [...W.w.document.querySelectorAll('#toastStackErr .toast')].find((t) => /보고는 전송됐지만/.test(t.textContent));
    assert.ok(el && !el._leaving, '경고가 5초도 안 돼 사라졌다 — 2.6초 토스트로는 읽기 전에 사라진다');
  }));

  // ── 열람 창(PEER) 면제 ──
  test('열람①: 열람 창은 잠금·막대·루프가 전부 꺼진다', () => withBoot(src, async (W) => {
    assert.strictEqual(W.ev('PEER'), true, '전제: 열람 창으로 떴다');
    assert.strictEqual(W.ev('editLocked()'), false, '열람 창에서 잠금이 켜졌다(읽기 전용 안내는 따로 있다)');
    W.ev("__dbConnLost({ kind:'network' })");
    W.ev('setUnsaved(true)');
    await W.run(60000);
    assert.strictEqual(W.ev('unsaved'), false);
    assert.ok(!W.el('dbUnsaved') && !W.el('dsError'), '열람 창에 연결 막대·상자가 떴다');
    assert.strictEqual(W.reqs('dbPing').length, 0, '열람 창이 핑을 돌렸다');
    assert.ok(!W.w.document.body.classList.contains('db-locked'));
  }, { peer: true }));

  // ── 변이 시험 — 위 검사가 정말 잡는지 ──
  const rejects = async (p, why) => { await assert.rejects(p, (e) => e instanceof assert.AssertionError, why); };
  test('변이①: 새 기록 진입점(openQuickAdd)에서 관문을 지우면 잠금② 가 실패한다', () =>
    rejects(checks.newEntryBlocked(mutate('  if(!entryId && guardEdit()) return;', '', src)), '변이를 잡지 못했다'));
  test('변이②: save() 가 잠긴 채 보내게 하면 잠금④ 가 실패한다', () =>
    rejects(checks.saveRefusedWhileLocked(mutate('  if(editLocked()){ lockedSaveRefused(); return; }   // editLocked 는', '  if(false){ lockedSaveRefused(); return; }   // editLocked 는', src)), '변이를 잡지 못했다'));
  test('변이③: 권한 거부도 재시도하게 하면 상자② 가 실패한다', () =>
    rejects(checks.authNeverRetries(mutate('  const retryable = !(opt && opt.retryable === false) && !connIsDenied(kind);', '  const retryable = !(opt && opt.retryable === false);', src)), '변이를 잡지 못했다'));
  test('변이④: 정상 부팅 때 핑 타이머를 걸면 재연결③(A11) 이 실패한다', () =>
    rejects(checks.noTimerWhileOk(mutate('  if(__pingRetry) __pingRetry.onSuccess();\n  setUnsaved(false);', '  pingRetry().onError(true);\n  setUnsaved(false);', src)), '변이를 잡지 못했다'));
  test('변이⑤: 300초 꼬리를 떼면 재연결① 이 실패한다', () =>
    rejects(checks.pingSchedule(mutate('      const wait = (d == null) ? tail : d;', '      const wait = d;', src)), '변이를 잡지 못했다'));
  test('변이⑥: unsavedState 를 보내지 않으면 막대③ 이 실패한다', () =>
    rejects(checks.unsavedPosted(mutate("  hpost({ cmd:'unsavedState', on: v });", '', src)), '변이를 잡지 못했다'));
  test('변이⑧: 미저장 때 부팅 재시도를 재연결 확인으로 넘기지 않으면 잠금⑤ 가 실패한다', () =>
    rejects(checks.unsavedSurvivesBootRetry(mutate("  if(v && bootOk && __connLoop === 'boot') connHandOffToPing();\n", '', src)), '변이를 잡지 못했다'));
  test('변이⑦: 네트워크 저장 실패를 옛 토스트로 되돌리면 막대① 이 실패한다', () =>
    rejects(checks.barOnNetworkNotConflict(mutate("    else if(saveFailIsNetwork(res)){ keep = true; setUnsaved(true); connLost(kind || 'network', res); }\n", '', src)), '변이를 잡지 못했다'));
}
