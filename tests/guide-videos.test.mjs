// 사용 영상 안내(docs/GUIDE-VIDEOS.md, 2026-10-23 사용자 결정).
//
// 이 파일이 지키는 것:
//   (S) 정적
//     S1 영상은 Setup 에 없다: installer/*.iss 의 [Files] 에 mp4, srt, guide.json, guide 폴더, 와일드카드가 없다.
//     S2 기억은 localStorage tc_guideSeen:<로그인> 하나이고, 저장소 접근은 전부 try 안이다.
//     S3 이름 규칙: 호스트 GuideRules.NameOk 가 구분자, .., 점 시작, 확장자를 보고, guideFetch 는 목록에 있는 이름만 받는다.
//        웹 gvNameOk 는 같은 표를 행동으로 통과한다.
//     S4 메인 창 전용: 두 명령이 열람 창, 관리 창 허용 목록(호스트, 웹)에 없고 메인 창 스위치에는 있다.
//     S5 GuideHost.cs 는 DB 를 쓰지 않는다(DB 계층, 연결 문자열, SQL 이 없다). 가상 호스트와 캐시 자리.
//     S6 화면 문구 기호 규칙(엠 대시, en 대시, 띄어 쓴 가운데 점, 낫표 없음).
//   (R) jsdom(위젯 모드, guideManifest 와 guideFetch 는 가짜 회신)
//     목록 없음이면 묻지 않음, 본 판이면 묻지 않음, 첫 사용자 문구와 기존 사용자 문구, 단추별 기록, 실행당 한 번,
//     계정 바꾸면 다시 판단, 다른 창이 떠 있으면 기다림, "?" 도움말에서 보기 창, 장면 이동, SRT 를 WebVTT 로,
//     오류 안내, 열람 창과 관리 창과 브라우저는 묻지 않음, 저장소가 던져도 죽지 않음.
//   (M) 변이: 핵심 줄을 바꾸면 위 검사가 잡는다.
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다(러너 exit 2).
import { readdirSync } from 'node:fs';
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM, readText, stripCsComments } from './harness.mjs';

const src = loadAppSource();
const W_DIR = new URL('../widget/', import.meta.url);
const I_DIR = new URL('../installer/', import.meta.url);
const host = readText(new URL('GuideHost.cs', W_DIR));
const mainwin = readText(new URL('MainWindow.xaml.cs', W_DIR)).replace(/\r/g, '');
const issFiles = readdirSync(I_DIR).filter((f) => f.endsWith('.iss')).map((f) => ({ name: f, text: readText(new URL(f, I_DIR)) }));

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${String(from).slice(0, 80)}`);
  return out;
}
const PUNCT = [[/—/, '엠 대시'], [/–/, 'en 대시'], [/「|」/, '낫표'], [/(^|\s)·|·(\s|$)/, '띄어 쓴 가운데 점']];
const punctBad = (t) => PUNCT.filter(([re]) => re.test(t)).map(([, n]) => n);

//  웹의 사용 영상 구역(머리 주석부터 gvBind 끝까지).
function gvSection(app) {
  const a = app.indexOf('/* ---------- 사용 영상(docs/GUIDE-VIDEOS.md');
  const b = app.indexOf('function gvBind(');
  assert.ok(a >= 0 && b > a, '웹의 사용 영상 구역을 찾지 못했다');
  return app.slice(a, b) + extractFunction(app, 'gvBind');
}
//  C# 집합 초기화 블록의 문자열들.
function csSet(cs, name) {
  const m = new RegExp(name + '\\s*=\\s*new\\(StringComparer\\.Ordinal\\)\\s*\\{([\\s\\S]*?)\\};').exec(cs);
  assert.ok(m, `${name} 를 찾지 못했다`);
  return new Set([...stripCsComments(m[1]).matchAll(/"([^"]+)"/g)].map((x) => x[1]));
}
function jsSet(app, name) {
  const m = new RegExp('const ' + name + ' = new Set\\(\\[([\\s\\S]*?)\\]\\)').exec(app);
  assert.ok(m, `${name} 를 찾지 못했다`);
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
}
const CMDS = ['guideManifest', 'guideFetch'];

/* ── (S) 정적 ─────────────────────────────────────────────────────────── */
const statics = {
  installer(files) {
    assert.ok(files.length >= 1, 'installer/*.iss 가 없다');
    for (const f of files) {
      const sec = /\[Files\]([\s\S]*?)(?:\n\[|$)/.exec(f.text);
      assert.ok(sec, `${f.name}: [Files] 구역이 없다`);
      const lines = sec[1].split('\n').filter((l) => /^\s*Source\s*:/i.test(l));
      assert.ok(lines.length >= 2, `${f.name}: Source 줄을 읽지 못했다`);
      for (const l of lines) {
        assert.ok(!/\.mp4|\.srt|guide\.json|guide[\\/]|guide-video|\*/i.test(l), `${f.name}: 설치 파일 목록에 사용 영상 또는 와일드카드가 있다: ${l.trim()}`);
      }
      assert.ok(!/\.mp4|guide\.json/i.test(f.text), `${f.name}: 설치 스크립트에 영상이나 guide.json 이 있다(영상은 Setup 에 넣지 않는다, §1)`);
    }
  },
  storage(app) {
    const sec = gvSection(app);
    const lines = sec.split('\n').filter((l) => /\b(localStorage|sessionStorage)\./.test(l) && !/^\s*(\/\/|\*)/.test(l));
    assert.ok(lines.length >= 3, '사용 영상 구역의 저장소 접근을 찾지 못했다');
    for (const l of lines) {
      const i = l.search(/\b(localStorage|sessionStorage)\./);
      assert.ok(/try\{/.test(l.slice(0, i)), '저장소 접근이 try 밖이다: ' + l.trim());
    }
    const keys = [...sec.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\((gvSeenKey\(me\)|[^,)]+)/g)].map((m) => m[1].trim());
    assert.ok(keys.length >= 2 && keys.every((k) => k === 'gvSeenKey(me)'), 'localStorage 에 tc_guideSeen 말고 다른 것을 기억한다: ' + keys.join(', '));
    assert.ok(/const gvSeenKey = me => 'tc_guideSeen:' \+ me;/.test(sec), "기억 키가 'tc_guideSeen:<로그인>' 이 아니다");
    assert.ok(!/localStorage\.(setItem|removeItem)\(/.test(sec.replace(/function gvSeenSet\([\s\S]*?\n/, '')), 'gvSeenSet 밖에서 localStorage 에 쓴다');
  },
  names(cs) {
    const c = stripCsComments(cs);
    const nameOk = /public static bool NameOk\(string\? name\)\s*\{([\s\S]*?)\n        \}/.exec(c);
    assert.ok(nameOk, 'GuideRules.NameOk 가 없다');
    const b = nameOk[1];
    assert.ok(/IndexOfAny\(Bad\)/.test(b) && /'\/', '\\\\'/.test(c), '이름 검사가 경로 구분자(/, \\)를 거르지 않는다');
    assert.ok(/name\.Contains\("\.\."\)/.test(b), '이름 검사가 .. 를 거르지 않는다');
    assert.ok(/StartsWith\('\.'\)/.test(b), '이름 검사가 점으로 시작하는 이름을 거르지 않는다');
    assert.ok(/EndsWith\("\.mp4", StringComparison\.OrdinalIgnoreCase\) \|\| name\.EndsWith\("\.srt", StringComparison\.OrdinalIgnoreCase\)/.test(b), '이름 검사가 .mp4 와 .srt 만 받지 않는다');
    const fetch = /private async Task<object> GuideFetchAsync\(string file\)\s*\{([\s\S]*?)\n        \}/.exec(c);
    assert.ok(fetch, 'GuideFetchAsync 가 없다');
    assert.ok(/!GuideRules\.NameOk\(file\)/.test(fetch[1]) && /!g\.Videos\.Any\(v => string\.Equals\(v\.File, file, StringComparison\.Ordinal\)\)/.test(fetch[1]),
      'guideFetch 가 목록에 있는 이름만 받지 않는다');
    assert.ok(/!file\.EndsWith\("\.mp4"/.test(fetch[1]), 'guideFetch 가 mp4 만 받지 않는다');
    assert.ok(/if \(!NameOk\(file\) \|\| !file\.EndsWith\("\.mp4"/.test(c), 'guide.json 검사가 영상 줄의 이름 규칙을 보지 않는다');
  },
  mainOnly(cs, app, mw) {
    const peer = csSet(mw, 'PeerWinCommands'), admin = csSet(mw, 'AdminWinCommands');
    const wpeer = jsSet(app, 'PEERWIN_CMD'), wadmin = jsSet(app, 'ADMINWIN_CMD'), silent = jsSet(app, 'PEER_SILENT_CMD');
    for (const c of CMDS) {
      assert.ok(!peer.has(c) && !admin.has(c), `${c} 가 따로 뜨는 창의 호스트 허용 목록에 있다(메인 창 전용)`);
      assert.ok(!wpeer.has(c) && !wadmin.has(c) && !silent.has(c), `${c} 가 웹의 창 허용 목록에 있다(메인 창 전용)`);
      assert.ok(new RegExp('case "' + c + '":').test(mw), `메인 창 스위치에 ${c} 가 없다`);
    }
    assert.ok(/case "guideManifest":\n\s*case "guideFetch":\n\s*_ = RunGuideAsync\(cmd, GetStr\(doc, "reqId"\), GetStr\(doc, "file"\)\);/.test(mw), '두 명령이 RunGuideAsync 로 가지 않는다');
    assert.ok(/if\(!HOST \|\| PEER \|\| SUBWIN\) return;/.test(extractFunction(app, 'gvOnBootApplied')), '묻기가 열람 창, 관리 창, 브라우저를 거르지 않는다');
    assert.ok(/if\(!HOST \|\| PEER \|\| SUBWIN\)\{ gvMsg\(/.test(extractFunction(app, 'gvOpenViewer')), '보기 창이 열람 창, 관리 창, 브라우저에서 호스트에 묻는다');
  },
  noDb(cs) {
    const c = stripCsComments(cs);
    const bad = ['MySql', 'CalendarDb', 'CalendarWriteDb', 'ProjectDb', 'ReportDb', 'ScheduleImageDb', 'ProjectCalendarDb', 'DbGate', 'BuildConnString', 'DbConnection', 'DbErrors']
      .filter((w) => c.includes(w));
    assert.deepStrictEqual(bad, [], 'GuideHost.cs 가 DB 계층을 부른다(§4: DB 를 쓰지 않는다)');
    assert.ok(!/\b(SELECT|INSERT|UPDATE|DELETE)\s+(INTO\s+|FROM\s+)?\w/.test(c), 'GuideHost.cs 에 SQL 이 있다');
    assert.ok(/internal const string GuideVirtualHost = "guide\.tcapp\.local";/.test(c), '가상 호스트 이름이 guide.tcapp.local 이 아니다');
    assert.ok(/SetVirtualHostNameToFolderMapping\(GuideVirtualHost, folder, CoreWebView2HostResourceAccessKind\.Allow\)/.test(c), '가상 호스트를 폴더에 잇지 않는다');
    assert.ok(/SpecialFolder\.LocalApplicationData\), "TaskCalendar", "guide-cache"\)/.test(c), '네트워크 캐시가 %LOCALAPPDATA%\\TaskCalendar\\guide-cache 가 아니다');
    assert.ok(/internal static string GuideFolderOf\(string src\) => CombineUrl\(src, "guide"\);/.test(c), 'guide 폴더를 업데이트 폴더 주소에서 정하지 않는다');
    assert.ok(/BoundAsync\(/.test(c) && /GuideReadTimeoutMs = 6000/.test(c), 'guide.json 읽기에 시간 제한이 없다');
  },
  punct(app, cs) {
    const sec = gvSection(app);
    const strs = [...sec.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]);
    const a = app.indexOf('<!-- ===== 사용 영상(docs/GUIDE-VIDEOS.md)'), b = app.indexOf('<!-- ===== 확인 모달', a);
    const markup = app.slice(a, b).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
    const attrs = [...app.slice(a, b).matchAll(/\b(?:title|aria-label)="([^"]*)"/g)].map((m) => m[1]);
    const btn = /<button class="btn" id="btnGuideVideos"[^>]*>[^<]*<\/button>/.exec(app);
    assert.ok(btn, '도움말 창에 [사용 영상] 단추가 없다');
    const all = [...strs, markup, ...attrs, btn[0]].join('\n');
    assert.deepStrictEqual(punctBad(all), [], '사용 영상 화면 문구에 금지 기호가 있다');
    assert.deepStrictEqual(punctBad(cs), [], 'GuideHost.cs 에 금지 기호가 있다');
  },
};
test('정적S1: 영상과 guide.json 은 Setup 에 없다(installer/*.iss 의 설치 파일 목록)', () => statics.installer(issFiles));
test('정적S2: 기억은 tc_guideSeen:<로그인> 하나, 저장소 접근은 전부 try 안', () => statics.storage(src));
test('정적S3: 이름 규칙(구분자, .., 점 시작, .mp4/.srt)과 목록에 있는 이름만', () => statics.names(host));
test('정적S4: 두 명령은 메인 창 전용(호스트와 웹 허용 목록에 없음, 스위치에 있음)', () => statics.mainOnly(host, src, mainwin));
test('정적S5: GuideHost.cs 는 DB 를 쓰지 않는다, 가상 호스트와 캐시 자리, 시간 제한', () => statics.noDb(host));
test('정적S6: 사용 영상 화면 문구와 호스트 파일에 금지 기호가 없다', () => statics.punct(src, host));

test('변이M1: 설치 목록에 guide 폴더를 넣으면 S1 이 잡는다', () => {
  const f = issFiles[0];
  const bad = { name: f.name, text: mutate('[Files]\n', '[Files]\nSource: "..\\dist\\guide\\*"; DestDir: "{app}\\guide"\n', f.text) };
  assert.throws(() => statics.installer([bad]));
});
test('변이M2: gvSeenGet 의 try 를 빼면 S2 가 잡는다', () => {
  assert.throws(() => statics.storage(mutate("function gvSeenGet(me){ try{ return localStorage.getItem(gvSeenKey(me)); }catch(_){ return null; } }",
    'function gvSeenGet(me){ return localStorage.getItem(gvSeenKey(me)); }', src)));
});
test('변이M3: 다른 키를 localStorage 에 기억하면 S2 가 잡는다', () => {
  assert.throws(() => statics.storage(mutate("function gvSeenSet(me, version){ try{ localStorage.setItem(gvSeenKey(me), String(version)); }catch(_){} }",
    "function gvSeenSet(me, version){ try{ localStorage.setItem(gvSeenKey(me), String(version)); localStorage.setItem('tc_guideLast', '1'); }catch(_){} }", src)));
});
test('변이M4: .. 검사를 빼거나 목록 대조를 빼면 S3 이 잡는다', () => {
  assert.throws(() => statics.names(mutate('|| name.Contains("..") ', '', host)));
  assert.throws(() => statics.names(mutate(' ||\n                !g.Videos.Any(v => string.Equals(v.File, file, StringComparison.Ordinal))', '', host)));
});
test('변이M5: 열람 창 허용 목록에 guideFetch 를 넣으면 S4 가 잡는다', () => {
  assert.throws(() => statics.mainOnly(host, src, mutate('"peerWinReady", ', '"peerWinReady", "guideFetch", ', mainwin)));
  assert.throws(() => statics.mainOnly(host, mutate("const PEERWIN_CMD = new Set(['peerWinReady',", "const PEERWIN_CMD = new Set(['peerWinReady','guideManifest',", src), mainwin));
});
test('변이M6: GuideHost.cs 가 DB 계층을 부르면 S5 가 잡는다', () => {
  assert.throws(() => statics.noDb(mutate('reply = cmd == "guideFetch"', 'var cs = CalendarDb.BuildConnString(); reply = cmd == "guideFetch"', host)));
});
test('변이M7: 문구에 엠 대시를 넣으면 S6 이 잡는다', () => {
  assert.throws(() => statics.punct(mutate("'새 기능 가이드가 추가되었습니다'", "'새 기능 가이드 — 추가되었습니다'", src), host));
});

/* ── 순수 함수(노드 vm 없이 jsdom 밖에서): 이름 규칙 표 ──────────────────── */
test('이름 규칙 표: 웹 gvNameOk(호스트 NameOk 와 같은 규칙)', () => {
  const nameOk = new Function(extractFunction(src, 'gvNameOk') + '\nreturn gvNameOk;')();
  const ok = ['overview.mp4', '보고서.mp4', 'a b.MP4', 'overview.srt', 'v1_report-2.mp4'];
  const bad = ['', '../x.mp4', '..\\x.mp4', 'a/b.mp4', 'a\\b.mp4', 'x..mp4', '.hidden.mp4', 'c:x.mp4', ' x.mp4', 'x.mp4 ', 'x.avi', 'guide.json',
    'x.mp4\u0000', 'a*.mp4', 'a?.mp4', 'a"b.mp4', 'x'.repeat(125) + '.mp4', null, undefined];
  for (const n of ok) assert.strictEqual(nameOk(n), true, '받아야 한다: ' + n);
  for (const n of bad) assert.strictEqual(nameOk(n), false, '거절해야 한다: ' + JSON.stringify(n));
});

/* ── (R) jsdom 위젯 모드 ──────────────────────────────────────────────── */
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('guide-videos: jsdom 미설치. 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
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
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '17', expectedSchema: '17', schemaMismatch: false, gate: 'ok', rev: 1, canWrite: true, userId: 7 };
  const CAT = { id: 'c-1', name: '과제 A', color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: '2026-09-01T00:00:00Z' };
  const ENTRY = { id: 'e-1', date: '2026-10-01', title: '기존 기록', categoryId: 'c-1', allDay: true, startTime: '', endTime: '',
    memo: '', location: '', source: '', commits: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' };
  const OLD_USER = { categories: [CAT], entries: [ENTRY], todos: [], rooms: [] };
  const NEW_USER = { categories: [CAT], entries: [], todos: [], rooms: [] };
  const MANIFEST = {
    ok: true, version: '2026-11', source: 'file',
    videos: [
      { id: 'overview', file: 'overview.mp4', title: '전체 소개', chapters: [] },
      { id: 'report', file: 'report.mp4', title: '보고서', chapters: [{ t: 0, title: '일간' }, { t: 80, title: '주간' }, { t: 160, title: '월간' }] },
    ],
  };
  const SRT = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n첫 줄 & <i>기울임</i>\r\n둘째 줄\r\n\r\n2\r\n0:01:02,05 --> 00:01:04,000 X1:10\r\n다음 --> 끝\r\n';

  async function boot({ query = '', login = 'hjlee', host = true, store = null } = {}) {
    const clock = fakeClock();
    const posts = [];
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true,
      url: 'https://tcapp.local/' + query,
      virtualConsole: quietConsole(),
      beforeParse(win) {
        if (host) win.chrome = { webview: {
          postMessage(m) { let o = null; try { o = JSON.parse(m); } catch (_) {} posts.push(o || {}); },
          addEventListener() {}, removeEventListener() {},
        } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.setTimeout = clock.setTimeout;
        win.clearTimeout = clock.clearTimeout;
        if (store) store(win);
      },
    });
    const w = dom.window;
    const W = {
      w, clock, posts,
      ev: (code) => w.eval(code),
      el: (id) => w.document.getElementById(id),
      open: (id) => { const e = w.document.getElementById(id); return !!e && !e.classList.contains('hidden') && !e.classList.contains('closing'); },
      cmds: (cmd) => posts.filter((p) => p.cmd === cmd),
      async reply(cmd, res) {
        const p = [...posts].reverse().find((x) => x.cmd === cmd && x.reqId);
        assert.ok(p, `${cmd} 요청이 나가지 않았다`);
        w.eval('__hostReply(' + JSON.stringify(p.reqId) + ',' + JSON.stringify(res) + ')');
        await settle();
      },
      async applyState(data = OLD_USER) { w.eval('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(META) + ')'); await settle(); },
      async login(id) { await W.reply('userSessionGet', { ok: true, user: { loginId: id, name: id } }); },
      async run(ms, step = 1000) { for (let t = 0; t < ms; t += step) { clock.advance(Math.min(step, ms - t)); await settle(); } },
      seen: (id) => { try { return w.localStorage.getItem('tc_guideSeen:' + id); } catch (_) { return 'THROW'; } },
      click: async (id) => { w.document.getElementById(id).click(); await settle(); },
      close: () => { try { w.close(); } catch (_) {} },
    };
    if (host && !query && login) await W.login(login);
    return W;
  }
  async function withBoot(opts, fn) { const W = await boot(opts); try { return await fn(W); } finally { W.close(); } }
  //  부팅해서 첫 화면을 그리고 목록 회신까지(묻는 창이 뜰 자리).
  async function toAsk(W, data = OLD_USER, manifest = MANIFEST) {
    await W.applyState(data);
    assert.strictEqual(W.cmds('guideManifest').length, 1, '첫 화면 뒤 목록을 한 번 묻지 않는다');
    await W.reply('guideManifest', manifest);
  }

  test('묻기①: 목록이 없거나 닿지 않으면 묻지 않는다', () => withBoot({}, async (W) => {
    await W.applyState();
    await W.reply('guideManifest', { ok: false, reason: 'missing' });
    assert.ok(!W.open('gvAskModal'), '목록이 없는데 물었다');
    await W.run(10000);
    assert.ok(!W.open('gvAskModal'));
    assert.strictEqual(W.seen('hjlee'), null, '목록이 없는데 기록했다');
  }));
  test('묻기②: 시간 초과(공유 폴더 무응답)여도 묻지 않고 화면은 그대로다', () => withBoot({}, async (W) => {
    await W.applyState();
    await W.run(25000);
    assert.ok(!W.open('gvAskModal'));
  }));
  test('묻기③: 본 판 번호와 같으면 묻지 않는다', () => withBoot({ store: (win) => win.localStorage.setItem('tc_guideSeen:hjlee', '2026-11') }, async (W) => {
    await toAsk(W);
    assert.ok(!W.open('gvAskModal'), '본 판인데 물었다');
  }));
  test('묻기④: 판 번호가 다르면 묻는다. 기록이 있는 계정은 새 기능 문구', () => withBoot({ store: (win) => win.localStorage.setItem('tc_guideSeen:hjlee', '2026-10') }, async (W) => {
    await toAsk(W, OLD_USER);
    assert.ok(W.open('gvAskModal'), '묻지 않았다');
    assert.strictEqual(W.el('gvAskText').textContent, '새 기능 가이드가 추가되었습니다');
    assert.deepStrictEqual([...W.el('gvAskModal').querySelectorAll('.modal-foot button')].map((b) => b.textContent.trim()), ['다시 묻지 않기', '나중에', '보기']);
    assert.strictEqual(W.w.document.activeElement && W.w.document.activeElement.id, 'btnGvOpen', '[보기] 에 포커스가 없다');
  }));
  test('묻기⑤: 내 일정과 할 일이 하나도 없으면 첫 사용자 문구', () => withBoot({}, async (W) => {
    await toAsk(W, NEW_USER);
    assert.strictEqual(W.el('gvAskText').textContent, '사용 영상을 보시겠습니까?');
  }));
  test('묻기⑥: 할 일만 있어도 기존 사용자 문구', () => withBoot({}, async (W) => {
    await toAsk(W, Object.assign({}, NEW_USER, { todos: [{ id: 't-1', title: '할 일', done: false, createdAt: '2026-09-01T00:00:00Z' }] }));
    assert.strictEqual(W.el('gvAskText').textContent, '새 기능 가이드가 추가되었습니다');
  }));

  test('단추①: [보기] 는 판을 기록하고 보기 창을 연다', () => withBoot({}, async (W) => {
    await toAsk(W);
    await W.click('btnGvOpen');
    assert.strictEqual(W.seen('hjlee'), '2026-11');
    assert.ok(W.open('gvModal'), '보기 창이 열리지 않았다');
    assert.strictEqual(W.cmds('guideManifest').length, 2, '보기 창이 목록을 새로 읽지 않는다');
    await W.reply('guideManifest', MANIFEST);
    assert.deepStrictEqual([...W.el('gvList').querySelectorAll('.gv-item')].map((b) => b.textContent), ['전체 소개', '보고서']);
    assert.deepStrictEqual(W.cmds('guideFetch').map((p) => p.file), ['overview.mp4'], '첫 영상을 받으러 가지 않는다');
  }));
  test('단추②: [다시 묻지 않기] 는 기록만 한다', () => withBoot({}, async (W) => {
    await toAsk(W);
    await W.click('btnGvNever');
    assert.strictEqual(W.seen('hjlee'), '2026-11');
    assert.ok(!W.open('gvModal') && !W.open('gvAskModal'));
  }));
  test('단추③: [나중에] 와 × 는 기록하지 않는다', () => withBoot({}, async (W) => {
    await toAsk(W);
    await W.click('btnGvLater');
    assert.strictEqual(W.seen('hjlee'), null);
    assert.ok(!W.open('gvAskModal') && !W.open('gvModal'));
  }));
  test('단추④: × 로 닫아도 기록하지 않는다', () => withBoot({}, async (W) => {
    await toAsk(W);
    W.el('gvAskModal').querySelector('.x').click(); await W.run(500);
    assert.strictEqual(W.seen('hjlee'), null);
    assert.ok(!W.open('gvAskModal'));
  }));
  test('실행당 한 번: [나중에] 뒤 다시 읽기(__applyState)와 새로고침에도 다시 묻지 않는다', () => withBoot({}, async (W) => {
    await toAsk(W);
    await W.click('btnGvLater');
    await W.applyState();
    await W.applyState();
    assert.strictEqual(W.cmds('guideManifest').length, 1, '같은 실행에서 다시 목록을 읽었다');
    assert.ok(!W.open('gvAskModal'));
    assert.deepStrictEqual(JSON.parse(W.w.sessionStorage.getItem('tc_guideAsked')), ['hjlee'], '실행 안 기억(sessionStorage)이 없다');
  }));
  test('실행당 한 번: 새로고침한 페이지(sessionStorage 유지)는 다시 묻지 않는다', () => withBoot({ store: (win) => win.sessionStorage.setItem('tc_guideAsked', '["hjlee"]') }, async (W) => {
    await W.applyState();
    assert.strictEqual(W.cmds('guideManifest').length, 0, '이미 판단한 계정인데 다시 읽었다');
  }));
  test('세션 복원이 화면보다 늦게 와도 묻는다(순서 무관)', () => withBoot({ login: '' }, async (W) => {
    await W.applyState();
    assert.strictEqual(W.cmds('guideManifest').length, 0, '로그인 전인데 목록을 읽었다');
    await W.login('hjlee');
    assert.strictEqual(W.cmds('guideManifest').length, 1, '세션 복원 뒤 목록을 읽지 않는다');
    await W.reply('guideManifest', MANIFEST);
    assert.ok(W.open('gvAskModal'));
  }));
  test('계정 바꿈: 새 계정으로 다시 판단하고, 같은 실행에서 앞 계정은 다시 묻지 않는다', () => withBoot({}, async (W) => {
    await toAsk(W);
    await W.click('btnGvLater');
    W.ev("applyUser({ loginId:'kim', name:'김' })");
    await W.applyState(NEW_USER);
    assert.strictEqual(W.cmds('guideManifest').length, 2, '새 계정으로 다시 판단하지 않는다');
    await W.reply('guideManifest', MANIFEST);
    assert.ok(W.open('gvAskModal'));
    assert.strictEqual(W.el('gvAskText').textContent, '사용 영상을 보시겠습니까?');
    await W.click('btnGvNever');
    assert.strictEqual(W.seen('kim'), '2026-11');
    assert.strictEqual(W.seen('hjlee'), null);
    W.ev("applyUser({ loginId:'hjlee', name:'이' })");
    await W.applyState();
    assert.strictEqual(W.cmds('guideManifest').length, 2, '같은 실행에서 앞 계정을 다시 판단했다');
  }));
  test('다른 창이 떠 있으면 닫힐 때까지 기다렸다 묻는다', () => withBoot({}, async (W) => {
    await W.applyState();
    W.ev("openModal('#helpModal')");
    await W.reply('guideManifest', MANIFEST);
    assert.ok(!W.open('gvAskModal'), '다른 창 위에 겹쳐 물었다');
    W.ev("closeModal('#helpModal')");
    await W.run(4000);
    assert.ok(W.open('gvAskModal'), '창이 닫힌 뒤에도 묻지 않는다');
  }));

  test('"?" 도움말: [사용 영상] 이 보기 창을 연다(판 번호와 무관)', () => withBoot({ store: (win) => win.localStorage.setItem('tc_guideSeen:hjlee', '2026-11') }, async (W) => {
    await toAsk(W);
    assert.ok(!W.open('gvAskModal'));
    await W.click('btnHelp');
    assert.ok(W.open('helpModal'));
    assert.ok(W.el('btnGuideVideos'), '도움말 창에 [사용 영상] 이 없다');
    await W.click('btnGuideVideos');
    assert.ok(W.open('gvModal'), '보기 창이 열리지 않았다');
    await W.reply('guideManifest', MANIFEST);
    assert.strictEqual(W.el('gvList').querySelectorAll('.gv-item').length, 2);
    await W.reply('guideFetch', { ok: true, url: 'https://guide.tcapp.local/overview.mp4', srt: '' });
    assert.strictEqual(W.el('gvVideo').getAttribute('src'), 'https://guide.tcapp.local/overview.mp4');
    assert.strictEqual(W.el('gvVideo').querySelectorAll('track').length, 0, '자막이 없는데 트랙을 붙였다');
  }));
  test('보기 창: 영상을 고르면 장면 목록과 자막 트랙, 장면을 누르면 그 초로', () => withBoot({}, async (W) => {
    W.ev('gvOpenViewer()'); await settle();
    await W.reply('guideManifest', MANIFEST);
    await W.reply('guideFetch', { ok: true, url: 'https://guide.tcapp.local/overview.mp4', srt: '' });
    W.el('gvList').querySelectorAll('.gv-item')[1].click(); await settle();
    assert.strictEqual(W.cmds('guideFetch').at(-1).file, 'report.mp4');
    assert.strictEqual(W.el('gvTitle').textContent, '보고서');
    const chs = [...W.el('gvChapters').querySelectorAll('.gv-ch')];
    assert.deepStrictEqual(chs.map((b) => b.textContent), ['0:00일간', '1:20주간', '2:40월간']);
    await W.reply('guideFetch', { ok: true, url: 'https://guide.tcapp.local/report.mp4', srt: SRT });
    const v = W.el('gvVideo');
    assert.strictEqual(v.getAttribute('src'), 'https://guide.tcapp.local/report.mp4');
    const tr = v.querySelector('track');
    assert.ok(tr, '자막 트랙이 없다');
    assert.strictEqual(tr.getAttribute('kind'), 'subtitles');
    assert.strictEqual(tr.getAttribute('srclang'), 'ko');
    assert.ok(/^(blob:|data:text\/vtt)/.test(tr.getAttribute('src')), '트랙 주소가 blob 이나 data 가 아니다(다른 출처는 CORS 에 막힌다)');
    if (tr.getAttribute('src').startsWith('data:')) assert.ok(decodeURIComponent(tr.getAttribute('src').split(',')[1]).startsWith('WEBVTT'));
    chs[1].click(); await settle();
    assert.strictEqual(v.currentTime, 80, '장면을 눌러도 80초로 가지 않는다');
    assert.ok(chs[1].classList.contains('on') && !chs[0].classList.contains('on'), '누른 장면이 표시되지 않는다');
    W.el('gvModal').querySelector('.x').click(); await W.run(500);
    assert.strictEqual(v.getAttribute('src'), null, '닫아도 재생 주소를 내려놓지 않는다');
  }));
  test('보기 창: 늦게 온 회신(이미 다른 영상을 골랐다)은 버린다', () => withBoot({}, async (W) => {
    W.ev('gvOpenViewer()'); await settle();
    await W.reply('guideManifest', MANIFEST);
    const first = W.cmds('guideFetch').at(-1);
    W.el('gvList').querySelectorAll('.gv-item')[1].click(); await settle();
    W.ev('__hostReply(' + JSON.stringify(first.reqId) + ',' + JSON.stringify({ ok: true, url: 'https://guide.tcapp.local/overview.mp4', srt: '' }) + ')'); await settle();
    assert.strictEqual(W.el('gvVideo').getAttribute('src'), null, '늦게 온 앞 영상 회신이 재생 주소를 덮었다');
  }));
  test('SRT 를 WebVTT 로: BOM, CRLF, 번호 줄, 쉼표, 한 자리 시, 여러 줄, &와 <, 꼬리 설정, --> 글', () => withBoot({}, async (W) => {
    const vtt = W.ev('gvSrtToVtt(' + JSON.stringify(SRT) + ')');
    assert.strictEqual(vtt, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\n첫 줄 &amp; <i>기울임</i>\n둘째 줄\n\n00:01:02.050 --> 00:01:04.000\n다음 --&gt; 끝\n');
    assert.strictEqual(W.ev("gvSrtToVtt('')"), 'WEBVTT\n');
    assert.strictEqual(W.ev("gvSrtToVtt('1\\n깨진 줄\\n\\n2\\n00:00:01,000 --> 끝\\n글')"), 'WEBVTT\n', '시각이 깨진 자막을 넣었다');
  }));
  test('오류: 공유 폴더에 닿지 않으면 보기 창에 짧은 안내, 목록과 재생은 없다', () => withBoot({}, async (W) => {
    W.ev('gvOpenViewer()'); await settle();
    assert.strictEqual(W.el('gvMsg').textContent, '사용 영상 목록을 읽는 중입니다.');
    await W.reply('guideManifest', { ok: false, reason: 'unreachable' });
    assert.strictEqual(W.el('gvMsg').textContent, '공유 폴더에 연결할 수 없습니다. 잠시 뒤 다시 열어 보세요.');
    assert.ok(W.el('gvWrap').classList.contains('hidden'));
    assert.strictEqual(W.cmds('guideFetch').length, 0);
  }));
  test('오류: 영상 받기가 실패하면 안내하고 목록은 남는다', () => withBoot({}, async (W) => {
    W.ev('gvOpenViewer()'); await settle();
    await W.reply('guideManifest', MANIFEST);
    await W.reply('guideFetch', { ok: false, reason: 'download' });
    assert.strictEqual(W.el('gvMsg').textContent, '영상을 내려받지 못했습니다. 잠시 뒤 다시 시도하세요.');
    assert.ok(!W.el('gvWrap').classList.contains('hidden'));
    assert.strictEqual(W.el('gvVideo').getAttribute('src'), null);
  }));
  test('받는 중 알림: 지금 고른 영상의 진행만 보인다', () => withBoot({}, async (W) => {
    W.ev('gvOpenViewer()'); await settle();
    await W.reply('guideManifest', Object.assign({}, MANIFEST, { source: 'net' }));
    W.ev("__guideProgress({ file:'overview.mp4', got: 5242880, total: 10485760 })");
    assert.strictEqual(W.el('gvState').textContent, '내려받는 중 50%');
    W.ev("__guideProgress({ file:'report.mp4', got: 1, total: 2 })");
    assert.strictEqual(W.el('gvState').textContent, '내려받는 중 50%', '다른 영상의 진행이 섞였다');
  }));
  test('목록 회신을 웹이 한 번 더 거른다(나쁜 이름, 빈 제목, 음수 초)', () => withBoot({}, async (W) => {
    W.ev('gvOpenViewer()'); await settle();
    await W.reply('guideManifest', { ok: true, version: 'x', source: 'file', videos: [
      { id: 'a', file: '../a.mp4', title: '나쁨' }, { id: 'b', file: 'b.mp4', title: '' },
      { id: 'c', file: 'c.mp4', title: '좋음', chapters: [{ t: -1, title: '음수' }, { t: 5, title: '오' }] }] });
    assert.deepStrictEqual([...W.el('gvList').querySelectorAll('.gv-item')].map((b) => b.textContent), ['좋음']);
    assert.deepStrictEqual([...W.el('gvChapters').querySelectorAll('.gv-ch')].map((b) => b.textContent), ['0:05오']);
  }));

  test('열람 프레임(?peer=1)은 묻지 않는다', () => withBoot({ query: '?peer=1' }, async (W) => {
    W.ev("applyUser({ loginId:'hjlee' })");
    await W.applyState();
    assert.strictEqual(W.cmds('guideManifest').length, 0);
    assert.ok(!W.open('gvAskModal'));
  }));
  test('열람 창(?peerwin=1)과 관리 창(?win=admin)은 묻지 않고 보기 창도 호스트에 묻지 않는다', async () => {
    for (const q of ['?peerwin=1', '?win=admin']) {
      await withBoot({ query: q }, async (W) => {
        W.ev("applyUser({ loginId:'hjlee' })");
        W.ev('__xmlApplied = true; gvOnBootApplied()'); await settle();
        W.ev('gvOpenViewer()'); await settle();
        assert.strictEqual(W.cmds('guideManifest').length, 0, q + ' 에서 목록을 읽었다');
        assert.ok(!W.open('gvAskModal'), q + ' 에서 물었다');
      });
    }
  });
  test('브라우저(호스트 없음)는 묻지 않고, 보기 창은 위젯에서 보라고 안내한다', () => withBoot({ host: false }, async (W) => {
    W.ev("applyUser({ loginId:'hjlee' })");
    W.ev('__xmlApplied = true; gvOnBootApplied()'); await settle();
    assert.ok(!W.open('gvAskModal'));
    W.ev('gvOpenViewer()'); await settle();
    assert.strictEqual(W.el('gvMsg').textContent, '사용 영상은 위젯 앱의 메인 창에서 볼 수 있습니다.');
  }));
  test('저장소가 던져도(차단된 localStorage, sessionStorage) 죽지 않고 묻는다', () => withBoot({ store: (win) => {
    const thrower = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    Object.defineProperty(win, 'sessionStorage', { configurable: true, get() { return thrower; } });
  } }, async (W) => {
    await toAsk(W);
    assert.ok(W.open('gvAskModal'));
    await W.click('btnGvLater');
    await W.applyState();
    assert.strictEqual(W.cmds('guideManifest').length, 1, 'sessionStorage 가 막혀도 실행 안 기억(메모리)은 남아야 한다');
  }));
  test('화면 문구 기호 규칙(묻는 창 두 문구, 보기 창)', () => withBoot({}, async (W) => {
    await toAsk(W, NEW_USER);
    const t1 = W.el('gvAskModal').textContent;
    await W.click('btnGvOpen');
    await W.reply('guideManifest', MANIFEST);
    const t2 = W.el('gvModal').textContent + ' ' + [...W.el('gvModal').querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).join(' ');
    assert.deepStrictEqual(punctBad(t1 + ' ' + t2), []);
  }));
}

//  첫 재생 오류는 한 번 다시 읽는다(가상 호스트 연결 직후 첫 요청 실패, 2026-10-23 실 위젯 루프). 두 번째 실패에만 안내한다.
test('보기 창: 재생 오류는 같은 영상에서 한 번 다시 읽고, 두 번째에 안내한다', () => {
  const s = src.replace(/\r\n/g, '\n');
  assert.ok(/v\.dataset\.retried !== src\)\{ v\.dataset\.retried = src;[\s\S]{0,120}v\.load\(\)/.test(s), '첫 오류 때 다시 읽기가 없다');
  assert.ok(/v\.dataset\.retried !== src[\s\S]{0,260}gvMsg\('영상을 재생하지 못했습니다/.test(s), '두 번째 오류 안내가 없다');
});
