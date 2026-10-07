// 보고서 포함 상태(docs/REPORT-INCLUDE-STATE.md, 2026-10-06)의 웹 쪽 계약.
//
// 이 파일이 지키는 것:
//   ① 과제마다 보고서 묶음 category.reportGroup = 'include'(기본) | 'etc'. 판독은 catReportGroup 하나('etc' 외 전부 include).
//      내 과제 줄의 [포함 | 기타] 를 누르면 관문(guardEdit) → 값 변경 → save() 1회. 지금 값은 aria-pressed.
//   ② 'etc' 과제의 일정, 할 일, 커밋 제목과 (날짜 x 과제) 공수는 보고서의 '기타' 행으로 합쳐진다
//      (사용자 '기타' 과제가 있으면 그 행, 없으면 미분류 '기타'(__uncat__) 행. 둘 다 맨 뒤). 미리보기, 복사, 전송이 같은 rows.
//   ③ 보고서 창의 X: 그 보고서에서만 행(업무와 공수)을 뺀다. 미리보기, 복사, 회사 전송(일간, 주간)에서 함께 빠지고
//      '뺀 과제 N개' 막대에서 되돌린다. 창을 닫았다 열면 모두 돌아온다(서버, localStorage 어디에도 쓰지 않는다).
//      netcus 출처(일간 병합 net, 주간 병합 week)에도 X 가 있다. 기타 묶기는 캘린더 출처에만(사용자 결정 2026-10-06).
//   ④ XML 사본은 'etc' 일 때만 reportGroup="etc" 를 쓰고, 읽을 때는 키를 항상 만든다(옛 XML = 전부 include).
//
// 검사 함수를 테스트와 변이 시험이 공유한다(검사가 정말 잡는지 같은 함수를 변이된 소스에 다시 돌려 증명한다).
// jsdom 행동 시험은 category-order.test.mjs 의 boot / withBoot / press 꼴을 그대로 따른다(위젯 모드, 가짜 호스트).
import { test, skip, assert, loadAppSource, extractFunction, importOptional, countTestsBelow, SKIP_NO_JSDOM } from './harness.mjs';

const src = loadAppSource();

function mutate(from, to, base) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${String(from).slice(0, 80)}`);
  return out;
}
// JS 주석 제거(문자열, 템플릿 리터럴은 보존). 계약이 보는 것은 코드다.
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
  //  막대 갱신을 '과제 0개' 가드 뒤로 옮긴다(전부 뺐을 때 되돌리기가 사라진다)
  barAfterGuard: (s) => mutate(
    "  renderRptExcl(excluded);   // 뺀 과제 막대: 아래 가드보다 먼저(전부 뺐을 때도 되돌리기가 보여야 한다)\n  if(!rows.length){",
    "  if(!rows.length){",
    s).replace("  // 표시 설정(머리기호/들여쓰기) — 표시+복사 전용.", "  renderRptExcl(excluded);\n  // 표시 설정(머리기호/들여쓰기) — 표시+복사 전용."),
  //  관문 없이 바꾼다
  noGuard: (s) => mutate(
    "function setCategoryReportGroup(id, group){\n  if(guardEdit()) return false;\n",
    "function setCategoryReportGroup(id, group){\n",
    s),
  //  한 번 바꾸는데 두 번 저장한다
  saveTwice: (s) => mutate(
    "  c.reportGroup = g;\n  save();\n",
    "  c.reportGroup = g;\n  save(); save();\n",
    s),
  //  XML 속성을 항상 쓴다(포함 과제의 옛 파일 바이트가 바뀐다)
  attrAlways: (s) => mutate(
    "if(catReportGroup(c) === 'etc') el.setAttribute('reportGroup', 'etc');",
    "el.setAttribute('reportGroup', catReportGroup(c));",
    s),
  //  창을 열 때 비우지 않는다(지난 창에서 뺀 과제가 남는다)
  noClearOnOpen: (s) => mutate(
    "  rptExcluded.clear();   // 보고서 창 X 는 창 단위다.",
    "  // (지움)   // 보고서 창 X 는 창 단위다.",
    s),
  //  호출부 ⑤(주간 전송)를 rptSources() 로 되돌린다(뺀 과제가 주간 전송에 실린다)
  site5: (s) => mutate(
    "const wf = buildWeeklyFields(from, to, rptReportSources());",
    "const wf = buildWeeklyFields(from, to, rptSources());",
    s),
  //  호출부 ③(복사)을 rptSources() 로 되돌린다(뺀 과제가 복사, 일간 본문에 실린다)
  site3: (s) => mutate(
    "  const { rows } = collectReportData(from, to, rptReportSources());\n  if(!rows.length) return '';",
    "  const { rows } = collectReportData(from, to, rptSources());\n  if(!rows.length) return '';",
    s),
  //  hourKeys 합산을 지운다(기타로 합친 과제의 공수가 '기타' 행에서 사라진다)
  noHourSum: (s) => mutate(
    "  const ks = (row && Array.isArray(row.hourKeys) && row.hourKeys.length) ? row.hourKeys : [row && row.key];",
    "  const ks = [row && row.key];",
    s),
  //  좁은 폭 두 줄 나눔을 지운다(320px 에서 이름이 한 글자씩 접히고 가로 스크롤, QA r1)
  noRowWrap: (s) => mutate(
    "  .cat-row{flex-wrap:wrap;row-gap:var(--sp-1)}\n",
    "  .cat-row{row-gap:var(--sp-1)}\n",
    s),
  //  좁은 폭 X 히트 영역 하한을 지운다(터치 위젯에서 20x20, QA r1 V7)
  noXTouch: (s) => mutate(
    "@media (max-width:440px){ .rpt-mirror .rcard-x{min-width:32px;min-height:32px} }",
    "@media (max-width:440px){ .rpt-mirror .rcard-x{} }",
    s),
};

/* ── 정적 계약(jsdom 불필요) ─────────────────────────────────────────── */

const statics = {
  //  ① 판독 헬퍼 + setCategoryReportGroup: 관문 → 값 변경 → save() 1회
  setterOrder(app) {
    const rg = fnBody(app, 'catReportGroup');
    assert.ok(/c\.reportGroup === 'etc'\) \? 'etc' : 'include'/.test(rg), "catReportGroup 이 'etc' 외 값을 include 로 읽지 않는다");
    assert.ok(/catReportGroup\(c\) === 'etc'/.test(fnBody(app, 'isEtcCat')), 'isEtcCat 이 catReportGroup 을 지나지 않는다');
    const b = fnBody(app, 'setCategoryReportGroup');
    const g = b.indexOf('guardEdit()'), set = b.indexOf('c.reportGroup = g'), sv = b.indexOf('save()');
    assert.ok(g > 0, 'setCategoryReportGroup 에 연결 잠금 관문(guardEdit)이 없다');
    assert.ok(set > g, 'setCategoryReportGroup 이 관문보다 먼저 값을 바꾼다');
    assert.ok(sv > set, 'setCategoryReportGroup 이 값을 바꾸기 전에 저장한다');
    assert.strictEqual((b.match(/save\(\)/g) || []).length, 1, 'setCategoryReportGroup 의 저장이 1회가 아니다');
    assert.ok(/if\(!c \|\| catReportGroup\(c\) === g\) return false;/.test(b), '과제 없음이나 같은 값일 때 false(저장 0)로 끝나지 않는다');
  },
  //  ② 내 과제 줄: 두 템플릿 모두 ▲▼ 뒤, [수정] 앞에 [포함 | 기타] · aria-pressed · 위임
  rowToggle(app) {
    const row = fnBody(app, 'catRowHtml');
    assert.strictEqual((row.match(/\$\{catReportGroupHtml\(c\)\}/g) || []).length, 2, '개인, 공식 두 행 템플릿 모두에 [포함 | 기타] 가 있어야 한다');
    for (const part of row.split('return `').slice(1)) {
      const m = part.indexOf('${catMoveBtnsHtml(c)}'), r = part.indexOf('${catReportGroupHtml(c)}'), e = part.indexOf('data-act="edit"');
      assert.ok(m > 0 && r > m && e > r, '[포함 | 기타] 가 ▲▼ 뒤, [수정] 앞에 있지 않다');
    }
    const h = fnBody(app, 'catReportGroupHtml');
    assert.ok(/<span class="cat-rg" role="group" aria-label="보고서 묶음: \$\{nm\}">/.test(h), '그룹 aria-label「보고서 묶음: 과제명」이 없다');
    assert.ok(/data-act="rg-include" aria-pressed="\$\{etc \? 'false' : 'true'\}"/.test(h) && /data-act="rg-etc" aria-pressed="\$\{etc \? 'true' : 'false'\}"/.test(h),
      '지금 값을 aria-pressed 로 말하지 않는다');
    assert.ok(/>포함<\/button>/.test(h) && />기타<\/button>/.test(h), '버튼 글자가 포함 / 기타 가 아니다');
    const i = app.indexOf("$('#catList').addEventListener('click'");
    const j = app.indexOf("if((act === 'unsub' || act === 'del') && guardEdit()) return;", i);
    const dl = app.slice(i, j);
    assert.ok(dl.includes("if(act === 'rg-include' || act === 'rg-etc'){") && dl.includes("setCategoryReportGroup(c.id, act === 'rg-etc' ? 'etc' : 'include')"),
      '#catList 위임이 [포함 | 기타] 를 setCategoryReportGroup 으로 보내지 않는다');
    assert.ok(dl.includes('catSyncReportGroup(row, c);'), '전환 뒤 그 줄의 aria-pressed 를 맞추지 않는다');
  },
  //  ④ XML: 'etc' 일 때만 속성, 읽을 때 키는 항상
  xml(app) {
    const t = fnBody(app, 'toXML');
    assert.ok(t.includes("if(catReportGroup(c) === 'etc') el.setAttribute('reportGroup', 'etc');"), "toXML 이 'etc' 일 때만 reportGroup 속성을 쓰지 않는다");
    assert.strictEqual((t.match(/setAttribute\('reportGroup'/g) || []).length, 1, 'toXML 이 reportGroup 속성을 조건 없이도 쓴다(포함 과제의 옛 파일 바이트가 바뀐다)');
    const f = fnBody(app, 'fromXML');
    assert.ok(/reportGroup: c\.getAttribute\('reportGroup'\) === 'etc' \? 'etc' : 'include',/.test(f), 'fromXML 이 reportGroup 키를 항상 만들지 않는다');
    assert.ok(/catReportGroup\(c\)\]\)/.test(fnBody(app, 'xmlRoundTrip')), '앱 자체 왕복 검증(xmlRoundTrip)이 reportGroup 을 보지 않는다');
  },
  //  ② 보고서 묶기: isEtcCat · hourKeys · 미분류 행 hourKeys 에 '__uncat__' · 공수 함수 하나 · exclude 는 맨 마지막
  collect(app) {
    const b = fnBody(app, 'collectReportData');
    assert.ok(/const catKey = e => \{ const c = catById\(e\.categoryId\); return \(c && !isEtcCat\(c\)\) \? e\.categoryId : etcKey; \};/.test(b), 'catKey 가 기타 과제를 기타 키로 보내지 않는다');
    assert.ok(/hourKeys: \(c === gitaCat\) \? \[\.\.\.new Set\(\[c\.id\]\.concat\(etcIds\)\)\] : \[c\.id\]/.test(b), '과제 행에 hourKeys 를 싣지 않는다');
    assert.ok(/hourKeys:\[\.\.\.new Set\(\['__uncat__'\]\.concat\(etcIds\)\)\]/.test(b), "미분류 '기타' 행의 hourKeys 가 '__uncat__' 을 포함하지 않는다(오늘 미분류 공수가 사라진다)");
    assert.ok(/rows = rows\.filter\(r => !etcIds\.includes\(r\.key\)\)/.test(b), '기타로 합친 과제의 자기 행을 빼지 않는다');
    assert.ok(/const rangeTaskHours = key => \{ const ks = hourKeysByKey\.get\(key\) \|\| \[key\];/.test(b), '내용 없는 항목 판정의 공수가 hourKeys 를 보지 않는다');
    const skipAt = b.indexOf('if(skipEmpty) rows = rows.filter(');
    const exAt = b.indexOf('rows = rows.filter(r => !exclude.has(r.key));');
    assert.ok(skipAt > 0 && exAt > skipAt, '보고서 창 X 거름(exclude)이 내용 없는 항목 제외 뒤(맨 마지막)에 있지 않다');
    assert.ok(/return \{ rows, excluded \};/.test(b), 'collectReportData 가 excluded 를 돌려주지 않는다');
    const rh = fnBody(app, 'reportRowHours');
    assert.ok(/row\.hourKeys/.test(rh) && /for\(const k of ks\)\{ const v = getTaskHours\(date, k\);/.test(rh), 'reportRowHours 가 hourKeys 를 합산하지 않는다');
    assert.ok(/reportRowHours\(r, date\)/.test(fnBody(app, 'reportDailyHours')), '일간 공수(reportDailyHours)가 reportRowHours 를 쓰지 않는다');
    assert.ok(/const value = reportRowHours\(r, date\);/.test(fnBody(app, 'buildWeeklyFields')), '주간 공수(buildWeeklyFields)가 reportRowHours 를 쓰지 않는다');
  },
  //  ③ 다섯 호출부 + rptSources() 직접 호출은 둘뿐 + rptSources 는 exclude 를 모른다
  callSites(app) {
    assert.ok(/const \{ rows \} = collectReportData\(from, to, sources \|\| rptReportSources\(\)\);/.test(fnBody(app, 'buildWeeklyFields')), '호출부 ①(buildWeeklyFields 기본 인자)이 rptReportSources 가 아니다');
    assert.ok(/const src = rptReportSources\(\);/.test(fnBody(app, 'buildReport')), '호출부 ②(buildReport)가 rptReportSources 가 아니다');
    assert.ok(/collectReportData\(from, to, rptReportSources\(\)\)/.test(fnBody(app, 'buildReportText')), '호출부 ③(buildReportText, 복사와 일간 본문)이 rptReportSources 가 아니다');
    assert.ok(app.includes('const rptHours = reportDailyHours(collectReportData(from, to, rptReportSources()).rows, from)'), '호출부 ④(일간 전송 hours)가 rptReportSources 가 아니다');
    assert.ok(app.includes('const wf = buildWeeklyFields(from, to, rptReportSources());'), '호출부 ⑤(주간 전송)가 rptReportSources 가 아니다');
    const code = stripJs(app);
    const calls = [...code.matchAll(/(?<!function )rptSources\(\)/g)].map((m) => m.index);
    const inSave = fnBody(app, 'saveRptSourcePrefs'), inRep = fnBody(app, 'rptReportSources');
    assert.strictEqual(calls.length, 2, `rptSources() 직접 호출이 ${calls.length}곳이다(saveRptSourcePrefs 와 rptReportSources 안, 둘이어야 한다)`);
    assert.ok(/prefs\[reportFormatKeyForMode\(reportMode\)\] = rptSources\(\);/.test(inSave) && /Object\.assign\(\{\}, rptSources\(\), \{ exclude: rptExcluded \}\)/.test(inRep),
      'rptSources() 직접 호출이 saveRptSourcePrefs 와 rptReportSources 밖에 있다');
    assert.ok(!/exclude|rptExcluded/.test(fnBody(app, 'rptSources')), 'rptSources 가 exclude 를 안다(저장되는 tc_rptSources 에 섞인다)');
  },
  //  ③ netcus: 순수 헬퍼 · 기존 순수 함수는 전역을 모른다 · 복사/전송이 거른 parsed 를 쓴다
  netcus(app) {
    for (const fn of ['buildNetcusSendText', 'buildNetcusHoursText', 'buildNetcusPlanText', 'buildNetcusWeeklyText', 'parseNetcusWeek', 'parseNetcusWeekly']) {
      assert.ok(!/rptExcluded|netcusParsedWithout/.test(fnBody(app, fn)), `${fn} 이 보고서 창 X 를 안다(전역 없이 도는 순수 함수여야 한다)`);
    }
    for (const fn of ['netcusParsedWithout', 'ncRowKey']) {
      assert.ok(!/rptExcluded|\$\(|state\.|document|window/.test(fnBody(app, fn)), `${fn} 이 전역(rptExcluded, DOM, state)을 읽는다`);
    }
    const t = fnBody(app, 'buildReportText');
    assert.ok(t.includes('buildNetcusWeeklyText(netcusParsedWithout(_wp, rptExcluded).parsed, weeklyFlat)'), 'week 출처 복사가 X 거름을 지나지 않는다');
    assert.ok(t.includes('buildNetcusSendText(netcusParsedWithout(_np, rptExcluded).parsed)'), 'net 출처 복사가 X 거름을 지나지 않는다');
    const i = app.indexOf("if(state.reportSource === 'net'){\n        const _np0 = ");
    assert.ok(i > 0, "#btnRptSend 의 'net' 주간 전송 분기를 찾지 못했다");
    const seg = app.slice(i, app.indexOf('Platform.report.submitWeekly(payload);', i));
    assert.ok(seg.includes('const parsed = netcusParsedWithout(_np0, rptExcluded).parsed;') && seg.indexOf('netcusParsedWithout') < seg.indexOf('buildNetcusSendText(parsed)'),
      "'net' 주간 전송이 X 로 거른 parsed 로 보내지 않는다");
    for (const fn of ['renderNetcusPreview', 'renderNetcusWeeklyPreview']) {
      const b = fnBody(app, fn);
      assert.ok(/netcusParsedWithout\((parsed|_src), rptExcluded\)/.test(b) && /renderRptExcl\(_nx\.excluded\)/.test(b), `${fn} 이 X 로 거른 뒤 그리지 않는다`);
      assert.ok(/rptXBtnHtml\(ncRowKey\(t\), t\.name\)/.test(b), `${fn} 의 카드에 X 가 없다`);
    }
    assert.ok(/rptXBtnHtml\('__nc_uncat__', '미분류'\)/.test(fnBody(app, 'renderNetcusPreview')), "'[미분류]' 카드에 X 가 없다");
    for (const fn of ['renderNetcusInto', 'renderNetcusWeeklyInto']) {
      const b = fnBody(app, fn);
      assert.ok(b.indexOf('renderRptExcl(null)') > 0 && b.indexOf('renderRptExcl(null)') < b.indexOf('if(!HOST)'), `${fn} 가 안내, 대기 화면 전에 낡은 막대를 숨기지 않는다`);
    }
  },
  //  ③ 창 단위 수명: 열 때 첫 문장으로 비우고, 닫는 길(closeOverlay)에서 비운다(변이⑭ 앵커 줄은 글자 그대로)
  lifetime(app) {
    const o = fnBody(app, 'openReport');
    const first = o.slice(o.indexOf('{') + 1).trim().split('\n')[0].trim();
    assert.strictEqual(first, 'rptExcluded.clear();', 'openReport 의 첫 문장이 rptExcluded.clear() 가 아니다');
    const c = extractFunction(app, 'closeOverlay');
    const ANCHOR = "  if(ov.id === 'reportModal'){ clearNetcusMerge(); clearNetcusWeeklyMerge(); }";
    const k = c.indexOf(ANCHOR);
    assert.ok(k > 0, 'closeOverlay 의 보고서 캐시 정리 줄(report-wiring 변이⑭ 앵커)이 글자 그대로가 아니다');
    const next = c.slice(c.indexOf('\n', k) + 1).split('\n')[0];
    assert.ok(/^  if\(ov\.id === 'reportModal'\) rptExcluded\.clear\(\);/.test(next), '그 다음 줄이 별도 문장 rptExcluded.clear() 가 아니다');
    assert.ok(!/localStorage|hostRequest|save\(\)/.test(fnBody(app, 'rptReportSources')), '보고서 창 X 상태를 저장한다');
  },
  //  ③ 미리보기 X 와 막대: 모든 행 카드 머리에 X · 막대 갱신은 '과제 0개' 가드보다 앞 · 그 가드가 excluded 를 본다
  previewX(app) {
    const b = fnBody(app, 'buildReport');
    assert.ok(/html \+= rptXBtnHtml\(r\.key, r\.name\);/.test(b), '캘린더 미리보기의 행 카드에 X 가 없다');
    const bar = b.indexOf('renderRptExcl(excluded);'), guard = b.indexOf('if(!rows.length){');
    assert.ok(bar > 0 && guard > 0 && bar < guard, '뺀 과제 막대 갱신이 과제 0개 가드보다 뒤에 있다(전부 뺐을 때 되돌리기가 사라진다)');
    const g = b.slice(guard, b.indexOf('}', guard));
    assert.ok(/excluded\.length \? '모든 과제를 뺐습니다\. 되돌리기로 다시 넣을 수 있습니다'/.test(g), "과제 0개 가드가 '전부 뺐다'와 '과제가 없다'를 가르지 않는다");
    const x = fnBody(app, 'rptXBtnHtml');
    assert.ok(x.includes("class=\"rcard-x\"") && x.includes("'이 보고서에서 빼기: '") && x.includes('title="이 보고서에서만 뺍니다. 기록은 지우지 않습니다"'), 'X 버튼의 클래스, aria-label, title 이 계약과 다르다');
    assert.ok(app.includes('<div class="rpt-excl hidden" id="rptExcl"'), '#rptExcl 막대 자리가 없다');
  },
  //  ④ 좁은 폭(≤440px) 배치. jsdom 은 레이아웃을 재지 못하므로 규칙을 잠근다(실제 크기는 loop-ui-visual V1, V7 이 잰다).
  //     내 과제 줄은 두 줄(첫 줄 이름과 건수, 둘째 줄 버튼들), 보고서 창 X 는 히트 영역 32px.
  narrowLayout(app) {
    const css = app.slice(0, app.indexOf('</style>'));
    const n440 = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)]
      .filter((m) => Number(m[1]) === 440).map((m) => m[2]);
    const has = (re) => n440.some((b) => re.test(b));
    assert.ok(has(/\.cat-row\{[^}]*flex-wrap:wrap/), '≤440px 에서 내 과제 줄이 줄바꿈되지 않는다(320px 에서 이름이 한 글자씩 접히고 가로 스크롤이 생긴다)');
    assert.ok(has(/\.cat-row > \.cat-dot \+ div\{[^}]*flex:1 1 0/), '≤440px 에서 이름 칸이 첫 줄의 남는 폭을 차지하지 않는다');
    assert.ok(has(/\.cat-row::after\{[^}]*flex-basis:100%[^}]*order:1/), '≤440px 에서 첫 줄과 둘째 줄을 끊는 ::after 가 없다');
    assert.ok(has(/\.cat-row > \.code-ord,\.cat-row > \.cat-rg,\.cat-row > \.link\{[^}]*order:2/), '≤440px 에서 ▲▼, [포함 | 기타], 링크가 둘째 줄로 가지 않는다');
    assert.ok(has(/\.rpt-mirror \.rcard-x\{[^}]*min-width:32px[^}]*min-height:32px/), '≤440px 에서 보고서 창 X 의 히트 영역이 32px 하한이 아니다');
  },
};

test('정적①: catReportGroup 판독 + setCategoryReportGroup 은 guardEdit → 값 변경 → save() 1회', () => statics.setterOrder(src));
test('정적②: 내 과제 두 템플릿 모두 ▲▼ 뒤 수정 앞에 [포함 | 기타] · aria-pressed · 위임', () => statics.rowToggle(src));
test("정적③: toXML 은 etc 일 때만 속성 · fromXML 은 키를 항상 · xmlRoundTrip 도 본다", () => statics.xml(src));
test('정적④: collectReportData 가 isEtcCat 으로 기타 묶기 · hourKeys(미분류 행은 __uncat__ 포함) · exclude 는 맨 마지막', () => statics.collect(src));
test('정적⑤: 다섯 호출부가 rptReportSources() · rptSources() 직접 호출은 두 곳뿐 · rptSources 는 exclude 를 모른다', () => statics.callSites(src));
test('정적⑥: netcus 출처 X 는 순수 헬퍼(netcusParsedWithout, ncRowKey)로 · 기존 순수 함수는 그대로 · 복사, 전송도 거른다', () => statics.netcus(src));
test('정적⑦: 창 단위 수명 · openReport 첫 문장 clear · closeOverlay 앵커 줄 보존 + 다음 줄 clear', () => statics.lifetime(src));
test('정적⑧: 모든 행 카드에 X · 막대 갱신이 과제 0개 가드보다 앞 · 그 가드가 excluded 를 본다', () => statics.previewX(src));
test('정적⑨: 좁은 폭(≤440px)에서 내 과제 줄은 두 줄로 나뉘고 보고서 창 X 의 히트 영역은 32px 이상', () => statics.narrowLayout(src));

test('변이①: 막대 갱신을 가드 뒤로 옮기면 정적⑧ 이 실패한다', () => {
  assert.throws(() => statics.previewX(MUT.barAfterGuard(src)), /가드보다 뒤/);
});
test('변이②: guardEdit 를 지우면 정적① 이 실패한다', () => {
  assert.throws(() => statics.setterOrder(MUT.noGuard(src)), /관문/);
});
test('변이③: 저장을 두 번 하면 정적① 이 실패한다', () => {
  assert.throws(() => statics.setterOrder(MUT.saveTwice(src)), /1회/);
});
test('변이④: XML 속성을 항상 쓰면 정적③ 이 실패한다', () => {
  assert.throws(() => statics.xml(MUT.attrAlways(src)), /etc' 일 때만|조건 없이/);
});
test('변이⑤: openReport 의 clear 를 지우면 정적⑦ 이 실패한다', () => {
  assert.throws(() => statics.lifetime(MUT.noClearOnOpen(src)), /첫 문장/);
});
test('변이⑥: 호출부 ⑤(주간 전송)를 rptSources() 로 되돌리면 정적⑤ 가 실패한다', () => {
  assert.throws(() => statics.callSites(MUT.site5(src)), /호출부 ⑤/);
});
test('변이⑦: 호출부 ③(복사)을 rptSources() 로 되돌리면 정적⑤ 가 실패한다', () => {
  assert.throws(() => statics.callSites(MUT.site3(src)), /호출부 ③/);
});
test('변이⑧: hourKeys 합산을 지우면 정적④ 가 실패한다', () => {
  assert.throws(() => statics.collect(MUT.noHourSum(src)), /hourKeys 를 합산하지 않는다/);
});
test('변이⑨: 좁은 폭 줄바꿈을 지우면 정적⑨ 가 실패한다', () => {
  assert.throws(() => statics.narrowLayout(MUT.noRowWrap(src)), /줄바꿈되지 않는다/);
});
test('변이⑩: 좁은 폭 X 하한을 지우면 정적⑨ 가 실패한다', () => {
  assert.throws(() => statics.narrowLayout(MUT.noXTouch(src)), /32px 하한/);
});

//  순수 헬퍼를 전역 없이 돌린다(extractFunction + new Function). 전역을 읽으면 ReferenceError 로 깨진다.
test('순수: netcusParsedWithout / ncRowKey 가 전역 없이 돈다 · 원본은 그대로 · excluded 는 그려진 순서', () => {
  const make = new Function(extractFunction(src, 'ncRowKey') + '\n' + extractFunction(src, 'netcusParsedWithout') + '\nreturn { ncRowKey, netcusParsedWithout };');
  const { ncRowKey, netcusParsedWithout } = make();
  const parsed = { tasks: [{ name: '알파', catId: 'c-a', matched: true, lines: [] }, { name: '베 타', catId: null, matched: false, lines: [] }],
    unclassified: [{ date: '2026-10-05', text: '머리표 없음', reason: 'no-header' }], stats: { reasons: {} } };
  assert.strictEqual(ncRowKey(parsed.tasks[0]), 'c-a', '매칭된 과제의 키가 과제 id 가 아니다(캘린더 출처와 같은 키여야 한다)');
  assert.strictEqual(ncRowKey(parsed.tasks[1]), 'nc:베타', '매칭 안 된 과제의 키가 정규화 이름이 아니다');
  assert.strictEqual(ncRowKey({ name: 'x', norm: '감마', matched: false }), 'nc:감마', '주간 병합 과제(norm)의 키가 다르다');
  const before = JSON.stringify(parsed);
  const r = netcusParsedWithout(parsed, new Map([['c-a', '알파'], ['__nc_uncat__', '미분류']]));
  assert.strictEqual(JSON.stringify(parsed), before, '원본(캐시)이 바뀌었다');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.excluded)), [{ key: 'c-a', name: '알파' }, { key: '__nc_uncat__', name: '미분류' }]);
  assert.deepStrictEqual(r.parsed.tasks.map((t) => t.name), ['베 타']);
  assert.strictEqual(r.parsed.unclassified.length, 0);
  assert.strictEqual(netcusParsedWithout(parsed, new Map()).parsed, parsed, '뺀 것이 없으면 원본 그대로여야 한다');
  const wk = { tasks: [{ name: '알파', norm: '알파', catId: 'c-a', matched: true, hours: 3, blocks: [] }, { name: '베타', norm: '베타', catId: null, matched: false, hours: 2, blocks: [] }],
    order: ['알파', '베타'], hoursByTask: { '알파': 3, '베타': 2 }, weekCount: 1 };
  const w2 = netcusParsedWithout(wk, new Map([['c-a', '알파']])).parsed;
  assert.deepStrictEqual(JSON.parse(JSON.stringify([w2.order, w2.hoursByTask])), [['베타'], { '베타': 2 }], '주간 병합 결과의 order/hoursByTask 가 함께 걸러지지 않았다');
});

/* ── 행동 — jsdom 위젯 모드 ──────────────────────────────────────────── */

const jsdomMod = await importOptional('jsdom');
const JSDOM = jsdomMod?.JSDOM || null;
const quietConsole = () => (jsdomMod && jsdomMod.VirtualConsole ? new jsdomMod.VirtualConsole() : undefined);

if (!JSDOM) {
  skip('report-include-state: jsdom 미설치 — 행동 시험을 돌리지 못했다', SKIP_NO_JSDOM,
       `이 파일의 test( 호출 ${countTestsBelow(import.meta.url, 'if (!JSDOM) {')}곳이 등록되지 않았다(정적 계수)`);
} else {
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  const META = { schemaVersion: '13', expectedSchema: '13', schemaMismatch: false, rev: 1, canWrite: true, userId: 7 };
  const CA = '2026-09-01T00:00:00Z';
  const D = '2026-10-05', WFROM = '2026-10-05', WTO = '2026-10-11';
  const CAT = (id, name, extra) => Object.assign({ id, name, color: '#3e5be0', desc: '', gitRepo: '', svnRepo: '', usesRepo: false, reportGroup: 'include', createdAt: CA }, extra || {});
  const ENT = (id, categoryId, title, extra) => Object.assign({ id, date: D, title, categoryId, allDay: true, startTime: '', endTime: '',
    memo: '', location: '', source: '', commits: [], createdAt: CA, updatedAt: CA }, extra || {});
  const TODO = (id, categoryId, text) => ({ id, text, done: false, categoryId, due: D, endDate: '', prio: 'normal', completedAt: '', note: '', dayNotes: {}, createdAt: CA, updatedAt: CA });
  //  알파(포함) · 베타(포함, 내용 없음) · 엑스(etc 후보: 일정, 커밋, 할 일 + 공수 1.5)
  const base = (withGita, xGroup) => ({
    categories: [CAT('c-a', '알파'), CAT('c-b', '베타'), CAT('c-x', '엑스', { reportGroup: xGroup || 'include' })]
      .concat(withGita ? [CAT('c-g', '기타')] : []),
    entries: [
      ENT('e-a', 'c-a', '알파 업무'),
      ENT('e-x', 'c-x', '엑스 일정'),
      ENT('e-xg', 'c-x', '엑스 작업일지', { source: 'git', commits: [{ hash: 'a'.repeat(40), short: 'aaaaaaa', time: '10:00', subject: '엑스 커밋', body: '' }] }),
    ].concat(withGita ? [ENT('e-g', 'c-g', '기타 업무')] : []),
    todos: [TODO('t-x', 'c-x', '엑스 할 일')],
    rooms: ['201호'],
    taskHours: { [D]: Object.assign({ 'c-a': 2, 'c-x': 1.5 }, withGita ? { 'c-g': 2 } : {}) },
    attendance: {},
  });

  function boot(source) {
    const log = [];
    const handlers = { saveState: { ok: true }, reloadState: { ok: true } };
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
        //  시계는 멈춰 둔다. 대신 '동작 줄이기'를 켜 닫기 애니메이션 타이머 없이 바로 닫히게 한다(확인창이 끝나야 전송이 나간다).
        win.setTimeout = () => 0;
        win.clearTimeout = () => {};
        win.matchMedia = (q) => ({ matches: /prefers-reduced-motion:\s*reduce/.test(String(q)), media: String(q),
          addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
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
    const $ = (sel) => w.document.querySelector(sel);
    const W = {
      w, log, handlers, $,
      ev: (code) => w.eval(code),
      evJSON: (code) => JSON.parse(w.eval('JSON.stringify(' + code + ')')),
      reqs: (cmd) => log.filter((x) => x.req === cmd),
      posts: (cmd) => log.filter((x) => x.post === cmd).map((x) => x.msg),
      toasts: () => log.filter((x) => x.toast).map((x) => x.toast),
      applyState: (data) => w.eval('__applyState(' + JSON.stringify(JSON.stringify(data)) + ',' + JSON.stringify(META) + ')'),
      btn: (id, act) => w.document.querySelector('#catList .cat-row[data-id="' + id + '"] [data-act="' + act + '"]'),
      row: (id) => w.document.querySelector('#catList .cat-row[data-id="' + id + '"]'),
      cards: () => [...w.document.querySelectorAll('#rptOut .rcard')].map((c) => (c.querySelector('.rcard-nm') || {}).textContent),
      xBtn: (key) => [...w.document.querySelectorAll('#rptOut .rcard-x')].find((b) => b.dataset.rx === key),
      backBtn: (key) => [...w.document.querySelectorAll('#rptExcl [data-rxback]')].find((b) => b.dataset.rxback === key),
      bar: () => w.document.querySelector('#rptExcl'),
      barText: () => { const b = w.document.querySelector('#rptExcl'); return b && !b.hidden && !b.classList.contains('hidden') ? b.textContent : ''; },
      active: () => w.document.activeElement,
      lsSnap: () => { const o = {}; const ls = w.localStorage; for (let i = 0; i < ls.length; i++) { const k = ls.key(i); o[k] = ls.getItem(k); } return JSON.parse(JSON.stringify(o)); },
      clear: () => { log.length = 0; },
      close: () => { try { w.close(); } catch (_) {} },
    };
    return W;
  }
  //  보고서 창을 연다(사람이 여는 함수) → 기간을 직접 넣고 다시 그린다(오늘 날짜에 기대지 않는다).
  async function openRpt(W, mode, from, to) {
    W.ev('openReport();');
    await settle();
    if (mode !== 'daily') { W.ev(`setReportMode(${JSON.stringify(mode)});`); await settle(); }
    W.ev(`$('#rptFrom').value=${JSON.stringify(from)}; $('#rptTo').value=${JSON.stringify(to)}; buildReport();`);
    await settle();
  }
  async function setMode(W, mode, from, to) {
    W.ev(`setReportMode(${JSON.stringify(mode)}); $('#rptFrom').value=${JSON.stringify(from)}; $('#rptTo').value=${JSON.stringify(to)}; buildReport();`);
    await settle();
  }
  async function click(W, el) { assert.ok(el, '누를 버튼이 없다'); el.focus(); el.click(); await settle(); }
  //  #btnRptSend 를 누른다. 일간은 확인창(#cfOk)을 통과시킨다. 잡은 netcus 요청을 돌려준다.
  async function send(W) {
    const before = W.log.length;
    W.ev("buildReport();");   // 직전 전송이 잠근 버튼을 미리보기 재렌더가 푼다(updateRptSendVis)
    await settle();
    const b = W.$('#btnRptSend'); assert.ok(b && !b.disabled, '#btnRptSend 가 없거나 꺼져 있다');
    b.click(); await settle();
    const cf = W.$('#confirmModal');
    if (cf && !cf.classList.contains('hidden')) { W.$('#cfOk').click(); await settle(); }
    const got = W.log.slice(before);
    return {
      daily: got.filter((x) => x.post === 'netcusSubmit').map((x) => x.msg),
      weekly: got.filter((x) => x.post === 'netcusWeekSubmit').map((x) => x.msg),
      toasts: got.filter((x) => x.toast).map((x) => x.toast),
    };
  }
  async function withApp(data, fn) {
    const W = boot(src);
    try {
      W.applyState(data);
      await settle();
      W.clear();
      return await fn(W);
    } finally { W.close(); }
  }
  async function withCatModal(W) {
    W.ev('openCatModal();');
    await settle();
  }
  const rowsOf = (W, from, to, extra) => W.evJSON(`collectReportData(${JSON.stringify(from)}, ${JSON.stringify(to)}, Object.assign(rptSources(), ${extra || '{}'})).rows.map(function(r){ return { key: r.key, name: r.name, titles: r.titles, hourKeys: r.hourKeys }; })`);

  const B = {
    //  A2 — 기타 버튼: 저장 1회 · payload etc · aria-pressed · 재주입에도 etc · 같은 값 다시 = 저장 0 · 포함으로 되돌리면 저장 1
    async toggleSaves() {
      await withApp(base(false), async (W) => {
        await withCatModal(W); W.clear();
        assert.strictEqual(W.btn('c-x', 'rg-include').getAttribute('aria-pressed'), 'true', '시작은 포함이 눌린 상태여야 한다');
        assert.strictEqual(W.btn('c-x', 'rg-etc').getAttribute('aria-pressed'), 'false');
        assert.strictEqual(W.row('c-x').querySelector('.cat-rg').getAttribute('aria-label'), '보고서 묶음: 엑스');
        await click(W, W.btn('c-x', 'rg-etc'));
        const saves = W.reqs('saveState');
        assert.strictEqual(saves.length, 1, `기타를 누르면 저장이 정확히 1번 나가야 한다(지금 ${saves.length})`);
        const sent = saves[0].params.state.categories.find((c) => c.id === 'c-x');
        assert.strictEqual(sent.reportGroup, 'etc', "저장 payload 의 그 과제가 reportGroup:'etc' 가 아니다");
        assert.strictEqual(W.btn('c-x', 'rg-etc').getAttribute('aria-pressed'), 'true', '기타가 눌린 상태로 보이지 않는다');
        assert.strictEqual(W.btn('c-x', 'rg-include').getAttribute('aria-pressed'), 'false');
        assert.strictEqual(W.active(), W.btn('c-x', 'rg-etc'), '전환 뒤 포커스가 누른 버튼에 남지 않았다(목록을 다시 그렸다)');
        //  같은 값 다시 → 저장 0
        await click(W, W.btn('c-x', 'rg-etc'));
        assert.strictEqual(W.reqs('saveState').length, 1, '같은 값을 다시 눌렀더니 저장이 또 나갔다');
        //  재주입(reloadState 와 같은 길) 뒤에도 etc
        const after = JSON.parse(JSON.stringify(saves[0].params.state));
        W.applyState(after); await settle();
        assert.strictEqual(W.ev("catReportGroup(catById('c-x'))"), 'etc', '다시 불러왔더니 기타가 풀렸다');
        await withCatModal(W);
        assert.strictEqual(W.btn('c-x', 'rg-etc').getAttribute('aria-pressed'), 'true', '다시 그린 목록에서 기타가 눌려 있지 않다');
        W.clear();
        await click(W, W.btn('c-x', 'rg-include'));
        assert.strictEqual(W.reqs('saveState').length, 1, '포함으로 되돌리면 저장 1번');
        assert.strictEqual(W.reqs('saveState')[0].params.state.categories.find((c) => c.id === 'c-x').reportGroup, 'include');
        //  없는 id → false, 저장 0
        W.clear();
        assert.strictEqual(W.ev("setCategoryReportGroup('c-none', 'etc')"), false, '없는 과제에 true 를 돌려준다');
        assert.strictEqual(W.reqs('saveState').length, 0, '없는 과제인데 저장했다');
      });
    },
    //  A6 — 서버 끊김: 값, aria-pressed, 저장 그대로 + 잠금 토스트 · __applyState 재주입(부팅 회복)으로 풀리면 정상 저장
    async lockedToggle() {
      await withApp(base(false), async (W) => {
        await withCatModal(W);
        W.ev("__dbConnLost({kind:'network'});"); await settle();
        W.clear();
        await click(W, W.btn('c-x', 'rg-etc'));
        assert.strictEqual(W.ev("catReportGroup(catById('c-x'))"), 'include', '잠긴 상태에서 값이 바뀌었다');
        assert.strictEqual(W.btn('c-x', 'rg-etc').getAttribute('aria-pressed'), 'false', '잠긴 상태에서 버튼 모양이 바뀌었다');
        assert.strictEqual(W.reqs('saveState').length, 0, '잠긴 상태에서 저장이 나갔다');
        assert.ok(W.toasts().includes('서버에 연결되지 않아 지금은 편집할 수 없습니다'), '잠금 안내 토스트가 없다: ' + JSON.stringify(W.toasts()));
        //  회복(실 위젯의 부팅 회복과 같은 길: 같은 데이터 재주입 → connOnBootApplied)
        W.applyState(base(false)); await settle();
        await withCatModal(W); W.clear();
        await click(W, W.btn('c-x', 'rg-etc'));
        assert.strictEqual(W.reqs('saveState').length, 1, '회복 뒤에도 저장이 나가지 않는다');
        assert.strictEqual(W.btn('c-x', 'rg-etc').getAttribute('aria-pressed'), 'true');
      });
    },
    //  A3 — 기타 묶기(사용자 '기타' 과제가 있을 때): 그 행으로 · 맨 뒤 · 자기 행 없음 · 공수 합산 · 복사 · 일간/주간 전송
    async groupIntoGita() {
      await withApp(base(true, 'etc'), async (W) => {
        const rows = rowsOf(W, D, D);
        assert.deepStrictEqual(rows.map((r) => r.key), ['c-a', 'c-b', 'c-g'], "엑스 행이 남았거나 '기타' 가 맨 뒤가 아니다");
        const g = rows.find((r) => r.key === 'c-g');
        for (const t of ['기타 업무', '엑스 일정', '엑스 커밋', '엑스 할 일']) assert.ok(g.titles.includes(t), `'기타' 행에 ${t} 가 없다: ${JSON.stringify(g.titles)}`);
        assert.deepStrictEqual(g.hourKeys, ['c-g', 'c-x'], "사용자 '기타' 행의 hourKeys 가 [자기 id, etc id] 가 아니다");
        assert.strictEqual(W.ev(`reportRowHours(collectReportData('${D}','${D}',rptSources()).rows.find(r=>r.key==='c-g'), '${D}')`), 3.5, '기타 행 공수가 2 + 1.5 가 아니다');
        await openRpt(W, 'daily', D, D);
        assert.deepStrictEqual(W.cards(), ['알파', '베타', '기타'], '일간 미리보기 카드가 다르다');
        assert.ok(/기타로 합친 과제 1\.5h 포함/.test(W.$('#rptOut').textContent), "일간 '기타' 카드에 합친 공수 표시가 없다");
        const txt = W.ev('buildReportText()');
        assert.ok(txt.includes('[기타] : 3.5') && !txt.includes('[엑스]'), '복사 텍스트에 [기타] : 3.5 가 없거나 [엑스] 가 남았다:\n' + txt);
        const d = await send(W);
        assert.strictEqual(d.daily.length, 1, '일간 전송(netcusSubmit)이 나가지 않았다: ' + JSON.stringify(d.toasts));
        assert.deepStrictEqual(d.daily[0].hours, [{ name: '알파', hours: 2 }, { name: '기타', hours: 3.5 }], '일간 전송 hours 가 다르다');
        assert.ok(d.daily[0].content.includes('[기타] : 3.5'), '일간 전송 본문에 [기타] : 3.5 가 없다');
        await setMode(W, 'weekly', WFROM, WTO);
        const wk = await send(W);
        assert.strictEqual(wk.weekly.length, 1, '주간 전송(netcusWeekSubmit)이 나가지 않았다: ' + JSON.stringify(wk.toasts));
        const p = wk.weekly[0];
        assert.ok(p.content.includes('[기타] : 3.5') && p.content.includes('합계 : 5.5'), '주간 content 의 기타 줄이나 합계가 다르다:\n' + p.content);
        assert.ok(/\[기타\]\n[\s\S]*엑스 커밋/.test(p.endwork) && !p.endwork.includes('[엑스]'), '주간 endwork 의 [기타] 블록에 엑스 제목이 없거나 [엑스] 가 남았다');
        assert.ok(!p.planwork.includes('[엑스]') && p.planwork.includes('[기타]'), '주간 planwork 에 [엑스] 가 남았다');
      });
    },
    //  A3 — 사용자 '기타' 과제가 없을 때: 미분류 '기타'(__uncat__) 행으로 · hourKeys 에 '__uncat__' · 공수만으로도 skipEmpty 통과
    async groupIntoUncat() {
      await withApp(base(false, 'etc'), async (W) => {
        const rows = rowsOf(W, D, D);
        assert.deepStrictEqual(rows.map((r) => r.key), ['c-a', 'c-b', '__uncat__'], '미분류 기타 행이 맨 뒤에 생기지 않았다');
        const u = rows[2];
        assert.ok(['엑스 일정', '엑스 커밋', '엑스 할 일'].every((t) => u.titles.includes(t)), '미분류 기타 행에 엑스 제목이 없다');
        assert.deepStrictEqual(u.hourKeys, ['__uncat__', 'c-x'], "미분류 기타 행의 hourKeys 가 ['__uncat__', etc id] 가 아니다");
        await openRpt(W, 'daily', D, D);
        const d = await send(W);
        assert.deepStrictEqual(d.daily[0].hours, [{ name: '알파', hours: 2 }, { name: '기타', hours: 1.5 }], '일간 전송 hours 의 기타가 1.5 가 아니다');
        assert.ok(!W.$('#rptOut [data-hcat="__uncat__"]'), '미분류 행에 입력칸이 생겼다');
        assert.ok(/기타로 합친 과제 1\.5h 포함/.test(W.$('#rptOut').textContent), '미분류 기타 카드에 합친 공수 표시가 없다');
      });
      //  공수만 있는 etc 과제(제목 0) + 내용 없는 항목 제외 → '기타' 행이 공수만으로 남는다
      const onlyHours = base(false, 'etc');
      onlyHours.entries = onlyHours.entries.filter((e) => e.categoryId !== 'c-x'); onlyHours.todos = [];
      await withApp(onlyHours, async (W) => {
        const rows = rowsOf(W, D, D, '{ skipEmpty: true }');
        assert.deepStrictEqual(rows.map((r) => r.key), ['c-a', '__uncat__'], "내용 없는 항목 제외에서 공수만 있는 '기타' 행이 빠졌다(또는 빈 베타가 남았다)");
      });
    },
    //  A4 — X: 미리보기, 복사, 일간/주간 전송에서 빠짐 · 막대 · 되돌리기 · 모두 되돌리기 · 기타 행 X · 포커스
    async xExcludes() {
      await withApp(base(false, 'etc'), async (W) => {
        await openRpt(W, 'daily', D, D);
        assert.deepStrictEqual(W.cards(), ['알파', '베타', '기타']);
        assert.strictEqual(W.barText(), '', '뺀 것이 없는데 막대가 보인다');
        const x = W.xBtn('c-a');
        assert.strictEqual(x.getAttribute('aria-label'), '이 보고서에서 빼기: 알파');
        await click(W, x);
        assert.deepStrictEqual(W.cards(), ['베타', '기타'], 'X 로 뺀 알파 카드가 남았다');
        assert.ok(W.barText().includes('뺀 과제 1개'), '막대에 뺀 과제 1개 가 없다: ' + W.barText());
        assert.strictEqual(W.backBtn('c-a').getAttribute('aria-label'), '되돌리기: 알파');
        assert.strictEqual(W.active(), W.backBtn('c-a'), 'X 뒤 포커스가 그 과제의 되돌리기 버튼이 아니다');
        assert.ok(!W.ev('buildReportText()').includes('[알파]'), '복사 텍스트에 [알파] 가 남았다');
        const d = await send(W);
        assert.deepStrictEqual(d.daily[0].hours, [{ name: '기타', hours: 1.5 }], '일간 전송 hours 에 알파가 남았다');
        assert.ok(!d.daily[0].content.includes('[알파]'), '일간 전송 본문에 [알파] 가 남았다');
        //  되돌리기 → 원래 자리 · 포커스는 되살아난 카드의 X
        await click(W, W.backBtn('c-a'));
        assert.deepStrictEqual(W.cards(), ['알파', '베타', '기타'], '되돌리기 뒤 원래 순서가 아니다');
        assert.strictEqual(W.barText(), '', '되돌린 뒤에도 막대가 보인다');
        assert.strictEqual(W.active(), W.xBtn('c-a'), '되돌리기 뒤 포커스가 되살아난 카드의 X 가 아니다');
        //  둘 빼고(기타 행 포함) 모두 되돌리기
        await click(W, W.xBtn('c-b'));
        await click(W, W.xBtn('__uncat__'));
        assert.deepStrictEqual(W.cards(), ['알파'], "'기타' 행의 X 가 동작하지 않는다");
        assert.ok(W.barText().includes('뺀 과제 2개'));
        await click(W, W.$('#rptExcl [data-rxall]'));
        assert.deepStrictEqual(W.cards(), ['알파', '베타', '기타'], '모두 되돌리기 뒤 전부 돌아오지 않았다');
        assert.strictEqual(W.active(), W.xBtn('c-a'), '모두 되돌리기 뒤 포커스가 첫 카드의 X 가 아니다');
        //  주간 탭: X → 주간 전송 content/endwork/planwork 에서 빠지고 합계가 준다
        await setMode(W, 'weekly', WFROM, WTO);
        const w0 = (await send(W)).weekly[0];
        assert.ok(w0.content.includes('합계 : 3.5'), '주간 기준 합계가 3.5 가 아니다:\n' + w0.content);
        await click(W, W.xBtn('c-a'));
        const w1 = (await send(W)).weekly[0];
        assert.ok(!w1.content.includes('[알파]') && !w1.endwork.includes('[알파]') && !w1.planwork.includes('[알파]'), '주간 전송에 [알파] 가 남았다');
        assert.ok(w1.content.includes('합계 : 1.5'), '주간 합계가 알파만큼 줄지 않았다:\n' + w1.content);
        //  두 번 넣기, 없는 키 되돌리기 → 오류 없음, 개수 정확
        W.ev("rptExcluded.set('c-a','알파'); rptExcluded.delete('c-none'); buildReport();"); await settle();
        assert.ok(W.barText().includes('뺀 과제 1개'), '같은 키를 두 번 넣었더니 개수가 틀렸다');
      });
    },
    //  A4-탭 — 일간에서 뺀 상태가 주간 → 기간 취합 → 일간을 오가도 유지된다
    async xAcrossTabs() {
      await withApp(base(false, 'etc'), async (W) => {
        await openRpt(W, 'daily', D, D);
        await click(W, W.xBtn('c-a'));
        for (const [m, f, t] of [['weekly', WFROM, WTO], ['custom', '2026-10-01', '2026-10-31'], ['daily', D, D]]) {
          await setMode(W, m, f, t);
          assert.ok(W.barText().includes('뺀 과제 1개'), `${m} 탭에서 막대가 사라졌다`);
          assert.ok(!W.cards().includes('알파'), `${m} 탭에 알파 카드가 다시 보인다`);
        }
      });
    },
    //  A4-전부 — 전부 빼기: 미리보기 비움 · 요약 문구 · 막대 · 복사/전송 없음 · 모두 되돌리기
    async xAll() {
      await withApp(base(false, 'etc'), async (W) => {
        await openRpt(W, 'daily', D, D);
        for (const k of ['c-a', 'c-b', '__uncat__']) await click(W, W.xBtn(k));
        assert.strictEqual(W.$('#rptOut').innerHTML, '', '전부 뺐는데 미리보기가 비지 않았다');
        assert.strictEqual(W.$('#rptSummary').textContent, '모든 과제를 뺐습니다. 되돌리기로 다시 넣을 수 있습니다', '전부 뺐을 때 요약줄이 다르다');
        assert.ok(W.barText().includes('뺀 과제 3개') && W.barText().includes('모두 되돌리기'), '전부 뺐을 때 막대가 보이지 않는다');
        assert.strictEqual(W.ev('buildReportText()'), '', '전부 뺐는데 복사 텍스트가 있다');
        W.clear(); W.ev('copyReport();'); await settle();
        assert.ok(W.toasts().includes('복사할 내용이 없습니다'), '복사 안내 토스트가 없다');
        const d = await send(W);
        assert.ok(d.toasts.includes('보낼 내용이 없습니다') && d.daily.length === 0, '전부 뺐는데 일간 전송이 나갔다');
        await setMode(W, 'weekly', WFROM, WTO);
        const wk = await send(W);
        assert.ok(wk.toasts.includes('보낼 내용이 없습니다') && wk.weekly.length === 0, '전부 뺐는데 주간 전송이 나갔다');
        await click(W, W.$('#rptExcl [data-rxall]'));
        assert.deepStrictEqual(W.cards(), ['알파', '베타', '기타'], '모두 되돌리기 뒤 전부 돌아오지 않았다');
      });
    },
    //  A4-유령 — X 로 뺀 과제를 내 과제에서 기타로 바꾸면 막대에서 빠지고(유령 키), 다시 포함하면 빠진 채로 돌아온다
    async xGhost() {
      await withApp(base(false), async (W) => {
        await openRpt(W, 'daily', D, D);
        await click(W, W.xBtn('c-x'));
        assert.ok(W.barText().includes('뺀 과제 1개'));
        await withCatModal(W);
        await click(W, W.btn('c-x', 'rg-etc'));
        assert.strictEqual(W.barText(), '', '기타로 바꿔 행이 사라진 과제가 막대에 남았다(유령 키)');
        await click(W, W.btn('c-x', 'rg-include'));
        assert.ok(W.barText().includes('뺀 과제 1개') && !W.cards().includes('엑스'), '다시 포함으로 돌렸더니 빠진 상태가 풀렸다(창 안에서는 유지돼야 한다)');
      });
    },
    //  A5 — 창 닫았다 다시 열면 전부 복귀 · localStorage 모든 키와 값 불변 · 그 사이 쓰기 요청 0
    async xLifetime() {
      await withApp(base(false), async (W) => {
        //  예열: 보고서를 한 번 열면 체크박스 선택(tc_rptSources)이 기존 동작대로 저장된다. X 가 그 위에 아무것도 더하지 않는지를 본다.
        await openRpt(W, 'daily', D, D); W.ev("closeModal('#reportModal');"); await settle();
        const s0 = W.lsSnap();
        W.clear();
        await openRpt(W, 'daily', D, D);
        await click(W, W.xBtn('c-a')); await click(W, W.xBtn('c-x'));
        const s1 = W.lsSnap();
        W.ev("closeModal('#reportModal');"); await settle();
        assert.strictEqual(W.evJSON('rptExcluded.size'), 0, '창을 닫았는데 뺀 과제가 남았다');
        const s2 = W.lsSnap();
        await openRpt(W, 'daily', D, D);
        const s3 = W.lsSnap();
        assert.deepStrictEqual(W.cards(), ['알파', '베타', '엑스'], '다시 연 창에 뺀 과제가 돌아오지 않았다');
        assert.strictEqual(W.barText(), '', '다시 연 창에 막대가 보인다');
        assert.deepStrictEqual(s1, s0, 'X 뒤 localStorage 가 바뀌었다'); assert.deepStrictEqual(s2, s0, '닫은 뒤 localStorage 가 바뀌었다'); assert.deepStrictEqual(s3, s0, '다시 연 뒤 localStorage 가 바뀌었다');
        assert.ok(!JSON.stringify(s3).includes('exclude'), 'localStorage 에 exclude 가 섞였다');
        const writes = W.log.filter((x) => x.req && /save|replace|write|set/i.test(x.req)).map((x) => x.req);
        assert.deepStrictEqual(writes, [], '그 사이 쓰기 요청이 나갔다: ' + JSON.stringify(writes));
      });
    },
    //  A4-netcus — net(일간 병합, 주간 탭)과 week(주간 병합, 기간 취합)에서도 X · 복사 · 'net' 주간 전송 · 기타 묶기 없음
    async xNetcus() {
      //  알파 = etc 인데도 netcus 출처에서는 자기 카드로 보인다(기타 묶기는 캘린더 출처에만)
      const data = { categories: [CAT('c-al', '알파', { reportGroup: 'etc' }), CAT('c-be', '베타')], entries: [], todos: [], rooms: ['201호'], taskHours: {}, attendance: {} };
      await withApp(data, async (W) => {
        await openRpt(W, 'weekly', WFROM, WTO);
        const days = [{ date: WFROM, ok: true, content: '머리표 없는 줄\n[알파] : 2\n알파 작업 A' }, { date: '2026-10-06', ok: true, content: '[베타] : 1\n베타 작업 B' }];
        W.ev(`state.reportSource='net'; syncReportSourceSeg(); netcusMerge = { key: ncMergeKey('${WFROM}','${WTO}'), parsed: parseNetcusWeek(${JSON.stringify(days)}, state.categories, { sumTime: true }), at: '09:00' }; renderNetcusPreview(netcusMerge.parsed, netcusMerge.at);`);
        await settle();
        assert.deepStrictEqual(W.cards(), ['[알파]', '[베타]', '[미분류]'], 'netcus 미리보기 카드가 다르다(etc 과제도 자기 이름 카드여야 한다)');
        await click(W, W.xBtn('c-al'));
        assert.deepStrictEqual(W.cards(), ['[베타]', '[미분류]'], 'netcus 미리보기에서 X 로 뺀 알파 카드가 남았다');
        assert.ok(W.barText().includes('뺀 과제 1개'));
        assert.strictEqual(W.active(), W.backBtn('c-al'), 'netcus 출처에서도 X 뒤 포커스가 되돌리기 버튼이어야 한다');
        assert.ok(!W.ev('buildReportText()').includes('[알파]'), 'net 출처 복사 텍스트에 [알파] 가 남았다');
        const p = (await send(W)).weekly[0];
        assert.ok(p, "'net' 주간 전송이 나가지 않았다");
        assert.ok(!p.endwork.includes('[알파]') && !p.planwork.includes('[알파]'), "'net' 주간 전송에 [알파] 가 남았다");
        assert.strictEqual(p.content, '[베타] : 1\n-----\n합계 : 1', "'net' 주간 전송 content 가 [베타] : 1 / 합계 : 1 이 아니다");
        assert.strictEqual(W.ev("netcusMerge.parsed.tasks.length"), 2, '캐시(netcusMerge.parsed)를 직접 바꿨다(그릴 때마다 걸러야 한다)');
        await click(W, W.xBtn('__nc_uncat__'));
        assert.deepStrictEqual(W.cards(), ['[베타]'], "'[미분류]' 카드의 X 가 동작하지 않는다");
        assert.ok(!W.ev('buildReportText()').includes('[미분류]'));
        await click(W, W.$('#rptExcl [data-rxall]'));
        assert.deepStrictEqual(W.cards(), ['[알파]', '[베타]', '[미분류]'], 'netcus 출처에서 모두 되돌리기가 전부 돌려놓지 않았다');
        //  week(주간 병합) — 기간 취합 탭
        await setMode(W, 'custom', '2026-10-01', '2026-10-31');
        const weeks = [{ regdate: '2026-10-10', title: '10월 첫째주', period: '10/05~10/09', endwork: '[알파]\n- 알파 주간 일\n[베타]\n- 베타 주간 일', content: '[알파] : 3\n[베타] : 2\n합계 : 5', plan: '' }];
        W.ev(`state.reportSource='week'; syncReportSourceSeg(); netcusWeeklyMerge = { key: ncMergeKey('2026-10-01','2026-10-31'), parsed: parseNetcusWeekly(${JSON.stringify(weeks)}, state.categories), at: '09:00' }; renderNetcusWeeklyPreview(netcusWeeklyMerge.parsed, netcusWeeklyMerge.at);`);
        await settle();
        assert.deepStrictEqual(W.cards(), ['[알파]', '[베타]']);
        await click(W, W.xBtn('c-al'));
        assert.deepStrictEqual(W.cards(), ['[베타]'], 'week 출처에서 X 가 동작하지 않는다');
        const t = W.ev('buildReportText()');
        assert.ok(!t.includes('[알파]') && t.includes('[베타]'), 'week 출처 복사 텍스트에서 알파가 빠지지 않았다:\n' + t);
      });
    },
    //  A7 — XML 왕복 · 옛 XML · 이상값 · 가져오기(교체) 사용자 경로
    async xml() {
      const data = base(false); data.categories[1].reportGroup = 'etc';
      await withApp(data, async (W) => {
        const xml = W.ev('toXML()');
        assert.strictEqual((xml.match(/reportGroup="etc"/g) || []).length, 1, 'etc 과제에만 reportGroup 속성이 있어야 한다');
        assert.ok(/<category id="c-b"[^>]*reportGroup="etc"/.test(xml) && !/<category id="c-a"[^>]*reportGroup/.test(xml), '속성이 다른 과제에 붙었다');
        const back = W.evJSON(`fromXML(${JSON.stringify(xml)}).categories.map(function(c){ return [c.id, c.reportGroup]; })`);
        assert.deepStrictEqual(back, [['c-a', 'include'], ['c-b', 'etc'], ['c-x', 'include']], 'XML 왕복에서 reportGroup 이 보존되지 않았다');
        const old = xml.replace(/ reportGroup="etc"/g, '');
        assert.deepStrictEqual(W.evJSON(`fromXML(${JSON.stringify(old)}).categories.map(function(c){ return c.reportGroup; })`), ['include', 'include', 'include'], '속성 없는 옛 XML 이 전부 include 가 아니다');
        const odd = xml.replace('reportGroup="etc"', 'reportGroup="exclude"');
        assert.strictEqual(W.evJSON(`fromXML(${JSON.stringify(odd)}).categories[1].reportGroup`), 'include', "reportGroup=\"exclude\" 가 include 로 읽히지 않는다");
        assert.strictEqual(W.evJSON('xmlRoundTrip().ok'), true, '앱 자체 왕복 검증이 실패한다');
        //  사용자 경로: 가져오기(교체) → 호스트가 받는 replaceAllState
        W.handlers.replaceAllState = { ok: true };
        W.clear();
        W.ev(`pendingImport = fromXML(${JSON.stringify(xml)});`);
        W.ev("applyImport('replace');"); await settle();
        const ra = W.reqs('replaceAllState');
        assert.strictEqual(ra.length, 1, '가져오기(교체)가 replaceAllState 를 보내지 않았다: ' + JSON.stringify(W.log.map((x) => x.req || x.post || x.toast)));
        //  jsdom 렐름의 배열은 deepStrictEqual 에서 프로토타입이 갈린다. JSON 으로 이 렐름에 옮긴다.
        assert.deepStrictEqual(JSON.parse(JSON.stringify(ra[0].params.state.categories.map((c) => [c.id, c.reportGroup]))), [['c-a', 'include'], ['c-b', 'etc'], ['c-x', 'include']], '교체 요청의 reportGroup 이 다르다');
      });
    },
    //  보존 — 수정 폼(updateCategory), 공식 과제 재편입(subscribeDbCat)과 syncSubscribedDbMeta 가 etc 를 지우지 않는다
    async preserve() {
      const data = base(false); data.categories[2].reportGroup = 'etc';
      data.categories.push(CAT('db-o', '공식 오메가', { source: 'db', reportGroup: 'etc' }));
      await withApp(data, async (W) => {
        W.ev("updateCategory('c-x', '엑스2', '#123456', '설명', '', '');"); await settle();
        const sv = W.reqs('saveState');
        assert.ok(sv.length >= 1, '수정 저장이 나가지 않았다');
        assert.strictEqual(sv[sv.length - 1].params.state.categories.find((c) => c.id === 'c-x').reportGroup, 'etc', '수정 폼 저장이 reportGroup 을 지웠다');
        W.ev("subscribeDbCat({ id: 'db-o', name: '공식 오메가 새이름' });");
        assert.strictEqual(W.ev("catById('db-o').reportGroup"), 'etc', '공식 과제 재편입이 reportGroup 을 지웠다');
        W.ev("dbOnline = true; dbCatalog = [{ id: 'db-o', name: '공식 오메가 DB', source: 'db' }]; syncSubscribedDbMeta();");
        assert.strictEqual(W.ev("catById('db-o').name"), '공식 오메가 DB', 'syncSubscribedDbMeta 가 돌지 않았다(시험 준비 문제)');
        assert.strictEqual(W.ev("catById('db-o').reportGroup"), 'etc', 'syncSubscribedDbMeta 가 reportGroup 을 지웠다');
      });
    },
    //  부정 — reportGroup 이 1/null/'ETC'/'exclude' 인 과제는 포함으로 동작(자기 행 · 포함 눌림)
    async oddValues() {
      const data = base(false);
      data.categories = [CAT('c-a', '알파', { reportGroup: 1 }), CAT('c-b', '베타', { reportGroup: null }), CAT('c-x', '엑스', { reportGroup: 'ETC' }), CAT('c-y', '와이', { reportGroup: 'exclude' })];
      await withApp(data, async (W) => {
        assert.deepStrictEqual(rowsOf(W, D, D).map((r) => r.key), ['c-a', 'c-b', 'c-x', 'c-y'], '이상값 과제가 포함 행으로 나오지 않는다');
        await withCatModal(W);
        for (const id of ['c-a', 'c-b', 'c-x', 'c-y']) assert.strictEqual(W.btn(id, 'rg-include').getAttribute('aria-pressed'), 'true', `${id} 가 포함으로 그려지지 않는다`);
        W.clear();
        await click(W, W.btn('c-x', 'rg-include'));
        assert.strictEqual(W.reqs('saveState').length, 0, "'ETC'(포함으로 읽힘)에 포함을 눌렀더니 저장이 나갔다");
      });
    },
  };

  test('A2: [기타] 누르면 저장 1회 · payload etc · aria-pressed · 재주입에도 etc · 같은 값 = 저장 0 · 없는 id = false', () => B.toggleSaves());
  test('A6: 서버 끊김 중 전환은 변화 0 + 잠금 토스트 · 재주입(부팅 회복) 뒤 정상 저장', () => B.lockedToggle());
  test("A3: 사용자 '기타' 과제로 묶기 · 맨 뒤 · 공수 3.5 · 복사 · 일간 hours · 주간 content/endwork/planwork", () => B.groupIntoGita());
  test("A3: 미분류 '기타'(__uncat__)로 묶기 · hourKeys 에 __uncat__ · 공수만으로 skipEmpty 통과", () => B.groupIntoUncat());
  test('A4: X 는 미리보기, 복사, 일간/주간 전송에서 함께 빠진다 · 막대 · 되돌리기 · 모두 되돌리기 · 기타 행 X · 포커스', () => B.xExcludes());
  test('A4-탭: 뺀 상태가 일간 → 주간 → 기간 취합 → 일간 을 오가도 유지된다', () => B.xAcrossTabs());
  test('A4-전부: 전부 빼면 미리보기 비움 · 요약 문구 · 복사/전송 없음 · 모두 되돌리기', () => B.xAll());
  test('A4-유령: 뺀 과제를 기타로 바꾸면 막대에서 빠지고, 다시 포함하면 빠진 채로 돌아온다', () => B.xGhost());
  test('A5: 창을 닫았다 열면 전부 복귀 · localStorage 모든 키와 값 불변 · 쓰기 요청 0', () => B.xLifetime());
  test("A4-netcus: net/week 출처 미리보기, 복사, 'net' 주간 전송에서 X · 미분류 X · 기타 묶기 없음", () => B.xNetcus());
  test('A7: XML 왕복 etc 보존 · 옛 XML 전부 include · exclude 는 include · 가져오기(교체) payload', () => B.xml());
  test('보존: 수정 폼 저장, 공식 과제 재편입, syncSubscribedDbMeta 가 etc 를 지우지 않는다', () => B.preserve());
  test("부정: reportGroup 1/null/'ETC'/'exclude' 는 포함으로 동작 · 같은 값 = 저장 0", () => B.oddValues());
}
