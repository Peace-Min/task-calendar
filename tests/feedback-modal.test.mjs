// 문의(버그 리포트) 모달 + 로그 폴더 원클릭 열기 — 계약 회귀 방지
//
// 왜 이 파일이 있나:
//   ① 문의 버튼이 토스트 한 줄로 되돌아가면(=모달 삭제) 로그 첨부 안내가 통째로 사라진다.
//      제보를 분석하려면 widget.log가 필요한데, 경로만 알려주는 방식은 실패한다는 게 이 기능의 전제다.
//   ② ★ 핵심 보안 계약: 로그 폴더 열기는 **웹이 경로를 넘기지 않는다**.
//      기존 openFolder는 '호스트가 준 경로만 되돌린다'는 규약이지만, openLogFolder는 인자가 아예 없다.
//      웹이 문자열을 못 보내므로 explorer.exe 인자 주입 표면이 0 — 이게 무너지면 규약이 규약을 잃는다.
//   ③ 반출 경고(과제명·발주처명 포함)는 [로그 폴더 열기] 버튼과 같은 상자 안에 있어야 읽힌다.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';
import { readFileSync } from 'node:fs';

const src = loadAppSource();
const mainWindow = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');

// #feedbackModal 오버레이 마크업만 잘라낸다(다음 오버레이 주석 전까지).
function feedbackMarkup() {
  const s = src.indexOf('<div class="overlay hidden" id="feedbackModal">');
  assert.ok(s >= 0, '#feedbackModal 오버레이를 찾지 못함');
  const e = src.indexOf('<div class="overlay hidden" id="guideModal">', s);
  assert.ok(e > s, '#feedbackModal 다음 오버레이(경계)를 찾지 못함');
  return src.slice(s, e);
}

// 중괄호 짝을 맞춰 블록을 잘라내는 범용 슬라이서(C#/JS 공용 — 문자열 리터럴은 단순 처리).
function braceBlock(text, fromIdx) {
  const open = text.indexOf('{', fromIdx);
  assert.ok(open > 0, '여는 중괄호를 찾지 못함');
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { while (++i < text.length && !(text[i] === '"' && text[i - 1] !== '\\')); continue; }
    if (c === '{') depth++;
    else if (c === '}') { if (--depth === 0) return text.slice(fromIdx, i + 1); }
  }
  throw new Error('블록의 끝을 찾지 못함');
}

function hostOpenLogFolder() {
  const s = mainWindow.indexOf('private void OpenLogFolder()');
  assert.ok(s >= 0, '호스트에 OpenLogFolder() 메서드가 없다');
  return braceBlock(mainWindow, s);
}

function hostOpenLogFolderCase() {
  const s = mainWindow.indexOf('case "openLogFolder":');
  assert.ok(s >= 0, '호스트 브리지에 openLogFolder case가 없다');
  return braceBlock(mainWindow, s);
}

// ── ① 진입점: 토스트 → 모달 ────────────────────────────────────────────

test('문의: 🐞 버튼은 토스트가 아니라 #feedbackModal을 연다', () => {
  const m = /\$\('#btnFeedback'\)\.addEventListener\('click',\s*([^)]*)\)/.exec(src);
  assert.ok(m, "#btnFeedback 클릭 핸들러를 찾지 못함");
  assert.ok(!/toast\(/.test(m[1]),
    '문의 버튼이 아직 토스트를 띄운다 — 토스트 한 줄에는 로그 첨부 안내를 담을 자리가 없다: ' + m[1].trim());
  assert.ok(/openFeedback/.test(m[1]), '문의 버튼이 openFeedback을 부르지 않는다: ' + m[1].trim());
  const fn = extractFunction(src, 'openFeedback');
  assert.ok(/openModal\('#feedbackModal'\)/.test(fn), 'openFeedback이 #feedbackModal을 열지 않는다');
});

test('문의: ⋯ 접기 항목(btnFeedbackFold)은 그대로 원본 버튼 클릭을 위임한다(≤440px 도달성)', () => {
  assert.ok(/btnFeedbackFold\s*:\s*'#btnFeedback'/.test(src),
    '≤440px에서 헤더에서 접힌 뒤 문의로 갈 길이 없어진다');
});

// ── ② 모달 골격·구성 ───────────────────────────────────────────────────

test('문의 모달: 기존 모달 마크업 관례(.overlay .modal / head·body·foot / data-close)를 따른다', () => {
  const md = feedbackMarkup();
  for (const cls of ['class="modal"', 'class="modal-head"', 'class="modal-body"', 'class="modal-foot"'])
    assert.ok(md.includes(cls), `${cls} 가 없다 — 공통 모달 골격을 벗어나면 A11y·닫기 경로가 함께 깨진다`);
  assert.ok(/<button class="x" data-close/.test(md), '× 닫기 버튼(data-close)이 없다');
  assert.ok((md.match(/data-close/g) || []).length >= 2, '푸터 닫기(data-close)가 없다 — Esc·배경클릭 외 명시적 경로 필요');
  assert.ok(/<h2>[^<]+<\/h2>/.test(md), 'h2 제목이 없다 — setupModalA11y의 aria-labelledby가 붙지 않는다');
});

test('문의 모달: 보낼 곳(메일·복사 버튼·랜메신저)이 있다', () => {
  const md = feedbackMarkup();
  assert.ok(md.includes('phmin@netcus.com'), '메일 주소가 없다');
  assert.ok(/id="btnFbCopyMail"/.test(md), '메일 주소 복사 버튼이 없다');
  assert.ok(/랜메신저/.test(md) && /민평화/.test(md), '랜메신저 안내(민평화)가 없다');
});

test('문의 모달: 함께 보낼 3가지(무엇을 하다가 / 기대한 동작 / 실제 결과)를 안내한다', () => {
  const md = feedbackMarkup();
  for (const s of ['무엇을 하다가', '기대한 동작', '실제 결과'])
    assert.ok(md.includes(s), `'${s}' 안내가 없다 — 이게 없으면 재현이 안 되는 제보가 온다`);
});

test('문의 모달: 진단 기록 블록 = widget.log · [로그 폴더 열기] · 끄기 전 안내 · 반출 경고', () => {
  const md = feedbackMarkup();
  assert.ok(md.includes('widget.log'), '파일명(widget.log)이 없다');
  assert.ok(/id="btnFbLog"/.test(md), '로그 폴더 열기 버튼이 없다');
  assert.ok(/앱을 끄기 전에/.test(md), "'앱을 끄기 전에' 안내가 없다 — 회전 로그라도 직전 세션 확보가 빠르다");
  // ★ 반출 경고는 버튼과 **같은 상자** 안에 있어야 의미가 있다(스크롤 밖으로 밀리면 안 읽힌다)
  const diag = /<div class="fb-sec fb-diag">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="modal-foot">/.exec(md);
  assert.ok(diag, '진단 기록 상자(.fb-diag)를 찾지 못함');
  assert.ok(/id="btnFbLog"/.test(diag[1]), '로그 폴더 열기 버튼이 진단 상자 밖에 있다');
  assert.ok(/과제명/.test(diag[1]) && /발주처명/.test(diag[1]),
    '무엇이 들어 있는지(과제명·발주처명)를 밝히지 않으면 경고가 추상적이라 지켜지지 않는다');
  assert.ok(/사내에서만/.test(diag[1]), '사내 공유 한정 경고가 없다');
  assert.ok(/class="fb-warn"/.test(diag[1]), '경고가 눈에 띄는 전용 스타일(.fb-warn)을 쓰지 않는다');
  // 경고는 버튼 '바로 아래' — 안내문 뒤로 밀리면 320px(시트)에서 스크롤 밖으로 나가 읽히지 않는다.
  assert.ok(diag[1].indexOf('class="fb-warn"') < diag[1].indexOf('class="fb-hint"'),
    '반출 경고가 안내문보다 뒤에 있다 — 버튼에서 멀어지면 경고가 아니라 각주가 된다');
});

// ── ③ ★ 경로 무전달 계약(웹) ──────────────────────────────────────────

test('보안(핵심): 웹은 openLogFolder를 **경로 인자 없이** 보낸다(path 문자열을 넘기지 않는다)', () => {
  const fn = extractFunction(src, 'openLogFolder');
  const m = /hpost\(\s*(\{[^}]*\})\s*\)/.exec(fn);
  assert.ok(m, 'openLogFolder에서 hpost 호출을 찾지 못함');
  assert.match(m[1].replace(/\s+/g, ' ').trim(), /^\{ cmd: 'openLogFolder' \}$/,
    "payload에 cmd 외의 키가 있다 — 로그 경로는 호스트가 이미 안다. 웹이 문자열을 실으면 주입 표면이 생긴다: " + m[1]);
  const code = fn.replace(/\/\/.*$/gm, '');   // 주석의 'path'는 설명이지 코드가 아니다
  assert.ok(!/path/.test(code), 'openLogFolder가 path를 다룬다 — 이 경로는 경로를 모르는 것이 계약이다');
});

test('보안: 문의 모달의 폴더 열기는 openFolder(경로 전달) 경로를 쓰지 않는다', () => {
  const fn = extractFunction(src, 'openLogFolder');
  assert.ok(!/'openFolder'/.test(fn), "openFolder(경로 전달 규약)로 새고 있다 — openLogFolder여야 한다");
});

// ── ④ 호스트: 자기 _dataDir/_logFile만 연다 ────────────────────────────

test('보안(핵심): 호스트에 openLogFolder case가 있고, 웹이 보낸 값을 하나도 읽지 않는다', () => {
  const c = hostOpenLogFolderCase();
  assert.ok(/OpenLogFolder\(\)/.test(c), 'case가 OpenLogFolder()를 부르지 않는다');
  assert.ok(!/GetStr\(/.test(c) && !/doc/.test(c.replace(/\/\/.*$/gm, '')),
    'case가 웹 메시지(doc)에서 값을 읽는다 — 인자 없는 계약이 깨졌다: ' + c);
});

test('보안(핵심): 호스트 OpenLogFolder는 자기 _dataDir/_logFile만 연다(파라미터 없음)', () => {
  const b = hostOpenLogFolder();
  assert.ok(/private void OpenLogFolder\(\)/.test(b),
    '파라미터를 받는다 — 호출측이 경로를 주장할 수 있으면 무전달 설계가 무의미해진다');
  assert.ok(/_dataDir/.test(b), '_dataDir을 쓰지 않는다');
  assert.ok(/_logFile/.test(b), '_logFile을 쓰지 않는다');
});

test('로그 폴더 열기: 파일이 있으면 /select로 **선택된 채** 연다(목적 = 이 파일 첨부)', () => {
  const b = hostOpenLogFolder();
  assert.ok(/File\.Exists\(file\)/.test(b), '로그 파일 존재 확인이 없다');
  assert.ok(/"\/select,/.test(b), '/select 로 열지 않는다 — 폴더만 열면 사용자가 또 찾아야 한다');
  assert.ok(/explorer\.exe/.test(b), 'explorer.exe로 열지 않는다');
});

test('로그 폴더 열기: 로그가 없으면 폴더만, 폴더도 없으면 만들고 연다', () => {
  const b = hostOpenLogFolder();
  assert.ok(/Directory\.CreateDirectory\(dir\)/.test(b), '폴더가 없을 때 만들지 않는다(첫 실행에서 아무 반응 없음)');
  const sel = b.indexOf('/select,');
  const fallback = b.indexOf('OpenFolderSafe(dir)');
  assert.ok(fallback > sel && sel > 0, '로그 파일이 없을 때의 폴더-만-열기 폴백이 없다');
});

test('로그 폴더 열기: OpenFolderSafe 수준의 방어(빈 값·GetFullPath·try/catch)를 유지한다', () => {
  const b = hostOpenLogFolder();
  assert.ok(/string\.IsNullOrWhiteSpace\(_dataDir\)/.test(b), '빈 값 방어가 없다');
  assert.ok(/Path\.GetFullPath\(/.test(b), 'GetFullPath 정규화가 없다');
  assert.ok(/catch\s*\(/.test(b), 'try/catch가 없다 — 탐색기 실패가 앱을 죽인다');
});

// ── ⑤ 브라우저(HOST=false) ─────────────────────────────────────────────

test('브라우저(HOST=false): 로그 폴더 열기 버튼은 비활성 + 경로 텍스트를 보여준다', () => {
  const fn = extractFunction(src, 'openFeedback');
  assert.ok(/\.disabled\s*=\s*!HOST/.test(fn), '브라우저에서 버튼이 비활성화되지 않는다(할 수 없는 일을 시킨다)');
  assert.ok(/#fbLogPath/.test(fn), '경로 안내 요소(#fbLogPath)를 다루지 않는다');
  assert.ok(/HOST\s*\?\s*'none'\s*:\s*''/.test(fn), '경로 안내가 위젯에서도 노출되거나 브라우저에서 숨는다');
  assert.ok(/FEEDBACK_LOG_DIR/.test(fn), '경로 문자열을 안내하지 않는다');
  const dir = /const FEEDBACK_LOG_DIR\s*=\s*'([^']+)'/.exec(src);
  assert.ok(dir, 'FEEDBACK_LOG_DIR 상수를 찾지 못함');
  assert.strictEqual(dir[1].replace(/\\\\/g, '\\'), '%APPDATA%\\TaskCalendar', '안내 경로가 다르다: ' + dir[1]);
  assert.ok(/위젯 전용|데스크톱 위젯/.test(fn), '위젯 전용임을 알리지 않는다');
  // 그래도 눌리는 경로(키보드 등)를 대비한 2차 방어
  const send = extractFunction(src, 'openLogFolder');
  assert.ok(/if\(!HOST\)/.test(send), 'HOST 가드 없이 hpost를 부른다(브라우저에서 조용히 아무 일도 안 일어남)');
});

// ── ⑥ 복사 폴백 ────────────────────────────────────────────────────────

test('메일 복사: clipboard API 실패 시 execCommand 폴백이 있다(WebView2·비보안 컨텍스트)', () => {
  const fn = extractFunction(src, 'copyFeedbackMail');
  assert.ok(/navigator\.clipboard\.writeText/.test(fn), 'clipboard API를 쓰지 않는다');
  assert.ok(/document\.execCommand\('copy'\)/.test(fn), '폴백이 없다 — WebView2에서 조용히 실패한다');
  assert.ok(/toast\(/.test(fn), '성공/실패 피드백이 없다');
  assert.ok(/FEEDBACK_MAIL/.test(fn), '복사 대상이 단일 소스(FEEDBACK_MAIL)가 아니다');
});

// ── ⑦ 도움말 정합(중복 제거) ───────────────────────────────────────────

test('도움말 15번은 모달로 안내만 한다(메일·로그 문구를 복붙하지 않는다)', () => {
  const s = src.indexOf('<h3>15. 문의 · 피드백</h3>');
  assert.ok(s >= 0, '도움말 15번 섹션을 찾지 못함');
  const sec = src.slice(s, src.indexOf('</section>', s));
  assert.ok(/문의<\/b>|<b>문의/.test(sec), '문의 버튼을 누르라는 안내가 없다');
  assert.ok(!sec.includes('phmin@netcus.com'), '메일 주소가 중복돼 있다 — 단일 소스는 문의 모달이다');
  assert.ok(!/widget\.log/.test(sec), '로그 경로가 중복돼 있다 — 절차가 두 곳에서 따로 늙는다');
});

// ── ⑧ 레이아웃·토큰 ────────────────────────────────────────────────────

test('문의 모달: 320px에서 잘리지 않도록 행은 flex-wrap이고 값은 min-width:0이다', () => {
  const row = /\.fb-row\{([^}]*)\}/.exec(src);
  assert.ok(row, '.fb-row 규칙을 찾지 못함');
  assert.ok(/flex-wrap:wrap/.test(row[1]), '.fb-row에 flex-wrap이 없다(좁은 폭에서 버튼이 잘린다)');
  const val = /\.fb-val\{([^}]*)\}/.exec(src);
  assert.ok(val && /min-width:0/.test(val[1]), '.fb-val에 min-width:0이 없다(긴 값이 모달을 밀어 가로 스크롤을 만든다)');
  assert.ok(/overflow-wrap:anywhere/.test(val[1]), '.fb-val이 줄바꿈되지 않는다');
});

test('문의 모달: ≤440px 터치 하한(32px) 관례를 따른다', () => {
  assert.ok(/#feedbackModal \.btn\.sm\{min-height:32px\}/.test(src),
    '좁은 폭에서 .btn.sm 높이가 32px 하한 아래로 남는다(앱의 ≤440px 터치 규칙과 어긋남)');
});

test('문의 모달: 색은 전부 디자인 토큰(하드코딩 hex 없음)', () => {
  const s = src.indexOf('/* ---------- 문의(버그 리포트) 모달 ----------');
  assert.ok(s >= 0, '문의 모달 CSS 블록을 찾지 못함');
  const css = src.slice(s, src.indexOf('/* ---------- 빠른 등록', s));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')),
    '문의 모달 CSS에 하드코딩 hex 색이 있다 — var(--토큰)만 쓸 것');
  assert.ok(/var\(--danger-text\)/.test(css) && /var\(--danger-soft\)/.test(css),
    '반출 경고가 위험 의미색 토큰을 쓰지 않는다');
});

// ── ⑨ ★ 버튼 → 핸들러 배선(button ↔ handler) ──────────────────────────
// 왜 따로 있나: 위의 계약들은 「마크업에 id="btnFbLog" 가 있다」와 「openLogFolder() 본문이 옳다」를
// **따로따로** 본다. 그 둘을 잇는 addEventListener 한 줄은 아무도 안 봤다.
// 그래서 배선 줄만 지우면 이 파일이 존재 이유 ②로 못 박은 '로그 폴더 원클릭 열기'가 통째로 죽는데도
// 전 스위트가 초록이었다(실측 896 pass / 0 fail). 버튼과 함수가 각각 살아 있어도 기능은 죽는다.
//
// 이 검사가 잡아야 할 회귀 8종:
//   ① 배선 줄 삭제        ② 핸들러를 no-op/인라인 함수로 교체   ③ 셀렉터 오타
//   ④ 가드 극성 반전(if(x)→if(!x))                            ⑤ 이벤트명 변경('click'→다른 것)
//   ⑥ 핸들러 교차(두 버튼 맞바꾸기)                            ⑦ 경로 전달 openFolder 로 재배선
//   ⑧ 집은 것과 다른 변수에 붙이기(const l = $(...); m.addEventListener)
// ④·⑧ 은 '셀렉터와 핸들러 이름이 근처에 같이 보이는가' 식의 느슨한 정규식으로는 못 잡는다.
// 그래서 배선 문장의 **모양 전체**를 역참조(\1)로 묶어 확인한다.
function clickWiring(source, sel) {
  // ⓐ 셀렉터와 addEventListener 가 같은 문장 안에서 만나기는 하는가(= 배선의 존재).
  const near = new RegExp("\\$\\('" + sel + "'\\)[\\s\\S]{0,120}?addEventListener\\s*\\(");
  assert.ok(near.test(source),
    sel + ' 를 addEventListener 로 잇는 배선이 없다 — 버튼도 있고 핸들러 함수도 있는데 둘이 만나지 않는다(눌러도 아무 일도 일어나지 않는다)');
  // ⓑ 배선의 모양이 계약대로인가 — 집은 그 요소에, 참일 때, click 으로, 이름 있는 함수를.
  const strict = new RegExp(
    "\\{\\s*const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\$\\('" + sel + "'\\)\\s*;\\s*" +
    "if\\s*\\(\\s*\\1\\s*\\)\\s*" +
    "\\1\\s*\\.\\s*addEventListener\\(\\s*'([^']*)'\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\)");
  const m = strict.exec(source);
  assert.ok(m, sel + ' 배선의 모양이 계약과 다르다 — 가드가 반전됐거나(if(!x)) · 집은 것과 다른 변수에 붙였거나 · 핸들러가 이름 없는 인라인 함수다');
  return { event: m[2], handler: m[3] };
}

function checkWiring(source, sel, expected) {
  const w = clickWiring(source, sel);
  assert.strictEqual(w.event, 'click',
    sel + " 배선이 click 이 아닌 '" + w.event + "' 에 붙어 있다 — 버튼은 클릭으로 쓴다");
  assert.strictEqual(w.handler, expected,
    sel + ' 의 핸들러가 다르다(기대 ' + expected + ' / 실제 ' + w.handler + ')');
}

test('배선(핵심): [로그 폴더 열기] 버튼이 openLogFolder 에 실제로 연결돼 있다', () =>
  checkWiring(src, '#btnFbLog', 'openLogFolder'));

test('배선(핵심): [복사] 버튼이 copyFeedbackMail 에 실제로 연결돼 있다', () =>
  checkWiring(src, '#btnFbCopyMail', 'copyFeedbackMail'));

// 진입점도 같은 잣대로 — 위 ①의 계약은 '토스트가 아니다 / openFeedback 이 보인다'까지만 본다.
const FEEDBACK_ENTRY_RE =
  /\$\('#btnFeedback'\)\s*\.\s*addEventListener\(\s*'([^']*)'\s*,\s*([A-Za-z_$][\w$]*)\s*\)/;

function checkFeedbackEntry(source) {
  const m = FEEDBACK_ENTRY_RE.exec(source);
  assert.ok(m, '#btnFeedback 배선을 찾지 못함 — 문의 모달로 들어갈 길이 없다');
  assert.strictEqual(m[1], 'click', "#btnFeedback 가 click 이 아닌 '" + m[1] + "' 에 붙어 있다");
  assert.strictEqual(m[2], 'openFeedback', '#btnFeedback 의 핸들러가 다르다: ' + m[2]);
}

test('배선: 🐞 #btnFeedback 는 click 으로 openFeedback 에 연결돼 있다', () => checkFeedbackEntry(src));

// ── ⑩ ★ 경로 무전달 계약 — 우회로까지 막는다 ──────────────────────────
// 위 ③의 검사는 openLogFolder 안 **첫 번째** hpost 만 보고, 방어가 리터럴 매칭이었다.
// 그래서 (a) 두 번째 hpost 를 덧붙이거나 (b) 'open'+'Folder' · ['pa'+'th'] 로 이름을 조립하면
// 호스트까지 실제로 도달하는 익스플로잇이 초록으로 통과했다. 아래가 그 두 구멍을 막는다.
function logFolderNoArgs(source) {
  const fn = extractFunction(source, 'openLogFolder');
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const n = (code.match(/hpost\s*\(/g) || []).length;
  assert.strictEqual(n, 1,
    'openLogFolder 안의 hpost 호출이 ' + n + '개다 — 계약은 정확히 1개. 두 번째 호출은 "첫 번째만 보는" 검사를 우회해 문자열을 밀수하는 자리가 된다');
  const calls = [...code.matchAll(/hpost\s*\(\s*(\{[\s\S]*?\})\s*\)/g)].map((mm) => mm[1]);
  assert.strictEqual(calls.length, 1,
    'hpost 페이로드를 객체 리터럴로 읽지 못했다 — 리터럴이 아니면 무엇을 싣는지 정적으로 확인할 수 없다');
  assert.strictEqual(calls[0].replace(/\s+/g, ' ').trim(), "{ cmd: 'openLogFolder' }",
    'payload 에 cmd 외의 것이 실렸다 — 로그 경로는 호스트가 이미 안다: ' + calls[0]);
  assert.ok(!/\+/.test(code),
    "openLogFolder 에 문자열 연결(+)이 있다 — 'open'+'Folder' 같은 조립은 리터럴 검사를 그대로 통과한다. 이 함수엔 조립할 것이 없다");
  assert.ok(!/\[/.test(code),
    'openLogFolder 에 계산된 키·인덱싱([)이 있다 — 키 이름을 런타임에 만들면 무엇을 싣는지 읽을 수 없다');
}

test('보안(핵심): openLogFolder 의 hpost 는 정확히 1개이고 조립된 이름을 쓰지 않는다', () =>
  logFolderNoArgs(src));

// ── ⑪ 변이 주입(검사가 실효성이 있는지 증명) ──────────────────────────
// 각 변이는 "실제로 날 수 있는 회귀"다. 검사가 안 잡으면 그 검사는 장식이다.
// ★ 앵커가 소스에서 안 찾히면 여기서 실패한다 — 조용히 통과하지 않는다.
function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, '변이가 원본을 바꾸지 못했다(대상 문자열 없음): ' + from);
  return out;
}

const WIRE_LOG = "{ const l = $('#btnFbLog'); if(l) l.addEventListener('click', openLogFolder); }";
const WIRE_MAIL = "{ const c = $('#btnFbCopyMail'); if(c) c.addEventListener('click', copyFeedbackMail); }";
const POST_LINE = "  hpost({ cmd: 'openLogFolder' });";

test('변이①: [로그 폴더 열기] 배선 줄을 지우면 잡는다(감사에서 미검출이던 그 변이)', () => {
  const bad = mutate(src, WIRE_LOG, '/* 배선 제거 */');
  assert.throws(() => checkWiring(bad, '#btnFbLog', 'openLogFolder'), /잇는 배선이 없다/);
});

test('변이②: [복사] 배선 줄을 지우면 잡는다(감사에서 미검출이던 그 변이)', () => {
  const bad = mutate(src, WIRE_MAIL, '/* 배선 제거 */');
  assert.throws(() => checkWiring(bad, '#btnFbCopyMail', 'copyFeedbackMail'), /잇는 배선이 없다/);
});

test('변이③: 핸들러를 이름 없는 no-op 으로 바꾸면 잡는다', () => {
  const bad = mutate(src, WIRE_LOG,
    "{ const l = $('#btnFbLog'); if(l) l.addEventListener('click', function(){}); }");
  assert.throws(() => checkWiring(bad, '#btnFbLog', 'openLogFolder'), /모양이 계약과 다르다/);
});

test('변이④: 배선 쪽 셀렉터에 오타를 내면 잡는다', () => {
  const bad = mutate(src, WIRE_LOG,
    "{ const l = $('#btnFbLogs'); if(l) l.addEventListener('click', openLogFolder); }");
  assert.throws(() => checkWiring(bad, '#btnFbLog', 'openLogFolder'), /잇는 배선이 없다/);
});

test('변이⑤: 가드 극성을 뒤집으면(if(l)→if(!l)) 잡는다 — 느슨한 정규식이 놓치던 자리', () => {
  const bad = mutate(src, WIRE_LOG,
    "{ const l = $('#btnFbLog'); if(!l) l.addEventListener('click', openLogFolder); }");
  assert.throws(() => checkWiring(bad, '#btnFbLog', 'openLogFolder'), /모양이 계약과 다르다/);
});

test('변이⑥: 집은 요소가 아닌 다른 변수에 붙이면 잡는다', () => {
  const bad = mutate(src, WIRE_LOG,
    "{ const l = $('#btnFbLog'); const m = document.body; if(l) m.addEventListener('click', openLogFolder); }");
  assert.throws(() => checkWiring(bad, '#btnFbLog', 'openLogFolder'), /모양이 계약과 다르다/);
});

test('변이⑦: 이벤트명을 바꾸면(click→mouseenter) 잡는다', () => {
  const bad = mutate(src, WIRE_LOG,
    "{ const l = $('#btnFbLog'); if(l) l.addEventListener('mouseenter', openLogFolder); }");
  assert.throws(() => checkWiring(bad, '#btnFbLog', 'openLogFolder'), /click 이 아닌/);
});

test('변이⑧: 두 버튼의 핸들러를 맞바꾸면 잡는다', () => {
  const bad = mutate(src, WIRE_LOG,
    "{ const l = $('#btnFbLog'); if(l) l.addEventListener('click', copyFeedbackMail); }");
  assert.throws(() => checkWiring(bad, '#btnFbLog', 'openLogFolder'), /핸들러가 다르다/);
});

test('변이⑨: ★ [로그 폴더 열기]를 경로 전달 openFolder 로 재배선하면 잡는다', () => {
  // 이게 가장 위험한 변이다 — ★ 보안 계약 2개는 openLogFolder 본문과 호스트 case 만 보므로
  // '아무도 부르지 않는 함수'를 지키며 전부 초록이었다.
  const bad = mutate(src, WIRE_LOG,
    "{ const l = $('#btnFbLog'); if(l) l.addEventListener('click', openFolder); }");
  assert.throws(() => checkWiring(bad, '#btnFbLog', 'openLogFolder'), /핸들러가 다르다/);
});

test('변이⑩: openLogFolder 에 두 번째 hpost 를 덧붙여 경로를 밀수하면 잡는다', () => {
  const bad = mutate(src, POST_LINE,
    POST_LINE + "\n  hpost({ cmd: 'openFolder', path: '%APPDATA%' });");
  assert.throws(() => logFolderNoArgs(bad), /hpost 호출이 2개다/);
});

test('변이⑪: 이름을 문자열 연결로 조립해 리터럴 검사를 우회하면 잡는다', () => {
  const bad = mutate(src, POST_LINE, "  hpost({ cmd: 'open' + 'LogFolder' });");
  assert.throws(() => logFolderNoArgs(bad), /cmd 외의 것이 실렸다|문자열 연결/);
});

test('변이⑫: 계산된 키(["pa"+"th"])로 경로를 실으면 잡는다', () => {
  const bad = mutate(src, POST_LINE,
    "  hpost({ cmd: 'openLogFolder', ['pa' + 'th']: '%APPDATA%' });");
  assert.throws(() => logFolderNoArgs(bad), /cmd 외의 것이 실렸다|계산된 키|문자열 연결/);
});

test('변이⑬: 🐞 진입점 배선을 지우면 잡는다(문의 모달로 들어갈 길이 사라진다)', () => {
  const bad = mutate(src, "$('#btnFeedback').addEventListener('click', openFeedback);", '/* 배선 제거 */');
  assert.throws(() => checkFeedbackEntry(bad), /배선을 찾지 못함/);
});
