#!/usr/bin/env node
/* =====================================================================================
 * tests/loop-ui-visual.mjs — 실제 화면 기반 UI 루프 테스트(레이아웃 결함 자동 검출)
 *
 * ★ 이 파일은 `node tests/run-tests.mjs`의 기본 스위트에 포함되지 않는다.
 *   러너는 `readdirSync(tests).filter(f => f.endsWith('.test.mjs'))`로만 수집하므로
 *   확장자를 `.mjs`(≠ `.test.mjs`)로 둔 것만으로 자동수집에서 빠진다(러너 수정 없음).
 *   → **개명 금지**. `*.test.mjs`로 바꾸면 CI가 라이브 위젯을 요구하게 되어 깨진다.
 *
 * 왜 필요한가:
 *   tests/loop-ui-integrity.mjs는 **데이터 정합성**(DB↔UI 값)을 본다. 그런데 실제로 나온 결함은
 *   **레이아웃**이었다 — 공식 과제 상세 액션 바가 '필요 275px vs 가용 274px'로 1px 모자라 통째로
 *   두 줄로 밀렸고, 재연결 픽커는 평문 나열 + min-width:0 누락으로 값이 밀렸다. 둘 다 우연히 발견됐다.
 *   이 하네스는 그걸 폭×테마×화면×데이터 조합으로 **기계적으로** 잡는다.
 *   목표는 '픽셀 완벽'이 아니라 **명백한 레이아웃 결함의 검출**이다 — 애매하면 warn으로 내린다.
 *
 * 무엇을 하나:
 *   이미 떠 있는 위젯(TC_DEBUG_PORT=9222)에 CDP로 붙어
 *     Emulation.setDeviceMetricsOverride로 뷰포트를 바꾸고(폭·높이 축),
 *     applyTheme()로 테마를 바꾸고(테마 축),
 *     앱의 open* 함수로 화면을 열고(화면 축),
 *     __applyProjects(JSON)로 **화면에만** 더미 카탈로그를 주입한 뒤(데이터 축),
 *   각 상태에서 DOM을 훑어 10종의 레이아웃 결함(V1~V10)을 판정한다. 위반 상태는 스크린샷을 남긴다.
 *
 * 이 스크립트가 하지 않는 것(안전 규약):
 *   · 위젯 실행/종료를 하지 않는다(9222에 이미 붙어 있어야 한다).
 *   · **DB에 쓰지 않는다** — MySQL을 아예 건드리지 않는다(읽기조차 안 한다).
 *   · **디스크에 쓰지 않는다** — 시작 시 window.save를 무해한 스텁으로 바꾸고 끝나면 되돌린다.
 *     더미 주입이 state.categories를 흔들어도(자동 편입·dbGone 마크) data.xml에 새지 않는다.
 *   · 종료 시 테마·카탈로그·state.categories·뷰포트를 **원래대로 복원**한다(정상·예외 양쪽 경로에서).
 *
 * 실행:
 *   node tests/loop-ui-visual.mjs                          # 기본 계획 전체
 *   node tests/loop-ui-visual.mjs --widths=320,900 --themes=light,dark
 *   node tests/loop-ui-visual.mjs --screens=officialModal.subbed,relinkPickModal
 *   node tests/loop-ui-visual.mjs --shot-all                # 위반 없어도 전부 캡처
 *
 * 종료코드: violation 0 → 0, 아니면 1. (warn·판정불가는 종료코드에 영향 없음)
 * ===================================================================================== */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SHOT_DIR = join(ROOT, 'dist', 'ui-shots');   // dist/는 .gitignore 대상

/* ────────────────────────────── 0. 축 정의 ────────────────────────────── */

// 위젯 창의 최소 크기가 MinWidth=300 MinHeight=320(widget/MainWindow.xaml)이라
// 그 아래 폭은 실제로 발생하지 않는다. 320=최소 실폭, 400=기본 위젯 폭, 600/900=중간, 1400=넓게 보기.
const ALL_WIDTHS = [320, 400, 600, 900, 1400];
// 'system'은 light/dark 중 하나로 귀결되므로(effectiveDark) 별도 축이 아니다 — 제외.
const ALL_THEMES = ['light', 'dark', 'forest', 'sepia', 'contrast'];

/** 화면 단위 — id, 여는 코드(페이지 JS), 목록 로딩 대기 여부, 데이터 의존성 */
const SCREENS = [
  { id: 'base',                    enter: '__vt.closeAll()' },
  { id: 'categoryModal',           enter: '__vt.closeAll(); openCatModal()' },
  { id: 'categoryModal.editMine',  enter: '__vt.closeAll(); openCatModal(); __vt.catEdit("mine")' },
  { id: 'categoryModal.editDb',    enter: '__vt.closeAll(); __vt.ensureSub(0); openCatModal(); __vt.catEdit("db")', needsCatalog: true },
  { id: 'officialModal',           enter: '__vt.closeAll(); openOfficialModal()' },
  { id: 'officialModal.unsubbed',  enter: '__vt.closeAll(); __vt.ensureUnsub(0); openOfficialModal(); __vt.offSelect(0)', needsCatalog: true },
  { id: 'officialModal.subbed',    enter: '__vt.closeAll(); __vt.ensureSub(0); openOfficialModal(); __vt.offSelect(0)', needsCatalog: true },
  { id: 'officialEditModal.new',   enter: '__vt.closeAll(); offEditOpen("")' },
  { id: 'officialEditModal.edit',  enter: '__vt.closeAll(); offEditOpen(__vt.catId(0))', needsCatalog: true },
  { id: 'customerModal',           enter: '__vt.closeAll(); openCustomerModal()', waitList: '#custList' },
  { id: 'codeModal.section',       enter: '__vt.closeAll(); openCodeModal("section")', waitList: '#codeList' },
  { id: 'codeModal.status',        enter: '__vt.closeAll(); openCodeModal("status")', waitList: '#codeList' },
  { id: 'relinkModal',             enter: '__vt.closeAll(); openRelinkModal()' },
  { id: 'relinkPickModal',         enter: '__vt.closeAll(); openRelinkPick(__vt.mineId())', needsCatalog: true },
  { id: 'settingsModal',           enter: '__vt.closeAll(); openSettings()' },
  { id: 'reportModal',             enter: '__vt.closeAll(); openReport()' },
  { id: 'patchModal',              enter: '__vt.closeAll(); openPatch()' },
  { id: 'helpModal',               enter: '__vt.closeAll(); openHelp()' },
  // 문의(버그 리포트) — 로그 폴더 열기 버튼 + 반출 경고가 좁은 폭에서 잘리지 않아야 한다(320px 시트)
  { id: 'feedbackModal',           enter: '__vt.closeAll(); openFeedback()' },
];

/** 데이터 상태 — DB는 절대 건드리지 않고 __applyProjects로 **화면에만** 주입 */
const DATA_STATES = {
  real:    { label: '보통(실 DB 카탈로그)', apply: null },                       // 부팅 시 로드된 그대로
  empty:   { label: '빈 목록(온라인·0건)',  apply: '__vt.applyRows([])' },
  long:    { label: '긴 이름·많은 건수',    apply: '__vt.applyRows(__vt.longRows(60))' },
  offline: { label: '오프라인(빈 카탈로그)', apply: '__vt.applyOffline()' },
};

/* ────────────────────────────── 1. 예외 목록(오탐 억제) ──────────────────────────────
 * 규칙: 예외는 **근거**와 함께만 넣는다(어느 CSS/HTML이 그렇게 의도했는지).
 * 근거 없는 예외는 결함을 지우는 것과 같다. */
const EXEMPT = {
  // V1 가로 스크롤 — 의도적으로 가로 스크롤을 쓰는 컨테이너
  hscroll: [
    // 좁은 폭(≤440px)에서 필터바를 '2줄 wrap → 1줄 가로 스크롤'로 바꾸는 것은 설계다.
    // 근거: CSS `@media (max-width:440px){ .filterbar{flex-wrap:nowrap;overflow-x:auto;...} }`
    //       + `.ovf-scroll`(스크롤바 숨김·페이드) 클래스가 같은 요소에 붙어 있다.
    '#filterbar', '.ovf-scroll',
  ],
  // V3 액션 바 줄바꿈 — 여러 줄이 정상인 wrap 컨테이너
  btnWrap: [
    // 색상 팔레트는 스와치 격자(줄바꿈이 곧 레이아웃)다. 근거: renderPalette()가 .sw 버튼을 N개 깔고
    // CSS `.palette{display:flex;flex-wrap:wrap}`로 접는다 — '한 줄에 다 들어가야 하는 바'가 아니다.
    '#cPalette', '.palette',
    // 테마 선택 메뉴는 세로 목록(버튼 6개가 각 줄). 근거: `#themeMenu`는 드롭다운 패널이다.
    '#themeMenu',
  ],
  // V4 겹침 — 의도적으로 겹치는 구조
  overlap: [],
  // V7 터치 타깃 — 인라인 텍스트 링크는 '버튼'이 아니라 문장 안 링크라 높이 규범이 다르다.
  smallTargetWarnOnly: ['a', '.lnk', '.link', '.off-subtick'],
  // V8 대비 — 없음(대비는 예외 대신 '판정 불가'로 뺀다)
};

/* ────────────────────────────── 2. 인자 ────────────────────────────── */

function printHelp() {
  console.log(`사용법: node tests/loop-ui-visual.mjs [옵션]
  --widths=320,900       폭 목록(기본 ${ALL_WIDTHS.join(',')})
  --themes=light,dark    테마 목록(기본 ${ALL_THEMES.join(',')})
  --screens=a,b          화면 목록(기본 전체 ${SCREENS.length}종)
  --data=real,long       데이터 상태(기본 real,empty,long,offline)
  --heights=700,320      높이(기본 700 + 최소높이 320 대표 케이스)
  --selftest             검출기 자체 검증 — 일부러 깨진 마크업을 심어 V1~V10이 켜지는지 확인
  --shot-all             위반이 없어도 모든 상태를 캡처(기본은 위반 상태만)
  --port=9222            CDP 포트
  --no-restore           종료 시 복원 생략(디버깅용 — 평소엔 쓰지 말 것)
  -v, --verbose          상태별 진행 로그
  -h, --help             이 도움말

화면 id: ${SCREENS.map((s) => s.id).join(', ')}`);
}

function parseArgs(argv) {
  const o = {
    port: 9222, widths: ALL_WIDTHS.slice(), themes: ALL_THEMES.slice(),
    screens: SCREENS.map((s) => s.id), data: ['real', 'empty', 'long', 'offline'],
    heights: [700, 320], shotAll: false, restore: true, verbose: false, selftest: false,
  };
  const list = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
  for (const a of argv) {
    let m;
    if ((m = /^--widths=(.+)$/.exec(a))) o.widths = list(m[1]).map(Number).filter((n) => n > 0);
    else if ((m = /^--themes=(.+)$/.exec(a))) o.themes = list(m[1]);
    else if ((m = /^--screens=(.+)$/.exec(a))) o.screens = list(m[1]);
    else if ((m = /^--data=(.+)$/.exec(a))) o.data = list(m[1]);
    else if ((m = /^--heights=(.+)$/.exec(a))) o.heights = list(m[1]).map(Number).filter((n) => n > 0);
    else if ((m = /^--port=(\d+)$/.exec(a))) o.port = Number(m[1]);
    else if (a === '--selftest') o.selftest = true;
    else if (a === '--shot-all') o.shotAll = true;
    else if (a === '--no-restore') o.restore = false;
    else if (a === '-v' || a === '--verbose') o.verbose = true;
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else { console.error('알 수 없는 인자: ' + a); printHelp(); process.exit(2); }
  }
  const badT = o.themes.filter((t) => !ALL_THEMES.includes(t));
  if (badT.length) { console.error('알 수 없는 테마: ' + badT.join(',')); process.exit(2); }
  const ids = SCREENS.map((s) => s.id);
  const badS = o.screens.filter((s) => !ids.includes(s));
  if (badS.length) { console.error('알 수 없는 화면: ' + badS.join(',')); process.exit(2); }
  const badD = o.data.filter((d) => !DATA_STATES[d]);
  if (badD.length) { console.error('알 수 없는 데이터 상태: ' + badD.join(',')); process.exit(2); }
  return o;
}

const OPT = parseArgs(process.argv.slice(2));

/* ────────────────────────────── 3. 로그 ────────────────────────────── */

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const log = (...a) => console.log(el(), ...a);
const vlog = (...a) => { if (OPT.verbose) console.log(el(), '   ·', ...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ────────────────────────────── 4. CDP 클라이언트 ────────────────────────────── */
// node v24 전역 WebSocket/fetch 사용(ws 모듈 없음 · 설치 금지).

class Cdp {
  #ws = null; #id = 0; #pending = new Map(); #closed = false;

  static async attach(port) {
    let list;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) });
      list = await res.json();
    } catch (e) {
      throw new Error(
        `CDP 엔드포인트(http://127.0.0.1:${port}/json)에 붙지 못했습니다.\n` +
        `  → 위젯을 TC_DEBUG_PORT=${port} 환경변수와 함께 먼저 띄운 뒤 다시 실행하세요.\n` +
        `  (이 스크립트는 위젯을 직접 실행하지 않습니다.)  원인: ${e.message}`);
    }
    const pages = (Array.isArray(list) ? list : []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!pages.length) throw new Error(`CDP page 타겟이 없습니다(포트 ${port}). 위젯 WebView2가 준비됐는지 확인하세요.`);
    const t = pages.find((p) => /tcapp\.local/i.test(p.url || '')) || pages[0];
    const c = new Cdp();
    await c.#connect(t.webSocketDebuggerUrl);
    c.target = t;
    return c;
  }

  async #connect(url) {
    const ws = new WebSocket(url);
    this.#ws = ws;
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('WebSocket 연결 시간 초과: ' + url)), 10000);
      ws.addEventListener('open', () => { clearTimeout(to); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(to); reject(new Error('WebSocket 연결 실패: ' + url)); }, { once: true });
    });
    ws.addEventListener('close', () => { this.#closed = true; });
    ws.addEventListener('message', (evt) => {
      let m; try { m = JSON.parse(typeof evt.data === 'string' ? evt.data : String(evt.data)); } catch (_) { return; }
      if (m.id == null) return;
      const p = this.#pending.get(m.id); if (!p) return;
      this.#pending.delete(m.id); clearTimeout(p.to);
      if (m.error) p.reject(new Error(`CDP 오류(${m.error.code}): ${m.error.message}`));
      else p.resolve(m.result);
    });
  }

  send(method, params = {}) {
    if (this.#closed) return Promise.reject(new Error('CDP 연결이 끊겼습니다(위젯 종료?)'));
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { this.#pending.delete(id); reject(new Error('CDP 응답 시간 초과: ' + method)); }, 40000);
      this.#pending.set(id, { resolve, reject, to });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 페이지 전역 스코프에서 식 평가(최상위 let — state·dbCatalog·dbOnline 등도 그대로 참조된다) */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const msg = (d.exception && (d.exception.description || d.exception.value)) || d.text || '알 수 없는 예외';
      throw new Error('페이지 JS 예외: ' + String(msg).split('\n').slice(0, 2).join(' | '));
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.#ws && this.#ws.close(); } catch (_) { } }
}

/* ────────────────────────────── 5. 페이지 감사 스크립트(__vt) ──────────────────────────────
 * 앱 코드는 건드리지 않는다. 측정(getComputedStyle/getBoundingClientRect)과 화면 전환만 제공.
 * ★ save()는 여기서 무해한 스텁으로 갈아끼운다 — 이 하네스는 디스크에 아무것도 쓰면 안 된다. */

const INSTALL_JS = String.raw`(function(){
/* 매 실행마다 새로 심는다(코드 수정 반영). 단 '원본 스냅샷'은 첫 설치분을 물려받는다 —
   안 그러면 2회차에 이미 스텁인 save를 원본으로 착각해 영구히 되돌릴 수 없게 된다. */
var prev = window.__vt;
var V = { v:2, saveCalls:0, reinstalled: !!prev };
window.__vt = V;

/* ── 0) 안전장치: save() 스텁 + 원본 상태 스냅샷 ── */
V._realSave = prev ? prev._realSave : window.save;
window.save = function(){ V.saveCalls++; };               // 디스크·호스트 쓰기 차단
V._snapCats = prev ? prev._snapCats : JSON.parse(JSON.stringify(state.categories));
V._realRows = prev ? prev._realRows : (typeof dbCatalog !== 'undefined' ? dbCatalog : []).map(function(c){
  return { uid: String(c.id||'').replace(/^db-/,''), project_name:c.projectName, common_name:c.commonName,
           contract_name:c.contractName, customer:c.customer, section:c.section, status:c.status,
           start_date:c.startDate, end_date:c.endDate, note:c.note };
});
V._realOnline = prev ? prev._realOnline : ((typeof dbOnline !== 'undefined') ? !!dbOnline : false);
V._realTheme = prev ? prev._realTheme : (function(){ try{ return localStorage.getItem('tc_theme') || 'system'; }catch(_){ return 'system'; } })();

V.restore = function(){
  try{ V.closeAll(); }catch(_){}
  try{ state.categories = JSON.parse(JSON.stringify(V._snapCats)); }catch(_){}
  try{ if(V._realOnline) window.__applyProjects(JSON.stringify(V._realRows)); else window.__applyProjects(''); }catch(_){}
  try{ state.categories = JSON.parse(JSON.stringify(V._snapCats)); }catch(_){}   // 주입 부작용(자동 편입) 재복원
  try{ applyTheme(V._realTheme); }catch(_){}
  try{ renderAll(); }catch(_){}
  window.save = V._realSave;
  return { saveCalls: V.saveCalls, cats: state.categories.length, theme: V._realTheme };
};

/* ── 1) 화면 전환 헬퍼 ── */
V.closeAll = function(){
  var ovs = document.querySelectorAll('.overlay');
  for (var i=0;i<ovs.length;i++){ ovs[i].classList.remove('closing'); ovs[i].classList.add('hidden'); }
  return true;
};
/* 상태 순서 의존 제거 — 화면 진입 직전 편입 목록을 부팅 시점으로 되돌린다(ensureSub/ensureUnsub 잔상 방지) */
V.resetCats = function(){ state.categories = JSON.parse(JSON.stringify(V._snapCats)); return state.categories.length; };
V.catId  = function(i){ var c = dbCatalog[i|0]; return c ? c.id : ''; };
V.mineId = function(){ var c = state.categories.find(function(x){ return !isOfficialCat(x); }); return c ? c.id : ''; };
V.ensureSub = function(i){ var c = dbCatalog[i|0]; if(c){ subscribeDbCat(c); } return c ? c.id : ''; };
V.ensureUnsub = function(i){
  var c = dbCatalog[i|0]; if(!c) return '';
  state.categories = state.categories.filter(function(x){ return x.id !== c.id; });
  return c.id;
};
V.offSelect = function(i){ var c = dbCatalog[i|0]; if(!c) return false; offSelId = c.id; renderOfficialDetail(); return true; };
V.catEdit = function(kind){
  var want = (kind === 'db');
  var c = state.categories.find(function(x){ return isOfficialCat(x) === want; });
  if(!c) return false;
  var row = document.querySelector('#catList .cat-row[data-id="' + (window.CSS && CSS.escape ? CSS.escape(c.id) : c.id) + '"]');
  var btn = row && row.querySelector('[data-act="edit"]');
  if(!btn) return false;
  btn.click();
  return true;
};

/* ── 2) 데이터 상태 주입(화면에만 — DB는 건드리지 않는다) ── */
V.applyRows    = function(rows){ window.__applyProjects(JSON.stringify(rows)); return dbCatalog.length; };
V.applyOffline = function(){ window.__applyProjects(''); return dbCatalog.length; };
/* 부팅 시 실제로 들어와 있던 카탈로그로 복귀(온라인 여부까지 그대로) + 편입 목록 원복 */
V.applyReal = function(){
  if (V._realOnline) window.__applyProjects(JSON.stringify(V._realRows)); else window.__applyProjects('');
  state.categories = JSON.parse(JSON.stringify(V._snapCats));
  try{ renderAll(); }catch(_){}
  return dbCatalog.length;
};
V.longRows = function(n){
  var SEC = ['체계개발','성능개량','양산','연구용역','시험평가','기타사업'];
  var ST  = ['진행','수주','종료','보류','',  '계약대기'];
  var CUS = ['국방과학연구소 미래전력연구원 무기체계개발본부',
             '방위사업청 지상무기사업부 기동화력사업팀',
             '한화시스템(주) 지휘통제사업본부 통합체계연구소',
             'LIG넥스원 감시정찰연구센터 전자광학사업부',
             '(주)한국항공우주산업 회전익개발본부 성능개량팀'];
  var out = [];
  for (var i=0;i<n;i++){
    var idx = i % 6;
    out.push({
      uid: 'vt-long-' + (1000+i),
      project_name:  '제' + (i+1) + '차 통합지휘통제체계 성능개량 및 운용시험평가 지원용역(' + (idx+1) + '단계 확장분)',
      common_name:   '통합지휘통제체계 성능개량 ' + (i+1) + '차 확장 시험평가 지원',
      contract_name: '통합지휘통제체계 성능개량사업 소프트웨어 개발 및 기술지원 용역계약(' + (2020+idx) + '-' + (i+1) + '호)',
      customer: CUS[i % CUS.length],
      section:  SEC[idx],
      status:   ST[idx],
      start_date: '2024-0' + ((idx%9)+1) + '-01',
      end_date:   '2027-1' + (idx%2) + '-31',
      note: '내부 참고용 메모 — 계약 변경 이력 및 산출물 인도 일정 협의 중(' + (i+1) + ')'
    });
  }
  return out;
};

/* ── 2.5) 검출기 자체 검증(--selftest) ──
 * '한 번도 안 걸리는 검사'는 검사가 아니다. 일부러 깨진 마크업을 심어 V1~V10이 실제로 켜지는지 본다.
 * 앱 DOM은 건드리지 않고 임시 오버레이 하나만 붙였다 뗀다. */
V.selfInject = function(){
  V.selfRemove();
  var ov = document.createElement('div');
  ov.id = '__vtSelf'; ov.className = 'overlay';
  ov.style.alignItems = 'flex-start';   // 세로 중앙정렬이면 1400px 모달의 윗부분이 뷰포트 밖으로 나가 검사 대상에서 빠진다
  ov.innerHTML =
    '<div class="modal" style="max-height:none;height:1400px;overflow:visible">' +
      '<div class="modal-body" style="overflow:hidden;height:120px">' +
        '<div id="vtV1" style="overflow-x:auto;width:120px"><div style="width:420px;height:12px"></div></div>' +
        '<div id="vtV2" style="width:60px;overflow:hidden;white-space:nowrap;text-overflow:clip">아주 긴 텍스트가 잘리는데 말줄임도 없고 title도 없다</div>' +
        '<div id="vtV3" style="display:flex;flex-wrap:wrap;width:200px;gap:0">' +
          '<button type="button" style="width:101px">가</button><button type="button" style="width:101px">나</button></div>' +
        '<div id="vtV4" style="display:grid">' +
          '<div style="grid-area:1/1;width:80px;height:40px">A</div><div style="grid-area:1/1;width:80px;height:40px">B</div></div>' +
        '<button id="vtV6" type="button" style="width:0;height:0;padding:0;border:0;overflow:hidden"></button>' +
        '<button id="vtV7" type="button" style="height:12px;padding:0">작</button>' +
        '<span id="vtV8" style="color:#c9c9c9;background:#ffffff">대비가 아주 낮은 글자</span>' +
        '<div style="height:600px"></div>' +
        '<div id="offList"></div>' +
      '</div>' +
      '<button id="vtV5" type="button" style="position:static;margin-left:200px;width:170px">밖으로</button>' +
    '</div>';
  document.body.appendChild(ov);
  return true;
};
V.selfRemove = function(){ var n = document.getElementById('__vtSelf'); if(n) n.remove(); return true; };

/* ── 3) 측정 유틸 ── */
function px(v){ var n = parseFloat(v); return isFinite(n) ? n : 0; }
function ownText(e){
  var s = '';
  for (var i=0;i<e.childNodes.length;i++){ var n = e.childNodes[i]; if(n.nodeType === 3) s += n.nodeValue; }
  return s.replace(/\s+/g,' ').trim();
}
function shown(e){
  if(!e || e.nodeType !== 1) return false;
  if(e.checkVisibility) return e.checkVisibility({ checkOpacity:true, checkVisibilityCSS:true });
  var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
}
function cssPath(e){
  var parts = [], n = e, depth = 0;
  while (n && n.nodeType === 1 && depth < 4){
    if (n.id){ parts.unshift('#' + n.id); break; }
    var s = n.tagName.toLowerCase();
    var cl = (n.getAttribute('class')||'').trim().split(/\s+/).filter(Boolean).slice(0,2);
    if (cl.length) s += '.' + cl.join('.');
    var p = n.parentElement;
    if (p){
      var same = [].filter.call(p.children, function(x){ return x.tagName === n.tagName; });
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(n)+1) + ')';
    }
    parts.unshift(s); n = n.parentElement; depth++;
  }
  return parts.join(' > ');
}
/** 요약 묶음용 안정 서명 — 조상 경로(nth-of-type)가 아니라 '무엇인지'로 묶는다(달력 칸 30개가 30종이 되지 않게) */
function sig(e){
  if (e.id) return '#' + e.id;
  var cl = (e.getAttribute('class')||'').trim().split(/\s+/).filter(Boolean);
  return e.tagName.toLowerCase() + (cl.length ? '.' + cl.join('.') : '');
}
function matchAny(e, sels){
  for (var i=0;i<sels.length;i++){ try{ if(e.matches(sels[i]) || e.closest(sels[i])) return sels[i]; }catch(_){} }
  return null;
}
var INTERACTIVE = 'button, input, select, textarea, a[href], [role="button"], [role="tab"]';
function isInteractive(e){ try{ return e.matches(INTERACTIVE); }catch(_){ return false; } }
function isDisabled(e){
  try{ return !!e.closest('button:disabled, input:disabled, select:disabled, textarea:disabled, fieldset:disabled, [aria-disabled="true"]'); }
  catch(_){ return false; }
}

/* 색 파싱/합성/대비 — sRGB 상대휘도(WCAG 2.x) */
function parseColor(s){
  if(!s) return null;
  var m = /^rgba?\(([^)]+)\)$/.exec(s.trim());
  if(!m) return null;
  var p = m[1].split(/[,\s\/]+/).filter(function(x){ return x.length; }).map(parseFloat);
  if(p.length < 3) return null;
  return { r:p[0], g:p[1], b:p[2], a: p.length > 3 ? p[3] : 1 };
}
function over(fg, bg){   // fg를 bg 위에 합성(알파 소스오버)
  var a = fg.a;
  return { r: fg.r*a + bg.r*(1-a), g: fg.g*a + bg.g*(1-a), b: fg.b*a + bg.b*(1-a), a:1 };
}
function lum(c){
  function ch(v){ v = v/255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }
  return 0.2126*ch(c.r) + 0.7152*ch(c.g) + 0.0722*ch(c.b);
}
function ratio(a, b){
  var la = lum(a), lb = lum(b);
  return (Math.max(la,lb) + 0.05) / (Math.min(la,lb) + 0.05);
}
/** 조상까지 거슬러 실제로 칠해진 배경색을 찾는다. 이미지/반투명 조상은 '판정 불가'로 뺀다(오탐 금지). */
function resolveBg(e, styles){
  var layers = [], n = e;
  while (n && n.nodeType === 1){
    var s = styles.get(n) || getComputedStyle(n);
    if (s.backgroundImage && s.backgroundImage !== 'none') return { unknown:'background-image' };
    if (n !== e && px(s.opacity) < 1) return { unknown:'ancestor-opacity' };
    var c = parseColor(s.backgroundColor);
    if (c && c.a > 0){ layers.push(c); if (c.a >= 0.999) break; }
    n = n.parentElement;
  }
  if (!layers.length) return { unknown:'no-background' };
  var base = layers[layers.length-1];
  if (base.a < 0.999) return { unknown:'translucent-root' };
  for (var i = layers.length-2; i >= 0; i--) base = over(layers[i], base);
  return { color: base };
}

/* ── 4) 감사 본체 ── */
V.audit = function(opt){
  opt = opt || {};
  var EX = opt.exempt || {};
  var V1=[], W=[], unknown = [];
  function bad(code, e, detail, note){ V1.push({ code:code, sig:sig(e), sel:cssPath(e), detail:detail, note:note||'' }); }
  function warn(code, e, detail, note){ W.push({ code:code, sig:sig(e), sel:cssPath(e), detail:detail, note:note||'' }); }

  /* 스코프 — 모달이 열려 있으면 그 오버레이만 본다(뒤 화면은 base 케이스가 이미 훑는다). */
  var opens = [].filter.call(document.querySelectorAll('.overlay'), function(o){
    return !o.classList.contains('hidden') && !o.classList.contains('closing');
  });
  var scopeEl = opens.length ? opens[opens.length-1] : document.body;
  var scopeId = opens.length ? (scopeEl.id || 'overlay') : 'document';

  var vw = window.innerWidth, vh = window.innerHeight;
  // 화면 밖(닫힌 하단 시트 등 transform으로 치워둔 것)은 지금 사용자가 보는 화면이 아니다 → 판정 대상에서 뺀다.
  // (checkVisibility는 CSS만 보므로 '렌더되지만 뷰포트 밖'을 걸러주지 못한다 — 실측으로 #dpSheetClose가 그랬다.)
  function inView(r){ return r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh; }

  var all = [scopeEl].concat([].slice.call(scopeEl.querySelectorAll('*')));
  var styles = new Map(), rects = new Map(), recs = [];
  for (var i=0;i<all.length;i++){
    var e = all[i];
    if (e.tagName === 'SCRIPT' || e.tagName === 'STYLE' || e.tagName === 'SVG' || e.tagName === 'svg') continue;
    if (e.closest('svg')) continue;                        // SVG 내부는 HTML 레이아웃 규칙이 아니다
    var s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    var r = e.getBoundingClientRect();
    styles.set(e, s); rects.set(e, r);
    recs.push({ e:e, s:s, r:r, vis: shown(e) && inView(r) });
  }

  /* V1 가로 스크롤 ------------------------------------------------------------ */
  var de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1)
    bad('V1-HSCROLL-PAGE', de, { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, over: de.scrollWidth - de.clientWidth });
  for (var i=0;i<recs.length;i++){
    var R = recs[i]; if(!R.vis) continue;
    var ox = R.s.overflowX;
    if (ox !== 'auto' && ox !== 'scroll') continue;
    var over1 = R.e.scrollWidth - R.e.clientWidth;
    if (over1 <= 1) continue;
    var ex = matchAny(R.e, EX.hscroll || []);
    if (ex) continue;
    bad('V1-HSCROLL', R.e, { scrollWidth:R.e.scrollWidth, clientWidth:R.e.clientWidth, over:over1 });
  }

  /* V2 텍스트 잘림 무표시 ------------------------------------------------------ */
  for (var i=0;i<recs.length;i++){
    var R = recs[i]; if(!R.vis) continue;
    var ox = R.s.overflowX;
    if (ox !== 'hidden' && ox !== 'clip') continue;
    var over2 = R.e.scrollWidth - R.e.clientWidth;
    if (over2 <= 1) continue;
    var t = ownText(R.e);
    if (t.length < 2) continue;                             // 래퍼(자식만 있는 박스)는 대상 아님
    if ((R.s.textOverflow||'').indexOf('ellipsis') >= 0) continue;
    var hasTitle = false;
    for (var n = R.e; n && n !== scopeEl.parentElement; n = n.parentElement){
      if (n.getAttribute && (n.getAttribute('title')||'').trim()){ hasTitle = true; break; }
    }
    if (hasTitle) continue;
    bad('V2-CLIP-NO-HINT', R.e, { over:over2, clientWidth:R.e.clientWidth, text: t.slice(0,60) });
  }

  /* V3 액션 바 줄바꿈 ---------------------------------------------------------- */
  for (var i=0;i<recs.length;i++){
    var R = recs[i]; if(!R.vis) continue;
    var d = R.s.display;
    if (d !== 'flex' && d !== 'inline-flex') continue;
    if ((R.s.flexWrap||'') !== 'wrap') continue;
    if (matchAny(R.e, EX.btnWrap || [])) continue;
    var kids = [].filter.call(R.e.children, function(k){ var kr = rects.get(k); return kr && shown(k) && kr.width > 0 && kr.height > 0; });
    if (kids.length < 2) continue;
    var btnish = kids.filter(function(k){
      try{
        if (k.matches('button, .btn')) return true;
        return !!k.querySelector('button, .btn') && (k.textContent||'').trim().length < 60;
      }catch(_){ return false; }
    });
    if (btnish.length < 2) continue;                        // '버튼 행'이 아니면 wrap은 정상
    // 줄 수는 top 값이 아니라 '세로 구간 겹침'으로 센다 — align-items:center면 같은 줄이라도 top이 제각각이다
    // (실측: .off-toolrow{align-items:center}에서 2줄이 4종의 top으로 나왔다).
    var sorted = kids.slice().sort(function(a,b){ return rects.get(a).top - rects.get(b).top; });
    var lines = [];
    sorted.forEach(function(k){
      var kr = rects.get(k), placed = false;
      for (var li=0; li<lines.length; li++){
        var L = lines[li];
        var ov = Math.min(L.bottom, kr.bottom) - Math.max(L.top, kr.top);
        if (ov > 0.5 * Math.min(L.bottom-L.top, kr.height)) { L.top = Math.min(L.top, kr.top); L.bottom = Math.max(L.bottom, kr.bottom); placed = true; break; }
      }
      if(!placed) lines.push({ top: kr.top, bottom: kr.bottom });
    });
    if (lines.length < 2) continue;
    var gap = px(R.s.columnGap);
    var avail = R.e.clientWidth - px(R.s.paddingLeft) - px(R.s.paddingRight);
    var need = kids.reduce(function(a,k){
      var ks = getComputedStyle(k);
      // flex-grow 항목(.spacer 등)은 렌더 폭이 '남은 자리'라 필요폭이 아니다 → 내용폭(scrollWidth)으로 센다
      var w = px(ks.flexGrow) > 0 ? k.scrollWidth : rects.get(k).width;
      return a + w + px(ks.marginLeft) + px(ks.marginRight);
    }, 0) + gap * (kids.length - 1);
    var short = need - avail;
    var det = { rows: lines.length, need: Math.round(need*10)/10, avail: Math.round(avail*10)/10,
                short: Math.round(short*10)/10, kids: kids.length };
    // '아슬아슬하게 안 맞아 접힌' 것만 결함으로 본다 — 이게 재발 방지 대상인 1px 결함(275 vs 274)의 형태다.
    // 크게 넘치면 애초에 한 줄에 담을 수 없는 구성이므로 설계 판단 영역 → warn.
    if (short <= Math.max(16, avail * 0.06)) bad('V3-BTNROW-WRAP', R.e, det);
    else warn('V3-BTNROW-WRAP', R.e, det, '필요폭이 가용폭을 크게 초과 — 의도적 다단일 수 있음');
  }

  /* V4 형제 겹침 -------------------------------------------------------------- */
  var seenParents = new Set();
  for (var i=0;i<recs.length;i++){
    var P = recs[i].e;
    if (seenParents.has(P)) continue; seenParents.add(P);
    var kids = [].filter.call(P.children, function(k){
      var kr = rects.get(k), ks = styles.get(k);
      if(!kr || !ks) return false;
      if(kr.width <= 0 || kr.height <= 0) return false;
      if(!shown(k)) return false;
      if(ks.position === 'absolute' || ks.position === 'fixed' || ks.position === 'sticky') return false;
      if(ks.position === 'relative' && [ks.top,ks.left,ks.right,ks.bottom].some(function(v){ return v !== 'auto' && px(v) !== 0; })) return false;
      if(ks.transform && ks.transform !== 'none') return false;
      if([ks.marginTop,ks.marginBottom,ks.marginLeft,ks.marginRight].some(function(v){ return px(v) < 0; })) return false;
      if(ks.float !== 'none') return false;
      // ★ 인라인 요소는 제외 — 두 줄로 접힌 <b>/<span>의 getBoundingClientRect는 두 줄을 감싼 '합집합 상자'라
      //   서로 겹친 것처럼 보인다(실측: 패치노트 <li> 안의 <b> 형제들이 전부 오탐). 박스 요소만 본다.
      if(ks.display === 'inline') return false;
      if(k.getClientRects && k.getClientRects().length > 1) return false;   // 줄바꿈된 인라인블록도 같은 이유로 제외
      return true;
    });
    if (kids.length < 2 || kids.length > 60) continue;
    if (matchAny(P, EX.overlap || [])) continue;
    for (var a=0;a<kids.length;a++) for (var b=a+1;b<kids.length;b++){
      var ra = rects.get(kids[a]), rb = rects.get(kids[b]);
      var ow = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      var oh = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ow <= 1 || oh <= 1) continue;
      var area = ow*oh, minA = Math.min(ra.width*ra.height, rb.width*rb.height);
      var frac = area / Math.max(minA, 1);
      var det = { w: Math.round(ow), h: Math.round(oh), frac: Math.round(frac*100)/100, other: cssPath(kids[b]) };
      if (frac >= 0.25) bad('V4-OVERLAP', kids[a], det);
      else if (area > 12) warn('V4-OVERLAP', kids[a], det, '겹침 면적 25% 미만 — 경계 반올림일 수 있음');
    }
  }

  /* V5 컨테이너 이탈(모달 밖으로) ------------------------------------------------ */
  if (opens.length){
    var modal = scopeEl.querySelector('.modal, .qa-modal');
    if (modal){
      var mr = modal.getBoundingClientRect();
      for (var i=0;i<recs.length;i++){
        var R = recs[i]; if(!R.vis) continue;
        if(!isInteractive(R.e)) continue;
        if(R.r.width <= 0 || R.r.height <= 0) continue;
        if(R.s.position === 'fixed' || R.s.position === 'absolute') continue;   // 드롭다운·팝오버는 밖으로 나가는 게 정상
        var dx = Math.max(mr.left - R.r.left, R.r.right - mr.right);
        if (dx > 2) { bad('V5-ESCAPE-X', R.e, { over: Math.round(dx), modal: Math.round(mr.width) }); continue; }
        // 세로는 스크롤 컨테이너 안이면 '아래에 더 있는' 정상 상태다 → 스크롤 조상이 없을 때만 본다
        var scrollable = false;
        for (var n = R.e.parentElement; n && n !== modal.parentElement; n = n.parentElement){
          var ns = styles.get(n) || getComputedStyle(n);
          if ((ns.overflowY === 'auto' || ns.overflowY === 'scroll')) { scrollable = true; break; }
        }
        if (scrollable) continue;
        var dy = Math.max(mr.top - R.r.top, R.r.bottom - mr.bottom);
        if (dy > 2) bad('V5-ESCAPE-Y', R.e, { over: Math.round(dy), modal: Math.round(mr.height) });
      }
    }
  }

  /* V6 보이지만 크기 0 --------------------------------------------------------- */
  for (var i=0;i<recs.length;i++){
    var R = recs[i];
    if(!isInteractive(R.e)) continue;
    if(!R.vis) continue;                                   // display:none/visibility:hidden/opacity:0 은 대상 아님
    if(R.e.type === 'hidden') continue;
    if(R.e.getAttribute('aria-hidden') === 'true') continue;
    if(R.s.position === 'absolute' && R.s.clipPath !== 'none') continue;   // sr-only 관용구
    if(R.r.width >= 1 && R.r.height >= 1) continue;
    bad('V6-ZERO-SIZE', R.e, { w: Math.round(R.r.width*10)/10, h: Math.round(R.r.height*10)/10, tag: R.e.tagName });
  }

  /* V7 터치/클릭 타깃 과소 ------------------------------------------------------- */
  for (var i=0;i<recs.length;i++){
    var R = recs[i];
    if(!isInteractive(R.e) || !R.vis) continue;
    if(R.r.width <= 0 || R.r.height <= 0) continue;
    if(isDisabled(R.e)) continue;
    var eff = R.r;
    // 체크박스/라디오는 감싸는 <label>이 실제 히트 영역이다(.check 패턴) → 라벨 높이로 판정
    if (R.e.tagName === 'INPUT' && (R.e.type === 'checkbox' || R.e.type === 'radio')){
      var lb = R.e.closest('label');
      if (lb) eff = lb.getBoundingClientRect();
    }
    if (eff.height >= 24) continue;
    var d7 = { h: Math.round(eff.height*10)/10, w: Math.round(eff.width*10)/10, tag: R.e.tagName, text: (R.e.textContent||'').trim().slice(0,24) };
    // 폭 기준을 두는 근거: 앱 스스로 @media (max-width:440px)에서 터치 히트영역 하한을 세운다
    // (.btn.icon 40px · .seg-b 38px · .x 32px · .todo-check 32px). 그 구간에서 24px 미만이면 자기 규칙과 어긋난다.
    // 그보다 넓은 폭은 마우스 전용 데스크톱 밀도라 판단 영역 → warn.
    if (matchAny(R.e, EX.smallTargetWarnOnly || [])) warn('V7-SMALL-TARGET', R.e, d7, '인라인 텍스트 링크 — 문장 흐름 안이라 별도 규범');
    else if (vw <= (opt.touchWidth || 440)) bad('V7-SMALL-TARGET', R.e, d7);
    else warn('V7-SMALL-TARGET', R.e, d7, '넓은 폭(마우스 밀도) — 앱의 터치 하한 규칙(≤440px) 밖');
  }

  /* V8 대비(AA) --------------------------------------------------------------- */
  for (var i=0;i<recs.length;i++){
    var R = recs[i];
    if(!R.vis) continue;
    if(R.r.width <= 0 || R.r.height <= 0) continue;
    var t = ownText(R.e);
    if (!t) continue;
    if (R.e.getAttribute('aria-hidden') === 'true' || R.e.closest('[aria-hidden="true"]')) continue;
    if (isDisabled(R.e)) continue;                          // WCAG 1.4.3은 비활성 컨트롤을 제외한다
    if (px(R.s.opacity) < 1) { unknown.push({ code:'V8', sel:cssPath(R.e), why:'self-opacity' }); continue; }
    var fg = parseColor(R.s.color);
    if (!fg || fg.a === 0) { unknown.push({ code:'V8', sel:cssPath(R.e), why:'fg-parse' }); continue; }
    var bgres = resolveBg(R.e, styles);
    if (bgres.unknown) { unknown.push({ code:'V8', sel:cssPath(R.e), why:bgres.unknown }); continue; }
    var bg = bgres.color;
    var eff = fg.a >= 0.999 ? fg : over(fg, bg);
    var fs = px(R.s.fontSize), fw = parseInt(R.s.fontWeight,10) || 400;
    var large = fs >= 24 || (fs >= 18.66 && fw >= 700);
    var need = large ? 3 : 4.5;
    var rt = ratio(eff, bg);
    if (rt >= need - 0.005) continue;
    var d8 = { ratio: Math.round(rt*100)/100, need: need, fs: Math.round(fs*10)/10, fw: fw,
               fg: R.s.color, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
               text: t.slice(0,40) };
    // 4.0~4.5는 반올림·서브픽셀 렌더링 차이로 체감이 갈리는 구간 → warn으로 분리(확실한 것만 violation)
    if (rt < need - 0.5) bad('V8-CONTRAST', R.e, d8);
    else warn('V8-CONTRAST', R.e, d8, '기준선 근처(0.5 이내) — 토큰 반올림 가능성');
  }

  /* V9 모달 세로 넘침 ---------------------------------------------------------- */
  if (opens.length){
    var modal2 = scopeEl.querySelector('.modal, .qa-modal');
    if (modal2){
      var mr2 = modal2.getBoundingClientRect();
      var outTop = -mr2.top, outBot = mr2.bottom - vh;
      if (outTop > 1 || outBot > 1){
        var canScroll = false;
        var cand = [modal2].concat([].slice.call(modal2.querySelectorAll('*')));
        for (var j=0;j<cand.length;j++){
          var cs2 = styles.get(cand[j]) || getComputedStyle(cand[j]);
          if ((cs2.overflowY === 'auto' || cs2.overflowY === 'scroll') && cand[j].scrollHeight > cand[j].clientHeight + 1){ canScroll = true; break; }
        }
        if (!canScroll) bad('V9-MODAL-VOVERFLOW', modal2, { top: Math.round(outTop), bottom: Math.round(outBot), vh: vh, h: Math.round(mr2.height) });
        else warn('V9-MODAL-VOVERFLOW', modal2, { top: Math.round(outTop), bottom: Math.round(outBot), vh: vh }, '내부 스크롤 있음');
      }
      // 스크롤 컨테이너인데 overflow-y가 visible이면 내용이 잘린 채 도달 불가
      var body2 = modal2.querySelector('.modal-body');
      if (body2){
        var bs = styles.get(body2) || getComputedStyle(body2);
        if (body2.scrollHeight > body2.clientHeight + 1 && bs.overflowY !== 'auto' && bs.overflowY !== 'scroll'){
          // 본문 자체는 안 스크롤해도 **자식 칼럼이 스크롤**하면 내용은 도달 가능하다
          // (실측: 900x320 reportModal은 2단 레이아웃이라 .rpt-rail/.rpt-preview가 각자 스크롤한다) → 그건 warn.
          var inner = false, cand2 = [].slice.call(body2.querySelectorAll('*'));
          for (var j=0;j<cand2.length;j++){
            var c2 = styles.get(cand2[j]) || getComputedStyle(cand2[j]);
            if ((c2.overflowY === 'auto' || c2.overflowY === 'scroll') && cand2[j].scrollHeight > cand2[j].clientHeight + 1){ inner = true; break; }
          }
          var d9 = { scrollHeight: body2.scrollHeight, clientHeight: body2.clientHeight, overflowY: bs.overflowY };
          if (inner) warn('V9-BODY-CLIPPED', body2, d9, '자식 칼럼이 스크롤 가능 — 내용 도달 가능');
          else bad('V9-BODY-CLIPPED', body2, d9);
        }
      }
    }
  }

  /* V10 빈 상태 문구 부재 -------------------------------------------------------- */
  // 목록 컨테이너와 '행' 셀렉터 쌍 — 앱이 실제로 쓰는 구조에 근거한다(renderOfficialList/renderCatModal 등).
  var LISTS = [ ['#offList','.off-row'], ['#rlpList','.off-row'], ['#catList','.cat-row'],
                ['#custList','.cust-row'], ['#codeList','.cust-row'], ['#rlList','.rl-row'] ];
  for (var i=0;i<LISTS.length;i++){
    var box = scopeEl.querySelector ? scopeEl.querySelector(LISTS[i][0]) : null;
    if(!box || !shown(box)) continue;
    if (box.querySelectorAll(LISTS[i][1]).length > 0) continue;
    if ((box.textContent||'').trim().length > 0) continue;
    bad('V10-EMPTY-NO-MSG', box, { list: LISTS[i][0] });
  }

  return { scope: scopeId, viewport: { w:vw, h:vh }, elements: recs.length,
           violations: V1, warns: W, unknown: unknown.length, unknownWhy: unknown.slice(0,6) };
};
return 'installed';
})()`;

/* ────────────────────────────── 6. 계획(조합) 생성 ──────────────────────────────
 * 전수 조합(폭5×테마5×화면18×데이터4 = 1800)은 과하다. 아래 규칙으로 줄이고, **줄인 내용을 반드시 로그**한다. */

function buildPlan(opt) {
  const plan = [];
  const notes = [];
  const H = opt.heights[0] || 700;

  // A. 폭×테마 **전수** × 화면 전체 × 데이터 real — 레이아웃 결함의 주 무대
  for (const w of opt.widths) for (const th of opt.themes) for (const sid of opt.screens)
    plan.push({ w, h: H, theme: th, screen: sid, data: 'real', axis: 'A' });
  notes.push(`A. 폭×테마 전수(${opt.widths.length}×${opt.themes.length}) × 화면 전체(${opt.screens.length}) × 데이터=real → ${plan.length}상태`);

  // B. 데이터 변형은 **대표 폭·대표 테마·데이터 민감 화면**으로 축소
  //    이유: 데이터 상태는 '내용 길이/건수'만 바꾸므로 테마(색)와 직교한다. 폭은 최소·중간·최대만 봐도
  //    줄바꿈/잘림 경계가 드러난다. 화면은 카탈로그 데이터를 실제로 그리는 5종만.
  const dataStates = opt.data.filter((d) => d !== 'real');
  const bW = opt.widths.filter((w) => [320, 600, 1400].includes(w));
  const bT = opt.themes.filter((t) => ['light', 'dark'].includes(t));
  const bS = opt.screens.filter((s) => ['officialModal', 'officialModal.subbed', 'relinkPickModal', 'categoryModal', 'relinkModal'].includes(s));
  let nB = 0;
  for (const d of dataStates) for (const w of bW) for (const th of bT) for (const sid of bS) { plan.push({ w, h: H, theme: th, screen: sid, data: d, axis: 'B' }); nB++; }
  if (nB) notes.push(`B. 데이터 변형(${dataStates.join('/')}) × 대표 폭(${bW.join('/')}) × 대표 테마(${bT.join('/')}) × 데이터 민감 화면(${bS.length}종) → ${nB}상태`);
  notes.push(`   ↳ 줄인 축: 데이터 변형 × (나머지 폭 ${opt.widths.filter((w) => !bW.includes(w)).join('/') || '없음'} · 나머지 테마 ${opt.themes.filter((t) => !bT.includes(t)).join('/') || '없음'} · 나머지 화면 ${opt.screens.length - bS.length}종) = 미순회`);

  // C. 최소 높이(320) — 세로 넘침 전용. 테마는 색축이라 무관 → light 1종, 폭은 최소·중간만.
  const h2 = opt.heights[1];
  let nC = 0;
  if (h2) {
    const cW = opt.widths.filter((w) => [320, 900].includes(w));
    const cT = opt.themes.includes('light') ? ['light'] : opt.themes.slice(0, 1);
    for (const w of cW) for (const th of cT) for (const sid of opt.screens) { plan.push({ w, h: h2, theme: th, screen: sid, data: 'real', axis: 'C' }); nC++; }
    if (nC) notes.push(`C. 최소 높이(${h2}px) × 폭(${cW.join('/')}) × 테마(${cT.join('/')}) × 화면 전체 → ${nC}상태  ↳ 줄인 축: 높이×나머지 테마/폭 = 미순회(세로 넘침은 색과 무관)`);
  }
  return { plan, notes };
}

/* ────────────────────────────── 7. 실행 ────────────────────────────── */

let cdp = null;
const ev = (expr) => cdp.evaluate(expr);

const results = [];      // { state, violations[], warns[], unknown }
const skipped = [];      // { state, why }
const shotSigs = new Set();
let shots = 0;

function stateKey(st) { return `${st.w}x${st.h}-${st.theme}-${st.screen}-${st.data}`; }

async function captureShot(st) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = join(SHOT_DIR, stateKey(st) + '.png');
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  shots++;
  return file;
}

async function waitList(sel, timeout = 8000) {
  const t0 = Date.now();
  for (;;) {
    const txt = await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); return e?String(e.textContent||''):'';})()`);
    if (!/불러오는 중/.test(txt)) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(150);
  }
}

async function main() {
  console.log('=== loop-ui-visual — 실제 화면 기반 UI 루프 테스트 ===');
  cdp = await Cdp.attach(OPT.port);
  log(`CDP 연결: ${cdp.target.url}`);

  await cdp.send('Page.enable').catch(() => {});
  // 애니메이션 중간 프레임에서 rect를 재면 전부 틀린 값이 나온다(모달 열림은 scale(.97)→1).
  // 앱이 이미 가진 `@media (prefers-reduced-motion:reduce){*{animation:none!important}}` 규칙을 켠다.
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const installed = await ev(INSTALL_JS);
  log(`페이지 헬퍼 __vt: ${installed}`);

  const boot = await ev(`(function(){return {ver:(typeof APP_VERSION!=='undefined'?APP_VERSION:'?'),host:(typeof HOST!=='undefined'&&!!HOST),role:(typeof getRole==='function'?getRole():'?'),online:!!dbOnline,catalog:dbCatalog.length,cats:state.categories.length};})()`);
  log(`앱 상태: v${boot.ver} · HOST=${boot.host} · role=${boot.role} · dbOnline=${boot.online} · 카탈로그 ${boot.catalog}건 · 과제 ${boot.cats}개`);
  if (!boot.host) log('  ⚠ HOST=false — 위젯이 아닌 브라우저입니다. 위젯 전용 화면(구분·상태 등)이 열리지 않습니다.');

  if (OPT.selftest) { await selftest(); cdp.close(); return; }

  const { plan, notes } = buildPlan(OPT);
  console.log('');
  log(`계획: ${plan.length}상태`);
  for (const n of notes) console.log('        ' + n);
  console.log('');

  mkdirSync(SHOT_DIR, { recursive: true });

  let curW = null, curH = null, curTheme = null, curData = null;
  let idx = 0;
  for (const st of plan) {
    idx++;
    try {
      if (st.w !== curW || st.h !== curH) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: st.w, height: st.h, deviceScaleFactor: 1, mobile: false });
        curW = st.w; curH = st.h;
      }
      if (st.theme !== curTheme) { await ev(`applyTheme(${JSON.stringify(st.theme)})`); curTheme = st.theme; }
      if (st.data !== curData) {
        const d = DATA_STATES[st.data];
        await ev(d.apply || '__vt.applyReal()');
        curData = st.data;
      }

      const scr = SCREENS.find((s) => s.id === st.screen);
      if (scr.needsCatalog) {
        const n = await ev('dbCatalog.length');
        if (!n) { skipped.push({ state: stateKey(st), why: '카탈로그 0건 — 이 화면은 열리지 않는다(앱 설계)' }); continue; }
      }
      const opened = await ev('__vt.resetCats(); ' + scr.enter);   // 마지막 식의 값이 완료값 — 헬퍼가 false를 주면 진입 실패
      if (opened === false) { skipped.push({ state: stateKey(st), why: '화면 진입 실패(대상 없음)' }); continue; }
      if (scr.waitList) await waitList(scr.waitList);
      await sleep(90);   // 레이아웃 확정(리렌더·폰트) 대기

      const res = await ev(`__vt.audit(${JSON.stringify({ exempt: EXEMPT })})`);
      const rec = { state: st, key: stateKey(st), ...res, shot: null };
      // 증거는 '새로운 위반 서명'이 나올 때만 남긴다 — 같은 결함이 500장 쌓이면 증거가 아니라 쓰레기다.
      const fresh = res.violations.some((v) => !shotSigs.has(v.code + '|' + v.sig));
      if (OPT.shotAll || fresh) {
        rec.shot = await captureShot(st);
        for (const v of res.violations) shotSigs.add(v.code + '|' + v.sig);
      }
      results.push(rec);

      if (res.violations.length) {
        log(`✗ [${idx}/${plan.length}] ${rec.key} — 위반 ${res.violations.length}건 (warn ${res.warns.length})`);
        for (const v of res.violations.slice(0, 6)) console.log(`        ${v.code} ${v.sel} ${JSON.stringify(v.detail)}`);
        if (res.violations.length > 6) console.log(`        … 외 ${res.violations.length - 6}건`);
      } else {
        vlog(`[${idx}/${plan.length}] ${rec.key} — ok (warn ${res.warns.length}, 판정불가 ${res.unknown})`);
      }
    } catch (e) {
      skipped.push({ state: stateKey(st), why: '오류: ' + e.message });
      log(`! [${idx}/${plan.length}] ${stateKey(st)} — ${e.message}`);
    }
  }

  /* ── 정리·복원 ── */
  if (OPT.restore) {
    try {
      const r = await ev('__vt.restore()');
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      await cdp.send('Emulation.setEmulatedMedia', { features: [] });
      log(`복원 완료: save 호출 차단 ${r.saveCalls}회 · 과제 ${r.cats}개 · 테마 ${r.theme}`);
    } catch (e) { log('복원 실패(수동 확인 필요): ' + e.message); }
  }

  summarize(plan);
  cdp.close();
}

/* ────────────────────────────── 7.5 검출기 자체 검증 ────────────────────────────── */

async function selftest() {
  // 좁은 폭에서 돌린다 — V7(터치 타깃)이 앱의 자체 규칙 구간(≤440px)에서만 violation이라서.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: false });
  await ev('__vt.closeAll(); __vt.selfInject()');
  await sleep(120);
  const res = await ev(`__vt.audit(${JSON.stringify({ exempt: EXEMPT })})`);
  await ev('__vt.selfRemove()');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  if (OPT.restore) await ev('__vt.restore()');

  const got = new Set(res.violations.map((v) => v.code));
  const want = ['V1-HSCROLL', 'V2-CLIP-NO-HINT', 'V3-BTNROW-WRAP', 'V4-OVERLAP', 'V5-ESCAPE-X',
                'V6-ZERO-SIZE', 'V7-SMALL-TARGET', 'V8-CONTRAST', 'V9-MODAL-VOVERFLOW', 'V9-BODY-CLIPPED', 'V10-EMPTY-NO-MSG'];
  console.log('\n검출기 자체 검증 — 일부러 깨진 마크업에서 각 검사가 켜지는지');
  let fail = 0;
  for (const w of want) {
    const ok = got.has(w);
    if (!ok) fail++;
    console.log(`  ${ok ? '✓' : '✗'} ${w}`);
  }
  console.log(`\n검출된 코드: ${[...got].sort().join(', ')}`);
  console.log(fail ? `\n${fail}종이 켜지지 않았습니다 — 검출기 회귀입니다.` : '\n전부 켜짐 — 검출기 정상.');
  process.exitCode = fail ? 1 : 0;
}

/* ────────────────────────────── 8. 요약 ────────────────────────────── */

function summarize(plan) {
  const allV = [], allW = [];
  let unknownTotal = 0;
  for (const r of results) {
    unknownTotal += r.unknown;
    for (const v of r.violations) allV.push({ ...v, key: r.key, shot: r.shot, st: r.state });
    for (const w of r.warns) allW.push({ ...w, key: r.key, st: r.state });
  }

  console.log('\n' + '='.repeat(96));
  console.log(`순회 ${results.length}/${plan.length}상태 · 스킵 ${skipped.length} · 스크린샷 ${shots}장`);
  console.log(`violation ${allV.length}건 · warn ${allW.length}건 · 대비 판정불가 ${unknownTotal}건`);
  console.log('='.repeat(96));

  const byCode = new Map();
  for (const v of allV) {
    const k = v.code + ' | ' + v.sig;   // 조상 경로가 아니라 '무엇인지'로 묶는다(달력 칸 30개 → 1종)
    if (!byCode.has(k)) byCode.set(k, []);
    byCode.get(k).push(v);
  }
  if (byCode.size) {
    console.log('\n■ 위반(코드·셀렉터별 묶음)');
    const sorted = [...byCode.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [k, arr] of sorted) {
      const st = arr.map((v) => `${v.st.w}px/${v.st.theme}/${v.st.screen}${v.st.data === 'real' ? '' : '/' + v.st.data}`);
      const uniqScreens = [...new Set(arr.map((v) => v.st.screen))];
      const uniqW = [...new Set(arr.map((v) => v.st.w))].sort((a, b) => a - b);
      const uniqT = [...new Set(arr.map((v) => v.st.theme))];
      console.log(`\n  ▸ ${k}   (${arr.length}상태·요소)`);
      console.log(`    경로: ${arr[0].sel}`);
      console.log(`    화면: ${uniqScreens.join(', ')}`);
      console.log(`    폭: ${uniqW.join(',')}  테마: ${uniqT.join(',')}`);
      console.log(`    수치: ${JSON.stringify(arr[0].detail)}`);
      const shot = arr.find((v) => v.shot);
      if (shot) console.log(`    증거: ${shot.shot}`);
      if (st.length <= 6) console.log(`    상태: ${st.join(' / ')}`);
    }
  }

  const wCode = new Map();
  for (const w of allW) {
    const k = w.code + ' | ' + w.sig;
    if (!wCode.has(k)) wCode.set(k, []);
    wCode.get(k).push(w);
  }
  if (wCode.size) {
    console.log('\n■ warn(판정 애매 — 확인만)');
    const sorted = [...wCode.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 25);
    for (const [k, arr] of sorted) console.log(`  · ${k}  (${arr.length}상태) ${JSON.stringify(arr[0].detail)} ${arr[0].note ? '— ' + arr[0].note : ''}`);
    if (wCode.size > 25) console.log(`  … 외 ${wCode.size - 25}종`);
  }

  if (skipped.length) {
    console.log('\n■ 스킵');
    const g = new Map();
    for (const s of skipped) { const k = s.why; if (!g.has(k)) g.set(k, []); g.get(k).push(s.state); }
    for (const [why, arr] of g) console.log(`  · ${why} — ${arr.length}상태 (예: ${arr[0]})`);
  }

  console.log('\n■ 재현');
  if (allV.length) {
    const v = allV[0];
    console.log(`  node tests/loop-ui-visual.mjs --widths=${v.st.w} --themes=${v.st.theme} --screens=${v.st.screen} --data=${v.st.data} --shot-all`);
  } else {
    console.log('  node tests/loop-ui-visual.mjs --shot-all   (전 상태 캡처)');
  }
  console.log(`  스크린샷: ${SHOT_DIR}`);

  process.exitCode = allV.length ? 1 : 0;
}

/* 종료 훅 — 예외/중단에도 페이지를 원래대로 되돌린다(테마·카탈로그·save 스텁이 남으면 사용자가 다친다). */
let restoring = false;
async function emergencyRestore() {
  if (restoring || !cdp || !OPT.restore) return;
  restoring = true;
  try { await cdp.evaluate('__vt && __vt.restore()'); } catch (_) { }
  try { await cdp.send('Emulation.clearDeviceMetricsOverride'); } catch (_) { }
  try { await cdp.send('Emulation.setEmulatedMedia', { features: [] }); } catch (_) { }
}
process.on('SIGINT', async () => { console.log('\n중단 — 복원 중…'); await emergencyRestore(); process.exit(130); });

main().catch(async (e) => {
  console.error('\n[치명] ' + e.message);
  await emergencyRestore();
  process.exitCode = 1;
});
