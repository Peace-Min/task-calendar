// git/svn 분기 단일 소스 게이트 — 호스트(.cs) 배선 계약.
//
// 이 파일이 존재하는 이유:
//   Svn.cs 의 ResolveVcs 는 "명시 선택(사용자 라디오) 우선, 비어 있으면 폴더 마커로 자동판별" 이라는
//   규칙을 담은 **한 곳**이다. 그 위 주석은 "gitlog/gitauthor/gitcheck 는 모두 이 헬퍼로 통일해,
//   '명시 선택' 과 '호스트 재탐지' 가 상충하지 않게 한다" 고 단언한다.
//
//   ★ 2026-09-07 — 실제로는 gitcheck 만 헬퍼를 부르지 않고 같은 식을 손으로 복제해 두었다.
//     동작은 같았다(DetectVcs 가 존재하지 않는 경로에 "" 를 주므로 exists 가드가 중복이었다).
//     그래서 아무 시험도 빨개지지 않았고, **주석이 앞서 있고 코드가 뒤처진** 상태가 유지됐다.
//     이 저장소는 같은 종류의 사고를 겪었다 — 부팅↔열람 정렬을 "같다" 고 적어 둔 주석이 거짓이었고,
//     그때도 잡아 준 것은 사람이 아니라 뒤늦게 붙인 계약이었다. 주석은 게이트가 아니다.
//
//   그래서 규칙을 코드로 잠근다: 세 진입점은 각자 ResolveVcs 를 부르고, 복제식은 어디에도 없다.
import { readFileSync } from 'node:fs';
import { test, assert } from './harness.mjs';

const mainwin = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
const svn = readFileSync(new URL('../widget/Svn.cs', import.meta.url), 'utf8');

// ── C# 메서드 본문 잘라내기 ──────────────────────────────────────────
//  중괄호 짝을 맞추되 문자열·문자·주석 안의 중괄호는 세지 않는다(오탐 방지).
//  '다음 멤버까지' 같은 느슨한 방식은 쓰지 않는다 — 이웃 메서드의 ResolveVcs 호출을
//  제 것으로 착각해, 호출을 **지워도 통과**하는 계약이 되기 때문이다.
function methodBody(src, needle, label) {
  const at = src.indexOf(needle);
  assert.ok(at >= 0, `${label} 의 선언을 못 찾았다(시그니처가 바뀌었다면 여기를 갱신할 것) — 앵커 없음은 통과가 아니다: ${needle}`);
  assert.strictEqual(at, src.lastIndexOf(needle), `${label} 의 선언 앵커가 여러 곳이다 — 겨냥이 흐리다: ${needle}`);

  let i = at, open = -1;
  const n = src.length;
  const skipString = (k, quote) => {           // '..' ".." — 백슬래시 이스케이프
    k++;
    while (k < n) {
      if (src[k] === '\\') { k += 2; continue; }
      if (src[k] === quote) return k + 1;
      k++;
    }
    return k;
  };
  const skipVerbatim = (k) => {                // @".." — 큰따옴표 두 번이 이스케이프
    k += 2;
    while (k < n) {
      if (src[k] === '"') { if (src[k + 1] === '"') { k += 2; continue; } return k + 1; }
      k++;
    }
    return k;
  };
  const step = (k) => {
    if (src[k] === '@' && src[k + 1] === '"') return skipVerbatim(k);
    if (src[k] === '"' || src[k] === "'") return skipString(k, src[k]);
    if (src[k] === '/' && src[k + 1] === '/') { const e = src.indexOf('\n', k); return e < 0 ? n : e; }
    if (src[k] === '/' && src[k + 1] === '*') { const e = src.indexOf('*/', k); return e < 0 ? n : e + 2; }
    return -1;                                  // 건너뛸 것 없음
  };

  while (i < n) {                               // 본문 여는 '{' 찾기
    const s = step(i);
    if (s >= 0) { i = s; continue; }
    if (src[i] === '{') { open = i; break; }
    i++;
  }
  assert.ok(open >= 0, `${label} 의 본문 '{' 를 못 찾았다`);

  let depth = 0, j = open;
  while (j < n) {
    const s = step(j);
    if (s >= 0) { j = s; continue; }
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(open, j + 1); }
    j++;
  }
  assert.fail(`${label} 의 중괄호 짝이 안 맞는다(닫힘 없음)`);
}

// 세 진입점 — 모두 프론트가 보낸 vcs(라디오 선택)를 받는 핸들러다.
const ENTRIES = [
  ['gitlog', 'private async Task RunGitLogAsync('],
  ['gitauthor', 'private async Task RunGitAuthorAsync('],
  ['gitcheck', 'private async Task RunGitCheckAsync('],
];

// 복제식 — ResolveVcs 의 본문(`IsNullOrWhiteSpace(vcs) ? … : vcs`)을 손으로 베낀 자리.
// 헬퍼 **선언 자체**는 이 모양이어야 하므로 Svn.cs 는 예외로 둔다(아래 ⑤에서 따로 본다).
const CLONE_RE = /IsNullOrWhiteSpace\s*\(\s*vcs\s*\)\s*\?[^;]*:\s*vcs\b/;

const checks = {
  //  헬퍼가 실재하고 유일하다
  helperExists(svnSrc) {
    const m = svnSrc.match(/private static string ResolveVcs\s*\(/g) || [];
    assert.strictEqual(m.length, 1,
      `Svn.cs 의 ResolveVcs 선언이 ${m.length}개다 — 분기 단일 소스가 하나여야 '단일' 이다`);
  },

  //  세 진입점이 각자 헬퍼를 부른다
  allEntriesUseHelper(hostSrc) {
    const missing = [];
    for (const [name, sig] of ENTRIES) {
      const body = methodBody(hostSrc, sig, name);
      if (!/\bResolveVcs\s*\(/.test(body)) missing.push(name);
    }
    assert.strictEqual(missing.length, 0,
      'ResolveVcs 를 부르지 않는 진입점이 있다 — 그 자리는 규칙이 바뀌어도 조용히 뒤처진다. ' +
      '해당 진입점: ' + missing.join(', '));
  },

  //  어느 진입점도 헬퍼 본문을 손으로 복제하지 않는다(재발 금지)
  noClonedExpression(hostSrc) {
    const cloned = [];
    for (const [name, sig] of ENTRIES) {
      const body = methodBody(hostSrc, sig, name);
      if (CLONE_RE.test(body)) cloned.push(name);
    }
    assert.strictEqual(cloned.length, 0,
      'ResolveVcs 의 식을 손으로 복제한 진입점이 있다 — 오늘 동작이 같아도 내일 갈라진다(2026-09-07 에 gitcheck 에서 실제로 그랬다). ' +
      '해당 진입점: ' + cloned.join(', '));
  },
};

test('분기①: ResolveVcs 가 Svn.cs 에 정확히 하나 있다(분기 단일 소스)', () => {
  checks.helperExists(svn);
});

test('분기②: gitlog·gitauthor·gitcheck 가 모두 ResolveVcs 를 부른다', () => {
  checks.allEntriesUseHelper(mainwin);
});

test('분기③: 어느 진입점도 ResolveVcs 의 식을 복제하지 않는다', () => {
  checks.noClonedExpression(mainwin);
});

test('분기④: pickfolder 는 예외 — DetectVcs 직접 호출이 허용된다(문서화된 예외)', () => {
  //  ★ 이 검사가 없으면 다음 사람이 '통일' 을 이유로 pickfolder 까지 ResolveVcs 로 바꾼다.
  //    거기는 사용자가 아직 종류를 못 정한 진입점이라, 빈 vcs 를 넘겨 봐야 같은 결과이고
  //    의도가 흐려진다. Svn.cs 주석이 예외로 못 박은 자리다.
  const body = methodBody(mainwin, 'private void PickFolder(', 'pickfolder');
  assert.ok(/\bDetectVcs\s*\(/.test(body),
    'pickfolder 에서 DetectVcs 직접 호출이 사라졌다 — 폴더의 실제 마커를 프론트에 제안하는 경로가 죽는다');
});

test('분기⑤: 헬퍼 자신은 "빈 vcs면 DetectVcs, 아니면 vcs" 규칙을 유지한다', () => {
  const decl = /ResolveVcs\s*\([^)]*\)\s*=>\s*([^;]+);/.exec(svn);
  assert.ok(decl, 'ResolveVcs 의 식 본문(=>)을 못 찾았다 — 형태가 바뀌었다면 여기를 갱신할 것');
  assert.ok(CLONE_RE.test(decl[1]), 'ResolveVcs 가 "빈 vcs → DetectVcs, 아니면 vcs" 규칙이 아니다');
  assert.ok(/\bDetectVcs\s*\(/.test(decl[1]), 'ResolveVcs 가 DetectVcs 를 부르지 않는다 — 자동판별이 죽었다');
});

// ── 변이 시험 — 계약이 정말 발화하는지 ───────────────────────────────
//  ★ 접미사 변이(ResolveVcs → ResolveVcs_MUTATED)는 쓰지 않는다. 부분문자열 검사에 그대로
//    걸려 "잡았다" 는 거짓 초록을 만든다. 아래는 전부 **의미를 바꾸는** 변이다.

test('변이㉑: gitcheck 에서 ResolveVcs 호출을 복제식으로 되돌리면 분기② 가 실패한다', () => {
  //  이것이 2026-09-07 이전의 실제 코드다 — 그때는 어떤 시험도 빨개지지 않았다.
  //  ★ 뒤 주석까지 앵커에 넣는다 — 앞부분만 쓰면 gitlog 의 같은 대입문에도 걸려
  //    "앵커가 여러 곳" 으로 판정 불가가 된다(실측 2곳). 겨냥은 유일해야 한다.
  const FIND = 'string useVcs = ResolveVcs(repo, vcs);   // 명시 선택 우선, 없으면 DetectVcs';
  const at = mainwin.indexOf(FIND);
  assert.ok(at >= 0, '변이 앵커를 못 찾았다(gitcheck 의 useVcs 대입) — 앵커 없음은 통과가 아니다');
  assert.strictEqual(at, mainwin.lastIndexOf(FIND), '변이 앵커가 여러 곳이다 — 겨냥이 흐리다');
  const bad = mainwin.slice(0, at)
    + 'string useVcs = string.IsNullOrWhiteSpace(vcs) ? detected : vcs;'
    + mainwin.slice(at + FIND.length);

  assert.throws(() => checks.allEntriesUseHelper(bad), /gitcheck/);
  assert.throws(() => checks.noClonedExpression(bad), /gitcheck/);
  //  통제군 — 원본은 통과한다(위 실패가 '변이 때문' 임을 증명. 계약이 과하지 않다)
  assert.doesNotThrow(() => checks.allEntriesUseHelper(mainwin));
  assert.doesNotThrow(() => checks.noClonedExpression(mainwin));
});

test('변이㉒: gitlog 에서 헬퍼를 걷어내고 vcs 를 그대로 쓰면 분기② 가 실패한다', () => {
  //  '명시 선택만 보고 자동판별을 버리는' 회귀 — 폴더 마커가 .svn 인데 라디오를 안 고른
  //  사용자에게 git 을 돌리게 된다(빈 문자열 → GitLog 경로).
  const FIND = 'string useVcs = ResolveVcs(repo, vcs);   // 분기 단일 소스(명시 선택 우선, 없으면 DetectVcs)';
  const at = mainwin.indexOf(FIND);
  assert.ok(at >= 0, '변이 앵커를 못 찾았다(gitlog 의 useVcs 대입)');
  assert.strictEqual(at, mainwin.lastIndexOf(FIND), '변이 앵커가 여러 곳이다');
  const bad = mainwin.slice(0, at) + 'string useVcs = vcs;' + mainwin.slice(at + FIND.length);
  assert.throws(() => checks.allEntriesUseHelper(bad), /gitlog/);
});

test('변이㉓: 헬퍼 선언을 하나 더 만들면 분기① 이 실패한다(단일 소스가 둘이 되면 단일이 아니다)', () => {
  const bad = svn + '\n        private static string ResolveVcs(string a, string b) => b;\n';
  assert.throws(() => checks.helperExists(bad), /2개다/);
});

test('변이㉔: 본문 잘라내기가 이웃 메서드로 새면 계약이 무력해진다 — 그렇지 않음을 확인', () => {
  //  ★ 이 검사가 지키는 것은 '계약' 이 아니라 '계약의 눈' 이다.
  //    methodBody 가 느슨해 이웃까지 삼키면, gitcheck 의 호출을 지워도 gitauthor 의 호출이
  //    대신 잡혀 **통과**한다. 그러면 위의 모든 변이 시험이 조용히 거짓 초록이 된다.
  const check = methodBody(mainwin, 'private async Task RunGitCheckAsync(', 'gitcheck');
  const author = methodBody(mainwin, 'private async Task RunGitAuthorAsync(', 'gitauthor');
  assert.ok(!check.includes('RunGitAuthorAsync'), 'gitcheck 본문이 이웃(gitauthor)까지 삼켰다');
  assert.ok(!author.includes('RunGitCheckAsync'), 'gitauthor 본문이 이웃(gitcheck)까지 삼켰다');
  assert.ok(!author.includes('RunGitLogAsync'), 'gitauthor 본문이 이웃(gitlog)까지 삼켰다');
  //  각 본문은 자기 것만 담는다 — 길이가 파일 전체에 가까우면 잘라내기가 실패한 것이다
  for (const [name, sig] of ENTRIES) {
    const b = methodBody(mainwin, sig, name);
    assert.ok(b.length < mainwin.length / 4, `${name} 본문이 지나치게 크다(${b.length}자) — 잘라내기가 샜다`);
  }
});
