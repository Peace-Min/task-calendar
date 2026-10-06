// 화면 문구 기호 지킴이: 사용자에게 보이는 글에 AI 티 나는 기호가 다시 들어오지 않게 막는다.
//
// 왜 이 파일이 있나(2026-10-06 사용자 결정):
//   "엠 대시나 가운데 점은 사람은 보통 안 쓴다." 화면 문구에서 엠 대시(—), en 대시(–),
//   띄어 쓴 가운데 점 구분자( · ), 낫표(「」)를 걷어냈다. 규칙은 korean-ai-punct 스킬(P1~P3)이다.
//   붙여 쓴 짝 이름(직급·소속, 구분·상태)은 맞춤법대로라 허용한다(가운데 점 양옆에 띄어쓰기가 없으면 걸리지 않는다).
//
// 지키는 것:
//   (S) 정적: 마크업 본문 글, title / aria-label / placeholder / alt / label 속성, 스크립트의 문자열 리터럴(토스트,
//       확인창, textContent, innerHTML 로 들어가는 글)에 금지 기호가 없다. 주석, CSS, data-*, base64 는 보지 않는다.
//       화면에 보이지 않는 문자열(기호 자체가 기능인 것)은 아래 허용 목록에 이유와 함께 적는다. 허용 목록 항목이
//       더는 쓰이지 않으면(낡으면) 그것도 실패다.
//   (R) jsdom: 앱을 위젯 모드로 띄우고 주요 창(도움말, 사용설명서, 패치노트, 설정, 내 과제, 보고서, 사용자 정보,
//       다른 사람 일정 고르기, ⚙ 관리 항목들, 문의, 로그인 화면)을 열어 보이는 글과 title / aria-label / placeholder 를 검사한다.
//   (M) 변이: 보이는 글에 「 를 하나 넣으면 (S)와 (R)가 각각 잡는다.
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 등록되지 않고 skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

// ── 금지 기호 ─────────────────────────────────────────────────────────
//  띄어 쓴 가운데 점: 양옆 중 한쪽이라도 공백(또는 글 끝)이면 구분자로 쓴 것이다. 붙여 쓴 짝 이름은 걸리지 않는다.
const RULES = [
  [/—/, '엠 대시(—)'],
  [/–/, 'en 대시(–)'],
  [/「|」/, '낫표(「」)'],
  [/(^|\s)·|·(\s|$)/, '띄어 쓴 가운데 점( · )'],
];
const badOf = (text) => RULES.filter(([re]) => re.test(text)).map(([, n]) => n);

// ── 허용 목록(보이는 자리에 있지만 기호 자체가 기능인 것) ─────────────────
//  보고서 머리기호 선택지: 옵션 이름표가 실제로 찍힐 문자를 보여 준다(값 '·' '–' 가 보고서 본문에 그대로 쓰인다).
const ALLOW_TEXT = new Map([
  ['· 가운뎃점', '보고서 머리기호 선택지(#rptMarker): 찍힐 문자 자체를 보여 준다'],
  ['– 대시', '보고서 머리기호 선택지(#rptMarker): 찍힐 문자 자체를 보여 준다'],
]);
//  스크립트 문자열 중 화면 문구가 아닌 것. [그 줄에 있어야 하는 표지, 리터럴 원문(따옴표 포함), 이유].
//  리터럴만으로 허용하면 같은 조각이 다른 화면 문구에 끼어도 통과하므로, 줄 표지를 함께 본다.
const ALLOW_JS = [
  ["const staleRoster = (!r.ok && r.msg ===", "'명부가 바뀌었습니다 — 새로고침한 뒤 다시 저장하세요.'", '호스트(C#) 상수와 글자 그대로 맞대는 비교값. 바꾸려면 C# 과 함께'],
  ['console.warn(`알 수 없는 taskCalendar 버전', ') — v1 규칙으로 해석을 시도합니다.', '로그 전용(console.warn)'],
  ['const PRESET_MARKERS = new Set(', "'–'", '보고서 머리기호 저장값(데이터)'],
  ["'–':{kind:'const',ch:'–'}", "'–'", '보고서 머리기호 출력 문자(기능)'],
  ['추출 · 전체 ${n}건 중', ' 추출 · 전체 ', 'xlsx 내보내기 부제(파일 데이터 형식)'],
  ['추출 · 전체 ${n}건 중', '건 · ', 'xlsx 내보내기 부제(파일 데이터 형식)'],
  ['추출 · 전체 ${n}건 중', ' · ', 'xlsx 내보내기 부제(파일 데이터 형식)'],
  ["out.push('# 연구노트 데이터 — '", "'# 연구노트 데이터 — '", '연구노트 .md 내보내기 본문 형식'],
  ["out.push('- ' + e.title + (hh ?", "' · '", '연구노트 .md 내보내기 본문 형식'],
  ["(detail ? ' — ' + detail : '')", "' — '", '연구노트 .md 내보내기 본문 형식'],
  ["if(h > 0) head += ' — 투입 '", "' — 투입 '", 'netcus 주간보고 병합 본문(복사, 전송되는 출력 형식)'],
  ["parts.push('· ' + (bt && bp", "'· '", 'netcus 주간보고 병합 본문(복사, 전송되는 출력 형식)'],
  ['html += \'<div class="rncw-wk">· \'', '\'<div class="rncw-wk">· \'', '위 주간보고 본문을 그대로 보여 주는 미리보기'],
  ["`${cat ? cat.name + ' · ' : ''}커밋", "' · '", '커밋으로 만든 기록 제목(저장 데이터, 같은 꼴을 정규식이 알아본다)'],
  ['`${cat.name} · 커밋 ${mapped.length}건`', ' · 커밋 ', '커밋으로 만든 기록 제목(저장 데이터)'],
];
const lineAt = (src, pos) => { const a = src.lastIndexOf('\n', pos) + 1; const b = src.indexOf('\n', pos); return src.slice(a, b < 0 ? src.length : b); };

// ── HTML/JS 분해(주석·CSS·정규식 제외) ──────────────────────────────────
function lineOf(src, pos) { let n = 1; for (let i = 0; i < pos; i++) if (src.charCodeAt(i) === 10) n++; return n; }
function segments(src) {
  const out = [];
  const push = (kind, s, e) => { if (e > s) out.push({ kind, start: s, end: e, text: src.slice(s, e) }); };
  function scanJS(base, end) {
    let i = base, prev = '';
    const tpl = [];
    const kw = /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
    const reOk = () => prev === '' || (/[\w$]$/.test(prev) ? kw.test(prev) : !(prev === ')' || prev === ']' || prev === '}'));
    function scanTpl(j) {
      const s = j;
      while (j < end) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '`') { push('js-tpl', s, j); tpl.pop(); return j + 1; }
        if (c === '$' && src[j + 1] === '{') { push('js-tpl', s, j); return j + 2; }
        j++;
      }
      push('js-tpl', s, end); return end;
    }
    while (i < end) {
      const ch = src[i];
      if (ch === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = (e < 0 || e > end) ? end : e; continue; }
      if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? end : e + 2; continue; }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < end && src[j] !== ch && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
        push('js-str', i, j + 1); i = j + 1; prev = 'str'; continue;
      }
      if (ch === '`') { tpl.push(0); i = scanTpl(i + 1); prev = 'str'; continue; }
      if (ch === '}' && tpl.length && tpl[tpl.length - 1] === 0) { i = scanTpl(i + 1); prev = 'str'; continue; }
      if (ch === '{' && tpl.length) tpl[tpl.length - 1]++;
      if (ch === '}' && tpl.length && tpl[tpl.length - 1] > 0) tpl[tpl.length - 1]--;
      if (ch === '/' && reOk()) {
        let j = i + 1, cls = false;
        while (j < end) { const c = src[j]; if (c === '\\') { j += 2; continue; } if (c === '\n') break; if (c === '[') cls = true; else if (c === ']') cls = false; else if (c === '/' && !cls) break; j++; }
        j++; while (/[a-z]/i.test(src[j])) j++;
        i = j; prev = 're'; continue;
      }
      if (/\s/.test(ch)) { i++; continue; }
      if (/[\w$]/.test(ch)) { let j = i; while (j < end && /[\w$]/.test(src[j])) j++; prev = src.slice(i, j); i = j; continue; }
      if (/[^\x00-\x7f]/.test(ch)) { i++; continue; }
      prev = ch; i++;
    }
  }
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i); i = e + 3; continue; }
    const m = /^<(script|style)\b[^>]*>/i.exec(src.slice(i, i + 300));
    if (m) {
      const tag = m[1].toLowerCase(); const b = i + m[0].length; const close = src.toLowerCase().indexOf('</' + tag, b);
      if (tag === 'script') scanJS(b, close);
      i = src.indexOf('>', close) + 1; continue;
    }
    if (src[i] === '<' && /[a-zA-Z/!]/.test(src[i + 1] || '')) {
      let j = i + 1, q = '';
      while (j < src.length) { const c = src[j]; if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; j++; }
      const tag = src.slice(i, j + 1);
      const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let a;
      while ((a = re.exec(tag))) {
        const name = a[1].toLowerCase();
        if (!['title', 'aria-label', 'placeholder', 'alt', 'label'].includes(name)) continue;
        const vs = i + a.index + a[0].indexOf(a[2]) + 1;
        push('attr:' + name, vs, vs + (a[3] ?? a[4]).length);
      }
      i = j + 1; continue;
    }
    const n = src.indexOf('<', i + 1); const e = n < 0 ? src.length : n; push('html-text', i, e); i = e;
  }
  return out;
}

// (S) 정적 검사: 위반 목록과 쓰인 허용 항목을 돌려준다.
function staticScan(src) {
  const bad = [], usedText = new Set(), usedJs = new Set();
  for (const s of segments(src)) {
    if (/base64,/.test(s.text)) continue;
    const found = badOf(s.text);
    if (!found.length) continue;
    if (s.kind === 'html-text' && ALLOW_TEXT.has(s.text.trim())) { usedText.add(s.text.trim()); continue; }
    if (s.kind === 'js-str' || s.kind === 'js-tpl') {
      const ln = lineAt(src, s.start);
      const hit = ALLOW_JS.findIndex(([mark, lit]) => s.text === lit && ln.includes(mark));
      if (hit >= 0) { usedJs.add(hit); continue; }
    }
    bad.push(`${lineOf(src, s.start)}줄 ${s.kind} [${found.join(', ')}] ${JSON.stringify(s.text.trim().slice(0, 140))}`);
  }
  return { bad, usedText, usedJs };
}

function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다(문구가 바뀌었다면 앵커를 갱신할 것): ' + find.slice(0, 120));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 120));
  return text.slice(0, a) + repl + text.slice(a + find.length);
}

test('(S) 보이는 글(마크업, 속성, 스크립트 문자열)에 엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점이 없다', () => {
  const { bad } = staticScan(app);
  assert.ok(bad.length === 0, `금지 기호가 보이는 글에 ${bad.length}곳 있다. 마침표, 쉼표, 괄호, 콜론, 작은따옴표로 바꿀 것(korean-ai-punct P1~P3):\n  ` + bad.slice(0, 40).join('\n  '));
});
test('(S) 허용 목록이 낡지 않았다(쓰이지 않는 항목이 없다)', () => {
  const { usedText, usedJs } = staticScan(app);
  const staleT = [...ALLOW_TEXT.keys()].filter((k) => !usedText.has(k));
  const staleJ = ALLOW_JS.filter((_, i) => !usedJs.has(i)).map(([mark, lit]) => mark + ' ' + lit);
  assert.deepStrictEqual([...staleT, ...staleJ], [], '허용 목록에 더는 없는 글이 남았다. 지울 것');
});
test('(S) 분해기가 주석은 건너뛰고 보이는 글은 잡는다(자기 점검)', () => {
  const probe = '<p title="가 — 나">본문</p><!-- 주석 — 무시 --><script>// 주석 — 무시\n/* 블록 「무시」 */ toast(\'저장 · 실패\'); const t = `${a}「x」`; const r = /—/;</script><p>직급·소속</p>';
  const { bad } = staticScan(probe);
  assert.strictEqual(bad.length, 3, '속성, 작은따옴표 문자열, 템플릿 문자열 세 곳만 걸려야 한다: ' + bad.join(' | '));
});
test('변이(S): 보이는 토스트 문구에 「 를 넣으면 (S)가 잡는다', () => {
  const m = mutate(app, "toast('읽기 전용 보기라 여기서는 지울 수 없습니다', 'info')", "toast('「읽기 전용」 보기라 여기서는 지울 수 없습니다', 'info')");
  assert.ok(staticScan(m).bad.some((b) => /낫표/.test(b)), '보이는 토스트에 낫표를 넣었는데 (S)가 잡지 못했다');
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom: 실제 앱을 위젯 모드로 띄워 주요 창을 연다
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('ui-copy-punct: jsdom 미설치. 창을 열어 보이는 글을 검사하지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const ME = { loginId: 'phmin', name: '박현민', title: '수석연구원', orgUnit: 'SW 3팀' };
  const EMPTY = { categories: [{ id: 'c1', name: '시험 과제', color: '#3b82f6' }], entries: [], todos: [], rooms: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '' };
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const ORG = { found: true, admin: true,
    titles: [{ name: '수석', sort: 10, active: true, users: 1 }, { name: '선임', sort: 20, active: true, users: 0 }],
    units: [{ orgId: 1, name: '회사', parentId: null, depth: 0, sort: 10, active: true, users: 0, children: 1 },
            { orgId: 2, name: 'SW 1팀', parentId: 1, depth: 1, sort: 20, active: true, users: 1, children: 0 }] };
  const MEMBERS = { found: true, admin: true, includeInactive: false, units: [{ orgId: 2, name: 'SW 1팀', parentId: null, depth: 0 }], titles: [{ name: '수석' }],
    members: [{ userId: 1, loginId: 'phmin', name: '박현민', title: '수석', orgId: 2, orgName: 'SW 1팀', active: true, sort: 1 },
              { userId: 2, loginId: 'kim', name: '김철수', title: '수석', orgId: 2, orgName: 'SW 1팀', active: true, sort: 2 }] };
  function boot(src) {
    const posted = [], errors = [];
    const vc = new jsdomMod.VirtualConsole();
    vc.on('jsdomError', (e) => errors.push(String(e && (e.stack || e.message) || e)));
    const dom = new JSDOM(src, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tcapp.local/', virtualConsole: vc,
      beforeParse(win) {
        win.chrome = { webview: { postMessage: (s) => posted.push(String(s)), addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: (a) => a };
        win.scrollTo = () => {};
        win.HTMLElement.prototype.scrollIntoView = function () {};
      },
    });
    const w = dom.window;
    w.eval(`window.__calls = [];
      hostRequest = function(cmd, p){ __calls.push(cmd);
        if(cmd === 'orgTitleGet') return Promise.resolve({ ok: true, data: ${JSON.stringify(ORG)} });
        if(cmd === 'membersGet' || cmd === 'userAdminGet') return Promise.resolve({ ok: true, data: ${JSON.stringify(MEMBERS)} });
        if(cmd === 'userInfoGet') return Promise.resolve({ ok: true, info: { loginId: 'phmin', name: '박현민', role: 'admin' } });
        return Promise.resolve({ ok:false, msg:'시험: 회신 없음' }); };`);
    const sess = posted.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).find((m) => m && m.cmd === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: ME }) + ')');
    w.eval('currentUser = ' + JSON.stringify(ME));
    w.__applyState(JSON.stringify(EMPTY), {});
    w.eval('dbOnline = true;');
    w.eval('window.__toasts = []; (function(){ var t = toast; toast = function(m, k, a, ms){ __toasts.push(String(m)); return t(m, k, a, ms); }; })();');
    return { w, doc: w.document, errors, ev: (c) => w.eval(c), close: () => { try { w.close(); } catch (_) {} } };
  }
  //  한 뿌리 아래의 보이는 글(스크립트·스타일 제외, 보고서 머리기호 선택지 제외)과 속성을 모아 위반을 돌려준다.
  function scanDom(B, root, where) {
    const bad = [];
    if (!root) return [`${where}: 뿌리를 찾지 못했다`];
    const walker = B.doc.createTreeWalker(root, B.w.NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const p = n.parentElement;
      if (!p || p.closest('script,style,template')) continue;
      if (p.closest('#rptMarker') && ALLOW_TEXT.has(n.nodeValue.trim())) continue;
      const f = badOf(n.nodeValue);
      if (f.length) bad.push(`${where} 글 [${f.join(', ')}] ${JSON.stringify(n.nodeValue.trim().slice(0, 120))}`);
    }
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const a of ['title', 'aria-label', 'placeholder', 'alt']) {
        const v = el.getAttribute && el.getAttribute(a);
        if (v && badOf(v).length) bad.push(`${where} ${a} [${badOf(v).join(', ')}] ${JSON.stringify(v.slice(0, 120))}`);
      }
    }
    return bad;
  }
  const closeAll = async (B) => { B.ev("document.querySelectorAll('.overlay').forEach(function(o){ if(isOverlayOpen(o)) closeOverlay(o); }); try{ pkClose(false); }catch(_){}"); await settle(220); };
  const SCREENS = [
    ['도움말', 'openHelp()', '#helpModal'],
    ['사용설명서', 'openGuide()', '#guideModal'],
    ['패치노트', 'openPatch()', '#patchModal'],
    ['설정', 'openSettings()', '#settingsModal'],
    ['내 과제', 'openCatModal()', '#categoryModal'],
    ['보고서', 'openReport()', '#reportModal'],
    ['사용자 정보', 'openUserInfo()', '#userModal'],
    ['문의', 'openFeedback()', '#feedbackModal'],
    ['공식 과제', 'openOfficialModal()', '#officialModal'],
    ['⚙ 관리 구성원', "openAdminHub('members')", '#adminHub'],
    ['⚙ 관리 직급', "openAdminHub('title')", '#adminHub'],
    ['⚙ 관리 소속', "openAdminHub('unit')", '#adminHub'],
    ['⚙ 관리 휴지통(사람)', "openAdminHub('gone')", '#adminHub'],
    ['⚙ 관리 발주처', "openAdminHub('cust')", '#adminHub'],
    ['⚙ 관리 구분', "openAdminHub('section')", '#adminHub'],
    ['⚙ 관리 상태', "openAdminHub('status')", '#adminHub'],
  ];
  async function sweep(src) {
    const B = boot(src);
    const bad = [];
    try {
      bad.push(...scanDom(B, B.doc.querySelector('header') || B.doc.body, '첫 화면'));
      if (badOf(B.doc.title).length) bad.push('창 제목 ' + JSON.stringify(B.doc.title));
      B.ev("document.getElementById('btnMore').click()"); await settle(60);
      bad.push(...scanDom(B, B.doc.getElementById('moreMenu'), '⋯ 메뉴'));
      B.ev("document.getElementById('moreMenu').classList.add('hidden')");
      for (const [name, open, sel] of SCREENS) {
        await closeAll(B);
        try { B.ev(open); } catch (e) { bad.push(`${name}: 열기 실패 ${String(e.message || e).slice(0, 120)}`); continue; }
        await settle(160);
        bad.push(...scanDom(B, B.doc.querySelector(sel), name));
      }
      await closeAll(B);
      B.ev("pkOpen('top', document.getElementById('btnPeerPick'))"); await settle(160);
      bad.push(...scanDom(B, B.doc.getElementById('peerPicker'), '다른 사람 일정 고르기'));
      await closeAll(B);
      B.ev("showLoginGate(true, '')"); await settle(40);
      bad.push(...scanDom(B, B.doc.getElementById('loginGate'), '로그인 화면'));
      //  마지막으로 문서 전체(숨은 창 포함, JS 가 그린 글 포함)와 그동안 뜬 토스트
      bad.push(...scanDom(B, B.doc.body, '문서 전체'));
      for (const t of JSON.parse(B.ev('JSON.stringify(__toasts)'))) if (badOf(t).length) bad.push('토스트 ' + JSON.stringify(t));
      return { bad: [...new Set(bad)], errors: B.errors };
    } finally { B.close(); }
  }

  test('(R) 주요 창을 연 화면의 보이는 글, title, aria-label, placeholder 에 금지 기호가 없다', async () => {
    const r = await sweep(app);
    assert.ok(r.bad.length === 0, `창을 열어 보니 금지 기호가 ${r.bad.length}곳 있다:\n  ` + r.bad.slice(0, 40).join('\n  '));
  });
  test('변이(R): 도움말 카드 제목에 「 를 넣으면 (R)가 잡는다', async () => {
    const m = mutate(app, "card(ICON.git, '커밋 내역',", "card(ICON.git, '「커밋 내역」',");
    const r = await sweep(m);
    assert.ok(r.bad.some((b) => /^도움말 글 \[낫표/.test(b)), '도움말 카드에 낫표를 넣었는데 (R)가 잡지 못했다: ' + r.bad.slice(0, 5).join(' | '));
  });
}
