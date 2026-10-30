// 과제 순서 설정(docs/CATEGORY-ORDER.md — R1~R9 · 수용 C1~C8)의 웹 쪽 계약.
//
// 이 파일이 지키는 것:
//   ① 「내 과제」 목록은 state.categories 를 **그 순서 그대로** 그린다(개인·공식 섞임 · 다시 묶지 않는다 — R1·C1).
//   ② 순서 바꾸기(2026-10-30 TASK-ADD-UX D3, D5): 줄마다 ▲▼ 버튼 대신 ⠿ 끌기(포인터 이벤트)와 ⋯ 메뉴의 순서 묶음
//      (위로, 아래로, 맨 위로, 맨 아래로). 끝(첫 줄의 위로·맨 위로, 마지막 줄의 아래로·맨 아래로)은 꺼져 있다.
//      ★ 2026-10-06(docs/ADMIN-HUB-4.md N3)의 ▲▼ 는 2026-10-30 에 ⋯ 메뉴로 모였다. ✥ 끌기(category-drag)는 그 전에 지웠다.
//      한 번 = 저장 1회(R2·C2, 여러 칸이어도). 관문(guardEdit) → 자리 옮김 → save() 순(R7·C6).
//   ③ 옮긴 뒤 목록을 다시 만들지 않는다(옮긴 줄 하나만 새 자리로, R3·C7). 메뉴로 옮겼으면 포커스는 그 줄의 ⋯.
//      반짝임과 자동 스크롤은 없다(D3). 낭독(#catLive)은 남는다.
//   ④ 같은 순서가 보고서 행·필터 막대·과제 선택 상자에 그대로 쓰인다(R4·C4·C5).
//      ★ 2026-10-07 기본 과제(docs/DEFAULT-TASKS.md §4.3) — R5(「기타」·미분류는 보고서 맨 뒤)를 지웠다. 기타도 목록의 한 과제라
//        정한 자리에 선다. 미분류 합성 행(__uncat__)도 없다. 아래 정적④·행동②③ 이 그 규칙이 되살아나면 실패한다.
//   ⑤ 저장 payload(saveState.state.categories)가 그 순서다 — 호스트는 배열 자리를 sort_order 로 쓴다(C3 의 웹 몫).
//
// 검사 함수를 테스트와 변이 시험이 공유한다 — 검사가 정말 잡는지 같은 함수를 변이된 소스에 다시 돌려 증명한다.
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from.slice(0, 80)}`);
  return out;
}
// JS 주석 제거(문자열·템플릿 리터럴은 보존) — 계약이 보는 것은 코드지 설명 글자가 아니다.
function stripJs(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === c) { j++; break; } j++; }
      out += s.slice(i, j); i = j; continue;
    }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}
const fnBody = (app, name) => stripJs(extractFunction(app, name));

//  변이 — 각각 '되돌아가면 안 되는 판'을 만든다.
const MUT = {
  //  개인 먼저·공식 뒤로 다시 묶던 옛 판(R1 위반)
  regroup: (s) => mutate(
    "list.innerHTML = has ? state.categories.map(c => catRowHtml(c)).join('') :",
    "list.innerHTML = has ? state.categories.filter(c => !isOfficialCat(c)).concat(state.categories.filter(isOfficialCat)).map(catRowHtml).join('') :",
    s),
  //  관문 없이 바로 바꾼다(R7 위반)
  noGuard: (s) => mutate(
    '  if(guardEdit()) return false;\n  const i = state.categories.findIndex(c => c.id === id);\n  const j = i + delta;',
    '  const i = state.categories.findIndex(c => c.id === id);\n  const j = i + delta;',
    s),
  //  한 번 옮기는데 두 번 저장한다(R2 위반)
  saveTwice: (s) => mutate(
    '  const t = state.categories.splice(i, 1)[0]; state.categories.splice(j, 0, t);\n  save();\n',
    '  const t = state.categories.splice(i, 1)[0]; state.categories.splice(j, 0, t);\n  save(); save();\n',
    s),
  //  좁은 목록 폭(380px 미만)에서 ⠿ 를 숨기지 않는다(D2: 좁으면 순서는 ⋯ 메뉴로)
  noNarrowHide: (s) => mutate(
    '  .cat-grip,.cat-head .ch-grip{display:none}\n',
    '',
    s),
  //  끝 막기를 지운다 — 맨 위에서 위로 = 배열 밖(-1)으로 빠진다(메뉴 끝 항목 계약의 데이터 쪽 짝)
  noEndStop: (s) => mutate(
    '  if(i < 0 || j === i || j < 0 || j >= state.categories.length) return false;',
    '  if(i < 0 || j === i) return false;',
    s),
  //  메뉴의 끝 항목을 끄지 않는다(첫 줄의 위로가 켜져 있다)
  noMenuEnds: (s) => mutate(
    "    + item('up', '위로', { off: i <= 0 }) + item('down', '아래로', { off: i >= last })",
    "    + item('up', '위로') + item('down', '아래로')",
    s),
  //  옮길 때 목록을 통째로 다시 그린다(R3 위반: 스크롤과 포커스가 날아간다)
  rerender: (s) => mutate(
    '  if(row){\n    const next = state.categories[j + 1];',
    '  if(false){\n    const next = state.categories[j + 1];',
    s),
  //  보고서 행을 이름순으로 정렬한다(R4 위반)
  sortReport: (s) => mutate(
    "    titles:items.get(c.id)||[], titleMeta:meta.get(c.id)||[], entries:bucket.get(c.id)||[] }));\n",
    "    titles:items.get(c.id)||[], titleMeta:meta.get(c.id)||[], entries:bucket.get(c.id)||[] }));\n  rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));\n",
    s),
  //  옛 R5 를 되살린다 — 「기타」 과제를 보고서 맨 뒤로(2026-10-07 에 지운 규칙)
  gitaLastBack: (s) => mutate(
    "    titles:items.get(c.id)||[], titleMeta:meta.get(c.id)||[], entries:bucket.get(c.id)||[] }));\n",
    "    titles:items.get(c.id)||[], titleMeta:meta.get(c.id)||[], entries:bucket.get(c.id)||[] }));\n  rows = rows.filter(r => String(r.name || '').trim() !== '기타').concat(rows.filter(r => String(r.name || '').trim() === '기타'));\n",
    s),
  //  옛 미분류 합성 행을 되살린다 — 과제 없는 기록을 '__uncat__' 버킷으로 모아 맨 뒤에 붙인다
  uncatBack: (s) => mutate(
    "  const catKey = e => e.categoryId || '';",
    "  const catKey = e => catById(e.categoryId) ? e.categoryId : '__uncat__';",
    mutate(
      "    titles:items.get(c.id)||[], titleMeta:meta.get(c.id)||[], entries:bucket.get(c.id)||[] }));\n",
      "    titles:items.get(c.id)||[], titleMeta:meta.get(c.id)||[], entries:bucket.get(c.id)||[] }));\n  if(items.has('__uncat__')) rows.push({ key:'__uncat__', name:'기타', color:'#5b6b7d', titles:items.get('__uncat__'), titleMeta:meta.get('__uncat__')||[], entries:bucket.get('__uncat__')||[] });\n",
      s)),
};

/* ── 정적 계약(jsdom 불필요) ─────────────────────────────────────────── */

const statics = {
  //  목록 = state.categories 그대로(다시 묶지 않는다 · 정렬하지 않는다). 옛 안내 한 줄(R8)은 D1 에서 없앴다(설명 문구 없음).
  listInRealOrder(app) {
    const b = fnBody(app, 'renderCatModal');
    assert.ok(/list\.innerHTML\s*=\s*has \? state\.categories\.map\(c => catRowHtml\(c\)\)/.test(b), 'renderCatModal 이 state.categories 를 그대로 그리지 않는다(R1)');
    assert.ok(!/isOfficialCat/.test(b), 'renderCatModal 이 공식/개인을 가른다 — 목록이 실제 순서와 갈린다(R1)');
    assert.ok(!/\.concat\(|\.sort\(|\.reverse\(/.test(b), 'renderCatModal 이 목록을 재배열한다(R1)');
    assert.ok(!app.includes('순서는 보고서·필터에 그대로 반영됩니다') && !/catOrderHint/.test(app), '없앤 안내 한 줄(#catOrderHint)이 되살아났다(D1)');
  },
  //  순서 바꾸기 화면 — 줄의 ▲▼ 는 없고 ⠿ 손잡이(마우스 전용) + ⋯ 메뉴의 순서 묶음(끝은 꺼짐). 반짝임·자동 스크롤 없음.
  orderUi(app) {
    const row = fnBody(app, 'catRowHtml');
    assert.ok(!/data-act="(up|down)"|▲|▼/.test(row), '줄에 ▲▼ 버튼이 남았다(D3)');
    assert.ok(/<span class="cat-grip" data-catgrip aria-hidden="true"/.test(row), '줄에 ⠿ 손잡이(data-catgrip, 마우스 전용 aria-hidden)가 없다(D3)');
    assert.ok(/data-catmore aria-haspopup="menu" aria-expanded="false" aria-label="\$\{nm\} 더 보기"/.test(row), '줄의 ⋯ 가 메뉴 버튼(aria-haspopup, aria-expanded, aria-label)이 아니다(D5)');
    const m = fnBody(app, 'catMenuHtml');
    assert.ok(m.includes("item('up', '위로', { off: i <= 0 }) + item('down', '아래로', { off: i >= last })")
      && m.includes("item('top', '맨 위로', { off: i <= 0 }) + item('bottom', '맨 아래로', { off: i >= last })"),
      '⋯ 메뉴의 순서 묶음(위로, 아래로, 맨 위로, 맨 아래로)이 없거나 끝 항목을 끄지 않는다(D3, D5)');
    assert.ok(/role="menuitem"/.test(m) && /' disabled'/.test(m), '메뉴 항목이 menuitem 이 아니거나 끝 항목이 disabled 가 아니다');
    const ro = fnBody(app, 'catReorder');
    assert.ok(!/scrollIntoView|catFlash|cat-flash/.test(ro) && !/catFlash|cat-flash|catDropFlash/.test(app), '옮긴 뒤 반짝임이나 자동 스크롤이 남았다(D3)');
    assert.ok(!/catGrip|data-act="grip"|cat-drop-slot|ICON\.move|catMoveBtnsHtml|catSyncMoveBtns|CAT_END_TIP/.test(app), '옛 ✥ 손잡이나 ▲▼ 코드가 남았다');
    //  끌기는 포인터 이벤트다(HTML5 끌어 놓기는 WebView2 와 자동화에서 동작이 달라 쓰지 않는다)
    const i = app.indexOf("list.addEventListener('pointerdown', ev => {"), j = app.indexOf("closest('[data-catgrip]')", i);
    assert.ok(i > 0 && j > i && j - i < 400, '⠿ 끌기가 포인터 이벤트(pointerdown → [data-catgrip])로 시작하지 않는다');
    const k = app.indexOf("const to = state.categories.findIndex(c => c.id === st.over);\n      if(to >= 0) catReorder(st.id, to);");
    assert.ok(k > 0 && i - k > 0 && i - k < 3000, '끌어 놓기가 catReorder(→ moveCategory)로 가지 않는다 — 저장 1회와 관문을 우회한다');
    assert.ok(!/draggable="true"|'dragstart'/.test(app.slice(app.indexOf('function catRowHtml'), app.indexOf('function catMenuHtml'))), '내 과제 목록이 HTML5 끌어 놓기를 쓴다');
  },
  //  관문 → 자리 옮김 → save() 1회 · 화면 쪽(catReorder)은 저장하지 않고 moveCategory 를 한 번 부른 뒤 줄을 옮긴다
  handlerOrder(app) {
    const b = fnBody(app, 'moveCategory');
    const g = b.indexOf('guardEdit()');
    const sw = b.indexOf('state.categories.splice(i, 1)');
    const sv = b.indexOf('save()');
    assert.ok(g > 0, 'moveCategory 에 연결 잠금 관문(guardEdit)이 없다(R7)');
    assert.ok(sw > g, 'moveCategory 가 관문보다 먼저 배열을 바꾼다(R7)');
    assert.ok(sv > sw, 'moveCategory 가 바꾸기 전에 저장한다');
    assert.strictEqual((b.match(/save\(\)/g) || []).length, 1, 'moveCategory 의 저장이 1회가 아니다(R2)');
    const ui = fnBody(app, 'catReorder');
    assert.ok(!/save\(\)|saveFull\(\)|dbSave\(/.test(ui), 'catReorder(화면 쪽)가 따로 저장한다 — 저장은 moveCategory 한 번이다');
    assert.ok(ui.indexOf('moveCategory(') > 0 && ui.indexOf('moveCategory(') < ui.indexOf('insertBefore'), 'catReorder 가 데이터보다 화면을 먼저 바꾼다(잠금 중에 화면만 움직인다)');
    assert.strictEqual((ui.match(/moveCategory\(/g) || []).length, 1, 'catReorder 가 moveCategory 를 여러 번 부른다 — 한 번 옮기는데 저장이 여러 번이 된다');
    const pk = fnBody(app, 'catMenuPick');
    for (const [act, to] of [['up', 'i - 1'], ['down', 'i + 1'], ['top', '0'], ['bottom', 'state.categories.length - 1']])
      assert.ok(pk.includes(`else if(act === '${act}') catReorder(id, ${to});`), `⋯ 메뉴의 ${act} 가 catReorder 로 가지 않는다`);
  },
  //  보고서 행 = state.categories 순서 그대로 — 이름순 정렬 없음, 「기타」 맨 뒤 규칙 없음, 미분류 합성 행 없음(2026-10-07)
  reportOrder(app) {
    const b = fnBody(app, 'collectReportData');
    assert.ok(/let rows = state\.categories\.map\(/.test(b), '보고서 행이 state.categories 순서에서 나오지 않는다(R4)');
    assert.ok(!/'기타'/.test(b), "collectReportData 가 '기타' 이름을 따로 다룬다 — 「기타」 맨 뒤 규칙이나 gitaCat 병합이 되살아났다(DEFAULT-TASKS §4.3)");
    assert.ok(!/__uncat__/.test(b) && !/uncat/i.test(b), '미분류 합성 행(__uncat__)이 되살아났다(DEFAULT-TASKS §4.3)');
    assert.ok(!/gitaCat/.test(b), '미분류를 기타 과제로 병합하는 gitaCat 이 되살아났다(DEFAULT-TASKS §4.3)');
    assert.ok(!/\.concat\(/.test(b.slice(b.indexOf('let rows = '))), '보고서 행 뒤에 다른 행을 이어 붙인다 — 목록 순서와 갈린다(R4)');
    assert.ok(!/rows\s*(=\s*rows\s*)?\.(slice\(\)\.)?sort\(/.test(b), '보고서 행을 정렬한다 — 목록 순서와 갈린다(R4)');
  },
  //  좁은 목록 폭(380px 미만) — ⠿ 를 숨기고 순서는 ⋯ 메뉴로(D2). 기준은 창이 아니라 목록 칸(#catWrap, container)의 폭이다.
  //  jsdom 은 레이아웃을 재지 못하므로 규칙을 잠근다. 머리글과 줄은 한 규칙의 열 폭을 쓴다(두 벌이면 열이 어긋난다).
  narrowGrip(app) {
    const css = app.slice(0, app.indexOf('</style>'));
    assert.ok(/\.cat-wrap\{container-type:inline-size\}/.test(css), '목록 칸(.cat-wrap)이 container 가 아니다 — 열 줄이기가 창 폭으로 갈린다');
    const m = css.match(/@container \(max-width:379px\)\{([^}]*\}[^}]*\})\s*\}/);
    assert.ok(m, '목록 폭 380px 미만 규칙(@container max-width:379px)이 없다');
    assert.ok(/\.cat-grip,\.cat-head \.ch-grip\{display:none\}/.test(m[1]), '좁은 목록 폭에서 ⠿ 를 숨기지 않는다(D2)');
    assert.ok(/\.cat-head,\.cat-row\{grid-template-columns:/.test(m[1]) && /\n\.cat-head,\.cat-row\{display:grid;grid-template-columns:/.test(css),
      '머리글(.cat-head)과 줄(.cat-row)이 한 규칙의 열 폭을 쓰지 않는다');
  },
  //  필터 막대·과제 선택 상자·할 일 필터·할 일 편집·내보내기 — state.categories 를 정렬 없이 돈다
  pickersInOrder(app) {
    //  필터 줄(FILTER-MULTI): 고른 과제 칩과 버튼 글자는 목록 순서(filterSelCats). 팝업 목록만 기록 많은 순이다(2026-10-30 사용자 결정)
    const fsc = fnBody(app, 'filterSelCats');
    assert.ok(/state\.categories\.filter\(/.test(fsc) && !/\.sort\(/.test(fsc), '필터 줄의 고른 과제가 state.categories 순서가 아니다(R4)');
    assert.ok(/filterSelCats\(\)/.test(fnBody(app, 'fitFilterChips')) && /filterSelCats\(\)/.test(fnBody(app, 'filterLabel')), '필터 줄 칩이나 버튼 글자가 filterSelCats 를 거치지 않는다');
    const fs = fnBody(app, 'fillCatSelect');
    assert.ok(/state\.categories\.filter\(isPickableCat\)\.map\(/.test(fs), '과제 선택 상자가 state.categories 순서로 한 줄이 아니다(R4)');
    assert.ok(!/optgroup|\.sort\(|\.concat\(/.test(fs), '과제 선택 상자가 공식/개인으로 묶거나 정렬한다 — 순서가 갈린다(R4)');
    //  (할 일 탭의 과제 필터 noteFilterBarHtml 은 2026-10-30 상단 필터 하나로 합치며 없앴다, FILTER-MULTI)
    const te = fnBody(app, 'todoEditHtml');
    assert.ok(/state\.categories\.filter\(isPickableCat\)/.test(te) && !/categories[^;]*\.sort\(/.test(te), '할 일 편집의 과제 선택이 state.categories 순서가 아니다');
    const ex = fnBody(app, 'openExportModal');
    assert.ok(/for\(const c of state\.categories\)/.test(ex) && !/\.sort\(/.test(ex), '내보내기 과제 선택이 state.categories 순서가 아니다');
    //  새 기록·빠른 추가·검색은 모두 fillCatSelect 를 쓴다(따로 만들면 그쪽이 낡는다)
    //  기록 폼(#qaCat)은 빈 선택지 없이 채운다(DEFAULT-TASKS §4.2). 검색 탭만 자리표시('과제를 선택하세요')를 쓴다.
    //  (예전 기록 창의 #fCat 은 2026-10-26 Git 기능과 함께 없앴다.)
    for (const sel of ["fillCatSelect($('#qaCat'))", "fillCatSelect($('#sCatSelect'), '과제를 선택하세요')"]) {
      assert.ok(app.includes(sel), `${sel} 이 사라졌다 — 그 선택 상자가 따로 순서를 만든다`);
    }
  },
};

test('정적①: 「내 과제」 목록이 state.categories 순서 그대로다(다시 묶지 않는다) · 옛 안내 한 줄 없음', () => statics.listInRealOrder(src));
test('정적②: 순서 바꾸기 = ⠿ 끌기(포인터 이벤트) + ⋯ 메뉴의 순서 묶음(끝은 꺼짐) · ▲▼ 와 반짝임, 자동 스크롤 없음', () => statics.orderUi(src));
test('정적③: 이동은 guardEdit → 자리 옮김 → save() 1회 · 메뉴와 끌기가 catReorder 를 지난다', () => statics.handlerOrder(src));
test('정적④: 보고서 행 = state.categories 순서 그대로(「기타」 맨 뒤 규칙, 미분류 합성 행 없음) · 정렬 없음', () => statics.reportOrder(src));
test('정적⑤: 필터 막대·과제 선택 상자·할 일 필터·내보내기가 state.categories 를 정렬 없이 돈다', () => statics.pickersInOrder(src));
test('정적⑥: 좁은 목록 폭(380px 미만)에서 ⠿ 를 숨긴다(container) · 머리글과 줄이 한 열 규칙', () => statics.narrowGrip(src));
test('변이①s: 개인 먼저 재묶음을 되살리면 정적① 이 실패한다', () => {
  assert.throws(() => statics.listInRealOrder(MUT.regroup(src)), /그대로 그리지 않는다|isOfficialCat|재배열/);
});
test('변이②s: guardEdit 를 지우면 정적③ 이 실패한다', () => {
  assert.throws(() => statics.handlerOrder(MUT.noGuard(src)), /관문/);
});
test('변이③s: 저장을 두 번 하면 정적③ 이 실패한다', () => {
  assert.throws(() => statics.handlerOrder(MUT.saveTwice(src)), /1회/);
});
test('변이④s: 보고서 행을 이름순으로 정렬하면 정적④ 가 실패한다', () => {
  assert.throws(() => statics.reportOrder(MUT.sortReport(src)), /정렬/);
});
test('변이⑦s: 「기타」 맨 뒤 규칙을 되살리면 정적④ 가 실패한다', () => {
  assert.throws(() => statics.reportOrder(MUT.gitaLastBack(src)), /'기타' 이름을 따로 다룬다/);
});
test('변이⑧s: 미분류 합성 행(__uncat__)을 되살리면 정적④ 가 실패한다', () => {
  assert.throws(() => statics.reportOrder(MUT.uncatBack(src)), /'기타' 이름을 따로 다룬다|미분류 합성 행/);
});
test('변이⑤s: 좁은 목록 폭에서 ⠿ 숨김을 지우면 정적⑥ 이 실패한다', () => {
  assert.throws(() => statics.narrowGrip(MUT.noNarrowHide(src)), /⠿ 를 숨기지 않는다|380px/);
});
test('변이⑥s: 메뉴의 끝 항목을 끄지 않으면 정적② 가 실패한다', () => {
  assert.throws(() => statics.orderUi(MUT.noMenuEnds(src)), /끝 항목/);
});

/* ── 행동 — jsdom 위젯 모드 ──────────────────────────────────────────── */

const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('category-order: jsdom 미설치 — 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '12', expectedSchema: '12', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CA = '2026-09-01T00:00:00Z';
  const CAT = (id, name, extra) => Object.assign({ id, name, color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', createdAt: CA }, extra || {});
  const ENT = (id, categoryId) => ({ id, date: '2026-10-01', title: '업무 ' + id, categoryId, allDay: true, startTime: '', endTime: '',
    memo: '', location: '', source: '', commits: [], createdAt: CA, updatedAt: CA });
  //  이름은 '이름순 정렬'이 실제 순서와 갈리도록 고른다(감마 < 공식 < 베타 < 알파 · ko).
  //  기본 과제(휴가, 기타 · DEFAULT-TASKS §2)는 늘 있으므로 서버에 이미 있는 것으로 맨 뒤에 둔다(없으면 부팅 보장이 맨 뒤에 붙인다).
  //  e-u(과제 없는 옛 기록)는 남긴다 — 보고서에 합성 행을 만들지 않는다는 것을 행동②가 본다.
  const DATA = {
    categories: [CAT('c-a', '알파'), CAT('c-b', '베타'), CAT('c-c', '감마'), CAT('db-o', '공식 오메가', { source: 'db' }), CAT('c-v', '휴가'), CAT('c-e', '기타')],
    entries: [ENT('e-a', 'c-a'), ENT('e-b', 'c-b'), ENT('e-c', 'c-c'), ENT('e-o', 'db-o'), ENT('e-u', null)],
    todos: [], rooms: ['201호'],
  };
  const ALL = ['c-a', 'c-b', 'c-c', 'db-o', 'c-v', 'c-e'];
  //  「기타」 과제가 가운데 있는 판(휴가는 부팅 보장이 맨 뒤에 붙인다) — 미분류는 그쪽으로 **합쳐지지 않는다**(2026-10-07).
  const DATA_GITA = {
    categories: [CAT('c-a', '알파'), CAT('c-b', '베타'), CAT('c-g', '기타'), CAT('c-c', '감마')],
    entries: [ENT('e-a', 'c-a'), ENT('e-b', 'c-b'), ENT('e-g', 'c-g'), ENT('e-c', 'c-c'), ENT('e-u', null)],
    todos: [], rooms: ['201호'],
  };

  function boot(source) {
    const log = [];
    const handlers = { saveState: { ok: true } };
    const dom = new JSDOM(source, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://tcapp.local/',
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
        //  시계는 멈춰 둔다 — 재시도·토스트 타이머가 시험 중에 끼어들지 않게.
        win.setTimeout = () => 0;
        win.clearTimeout = () => {};
      },
    });
    const w = dom.window;
    w.__fakeReply = (cmd, params) => {
      log.push({ req: cmd, params });
      const h = handlers[cmd];
      const r = typeof h === 'function' ? h(params) : h;
      return (r && typeof r.then === 'function') ? r : Promise.resolve(r === undefined ? { ok: false, error: 'no handler' } : r);
    };
    w.eval('hostRequest = function(cmd, params){ return window.__fakeReply(cmd, params || {}); };');
    w.eval('(function(){ var t = toast; toast = function(m, k, a, ms){ window.__fakeToast(String(m), k); return t(m, k, a, ms); }; })();');
    w.__fakeToast = (m, k) => log.push({ toast: m, kind: k });
    const sess = log.find((x) => x.post === 'userSessionGet');
    if (sess) w.eval('__hostReply(' + JSON.stringify(sess.msg.reqId) + ', ' + JSON.stringify({ ok: true, user: { loginId: 'hjlee', name: '이현진' } }) + ')');
    const W = {
      w, log, handlers,
      ev: (code) => w.eval(code),
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      reqs: (cmd) => log.filter((x) => x.req === cmd),
      toasts: () => log.filter((x) => x.toast).map((x) => x.toast),
      applyState: (data) => w.eval('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(META) + ')'),
      order: () => JSON.parse(w.eval('JSON.stringify(state.categories.map(function(c){ return c.id; }))')),
      domOrder: () => JSON.parse(w.eval("JSON.stringify([].map.call(document.querySelectorAll('#catList .cat-row'), function(r){ return r.dataset.id; }))")),
      more: (id) => w.document.querySelector('#catList .cat-row[data-id="' + id + '"] [data-catmore]'),
      //  ⋯ 메뉴의 항목: 메뉴가 닫혀 있으면 그 줄의 ⋯ 를 눌러 연다
      item: (id, act) => {
        const r = w.document.querySelector('#catList .cat-row[data-id="' + id + '"]'); if (!r) return null;
        if (!r.querySelector('.cat-menu')) r.querySelector('[data-catmore]').click();
        return r.querySelector('.cat-menu [data-catdo="' + act + '"]');
      },
      row: (id) => w.document.querySelector('#catList .cat-row[data-id="' + id + '"]'),
      clear: () => { log.length = 0; },
      close: () => { try { w.close(); } catch (_) {} },
    };
    return W;
  }
  async function withBoot(source, data, fn) {
    const W = boot(source);
    try {
      W.applyState(data);
      await settle();
      W.ev('openCatModal();');
      //  모달 A11y 가 여는 순간 첫 칸으로 포커스를 보낸다(MutationObserver · 마이크로태스크) — 그게 끝난 뒤에 누른다.
      await settle();
      W.clear();
      return await fn(W);
    } finally { W.close(); }
  }
  //  누른다 = ⋯ 를 눌러 메뉴를 열고(첫 항목에 포커스) 그 항목을 click — 그다음 저장 회신까지 흘린다.
  async function press(W, id, act) {
    const b = W.item(id, act);
    assert.ok(b, `${id} 줄의 ⋯ 메뉴에 ${act} 항목이 없다`);
    b.focus();
    b.click();
    await settle();
    W.ev('catMenuClose(false)');   // 꺼진 항목을 누르면 메뉴가 열린 채다 — 다음 동작이 같은 출발점에서 시작하게 닫는다
  }
  //  ⠿ 를 잡아 다른 줄 위에 놓는다(포인터 이벤트). jsdom 은 elementFromPoint 가 없으니 놓는 줄을 이벤트 대상으로 준다.
  function dragTo(W, id, overId, dy = 30) {
    const ME = W.w.MouseEvent;
    const grip = W.w.document.querySelector('#catList .cat-row[data-id="' + id + '"] [data-catgrip]');
    const over = W.w.document.querySelector('#catList .cat-row[data-id="' + overId + '"]');
    assert.ok(grip && over, '끌기 대상 줄이 없다');
    grip.dispatchEvent(new ME('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }));
    over.dispatchEvent(new ME('pointermove', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 + dy }));
    over.dispatchEvent(new ME('pointerup', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 + dy }));
  }
  //  jsdom 렐름의 배열은 deepStrictEqual 에서 프로토타입이 갈린다 — JSON 으로 이 렐름에 옮긴다.
  const saveOrders = (W) => JSON.parse(JSON.stringify(W.reqs('saveState').map((x) => x.params.state.categories.map((c) => c.id))));

  const checks = {
    //  C1·C2·C5·⑤ — 목록 순서 · 한 칸 이동 · 저장 1회 · payload 순서 · 끝 비활성 · 필터 막대·선택 상자 순서
    async moveAndSave(source) {
      await withBoot(source, DATA, async (W) => {
        assert.deepStrictEqual(W.order(), ALL, '시드 순서가 다르다');
        assert.ok(W.ev("isOfficialCat(state.categories[3])"), '공식 과제가 공식으로 실리지 않았다(시드 문제)');
        assert.deepStrictEqual(W.domOrder(), W.order(), '목록이 state.categories 순서가 아니다(C1)');
        assert.strictEqual(W.w.document.querySelectorAll('#catList [data-act="up"], #catList [data-act="down"]').length, 0, '줄에 ▲▼ 버튼이 남았다(D3)');
        //  끝 항목은 꺼져 있다(첫 줄의 위로, 맨 위로 · 마지막 줄의 아래로, 맨 아래로)
        for (const [id, acts, on] of [['c-a', ['up', 'top'], ['down', 'bottom']], ['c-e', ['down', 'bottom'], ['up', 'top']]]) {
          for (const a of acts) assert.strictEqual(W.item(id, a).disabled, true, `${id} 의 ${a} 가 꺼져 있지 않다(끝)`);
          for (const a of on) assert.strictEqual(W.item(id, a).disabled, false, `${id} 의 ${a} 가 꺼져 있다`);
          W.ev('catMenuClose(false)');
        }
        //  꺼진 항목을 눌러도 아무것도 바뀌지 않는다(저장 0)
        await press(W, 'c-a', 'up');
        await press(W, 'c-e', 'bottom');
        assert.deepStrictEqual(W.order(), ALL, '끝 항목을 눌렀더니 순서가 바뀌었다');
        assert.strictEqual(saveOrders(W).length, 0, '끝 항목을 눌렀더니 저장이 나갔다');
        assert.strictEqual(W.more('c-c').getAttribute('aria-label'), '감마 더 보기', '⋯ 의 aria-label 이 다르다');
        assert.strictEqual(W.more('c-c').tagName, 'BUTTON');

        await press(W, 'c-c', 'up');
        assert.deepStrictEqual(W.order(), ['c-a', 'c-c', 'c-b', 'db-o', 'c-v', 'c-e'], '「위로」 한 번이 한 칸 이동이 아니다(C2)');
        assert.deepStrictEqual(saveOrders(W), [['c-a', 'c-c', 'c-b', 'db-o', 'c-v', 'c-e']], '한 번 옮겼는데 저장이 1회가 아니거나 payload 순서가 다르다(C2)');
        await press(W, 'c-c', 'up');
        assert.deepStrictEqual(W.order(), ['c-c', 'c-a', 'c-b', 'db-o', 'c-v', 'c-e'], '「위로」 두 번 뒤 순서가 C,A,B,O 가 아니다');
        let saves = saveOrders(W);
        assert.strictEqual(saves.length, 2, '두 번 옮겼는데 저장이 ' + saves.length + '회다(한 번 = 저장 1회)');
        assert.deepStrictEqual(saves[1], ['c-c', 'c-a', 'c-b', 'db-o', 'c-v', 'c-e'], '저장 payload 의 categories 순서가 화면 순서가 아니다(호스트는 배열 자리를 sort_order 로 쓴다)');
        assert.deepStrictEqual(W.domOrder(), W.order(), '옮긴 뒤 목록이 state.categories 순서가 아니다');
        assert.strictEqual(W.item('c-c', 'up').disabled, true, '맨 위로 온 줄의 「위로」가 꺼지지 않았다');
        W.ev('catMenuClose(false)');
        assert.strictEqual(W.item('c-a', 'up').disabled, false, '맨 위에서 밀려난 줄의 「위로」가 꺼진 채다');
        W.ev('catMenuClose(false)');
        //  맨 아래로 = 여러 칸이어도 저장 한 번
        await press(W, 'c-c', 'bottom');
        assert.deepStrictEqual(W.order(), ['c-a', 'c-b', 'db-o', 'c-v', 'c-e', 'c-c'], '「맨 아래로」가 맨 아래로 옮기지 않았다');
        saves = saveOrders(W);
        assert.strictEqual(saves.length, 3, '여러 칸 옮겼는데 저장이 한 번이 아니다(R2)');
        await press(W, 'c-c', 'top');
        assert.deepStrictEqual(W.order(), ['c-c', 'c-a', 'c-b', 'db-o', 'c-v', 'c-e'], '「맨 위로」가 맨 위로 옮기지 않았다');
        assert.strictEqual(saveOrders(W).length, 4, '「맨 위로」의 저장이 한 번이 아니다');
        assert.deepStrictEqual(W.domOrder(), W.order(), '맨 위로, 맨 아래로 뒤 목록이 state.categories 순서가 아니다');
        //  데이터 쪽 끝 막기 — 화면을 거치지 않고 불러도 배열 밖으로 빠지지 않는다(moveCategory 가 마지막 관문이다)
        assert.strictEqual(W.ev("moveCategory('c-c', -1)"), false, '맨 위 과제를 위로 옮기라는 요청을 받아들였다(R2)');
        await settle();
        assert.deepStrictEqual(W.order(), ['c-c', 'c-a', 'c-b', 'db-o', 'c-v', 'c-e'], '맨 위에서 위로 옮기자 순서가 깨졌다(R2): ' + JSON.stringify(W.order()));

        //  필터 막대 · 과제 선택 상자 — 같은 순서(C5)
        //  필터 줄의 고른 과제 칩(FILTER-MULTI)은 목록 순서다. 모두 고르면 전체(칩 없음)라 맨 끝 하나를 빼고 고른다
        W.ev("filterCats = new Set(state.categories.slice(0, -1).map(function(c){ return c.id; })); renderFilterbar();");
        const chips = W.evJSON("[].map.call(document.querySelectorAll('#filterbar [data-cat]'), function(b){ return b.dataset.cat; }).filter(Boolean)");
        W.ev("filterCats = null; renderFilterbar();");
        assert.deepStrictEqual(chips, W.order().slice(0, -1), '필터 줄 칩이 목록 순서를 따르지 않는다(C5)');
        const opts = W.evJSON("(function(){ var s = document.createElement('select'); fillCatSelect(s); return [].map.call(s.querySelectorAll('option'), function(o){ return o.value; }).filter(Boolean); })()");
        assert.deepStrictEqual(opts, W.order(), '과제 선택 상자가 목록 순서를 따르지 않는다(C5)');

        //  공식을 개인 사이로 — 다시 열어도(새로 그려도) 섞인 그대로다(R1 — 개인 먼저로 다시 묶지 않는다)
        await press(W, 'db-o', 'up');
        assert.deepStrictEqual(W.order(), ['c-c', 'c-a', 'db-o', 'c-b', 'c-v', 'c-e']);
        W.ev("closeModal('#categoryModal'); openCatModal();");
        assert.deepStrictEqual(W.domOrder(), ['c-c', 'c-a', 'db-o', 'c-b', 'c-v', 'c-e'], '다시 연 목록이 실제 순서가 아니다 — 개인/공식으로 다시 묶었다(R1)');
      });
    },
    //  ⠿ 끌기(포인터 이벤트) — 다른 줄 위에 놓으면 그 줄의 자리로, 저장 1회. 5px 안의 움직임은 끌기가 아니다. Esc 는 취소한다.
    async dragReorder(source) {
      await withBoot(source, DATA, async (W) => {
        dragTo(W, 'c-c', 'c-a', 3);   // 5px 미만: 끌기가 시작되지 않는다
        assert.deepStrictEqual(W.order(), ALL, '5px 안의 움직임으로 순서가 바뀌었다');
        dragTo(W, 'c-c', 'c-a');
        await settle();
        assert.deepStrictEqual(W.order(), ['c-c', 'c-a', 'c-b', 'db-o', 'c-v', 'c-e'], '첫 줄 위에 놓았는데 그 자리로 가지 않았다');
        assert.deepStrictEqual(saveOrders(W), [['c-c', 'c-a', 'c-b', 'db-o', 'c-v', 'c-e']], '끌어 놓기의 저장이 1회가 아니거나 payload 순서가 다르다');
        assert.deepStrictEqual(W.domOrder(), W.order(), '끌어 놓은 뒤 목록이 state.categories 순서가 아니다');
        assert.strictEqual(W.w.document.querySelectorAll('.cat-drag-ghost, .cat-drag-src, .cat-drop-before, .cat-drop-after').length, 0, '끌기가 끝났는데 끌기 표시가 남았다');
        dragTo(W, 'c-a', 'c-e');
        await settle();
        assert.deepStrictEqual(W.order(), ['c-c', 'c-b', 'db-o', 'c-v', 'c-e', 'c-a'], '마지막 줄 위에 놓았는데 맨 아래로 가지 않았다');
        //  Esc 는 취소한다(저장 0)
        W.clear();
        const ME = W.w.MouseEvent;
        const grip = W.w.document.querySelector('#catList .cat-row[data-id="c-b"] [data-catgrip]');
        const over = W.w.document.querySelector('#catList .cat-row[data-id="c-c"]');
        grip.dispatchEvent(new ME('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }));
        over.dispatchEvent(new ME('pointermove', { bubbles: true, cancelable: true, clientX: 10, clientY: 40 }));
        W.w.document.dispatchEvent(new W.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        over.dispatchEvent(new ME('pointerup', { bubbles: true, cancelable: true, clientX: 10, clientY: 40 }));
        await settle();
        assert.deepStrictEqual(W.order(), ['c-c', 'c-b', 'db-o', 'c-v', 'c-e', 'c-a'], 'Esc 로 취소했는데 순서가 바뀌었다');
        assert.strictEqual(W.reqs('saveState').length, 0, 'Esc 로 취소했는데 저장했다');
        assert.strictEqual(W.ev("$('#categoryModal').classList.contains('hidden')"), false, '끌기 취소의 Esc 가 창까지 닫았다');
      });
    },
    //  C4 — 보고서 행 순서 = 목록 순서 그대로. 과제 없는 옛 기록(e-u)은 합성 행을 만들지 않는다(2026-10-07)
    async reportRows(source) {
      await withBoot(source, DATA, async (W) => {
        await press(W, 'c-c', 'up');
        await press(W, 'c-c', 'up');
        const keys = W.evJSON("collectReportData('2026-10-01', '2026-10-01').rows.map(function(r){ return r.key; })");
        assert.deepStrictEqual(keys, ['c-c', 'c-a', 'c-b', 'db-o', 'c-v', 'c-e'], '보고서 행 순서가 목록 순서가 아니다(C4 · 미분류 합성 행 없음): ' + JSON.stringify(keys));
      });
    },
    //  옛 R5 폐기(2026-10-07) — 「기타」 과제를 맨 위로 옮기면 보고서에서도 맨 위다. 과제 없는 기록은 그리로 합쳐지지 않는다.
    async gitaInListOrder(source) {
      await withBoot(source, DATA_GITA, async (W) => {
        assert.deepStrictEqual(W.order().slice(0, 4), ['c-a', 'c-b', 'c-g', 'c-c'], '시드 순서가 다르다');
        assert.strictEqual(W.ev("state.categories.filter(function(c){ return c.name === '기타'; }).length"), 1, "파일의 '기타' 가 있는데 기본 과제 기타를 또 만들었다");
        await press(W, 'c-g', 'up');
        await press(W, 'c-g', 'up');
        assert.deepStrictEqual(W.order().slice(0, 4), ['c-g', 'c-a', 'c-b', 'c-c'], '「기타」 가 맨 위로 오지 않았다');
        const rows = W.evJSON("collectReportData('2026-10-01', '2026-10-01').rows.map(function(r){ return [r.key, r.titles.length]; })");
        assert.deepStrictEqual(rows.map((r) => r[0]).slice(0, 4), ['c-g', 'c-a', 'c-b', 'c-c'], '「기타」 과제가 목록 자리(맨 위)에 있지 않다 — 맨 뒤 규칙이 되살아났다: ' + JSON.stringify(rows));
        assert.strictEqual(rows[0][1], 1, '과제 없는 기록이 「기타」 과제로 합쳐졌다(gitaCat 병합이 되살아났다)');
      });
    },
    //  C7 — 목록을 다시 만들지 않는다(옮긴 줄 하나만 새 자리로) · 메뉴로 옮기면 포커스는 그 줄의 ⋯ · 낭독
    async focusKept(source) {
      await withBoot(source, DATA, async (W) => {
        const rowNode = W.row('c-c'), others = ['c-a', 'c-b', 'db-o'].map((id) => W.row(id)), listNode = W.w.document.getElementById('catList');
        await press(W, 'c-c', 'up');
        assert.strictEqual(W.w.document.activeElement, W.more('c-c'), '메뉴로 한 칸 옮긴 뒤 포커스가 그 줄의 ⋯ 에 있지 않다(R3)');
        assert.strictEqual(W.row('c-c'), rowNode, '옮길 때 목록을 새로 만들었다 — 스크롤·포커스가 날아간다(R3)');
        assert.deepStrictEqual(['c-a', 'c-b', 'db-o'].map((id) => W.row(id)), others, '옮길 때 다른 줄을 새로 만들었다(R3)');
        assert.strictEqual(W.w.document.getElementById('catList'), listNode);
        assert.strictEqual(W.w.document.getElementById('catLive').textContent, '감마: 3번째에서 2번째로 옮겼습니다', 'aria-live 낭독이 없다');
        assert.ok(!rowNode.classList.contains('cat-flash'), '옮긴 줄이 반짝인다(D3)');
        await press(W, 'c-c', 'bottom');
        assert.strictEqual(W.row('c-c'), rowNode, '맨 아래로 옮길 때 목록을 새로 만들었다');
        assert.strictEqual(W.w.document.getElementById('catLive').textContent, '감마: 2번째에서 6번째로 옮겼습니다');
        assert.deepStrictEqual(W.order(), ['c-a', 'c-b', 'db-o', 'c-v', 'c-e', 'c-c']);
      });
    },
    //  C6 — 오프라인 잠금 중에는 상태·저장 변화 0 + 토스트
    async lockedNoop(source) {
      await withBoot(source, DATA, async (W) => {
        W.ev("__dbConnLost({ kind:'network', detail:'socket closed' })");
        assert.strictEqual(W.ev('editLocked()'), true, '끊김 주입이 잠금을 세우지 않았다(시험 전제)');
        W.clear();
        await press(W, 'c-c', 'up');
        assert.deepStrictEqual(W.order(), ALL, '잠긴 채 순서가 바뀌었다(R7)');
        assert.deepStrictEqual(W.domOrder(), ALL, '잠긴 채 화면의 순서가 바뀌었다(R7)');
        assert.strictEqual(W.reqs('saveState').length, 0, '잠긴 채 저장을 보냈다(R7)');
        assert.ok(W.toasts().includes('서버에 연결되지 않아 지금은 편집할 수 없습니다'), '막았는데 이유를 말하지 않는다: ' + JSON.stringify(W.toasts()));
        assert.strictEqual(W.ev('unsaved'), false, '잠긴 채 눌렀는데 미저장 표시가 섰다 — 바뀐 것이 없어야 한다');
      });
    },
  };

  test('행동①: ⋯ 의 위로 = 한 칸 · 맨 위로/맨 아래로도 저장 1회 · payload 순서 · 끝 항목 꺼짐 · 필터 막대·선택 상자 같은 순서 · 다시 열어도 섞인 순서(C1·C2·C5)', () => checks.moveAndSave(src));
  test('행동①-b: ⠿ 끌기(포인터 이벤트) — 놓은 줄의 자리로 · 저장 1회 · 5px 안은 끌기 아님 · Esc 취소(창은 그대로)', () => checks.dragReorder(src));
  test('행동②: 보고서 행 순서 = 목록 순서 그대로 · 미분류 합성 행 없음(C4)', () => checks.reportRows(src));
  test('행동③: 「기타」 과제를 맨 위로 옮기면 보고서에서도 맨 위 · 과제 없는 기록은 합쳐지지 않는다(옛 R5 폐기)', () => checks.gitaInListOrder(src));
  test('행동④: 옮긴 뒤 목록을 다시 만들지 않는다 · 포커스는 그 줄의 ⋯ · 낭독 · 반짝임 없음(C7, D3)', () => checks.focusKept(src));
  test('행동⑤: 오프라인 잠금 중 이동 불가 — 상태·화면·저장 0 · 토스트(C6)', () => checks.lockedNoop(src));

  test('변이①: 개인 먼저 재묶음을 되살리면 행동① 이 실패한다', async () => {
    //  기본 과제(개인)가 공식 과제 뒤에 오면서 재묶음이 첫 화면(C1)에서 바로 드러난다 — 어느 쪽에서 잡혀도 같은 위반이다.
    await assert.rejects(() => checks.moveAndSave(MUT.regroup(src)), /다시 묶었다|목록이 state\.categories 순서가 아니다/);
  });
  test('변이②: moveCategory 의 guardEdit 를 지우면 행동⑤ 가 실패한다', async () => {
    await assert.rejects(() => checks.lockedNoop(MUT.noGuard(src)), /잠긴 채 (순서|화면의 순서)가 바뀌었다/);
  });
  test('변이③: 한 번 옮기는데 두 번 저장하면 행동① 이 실패한다', async () => {
    await assert.rejects(() => checks.moveAndSave(MUT.saveTwice(src)), /저장이 1회가 아니거나|저장이 d+회다/);
  });
  test('변이⑤: moveCategory 의 끝 막기를 지우면 행동① 이 실패한다', async () => {
    await assert.rejects(() => checks.moveAndSave(MUT.noEndStop(src)), /맨 위 과제를 위로 옮기라는 요청을 받아들였다|순서가 깨졌다/);
  });
  test('변이⑥: 메뉴의 끝 항목을 끄지 않아도 데이터는 끝 막기가 지키지만 행동① 이 잡는다', async () => {
    await assert.rejects(() => checks.moveAndSave(MUT.noMenuEnds(src)), /꺼져 있지 않다/);
  });
  test('변이⑨: 옮길 때 목록을 통째로 다시 그리면 행동④ 가 실패한다', async () => {
    await assert.rejects(() => checks.focusKept(MUT.rerender(src)), /새로 만들었다|포커스/);
  });
  test('변이⑩: 끌어 놓기에서 저장을 두 번 하면 행동①-b 가 실패한다', async () => {
    await assert.rejects(() => checks.dragReorder(MUT.saveTwice(src)), /저장이 1회가 아니거나/);
  });
  test('변이④: 보고서 행을 이름순으로 정렬하면 행동② 가 실패한다', async () => {
    await assert.rejects(() => checks.reportRows(MUT.sortReport(src)), /보고서 행 순서/);
  });
  test('변이⑦: 「기타」 맨 뒤 규칙을 되살리면 행동③ 이 실패한다', async () => {
    await assert.rejects(() => checks.gitaInListOrder(MUT.gitaLastBack(src)), /맨 뒤 규칙이 되살아났다/);
  });
  test('변이⑧: 미분류 합성 행을 되살리면 행동② 가 실패한다', async () => {
    await assert.rejects(() => checks.reportRows(MUT.uncatBack(src)), /보고서 행 순서/);
  });
}
