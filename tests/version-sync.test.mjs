// Layer 1 — **버전 단일 소스** 정합. DB 도 jsdom 도 필요 없다(파일 다섯 개를 읽어 숫자 하나를 뽑을 뿐).
//
// 왜 있나
//   CLAUDE.md 의 릴리스 체크리스트는 버전을 **여덟 자리**에 적으라고 한다. 사람이 손으로 여덟 곳을
//   맞추는 절차는 반드시 어긋나고, 어긋나도 **빌드는 성공한다** — 그래서 조용하다:
//     · csproj <Version> 만 올리고 .iss 기본값을 안 올리면, `build-installer.ps1` 을 안 거친
//       수동 ISCC 컴파일이 **옛 버전 이름의 Setup exe** 를 뱉는다(파일명이 latest.json 과 어긋난다).
//     · APP_VERSION 만 안 올리면 앱 상단 라벨과 「변경사항」 버튼이 **옛 버전을 말한다** —
//       업데이트가 됐는지 사용자가 화면으로 확인할 길이 그 라벨 하나다.
//     · #patchModal 의 `· 현재` 를 옛 절에 남겨 두면 **두 버전이 동시에 '현재'** 라고 적힌다.
//     · RELEASE_NOTES 에 이번 버전 절이 없으면 배너 안내문이 **빈 채로** 나간다
//       (publish-update.ps1 이 그 절을 자동 추출한다 — DEPLOY.md §3 체크리스트의 배너 줄).
//   그래서 "여덟이 같은 값인가" 를 기계가 본다. 사람이 세는 것을 그만두게 하는 것이 목적이다.
//
// 이 시험이 하지 않는 것
//   **버전 번호가 옳은지는 모른다.** 기능 추가인데 패치를 올렸는지 같은 판단은 사람 몫이다.
//   여기서 잠그는 것은 오직 **여덟 자리가 서로 같은가** 다.
//
// 검사 함수(checks)를 테스트와 변이 주입이 공유한다 — 검사가 실제로 잡는지 증명하기 위해서다
// (이 저장소의 관례. restore-guards · schema-guards · holiday 와 같은 꼴).
import { test, assert } from './harness.mjs';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

const csproj  = read('widget/TaskCalendarWidget.csproj');
const html    = read('task-calendar-prototype.html');
const iss     = read('installer/task-calendar.iss');
const relNote = read('RELEASE_NOTES.md');
const changes = read('CHANGELOG.md');

// 변이 주입 도우미 — 대상이 없으면 변이 자체가 무효이므로 그 자리에서 실패시킨다.
// ★ 파일별로 한 벌씩 두는 것이 이 저장소의 규약이다(시험 파일끼리 import 하면 러너의
//   파일별 등록 인구조사가 무너진다 — ES 모듈은 한 번만 평가된다).
function mutate(base, from, to) {
  const at = base.indexOf(from);
  assert.ok(at >= 0, `변이 준비 실패: 앵커를 못 찾았다 — [${from}]`);
  assert.strictEqual(at, base.lastIndexOf(from),
    `변이 준비 실패: 앵커가 ${base.split(from).length - 1}번 나온다(1번이어야 한다) — [${from}]`);
  const out = base.slice(0, at) + to + base.slice(at + from.length);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다 — [${from}]`);
  return out;
}

// ══ 뽑는 자리 ═══════════════════════════════════════════════════════════
// 뽑기가 실패하면 '값이 다르다' 가 아니라 **'그 자리가 사라졌다'** 로 운다.
// 버전을 적는 자리 자체가 없어지는 것도 이 시험이 막아야 할 회귀다.

const SEMVER = '\\d+\\.\\d+\\.\\d+';

function pick(src, re, where) {
  const m = re.exec(src);
  assert.ok(m, `버전을 적는 자리를 찾지 못했다: ${where}`);
  return m[1];
}

// 4자리(0.18.1.0)면 앞 셋만 본다 — .NET 어셈블리/파일 버전의 넷째 자리는 빌드 번호 자리다.
const three = (v) => v.split('.').slice(0, 3).join('.');

// #patchModal 블록만 잘라 낸다. `· 현재` 도 `pv-tag` 도 이 모달 밖에 또 있을 수 있으므로
// 파일 전체 존재검사로 두면 "어딘가 남아 있는가" 를 재게 된다(code-tables 의 P5 와 같은 형태).
function patchModalBlock(source) {
  const s = source.indexOf('<div class="overlay hidden" id="patchModal">');
  assert.ok(s >= 0, '#patchModal 을 찾지 못했다 — 「변경사항」 모달이 사라졌다');
  const e = source.indexOf('<div class="overlay', s + 10);
  assert.ok(e > s, '#patchModal 의 끝(다음 overlay)을 찾지 못했다');
  return source.slice(s, e);
}

const sources = {
  'csproj <Version>':         (s) => pick(s.csproj, new RegExp(`<Version>(${SEMVER})</Version>`), 'csproj <Version>'),
  'csproj <AssemblyVersion>': (s) => three(pick(s.csproj, new RegExp(`<AssemblyVersion>(${SEMVER}(?:\\.\\d+)?)</AssemblyVersion>`), 'csproj <AssemblyVersion>')),
  'csproj <FileVersion>':     (s) => three(pick(s.csproj, new RegExp(`<FileVersion>(${SEMVER}(?:\\.\\d+)?)</FileVersion>`), 'csproj <FileVersion>')),
  'html APP_VERSION':         (s) => pick(s.html, new RegExp(`const APP_VERSION = '(${SEMVER})'`), 'task-calendar-prototype.html 의 APP_VERSION'),
  'iss MyAppVersion':         (s) => pick(s.iss, new RegExp(`#define MyAppVersion "(${SEMVER})"`), 'installer/task-calendar.iss 의 MyAppVersion 기본값'),
  'RELEASE_NOTES 최상단':     (s) => pick(s.relNote, new RegExp(`^## v(${SEMVER})`, 'm'), 'RELEASE_NOTES.md 의 최상단 버전 절'),
  'CHANGELOG 최상단':         (s) => pick(s.changes, new RegExp(`^## [^\\n]*?\\bv(${SEMVER})`, 'm'), 'CHANGELOG.md 의 최상단 버전 절'),
  '#patchModal 첫 pv-tag':    (s) => pick(patchModalBlock(s.html), new RegExp(`<span class="pv-tag">v(${SEMVER})</span>`), '#patchModal 의 첫 pv-tag(= old 가 아닌 것)'),
};

// ══ 검사 함수(테스트 + 변이 주입이 같은 함수를 쓴다) ═══════════════════
const checks = {
  // ① 여덟 자리가 **한 값**이다.
  allSourcesAgree(s) {
    const got = {};
    for (const [name, fn] of Object.entries(sources)) got[name] = fn(s);
    const vals = [...new Set(Object.values(got))];
    assert.strictEqual(vals.length, 1,
      '버전 단일 소스가 갈라졌다(CLAUDE.md 릴리스 체크리스트 1~3번):\n' +
      Object.entries(got).map(([k, v]) => `      ${k.padEnd(26)} = ${v}`).join('\n'));
    return vals[0];
  },

  // ② '· 현재' 는 #patchModal 안에 **한 번만**, 그리고 그 자리가 최신 절이다.
  //    직전 버전의 pv-tag 를 old 로 강등하고 '· 현재' 를 떼는 것이 승격 절차의 절반이다.
  //    안 하면 모달이 **두 버전을 동시에 '현재'** 라고 말한다 — 사용자가 어느 쪽을 믿나.
  currentMarkerIsUnique(s) {
    const block = patchModalBlock(s.html);
    const nowCount = (block.match(/· 현재/g) || []).length;
    assert.strictEqual(nowCount, 1,
      `#patchModal 의 '· 현재' 가 ${nowCount}개다 — 정확히 1개여야 한다(직전 버전에서 떼지 않았다)`);
    const notOld = (block.match(/<span class="pv-tag">/g) || []).length;
    assert.strictEqual(notOld, 1,
      `#patchModal 에서 old 가 아닌 pv-tag 가 ${notOld}개다 — 정확히 1개여야 한다(직전 버전을 old 로 강등하지 않았다)`);
    // 그 하나가 같은 patch-ver 줄 안에 있어야 한다(최신 pv-tag 와 '· 현재' 가 다른 절로 흩어지면 안 된다).
    const line = /<div class="patch-ver"><span class="pv-tag">v[^<]*<\/span><span class="pv-date">[^<]*· 현재<\/span><\/div>/.exec(block);
    assert.ok(line, "최신 절의 pv-tag 와 '· 현재' 가 같은 patch-ver 줄에 있지 않다");
  },
};

const ALL = { csproj, html, iss, relNote, changes };

// 변이용 — 그 자리의 **버전 값만** 9.9.9 로 바꾼다(자리는 남긴다).
// ★ 앞에 '9.' 를 덧대는 식의 변이는 쓰지 않는다. 그러면 값이 네 자리가 되어 뽑기 자체가
//   실패하고, 시험은 '갈라졌다' 가 아니라 '자리가 없다' 로 운다 — 증명하려던 것과 다른 것이 증명된다.
function bumpAt(src, re, label) {
  const m = re.exec(src);
  assert.ok(m, `변이 준비 실패: ${label} 의 자리를 못 찾았다`);
  const out = src.slice(0, m.index) + m[0].replace(m[1], '9.9.9') + src.slice(m.index + m[0].length);
  assert.notStrictEqual(out, src, `변이가 원본을 바꾸지 못했다 — ${label}`);
  return out;
}

// ══ 계약 ════════════════════════════════════════════════════════════════

test('버전 단일 소스: 여덟 자리가 같은 값이다(csproj 3 · html · iss · RELEASE_NOTES · CHANGELOG · patchModal)', () => {
  const v = checks.allSourcesAgree(ALL);
  console.log(`      현재 버전 = ${v}  (자리 ${Object.keys(sources).length}곳 일치)`);
});

test("버전 승격: #patchModal 의 '· 현재' 와 old 아닌 pv-tag 가 각각 하나뿐이다", () =>
  checks.currentMarkerIsUnique(ALL));

// ══ 변이 주입 — 위 계약이 '정말 우는지' 증명한다 ═══════════
// 대조군: 원본은 반드시 통과해야 한다. 통과하지 않으면 아래 throws 는 아무것도 증명하지 못한다.

test('변이①: csproj <Version> 만 앞서 나가면 계약① 이 실패한다', () => {
  const bad = bumpAt(csproj, new RegExp(`<Version>(${SEMVER})</Version>`), 'csproj <Version>');
  assert.doesNotThrow(() => checks.allSourcesAgree(ALL), '원본은 통과해야 한다');
  assert.throws(() => checks.allSourcesAgree({ ...ALL, csproj: bad }), /버전 단일 소스가 갈라졌다/);
});

test('변이①-b: 인스톨러 기본값(MyAppVersion)만 뒤처지면 계약① 이 실패한다', () => {
  const bad = bumpAt(iss, new RegExp(`#define MyAppVersion "(${SEMVER})"`), 'iss MyAppVersion');
  assert.throws(() => checks.allSourcesAgree({ ...ALL, iss: bad }), /버전 단일 소스가 갈라졌다/);
});

test('변이①-c: APP_VERSION 만 뒤처지면 계약① 이 실패한다', () => {
  const bad = bumpAt(html, new RegExp(`const APP_VERSION = '(${SEMVER})'`), 'html APP_VERSION');
  assert.throws(() => checks.allSourcesAgree({ ...ALL, html: bad }), /버전 단일 소스가 갈라졌다/);
});

test('변이①-d: RELEASE_NOTES 에 이번 버전 절이 없으면 계약① 이 실패한다', () => {
  const bad = bumpAt(relNote, new RegExp(`^## v(${SEMVER})`, 'm'), 'RELEASE_NOTES 최상단');
  assert.throws(() => checks.allSourcesAgree({ ...ALL, relNote: bad }), /버전 단일 소스가 갈라졌다/);
});

test('변이①-e: CHANGELOG 최상단이 옛 버전이면 계약① 이 실패한다', () => {
  const bad = bumpAt(changes, new RegExp(`^## [^\\n]*?\\bv(${SEMVER})`, 'm'), 'CHANGELOG 최상단');
  assert.throws(() => checks.allSourcesAgree({ ...ALL, changes: bad }), /버전 단일 소스가 갈라졌다/);
});

test('변이①-f: 어셈블리 버전만 어긋나면 계약① 이 실패한다(넷째 자리는 무관, 앞 셋만 본다)', () => {
  const bad = bumpAt(csproj, new RegExp(`<AssemblyVersion>(${SEMVER}(?:\\.\\d+)?)</AssemblyVersion>`), 'csproj <AssemblyVersion>');
  assert.throws(() => checks.allSourcesAgree({ ...ALL, csproj: bad }), /버전 단일 소스가 갈라졌다/);
});

test('변이①-h: #patchModal 의 최신 pv-tag 만 옛 버전이면 계약① 이 실패한다', () => {
  const bad = bumpAt(html, new RegExp(`<span class="pv-tag">v(${SEMVER})</span>`), '#patchModal 첫 pv-tag');
  assert.throws(() => checks.allSourcesAgree({ ...ALL, html: bad }), /버전 단일 소스가 갈라졌다/);
});

test('변이①-g: 버전을 적는 자리 자체가 사라져도 운다(값 비교 이전의 문제다)', () => {
  const bad = mutate(csproj, '<FileVersion>', '<FileVersionRemoved>');
  assert.throws(() => checks.allSourcesAgree({ ...ALL, csproj: bad }), /버전을 적는 자리를 찾지 못했다/);
});

test("변이②: 직전 버전에서 '· 현재' 를 떼지 않으면 계약② 가 실패한다", () => {
  const first = /<span class="pv-tag old">v[^<]*<\/span><span class="pv-date">([^<]*)<\/span>/.exec(html);
  assert.ok(first, '직전(old) 절을 찾지 못했다 — 변이 준비 실패');
  const bad = mutate(html, first[0], first[0].replace(first[1], first[1] + ' · 현재'));
  assert.doesNotThrow(() => checks.currentMarkerIsUnique(ALL), '원본은 통과해야 한다');
  assert.throws(() => checks.currentMarkerIsUnique({ html: bad }), /'· 현재' 가 2개다/);
});

test('변이②-b: 직전 버전을 old 로 강등하지 않으면 계약② 가 실패한다', () => {
  const first = /<span class="pv-tag old">v[^<]*<\/span>/.exec(html);
  assert.ok(first, '직전(old) 절을 찾지 못했다 — 변이 준비 실패');
  const bad = mutate(html, first[0], first[0].replace('pv-tag old', 'pv-tag'));
  assert.throws(() => checks.currentMarkerIsUnique({ html: bad }), /old 가 아닌 pv-tag 가 2개다/);
});
