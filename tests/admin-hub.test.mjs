// 「⚙ 관리」 화면(관리자 허브) · 「내 과제」 이름 정정 — docs/ADMIN-HUB.md H1–H13 · 수용 R1–R9.
//
// 지키는 것:
//   (S) 정적 — 관리 화면 마크업(H1·H2: 머리 · 묶음 버튼 둘 role=tablist · 왼쪽 항목 4+5(ADMIN-HUB-4 N4) · 고르기 상자 · 위치 줄 · 빈 칸)과
//       자리(도킹 대상 모달들보다 **앞** — 안에서 뜨는 확인창·편집 폼이 그 위에 쌓인다) · B′ CSS(선택 = accent 한 가지 ·
//       안 고른 쪽 채움 없음 · 왼쪽 목록 바탕 = --panel · hex 없음) · 테마 5종 토큰 대비 · 「내 과제」 이름(H10 · 사용자에게
//       보이는 문자열에 「과제 관리」가 남지 않는다 — 패치노트·주석 제외) · 새 호스트 명령 없음(H13).
//   (R) jsdom — R1 구조·묶음/항목 전환·위치 줄 / R2 계산 스타일(B′) / R3 일곱 항목이 **기존 모달 그 자체**로 도킹 · 겹침 없음 ·
//       단독 호출 호환 / R4 기억(마지막 · 묶음별 · 계정별 · 이상값) / R5 입구 ①②③(관리자만 · 공개 문 유지) /
//       R6 공식 과제 창 하단 관리 버튼 → 관리 화면 / R7 「내 과제」 / R9 키보드·포커스·Esc·inert.
//   (M) 변이 — 도킹 창을 스택에 올리기 · openModal 의 도킹 판정 빼기 · 관리자 확인 없이 ☰ 메뉴 — 각각 잡힌다.
//
// ★ R8(좁은 창 — 실제 레이아웃)·R10(실 DB)·R11(실 위젯 캡처)은 레이아웃·실 호스트가 있어야 한다 →
//   tests/loop-admin-hub.mjs(수동 · 실 위젯) + 실 위젯 캡처. jsdom 은 @media 와 var() 를 계산하지 않는다 —
//   그래서 R2 는 '계산된 선언값이 어떤 토큰인가'를 보고, 토큰 값은 이 파일이 CSS 원문에서 테마별로 풀어 대비를 잰다.
// 생략 규약: jsdom 이 없으면 (R)과 그에 기대는 변이는 **등록되지 않고** skip(판정 없음)으로 계수된다(러너 exit 2).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';
import { readFileSync } from 'node:fs';

const app = loadAppSource();

function mutate(text, find, repl) {
  const a = text.indexOf(find);
  assert.ok(a >= 0, '변이 앵커를 찾지 못했다(리팩터로 사라졌다면 앵커를 갱신할 것): ' + find.slice(0, 120));
  assert.strictEqual(a, text.lastIndexOf(find), '변이 앵커가 여러 곳에 있다: ' + find.slice(0, 120));
  const out = text.slice(0, a) + repl + text.slice(a + find.length);
  assert.notStrictEqual(out, text, '변이가 원본을 바꾸지 못했다');
  return out;
}
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
const body = (src, fn) => stripJsComments(extractFunction(src, fn));
function styleOf(src) {
  const s = src.indexOf('<style>'), e = src.indexOf('</style>', s);
  assert.ok(s >= 0 && e > s, '<style> 블록을 찾지 못함');
  return src.slice(s + 7, e).replace(/\/\*[\s\S]*?\*\//g, '');
}
const cssRules = (src) => [...styleOf(src).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const ruleOf = (src, sel) => {
  const r = cssRules(src).filter((x) => x.sel === sel);
  assert.ok(r.length >= 1, `CSS 규칙 ${sel}{…} 이 없다`);
  return r.map((x) => x.body).join(';');
};
const AH_FNS = ['ahPress', 'ahMe', 'ahItemOfOv', 'ahIsAdmin', 'ahNoteRole', 'ahProbe', 'ahProbeIfUnknown', 'ahSyncEntries', 'ahPaintWho',
  'ahKey', 'ahLast', 'ahLastIn', 'ahRemember', 'ahCount', 'ahSyncFoot', 'ahCounts', 'ahFillSel', 'ahMark', 'ahSyncEmpty', 'ahFocusTarget', 'ahFocusNav',
  'ahRouteOpen', 'ahDock', 'ahUndock', 'ahAfterClose', 'ahCloseNow', 'openAdminHub', 'ahSelect', 'ahOpenFromMore', 'setupAdminHub'];
//  ★ 2026-10-06(docs/ADMIN-HUB-4.md N4) — 직급·소속 · 구분·상태를 각각의 항목으로 갈랐다(7 → 9). 두 항목이 같은 모달을 도킹한다.
//  ★ 2026-10-21(docs/SHARED-ROOMS.md 가안): 새 묶음 🗓 일정에 항목 하나(회의실)를 더했다(9 → 10).
const ITEMS = ['members', 'title', 'unit', 'gone', 'projects', 'cust', 'section', 'status', 'trash', 'rooms'];
const OV_OF = { members: 'userAdminModal', title: 'orgTitleModal', unit: 'orgTitleModal', gone: 'trashModal', projects: 'officialModal', cust: 'customerModal',
  section: 'codeModal', status: 'codeModal', trash: 'trashModal', rooms: 'roomAdminModal' };

// ══════════════════════════════════════════════════════════════════════
// (S) 정적 계약
// ══════════════════════════════════════════════════════════════════════
function hubMarkup(src) {
  const s = src.indexOf('<div class="overlay hidden" id="adminHub">');
  assert.ok(s >= 0, '#adminHub 오버레이가 없다(.overlay 여야 Esc·배경·모달 스택이 이 화면을 안다)');
  const e = src.indexOf('<div class="overlay hidden" id="categoryModal">', s);
  assert.ok(e > s, '#adminHub 뒤의 #categoryModal 경계를 찾지 못함');
  return src.slice(s, e);
}
const S = {
  structure(src) {
    const m = hubMarkup(src);
    assert.match(m, /<h2>⚙ 관리<\/h2><span class="ah-who" id="ahWho"><\/span>/, '머리 「⚙ 관리」 + 관리자·이름 자리(H1)');
    assert.match(m, /<button class="x" data-close aria-label="닫기">×<\/button>/, '머리 ✕');
    assert.match(m, /<div class="ah-seg" id="ahSeg" role="tablist" aria-label="관리 묶음">/, '묶음 버튼 줄이 tablist 가 아니다(H1)');
    const tabs = [...m.matchAll(/<button type="button" role="tab" id="(\w+)" data-ahgrp="(\w+)"[^>]*>([\s\S]*?)<\/button>/g)];
    assert.deepStrictEqual(tabs.map((t) => t[2]), ['people', 'proj', 'sched'], '묶음 버튼은 사람, 회사 과제, 일정 셋이다(SHARED-ROOMS 가안)');
    assert.ok(/👥[\s\S]*사람[\s\S]*직원, 조직, 직급/.test(tabs[0][3]), '👥 사람(직원, 조직, 직급)');
    assert.ok(/📁[\s\S]*회사 과제[\s\S]*공식 과제 원본\(DB\)과 기준 정보/.test(tabs[1][3]), '📁 회사 과제(공식 과제 원본(DB)과 기준 정보)');
    assert.ok(/🗓[\s\S]*일정[\s\S]*모든 사용자가 쓰는 공용 목록/.test(tabs[2][3]), '🗓 일정(모든 사용자가 쓰는 공용 목록)');
    const items = [...m.matchAll(/data-ahitem="(\w+)"[^>]*><span class="ah-ic" aria-hidden="true">([^<]+)<\/span>([^<]+)<span class="ah-n" id="ahN\1"><\/span>/g)]
      .map((x) => [x[1], x[2], x[3]]);
    //  ★ 2026-10-02(ADMIN-HUB-3 M2·M3) — 두 휴지통의 이름은 「🗑 휴지통」 하나다(예전: 「🚪 퇴사자」 · 「🗑 삭제된 항목」).
    //    묶음(👥 사람 / 📁 회사 과제)이 가른다 · 항목 id(gone · trash)는 그대로(기억·루프가 그 id 로 고른다).
    assert.deepStrictEqual(items, [['members', '👤', '구성원'], ['title', '🏷', '직급'], ['unit', '🏢', '소속'], ['gone', '🗑', '휴지통'],
      ['projects', '📁', '공식 과제'], ['cust', '🏭', '발주처'], ['section', '🗂️', '구분'], ['status', '🔖', '상태'], ['trash', '🗑', '휴지통'], ['rooms', '🚪', '회의실']], '항목 10개와 순서(H2, ADMIN-HUB-4 N4, SHARED-ROOMS)');
    assert.ok(/<div class="ah-navgrp hidden" data-ahnavgrp="sched">/.test(m), '처음엔 일정 묶음의 항목도 숨어 있다');
    assert.ok(/<div class="ah-navgrp hidden" data-ahnavgrp="proj">/.test(m), '처음엔 사람 묶음의 항목만 보인다');
    assert.match(m, /<select id="ahSel" aria-label="관리 항목"><\/select>/, '좁은 창 고르기 상자(H11)');
    assert.match(m, /<div class="ah-where" id="ahWhere"/, '위치 줄(H3)');
    assert.match(m, /<div class="ah-slot" id="ahSlot"><div class="set-hint ah-empty hidden" id="ahEmpty">[^<]+<\/div><\/div>/,
      '오른쪽 칸은 빈 자리여야 한다 — 화면을 새로 만들지 않는다(H4)');
    for (const dead of ['id="uaList"', 'id="otList"', 'id="trList"', 'id="offList"', 'id="custList"', 'id="codeList"']) {
      assert.ok(!m.includes(dead), `관리 화면 마크업에 ${dead} 사본이 있다 — 같은 화면이 두 벌이면 하나는 낡는다(H4)`);
    }
  },
  //  도킹 대상보다 앞 — 도킹된 창 안에서 뜨는 확인창·편집 폼이 이 화면 위에 쌓인다(.overlay 는 DOM 순서가 쌓임 순서)
  position(src) {
    const hub = src.indexOf('id="adminHub"');
    for (const id of ['officialModal', 'officialEditModal', 'customerModal', 'codeModal', 'roomAdminModal', 'userAdminModal', 'userEditModal', 'orgTitleModal', 'trashModal', 'confirmModal', 'confirmTypedModal']) {
      const at = src.indexOf(`<div class="overlay hidden" id="${id}">`);
      assert.ok(at > hub, `#${id} 가 #adminHub 보다 앞에 있다 — 관리 화면 안에서 연 창이 그 뒤에 뜬다`);
    }
  },
  bPrimeCss(src) {
    const seg = ruleOf(src, '.ah-seg button'), segOn = ruleOf(src, '.ah-seg button.on');
    assert.match(seg, /background-color:transparent/, '안 고른 묶음 버튼은 채움이 없다(B′)');
    assert.match(seg, /border:1\.5px solid var\(--line-2\)/);
    assert.match(segOn, /background-color:var\(--accent-soft\)/, '고른 묶음 = accent-soft 채움');
    assert.match(segOn, /border-color:var\(--accent\)/, '고른 묶음 = accent 테두리');
    assert.match(ruleOf(src, '.ah-seg button.on .ah-gt'), /color:var\(--accent-2\)/, '고른 묶음 글자 = accent 계열');
    assert.match(ruleOf(src, '.ah-gic'), /filter:grayscale\(1\)/, '안 고른 묶음 아이콘 = 흑백');
    assert.match(ruleOf(src, '.ah-seg button.on .ah-gic'), /filter:none/, '고른 묶음 아이콘 = 컬러');
    assert.match(ruleOf(src, '.ah-nav'), /background-color:var\(--panel\)/, '왼쪽 목록 바탕 = 패널색(회색 바탕 금지)');
    assert.match(ruleOf(src, '.ah-pane'), /background-color:var\(--panel\)/, '오른쪽 내용도 같은 패널색');
    assert.match(ruleOf(src, '.ah-navlbl'), /color:var\(--accent-2\)/, '왼쪽 목록 맨 위 묶음 이름 = accent');
    const navOn = ruleOf(src, '.ah-nav button.on');
    assert.match(navOn, /background-color:var\(--accent-soft\)/);
    assert.match(navOn, /box-shadow:inset 3px 0 0 var\(--accent\)/, '고른 항목 = 왼쪽 accent 막대');
    assert.match(navOn, /color:var\(--accent-2\)/);
    assert.match(ruleOf(src, '.ah-nav button'), /background-color:transparent/, '안 고른 항목은 채움이 없다');
    //  ★ 회색 토큰을 상태(.on / 기본)에 쓰지 않는다 — hover 만 예외(손 아래 표시)
    const state = cssRules(src).filter((r) => /^\.ah-(seg|nav)/.test(r.sel) && !/:hover/.test(r.sel));
    const grey = state.filter((r) => /var\(--(hover-bg|dim-bg|bg|fill|line|line-2)\)/.test((/background(-color)?:[^;]*/.exec(r.body) || [''])[0]));
    assert.deepStrictEqual(grey.map((r) => r.sel), [], '선택/비선택 상태 규칙에 회색 바탕 토큰이 있다');
    const rules = cssRules(src).filter((r) => /\.ah-|#adminHub|\.cat-title|\.cat-sub|\.cat-admin-row|#usMembersSec\.ah-admin/.test(r.sel));
    assert.ok(rules.length >= 30, '관리 화면 규칙을 찾지 못했다: ' + rules.length);
    const hex = rules.filter((r) => /#[0-9a-f]{3,8}\b/i.test(r.body)).map((r) => r.sel);
    assert.deepStrictEqual(hex, [], '관리 화면 규칙에 hex 색이 있다(토큰만 — 5종 테마는 리맵으로 따라온다)');
  },
  dockCss(src) {
    const d = ruleOf(src, '#adminHub .ah-slot > .overlay.docked');
    assert.match(d, /position:absolute/); assert.match(d, /inset:0/); assert.match(d, /background-color:transparent/, '도킹 창에 자기 배경막이 있다');
    const m = ruleOf(src, '#adminHub .ah-slot > .overlay.docked > .modal');
    assert.match(m, /box-shadow:none/, '도킹 창에 그림자가 있다(창 위의 창)'); assert.match(m, /border-radius:0/); assert.match(m, /max-height:none/);
    assert.match(ruleOf(src, '#adminHub .ah-slot > .overlay.docked .modal-head > .x,#adminHub .ah-slot > .overlay.docked .modal-foot [data-close]'), /display:none/,
      '도킹 창의 × · [닫기] 가 남는다 — 관리 화면의 ✕ 하나가 대신한다');
  },
  rename(src) {
    assert.match(src, /<button class="btn icon has-label" id="btnCatsTop" title="내 과제: [^"]+" aria-label="내 과제">🏷️<\/button>/, '툴바 버튼(H10)');
    assert.match(src, /set\('btnCatsTop', label\(ICON\.tag, '내 과제'\)\);/, '툴바 라벨(applyIcons)');
    assert.match(src, /<button id="btnCatsFold">내 과제<\/button>/, '⋯ 접기 항목');
    assert.match(src, /<h2>🏷️ 내 과제<\/h2><span class="cat-sub">내 캘린더에서 쓰는 과제\(색, 순서, 버전관리 연동\)<\/span>/, '모달 제목 + 부제');
    //  사용자에게 보이는 문자열에 옛 이름이 남지 않는다 — 패치노트(역사 기록)·주석은 제외.
    const ps = src.indexOf('<div class="overlay hidden" id="patchModal">'), pe = src.indexOf('<div class="overlay hidden" id="updNotesModal">');
    assert.ok(ps > 0 && pe > ps, '패치노트 경계');
    const visible = (src.slice(0, ps) + src.slice(pe)).replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
    const left = visible.split('\n').filter((l) => l.includes('과제 관리'));
    assert.deepStrictEqual(left, [], '「과제 관리」가 사용자에게 보이는 자리에 남았다(H10)');
    assert.ok(/card\(ICON\.tag, '내 과제', '헤더의 내 과제 버튼/.test(extractFunction(src, 'openHelp')), '사용설명서 카드(#helpModal)');
  },
  noNewHostCommand(src) {
    const calls = AH_FNS.flatMap((fn) => [...body(src, fn).matchAll(/hostRequest\(\s*'([^']+)'/g)].map((m) => m[1]));
    assert.deepStrictEqual([...new Set(calls)], ['userInfoGet'], '관리 화면 구역의 호스트 요청은 기존 읽기 명령 userInfoGet 뿐이어야 한다(H13)');
    const posts = AH_FNS.flatMap((fn) => [...body(src, fn).matchAll(/hpost\(([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, '')));
    assert.deepStrictEqual(posts, [], '관리 화면 구역이 호스트로 직접 보낸다');
    //  ☰ 는 원래대로(J2 · ADMIN-HUB-2) — 위젯 창 설정 메뉴(호스트)를 열 뿐이다. 관리 입구는 ⋯ 메뉴(J1).
    assert.ok(/const b = ev\.target\.closest\('button\[data-host\]'\); if\(b\) hpost\(\{cmd:b\.dataset\.host\}\);/.test(extractFunction(src, 'buildHostBar')),
      '☰ 메시지가 원래({cmd:b.dataset.host})가 아니다');
    assert.ok(!/admin: true \}|__openAdminHub|hbAdminMenu/.test(src), '☰ 관리 입구(admin 플래그 · 호스트→웹 창구 · 웹 사전 메뉴)의 흔적이 남았다');
    for (const fn of AH_FNS) {
      const b = body(src, fn);
      assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(b), `${fn} 가 HTML 주입 API 를 쓴다 — 이름은 DB 문자열이다(H13)`);
      assert.ok(!/\bsave\s*\(|saveState|OpenAdmin/.test(b), `${fn} 가 저장·쓰기를 부른다`);
    }
    //  문 버튼 배선은 그대로다(H9 의 경로 바꾸기는 openModal 의 ahRouteOpen 한 곳) — 관문 호출을 늘리지 않는다.
    assert.ok(/\{ const b = \$\('#offTrash'\); if\(b\) b\.addEventListener\('click', \(\) => \{ offEditGuard\(\(\) => openTrash\('project'\)\); \}\); \}/.test(src));
    assert.ok(/if\(ahRouteOpen\(ov\)\) return;/.test(extractFunction(src, 'openModal')), 'openModal 이 도킹 판정을 하지 않는다(H4)');
  },
};
test('(정적) H1·H2: 관리 화면 마크업 — 머리 · 묶음 버튼 둘(tablist) · 항목 4+5 · 고르기 상자 · 위치 줄 · 빈 오른쪽 칸', () => S.structure(app));
test('(정적) H4: 관리 화면은 도킹 대상 모달·확인창보다 앞에 선다(안에서 연 창이 위에 쌓인다)', () => S.position(app));
test('(정적) H3·R2: B′ CSS — 선택은 accent 한 가지 · 안 고른 쪽 채움 없음 · 왼쪽 바탕 = 패널 · 회색 상태 없음 · hex 없음', () => S.bPrimeCss(app));
test('(정적) H4: 도킹 CSS — 자기 배경막·그림자·둥근 테두리·× ·[닫기] 를 걷는다', () => S.dockCss(app));
test('(정적) H10·R7: 「내 과제」 — 툴바 · ⋯ · 모달 제목·부제 · 사용설명서 · 보이는 문자열에 「과제 관리」 없음', () => S.rename(app));
test('(정적) H13: 새 호스트 명령 없음(userInfoGet · 호스트 메뉴뿐) · HTML 주입 없음 · 문 버튼 배선 그대로', () => S.noNewHostCommand(app));

//  테마 5종 대비(R11 의 토큰 몫) — 선택 글자(--accent-2 / --accent-soft) ≥ 4.5 · 막대·테두리(--accent / --panel) ≥ 3 ·
//   안 고른 글자(--muted / --panel) ≥ 4.5. 테마 블록은 :root 를 덮어쓰는 리맵이라 :root 값 위에 겹쳐 푼다.
function themeTokens(src) {
  const css = styleOf(src);
  const block = (re) => { const m = re.exec(css); assert.ok(m, '테마 블록을 못 찾음: ' + re); return Object.fromEntries([...m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);?/g)].map((x) => [x[1], x[2].trim()])); };
  const root = block(/:root\{([^}]*)\}/);
  return {
    light: root,
    dark: { ...root, ...block(/html\.dark\{([^}]*)\}/) },
    forest: { ...root, ...block(/:root\[data-theme="forest"\]\{([^}]*)\}/) },
    sepia: { ...root, ...block(/:root\[data-theme="sepia"\]\{([^}]*)\}/) },
    contrast: { ...root, ...block(/:root\[data-theme="contrast"\]\{([^}]*)\}/) },
  };
}
function lum(hex) {
  let h = String(hex).replace('#', '').trim(); if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  assert.ok(/^[0-9a-f]{6}$/i.test(h), '색 값이 hex 가 아니다: ' + hex);
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
//   ★ 테두리·막대는 **바깥 패널**과 맞닿는 경계다(1.4.11 — 인접색은 --panel). 자기 채움(--accent-soft)과의 대비는 보지 않는다:
//     선택은 채움 + 테두리 + 글자 셋이 함께 말하고, 포레스트는 accent/accent-soft 가 2.9 라 그 기준이면 테마 토큰을 바꿔야 한다(범위 밖).
test('(정적) H13·R11: 테마 5종 — 고른 글자 accent-2/accent-soft ≥ 4.5 · 막대 accent/panel ≥ 3 · 흐린 글자 muted/panel ≥ 4.5', () => {
  const T = themeTokens(app);
  for (const [name, t] of Object.entries(T)) {
    assert.ok(ratio(t['accent-2'], t['accent-soft']) >= 4.5, `${name}: 고른 글자 대비 ${ratio(t['accent-2'], t['accent-soft']).toFixed(2)}`);
    assert.ok(ratio(t['accent-2'], t.panel) >= 4.5, `${name}: 묶음 이름(패널 위) 대비 ${ratio(t['accent-2'], t.panel).toFixed(2)}`);
    assert.ok(ratio(t.accent, t.panel) >= 3, `${name}: accent 막대/패널 ${ratio(t.accent, t.panel).toFixed(2)}`);
    assert.ok(ratio(t.muted, t.panel) >= 4.5, `${name}: 흐린 글자 ${ratio(t.muted, t.panel).toFixed(2)}`);
    assert.notStrictEqual(t['accent-soft'].toLowerCase(), t['hover-bg'].toLowerCase(), `${name}: 선택 채움이 hover 회색과 같다`);
  }
});

// ══════════════════════════════════════════════════════════════════════
// (R) jsdom
// ══════════════════════════════════════════════════════════════════════
const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;

if (!JSDOM) {
  skip('admin-hub: jsdom 미설치 — 관리 화면 실행 계약을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const ME = { loginId: 'phmin', name: '박현민', title: '수석연구원', orgUnit: 'SW 3팀' };
  const EMPTY = { categories: [], entries: [], todos: [], rooms: [], taskHours: {}, attendance: {}, gitAuthor: '', svnAuthor: '' };
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const FADE = 200;   // MD_OUT(120ms) 페이드보다 넉넉히
  //  회신 본보기 — 각 화면이 실제로 그릴 만큼만.
  const ROSTER = { found: true, admin: true, includeInactive: false, units: [], titles: [],
    members: [{ userId: 11, loginId: 'zzA', name: 'zzA_가', title: '선임', orgUnit: 'SW 1팀', isActive: true },
              { userId: 12, loginId: 'zzB', name: 'zzB_나', title: '책임', orgUnit: 'SW 2팀', isActive: true }] };
  const ORG = { found: true, admin: true,
    titles: [{ name: '수석', sort: 10, active: true, users: 1 }, { name: '선임', sort: 20, active: true, users: 1 }],
    units: [{ orgId: 1, name: '회사', parentId: null, depth: 0, sort: 10, active: true, users: 0, children: 1 },
            { orgId: 2, name: 'SW 1팀', parentId: 1, depth: 1, sort: 20, active: true, users: 1, children: 0 }] };
  const TRASH = { found: true, admin: true,
    projects: [{ key: 'zzP1', name: 'zzP 과제', sub: '', refs: 0, deletable: true, why: '' }],
    users: [{ key: '31', name: 'zzU_퇴사', sub: 'SW 1팀', refs: 0, deletable: true, why: '' }],
    customers: [], sections: [], statuses: [] };
  const REP = {
    membersGet: { ok: true, data: ROSTER },
    orgTitleGet: { ok: true, data: ORG },
    trashGet: { ok: true, data: TRASH },
    loadCustomersFull: { ok: true, list: JSON.stringify([{ name: 'zzC_데마시아', active: true }, { name: 'zzC_셔마야', active: true }]) },
    getCodesFull: { ok: true, list: JSON.stringify([{ name: '일반계약', active: true, sort: 1 }, { name: '연구과제', active: true, sort: 2 }]) },
    roomsFull: { ok: true, msg: '', list: JSON.stringify([{ id: 1, name: '대회의실', sort: 10 }, { id: 2, name: '소회의실 A', sort: 20 }]) },
  };
  const INFO = (role, active = 1) => ({ ok: true, info: { name: ME.name, title: ME.title, org_unit: ME.orgUnit, view_scope: 'all', edit_role: role, is_active: active } });

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
    const B = {
      w, posted, errors, doc: w.document,
      ev: (c) => w.eval(c),
      evJSON: (c) => JSON.parse(w.eval('JSON.stringify(' + c + ')')),
      close: () => { try { w.close(); } catch (_) {} },
    };
    w.eval(`window.__calls = []; window.__rep = {};
      hostRequest = function(cmd, p){ __calls.push([cmd, JSON.parse(JSON.stringify(p || {}))]);
        var r = __rep[cmd];
        if(r === 'pending') return new Promise(function(){});
        if(r === undefined || r === 'fail') return Promise.resolve({ ok:false, msg:'시험: 회신 없음' });
        return Promise.resolve(JSON.parse(JSON.stringify(r))); };`);
    const sess = posted.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).find((m) => m && m.cmd === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.reqId) + ', ' + JSON.stringify({ ok: true, user: ME }) + ')');
    w.eval('currentUser = ' + JSON.stringify(ME));
    w.__applyState(JSON.stringify(EMPTY), {});
    w.eval('dbOnline = true;');   // 관문(offEditGuard: 위젯·온라인)을 지나게 — 지금 그 문들과 같은 조건
    return B;
  }
  const $ = (B, s) => B.doc.querySelector(s);
  const hub = (B) => B.doc.getElementById('adminHub');
  const isOpen = (B, id) => B.ev(`isOverlayOpen(document.getElementById(${JSON.stringify(id)}))`);
  const stack = (B) => B.evJSON('_modalStack.map(function(s){ return s.ov.id; })');
  const opened = (B) => B.evJSON('openOverlays().map(function(o){ return o.id; })');
  const calls = (B, cmd) => B.evJSON('__calls').filter((c) => !cmd || c[0] === cmd);
  const docked = (B) => B.ev("(function(){ var d = document.querySelectorAll('#ahSlot > .overlay.docked'); return [].map.call(d, function(o){ return o.id; }).join(','); })()");
  const where = (B) => $(B, '#ahWhere').textContent.replace(/\s+/g, ' ').trim();
  const navOn = (B) => B.ev("(function(){ var b = document.querySelector('#ahNav [data-ahitem].on'); return b ? b.dataset.ahitem : ''; })()");
  const segOn = (B) => B.ev("(function(){ var b = document.querySelector('#ahSeg [data-ahgrp].on'); return b ? b.dataset.ahgrp : ''; })()");
  const active = (B) => { const a = B.doc.activeElement; return a ? (a.id || (a.dataset && (a.dataset.ahitem || a.dataset.ahgrp || a.dataset.hbm || a.dataset.host)) || a.tagName) : ''; };
  const key = (B, el, k, opt = {}) => el.dispatchEvent(new B.w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opt }));
  const cs = (B, sel, prop) => B.w.getComputedStyle($(B, sel))[prop];
  const LS = (B, k) => B.w.localStorage.getItem(k);
  //  닫으면 돌아갈 자리 — 관리 화면의 스택 항목이 쥔 opener(H12). ★ jsdom 은 레이아웃이 없어 offsetParent 가 늘 null 이라
  //   _onModalClosed 의 '아직 보이는가' 판정을 지나지 못한다 → 실제 포커스 이동은 실 위젯(loop-admin-hub)이 보고, 여기서는 그 자리를 본다.
  const backTo = (B) => B.ev("(function(){ var s = _modalStack.find(function(x){ return x.ov.id === 'adminHub'; }); var o = s && s.opener; return o ? (o.id || (o.dataset && o.dataset.host) || o.tagName) : ''; })()");
  async function reset(B, { admin = true } = {}) {
    B.ev(`(function(){
      if(isOverlayOpen(document.getElementById('adminHub'))) closeOverlay(document.getElementById('adminHub'));
      return 1; })()`);
    await settle(FADE);
    B.ev(`(function(){ document.querySelectorAll('.overlay').forEach(function(o){ o.classList.remove('closing'); o.classList.add('hidden'); });
      __calls.length = 0; __rep = ${JSON.stringify(REP)}; currentUser = ${JSON.stringify(ME)};
      __ahRole = { login: '', admin: null };
      __otData = null; __trData = null; __trAdmin = false; __uaAdmin = false; __uaMembers = []; return 1; })()`);
    for (const k of Object.keys(B.w.localStorage)) if (/^tc_admin(Last|Seen):/.test(k)) B.w.localStorage.removeItem(k);
    if (admin) B.ev('ahNoteRole(true)');
    await settle(FADE);
  }
  async function openHub(B, item = null) {
    B.ev(`openAdminHub(${JSON.stringify(item)})`);
    await settle(60);
  }
  async function pick(B, item) {
    $(B, `#ahNav [data-ahitem="${item}"]`).click();
    await settle(60);
  }

  let B = null;
  test('(R) 부팅: 위젯(HOST · 로그인 phmin)이 오류 없이 뜨고 관리 화면은 닫혀 있다 · 도킹된 창이 없다', () => {
    B = boot(app);
    assert.strictEqual(B.ev('HOST'), true);
    assert.strictEqual(isOpen(B, 'adminHub'), false);
    assert.strictEqual(docked(B), '');
    assert.deepStrictEqual(B.errors, [], '부팅 중 페이지 오류');
  });

  // ── R1 ──
  test('(R1) 구조: 열면 머리 「관리자 · 이름」 · 사람 묶음 선택 · 구성원 항목 · 위치 줄 「👥 사람 › 👤 구성원」', async () => {
    await reset(B);
    await openHub(B, 'members');
    assert.strictEqual(isOpen(B, 'adminHub'), true);
    assert.strictEqual($(B, '#ahWho').textContent, '관리자 박현민');
    assert.strictEqual(segOn(B), 'people');
    assert.strictEqual($(B, '#ahGrpPeople').getAttribute('aria-selected'), 'true');
    assert.strictEqual($(B, '#ahGrpProj').getAttribute('aria-selected'), 'false');
    assert.strictEqual(navOn(B), 'members');
    assert.strictEqual($(B, '#ahNav [data-ahitem="members"]').getAttribute('aria-current'), 'true');
    assert.strictEqual(where(B), '👥 사람 ›👤 구성원');
    assert.ok(!$(B, '[data-ahnavgrp="people"]').classList.contains('hidden') && $(B, '[data-ahnavgrp="proj"]').classList.contains('hidden'), '지금 묶음 항목만 보인다');
    assert.deepStrictEqual(B.evJSON("[].map.call(document.querySelectorAll('#ahSel option'), function(o){ return o.value; })"), ['members', 'title', 'unit', 'gone'], '고르기 상자 = 지금 묶음 항목만(H11)');
  });

  test('(R1) 전환: 묶음 버튼 → 그 묶음 첫(마지막) 항목 · 항목 버튼 → 그 항목 · 위치 줄·고르기 상자가 따라온다', async () => {
    $(B, '#ahGrpProj').click(); await settle(60);
    assert.strictEqual(segOn(B), 'proj'); assert.strictEqual(navOn(B), 'projects');
    assert.strictEqual(where(B), '📁 회사 과제 ›📁 공식 과제');
    assert.deepStrictEqual(B.evJSON("[].map.call(document.querySelectorAll('#ahSel option'), function(o){ return o.value; })"), ['projects', 'cust', 'section', 'status', 'trash']);
    await pick(B, 'status');
    assert.strictEqual(navOn(B), 'status'); assert.strictEqual(where(B), '📁 회사 과제 ›🔖 상태');
    assert.strictEqual($(B, '#ahSel').value, 'status');
    //  고르기 상자로도 바꾼다(좁은 창의 길)
    const sel = $(B, '#ahSel'); sel.value = 'cust'; sel.dispatchEvent(new B.w.Event('change', { bubbles: true })); await settle(60);
    assert.strictEqual(navOn(B), 'cust'); assert.strictEqual(docked(B), 'customerModal');
  });

  // ── R2 ──
  test('(R2) 계산 스타일(B′): 고른 묶음·항목만 accent-soft/accent · 안 고른 쪽 채움 없음 · 왼쪽 목록 바탕 = 패널', async () => {
    await reset(B); await openHub(B, 'title');
    assert.strictEqual(cs(B, '#ahGrpPeople', 'backgroundColor'), 'var(--accent-soft)');
    assert.match(cs(B, '#ahGrpPeople', 'borderColor') || cs(B, '#ahGrpPeople', 'borderTopColor'), /var\(--accent\)/);
    assert.match(cs(B, '#ahGrpProj', 'backgroundColor'), /^(transparent|rgba\(0, 0, 0, 0\))$/, '안 고른 묶음에 채움이 있다');
    assert.notStrictEqual(cs(B, '#ahGrpProj', 'backgroundColor'), 'var(--hover-bg)');
    assert.strictEqual(cs(B, '#ahGrpPeople .ah-gt', 'color'), 'var(--accent-2)');
    assert.strictEqual(cs(B, '#ahGrpProj .ah-gt', 'color'), 'var(--muted)');
    assert.strictEqual(cs(B, '#ahNav', 'backgroundColor'), 'var(--panel)', '왼쪽 목록 바탕이 패널색이 아니다');
    assert.strictEqual(cs(B, '#ahNav', 'backgroundColor'), cs(B, '.ah-pane', 'backgroundColor'), '왼쪽 목록 바탕 ≠ 오른쪽 내용 바탕');
    assert.strictEqual(cs(B, '#ahNav [data-ahitem="title"]', 'backgroundColor'), 'var(--accent-soft)');
    assert.match(cs(B, '#ahNav [data-ahitem="title"]', 'boxShadow'), /var\(--accent\)/, '고른 항목의 왼쪽 막대');
    assert.strictEqual(cs(B, '#ahNav [data-ahitem="title"]', 'color'), 'var(--accent-2)');
    for (const it of ['members', 'gone']) {
      assert.match(cs(B, `#ahNav [data-ahitem="${it}"]`, 'backgroundColor'), /^(transparent|rgba\(0, 0, 0, 0\))$/, `안 고른 항목 ${it} 에 채움이 있다`);
      assert.ok(!/accent/.test(cs(B, `#ahNav [data-ahitem="${it}"]`, 'boxShadow') || ''), `안 고른 항목 ${it} 에 막대가 있다`);
    }
    assert.strictEqual(cs(B, '.ah-navgrp:not(.hidden) .ah-navlbl', 'color'), 'var(--accent-2)', '목록 맨 위 묶음 이름 = accent');
  });

  // ── R3 ──
  test('(R3) 열 항목 = 기존 모달 그 자체(같은 id · 같은 목록) · 오른쪽 칸에 도킹 · 스택엔 관리 화면 하나(겹침 없음)', async () => {
    await reset(B); await openHub(B, 'members');
    const LIST = { members: '#userAdminModal #uaList', title: '#orgTitleModal #otList', unit: '#orgTitleModal #otList', gone: '#trashModal #trList', projects: '#officialModal #offList',
      cust: '#customerModal #custList', section: '#codeModal #codeList', status: '#codeModal #codeList', trash: '#trashModal #trList', rooms: '#roomAdminModal #raList' };
    for (const it of ITEMS) {
      await pick(B, it);
      await settle(40);
      assert.strictEqual(navOn(B), it);
      assert.strictEqual(docked(B), OV_OF[it], `${it}: 오른쪽 칸의 창이 ${docked(B)} 다`);
      const ov = B.doc.getElementById(OV_OF[it]);
      assert.strictEqual(ov.parentElement.id, 'ahSlot', `${it}: #${OV_OF[it]} 가 칸 안에 있지 않다`);
      assert.ok(!ov.classList.contains('hidden'), `${it}: 도킹 창이 숨어 있다`);
      assert.ok($(B, LIST[it]), `${it}: 기존 선택자 ${LIST[it]} 가 풀리지 않는다`);
      assert.deepStrictEqual(stack(B), ['adminHub'], `${it}: 모달 스택에 관리 화면 말고 다른 창이 있다 — 창 위에 창(${stack(B)})`);
      assert.deepStrictEqual(opened(B), ['adminHub', OV_OF[it]], `${it}: 열린 오버레이가 관리 화면 + 도킹 창이 아니다`);
      assert.strictEqual(ov.querySelector('.modal').getAttribute('role'), 'region', `${it}: 도킹 창이 아직 대화상자로 선다`);
      assert.strictEqual(B.w.getComputedStyle(ov.querySelector('.modal-head > .x')).display, 'none', `${it}: 도킹 창의 × 가 보인다`);
      assert.ok(!$(B, '#ahEmpty') || $(B, '#ahEmpty').classList.contains('hidden'), `${it}: 빈 칸 안내가 떠 있다`);
      //  다른 창은 제자리(body)로 돌아가 있다
      for (const o of new Set(Object.values(OV_OF))) {
        if (o === OV_OF[it]) continue;
        const e = B.doc.getElementById(o);
        assert.ok(e.parentElement === B.doc.body && !e.classList.contains('docked') && e.classList.contains('hidden'), `${it}: #${o} 가 제자리로 돌아가지 않았다`);
      }
    }
    //  아래 줄이 숨긴 [닫기] 하나뿐이면 접힌다(휴지통) · 내용이 있으면 선다(구성원 편집의 「＋ 직원 등록」)
    await pick(B, 'trash'); await settle(120);
    assert.ok($(B, '#trashModal .modal-foot').classList.contains('ah-foot-empty'), '휴지통의 빈 아래 줄이 접히지 않았다');
    //  내용이 실제로 그 화면의 것이다(회신이 그 목록에 앉았다)
    await pick(B, 'members'); await settle(120);
    assert.ok(!$(B, '#userAdminModal .modal-foot').classList.contains('ah-foot-empty'), '「＋ 직원 등록」이 있는 아래 줄이 접혔다');
    assert.ok(/zzA_가/.test($(B, '#uaList').textContent), '구성원 목록이 칸 안에 그려지지 않았다');
    assert.ok($(B, '#uaFoot #uaNew') || /직원 등록/.test($(B, '#userAdminModal').textContent), '구성원 편집의 등록 버튼이 없다(관리자 회신)');
    assert.deepStrictEqual(calls(B).map((c) => c[0]).filter((c) => c !== 'userInfoGet'),
      //  사람 휴지통(gone)은 trashGet 과 함께 직급·소속 화면의 조회(orgTitleGet)를 그대로 한 번 더 한다 — 소속·직급 탭(ADMIN-HUB-3 M3 · 새 명령 없음).
      //  직급 · 소속 · 구분 · 상태는 각각 그 탭으로 같은 화면의 조회를 한다(ADMIN-HUB-4 N4 — 새 명령 없음).
      //  회의실(SHARED-ROOMS)은 자기 화면의 조회(roomsFull) 하나다. 그 뒤 휴지통을 다시 고르면 trashGet 이 한 번 더 간다.
      ['membersGet', 'orgTitleGet', 'orgTitleGet', 'orgTitleGet', 'trashGet', 'loadCustomersFull', 'getCodesFull', 'getCodesFull', 'trashGet', 'roomsFull', 'trashGet', 'membersGet'], '각 항목이 자기 화면의 조회를 그대로 한다(새 명령 없음)');
  });

  test('(R3) 제자리: 관리 화면을 닫으면 도킹 창은 원래 형제 순서로 돌아가고, 단독 호출(openUserAdmin)은 지금처럼 단독으로 뜬다', async () => {
    const order0 = B.evJSON("[].filter.call(document.body.children, function(e){ return e.classList && e.classList.contains('overlay'); }).map(function(e){ return e.id; })");
    B.ev("closeOverlay(document.getElementById('adminHub'))"); await settle(FADE);
    assert.strictEqual(isOpen(B, 'adminHub'), false); assert.strictEqual(docked(B), '');
    const order1 = B.evJSON("[].filter.call(document.body.children, function(e){ return e.classList && e.classList.contains('overlay'); }).map(function(e){ return e.id; })");
    assert.ok(order1.indexOf('userAdminModal') > order1.indexOf('membersModal') && order1.indexOf('orgTitleModal') > order1.indexOf('userEditModal'),
      '제자리 순서가 아니다: ' + order1.join(','));
    assert.ok(order0.length < order1.length || order0.length === order1.length - 1 || order1.includes('userAdminModal'));
    assert.strictEqual(B.ev("document.querySelectorAll('#ahSlot .overlay').length"), 0);
    B.ev('openUserAdmin()'); await settle(60);
    const ua = B.doc.getElementById('userAdminModal');
    assert.strictEqual(ua.parentElement, B.doc.body); assert.ok(!ua.classList.contains('docked'));
    assert.deepStrictEqual(stack(B), ['userAdminModal'], '단독 호출이 스택에 오르지 않았다');
    assert.strictEqual(ua.querySelector('.modal').getAttribute('role'), 'dialog');
    assert.strictEqual(B.doc.querySelectorAll('.modal-foot.ah-foot-empty').length, 0, '단독 모달에 접힘 표시가 남았다');
    B.ev("closeModal('#userAdminModal')"); await settle(FADE);
  });

  test('(R3) 닫기 길을 거치지 않고 .hidden 만 붙여 닫아도(루프의 closeAll) 도킹 창은 제자리로 — 다음 단독 호출이 숨은 관리 화면 안에서 열리지 않는다', async () => {
    await reset(B); await openHub(B, 'projects');
    B.ev("document.querySelectorAll('.overlay').forEach(function(o){ o.classList.remove('closing'); o.classList.add('hidden'); })");
    await settle(40);
    assert.strictEqual(docked(B), '', '숨긴 관리 화면 안에 도킹 창이 남았다');
    assert.strictEqual(B.doc.getElementById('officialModal').parentElement, B.doc.body);
    B.ev('openOfficialModal()'); await settle(40);
    assert.deepStrictEqual(stack(B), ['officialModal'], '단독 호출이 단독으로 뜨지 않았다');
    assert.ok(!B.doc.getElementById('officialModal').classList.contains('docked'));
  });

  test('(R3) 도킹 창의 [닫기]·closeModal 은 관리 화면 닫기다(빈 칸이 남지 않는다) · 안에서 연 확인창은 그 위에 쌓인다', async () => {
    await reset(B); await openHub(B, 'cust');
    B.ev("document.querySelector('#customerModal .modal-foot [data-close]').click()"); await settle(FADE);
    assert.strictEqual(isOpen(B, 'adminHub'), false, '도킹 창의 [닫기]가 관리 화면을 닫지 않았다');
    assert.strictEqual(docked(B), '');
    await openHub(B, 'cust');
    B.ev("closeModal('#customerModal')"); await settle(FADE);
    assert.strictEqual(isOpen(B, 'adminHub'), false, 'closeModal(도킹 창)이 관리 화면을 닫지 않았다');
    await openHub(B, 'cust');
    B.ev("confirmBox('확인', '본문', '확인', '취소')"); await settle(40);
    assert.deepStrictEqual(stack(B), ['adminHub', 'confirmModal'], '확인창이 관리 화면 위에 쌓이지 않았다');
    assert.ok(B.ev("document.getElementById('confirmModal').parentElement === document.body"), '확인창이 칸 안으로 들어갔다');
  });

  // ── R4 ──
  test('(R4) 기억: 다시 열면 마지막 항목 · 묶음을 바꾸면 그 묶음의 마지막 항목 · 계정별 키 · 이상값 → 구성원', async () => {
    await reset(B); await openHub(B, null);
    assert.strictEqual(navOn(B), 'members', '처음은 구성원');
    await pick(B, 'gone');
    $(B, '#ahGrpProj').click(); await settle(60);
    await pick(B, 'section');
    assert.strictEqual(LS(B, 'tc_adminLast:phmin'), 'section');
    assert.strictEqual(LS(B, 'tc_adminLast:phmin:people'), 'gone');
    assert.strictEqual(LS(B, 'tc_adminLast:phmin:proj'), 'section');
    $(B, '#ahGrpPeople').click(); await settle(60);
    assert.strictEqual(navOn(B), 'gone', '사람 묶음으로 돌아오면 그 묶음에서 마지막 항목(퇴사자)');
    $(B, '#ahGrpProj').click(); await settle(60);
    assert.strictEqual(navOn(B), 'section');
    B.ev("closeOverlay(document.getElementById('adminHub'))"); await settle(FADE);
    await openHub(B, null);
    assert.strictEqual(navOn(B), 'section', '다시 열면 마지막 항목');
    B.ev("closeOverlay(document.getElementById('adminHub'))"); await settle(FADE);
    //  계정별 — 다른 계정은 자기 기억(없으면 구성원)
    B.ev("currentUser = { loginId:'other', name:'다른이' }; ahNoteRole(true);");
    await openHub(B, null);
    assert.strictEqual(navOn(B), 'members', '다른 계정이 phmin 의 기억을 이어받았다');
    B.ev("closeOverlay(document.getElementById('adminHub'))"); await settle(FADE);
    //  ★ 계정을 되돌리면 관리자 여부도 그 계정 것으로 다시 알린다 — 관리 화면은 이번 실행에서 관리자로 확인된 계정에만 열린다(2026-10-06 관문).
    B.ev(`currentUser = ${JSON.stringify(ME)}; ahNoteRole(true);`);
    //  이상값 → 구성원 · 묶음 키 이상값 → 그 묶음 첫 항목
    B.w.localStorage.setItem('tc_adminLast:phmin', 'zz<script>');
    B.w.localStorage.setItem('tc_adminLast:phmin:proj', 'members');
    await openHub(B, null);
    assert.strictEqual(navOn(B), 'members', '이상값이면 구성원');
    $(B, '#ahGrpProj').click(); await settle(60);
    assert.strictEqual(navOn(B), 'projects', '묶음 키가 다른 묶음 항목이면 그 묶음 첫 항목');
  });

  // ── R5 ──
  //  ☰ 이 보낸 'menu' 메시지들(그 시점 이후) — ☰ 는 위젯 창 설정(호스트 네이티브 메뉴)이다. J2: 언제나 {cmd:'menu'} 하나.
  const menuMsgs = (B, from) => B.posted.slice(from).map((s) => JSON.parse(s)).filter((m) => m.cmd === 'menu');
  const shown = (B, sel) => { const e = $(B, sel); return !!e && B.w.getComputedStyle(e).display !== 'none' && !e.closest('.hidden'); };
  async function openMore(B) { const b = $(B, '#btnMore'); b.focus(); b.click(); await settle(); }

  test('(R1·J1) 입구: 관리자 확인 전에는 ⋯ 메뉴에 「⚙ 관리」가 없다 · 내 과제 버튼 없음 · ☰ 는 {cmd:"menu"} 그대로', async () => {
    await reset(B, { admin: false });
    await openMore(B);
    assert.ok(!$(B, '#moreMenu').classList.contains('hidden'), '전제: ⋯ 메뉴가 열렸다');
    assert.ok($(B, '#mmAdmin').classList.contains('hidden'), '모르는데 ⋯ 메뉴에 「⚙ 관리」가 보인다');
    B.ev("document.getElementById('moreMenu').classList.add('hidden')");
    const before = B.posted.length;
    $(B, '#hostbar button[data-host="menu"]').click(); await settle();
    assert.deepStrictEqual(menuMsgs(B, before), [{ cmd: 'menu' }], '☰ 메시지가 지금과 다르다');
    B.ev('openCatModal()'); await settle(40);
    assert.ok($(B, '#catAdminRow').classList.contains('hidden'), '관리자 확인 전에 내 과제의 관리 버튼이 보인다');
    assert.ok(!$(B, '#btnOfficialOpen').classList.contains('hidden'), '「공식 과제 찾아보기」는 모두에게 그대로');
    B.ev("closeModal('#categoryModal')"); await settle(FADE);
  });

  test('(R1·J1) ⋯ 메뉴: 관리자면 「⚙ 관리 · 관리자」가 「설정」 바로 위(구분선) · 누르면 ⋯ 를 닫고 마지막 항목 · 닫으면 ⋯ 로 포커스', async () => {
    await reset(B);
    //  ★ 옛 기억값(orgtitle)을 그대로 둔다 — 별칭으로 「직급」을 연다(ADMIN-HUB-4 N5).
    B.w.localStorage.setItem('tc_adminLast:phmin', 'orgtitle');
    await openMore(B);
    assert.ok(shown(B, '#btnAdminHub'), '관리자인데 ⋯ 메뉴에 「⚙ 관리」가 없다');
    assert.ok(/^⚙ 관리\s*관리자$/.test($(B, '#btnAdminHub').textContent.trim()), '문구: ' + $(B, '#btnAdminHub').textContent);
    const mm = $(B, '#mmAdmin');
    assert.strictEqual(mm.nextElementSibling && mm.nextElementSibling.id, 'btnSettings', '「⚙ 관리」가 「설정」 바로 위가 아니다');
    assert.ok(mm.querySelector('hr'), '「⚙ 관리」와 앱 기능 사이 구분선이 없다');
    $(B, '#btnAdminHub').click(); await settle(60);
    assert.ok($(B, '#moreMenu').classList.contains('hidden'), '관리 화면이 열렸는데 ⋯ 메뉴가 남았다(#appSurface 안이라 inert 를 물려받는다)');
    assert.strictEqual(isOpen(B, 'adminHub'), true);
    assert.strictEqual(navOn(B), 'title', '⋯ 입구는 마지막 항목(옛 값 orgtitle → 직급 · N5)');
    assert.strictEqual(active(B), 'title', '열면 고른 항목 버튼에 포커스(H12)');
    assert.strictEqual(backTo(B), 'btnMore', '닫으면 ⋯ 버튼으로 돌아가야 한다');
    assert.deepStrictEqual(stack(B), ['adminHub']);
    //  관리자가 아니라는 회신 → 다음 ⋯ 부터 없다 · 기억도 지운다
    B.ev("closeOverlay(document.getElementById('adminHub'))"); await settle(FADE);
    B.ev('ahNoteRole(false)');
    await openMore(B);
    assert.ok($(B, '#mmAdmin').classList.contains('hidden'), '관리자 아님 회신 뒤에도 ⋯ 에 「⚙ 관리」가 남았다');
    assert.strictEqual(LS(B, 'tc_adminSeen:phmin'), null);
    B.ev("document.getElementById('moreMenu').classList.add('hidden')");
  });

  test('(R1·J1) ⋯ 를 열 때 권한을 모르면 조용히 묻고(userInfoGet), 관리자 회신이면 열린 메뉴에 곧바로 「⚙ 관리」가 선다', async () => {
    await reset(B, { admin: false });
    B.ev(`__rep.userInfoGet = ${JSON.stringify(INFO('admin'))}`);
    await openMore(B); await settle(40);
    assert.ok(calls(B, 'userInfoGet').length >= 1, '⋯ 를 열었는데 권한을 묻지 않았다');
    assert.ok(shown(B, '#btnAdminHub'), '관리자 회신 뒤 열린 ⋯ 메뉴에 「⚙ 관리」가 서지 않았다');
    assert.strictEqual(LS(B, 'tc_adminSeen:phmin'), '1');
    B.ev("document.getElementById('moreMenu').classList.add('hidden')");
  });

  test('(R2·J2) ☰ 원복: 관리자여도 ☰ = {cmd:"menu"} 만(admin 필드 없음) · 웹 쪽 메뉴·호스트→웹 창구(__openAdminHub) 없음 · C# 메뉴는 그대로', async () => {
    await reset(B);
    const before = B.posted.length;
    $(B, '#hostbar button[data-host="menu"]').click(); await settle();
    assert.deepStrictEqual(menuMsgs(B, before), [{ cmd: 'menu' }], '관리자인데 ☰ 메시지에 무엇이 더 실렸다');
    assert.strictEqual(B.doc.querySelector('[role="menu"]'), null);
    assert.strictEqual(B.ev('typeof window.__openAdminHub'), 'undefined', '쓰는 곳이 없는 호스트→웹 창구가 남았다');
    assert.strictEqual(isOpen(B, 'adminHub'), false);
    const cs = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
    assert.match(cs, /case "menu": ShowSettingsMenu\(\); break;/, '호스트의 menu 처리가 원래대로가 아니다');
    assert.ok(/private void ShowSettingsMenu\(\)/.test(cs) && !/__openAdminHub|"⚙ 관리"/.test(cs), 'C# 에 「⚙ 관리」 메뉴 흔적이 남았다(J2 — 727f27b 이전과 바이트 동일해야 한다)');
  });

  test('(R4·J5) 사용자 정보 = 계정 · 권한 · 로그아웃뿐 — 구성원 줄(보기·편집)·「⚙ 관리」 카드 없음(관리자 회신이어도) · 권한 회신은 ⋯ 입구에 반영', async () => {
    await reset(B, { admin: false });
    B.ev(`__rep.userInfoGet = ${JSON.stringify(INFO('admin'))}`);
    $(B, '#btnUser').focus(); $(B, '#btnUser').click(); await settle(60);
    assert.strictEqual(isOpen(B, 'userModal'), true);
    for (const id of ['usMembersSec', 'usMembers', 'usUserAdmin', 'usMemberBtns', 'usHubSec', 'usHubOpen', 'usHubMembers']) {
      assert.strictEqual(B.doc.getElementById(id), null, `사용자 정보에 #${id} 가 남았다(J5)`);
    }
    for (const id of ['usInfoBlock', 'usPermSec', 'usEditRole', 'usViewScope', 'usPermReload', 'usLogout']) assert.ok(B.doc.getElementById(id), `#${id} 가 사라졌다 — 계정·권한·로그아웃은 그대로`);
    assert.strictEqual(B.doc.getElementById('usEditRole').textContent, '관리자(추가, 수정, 삭제)');
    assert.strictEqual(LS(B, 'tc_adminSeen:phmin'), '1', '권한 회신이 입구 판정에 반영되지 않았다');
    B.ev("closeModal('#userModal')"); await settle(FADE);
    await openMore(B);
    assert.ok(shown(B, '#btnAdminHub'), '사용자 정보의 관리자 회신이 ⋯ 입구에 반영되지 않았다');
    B.ev("document.getElementById('moreMenu').classList.add('hidden')");
    //  비활성 관리자는 관리자가 아니다
    B.ev(`__rep.userInfoGet = ${JSON.stringify(INFO('admin', 0))}`);
    B.ev('openUserInfo()'); await settle(60);
    assert.strictEqual(LS(B, 'tc_adminSeen:phmin'), null, '비활성 계정을 관리자로 기억했다');
    B.ev("closeModal('#userModal')"); await settle(FADE);
  });

  test('(R5) 입구 ③: 내 과제 — 관리자만 「⚙ 공식 과제 편집은 관리에서 ›」(관리자 꼬리표) · 누르면 내 과제를 닫고 공식 과제 항목', async () => {
    await reset(B);
    $(B, '#btnCatsTop').focus(); $(B, '#btnCatsTop').click(); await settle(40);
    assert.strictEqual(isOpen(B, 'categoryModal'), true);
    const row = $(B, '#catAdminRow');
    assert.ok(!row.classList.contains('hidden'), '관리자인데 버튼이 없다');
    assert.ok(/⚙ 공식 과제 편집은 관리에서 ›\s*관리자/.test($(B, '#btnCatAdmin').textContent));
    $(B, '#btnCatAdmin').click(); await settle(60);
    assert.strictEqual(isOpen(B, 'categoryModal'), false, '내 과제가 관리 화면 밑에 남았다');
    assert.strictEqual(navOn(B), 'projects'); assert.strictEqual(docked(B), 'officialModal');
    assert.deepStrictEqual(stack(B), ['adminHub']);
    assert.strictEqual(backTo(B), 'btnCatsTop', '닫으면 「내 과제」 버튼으로');
  });

  // ── R3(ADMIN-HUB-2) · J3 — 찾아보기(단독 공식 과제)는 모두에게 읽기 전용 · 도킹은 편집 가능 ──
  const ZZCAT = { id: 'db-zz1', name: 'zz과제', color: '#3e5be0', source: 'db', customer: 'zzC', section: '일반계약', status: '진행중',
    startDate: '2026-01-01', endDate: '2026-12-31', devEndDate: '', projectName: 'zz과제', contractName: '', commonName: 'zz과제' };
  test('(R3·J3) 찾아보기(내 과제 → 공식 과제 · 단독)는 관리자여도 읽기 전용 — 새 공식 과제·편집/숨김·하단 관리 버튼 없음 · 「캘린더에 추가」·새로고침·닫기는 그대로', async () => {
    await reset(B);
    B.ev(`dbCatalog = [${JSON.stringify(ZZCAT)}];`);
    $(B, '#btnCatsTop').focus(); $(B, '#btnCatsTop').click(); await settle(40);
    $(B, '#btnOfficialOpen').focus(); $(B, '#btnOfficialOpen').click(); await settle(40);
    B.ev("offSelect('db-zz1')"); await settle();
    assert.deepStrictEqual(stack(B), ['categoryModal', 'officialModal'], '전제: 내 과제 위에 공식 과제(단독)');
    for (const sel of ['#offNew', '#officialModal .off-d-act', '#offCustMgr', '#offCodeMgr', '#offTrash']) {
      assert.ok($(B, sel), `전제: ${sel} 노드는 남아 있다(배선·시험 호환)`);
      assert.strictEqual(B.w.getComputedStyle($(B, sel)).display, 'none', `찾아보기에 쓰기 컨트롤 ${sel} 가 보인다(J3)`);
    }
    assert.ok($(B, '#offDetail [data-offedit]') && $(B, '#offDetail [data-offhide]'), '전제: 상세의 편집/숨김 버튼 노드');
    assert.ok($(B, '#offDetail [data-offadd]'), '「캘린더에 추가」가 사라졌다');
    assert.notStrictEqual(B.w.getComputedStyle($(B, '#offDetail [data-offadd]')).display, 'none', '「캘린더에 추가」가 숨었다');
    for (const sel of ['#offRefresh', '#officialModal .modal-foot [data-close]', '#offSearch', '#offReset']) assert.notStrictEqual(B.w.getComputedStyle($(B, sel)).display, 'none', `${sel} 가 숨었다`);
    B.ev("$('#offDetail [data-offadd]').click()"); await settle();
    assert.ok(B.ev("catIsSubscribed('db-zz1')"), '「캘린더에 추가」가 동작하지 않는다');
  });

  test('(R3·J3) 「⚙ 관리」에 도킹된 공식 과제는 편집 가능 — 새 공식 과제·편집/숨김 보임 · 하단 관리 버튼은 왼쪽 목록이 대신(숨김) · 그 버튼을 눌러도 항목만 바뀐다', async () => {
    await reset(B);
    B.ev(`dbCatalog = [${JSON.stringify(ZZCAT)}];`);
    await openHub(B, 'projects');
    B.ev("offSelect('db-zz1')"); await settle();
    assert.strictEqual(docked(B), 'officialModal');
    for (const sel of ['#offNew', '#officialModal .off-d-act']) assert.notStrictEqual(B.w.getComputedStyle($(B, sel)).display, 'none', `도킹된 공식 과제에 ${sel} 가 없다 — 편집은 여기서 한다`);
    for (const sel of ['#offCustMgr', '#offCodeMgr', '#offTrash']) assert.strictEqual(B.w.getComputedStyle($(B, sel)).display, 'none', `도킹 화면에 ${sel} 가 보인다 — 왼쪽 목록이 그 문이다`);
    $(B, '#offCodeMgr').click(); await settle(60);   // 프로그램으로 눌러도(시험·루프) 같은 관문 → 항목만 바뀐다
    assert.strictEqual(navOn(B), 'section'); assert.strictEqual(docked(B), 'codeModal'); assert.deepStrictEqual(stack(B), ['adminHub']);
  });

  test('(R6·H13) 관리자 확인 전에는 공식 과제 창 하단 버튼이 지금처럼 그 위에 뜬다(일반 사용자 화면 불변) · 관문(오프라인)은 그대로', async () => {
    await reset(B, { admin: false });
    B.ev('openOfficialModal()'); await settle(40);
    $(B, '#offCustMgr').click(); await settle(60);
    assert.strictEqual(isOpen(B, 'adminHub'), false);
    assert.deepStrictEqual(stack(B), ['officialModal', 'customerModal'], '일반 사용자의 동작이 바뀌었다');
    await reset(B);
    B.ev('dbOnline = false; openOfficialModal()'); await settle(40);
    $(B, '#offCustMgr').click(); await settle(60);
    assert.strictEqual(isOpen(B, 'adminHub'), false, '오프라인인데 관문을 지나 열렸다');
    assert.strictEqual(isOpen(B, 'customerModal'), false);
    B.ev('dbOnline = true;');
    //  관리 화면 안에서도 같은 관문 — 오프라인이면 그 항목은 열리지 않고 빈 칸 안내
    B.ev("closeModal('#officialModal')"); await settle(FADE);
    await openHub(B, 'members');
    B.ev('dbOnline = false;');
    await pick(B, 'cust');
    assert.strictEqual(docked(B), '', '오프라인인데 발주처가 열렸다');
    assert.ok(!$(B, '#ahEmpty').classList.contains('hidden'), '열지 못한 항목인데 빈 칸 안내가 없다');
    B.ev('dbOnline = true;');
  });

  // ── R7 ──
  test('(R7) 「내 과제」: 툴바 라벨·aria · ⋯ 접기 · 열면 「🏷️ 내 과제」 창(기능 그대로 — 과제 목록 · 찾아보기 카드)', async () => {
    await reset(B);
    const b = $(B, '#btnCatsTop');
    assert.strictEqual(b.getAttribute('aria-label'), '내 과제');
    assert.strictEqual(b.querySelector('.btn-label').textContent, '내 과제');
    assert.strictEqual($(B, '#btnCatsFold').textContent, '내 과제');
    $(B, '#btnCatsFold').click(); await settle(40);
    assert.strictEqual(isOpen(B, 'categoryModal'), true, '⋯ 접기 항목이 내 과제를 열지 않는다');
    assert.strictEqual($(B, '#categoryModal h2').textContent, '🏷️ 내 과제');
    assert.ok($(B, '#catList') && $(B, '#btnOfficialOpen') && $(B, '#btnCatSave'), '내 과제 창의 기능이 사라졌다');
    assert.strictEqual($(B, '#categoryModal .modal').getAttribute('aria-labelledby'), $(B, '#categoryModal h2').id);
  });

  // ── R9 ──
  test('(R9) 키보드: 왼쪽 목록 ↓/↑ 는 포커스만 · Enter/Space(누르기)로 고른다 · 묶음 ←/→ · 고른 뒤에도 포커스는 목록에', async () => {
    await reset(B); await openHub(B, 'members');
    assert.strictEqual(active(B), 'members', '열면 고른 항목 버튼에 포커스');
    key(B, B.doc.activeElement, 'ArrowDown');
    assert.strictEqual(active(B), 'title'); assert.strictEqual(navOn(B), 'members', '↓ 가 곧바로 골랐다(조회가 연달아 나간다)');
    key(B, B.doc.activeElement, 'ArrowDown'); key(B, B.doc.activeElement, 'ArrowDown'); key(B, B.doc.activeElement, 'ArrowDown');
    assert.strictEqual(active(B), 'members', '↓ 는 묶음 안에서 돈다');
    key(B, B.doc.activeElement, 'ArrowUp');
    assert.strictEqual(active(B), 'gone');
    key(B, B.doc.activeElement, 'End'); assert.strictEqual(active(B), 'gone');
    key(B, B.doc.activeElement, 'Home'); assert.strictEqual(active(B), 'members');
    key(B, B.doc.activeElement, 'ArrowDown');
    B.doc.activeElement.click(); await settle(60);   // Enter/Space = 버튼 누르기
    assert.strictEqual(navOn(B), 'title'); assert.strictEqual(active(B), 'title', '고른 뒤 포커스가 목록에서 빠졌다');
    await settle(60);
    assert.strictEqual(active(B), 'title', '도킹 창이 포커스를 가져갔다(왼쪽 목록에서 고르던 손을 뺏는다)');
    $(B, '#ahGrpPeople').focus();
    key(B, B.doc.activeElement, 'ArrowRight');
    assert.strictEqual(active(B), 'ahGrpProj'); assert.strictEqual(segOn(B), 'people', '→ 가 곧바로 골랐다');
    key(B, B.doc.activeElement, 'ArrowLeft'); assert.strictEqual(active(B), 'ahGrpPeople');
    $(B, '#ahGrpProj').click(); await settle(60);
    assert.strictEqual(segOn(B), 'proj');
    //  달력 단축키(←/→ 월 이동)가 관리 화면 뒤에서 돌지 않는다
    const v0 = B.evJSON('view');
    key(B, $(B, '#ahGrpProj'), 'ArrowLeft');
    assert.deepStrictEqual(B.evJSON('view'), v0, '관리 화면의 ← 가 달력을 움직였다');
  });

  test('(R9) 도킹 창 안의 문(#uaOrgTitle · #uaTrash)은 항목을 바꾸고, 포커스는 그 항목 버튼으로 온다(사라진 버튼에 남지 않는다)', async () => {
    await reset(B); await openHub(B, 'members');
    await settle(40);
    const ot = $(B, '#uaOrgTitle');
    assert.ok(ot, '전제: 관리자 회신의 「직급·소속 관리」');
    ot.focus(); ot.click(); await settle(60);
    assert.strictEqual(navOn(B), 'title', '「직급·소속 관리」(#uaOrgTitle)가 직급 항목으로 열리지 않았다(N4 — 그 문은 직급 탭으로 연다)'); assert.strictEqual(docked(B), 'orgTitleModal');
    assert.deepStrictEqual(stack(B), ['adminHub'], '「직급·소속 관리」가 그 위에 겹쳐 떴다');
    assert.strictEqual(active(B), 'title');
    await pick(B, 'members'); await settle(40);
    $(B, '#uaTrash').click(); await settle(60);
    assert.strictEqual(navOn(B), 'gone', '「휴지통」(#uaTrash)이 사람 휴지통 항목이 아니다'); assert.strictEqual(docked(B), 'trashModal');
    //  머리말은 두 문 모두 「휴지통」(ADMIN-HUB-3 M5 — 예전: 「퇴사자 휴지통」). 어느 쪽인지는 위치 줄·탭이 말한다.
    assert.strictEqual($(B, '#trTitle').textContent, '휴지통');
    assert.ok(/👥 사람/.test($(B, '#ahWhere').textContent) && /휴지통/.test($(B, '#ahWhere').textContent), `위치 줄이 「👥 사람 › 🗑 휴지통」이 아니다: ${JSON.stringify($(B, '#ahWhere').textContent)}`);
  });

  test('(R9) Esc: 관리 화면을 닫는다(안에 뜬 확인창이 있으면 그것부터) · 닫는 동안 inert 가 풀리고 칸 안 요소는 inert 를 물려받지 않는다', async () => {
    await reset(B); await openHub(B, 'members');
    assert.ok($(B, '#appSurface').hasAttribute('inert'), '관리 화면이 열렸는데 배경(#appSurface)이 잠기지 않았다');
    for (const sel of ['#adminHub', '#ahNav', '#userAdminModal', '#uaSearch', '#ahSeg']) {
      assert.strictEqual(B.ev(`(function(){ var e = document.querySelector(${JSON.stringify(sel)}); return !!(e && e.closest('[inert]')); })()`), false, `${sel} 가 inert 를 물려받았다`);
    }
    B.ev("confirmBox('확인', '본문', '확인', '취소')"); await settle(40);
    key(B, B.doc.body, 'Escape'); await settle(FADE);
    assert.strictEqual(isOpen(B, 'confirmModal'), false, 'Esc 가 확인창을 먼저 닫지 않았다');
    assert.strictEqual(isOpen(B, 'adminHub'), true, 'Esc 한 번에 관리 화면까지 닫혔다');
    //  포커스가 도킹 창 안에 있어도 Esc 는 관리 화면(도킹 창만 닫혀 빈 칸이 남지 않는다)
    $(B, '#uaSearch').focus();
    key(B, $(B, '#uaSearch'), 'Escape'); await settle(FADE);
    assert.strictEqual(isOpen(B, 'adminHub'), false, 'Esc 가 관리 화면을 닫지 않았다');
    assert.strictEqual(docked(B), '');
    assert.ok(!$(B, '#appSurface').hasAttribute('inert'), '닫았는데 inert 가 남았다');
    assert.strictEqual(B.ev("document.querySelectorAll('[inert]').length"), 0, '닫은 뒤 inert 요소가 남았다');
  });

  test('(R9) Tab 트랩은 관리 화면 전체(왼쪽 목록 ↔ 오른쪽 칸)다 — 도킹 창 안에 갇히지 않는다', async () => {
    await reset(B); await openHub(B, 'members');
    //  jsdom 은 레이아웃이 없어 _focusables(offsetParent) 가 비므로, 트랩의 '기준 창'을 직접 본다 — 스택 맨 위 = 관리 화면.
    assert.strictEqual(B.ev('_modalStack[_modalStack.length - 1].ov.id'), 'adminHub');
    assert.ok(B.ev("document.getElementById('adminHub').contains(document.getElementById('uaSearch')) && document.getElementById('adminHub').contains(document.getElementById('ahNav'))"),
      '왼쪽 목록과 오른쪽 칸이 한 트랩(관리 화면) 안에 있지 않다');
  });

  test('(R2·H2) 개수: 이미 받은 회신만(구성원 n명 · 직급 t · 소속 u · 사람 휴지통 n) — 개수를 얻으려고 묻지 않는다', async () => {
    await reset(B);
    B.ev('dbOnline = false;');
    await openHub(B, 'members'); await settle(120);
    assert.strictEqual($(B, '#ahNmembers').textContent, '2명');
    assert.strictEqual($(B, '#ahNtitle').textContent, '', '아직 안 연 직급의 개수를 지어냈다');
    assert.strictEqual($(B, '#ahNunit').textContent, '', '아직 안 연 소속의 개수를 지어냈다');
    assert.strictEqual($(B, '#ahNprojects').textContent, '', '오프라인인데 공식 과제 개수가 있다');
    const n0 = calls(B).length;
    await settle(150);
    assert.strictEqual(calls(B).length, n0, '개수를 얻으려고 조회가 나갔다');
    await pick(B, 'title'); await settle(120);
    //  직급 · 소속 — 같은 회신 하나에서 둘 다 센다(N4 · 소속을 열지 않아도 이미 받은 데이터다)
    assert.strictEqual($(B, '#ahNtitle').textContent, '2');
    assert.strictEqual($(B, '#ahNunit').textContent, '2');
    await pick(B, 'gone'); await settle(120);
    //  사람 휴지통 = 구성원 · 소속 · 직급 세 탭의 합(ADMIN-HUB-3 M3 — 회사 과제 휴지통과 같은 꼴: 숫자만). 이 본보기는 퇴사 1 · 숨긴 소속·직급 0.
    assert.strictEqual($(B, '#ahNgone').textContent, '1');
    assert.ok(/🗑 휴지통 \(1\)/.test(B.evJSON("[].map.call(document.querySelectorAll('#ahSel option'), function(o){ return o.textContent; })").join('|')), '고르기 상자에 개수가 없다');
    B.ev('dbOnline = true;');
  });

  // ── (M) 변이 ──
  test('(M) 변이: 도킹 창을 스택에 올리면(감시의 .docked 건너뛰기 제거) R3 의 「스택엔 관리 화면 하나」가 잡는다', async () => {
    const bad = mutate(app, "      if(ov.classList.contains('docked')) return;\n      const open = !ov.classList.contains('hidden');", "      const open = !ov.classList.contains('hidden');");
    const M = boot(bad);
    try {
      await reset(M); await openHub(M, 'cust');
      assert.notDeepStrictEqual(stack(M), ['adminHub'], '변이가 스택에 닿지 않았다');
    } finally { M.close(); }
  });
  test('(M) 변이: openModal 의 도킹 판정을 빼면 항목 창이 관리 화면 위에 겹쳐 뜬다(R3 이 잡는다)', async () => {
    const bad = mutate(app, '  if(ahRouteOpen(ov)) return;\n', '');
    const M = boot(bad);
    try {
      await reset(M); await openHub(M, 'cust');
      assert.strictEqual(docked(M), '', '변이인데 도킹됐다');
      assert.deepStrictEqual(stack(M), ['adminHub', 'customerModal'], '변이 앱에서 겹침이 재현되지 않았다');
    } finally { M.close(); }
  });
  test('(M) 변이: ⋯ 메뉴 「⚙ 관리」의 관리자 판정을 빼면 일반 사용자에게 보인다(R1 이 잡는다)', async () => {
    const bad = mutate(app, "if(mm) mm.classList.toggle('hidden', !on);", "if(mm) mm.classList.toggle('hidden', false);");
    const M = boot(bad);
    try {
      await reset(M, { admin: false });
      await openMore(M);
      assert.ok(!$(M, '#mmAdmin').classList.contains('hidden'), '변이가 ⋯ 메뉴에 닿지 않았다');
    } finally { M.close(); }
  });

  test('(R) 마무리: 시험 중 페이지 오류 없음', () => {
    assert.deepStrictEqual(B.errors, [], '페이지 오류');
    B.close();
  });
}
