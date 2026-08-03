// 상단바 「사용자 정보」 (👤 #btnUser → #userModal) — 구조 불변식 (2026-08-03)
//
// 왜 이 테스트가 있나:
//   ① 계정은 설정창 3단 아래에 묻혀 있었다. '내가 누구로 로그인해 있는가'는 상시 확인 대상이라
//      상단바로 승격했다 — 그 자리는 다시 설정창으로 되돌아가면 안 된다(표면이 둘이 되면 더 나쁘다).
//   ② 상단바는 폭 예산이 빠듯하다. 👤 하나가 늘어난 대가로 690px 실측에서 헤더가 한 줄 늘었고
//      (113px → 158px, 캘린더 45px 손실) 보고서 라벨 접기 경계를 679 → 739px 로 넓혀 상쇄했다.
//      이 숫자 둘(has-label 부재 · 739px)은 '취향'이 아니라 측정 결과다 — 기계가 지킨다.
//   ③ 권한은 '표시만' 한다. 화면이 캐시한 역할로 편집을 미리 막으면 그 캐시가 낡는 순간 반드시 틀린다.
//      판정은 쓰기 요청 시점에 호스트의 DB 관문이 한다(USER-LOGIN §3.3). 그래서 조회 경로는
//      OpenReadAsync 여야 한다 — 쓰기 관문을 쓰면 viewer 가 자기 권한을 확인조차 못 한다.
//
// 검사 함수(checks)를 테스트와 변이 주입이 공유한다 — 검사가 실제로 잡는지 증명하기 위해서다.
import { test, assert, loadAppSource, extractFunction } from './harness.mjs';
import { readFileSync } from 'node:fs';

const src  = loadAppSource();
const main = readFileSync(new URL('../widget/MainWindow.xaml.cs', import.meta.url), 'utf8');
const pdb  = readFileSync(new URL('../widget/ProjectDb.cs', import.meta.url), 'utf8');

// ── 소스 슬라이서 ──────────────────────────────────────────────────────

// 주석 제거(문자열 리터럴은 보존). 설명 주석에 'OpenWriteAsync' 같은 단어가 들어 있어도
// "코드가 실제로 그걸 부르는가"와 헷갈리면 안 된다.
function stripComments(s) {
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

// C# switch 의 한 case 블록 — `case "<name>":` 부터 그 뒤 첫 `break;` 까지(주석 제거본 기준).
function csCase(source, name) {
  const code = stripComments(source);
  const s = code.indexOf('case "' + name + '":');
  assert.ok(s >= 0, `호스트 case "${name}" 을 찾지 못함`);
  const e = code.indexOf('break;', s);
  assert.ok(e > s, `case "${name}" 의 break; 를 찾지 못함`);
  return code.slice(s, e + 6);
}

// C# 멤버 본문 슬라이스 — 시그니처 조각부터 중괄호 짝이 맞는 곳까지(주석 제거본 기준).
// ★ '다음 멤버 선언까지'로 자르지 않는다: 접근 한정자 없이 시작하는 멤버(명시적 인터페이스 구현 등)
//   앞에서 멈추지 못해 남의 코드를 끌어온다 — 실제로 뒤에 있던 GitReply 호출이 이 메서드 것으로 오탐됐다.
function csMember(source, sig) {
  const code = stripComments(source);
  const s = code.indexOf(sig);
  assert.ok(s >= 0, `C# 멤버를 찾지 못함: ${sig}`);
  const open = code.indexOf('{', s);
  assert.ok(open > s, `${sig} 의 여는 중괄호를 찾지 못함`);
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    const c = code[k];
    if (c === '"' || c === "'") {          // 문자열/문자 리터럴 안의 중괄호는 세지 않는다
      let j = k + 1;
      while (j < code.length) { if (code[j] === '\\') { j += 2; continue; } if (code[j] === c) break; j++; }
      k = j; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return code.slice(s, k + 1); }
  }
  assert.fail(`${sig} 의 중괄호 짝이 맞지 않는다`);
}

// CSS 미디어쿼리 블록들 — 같은 헤더가 여러 번 나온다(모달 터치 하한 등)라 전부 돌려주고 호출측이 고른다.
function mediaBlocks(css, header) {
  const out = [];
  for (let from = 0; ;) {
    const s = css.indexOf(header, from);
    if (s < 0) return out;
    const open = css.indexOf('{', s);
    let depth = 0, close = css.length;
    for (let k = open; k < css.length; k++) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}') { depth--; if (depth === 0) { close = k; break; } }
    }
    out.push(css.slice(open + 1, close));
    from = close + 1;
  }
}

// 상단바 액션 줄 마크업 — <div class="actions"> 부터 </header> 직전까지.
function actionsMarkup(source) {
  const s = source.indexOf('<div class="actions">');
  assert.ok(s >= 0, '상단바 .actions 를 찾지 못함');
  const e = source.indexOf('</header>', s);
  assert.ok(e > s, '.actions 뒤의 </header> 를 찾지 못함');
  return source.slice(s, e);
}

// 사용자 정보 모달 마크업 — #userModal 부터 그 다음 모달(구성원) 직전까지.
// ★ 경계가 '사용설명서'였다가 '구성원'으로 당겨졌다: #membersModal 이 그 사이에 끼면서
//   구성원 모달의 <input>·data-close 가 #userModal 것으로 오탐됐다(입력칸 부재 검사가 통째로 무력화).
function userModalMarkup(source) {
  const s = source.indexOf('<div class="overlay hidden" id="userModal">');
  assert.ok(s >= 0, '#userModal 마크업을 찾지 못함(.overlay 여야 한다)');
  const e = source.indexOf('<!-- ===== 구성원 =====', s);
  assert.ok(e > s, '#userModal 뒤의 구성원 모달을 찾지 못함');
  return source.slice(s, e);
}

// 구성원 모달 마크업 — #membersModal 부터 그 다음 모달(사용설명서) 직전까지.
function membersModalMarkup(source) {
  const s = source.indexOf('<div class="overlay hidden" id="membersModal">');
  assert.ok(s >= 0, '#membersModal 마크업을 찾지 못함(.overlay 여야 한다)');
  const e = source.indexOf('<!-- ===== 자세한 사용설명서', s);
  assert.ok(e > s, '#membersModal 뒤의 사용설명서 모달을 찾지 못함');
  return source.slice(s, e);
}

// #usPermSec 구획 — 권한 라벨부터 그 다음 구획(#usMembersSec 앞 주석) 직전까지.
function permSecMarkup(source) {
  const s = source.indexOf('<div class="set-sec set-sec-top hidden" id="usPermSec">');
  assert.ok(s >= 0, '#usPermSec 를 찾지 못함');
  const e = source.indexOf('<!-- 구성원 진입점', s);
  assert.ok(e > s, '#usPermSec 뒤의 구성원 진입점 구획을 찾지 못함');
  return source.slice(s, e);
}

// CSS 규칙 한 덩이 — `<selector>{...}` (중첩 없음).
function cssRule(source, selector) {
  const css = source.slice(source.indexOf('<style>'), source.indexOf('</style>'));
  const i = css.indexOf('\n' + selector + '{');
  assert.ok(i >= 0, `CSS 규칙 ${selector}{...} 를 찾지 못함`);
  const open = css.indexOf('{', i), close = css.indexOf('}', open);
  assert.ok(close > open, `${selector} 규칙이 닫히지 않았다`);
  return css.slice(open + 1, close);
}

// `const NAME = { ... }` 한 줄(중첩 중괄호 없음).
function constObj(source, name) {
  const m = new RegExp('const ' + name + '\\s*=\\s*\\{[^}]*\\}').exec(source);
  assert.ok(m, `${name} 정의를 찾지 못함`);
  return m[0];
}

const jsBody = (source, name) => stripComments(extractFunction(source, name));

// loadUserPerm 의 두 분기를 갈라 준다 — '성공에서 무엇을 칠하는가'와 '실패에서 무엇을 건드리지 않는가'는
// 서로 다른 계약이라 한 덩어리로 보면 둘 중 하나는 반드시 통과해 버린다.
//   ok   = `if(r && r.ok && r.info){ … }` 블록 전체(중괄호 짝을 맞춰 자른다)
//   fail = 그 뒤 전부
// ★ '확인할 수 없음' 첫 등장으로 자르지 않는다: 실패 문구를 성공 분기 앞에 끼워 넣는 회귀를
//   실패 쪽으로 보내지 못해 검사가 통째로 무력화된다(실제로 그렇게 짰다가 변이가 안 잡혔다).
function permBranches(source) {
  const all = jsBody(source, 'loadUserPerm');
  const s = all.indexOf('if(r && r.ok && r.info)');
  assert.ok(s >= 0, 'loadUserPerm 의 성공 분기(if(r && r.ok && r.info))를 찾지 못함');
  const open = all.indexOf('{', s);
  assert.ok(open > s, 'loadUserPerm 성공 분기의 여는 중괄호를 찾지 못함');
  let depth = 0, close = -1;
  for (let k = open; k < all.length; k++) {
    const c = all[k];
    if (c === '"' || c === "'" || c === '`') {   // 문자열 리터럴 안의 중괄호는 세지 않는다
      let j = k + 1;
      while (j < all.length) { if (all[j] === '\\') { j += 2; continue; } if (all[j] === c) break; j++; }
      k = j; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { close = k; break; } }
  }
  assert.ok(close > open, 'loadUserPerm 성공 분기의 중괄호 짝이 맞지 않는다');
  assert.ok(/확인할 수 없음/.test(all.slice(close)), 'loadUserPerm 의 실패 분기(확인할 수 없음)를 찾지 못함');
  return { ok: all.slice(s, close + 1), fail: all.slice(close + 1), all };
}

// 옛 계정 섹션이 남긴 id 8개 — 하나라도 살아 있으면 '옮긴 것'이 아니라 '복제한 것'이다.
const DEAD_ACCT_IDS = ['acctState', 'acctHint', 'acctInfoBlock', 'acctName', 'acctTitle', 'acctOrg', 'acctLogout', 'acctMsg'];

// ══ 검사 함수(테스트 + 변이 주입이 같은 함수를 쓴다) ══════════════════

const checks = {
  // ① 진입점은 상단바에 있고, 라벨이 붙지 않았다 — 라벨을 붙이면 폭 예산이 깨진다(측정: ③ 참고).
  topbarButton(source) {
    const sec = actionsMarkup(source);
    const m = /<button([^>]*)id="btnUser"([^>]*)>/.exec(sec);
    assert.ok(m, '#btnUser 가 상단바 .actions 안에 없다 — 계정이 다시 메뉴 안으로 숨었다');
    const attrs = m[1] + m[2];
    assert.ok(!/has-label/.test(attrs),
      '#btnUser 에 has-label 이 붙었다 — 라벨(≈50px)이 액션 줄 폭 예산을 넘겨 690px에서 헤더가 한 줄 늘어난다');
    assert.ok(/aria-label="사용자 정보"/.test(attrs), '#btnUser 에 aria-label 이 없다(아이콘 전용이라 이름이 여기밖에 없다)');
    assert.ok(/title="/.test(attrs), '#btnUser 에 title 이 없다 — 아이콘만으로는 무엇인지 알 수 없다');
    // 아이콘도 라벨 없이 넣어야 한다(applyIcons 가 innerHTML 을 통째로 갈아끼우므로 여기서 되살아날 수 있다).
    const icons = extractFunction(source, 'applyIcons');
    assert.ok(/set\('btnUser',\s*ICON\.user\)/.test(icons), "applyIcons 가 set('btnUser', ICON.user) 를 하지 않는다");
    assert.ok(!/set\('btnUser',\s*label\(/.test(icons), 'applyIcons 가 #btnUser 에 라벨을 붙인다 — 폭 예산이 깨진다');
    assert.ok(/user:\s*svgIc\(/.test(source), 'ICON.user 글리프가 없다(이모지가 그대로 남는다)');
    // 배선 — 버튼이 있어도 열리지 않으면 아무 의미가 없다.
    assert.ok(/\$\('#btnUser'\)\.addEventListener\('click',\s*openUserInfo\)/.test(source),
      '#btnUser 가 openUserInfo 에 배선되지 않았다');
  },

  // ② 아주 좁은 폭(≤440px)에서는 보조 버튼과 함께 접힌다 — 액션 줄이 nowrap 이라 안 접으면 잘린다.
  narrowHidden(source) {
    const css = source.slice(source.indexOf('<style>'), source.indexOf('</style>'));
    // ≤440px 블록은 여럿이다(모달 터치 하한 등) — 접기 규칙(.mm-fold)이 든 그 블록만 본다.
    const blk = mediaBlocks(css, '@media (max-width:440px){').find((b) => /\.mm-fold\{display:block\}/.test(b));
    assert.ok(blk, '≤440px 접기 블록(.mm-fold{display:block})을 찾지 못함 — ⋯ 메뉴가 열리지 않으면 접힌 버튼은 도달 불가다');
    assert.ok(/#btnSearch[^\n]*#btnUser[^\n]*\{display:none\}/.test(blk),
      '≤440px 숨김 목록에 #btnUser 가 없다 — 위젯 실폭에서 액션 줄이 넘쳐 ＋새 기록이 잘린다');
  },

  // ③ 보고서 라벨 접기 경계는 739px 이다 — 679 로 되돌리면 690px 구간에서 헤더가 두 줄이 된다(실측).
  reportLabelBreakpoint(source) {
    const css = source.slice(source.indexOf('<style>'), source.indexOf('</style>'));
    assert.ok(/@media \(max-width:739px\)\{\s*#btnReportTop \.btn-label\{display:none\}\s*\}/.test(css),
      '보고서 라벨 접기 경계가 739px 이 아니다 — 👤가 늘어난 만큼(40+8px) 미리 접지 않으면 690px에서 헤더가 113→158px로 늘어난다');
    assert.ok(!/@media \(max-width:679px\)/.test(css),
      '옛 679px 경계가 남아 있다 — 경계가 둘이면 어느 쪽이 사는지 폭마다 달라진다');
  },

  // ④ ⋯ 접기 — 숨은 폭에서의 유일한 도달 경로. 동작 정의를 두 벌로 만들지 않고 원본 클릭을 위임한다.
  foldEntry(source) {
    assert.ok(/<button id="btnUserFold">사용자 정보<\/button>/.test(source), '⋯ 접기 항목 #btnUserFold 가 없다');
    assert.ok(/btnUserFold\s*:\s*'#btnUser'/.test(source),
      '위임 맵에 btnUserFold → #btnUser 가 없다 — ≤440px에서 사용자 정보에 도달할 방법이 사라진다');
  },

  // ⑤ 이건 '닫을 수 있는' 모달이다 — 로그인 게이트(.lg-gate, 닫기 경로 없음)와 정반대다.
  closableOverlay(source) {
    const md = userModalMarkup(source);
    assert.ok(/<div class="overlay hidden" id="userModal">/.test(source),
      '#userModal 이 .overlay 가 아니다 — Esc·배경클릭·모달스택이 이 모달을 모른다');
    assert.ok(!/lg-gate/.test(md), '#userModal 이 게이트 클래스를 쓴다 — 게이트는 닫히면 안 되는 덮개다(정반대 요구)');
    const closers = [...md.matchAll(/data-close/g)].length;
    assert.ok(closers >= 2, `data-close 닫기 경로가 ${closers}개다(× 와 [닫기] 둘이어야 한다)`);
    assert.ok(/<button class="x" data-close aria-label="닫기">×<\/button>/.test(md), '헤더 × 닫기 버튼이 없다');
    // 로그인 입력칸은 없다 — 진입점은 시작 게이트 하나뿐이다(둘이면 상태 동기화 코드가 늘고 곧 버려진다).
    assert.ok(!/<input/.test(md), '#userModal 에 입력칸이 생겼다 — 로그인 진입점을 둘로 만들면 안 된다');
  },

  // ⑥ 옛 계정 섹션은 '옮겨진' 것이지 복제된 게 아니다 — 잔재 0건.
  oldAccountGone(source) {
    assert.ok(!source.includes('accountSection'), '#accountSection 이 되살아났다 — 계정 표면이 둘이 된다');
    for (const id of DEAD_ACCT_IDS) {
      assert.ok(!source.includes(id), `옛 계정 섹션의 ${id} 가 남아 있다(옮긴 게 아니라 복제됐다)`);
    }
    assert.ok(!source.includes('updateAccountUi'), '옛 updateAccountUi 가 남아 있다 — 갱신 함수가 둘이면 하나는 반드시 낡는다');
    // 새 표면은 반대로 전부 있어야 한다(잔재만 지우고 옮기지 않은 상태 방지).
    for (const id of ['usState', 'usHint', 'usInfoBlock', 'usName', 'usTitle', 'usOrg', 'usPermSec', 'usLogout', 'usMsg']) {
      assert.ok(source.includes('id="' + id + '"'), `사용자 정보 모달의 #${id} 가 없다`);
    }
  },

  // ⑦ 설정창은 이제 계정을 모른다 — 갱신 호출이 남아 있으면 없는 요소를 매번 찾는 죽은 코드가 된다.
  settingsClean(source) {
    const fn = extractFunction(source, 'openSettings');
    assert.ok(!/updateAccountUi/.test(fn), 'openSettings 가 updateAccountUi 를 부른다 — 계정 섹션은 설정창을 떠났다');
    assert.ok(!/acct/.test(fn), 'openSettings 에 옛 계정 요소 참조가 남아 있다');
    assert.ok(!/updateUserUi/.test(fn), 'openSettings 가 사용자 정보 모달을 갱신한다 — 설정창은 그 모달을 모른다(갱신은 openUserInfo)');
    // 부수피해 방지: 이 함수의 나머지 초기화는 그대로여야 한다.
    assert.ok(/cmd:\s*'dbInfoGet'/.test(fn) && /updateDbStatusLine\(\)/.test(fn), '설정 오픈의 과제 DB 초기화가 함께 지워졌다');
  },

  // ⑧ DB 에서 온 이름·소속·권한은 textContent 로만 — 마크업으로 해석되면 안 된다.
  textContentOnly(source) {
    for (const name of ['updateUserUi', 'loadUserPerm']) {
      const b = jsBody(source, name);
      assert.ok(/\.textContent\s*=/.test(b) || /set\(/.test(b), `${name} 이 값을 쓰지 않는다(전제 붕괴)`);
      assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(b),
        `${name} 이 HTML 주입 API 를 쓴다 — DB 문자열이 마크업으로 해석된다(XSS)`);
    }
    // set 헬퍼 자체가 textContent 여야 한다(innerHTML 로 바뀌면 위 검사를 통과하면서 뚫린다).
    const u = jsBody(source, 'updateUserUi');
    assert.ok(/const set = \(id, t\) => \{ const e = document\.getElementById\(id\); if\(e\) e\.textContent = t; \}/.test(u),
      'updateUserUi 의 set 헬퍼가 textContent 로 쓰지 않는다');
  },

  // ⑨ 호스트: 권한 조회는 '읽기' 경로다. 쓰기 관문을 쓰면 viewer 가 자기 권한을 영원히 못 본다.
  hostReadPath(csMain, csDb) {
    const c = csCase(csMain, 'userInfoGet');
    assert.ok(/RunUserInfoGetAsync/.test(c), 'case "userInfoGet" 이 RunUserInfoGetAsync 를 부르지 않는다');
    const b = csMember(csMain, 'private async Task RunUserInfoGetAsync(string reqId)');
    assert.ok(/LoadUserInfoJsonAsync/.test(b), '호스트 핸들러가 권한 조회를 하지 않는다');
    assert.ok(/ReplyOnUi\(/.test(b) && !/GitReply\(/.test(b),
      'async 핸들러가 GitReply 로 직접 회신한다 — CoreWebView2 는 스레드 친화적이라 ReplyOnUi(UI 마샬)여야 한다');
    assert.ok(/로그인이 필요합니다\./.test(b) && /사용자 정보가 등록되어 있지 않습니다/.test(b),
      '세션 없음/미등록을 구분해 안내하지 않는다');
    assert.ok(!/ex\.Message/.test(b), '예외 원문을 사용자 회신에 실었다 — 내부 사정은 로그에만 남긴다');

    const q = csMember(csDb, 'public async Task<string?> LoadUserInfoJsonAsync(string loginId)');
    // 순서 주의 — 쓰기 관문으로 바뀌면 두 단언이 함께 깨진다. 원인을 정확히 말하는 쪽을 앞에 둔다.
    assert.ok(!/OpenWriteAsync/.test(q),
      '권한 조회가 쓰기 관문을 쓴다 — "권한을 보려면 먼저 권한이 있어야 한다"는 순환이라 viewer 는 자기 권한을 확인조차 못 한다');
    assert.ok(/OpenReadAsync/.test(q), '권한 조회가 읽기 연결을 쓰지 않는다');
    assert.ok(/WHERE login_id=@id/.test(q) && /AddWithValue\("@id", id\)/.test(q),
      '값을 파라미터로 바인딩하지 않는다(문자열 연결 금지)');
    assert.ok(/"found"/.test(q) && /found.*=.*true|\["found"\]\s*=\s*true/s.test(q),
      '행 있음/없음을 found 로 구분하지 않는다 — 호출측이 미등록과 조회 실패를 구별할 수 없다');
    // 비밀번호·DB 계정은 이 경로 근처에도 오지 않는다.
    assert.ok(!/DbPassword|DeployConfig\.DbUser|DeployConfig\.DbName/.test(q + b),
      '권한 조회 경로가 DB 자격/DB명을 참조한다 — 화면으로 흘러갈 값이 아니다');
  },

  // ⑩ 권한은 '문장'으로 보여준다 — 원시 코드값(admin/self…)을 그대로 노출하지 않는다.
  permMapping(source) {
    const edit = constObj(source, 'US_EDIT_ROLE');
    for (const [k, ko] of [['admin', '관리자'], ['editor', '편집자'], ['viewer', '열람자']]) {
      assert.ok(new RegExp(k + ":\\s*'" + ko).test(edit), `edit_role 매핑에 ${k} → ${ko} 가 없다`);
    }
    const view = constObj(source, 'US_VIEW_SCOPE');
    for (const [k, ko] of [['all', '전체'], ['unit_tree', '소속 조직'], ['self', '본인만']]) {
      assert.ok(new RegExp(k + ":\\s*'" + ko).test(view), `view_scope 매핑에 ${k} → ${ko} 가 없다`);
    }
    const t = jsBody(source, 'usRoleText');
    assert.ok(/map\[k\]/.test(t), 'usRoleText 가 매핑표를 보지 않는다 — 원시 코드값을 그대로 노출한다');
    assert.ok(/알 수 없는 값/.test(t), '모르는 코드값을 조용히 삼킨다 — 화면이 틀린 설명을 하는 것보다 단서를 남겨야 한다');
    const b = jsBody(source, 'loadUserPerm');
    assert.ok(/usRoleText\(US_EDIT_ROLE/.test(b) && /usRoleText\(US_VIEW_SCOPE/.test(b),
      '권한 렌더가 매핑을 거치지 않는다 — DB 코드값이 그대로 화면에 뜬다');
    assert.ok(/확인할 수 없음/.test(b), '조회 실패에 값을 남겨 둔다 — 낡거나 지어낸 권한을 보이면 안 된다');
    assert.ok(/계정 비활성 — 편집 불가/.test(b), 'is_active=0 을 편집 가능처럼 보여준다');
    assert.ok(/__usPermBusy/.test(b), '재진입 가드가 없다 — 오픈과 [지금 새로고침]이 겹치면 늦은 회신이 이긴다');
  },

  // 표시 전용 — 이 값으로 화면이 무엇도 막지 않는다(판정은 호스트가 요청 시점에 한다).
  displayOnly(source) {
    const b = jsBody(source, 'loadUserPerm');
    assert.ok(!/disabled\s*=|classList\.(add|toggle)\('disabled'/.test(b),
      '권한 값으로 컨트롤을 잠근다 — 캐시된 역할로 미리 막으면 낡는 순간 반드시 틀린다(USER-LOGIN §3.3)');
    const g = jsBody(source, 'offEditGuard');
    assert.ok(!/US_EDIT_ROLE|edit_role|usEditRole/.test(g), '편집 게이트가 표시용 권한을 보기 시작했다');
  },

  // 모달은 조회를 기다리며 늦게 열리지 않는다 — 신원(세션)은 오프라인에서도 즉시 보여야 한다.
  opensBeforeFetch(source) {
    const b = jsBody(source, 'openUserInfo');
    const u = b.indexOf('updateUserUi()');
    const o = b.indexOf("openModal('#userModal')");
    const p = b.indexOf('loadUserPerm()');
    assert.ok(u >= 0 && o > u, '신원을 먼저 그리지 않는다 — 오프라인에서도 이름은 보여야 한다');
    assert.ok(p > o, '권한 조회가 모달 오픈보다 앞이다 — DB가 느리면 눌러도 한동안 아무 일도 안 일어난다');
    assert.ok(!/await/.test(b), 'openUserInfo 가 조회를 await 한다 — 모달이 회신을 기다렸다 열린다');
  },

  // 로그아웃은 '사용자 정보' 모달을 닫는다(게이트가 그 위를 덮으면 뒤에 열린 모달을 인지하지 못한다).
  logoutClosesUserModal(source) {
    const b = jsBody(source, 'submitLogout');
    assert.ok(/getElementById\('userModal'\)/.test(b), '로그아웃이 사용자 정보 모달을 닫지 않는다');
    assert.ok(!/settingsModal/.test(b), '로그아웃이 아직 설정 모달을 닫는다 — 계정은 그 창을 떠났다');
    assert.ok(/getElementById\('usMsg'\)/.test(b), '진행 문구를 표시할 자리가 옛 요소(acctMsg)를 가리킨다');
    assert.ok(/\$\('#usLogout'\)[\s\S]{0,120}submitLogout/.test(source), '#usLogout 배선이 끊겼다');
    assert.ok(/\$\('#usPermReload'\)[\s\S]{0,140}loadUserPerm/.test(source), '#usPermReload 배선이 끊겼다');
  },

  // 5단계 '타인 일정 열람' 은 아직 만들지 않는다 — 빈 약속을 UI로 걸어 두지 않는다.
  noFuturePromise(source) {
    const md = userModalMarkup(source);
    assert.ok(!/타인|다른 사람|남의 일정|열람 요청/.test(md),
      '아직 없는 「타인 일정 열람」 UI가 모달에 들어왔다 — 동작하지 않는 약속은 걸지 않는다');
  },

  // ⑮ 권한은 '라벨:값' 2행이다. 라벨을 값 위에 쌓으면 4줄이 되고, 400px(위젯 실폭) 모달에서
  //    그 2줄이 곧 스크롤이다 — 값 2개를 보려고 창을 굴리게 만들면 안 된다.
  permTwoRows(source) {
    const r = cssRule(source, '.us-kv');
    assert.ok(/display:grid/.test(r), '.us-kv 가 grid 가 아니다 — 라벨:값이 다시 세로로 쌓여 4줄이 된다');
    const m = /grid-template-columns:([^;]+)/.exec(r);
    assert.ok(m, '.us-kv 에 grid-template-columns 가 없다 — 열 정의가 없으면 1열(=세로 쌓기)이다');
    const cols = m[1].trim().split(/\s+/);
    assert.strictEqual(cols.length, 2,
      `.us-kv 가 ${cols.length}열이다 — 라벨 칸 + 값 칸 2열이어야 한 줄에 붙는다(2줄 유지)`);
  },

  // ⑯ dl/dt/dd 로 짠 이유: 그리드 자식이 전부 '요소'여야 한다. 맨 텍스트를 섞으면 익명 그리드
  //    아이템이 생겨 라벨 칸으로 끌려간다 — 이 저장소에서 실제로 겪은 버그다.
  permKvElementsOnly(source) {
    const sec = permSecMarkup(source);
    const m = /<dl class="us-kv">([\s\S]*?)<\/dl>/.exec(sec);
    assert.ok(m, '#usPermSec 에 <dl class="us-kv"> 가 없다');
    const inner = m[1];
    assert.ok(/<dt>편집 권한<\/dt><dd id="usEditRole">/.test(inner),
      '#usEditRole 이 <dd> 가 아니다 — 값이 라벨 칸으로 끌려간다');
    assert.ok(/<dt>열람 범위<\/dt><dd id="usViewScope">/.test(inner),
      '#usViewScope 가 <dd> 가 아니다 — 값이 라벨 칸으로 끌려간다');
    const rest = inner.replace(/<dt>[\s\S]*?<\/dt>/g, '').replace(/<dd[^>]*>[\s\S]*?<\/dd>/g, '').trim();
    assert.strictEqual(rest, '',
      `<dl class="us-kv"> 안에 dt/dd 아닌 내용이 있다(익명 그리드 아이템이 생겨 열이 밀린다): ${JSON.stringify(rest)}`);
  },

  // ⑰ 문구는 단축형이다 — 한 줄에 안 들어가면 되접혀서 2줄로 줄인 의미가 사라진다.
  permShortLabels(source) {
    const edit = constObj(source, 'US_EDIT_ROLE');
    for (const [k, ko] of [['admin', '관리자 — 추가·수정·삭제'], ['editor', '편집자 — 추가·수정'], ['viewer', '열람자 — 조회만']]) {
      assert.ok(edit.includes(k + ":'" + ko + "'"), `edit_role 의 ${k} 문구가 단축형이 아니다(기대: ${ko})`);
    }
    const view = constObj(source, 'US_VIEW_SCOPE');
    for (const [k, ko] of [['all', '전체 — 모든 구성원'], ['unit_tree', '소속 조직 — 내 부서와 하위'], ['self', '본인만']]) {
      assert.ok(view.includes(k + ":'" + ko + "'"), `view_scope 의 ${k} 문구가 다르다(기대: ${ko})`);
    }
    for (const old of ['과제 추가·수정·삭제 가능', '과제 추가·수정 가능', '조회만 가능']) {
      assert.ok(!source.includes(old),
        `옛 긴 문구가 남아 있다: ${old} — .us-kv 한 줄에서 되접혀 400px 모달이 다시 4줄이 된다`);
    }
  },

  // ⑱ 값 2개에 카드(테두리)는 과하다. 테두리는 '제출해야 하는 폼'이라는 계약인데 여기엔 제출할 게 없다.
  permNoCard(source) {
    const sec = permSecMarkup(source);
    assert.ok(!/class="set-form"/.test(sec),
      '#usPermSec 안에 .set-form 박스가 되살아났다 — 테두리는 「명시 저장 폼」의 표식이다(여긴 표시 전용)');
    assert.ok(!/usPermForm/.test(source),
      '옛 #usPermForm 이 남아 있다 — 박스를 버렸으면 그 id 도 함께 사라져야 한다(죽은 참조 방지)');
  },

  // ⑲ 구성원 모달은 닫을 수 있는 .overlay 이고, 진입점(#usMembers)·검색이 실제로 배선돼 있다.
  membersModalClosable(source) {
    assert.ok(/<div class="overlay hidden" id="membersModal">/.test(source),
      '#membersModal 이 .overlay 가 아니다 — Esc·배경클릭·모달스택이 이 모달을 모른다');
    const md = membersModalMarkup(source);
    const closers = [...md.matchAll(/data-close/g)].length;
    assert.ok(closers >= 2, `data-close 닫기 경로가 ${closers}개다(× 와 [닫기] 둘이어야 한다)`);
    assert.ok(/<button class="x" data-close aria-label="닫기">×<\/button>/.test(md), '헤더 × 닫기 버튼이 없다');
    assert.ok(/aria-label="구성원 검색"/.test(md), '#mbSearch 에 aria-label 이 없다 — 이름 없는 입력칸이 된다');
    // 배선 — 버튼이 있어도 열리지 않으면 아무 의미가 없다.
    assert.ok(/id="usMembers"/.test(source), '#usMembers(구성원 보기) 버튼이 없다');
    assert.ok(/\$\('#usMembers'\)[\s\S]{0,140}openMembers/.test(source), '#usMembers 가 openMembers 에 배선되지 않았다');
    assert.ok(/\$\('#mbSearch'\)[\s\S]{0,140}filterMembers/.test(source), '#mbSearch 검색 배선이 끊겼다');
  },

  // ⑳ 계약이 뒤집힌 검사다. 예전엔 "가짜 표본이 있으면 미리보기 배너도 있어야 한다"였다 —
  //    이제 실데이터(membersGet)로 갔으므로 표본 자체가 0건이어야 한다.
  //    둘이 섞여 있으면 화면에 뜨는 게 진짜인지 표본인지 코드를 읽기 전에는 알 수 없다.
  noPreviewSample(source) {
    assert.ok(!/US_MEMBERS_PREVIEW/.test(source),
      '가짜 표본 US_MEMBERS_PREVIEW 가 남아 있다 — 실데이터로 갔으면 표본은 사라져야 한다');
    assert.ok(!/mbPreview/.test(source),
      '#mbPreview 미리보기 배너가 남아 있다 — 진짜 명부에 "미리보기입니다"가 붙으면 사용자가 실데이터를 안 믿는다');
    // 표본만 지우고 조회를 안 붙인 상태(목록이 영원히 빈 화면) 방지.
    assert.ok(/hostRequest\('membersGet'/.test(source),
      '표본은 지웠는데 membersGet 조회가 없다 — 목록이 영원히 비어 있다');
  },

  // ㉔ 구성원 조회도 '읽기' 경로다. 쓰기 관문을 쓰면 unit_tree 를 가진 사람(=viewer 다수)이 명부를 못 본다 —
  //    열람 권한과 편집 권한은 다른 축이다(USER-LOGIN §3.3).
  membersHostReadPath(csMain, csDb) {
    const c = csCase(csMain, 'membersGet');
    assert.ok(/RunMembersGetAsync/.test(c), 'case "membersGet" 이 RunMembersGetAsync 를 부르지 않는다');
    const b = csMember(csMain, 'private async Task RunMembersGetAsync(string reqId)');
    assert.ok(/LoadMembersJsonAsync/.test(b), '호스트 핸들러가 구성원 조회를 하지 않는다');
    assert.ok(/ReplyOnUi\(/.test(b) && !/GitReply\(/.test(b),
      'async 핸들러가 GitReply 로 직접 회신한다 — CoreWebView2 는 스레드 친화적이라 ReplyOnUi(UI 마샬)여야 한다');
    assert.ok(/로그인이 필요합니다\./.test(b) && /서버에 연결하지 못했습니다/.test(b) && /사용자 정보가 등록되어 있지 않습니다/.test(b),
      '세션 없음 / 연결 실패 / 미등록을 구분해 안내하지 않는다 — 사유가 다르면 사용자의 대처도 다르다');
    assert.ok(!/ex\.Message/.test(b), '예외 원문을 사용자 회신에 실었다 — 내부 사정은 로그에만 남긴다');

    const q = csMember(csDb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)');
    // 순서 주의 — 쓰기 관문으로 바뀌면 두 단언이 함께 깨진다. 원인을 정확히 말하는 쪽을 앞에 둔다.
    assert.ok(!/OpenWriteAsync/.test(q),
      '구성원 조회가 쓰기 관문을 쓴다 — unit_tree 를 가진 viewer 전원이 명부를 확인조차 못 한다');
    assert.ok(/OpenReadAsync/.test(q), '구성원 조회가 읽기 연결을 쓰지 않는다');
    assert.ok(/AddWithValue\("@id", id\)/.test(q), 'login_id 를 파라미터로 바인딩하지 않는다(문자열 연결 금지)');
  },

  // ㉕ 명부는 '전원'이다(is_active=1) — 유닛 필터(IN 절)를 두지 않는다.
  //    ★ 계약이 뒤집힌 자리다. 예전엔 view_scope 로 명부 자체를 잘랐고(범위 밖은 payload 에 없음),
  //      그래서 self 인 71명(89명 중)이 조직 트리 없이 자기 이름 한 줄만 보는 화면을 받았다.
  //      이름·직급·소속은 사내망 인트라넷에 이미 공개된 정보다 — 통제 대상은 '일정'이지 명부가 아니다.
  //      필터가 되살아나면 그 화면이 그대로 돌아온다.
  membersRosterIsEveryone(csDb) {
    const q = csMember(csDb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)');
    assert.ok(/SELECT login_id, name, title, org_unit FROM app_user WHERE is_active=1 ORDER BY org_unit, name/.test(q),
      '명부 조회가 is_active=1 전원이 아니다 — 조건이 하나라도 붙으면 명부가 다시 잘린다');
    assert.ok(!/IN \(/.test(q),
      '명부 조회에 IN 절이 남아 있다 — 유닛 필터가 되살아나면 self 인 사람은 다시 자기 한 줄만 본다');
    assert.ok(!/ph\.Add|unitNames/.test(q), 'IN 절 자리표시자 코드가 남아 있다(죽은 개념)');
    assert.ok(!/allowed\.Count > 0/.test(q),
      '허용 집합 크기로 명부 쿼리를 건너뛴다 — 명부는 열람 범위와 무관하다');
    // IN 절이 사라져도 SQL 문자열 연결 금지는 그대로다(남은 파라미터는 @id 하나뿐).
    assert.ok(!/"'" \+/.test(q) && !/\+ "'"/.test(q),
      'SQL 에 작은따옴표로 값을 감싸 이어 붙인다 — 전형적인 주입 형태다');
    assert.ok(/AddWithValue\("@id", id\)/.test(q), 'login_id 를 파라미터로 바인딩하지 않는다');
  },

  // ㉖ view_scope 는 '일정 열람 범위'다 — 명부에서 사람을 빼는 데 쓰지 않는다.
  //    self 특례(본인 1행만 담던 분기)는 통째로 사라졌다. 본인도 전원 조회에 들어 있다.
  membersScopeIsScheduleOnly(csDb) {
    const q = csMember(csDb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)');
    assert.ok(!/isSelf/.test(q), 'self 특례 분기(isSelf)가 남아 있다 — self 도 전원 명부를 받아야 한다');
    assert.ok(!/\["loginId"\]\s*=\s*id\b/.test(q),
      '본인 행을 따로 만들어 담는다 — 본인도 전원 조회에 들어 있다(두 경로가 되면 한쪽이 낡는다)');
    const m = /switch \(scope\)\s*\{([\s\S]*?)\n\s*\}/.exec(q);
    assert.ok(m, '일정 열람 가능 유닛 집합을 정하는 switch (scope) 를 찾지 못함');
    const sw = m[1];
    assert.ok(/case "all":/.test(sw) && /case "unit_tree":/.test(sw), '전제: all·unit_tree 분기가 없다');
    assert.ok(!/"self"/.test(sw),
      'self 가 일정 열람 가능 유닛을 받는다 — self 는 빈 집합이어야 아무 일정도 열지 못한다');
    assert.ok(/default:\s*break;/.test(sw), 'default(self·알 수 없는 값)가 빈 집합으로 떨어지지 않는다');
  },

  // ㊷ 조직 트리 조회는 scope 와 무관하게 항상 돈다 — self 라고 건너뛰면 71명이 다시 트리 없는 화면을 본다.
  membersUnitsAlwaysQueried(csDb) {
    const q = csMember(csDb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)');
    assert.ok(/FROM org_unit WHERE is_active=1/.test(q), '전제: 조직 트리 조회가 없다');
    assert.ok(!/"self"/.test(q),
      'scope 를 "self" 와 비교하는 특례가 남아 있다 — self 도 전 조직 트리를 그대로 받아야 한다');
    assert.ok(!/if \(!isSelf\)|if \(isSelf\)/.test(q), 'self 여부로 조직 트리 조회를 가른다');
  },

  // ㊸ units payload 에 allowed 를 싣지 않는다 — 트리는 전부 활성이라 노드에 붙일 범위 개념이 없다.
  membersUnitsHaveNoAllowed(csDb) {
    const q = csMember(csDb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)');
    assert.ok(/\["sortOrder"\]\s*=\s*u\.SortOrder/.test(q), '전제: units payload 를 만들지 않는다');
    assert.ok(!/\["allowed"\]/.test(q),
      'units payload 에 allowed 가 실린다 — 화면이 그 값으로 노드를 다시 잠그게 된다');
  },

  // ㊹ 열람 범위는 구성원 행의 canViewSchedule 하나로만 표현된다 = 허용 유닛 집합에 그 사람 소속이 있는가.
  //    ★ 상수로 굳으면(true) 권한이 통째로 사라지고, 계산 근거가 바뀌면 남의 일정이 열린다.
  membersCanViewScheduleFlag(csDb) {
    const q = csMember(csDb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)');
    assert.ok(/string ou = Str\(rd, "org_unit"\)/.test(q), '판정 근거가 그 사람의 org_unit 이 아니다');
    assert.ok(/\["canViewSchedule"\]\s*=\s*allowed\.Contains\(ou\)/.test(q),
      '구성원 행에 canViewSchedule 이 없다(또는 일정 열람 가능 유닛 집합으로 계산하지 않는다)');
    assert.ok(/ExpandUnitTree\(units, myUnit, allowed\)/.test(q),
      'unit_tree 확장이 사라졌다 — 집합이 계산되지 않으면 canViewSchedule 도 의미가 없다');
  },

  // ㉗ unit_tree 확장은 반복(BFS) + 방문 집합 가드. 재귀 CTE 금지(폐쇄망 MySQL 버전 가정을 늘리지 않는다).
  membersTreeExpansion(csDb) {
    const ex = csMember(csDb, 'private static void ExpandUnitTree(List<OrgUnitRow> units, string myUnit, HashSet<string> allowed)');
    assert.ok(/Queue<string>/.test(ex), '부모→자식 반복 확장이 아니다(큐가 없다)');
    assert.ok(/if \(allowed\.Add\(/.test(ex),
      '방문 집합 가드가 없다 — org_unit.parent 에 순환(A→B→A)이 들어오면 무한 루프다');
    // 주석에 'WITH RECURSIVE 를 쓰지 않는다'는 설명이 들어 있으므로 반드시 주석 제거본을 본다.
    assert.ok(!/RECURSIVE/i.test(stripComments(csDb)),
      '재귀 CTE(WITH RECURSIVE)를 쓴다 — 12행짜리 트리 때문에 폐쇄망 MySQL 버전 가정을 늘리지 않기로 했다');
  },

  // ㉘ 조직명·이름은 전부 DB 문자열이다 — DOM API 로만 그린다(실패 문구도 마찬가지).
  membersTreeNoHtmlInjection(source) {
    for (const name of ['renderUnitTree', 'renderMembers', 'mbFail']) {
      const b = jsBody(source, name);
      assert.ok(/createElement/.test(b) && /textContent\s*=/.test(b), `${name} 이 DOM API 로 그리지 않는다(전제 붕괴)`);
      assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(b),
        `${name} 이 HTML 주입 API 를 쓴다 — 조직명·이름이 마크업으로 해석된다(XSS)`);
    }
  },

  // ㉙ 조직 트리는 '전부 활성'이다 — 누구나 조직도를 탐색할 수 있다.
  //    ★ 계약이 뒤집힌 자리다(예전: 범위 밖 노드는 disabled). 조직도는 사내망에 이미 공개돼 있고,
  //      통제 대상은 일정이라 노드에 잠글 것이 없다. 누를 수 없는 것은 '일정을 볼 수 없는 사람의 행'뿐이다.
  membersTreeAllEnabled(source) {
    const b = jsBody(source, 'renderUnitTree');
    assert.ok(!/\.disabled\s*=/.test(b),
      '트리 노드에 disabled 를 설정한다 — 조직도는 전부 탐색할 수 있어야 한다');
    assert.ok(!/열람 범위 밖입니다/.test(source),
      "옛 '열람 범위 밖입니다' 안내가 남아 있다 — 이제 트리에 범위 밖 노드가 없다");
    assert.ok(!/u\.allowed/.test(b), 'renderUnitTree 가 아직 u.allowed 를 읽는다 — 호스트는 그 키를 보내지 않는다');
    // 내 소속 표시는 유지 — 트리에서 나를 못 찾으면 탐색의 기준점이 사라진다.
    assert.ok(/classList\.add\('is-mine'\)/.test(b) && /· 내 소속/.test(b),
      '.is-mine(「· 내 소속」) 표시가 함께 사라졌다 — 그건 범위와 무관한 표시다');
    // 프로그램 호출로도 막지 않는다 — 막을 개념 자체가 없다.
    const s = jsBody(source, 'mbSelect');
    assert.ok(!/allowed/.test(s), 'mbSelect 가 아직 범위를 확인한다 — 이제 모든 조직을 고를 수 있다');
  },

  // ㊺ 죽은 개념(allowed)은 화면에서 흔적도 남기지 않는다.
  //    ★ 남겨 두면 더 나쁘다: 호스트가 보내지 않는 키라 전부 undefined 로 읽혀 '조용히 전부 잠긴' 화면이 된다.
  membersNoDeadAllowedConcept(source) {
    assert.ok(!/mbAllowedCount/.test(source),
      '죽은 함수 mbAllowedCount 가 남아 있다 — 트리에 범위 개념이 사라졌다');
    for (const fn of ['renderUnitTree', 'mbDefaultSel', 'mbSelect', 'mbEmptyText', 'mbApply']) {
      assert.ok(!/\.allowed\b/.test(jsBody(source, fn)),
        `${fn} 이 아직 u.allowed 를 읽는다 — 호스트가 보내지 않는 키라 전부 undefined 가 된다`);
    }
    // 기본 선택은 '루트 노드'다(옛 규칙: 부모가 허용 집합에 없는 첫 노드).
    const d = jsBody(source, 'mbDefaultSel');
    assert.ok(/!p \|\| !names\.has\(p\)/.test(d),
      '기본 선택이 루트 노드(부모가 없거나 목록에 없는 노드)로 정해지지 않는다');
  },

  // ㉚ 열 때마다 다시 읽는다 — 캐시해 두면 인사이동·권한변경이 낡은 채 남아 화면이 거짓말을 한다.
  membersRefetchOnOpen(source) {
    const b = jsBody(source, 'openMembers');
    assert.ok(/hostRequest\('membersGet'/.test(b), 'openMembers 가 membersGet 을 부르지 않는다');
    assert.ok(/__mbBusy/.test(b), '재진입 가드가 없다 — 연타로 겹치면 늦은 회신이 먼저 온 것을 덮는다');
    assert.ok(/__mbUnits = \[\]/.test(b) && /__mbMembers = \[\]/.test(b),
      'openMembers 가 직전 결과를 비우지 않는다 — 조회에 실패해도 낡은 명부가 화면에 남는다');
    assert.ok(!/__mbMembers\.length/.test(b) && !/__mbLoaded/.test(b),
      'openMembers 가 이미 받아 둔 명부를 보고 조회를 건너뛴다(캐시) — 인사이동이 반영되지 않는다');
    assert.ok(/데스크톱 위젯에서만 동작합니다/.test(b), '브라우저 단독(!HOST)에서 아무 설명도 하지 않는다');
  },

  // ㉛ 좌 트리 · 우 목록 2단. 세로로 쌓으면 트리를 지나야 목록에 닿아 '조직 고르기'가 매번 스크롤 작업이 된다.
  membersSplitTwoCols(source) {
    const r = cssRule(source, '.mb-split');
    assert.ok(/display:grid/.test(r), '.mb-split 이 grid 가 아니다 — 좌우 2단이 무너진다');
    const m = /grid-template-columns:([^;]+)/.exec(r);
    assert.ok(m, '.mb-split 에 grid-template-columns 가 없다 — 열 정의가 없으면 1열(=세로 쌓기)이다');
    const cols = m[1].trim().split(/\s+/);
    assert.strictEqual(cols.length, 2,
      `.mb-split 이 ${cols.length}열이다 — 트리 칸 + 목록 칸 2열이어야 위젯 실폭에서도 2단이 유지된다`);
    // 2단을 담을 폭의 전제 — .modal.wide 는 ≤440px 에서 100% 가 된다.
    const md = membersModalMarkup(source);
    assert.ok(/<div class="modal wide">/.test(md), '#membersModal 이 .modal.wide 가 아니다 — 2단을 담을 폭이 안 나온다');
  },

  // ㉑ 이름·소속은 (지금은 표본이지만 곧) DB 문자열이다 — 마크업으로 해석되는 순간 목록이 실행 표면이 된다.
  membersNoHtmlInjection(source) {
    const b = jsBody(source, 'renderMembers');
    assert.ok(/createElement/.test(b) && /textContent\s*=/.test(b),
      'renderMembers 가 DOM API 로 행을 만들지 않는다(전제 붕괴)');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(b),
      'renderMembers 가 HTML 주입 API 를 쓴다 — 이름·소속이 마크업으로 해석된다(XSS)');
  },

  // ㉒ 구성원 진입점은 권한 구획과 같은 조건(HOST && currentUser)으로 뜬다 — 볼 범위를 정하는 게 그 권한이다.
  membersSecToggle(source) {
    const b = jsBody(source, 'updateUserUi');
    assert.ok(/getElementById\('usPermSec'\)[^\n]*classList\.toggle\('hidden',\s*!on\)/.test(b),
      '전제: #usPermSec 가 !on 으로 토글되지 않는다');
    assert.ok(/getElementById\('usMembersSec'\)[^\n]*classList\.toggle\('hidden',\s*!on\)/.test(b),
      '#usMembersSec 가 #usPermSec 와 같은 조건(!on)으로 토글되지 않는다 — 미로그인에 구성원 진입점이 남는다');
    assert.ok(/<div class="set-sec set-sec-top hidden" id="usMembersSec">/.test(source),
      '#usMembersSec 의 초기 상태가 hidden 이 아니다 — 부팅 첫 프레임에 진입점이 번쩍인다');
  },

  // ㉓ 계약이 한 번 뒤집혔다. 예전엔 "모달에 「일정」이라는 낱말이 있으면 실패"였다 —
  //    이제 행 클릭 진입점 + 「준비 중」 예고가 생겼으니 그 낱말은 있어야 한다.
  //    막을 것은 문구가 아니라 '실제 열람 UI가 들어왔는가'다: 월 그리드(renderGrid)·일자 패널(dpBody)·
  //    편집 컨트롤(새 기록·저장)이 보이면 없는 데이터를 그리고 있다는 뜻이다
  //    — DB에 일정 테이블 자체가 없다(7개 테이블뿐, 일정은 각 PC 로컬 파일).
  //    ★ 어포던스도 같은 원리로 좁혔다: cursor:pointer·hover 는 '실제로 눌리는 행'(.is-link)에만.
  membersEntryOnlyNoRealUi(source) {
    const md = membersModalMarkup(source);
    const b = jsBody(source, 'renderMembers');
    for (const w of ['renderGrid', 'dpBody', '새 기록', '저장']) {
      assert.ok(!md.includes(w),
        `구성원 모달에 실제 일정 열람 UI 흔적(${w})이 들어왔다 — 자리는 열되 구현은 5단계다(일정 테이블이 아직 없다)`);
      assert.ok(!b.includes(w),
        `renderMembers 가 실제 일정 열람 UI(${w})를 그린다 — 행은 '진입점'까지다`);
    }
    // 진입점 자체는 있어야 한다 — 예고만 있고 누를 수 없으면 그것도 거짓말이다.
    assert.ok(/id="mbSoon"/.test(md), '#mbSoon 예고 줄이 사라졌다 — 누르기 전에 알릴 자리가 없다');
    assert.ok(/mb-row is-link/.test(b), 'renderMembers 가 누를 수 있는 행(.mb-row.is-link)을 만들지 않는다');
    const css = source.slice(source.indexOf('<style>'), source.indexOf('</style>'));
    assert.ok(!/cursor:pointer/.test(cssRule(source, '.mb-row')),
      '.mb-row 맨 클래스에 cursor:pointer 가 붙었다 — 못 누르는 행(=나 자신)까지 눌리는 것처럼 보인다');
    assert.ok(!/\.mb-row:hover/.test(css),
      '.mb-row:hover 강조가 생겼다 — hover 는 .mb-row.is-link 에만 준다');
    assert.ok(/cursor:pointer/.test(cssRule(source, '.mb-row.is-link')),
      '.mb-row.is-link 에 cursor:pointer 가 없다 — 실제로 눌리는 행이 눌리게 보이지 않는다');
    assert.ok(/\.mb-row\.is-link:hover\{/.test(css),
      '.mb-row.is-link:hover 강조가 없다 — 어느 행에 커서가 있는지 알 수 없다');
  },

  // ㉜ 누를 수 있는 행 = '내가 아니고' + '그 사람 일정을 볼 수 있고'. 판정이 둘 다를 봐야 한다.
  //    ★ 계약이 뒤집힌 자리다(예전: 나만 아니면 전부 눌림 — 명부에 범위 안 사람만 있었으니 그걸로 충분했다).
  //      이제 명부에는 전원이 있다: isMe 만 보면 권한 없는 남의 행이 눌려 눌러도 아무것도 열지 못하고,
  //      canViewSchedule 만 보면 내 행이 '이미 보고 있는 내 캘린더로 가는 링크'가 된다.
  membersRowLinkRule(source) {
    const b = jsBody(source, 'renderMembers');
    assert.ok(/currentUser[\s\S]{0,80}loginId/.test(b),
      'renderMembers 가 currentUser.loginId 를 보지 않는다 — 내 행을 가려낼 근거가 없다');
    // 판정이 상수로 굳으면(예: const isMe = false) 클래스 삼항은 멀쩡한데 전원이 눌리게 된다.
    const im = /const isMe = ([^;]+);/.exec(b);
    assert.ok(im && /loginId/.test(im[1]) && /\bme\b/.test(im[1]),
      `내 행 판정(isMe)이 loginId 대조가 아니다: ${im ? im[1] : '(없음)'} — 상수로 굳으면 내 행까지 눌린다`);
    const cv = /const canView = ([^;]+);/.exec(b);
    assert.ok(cv && /m\.canViewSchedule/.test(cv[1]),
      `일정 열람 판정(canView)이 m.canViewSchedule 이 아니다: ${cv ? cv[1] : '(없음)'} — 화면이 스스로 범위를 지어낸다`);
    assert.ok(/const plain = isMe \|\| !canView;/.test(b),
      '누를 수 없는 행 판정이 「나 이거나 일정을 볼 수 없거나」가 아니다 — 하나만 보면 한쪽이 반드시 틀린다');
    assert.ok(/plain \?\s*'mb-row'\s*:\s*'mb-row is-link'/.test(b),
      '누를 수 없는 행에 is-link 가 붙는다(조건이 뒤집혔거나 전원 같은 클래스다)');
    assert.ok(/if\(isMe\)\{[\s\S]{0,200}' · 나'/.test(b),
      "내 행에만 붙는 「· 나」 꼬리표가 없다 — 왜 이 행만 안 눌리는지 알 수 없다");
    assert.ok(/s\.className = 'git-opt';\s*s\.textContent = ' · 나'/.test(b),
      '「· 나」가 별도 span.git-opt 가 아니다 — 맨 텍스트로 섞으면 이름과 한 덩어리가 돼 색·굵기를 나눌 수 없다');
    // 권한 없는 남의 행에는 꼬리표를 달지 않는다 — 그냥 안 눌리는 줄이다(꼬리표 자리는 「· 나」 하나뿐).
    const tails = [...b.matchAll(/textContent = ' · ([^'+]+)';/g)].map((m) => m[1]);
    assert.deepStrictEqual(tails, ['나'], `행 꼬리표가 「· 나」 하나가 아니다: ${tails.join(',')}`);
  },

  // ㉝ 누를 수 있는 행은 진짜 <button type="button"> 이다. div+onclick 은 Tab 으로 닿지 않고
  //    Enter/Space 도 안 먹고 스크린리더에 '누를 수 있는 것'으로 나가지도 않는다.
  membersLinkRowIsButton(source) {
    const b = jsBody(source, 'renderMembers');
    assert.ok(/createElement\(plain \? 'div' : 'button'\)/.test(b),
      '누를 수 있는 행이 <button> 이 아니다 — div+onclick 은 키보드 접근·포커스를 통째로 잃는다');
    assert.ok(/row\.type = 'button'/.test(b),
      "row.type = 'button' 이 없다 — <button> 의 기본 type 은 submit 이다");
    assert.ok(/addEventListener\('click', mbRowClick\)/.test(b),
      '행 클릭이 addEventListener(mbRowClick) 로 붙지 않았다');
    assert.ok(!/onclick/.test(b), 'renderMembers 가 onclick 속성을 쓴다 — 배선은 addEventListener 하나로 통일한다');
    // 버튼이어도 목록 행처럼 보여야 한다 — 기본 껍데기를 안 벗기면 회색 버튼이 세로로 쌓인다.
    const r = cssRule(source, '.mb-row.is-link');
    for (const d of ['display:block', 'width:100%', 'text-align:left', 'background:none', 'border:0']) {
      assert.ok(r.includes(d), `.mb-row.is-link 에 ${d} 가 없다 — 버튼 기본 껍데기가 목록 모양을 깨뜨린다`);
    }
  },

  // ㉞ 셰브론(›)은 CSS ::after 다 — content 는 CSS 리터럴이라 DB 문자열이 섞일 여지가 없다.
  //    JS 가 그리기 시작하면 그 순간 '행에 마크업을 넣는 경로'가 생기고, 다음 사람은 거기에 이름을 붙인다.
  membersChevronCssOnly(source) {
    const css = source.slice(source.indexOf('<style>'), source.indexOf('</style>'));
    assert.ok(/\.mb-row\.is-link::after\{[^}]*content:'›'/.test(css),
      ".mb-row.is-link::after 의 셰브론(content:'›')이 없다 — 누를 수 있는 행이라는 표시가 사라진다");
    const b = jsBody(source, 'renderMembers');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(b),
      'renderMembers 가 HTML 주입 API 를 쓴다 — 셰브론은 CSS 로만 그린다(㉑과 같은 규칙)');
    assert.ok(!/›/.test(b), '셰브론을 JS 가 만든다 — CSS ::after 로만 그려야 DOM 주입 표면이 늘지 않는다');
    // 이름·소속과 겹치거나 줄바꿈을 유발하면 안 된다(400px 실측) — 자리를 padding 으로 비워 둔다.
    const r = cssRule(source, '.mb-row.is-link');
    assert.ok(/position:relative/.test(r) && /padding-right:\d+px/.test(r),
      '.mb-row.is-link 에 셰브론 자리(position:relative + padding-right)가 없다 — 이름과 겹치거나 되접힌다');
    assert.ok(!/float:right/.test(cssRule(source, '.mb-row.is-link::after')),
      '셰브론을 float 로 띄운다 — 두 번째 줄(소속)이 밀려 위젯 실폭에서 레이아웃이 흔들린다');
  },

  // ㉟ 클릭이 하는 일은 알림 하나가 전부다. 모달을 닫거나·화면을 옮기거나·그 사람을 더 조회하면
  //    '진입점만 만들었다'는 계약이 깨진다(그리고 열어 보여 줄 데이터가 애초에 없다).
  membersClickToastOnly(source) {
    const h = jsBody(source, 'mbRowClick');
    assert.ok(/toast\('일정 열람은 준비 중입니다', 'info'\)/.test(h),
      '행 클릭이 「준비 중」 안내를 띄우지 않는다 — 눌러도 아무 반응이 없으면 고장으로 읽힌다');
    for (const dead of ['closeOverlay', 'closeModal', 'openModal', 'hostRequest', 'renderGrid', 'location']) {
      assert.ok(!h.includes(dead), `행 클릭이 ${dead} 를 쓴다 — 지금은 알림 하나가 전부다`);
    }
    // 렌더 쪽에도 같은 금지 — 핸들러를 인라인으로 되돌리며 슬쩍 끼워 넣는 경로를 함께 막는다.
    const b = jsBody(source, 'renderMembers');
    for (const dead of ['closeOverlay', 'closeModal', 'hostRequest']) {
      assert.ok(!b.includes(dead), `renderMembers 가 ${dead} 를 부른다 — 행을 그리는 일에 그런 부작용은 없다`);
    }
  },

  // ㊱ 예고는 '누르기 전에' 보여야 한다(검색칸 아래 · 목록 위). 누른 뒤에만 알리면 낚인 느낌이 든다.
  //    ★ 계약이 뒤집힌 자리다(예전: 누를 행이 0개면 이 줄을 감췄다). 명부에 전원이 들어오면서
  //      '한 명도 못 누르는 화면'이 흔해졌다 — 감추면 왜 안 눌리는지 알 수 없고, 그대로 두면
  //      「누르면 볼 수 있습니다」가 거짓말이 된다. 그래서 문구를 갈아끼운다.
  membersSoonHint(source) {
    const md = membersModalMarkup(source);
    assert.ok(/<div class="set-hint" id="mbSoon">/.test(md), '#mbSoon 예고 줄이 없다');
    assert.ok(/준비 중/.test(md), '#mbSoon 이 「준비 중」이라고 말하지 않는다 — 곧 되는 줄 알고 기다리게 된다');
    const iSearch = md.indexOf('id="mbSearch"'), iSoon = md.indexOf('id="mbSoon"'), iList = md.indexOf('id="mbList"');
    assert.ok(iSearch >= 0 && iSoon > iSearch && iList > iSoon,
      '#mbSoon 이 검색칸 아래 · 목록 위가 아니다 — 누르기 전에 눈에 들어오는 자리여야 한다');
    const b = jsBody(source, 'renderMembers');
    assert.ok(/links\+\+/.test(b) && /links > 0/.test(b),
      "누를 수 있는 행 수(links)로 판단하지 않는다 — 전체 행 수로 세면 아무도 못 누를 때도 예고가 뜬다");
    assert.ok(/명부만 볼 수 있습니다 — 일정 열람 권한이 없습니다/.test(b),
      '누를 행이 0개일 때의 문구가 없다 — 「누르면 볼 수 있습니다」를 그대로 두면 거짓말이다');
    assert.ok(!/toggle\('hidden',\s*links === 0\)/.test(b),
      '누를 행이 0개라고 예고 줄을 감춘다 — 감추지 말고 왜 안 눌리는지 말해야 한다');
    assert.ok(/getElementById\('mbSoon'\)[\s\S]{0,140}classList\.toggle\('hidden',\s*arr\.length === 0\)/.test(b),
      '목록이 아예 비었을 때(0행) 예고 줄을 감추지 않는다 — 안내할 대상이 없는데 말만 남는다');
    // 문구도 DOM API 로만 만든다(㉑과 같은 규칙 — 이 줄에는 <b> 가 들어간다).
    assert.ok(!/innerHTML/.test(b), '#mbSoon 문구를 innerHTML 로 갈아끼운다');
  },

  // ㊲ 신원(이름·직급·소속)은 '실시간 응답'으로 칠한다. 예전엔 같은 회신에 들어 있는 name/title/org_unit 을
  //    버리고 세션 값만 그렸다 — 그래서 한 모달 안에서 위 두 줄은 로그인 시점, 바로 아래 「열람 범위」만
  //    최신인 상태가 됐다(실측: DB 소속을 바꿔도 화면은 옛 팀, 범위줄은 즉시 갱신).
  //    ★ 그러나 currentUser·세션 파일에는 쓰지 않는다 — USER-LOGIN §2.5. 이 검사의 핵심이다.
  //    ★ 단언 순서는 '가장 위험한 것 먼저'다. 한 변이가 여러 단언을 동시에 깨뜨릴 때
  //      먼저 걸리는 쪽이 실패 메시지가 되므로, §2.5 위반이 다른 사소한 어긋남에 가려지면 안 된다.
  identityLiveFromInfo(source) {
    const { ok, fail, all } = permBranches(source);
    // ① §2.5 재발 방지 — 조회 결과로 세션을 갱신하는 순간 '로그아웃과 경합해 삭제된 세션이 되살아난' 그 버그가 돌아온다.
    assert.ok(!/currentUser(\s*\.\s*\w+)*\s*=(?!=)/.test(all),
      'loadUserPerm 이 currentUser 에 대입한다 — 조회 결과로 세션을 갱신하면 로그아웃과 경합한다(USER-LOGIN §2.5)');
    assert.ok(!/Object\.assign\(\s*currentUser/.test(all),
      'loadUserPerm 이 Object.assign 으로 currentUser 를 갱신한다 — 대입과 같은 문제다(§2.5)');
    assert.ok(!/applyUser\s*\(/.test(all),
      'loadUserPerm 이 applyUser 를 부른다 — 그 함수가 currentUser 를 갈아끼운다(§2.5)');
    const reqs = [...all.matchAll(/hostRequest\('([^']+)'/g)].map((m) => m[1]);
    assert.deepStrictEqual(reqs, ['userInfoGet'],
      `loadUserPerm 이 보내는 호스트 요청이 userInfoGet 하나가 아니다(${reqs.join(',')}) — 세션을 다시 쓰게 하는 경로가 붙었다`);
    // ② 신원 렌더도 textContent 로만(DB 문자열이다).
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(all),
      'loadUserPerm 이 HTML 주입 API 를 쓴다 — 이름·소속이 마크업으로 해석된다(XSS)');
    // ③ 호스트가 보내는 키는 DB 컬럼 그대로(org_unit)다. camelCase 로 읽으면 조용히 undefined 가 된다.
    assert.ok(!/inf\.orgUnit/.test(ok),
      '응답을 inf.orgUnit(camelCase)으로 읽는다 — 호스트는 org_unit 으로 보낸다(ProjectDb.LoadUserInfoJsonAsync)');
    // ④ 성공 경로 — 세 줄 전부 info 에서. currentUser 에서 칠하면 조회를 해 놓고도 낡은 값을 그린다.
    assert.ok(/set\('usName',\s*inf\.name/.test(ok),
      '성공 경로가 #usName 을 응답(inf.name)으로 칠하지 않는다 — 이름이 로그인 시점 값에 굳는다');
    assert.ok(/set\('usTitle',\s*inf\.title/.test(ok),
      '성공 경로가 #usTitle 을 응답(inf.title)으로 칠하지 않는다 — 직급 변경이 반영되지 않는다');
    assert.ok(/set\('usOrg',\s*usOrgText\(inf\.org_unit\)/.test(ok),
      '성공 경로가 #usOrg 를 응답(inf.org_unit)으로 칠하지 않는다 — 소속만 낡은 채 「열람 범위」와 어긋난다');
    // ⑤ 실패 경로 — 신원 3줄을 건드리지 않는다. 세션 값이 그대로 남아야 오프라인에서도 이름이 보인다.
    for (const id of ['usName', 'usTitle', 'usOrg']) {
      assert.ok(!new RegExp("set\\('" + id + "'").test(fail),
        `조회 실패가 #${id} 값을 덮어쓴다 — 「권한」이 이미 사유를 말하고 있는데 신원까지 지우면 소음이다`);
    }
    // ⑥ 값 우선순위는 실시간 > 세션이다. 세션은 '이름이 비었을 때의 폴백'으로만 남는다.
    assert.ok(/currentUser\.loginId/.test(ok),
      '이름이 비었을 때의 폴백(loginId)이 없다 — 빈 이름이 그대로 —  로 떨어진다');
  },

  // ㊳ 빈 소속은 빈 줄이 아니라 문장이다. org_unit=NULL 이면 그 자리가 통째로 사라져
  //    '아직 안 불러온 것'처럼 보이고, 바로 아래가 왜 「볼 수 있는 조직 없음」인지 설명하지 못한다.
  //    ★ 세션 경로와 실시간 경로가 같은 헬퍼를 써야 한다 — 문구가 두 벌이면 조회 전후로 화면이 깜빡인다.
  identityOrgFallback(source) {
    const h = jsBody(source, 'usOrgText');
    assert.ok(/소속 미등록/.test(h), 'usOrgText 가 빈 소속을 문장으로 바꾸지 않는다');
    assert.ok(/trim\(\)/.test(h), 'usOrgText 가 공백만 든 값을 걸러내지 않는다 — 공백 한 칸도 빈 줄로 보인다');
    const u = jsBody(source, 'updateUserUi');
    assert.ok(/set\('usOrg',\s*usOrgText\(/.test(u),
      '세션 경로(updateUserUi)가 usOrgText 를 거치지 않는다 — 모달을 연 직후와 조회 후 문구가 달라진다');
    const { ok } = permBranches(source);
    assert.ok(/set\('usOrg',\s*usOrgText\(/.test(ok),
      '실시간 경로(loadUserPerm)가 usOrgText 를 거치지 않는다 — 두 경로가 다른 문구를 쓴다');
    // 문구 리터럴은 헬퍼 안에 딱 한 번. 두 벌이 되면 한쪽만 고쳐지고 깜빡임이 되돌아온다.
    // (설명 주석에서의 언급은 세지 않는다 — 따옴표로 감싼 리터럴만 본다.)
    const hits = [...source.matchAll(/'소속 미등록'/g)].length;
    assert.strictEqual(hits, 1,
      `'소속 미등록' 리터럴이 소스에 ${hits}곳 있다 — 헬퍼 하나에서만 나와야 두 경로가 같은 말을 한다`);
  },

  // ㊴ 트리 숨김은 '그릴 노드가 있는가'(units.length)로만 판정한다.
  //    ★ 계약이 뒤집힌 자리다(예전: 누를 수 있는 allowed 노드 수). 이제 트리에 범위가 없으므로
  //      정상 응답이면 항상 보여야 한다 — 접히는 경우는 조회 실패 등 '그릴 게 없을 때'뿐이다.
  membersTreeHiddenByUnitCount(source) {
    const b = jsBody(source, 'renderUnitTree');
    assert.ok(!/'self'|"self"/.test(b),
      "트리 숨김을 scope==='self' 문자열 비교로 판정한다 — self 도 전 조직 트리를 봐야 한다");
    assert.ok(!/mbAllowedCount/.test(b),
      'allowed 개수로 판정하던 옛 규칙이 남아 있다 — self 는 그 수가 0이라 트리가 다시 접힌다');
    assert.ok(/const usable = arr\.length;/.test(b),
      '트리 숨김이 units 개수(arr.length)로 판정되지 않는다 — 그릴 노드가 있으면 항상 보여야 한다');
    assert.ok(/classList\.toggle\('hidden',\s*usable === 0\)/.test(b),
      '숨김 토글이 usable(=units 개수)을 보지 않는다');
    assert.ok(/gridTemplateColumns = usable \?/.test(b),
      '1열 전환이 units 개수를 보지 않는다 — 트리는 접혔는데 빈 첫 칸이 남아 목록이 좁아진다');
  },

  // ㊵ 0건 안내는 2분기다.
  //    ★ 계약이 뒤집힌 자리다(예전: 3분기 — 검색 중 / 빈 조직 / 볼 수 있는 조직 0).
  //      세 번째는 이제 발생하지 않는다: 명부·트리가 범위와 무관해 '볼 수 있는 조직 0'인 상태가 없다.
  membersEmptyTwoCases(source) {
    const b = jsBody(source, 'mbEmptyText');
    assert.ok(/mbSearch/.test(b), 'mbEmptyText 가 검색어를 보지 않는다 — 두 경우를 구분할 근거가 없다');
    assert.ok(/'검색 결과가 없습니다\.'/.test(b) && /k \?/.test(b),
      "「검색 결과가 없습니다」가 검색어 뒤로 가려지지 않는다 — 검색하지 않았는데 검색 얘기를 한다");
    assert.ok(/이 조직에 등록된 구성원이 없습니다\./.test(b),
      '조직은 골랐는데 0명인 경우의 문구가 없다');
    assert.ok(!/소속이 등록되지 않아/.test(source),
      "옛 3번째 분기(「볼 수 있는 조직이 없습니다」)가 남아 있다 — 이제 그런 상태가 없다");
    // 두 문구가 실제로 갈리는가(하나로 합치면 분기가 사라진다).
    const msgs = new Set([...b.matchAll(/'([^']*습니다[^']*)'/g)].map((m) => m[1]));
    assert.strictEqual(msgs.size, 2, `mbEmptyText 의 안내 문구가 ${msgs.size}종이다 — 2분기여야 한다`);
    // 렌더가 실제로 이 문구를 쓴다(계산만 해 놓고 마크업의 고정 문구가 남으면 아무것도 안 바뀐다).
    const r = jsBody(source, 'renderMembers');
    assert.ok(/empty\.textContent = mbEmptyText\(\)/.test(r),
      'renderMembers 가 #mbEmpty 문구를 mbEmptyText 로 갈아끼우지 않는다 — 마크업의 고정 문구가 그대로 뜬다');
    assert.ok(/classList\.toggle\('hidden',\s*arr\.length > 0\)/.test(r),
      '#mbEmpty 숨김 토글이 사라졌다 — 결과가 있는데 안내가 남거나 그 반대가 된다');
  },

  // ㊶ 범위 줄은 「일정 열람 범위:」로 시작한다 — 그냥 '열람 범위'라고 하면 눈앞의 명부가
  //    잘려 있다는 오해를 준다(명부는 전원이다). 실패 경로도 같은 앞머리를 쓴다.
  membersScopeLineSchedulePrefix(source) {
    const b = jsBody(source, 'mbApply');
    assert.ok(/'일정 열람 범위: '/.test(b),
      "범위 줄이 「일정 열람 범위:」로 시작하지 않는다 — 명부 범위로 읽힌다");
    assert.ok(!/볼 수 있는 조직 없음/.test(source),
      '옛 「볼 수 있는 조직 없음」 분기가 남아 있다 — 이제 그런 상태가 없다');
    assert.ok(/where \+ rows\.length \+ '명'/.test(b), '정상 경로의 「<조직명> N명」 표기가 사라졌다');
    assert.ok(/'일정 열람 범위: 확인할 수 없음'/.test(jsBody(source, 'mbFail')),
      '조회 실패 줄만 옛 앞머리를 쓴다 — 같은 줄이 상황에 따라 다른 이름으로 불린다');
  },
};

// ══ 검사 실행 ═════════════════════════════════════════════════════════

test('사용자정보 ①: #btnUser 가 상단바에 있고 라벨이 없다(폭 예산)', () => checks.topbarButton(src));
test('사용자정보 ②: ≤440px 에서 보조 버튼과 함께 접힌다', () => checks.narrowHidden(src));
test('사용자정보 ③: 보고서 라벨 접기 경계가 739px 이다(690px 실측 상쇄)', () => checks.reportLabelBreakpoint(src));
test('사용자정보 ④: ⋯ 접기 btnUserFold → #btnUser 위임', () => checks.foldEntry(src));
test('사용자정보 ⑤: #userModal 은 닫을 수 있는 .overlay 다(게이트와 정반대)', () => checks.closableOverlay(src));
test('사용자정보 ⑥: 옛 #accountSection·acct* 8종이 0건이다(복제 아닌 이동)', () => checks.oldAccountGone(src));
test('사용자정보 ⑦: openSettings 에 계정 갱신 호출이 남아 있지 않다', () => checks.settingsClean(src));
test('사용자정보 ⑧: 값은 textContent 로만 넣는다(HTML 주입 API 부재)', () => checks.textContentOnly(src));
test('사용자정보 ⑨: 호스트 userInfoGet 은 읽기 경로다(OpenWriteAsync 금지)', () => checks.hostReadPath(main, pdb));
test('사용자정보 ⑩: 권한 코드값 3+3 을 문장으로 매핑한다(원시값 노출 금지)', () => checks.permMapping(src));
test('사용자정보 ⑪: 권한은 표시 전용 — 화면이 이 값으로 막지 않는다', () => checks.displayOnly(src));
test('사용자정보 ⑫: 모달은 조회를 기다리지 않고 먼저 열린다', () => checks.opensBeforeFetch(src));
test('사용자정보 ⑬: 로그아웃이 닫는 대상은 #userModal 이다', () => checks.logoutClosesUserModal(src));
test('사용자정보 ⑭: 5단계 「타인 일정 열람」 UI 를 미리 만들지 않았다', () => checks.noFuturePromise(src));
test('사용자정보 ⑮: 권한은 .us-kv 2열 그리드다(라벨:값 한 줄 · 4줄 → 2줄)', () => checks.permTwoRows(src));
test('사용자정보 ⑯: .us-kv 자식은 전부 dt/dd 요소다(맨 텍스트 0)', () => checks.permKvElementsOnly(src));
test('사용자정보 ⑰: 권한 문구 6종이 단축형이다(옛 긴 문구 0건)', () => checks.permShortLabels(src));
test('사용자정보 ⑱: #usPermSec 에 .set-form 카드가 없다(#usPermForm 폐지)', () => checks.permNoCard(src));
test('구성원 ⑲: #membersModal 은 닫을 수 있는 .overlay 이고 진입점이 배선돼 있다', () => checks.membersModalClosable(src));
test('구성원 ⑳: 미리보기 표본(US_MEMBERS_PREVIEW·#mbPreview)이 0건이다', () => checks.noPreviewSample(src));
test('구성원 ㉑: renderMembers 는 DOM API 로만 그린다(HTML 주입 API 부재)', () => checks.membersNoHtmlInjection(src));
test('구성원 ㉒: #usMembersSec 는 #usPermSec 와 같은 조건으로 토글된다', () => checks.membersSecToggle(src));
test('구성원 ㉓: 행 진입점만 있고 실제 열람 UI(그리드·일자패널·편집)는 없다', () => checks.membersEntryOnlyNoRealUi(src));
test('구성원 ㉔: 호스트 membersGet 은 읽기 경로다(OpenWriteAsync 금지)', () => checks.membersHostReadPath(main, pdb));
test('구성원 ㉕: 명부는 IN 절 없이 전원(is_active=1)이다', () => checks.membersRosterIsEveryone(pdb));
test('구성원 ㉖: view_scope 는 일정 열람 범위다(명부에서 사람을 빼지 않는다)', () => checks.membersScopeIsScheduleOnly(pdb));
test('구성원 ㉗: unit_tree 확장은 반복 + 방문 집합 가드다(재귀 CTE 금지)', () => checks.membersTreeExpansion(pdb));
test('구성원 ㉘: renderUnitTree·renderMembers·mbFail 이 DOM API 로만 그린다', () => checks.membersTreeNoHtmlInjection(src));
test('구성원 ㉙: 조직 트리는 전부 활성이다(disabled 노드 0)', () => checks.membersTreeAllEnabled(src));
test('구성원 ㉚: openMembers 는 열 때마다 membersGet 을 다시 부른다(캐시 금지)', () => checks.membersRefetchOnOpen(src));
test('구성원 ㉛: .mb-split 은 2열 그리드다(좌 트리 · 우 목록)', () => checks.membersSplitTwoCols(src));
test('구성원 ㉜: is-link 는 「내가 아님 && 일정 열람 가능」 둘 다 본다', () => checks.membersRowLinkRule(src));
test('구성원 ㉝: 누를 수 있는 행은 <button type="button"> 이다(div+onclick 금지)', () => checks.membersLinkRowIsButton(src));
test('구성원 ㉞: 셰브론은 CSS ::after 다(JS 는 마크업을 만들지 않는다)', () => checks.membersChevronCssOnly(src));
test('구성원 ㉟: 행 클릭은 toast 하나뿐 — 모달 유지 · 추가 조회 없음', () => checks.membersClickToastOnly(src));
test('구성원 ㊱: #mbSoon 예고는 목록 위에 있고 누를 행이 0개면 감춘다', () => checks.membersSoonHint(src));
test('사용자정보 ㊲: 신원 3줄은 응답(info)으로 칠하되 currentUser·세션은 건드리지 않는다(§2.5)', () => checks.identityLiveFromInfo(src));
test('사용자정보 ㊳: 빈 소속은 두 경로가 같은 헬퍼(usOrgText)로 같은 문구를 쓴다', () => checks.identityOrgFallback(src));
test('구성원 ㊴: 트리 숨김은 units 개수로만 판정한다(범위로 접지 않는다)', () => checks.membersTreeHiddenByUnitCount(src));
test('구성원 ㊵: 0건 안내는 2분기다(검색 중 / 빈 조직)', () => checks.membersEmptyTwoCases(src));
test('구성원 ㊶: 범위 줄은 「일정 열람 범위:」로 시작한다', () => checks.membersScopeLineSchedulePrefix(src));
test('구성원 ㊷: scope 와 무관하게 조직 트리를 조회한다(self 도 건너뛰지 않는다)', () => checks.membersUnitsAlwaysQueried(pdb));
test('구성원 ㊸: units payload 에 allowed 키가 없다', () => checks.membersUnitsHaveNoAllowed(pdb));
test('구성원 ㊹: 구성원마다 canViewSchedule 이 허용 유닛 집합으로 계산된다', () => checks.membersCanViewScheduleFlag(pdb));
test('구성원 ㊺: 화면에 죽은 개념(mbAllowedCount·u.allowed)이 남아 있지 않다', () => checks.membersNoDeadAllowedConcept(src));

// 세션 파일은 4필드 그대로다 — 권한을 세션에 캐시하는 순간 관리자가 역할을 바꿔도 화면이 낡은 값을 말한다.
test('사용자정보: 세션(UserSession)에 권한 필드를 추가하지 않았다', () => {
  const us = stripComments(readFileSync(new URL('../widget/UserSession.cs', import.meta.url), 'utf8'));
  for (const dead of ['EditRole', 'ViewScope', 'edit_role', 'view_scope']) {
    assert.ok(!us.includes(dead), `세션 파일에 권한(${dead})이 들어갔다 — 4필드 유지가 확정 설계다`);
  }
  const payload = csMember(main, 'private static object UserPayload(UserSession s)');
  assert.ok(!/editRole|viewScope/.test(payload), '세션 payload 에 권한이 실렸다 — 권한은 userInfoGet 으로만 내려간다');
});

// ══ 변이 주입(검사가 실효성이 있는지 증명) ════════════════════════════
// 각 변이는 "실제로 날 수 있는 회귀"다. 검사가 안 잡으면 그 검사는 장식이다.
// ★ 앵커가 소스에서 안 찾히면 여기서 실패한다 — 조용히 통과하지 않는다.

function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

// 같은 한 줄이 파일 곳곳에 있는 경우(ProjectDb 의 OpenReadAsync 호출 등) 전역 replace 는 엉뚱한 곳을 건드린다.
// 시그니처 이후 첫 등장만 바꿔 '그 메서드 안에서의 회귀'를 정확히 재현한다.
function mutateInMember(source, sig, from, to) {
  const s = source.indexOf(sig);
  assert.ok(s >= 0, `변이 대상 멤버를 찾지 못함: ${sig}`);
  return source.slice(0, s) + mutate(source.slice(s), from, to);
}

test('변이①: #btnUser 에 has-label 을 붙이면 topbarButton 이 실패한다', () => {
  const bad = mutate(src, '<button class="btn icon" id="btnUser"', '<button class="btn icon has-label" id="btnUser"');
  assert.throws(() => checks.topbarButton(bad), /has-label 이 붙었다/);
});

test('변이②: ≤440px 숨김 목록에서 #btnUser 를 빼면 narrowHidden 이 실패한다', () => {
  const bad = mutate(src, '#btnSearch,#btnCatsTop,#btnFeedback,#btnUser{display:none}', '#btnSearch,#btnCatsTop,#btnFeedback{display:none}');
  assert.throws(() => checks.narrowHidden(bad), /#btnUser 가 없다/);
});

test('변이③: 보고서 라벨 경계를 739 → 679 로 되돌리면 reportLabelBreakpoint 가 실패한다', () => {
  const bad = mutate(src, '@media (max-width:739px){', '@media (max-width:679px){');
  assert.throws(() => checks.reportLabelBreakpoint(bad), /739px 이 아니다/);
});

test('변이④: ⋯ 위임 맵에서 btnUserFold 를 빼면 foldEntry 가 실패한다', () => {
  const bad = mutate(src, "btnUserFold:'#btnUser', ", '');
  assert.throws(() => checks.foldEntry(bad), /위임 맵에 btnUserFold/);
});

test('변이⑤: #userModal 을 닫을 수 없는 게이트로 바꾸면 closableOverlay 가 실패한다', () => {
  const bad = mutate(src, '<div class="overlay hidden" id="userModal">', '<div class="lg-gate hidden" id="userModal">');
  assert.throws(() => checks.closableOverlay(bad), /#userModal 마크업을 찾지 못함/);
});

test('변이⑤-b: 닫기 버튼에서 data-close 를 떼면 closableOverlay 가 실패한다', () => {
  const bad = mutate(src, '<div class="modal-head"><h2>사용자 정보</h2><button class="x" data-close aria-label="닫기">×</button></div>',
                          '<div class="modal-head"><h2>사용자 정보</h2></div>');
  assert.throws(() => checks.closableOverlay(bad), /data-close 닫기 경로|헤더 × 닫기 버튼/);
});

test('변이⑥: 옛 계정 id 를 하나라도 되살리면 oldAccountGone 이 실패한다', () => {
  const bad = mutate(src, 'id="usLogout"', 'id="acctLogout"');
  assert.throws(() => checks.oldAccountGone(bad), /acctLogout 가 남아 있다/);
});

test('변이⑦: openSettings 에 updateAccountUi 호출을 되살리면 settingsClean 이 실패한다', () => {
  const bad = mutate(src, "  setSaveBadge('updBadge', '', '저장 필요');", "  updateAccountUi();\n  setSaveBadge('updBadge', '', '저장 필요');");
  assert.throws(() => checks.settingsClean(bad), /updateAccountUi 를 부른다/);
});

test('변이⑧: updateUserUi 가 innerHTML 로 쓰면 textContentOnly 가 실패한다', () => {
  const bad = mutate(src, "    set('usOrg', usOrgText(currentUser.orgUnit));",
                          "    document.getElementById('usOrg').innerHTML = usOrgText(currentUser.orgUnit);");
  assert.throws(() => checks.textContentOnly(bad), /HTML 주입 API/);
});

test('변이⑨: 권한 조회가 쓰기 관문(OpenWriteAsync)을 쓰면 hostReadPath 가 실패한다', () => {
  const bad = mutateInMember(pdb, 'public async Task<string?> LoadUserInfoJsonAsync(string loginId)',
    'await using var conn = await OpenReadAsync(cts.Token);', 'await using var conn = await OpenWriteAsync(cts.Token);');
  assert.throws(() => checks.hostReadPath(main, bad), /쓰기 관문을 쓴다/);
});

test('변이⑨-b: 호스트 case 를 지우면 hostReadPath 가 실패한다', () => {
  const bad = mutate(main, 'case "userInfoGet":', 'case "userInfoGetX":');
  assert.throws(() => checks.hostReadPath(bad, pdb), /case "userInfoGet" 을 찾지 못함/);
});

test('변이⑩: 권한 매핑에서 viewer 를 빼면 permMapping 이 실패한다', () => {
  const bad = mutate(src, ", viewer:'열람자 — 조회만' }", ' }');
  assert.throws(() => checks.permMapping(bad), /viewer → 열람자 가 없다/);
});

test('변이⑩-b: usRoleText 가 원시 코드값을 그대로 돌려주면 permMapping 이 실패한다', () => {
  const bad = mutate(src, "function usRoleText(map, v){ const k = String(v == null ? '' : v).trim(); return map[k] || (k ? k + ' — 알 수 없는 값' : '—'); }",
                          "function usRoleText(map, v){ return String(v == null ? '' : v).trim(); }");
  assert.throws(() => checks.permMapping(bad), /매핑표를 보지 않는다/);
});

test('변이⑪: 조회 실패에서 값을 남겨 두면 permMapping 이 실패한다', () => {
  const bad = mutate(src, "  set('usEditRole', '확인할 수 없음');\n  set('usViewScope', '확인할 수 없음');", '');
  assert.throws(() => checks.permMapping(bad), /조회 실패에 값을 남겨 둔다/);
});

test('변이⑫: openUserInfo 가 조회를 await 하면 opensBeforeFetch 가 실패한다', () => {
  const bad = mutate(src, 'function openUserInfo(){\n  updateUserUi();\n  openModal(\'#userModal\');\n  if(HOST && currentUser) loadUserPerm();',
                          'async function openUserInfo(){\n  updateUserUi();\n  if(HOST && currentUser) await loadUserPerm();\n  openModal(\'#userModal\');');
  assert.throws(() => checks.opensBeforeFetch(bad), /모달 오픈보다 앞이다|await 한다/);
});

test('변이⑬: 로그아웃이 설정 모달을 닫으면 logoutClosesUserModal 이 실패한다', () => {
  const bad = mutate(src, "closeOverlay(document.getElementById('userModal'))", "closeOverlay(document.getElementById('settingsModal'))");
  assert.throws(() => checks.logoutClosesUserModal(bad), /사용자 정보 모달을 닫지 않는다/);
});

test('변이⑮: .us-kv 를 1열로 되돌리면 permTwoRows 가 실패한다', () => {
  const bad = mutate(src, '.us-kv{display:grid;grid-template-columns:auto 1fr;', '.us-kv{display:grid;grid-template-columns:1fr;');
  assert.throws(() => checks.permTwoRows(bad), /1열이다/);
});

test('변이⑯: dl 안에 맨 텍스트를 섞으면 permKvElementsOnly 가 실패한다', () => {
  const bad = mutate(src, '          <dt>열람 범위</dt><dd id="usViewScope">—</dd>\n',
                          '          <dt>열람 범위</dt><dd id="usViewScope">—</dd>\n          (표시 전용)\n');
  assert.throws(() => checks.permKvElementsOnly(bad), /dt\/dd 아닌 내용이 있다/);
});

test('변이⑰: 권한 문구를 옛 긴 문장으로 되돌리면 permShortLabels 가 실패한다', () => {
  const bad = mutate(src, "viewer:'열람자 — 조회만' }", "viewer:'열람자 — 조회만 가능' }");
  assert.throws(() => checks.permShortLabels(bad), /단축형이 아니다|옛 긴 문구가 남아 있다/);
});

test('변이⑱: #usPermSec 에 .set-form 카드를 되살리면 permNoCard 가 실패한다', () => {
  const bad = mutate(src, '        <dl class="us-kv">', '        <div class="set-form" id="usPermFormBox">\n        <dl class="us-kv">');
  assert.throws(() => checks.permNoCard(bad), /\.set-form 박스가 되살아났다/);
});

test('변이⑲: #membersModal 의 × 닫기를 떼면 membersModalClosable 이 실패한다', () => {
  const bad = mutate(src, '<div class="modal-head"><h2>구성원</h2><button class="x" data-close aria-label="닫기">×</button></div>',
                          '<div class="modal-head"><h2>구성원</h2></div>');
  assert.throws(() => checks.membersModalClosable(bad), /data-close 닫기 경로|헤더 × 닫기 버튼/);
});

test('변이⑳: 가짜 표본을 되살리면 noPreviewSample 이 실패한다', () => {
  const bad = mutate(src, 'let __mbUnits = [];', "const US_MEMBERS_PREVIEW = [{name:'김서연'}];\nlet __mbUnits = [];");
  assert.throws(() => checks.noPreviewSample(bad), /US_MEMBERS_PREVIEW 가 남아 있다/);
});

test('변이㉑: renderMembers 가 이름을 innerHTML 로 넣으면 membersNoHtmlInjection 이 실패한다', () => {
  const bad = mutate(src, "nm.textContent = (m && m.name) ? String(m.name) : '—';",
                          "nm.innerHTML = (m && m.name) ? String(m.name) : '—';");
  assert.throws(() => checks.membersNoHtmlInjection(bad), /HTML 주입 API/);
});

test('변이㉒: updateUserUi 에서 #usMembersSec 토글을 빼면 membersSecToggle 이 실패한다', () => {
  const bad = mutate(src, "  const mem = document.getElementById('usMembersSec');if(mem) mem.classList.toggle('hidden', !on);   // 구성원도 같은 조건 — 볼 범위를 정하는 게 그 권한이다\n", '');
  assert.throws(() => checks.membersSecToggle(bad), /같은 조건\(!on\)으로 토글되지 않는다/);
});

test('변이㉓: 구성원 모달에 실제 열람 UI(일자 패널)를 넣으면 membersEntryOnlyNoRealUi 가 실패한다', () => {
  const bad = mutate(src, '          <div id="mbList"></div>',
                          '          <div id="mbList"></div>\n          <div class="dp-body" id="dpBody"></div>');
  assert.throws(() => checks.membersEntryOnlyNoRealUi(bad), /실제 일정 열람 UI 흔적\(dpBody\)/);
});

test('변이㉓-b: .mb-row 맨 클래스에 cursor:pointer 를 주면 membersEntryOnlyNoRealUi 가 실패한다', () => {
  const bad = mutate(src, '.mb-row{padding:8px 2px;', '.mb-row{cursor:pointer;padding:8px 2px;');
  assert.throws(() => checks.membersEntryOnlyNoRealUi(bad), /맨 클래스에 cursor:pointer 가 붙었다/);
});

test('변이㉓-c: .mb-row.is-link 에서 cursor:pointer 를 떼면 membersEntryOnlyNoRealUi 가 실패한다', () => {
  const bad = mutate(src, 'position:relative;padding-right:16px;cursor:pointer}', 'position:relative;padding-right:16px}');
  assert.throws(() => checks.membersEntryOnlyNoRealUi(bad), /\.mb-row\.is-link 에 cursor:pointer 가 없다/);
});

test('변이㉔: 구성원 조회가 쓰기 관문(OpenWriteAsync)을 쓰면 membersHostReadPath 가 실패한다', () => {
  const bad = mutateInMember(pdb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)',
    'await using var conn = await OpenReadAsync(cts.Token);', 'await using var conn = await OpenWriteAsync(cts.Token);');
  assert.throws(() => checks.membersHostReadPath(main, bad), /쓰기 관문을 쓴다/);
});

test('변이㉔-b: 호스트 case "membersGet" 을 지우면 membersHostReadPath 가 실패한다', () => {
  const bad = mutate(main, 'case "membersGet":', 'case "membersGetX":');
  assert.throws(() => checks.membersHostReadPath(bad, pdb), /case "membersGet" 을 찾지 못함/);
});

test('변이㉕: 명부에 유닛 필터(IN 절)를 되살리면 membersRosterIsEveryone 이 실패한다', () => {
  const bad = mutateInMember(pdb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)',
    '"SELECT login_id, name, title, org_unit FROM app_user WHERE is_active=1 ORDER BY org_unit, name", conn))',
    '"SELECT login_id, name, title, org_unit FROM app_user WHERE is_active=1 AND org_unit IN (@u0) ORDER BY org_unit, name", conn))');
  assert.throws(() => checks.membersRosterIsEveryone(bad), /is_active=1 전원이 아니다/);
});

test('변이㉖: 본인 행을 따로 담는 self 특례를 되살리면 membersScopeIsScheduleOnly 가 실패한다', () => {
  const bad = mutateInMember(pdb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)',
    '                var members = new List<Dictionary<string, object?>>();',
    '                var members = new List<Dictionary<string, object?>>();\n' +
    '                members.Add(new Dictionary<string, object?> { ["loginId"] = id });');
  assert.throws(() => checks.membersScopeIsScheduleOnly(bad), /본인 행을 따로 만들어 담는다/);
});

test('변이㉖-b: self 를 unit_tree 와 같은 case 로 묶으면 membersScopeIsScheduleOnly 가 실패한다', () => {
  const bad = mutateInMember(pdb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)',
    '                    case "unit_tree":', '                    case "self":\n                    case "unit_tree":');
  assert.throws(() => checks.membersScopeIsScheduleOnly(bad), /self 가 일정 열람 가능 유닛을 받는다/);
});

test('변이㊷: self 면 조직 트리 조회를 건너뛰게 하면 membersUnitsAlwaysQueried 가 실패한다', () => {
  const bad = mutateInMember(pdb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)',
    '                var units = new List<OrgUnitRow>();\n                await using (var cmd = new MySqlCommand(',
    '                var units = new List<OrgUnitRow>();\n' +
    '                if (!string.Equals(scope, "self", StringComparison.Ordinal))\n' +
    '                await using (var cmd = new MySqlCommand(');
  assert.throws(() => checks.membersUnitsAlwaysQueried(bad), /"self" 와 비교하는 특례가 남아 있다/);
});

test('변이㊸: units payload 에 allowed 를 되살리면 membersUnitsHaveNoAllowed 가 실패한다', () => {
  const bad = mutateInMember(pdb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)',
    '                        ["sortOrder"] = u.SortOrder,',
    '                        ["sortOrder"] = u.SortOrder,\n                        ["allowed"] = allowed.Contains(u.Name),');
  assert.throws(() => checks.membersUnitsHaveNoAllowed(bad), /allowed 가 실린다/);
});

test('변이㊹: canViewSchedule 을 true 로 굳히면 membersCanViewScheduleFlag 가 실패한다', () => {
  const bad = mutateInMember(pdb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)',
    '["canViewSchedule"] = allowed.Contains(ou),', '["canViewSchedule"] = true,');
  assert.throws(() => checks.membersCanViewScheduleFlag(bad), /일정 열람 가능 유닛 집합으로 계산하지 않는다/);
});

test('변이㉗: 방문 집합 가드를 빼면 membersTreeExpansion 이 실패한다(순환 시 무한 루프)', () => {
  const bad = mutateInMember(pdb, 'private static void ExpandUnitTree(',
    'if (allowed.Add(k)) queue.Enqueue(k);', '{ allowed.Add(k); queue.Enqueue(k); }');
  assert.throws(() => checks.membersTreeExpansion(bad), /방문 집합 가드가 없다/);
});

test('변이㉘: renderUnitTree 가 조직명을 innerHTML 로 넣으면 membersTreeNoHtmlInjection 이 실패한다', () => {
  const bad = mutate(src, '      b.dataset.unit = nm;\n      b.textContent = nm;',
                          '      b.dataset.unit = nm;\n      b.innerHTML = nm;');
  assert.throws(() => checks.membersTreeNoHtmlInjection(bad), /HTML 주입 API/);
});

test('변이㉙: 범위 밖 노드를 다시 disabled 로 만들면 membersTreeAllEnabled 가 실패한다', () => {
  const bad = mutate(src, '      b.dataset.unit = nm;\n      b.textContent = nm;\n',
                          '      b.dataset.unit = nm;\n      b.textContent = nm;\n      if(!(u && u.canViewSchedule)) b.disabled = true;\n');
  assert.throws(() => checks.membersTreeAllEnabled(bad), /disabled 를 설정한다/);
});

test('변이㉙-b: mbSelect 가 다시 범위로 막으면 membersTreeAllEnabled 가 실패한다', () => {
  const bad = mutate(src, '  if(!u) return;   // 트리에 없는 이름이면', '  if(!u || !u.allowed) return;   // 트리에 없는 이름이면');
  assert.throws(() => checks.membersTreeAllEnabled(bad), /mbSelect 가 아직 범위를 확인한다/);
});

test('변이㊺: mbAllowedCount 를 되살려 트리를 접으면 membersNoDeadAllowedConcept 가 실패한다', () => {
  const bad = mutate(src, '  const usable = arr.length;',
                          '  const usable = arr.filter(u => u && u.allowed).length;');
  assert.throws(() => checks.membersNoDeadAllowedConcept(bad), /renderUnitTree 이 아직 u\.allowed 를 읽는다/);
});

test('변이㊺-b: 기본 선택을 옛 허용 집합 규칙으로 되돌리면 membersNoDeadAllowedConcept 가 실패한다', () => {
  const bad = mutate(src, '  const arr = Array.isArray(units) ? units : [];\n  if(!arr.length) return null;',
                          '  const arr = (Array.isArray(units) ? units : []).filter(u => u && u.allowed);\n  if(!arr.length) return null;');
  assert.throws(() => checks.membersNoDeadAllowedConcept(bad), /mbDefaultSel 이 아직 u\.allowed 를 읽는다/);
});

test('변이㉚: openMembers 가 받아 둔 명부를 재사용하면 membersRefetchOnOpen 이 실패한다', () => {
  const bad = mutate(src, '  if(__mbBusy) return;   // 재진입 가드',
                          "  if(__mbMembers.length){ openModal('#membersModal'); return; }\n  if(__mbBusy) return;   // 재진입 가드");
  assert.throws(() => checks.membersRefetchOnOpen(bad), /캐시\) — 인사이동이 반영되지 않는다/);
});

test('변이㉛: .mb-split 을 1열로 되돌리면 membersSplitTwoCols 가 실패한다', () => {
  const bad = mutate(src, '.mb-split{display:grid;grid-template-columns:minmax(112px,36%) 1fr;',
                          '.mb-split{display:grid;grid-template-columns:1fr;');
  assert.throws(() => checks.membersSplitTwoCols(bad), /1열이다/);
});

test('변이㉜: 판정이 isMe 만 보면(권한 없는 남의 행도 눌림) membersRowLinkRule 이 실패한다', () => {
  const bad = mutate(src, '    const plain = isMe || !canView;', '    const plain = isMe;');
  assert.throws(() => checks.membersRowLinkRule(bad), /「나 이거나 일정을 볼 수 없거나」가 아니다/);
});

test('변이㉜-b: 판정이 canView 만 보면(내 행도 눌림) membersRowLinkRule 이 실패한다', () => {
  const bad = mutate(src, '    const plain = isMe || !canView;', '    const plain = !canView;');
  assert.throws(() => checks.membersRowLinkRule(bad), /「나 이거나 일정을 볼 수 없거나」가 아니다/);
});

test('변이㉜-c: 일정 열람 판정을 상수로 굳히면(canView=true) membersRowLinkRule 이 실패한다', () => {
  const bad = mutate(src, '    const canView = !!(m && m.canViewSchedule);', '    const canView = true;');
  assert.throws(() => checks.membersRowLinkRule(bad), /canView\)이 m\.canViewSchedule 이 아니다/);
});

test('변이㉜-d: 내 행 판정을 상수로 굳히면(isMe=false) membersRowLinkRule 이 실패한다', () => {
  const bad = mutate(src, "const isMe = !!me && String(m && m.loginId == null ? '' : m.loginId) === me;", 'const isMe = false;');
  assert.throws(() => checks.membersRowLinkRule(bad), /isMe\)이 loginId 대조가 아니다/);
});

test('변이㉜-e: 권한 없는 남의 행에 꼬리표를 달면 membersRowLinkRule 이 실패한다', () => {
  const bad = mutate(src, "    if(isMe){ const s = document.createElement('span'); s.className = 'git-opt'; s.textContent = ' · 나'; head.appendChild(s); }",
                          "    if(isMe){ const s = document.createElement('span'); s.className = 'git-opt'; s.textContent = ' · 나'; head.appendChild(s); }\n" +
                          "    else if(!canView){ const s = document.createElement('span'); s.className = 'git-opt'; s.textContent = ' · 권한 없음'; head.appendChild(s); }");
  assert.throws(() => checks.membersRowLinkRule(bad), /행 꼬리표가 「· 나」 하나가 아니다/);
});

test('변이㉝: 누를 수 있는 행을 div 로 되돌리면 membersLinkRowIsButton 이 실패한다', () => {
  const bad = mutate(src, "const row = document.createElement(plain ? 'div' : 'button');",
                          "const row = document.createElement('div');");
  assert.throws(() => checks.membersLinkRowIsButton(bad), /<button> 이 아니다/);
});

test('변이㉞: 셰브론 ::after 를 지우면 membersChevronCssOnly 가 실패한다', () => {
  const bad = mutate(src, ".mb-row.is-link::after{content:'›';", '.mb-row.is-link::after{content:"";');
  assert.throws(() => checks.membersChevronCssOnly(bad), /셰브론\(content:'›'\)이 없다/);
});

test('변이㉟: 행 클릭이 모달을 닫으면 membersClickToastOnly 가 실패한다', () => {
  const bad = mutate(src, "function mbRowClick(){ toast('일정 열람은 준비 중입니다', 'info'); }",
                          "function mbRowClick(){ toast('일정 열람은 준비 중입니다', 'info'); closeOverlay(document.getElementById('membersModal')); }");
  assert.throws(() => checks.membersClickToastOnly(bad), /행 클릭이 closeOverlay 를 쓴다/);
});

test('변이㊱: 누를 행이 0개일 때 #mbSoon 을 감추면(옛 규칙) membersSoonHint 가 실패한다', () => {
  const bad = mutate(src, "    soon.classList.toggle('hidden', arr.length === 0);",
                          "    soon.classList.toggle('hidden', links === 0);");
  assert.throws(() => checks.membersSoonHint(bad), /감춘다 — 감추지 말고/);
});

test('변이㊱-b: 권한 없음 문구를 빼면 membersSoonHint 가 실패한다', () => {
  const bad = mutate(src, "        soon.textContent = '명부만 볼 수 있습니다 — 일정 열람 권한이 없습니다';",
                          "        soon.textContent = '사람을 누르면 그 사람 일정을 볼 수 있습니다';");
  assert.throws(() => checks.membersSoonHint(bad), /누를 행이 0개일 때의 문구가 없다/);
});

// ── 결함① 신원 갱신 ──────────────────────────────────────────────────

test('변이㊲-a: 신원을 세션(currentUser)에서 칠하면 identityLiveFromInfo 가 실패한다', () => {
  const bad = mutate(src, "    set('usOrg', usOrgText(inf.org_unit));",
                          "    set('usOrg', usOrgText(currentUser.orgUnit));");
  assert.throws(() => checks.identityLiveFromInfo(bad), /#usOrg 를 응답\(inf\.org_unit\)으로 칠하지 않는다/);
});

test('변이㊲-b: 응답 키를 camelCase(inf.orgUnit)로 읽으면 identityLiveFromInfo 가 실패한다', () => {
  const bad = mutate(src, 'usOrgText(inf.org_unit)', 'usOrgText(inf.orgUnit)');
  assert.throws(() => checks.identityLiveFromInfo(bad), /camelCase/);
});

test('변이㊲-c: 실패 경로가 신원을 지우면 identityLiveFromInfo 가 실패한다', () => {
  const bad = mutate(src, "  set('usEditRole', '확인할 수 없음');",
                          "  set('usName', '확인할 수 없음');\n  set('usEditRole', '확인할 수 없음');");
  assert.throws(() => checks.identityLiveFromInfo(bad), /조회 실패가 #usName 값을 덮어쓴다/);
});

test('변이㊲-d: 조회 결과를 currentUser 에 대입하면 identityLiveFromInfo 가 실패한다(§2.5)', () => {
  const bad = mutate(src, "    set('usName', inf.name || (currentUser && currentUser.loginId) || '—');",
                          "    currentUser.orgUnit = inf.org_unit;\n    set('usName', inf.name || (currentUser && currentUser.loginId) || '—');");
  assert.throws(() => checks.identityLiveFromInfo(bad), /currentUser 에 대입한다/);
});

test('변이㊲-e: 조회 뒤 applyUser 로 세션을 갈아끼우면 identityLiveFromInfo 가 실패한다(§2.5)', () => {
  const bad = mutate(src, "    set('usPermMsg', '');\n    return;",
                          "    applyUser(Object.assign({}, currentUser, {orgUnit: inf.org_unit}));\n    set('usPermMsg', '');\n    return;");
  assert.throws(() => checks.identityLiveFromInfo(bad), /applyUser 를 부른다/);
});

test('변이㊲-f: 세션을 다시 쓰게 하는 호스트 요청을 붙이면 identityLiveFromInfo 가 실패한다(§2.5)', () => {
  const bad = mutate(src, "  try{ r = await hostRequest('userInfoGet', {}, 10000); }catch(_){ r = null; }",
                          "  try{ r = await hostRequest('userInfoGet', {}, 10000); }catch(_){ r = null; }\n  try{ await hostRequest('userSessionGet', {}, 10000); }catch(_){}");
  assert.throws(() => checks.identityLiveFromInfo(bad), /userInfoGet 하나가 아니다/);
});

test('변이㊲-g: 신원을 innerHTML 로 칠하면 identityLiveFromInfo 가 실패한다', () => {
  const bad = mutate(src, "    set('usTitle', inf.title ? '· ' + inf.title : '');",
                          "    document.getElementById('usTitle').innerHTML = inf.title ? '· ' + inf.title : '';");
  assert.throws(() => checks.identityLiveFromInfo(bad), /HTML 주입 API/);
});

test('변이㊳-a: 빈 소속을 빈 문자열로 되돌리면 identityOrgFallback 이 실패한다', () => {
  const bad = mutate(src, "function usOrgText(v){ const s = String(v == null ? '' : v).trim(); return s || '소속 미등록'; }",
                          "function usOrgText(v){ return String(v == null ? '' : v).trim(); }");
  assert.throws(() => checks.identityOrgFallback(bad), /빈 소속을 문장으로 바꾸지 않는다/);
});

test('변이㊳-b: 세션 경로가 헬퍼를 건너뛰면 identityOrgFallback 이 실패한다(문구 두 벌)', () => {
  const bad = mutate(src, "    set('usOrg', usOrgText(currentUser.orgUnit));",
                          "    set('usOrg', currentUser.orgUnit || '소속 없음');");
  assert.throws(() => checks.identityOrgFallback(bad), /updateUserUi\)가 usOrgText 를 거치지 않는다/);
});

test('변이㊳-c: 문구를 두 곳에 하드코딩하면 identityOrgFallback 이 실패한다', () => {
  const bad = mutate(src, "    set('usOrg', usOrgText(inf.org_unit));",
                          "    set('usOrg', inf.org_unit || '소속 미등록');");
  assert.throws(() => checks.identityOrgFallback(bad), /2곳 있다|usOrgText 를 거치지 않는다/);
});

test('변이㊳-d: 공백 트림을 빼면 identityOrgFallback 이 실패한다(공백 한 칸도 빈 줄로 보인다)', () => {
  const bad = mutate(src, "function usOrgText(v){ const s = String(v == null ? '' : v).trim(); return s || '소속 미등록'; }",
                          "function usOrgText(v){ const s = String(v == null ? '' : v); return s || '소속 미등록'; }");
  assert.throws(() => checks.identityOrgFallback(bad), /공백만 든 값을 걸러내지 않는다/);
});

// ── 결함② 소속 없음 빈 상태 ──────────────────────────────────────────

test('변이㊴-a: 트리 숨김을 허용 노드 개수로 되돌리면 membersTreeHiddenByUnitCount 가 실패한다', () => {
  const bad = mutate(src, '  const usable = arr.length;', '  const usable = mbAllowedCount(arr);');
  assert.throws(() => checks.membersTreeHiddenByUnitCount(bad), /allowed 개수로 판정하던 옛 규칙/);
});

test("변이㊴-b: 트리 숨김을 scope==='self' 비교로 되돌리면 membersTreeHiddenByUnitCount 가 실패한다", () => {
  const bad = mutate(src, '  const usable = arr.length;', "  const usable = (__mbScopeRaw === 'self') ? 0 : arr.length;");
  assert.throws(() => checks.membersTreeHiddenByUnitCount(bad), /문자열 비교로 판정한다/);
});

test('변이㊵-a: 0건 안내를 한 문구로 합치면 membersEmptyTwoCases 가 실패한다', () => {
  const bad = mutate(src, "  return k ? '검색 결과가 없습니다.' : '이 조직에 등록된 구성원이 없습니다.';",
                          "  return '검색 결과가 없습니다.';");
  assert.throws(() => checks.membersEmptyTwoCases(bad), /검색어 뒤로 가려지지 않는다/);
});

test('변이㊵-b: 옛 「볼 수 있는 조직 없음」 분기를 되살리면 membersEmptyTwoCases 가 실패한다', () => {
  const bad = mutate(src, "  return k ? '검색 결과가 없습니다.' : '이 조직에 등록된 구성원이 없습니다.';",
                          "  return k ? '검색 결과가 없습니다.' : (__mbUnits.length ? '이 조직에 등록된 구성원이 없습니다.' : '소속이 등록되지 않아 볼 수 있는 조직이 없습니다 — 관리자에게 문의하세요.');");
  assert.throws(() => checks.membersEmptyTwoCases(bad), /옛 3번째 분기/);
});

test('변이㊵-c: renderMembers 가 문구를 갈아끼우지 않으면 membersEmptyTwoCases 가 실패한다', () => {
  const bad = mutate(src, '  if(empty){ empty.textContent = mbEmptyText(); empty.classList.toggle(\'hidden\', arr.length > 0); }',
                          "  if(empty) empty.classList.toggle('hidden', arr.length > 0);");
  assert.throws(() => checks.membersEmptyTwoCases(bad), /mbEmptyText 로 갈아끼우지 않는다/);
});

test('변이㊶: 범위 줄 앞머리를 「열람 범위:」로 되돌리면 membersScopeLineSchedulePrefix 가 실패한다', () => {
  const bad = mutate(src, "  set('mbScope', '일정 열람 범위: ' + (__mbScopeText || '—') + where + rows.length + '명');",
                          "  set('mbScope', '열람 범위: ' + (__mbScopeText || '—') + where + rows.length + '명');");
  assert.throws(() => checks.membersScopeLineSchedulePrefix(bad), /「일정 열람 범위:」로 시작하지 않는다/);
});

test('변이㊶-b: 실패 줄만 옛 앞머리를 쓰면 membersScopeLineSchedulePrefix 가 실패한다', () => {
  const bad = mutate(src, "sc.textContent = '일정 열람 범위: 확인할 수 없음'", "sc.textContent = '열람 범위: 확인할 수 없음'");
  assert.throws(() => checks.membersScopeLineSchedulePrefix(bad), /실패 줄만 옛 앞머리를 쓴다/);
});

// ══ 실제 렌더(jsdom) — 문자열 검사만으로는 못 보는 것 ═══════════════════
// 권한 렌더는 HOST(위젯)에서만 도는 코드다 → chrome.webview 를 심어 HOST=true 로 부팅하고,
// 호스트 왕복은 hostRequest 를 갈아끼워 만든다(실제 DB·WebView2 없이 렌더 결과만 본다).
// 미설치 시 graceful-skip(다른 Layer 2 테스트와 같은 관례).

let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch (_) { /* 미설치 */ }

if (!JSDOM) {
  test('사용자정보(jsdom): jsdom 미설치 — 렌더 테스트 생략', () => {
    console.log('      jsdom 미설치 — 렌더 테스트 생략');
  });
} else {
  let w = null, bootErr = null;
  try {
    const dom = new JSDOM(src, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://tcapp.local/',
      beforeParse(win) {
        // HOST=true 로 부팅한다(const HOST 는 나중에 못 바꾼다). 호스트로 나가는 메시지는 전부 삼킨다.
        win.chrome = { webview: { postMessage() {}, addEventListener() {}, removeEventListener() {} } };
        if (typeof win.crypto === 'undefined') {
          win.crypto = { randomUUID: () => 'x-' + Math.random().toString(36).slice(2), getRandomValues: a => a };
        }
        win.scrollTo = () => {};
      },
    });
    w = dom.window;
  } catch (e) { bootErr = e; }

  if (bootErr) {
    test('사용자정보(jsdom): 부팅 실패(조사 필요)', () => { throw bootErr; });
  } else {
    const txt = (id) => w.document.getElementById(id).textContent;
    // hostRequest 는 최상위 함수 선언이라 전역 프로퍼티다 — 통째로 갈아끼워 회신을 만든다.
    const reply = (obj) => w.eval('hostRequest = function(){ return Promise.resolve(' + JSON.stringify(obj) + '); };');
    const login = () => w.eval("currentUser = {loginId:'hjlee', name:'이현진', title:'책임연구원', orgUnit:'개발1팀'}; __usPermBusy = false;");

    test('사용자정보(jsdom): HOST=true 로 부팅했다(권한 경로가 실제로 돈다)', () => {
      assert.strictEqual(w.eval('HOST'), true, '전제: 위젯 모드 부팅');
      assert.ok(w.document.getElementById('userModal'), '#userModal 이 DOM 에 없다');
    });

    test('사용자정보(jsdom): 신원은 세션만으로 즉시 그려진다(모달 오픈 · 조회 대기 없음)', () => {
      login();
      w.eval('openUserInfo()');   // 던지면 여기서 실패한다
      assert.ok(!w.document.getElementById('userModal').classList.contains('hidden'), '모달이 열리지 않았다');
      assert.strictEqual(txt('usName'), '이현진');
      assert.strictEqual(txt('usTitle'), '· 책임연구원');
      assert.strictEqual(txt('usOrg'), '개발1팀');
      assert.strictEqual(txt('usState'), '· 로그인됨');
      assert.ok(!w.document.getElementById('usLogout').classList.contains('hidden'), '로그인 상태인데 로그아웃 버튼이 감춰졌다');
    });

    test('사용자정보(jsdom) ⑩: viewer/self 를 먹이면 코드값이 아니라 문장이 뜬다', async () => {
      login();
      reply({ ok: true, info: { found: true, edit_role: 'viewer', view_scope: 'self', is_active: 1 } });
      await w.eval('loadUserPerm()');
      assert.ok(/열람자/.test(txt('usEditRole')), `편집 권한이 '열람자'로 표시되지 않았다: ${txt('usEditRole')}`);
      assert.ok(!/viewer/.test(txt('usEditRole')), '원시 코드값(viewer)이 그대로 노출됐다');
      assert.ok(/본인만/.test(txt('usViewScope')), `열람 범위가 '본인만'으로 표시되지 않았다: ${txt('usViewScope')}`);
      assert.ok(!/self/.test(txt('usViewScope')), '원시 코드값(self)이 그대로 노출됐다');
      assert.strictEqual(txt('usPermState'), '', '정상 계정인데 상태 꼬리표가 남았다');
      assert.strictEqual(txt('usPermMsg'), '', '성공했는데 오류 문구가 남았다');
    });

    test('사용자정보(jsdom): is_active=0 이면 비활성임을 두 곳에서 알린다', async () => {
      login();
      reply({ ok: true, info: { found: true, edit_role: 'admin', view_scope: 'all', is_active: 0 } });
      await w.eval('loadUserPerm()');
      assert.ok(/관리자/.test(txt('usEditRole')), '역할 문장이 사라졌다');
      assert.ok(/계정 비활성 — 편집 불가/.test(txt('usEditRole')), '비활성인데 편집 가능한 것처럼 보인다');
      assert.strictEqual(txt('usPermState'), '· 비활성 계정');
    });

    test('사용자정보(jsdom): 모르는 코드값은 감추지 않고 단서를 남긴다', async () => {
      login();
      reply({ ok: true, info: { found: true, edit_role: 'superuser', view_scope: 'team', is_active: 1 } });
      await w.eval('loadUserPerm()');
      assert.ok(/superuser — 알 수 없는 값/.test(txt('usEditRole')), `모르는 역할을 조용히 삼켰다: ${txt('usEditRole')}`);
      assert.ok(/team — 알 수 없는 값/.test(txt('usViewScope')), `모르는 범위를 조용히 삼켰다: ${txt('usViewScope')}`);
    });

    test('사용자정보(jsdom): 조회 실패는 「확인할 수 없음」 + 호스트 사유 — 추측하지 않는다', async () => {
      login();
      reply({ ok: true, info: { found: true, edit_role: 'admin', view_scope: 'all', is_active: 1 } });
      await w.eval('loadUserPerm()');
      assert.ok(/관리자/.test(txt('usEditRole')), '전제: 직전 조회가 성공해 값이 남아 있다');
      reply({ ok: false, msg: '서버에 연결하지 못했습니다 — 잠시 후 다시 시도하세요.' });
      await w.eval('loadUserPerm()');
      assert.strictEqual(txt('usEditRole'), '확인할 수 없음', '실패했는데 직전(낡은) 권한이 그대로 남았다');
      assert.strictEqual(txt('usViewScope'), '확인할 수 없음');
      assert.strictEqual(txt('usPermMsg'), '서버에 연결하지 못했습니다 — 잠시 후 다시 시도하세요.', '호스트가 준 사유를 그대로 보여주지 않는다');
      assert.ok(!/관리자|admin/.test(txt('usEditRole')), '실패 상태에서 권한을 추측해 표시했다');
    });

    // ── 신원 갱신(결함①) ──────────────────────────────────────────────
    // 실앱 실측: DB 소속을 「기술개발총괄」로 바꿔도 화면 소속은 「SW 3팀」인데 바로 아래 「열람 범위」는
    // 즉시 갱신됐다 — 한 모달 안에서 위는 로그인 시점, 아래는 지금. 그 어긋남을 여기서 잡는다.
    const loginSW3 = () => w.eval("currentUser = {loginId:'hjlee', name:'이현진', title:'책임연구원', orgUnit:'SW 3팀'}; __usPermBusy = false;");

    test('사용자정보(jsdom) ㊲: 조회 성공이 신원을 최신값으로 덮는다 — 세션은 그대로 둔다(§2.5)', async () => {
      loginSW3();
      w.eval('updateUserUi()');
      assert.strictEqual(txt('usOrg'), 'SW 3팀', '전제: 세션 값이 먼저 그려진다(오프라인 폴백)');
      reply({ ok: true, info: { found: true, name: '이현진', title: '수석연구원', org_unit: '기술개발총괄',
        edit_role: 'editor', view_scope: 'unit_tree', is_active: 1 } });
      await w.eval('loadUserPerm()');
      assert.strictEqual(txt('usOrg'), '기술개발총괄',
        '소속이 로그인 시점 값에 굳었다 — 바로 아래 「열람 범위」만 최신이라 한 모달이 두 시점을 말한다');
      assert.strictEqual(txt('usTitle'), '· 수석연구원', '직급도 최신값이어야 한다(같은 회신에 들어 있다)');
      assert.strictEqual(txt('usName'), '이현진');
      assert.ok(/소속 조직/.test(txt('usViewScope')), '전제: 권한도 같은 회신으로 함께 갱신된다');
      // ★ 화면만 최신이다. 세션을 여기서 갱신하면 로그아웃과 경합해 삭제된 세션이 되살아난다(USER-LOGIN §2.5).
      assert.strictEqual(w.eval('currentUser.orgUnit'), 'SW 3팀',
        'loadUserPerm 이 세션(currentUser)을 갈아끼웠다 — 표시 계층에서 끝나야 한다(§2.5)');
      assert.strictEqual(w.eval('currentUser.title'), '책임연구원', '세션의 직급까지 덮어썼다(§2.5)');
    });

    test('사용자정보(jsdom) ㊲: 조회 실패는 신원을 지우지 않는다 — 세션 값이 남는다', async () => {
      loginSW3();
      w.eval('updateUserUi()');
      reply({ ok: false, msg: '서버에 연결하지 못했습니다 — 잠시 후 다시 시도하세요.' });
      await w.eval('loadUserPerm()');
      assert.strictEqual(txt('usName'), '이현진', '조회에 실패했다고 이름을 지웠다 — 오프라인에서도 이름은 보여야 한다');
      assert.strictEqual(txt('usTitle'), '· 책임연구원', '조회 실패가 직급을 지웠다');
      assert.strictEqual(txt('usOrg'), 'SW 3팀', '조회 실패가 소속을 지웠다');
      assert.strictEqual(txt('usEditRole'), '확인할 수 없음', '전제: 권한만 「모른다」고 말한다');
      assert.strictEqual(txt('usPermMsg'), '서버에 연결하지 못했습니다 — 잠시 후 다시 시도하세요.', '전제: 사유는 권한 블록에 있다');
    });

    test('사용자정보(jsdom) ㊳: 빈 소속은 두 경로 모두 「소속 미등록」이다(문구 깜빡임 금지)', async () => {
      w.eval("currentUser = {loginId:'hjlee', name:'이현진', title:'', orgUnit:''}; __usPermBusy = false; updateUserUi();");
      assert.strictEqual(txt('usOrg'), '소속 미등록',
        '세션 경로가 빈 소속을 빈 줄로 남긴다 — 그 자리가 사라지면 「아직 안 불러온 것」으로 읽힌다');
      assert.strictEqual(txt('usTitle'), '', '직급이 없으면 꼬리표도 없다');
      reply({ ok: true, info: { found: true, name: '이현진', title: '', org_unit: '',
        edit_role: 'viewer', view_scope: 'unit_tree', is_active: 1 } });
      await w.eval('loadUserPerm()');
      assert.strictEqual(txt('usOrg'), '소속 미등록',
        '실시간 경로가 다른 문구를 쓴다 — 조회 전후로 같은 줄이 다른 말을 하면 화면이 깜빡인다');
    });

    test('사용자정보(jsdom) ㊲: 응답의 이름·소속에 마크업이 와도 텍스트로만 들어간다', async () => {
      loginSW3();
      reply({ ok: true, info: { found: true, name: '<img src=x onerror=1>', title: '<b>수석</b>', org_unit: '<i>총괄</i>',
        edit_role: 'editor', view_scope: 'all', is_active: 1 } });
      await w.eval('loadUserPerm()');
      const nm = w.document.getElementById('usName'), og = w.document.getElementById('usOrg');
      assert.strictEqual(nm.querySelector('img'), null, '응답 이름의 img 요소가 실제로 만들어졌다');
      assert.strictEqual(nm.children.length, 0, '#usName 안에 요소가 생성됐다 — HTML 로 해석됐다');
      assert.strictEqual(og.children.length, 0, '#usOrg 안에 요소가 생성됐다 — HTML 로 해석됐다');
      assert.ok(nm.textContent.includes('<img src=x onerror=1>'), '이름 원문이 그대로 보이지 않는다');
      assert.ok(og.textContent.includes('<i>총괄</i>'), '소속 원문이 그대로 보이지 않는다');
    });

    test('사용자정보(jsdom) ⑧: 마크업 문자열이 와도 요소로 해석되지 않는다(textContent)', async () => {
      login();
      reply({ ok: true, info: { found: true, edit_role: '<img src=x onerror=alert(1)>', view_scope: 'all', is_active: 1 } });
      await w.eval('loadUserPerm()');
      const el = w.document.getElementById('usEditRole');
      assert.strictEqual(el.children.length, 0, '#usEditRole 안에 요소가 생성됐다 — HTML 로 해석됐다');
      assert.strictEqual(el.querySelector('img'), null, 'img 요소가 실제로 만들어졌다');
      assert.ok(el.textContent.includes('<img src=x onerror=alert(1)>'), '원문이 그대로 보이지 않는다');
      // 이름·소속도 같은 규칙(세션 경로)
      w.eval("currentUser = {loginId:'x', name:'<b>이름</b>', title:'', orgUnit:'<i>팀</i>'}; updateUserUi();");
      assert.strictEqual(w.document.getElementById('usName').children.length, 0, '#usName 이 HTML 로 해석됐다');
      assert.strictEqual(w.document.getElementById('usOrg').children.length, 0, '#usOrg 가 HTML 로 해석됐다');
    });

    test('사용자정보(jsdom): 미로그인이면 신원·권한 구획과 로그아웃이 모두 감춰진다', () => {
      w.eval('currentUser = null; updateUserUi();');
      assert.strictEqual(txt('usState'), '· 로그인 필요');
      for (const id of ['usInfoBlock', 'usPermSec', 'usLogout']) {
        assert.ok(w.document.getElementById(id).classList.contains('hidden'), `#${id} 가 미로그인 상태에서 노출된다`);
      }
    });

    // ── 구성원(실데이터 payload) ──────────────────────────────────────
    // 실제 org_unit(12행 3계층)·app_user(89명)를 그대로 본뜬 표본을 hostRequest 회신으로 먹인다.
    // ★ payload 의 members 에는 '전원'이 들어 있다 — 명부는 열람 범위와 무관하기 때문이다.
    //   범위는 각 행의 canViewSchedule 하나로만 나타난다(= 그 사람 일정을 열 수 있는가).
    //   그러니 여기서 보는 것은 두 가지다: '트리 선택 → 서브트리 집계'와 '누를 수 있는 행이 누구인가'.
    const rows = () => w.document.querySelectorAll('#mbList .mb-row').length;
    const nodes = () => [...w.document.querySelectorAll('#mbTree .mb-node')];
    const node = (name) => nodes().find((b) => b.dataset.unit === name);
    const linkRows = () => [...w.document.querySelectorAll('#mbList .mb-row.is-link')];
    const soonText = () => w.document.getElementById('mbSoon').textContent;

    const U = (name, parent, sortOrder) => ({ name, parent, sortOrder });
    const UNITS_ALL = [
      U('기술개발총괄', null, 10),
      U('SW개발본부', '기술개발총괄', 20),
      U('SW 1팀', 'SW개발본부', 21),
      U('SW 2팀', 'SW개발본부', 22),
      U('SW 3팀', 'SW개발본부', 23),
      U('SW 4팀', 'SW개발본부', 24),
      U('디자인팀', 'SW개발본부', 25),
      U('시스템개발본부', '기술개발총괄', 30),
      U('시스템 1팀', '시스템개발본부', 31),
      U('시스템 2팀', '시스템개발본부', 32),
      U('사업부', '기술개발총괄', 40),
      U('경영지원팀', '기술개발총괄', 50),
    ];
    const M = (loginId, name, title, orgUnit, canViewSchedule) =>
      ({ loginId, name, title, orgUnit, canViewSchedule: !!canViewSchedule });
    // 실데이터 규모(89명)를 그대로 쓴다 — '명부는 전원이다'라는 계약은 8명짜리 표본으로는 증명되지 않는다.
    const HEADCOUNT = {
      '기술개발총괄': 3, 'SW개발본부': 4, 'SW 1팀': 9, 'SW 2팀': 8, 'SW 3팀': 10, 'SW 4팀': 7,
      '디자인팀': 5, '시스템개발본부': 4, '시스템 1팀': 11, '시스템 2팀': 9, '사업부': 12, '경영지원팀': 7,
    };
    // 호스트가 view_scope 로 계산해 각 행에 실어 보내는 값(canViewSchedule)을 여기서 흉내 낸다.
    const subtreeOf = (root) => {
      const out = new Set([root]), q = [root];
      while (q.length) {
        const cur = q.shift();
        for (const u of UNITS_ALL) if (u.parent === cur && !out.has(u.name)) { out.add(u.name); q.push(u.name); }
      }
      return out;
    };
    const roster = (allowedUnits) => {
      const set = allowedUnits instanceof Set ? allowedUnits : new Set(allowedUnits || []);
      const out = [];
      for (const u of UNITS_ALL) {
        for (let i = 1; i <= (HEADCOUNT[u.name] || 0); i++) {
          out.push(M('u' + (out.length + 1), u.name + ' ' + i + '번', '연구원', u.name, set.has(u.name)));
        }
      }
      return out;
    };
    const membersReply = (data) => reply({ ok: true, data });

    // ★ 이 테스트가 이번 설계 오류를 직접 겨눈다: self 인 71명(89명 중)이 조직 트리가 통째로 사라지고
    //   자기 이름 한 줄만 보던 화면. 이제 명부·트리는 전부 보이고, 못 누르는 것만 다르다.
    test('구성원(jsdom): self 라도 전 조직 트리 12노드 · 명부 89명 — 다른 것은 누를 행이 0개라는 점뿐', async () => {
      login();
      const ms = roster([]);   // self = 일정 열람 가능 유닛 없음
      assert.strictEqual(ms.length, 89, `전제: 표본이 89명이 아니다: ${ms.length}`);
      membersReply({ found: true, scope: 'self', myUnit: 'SW 3팀', units: UNITS_ALL, members: ms });
      await w.eval('openMembers()');
      assert.ok(!w.document.getElementById('membersModal').classList.contains('hidden'), '구성원 모달이 열리지 않았다');
      assert.ok(!w.document.getElementById('mbTree').classList.contains('hidden'),
        'self 인데 트리를 접었다 — 71명이 자기 이름 한 줄만 보던 그 화면이다');
      assert.strictEqual(nodes().length, 12, `조직 트리가 12노드로 그려지지 않았다: ${nodes().length}`);
      assert.strictEqual(nodes().filter((b) => b.disabled).length, 0,
        'self 인데 눌리지 않는 조직 노드가 있다 — 조직도는 누구나 탐색할 수 있어야 한다');
      assert.strictEqual(w.document.querySelector('.mb-split').style.gridTemplateColumns, '',
        '트리가 있는데 1열로 접혔다');
      assert.ok(node('기술개발총괄').classList.contains('sel'), '루트(기술개발총괄)가 기본 선택이 아니다');
      assert.ok(node('SW 3팀').classList.contains('is-mine'), '내 소속 표시가 사라졌다');
      assert.strictEqual(rows(), 89, `명부 전원 89행이 아니다: ${rows()}`);
      assert.strictEqual(linkRows().length, 0, 'self 인데 누를 수 있는 행이 있다 — 일정 열람 범위가 비어 있다');
      assert.ok(!w.document.getElementById('mbSoon').classList.contains('hidden'),
        '누를 행이 0개라고 안내를 감췄다 — 왜 안 눌리는지 알 수 없다');
      assert.strictEqual(soonText(), '명부만 볼 수 있습니다 — 일정 열람 권한이 없습니다',
        `누를 행이 0개인데 「누르면 볼 수 있습니다」가 남았다(거짓말이다): ${soonText()}`);
      assert.ok(/^일정 열람 범위: 본인만/.test(txt('mbScope')), `범위 줄이 다르다: ${txt('mbScope')}`);
      assert.ok(/기술개발총괄 89명/.test(txt('mbScope')), `범위 줄에 선택 조직·인원이 없다: ${txt('mbScope')}`);
      assert.ok(w.document.getElementById('mbEmpty').classList.contains('hidden'), '89행인데 빈 안내가 떠 있다');
    });

    const ALLOW_SW = subtreeOf('SW개발본부');   // SW개발본부 + 하위 5팀 = 43명
    test('구성원(jsdom): unit_tree — 트리 전부 활성 · 명부 전원 · SW 서브트리 사람만 누를 수 있다', async () => {
      login();
      membersReply({ found: true, scope: 'unit_tree', myUnit: 'SW개발본부', units: UNITS_ALL, members: roster(ALLOW_SW) });
      await w.eval('openMembers()');
      assert.strictEqual(nodes().length, 12, `조직 트리가 12노드로 그려지지 않았다: ${nodes().length}`);
      assert.strictEqual(nodes().filter((b) => b.disabled).length, 0,
        '일정 열람 범위 밖 조직이 disabled 다 — 트리는 이제 전부 활성이다');
      assert.strictEqual(node('기술개발총괄').title, '', '트리 노드에 「열람 범위 밖」 안내가 남았다');
      assert.ok(node('기술개발총괄').classList.contains('sel'), '루트가 기본 선택이 아니다');
      assert.strictEqual(node('기술개발총괄').getAttribute('aria-current'), 'true', '선택 노드에 aria-current 가 없다');
      assert.ok(node('SW개발본부').classList.contains('is-mine'), '내 소속에 .is-mine 이 없다');
      assert.ok(/· 내 소속/.test(node('SW개발본부').textContent), '「· 내 소속」 꼬리표가 없다');
      assert.ok(node('SW개발본부').querySelector('span.git-opt'), '꼬리표가 별도 요소가 아니다 — 맨 텍스트로 섞였다');
      assert.strictEqual(rows(), 89, `명부 전원 89행이 아니다: ${rows()}`);
      assert.strictEqual(linkRows().length, 43, `SW 서브트리 43명만 눌려야 한다: ${linkRows().length}`);
      // 범위 밖 사람은 명부에 '있되' 눌리지 않는다 — 꼬리표도 없다(「· 나」는 내 행 전용이다).
      const outside = [...w.document.querySelectorAll('#mbList .mb-row')].find((r) => /시스템 1팀/.test(r.textContent));
      assert.ok(outside, '일정 열람 범위 밖 사람이 명부에서 빠졌다 — 명부는 전원이다');
      assert.strictEqual(outside.tagName, 'DIV', '일정을 볼 수 없는 사람의 행이 눌린다');
      assert.ok(!/· 나/.test(outside.textContent), '남의 행에 꼬리표가 붙었다 — 그냥 안 눌리는 줄이어야 한다');
      assert.ok(/준비 중/.test(soonText()), `누를 행이 43개인데 예고가 없다: ${soonText()}`);
      assert.ok(/^일정 열람 범위: 소속 조직/.test(txt('mbScope')), `범위 줄 앞머리가 다르다: ${txt('mbScope')}`);
    });

    test('구성원(jsdom): 범위 밖 조직도 고를 수 있다 — 목록은 보이되 누를 행이 0개', () => {
      node('시스템개발본부').click();
      assert.ok(node('시스템개발본부').classList.contains('sel'),
        '일정 열람 범위 밖 조직이 선택되지 않았다 — 조직도는 전부 탐색할 수 있어야 한다');
      assert.ok(!node('기술개발총괄').classList.contains('sel'), '이전 선택이 남아 있다 — 선택이 둘로 보인다');
      assert.strictEqual(rows(), 24, `시스템개발본부 서브트리 24명이 아니다: ${rows()}`);
      assert.strictEqual(linkRows().length, 0, '일정 열람 범위 밖인데 눌리는 행이 있다');
      assert.strictEqual(soonText(), '명부만 볼 수 있습니다 — 일정 열람 권한이 없습니다',
        `아무도 못 누르는데 안내가 그대로다: ${soonText()}`);
      assert.ok(/시스템개발본부 24명/.test(txt('mbScope')), `범위 줄이 따라오지 않았다: ${txt('mbScope')}`);
      // 내 서브트리로 돌아오면 누를 수 있는 행도 예고 문구도 돌아온다.
      node('SW 3팀').click();
      assert.strictEqual(rows(), 10, `SW 3팀 10명으로 좁혀지지 않았다: ${rows()}`);
      assert.strictEqual(linkRows().length, 10, 'SW 3팀 전원이 눌려야 한다');
      assert.ok(/준비 중/.test(soonText()), `누를 행이 돌아왔는데 예고가 없다: ${soonText()}`);
    });

    test('구성원(jsdom): 검색은 현재 서브트리 안에서만 — 0건이면 빈 안내', () => {
      w.eval("mbSelect('SW개발본부')");
      assert.strictEqual(rows(), 43, `전제: 본부 서브트리 43명: ${rows()}`);
      w.eval("document.getElementById('mbSearch').value = 'SW 1팀'; filterMembers();");
      assert.strictEqual(rows(), 9, `소속 부분일치가 안 된다: ${rows()}`);
      w.eval("document.getElementById('mbSearch').value = '없는이름'; filterMembers();");
      assert.strictEqual(rows(), 0, '결과가 0건이 아니다');
      assert.ok(!w.document.getElementById('mbEmpty').classList.contains('hidden'), '0건인데 「검색 결과가 없습니다」가 뜨지 않는다');
      assert.strictEqual(w.document.getElementById('mbEmpty').textContent, '검색 결과가 없습니다.',
        `검색 중 0건의 문구가 바뀌었다: ${w.document.getElementById('mbEmpty').textContent}`);
      assert.ok(w.document.getElementById('mbSoon').classList.contains('hidden'),
        '목록이 0행인데 예고 줄이 남았다 — 안내할 대상이 없다');
      // 선택 서브트리 밖 사람은 검색으로도 끌려 나오지 않는다(명부에는 있지만 지금 보는 조직이 아니다).
      w.eval("document.getElementById('mbSearch').value = '시스템'; filterMembers();");
      assert.strictEqual(rows(), 0, '선택 서브트리 밖 인원이 검색으로 노출됐다');
      w.eval("mbSelect('SW 3팀'); document.getElementById('mbSearch').value = 'SW 3팀 7번'; filterMembers();");
      assert.strictEqual(rows(), 1, '선택 조직 안 이름 검색이 안 된다');
      w.eval("document.getElementById('mbSearch').value = ''; filterMembers();");
      assert.strictEqual(rows(), 10, '검색어를 지우면 선택 조직 전체로 돌아와야 한다');
      assert.ok(w.document.getElementById('mbEmpty').classList.contains('hidden'), '결과가 돌아왔는데 빈 안내가 남았다');
    });

    test('구성원(jsdom): scope=all — 루트가 기본 선택이고 본인 1행만 빼고 전원이 눌린다', async () => {
      login();
      const ms = roster(UNITS_ALL.map((u) => u.name));
      ms[0] = M('hjlee', '이현진', '책임연구원', ms[0].orgUnit, true);   // 본인도 명부에 그대로 들어 있다
      membersReply({ found: true, scope: 'all', myUnit: 'SW 3팀', units: UNITS_ALL, members: ms });
      await w.eval('openMembers()');
      assert.ok(node('기술개발총괄').classList.contains('sel'), 'all 인데 루트가 기본 선택이 아니다');
      assert.ok(node('SW 3팀').classList.contains('is-mine'), '내 소속 표시가 사라졌다');
      assert.strictEqual(rows(), 89, `전원 89명이 보이지 않는다: ${rows()}`);
      assert.strictEqual(nodes().filter((b) => b.disabled).length, 0, 'all 인데 눌리지 않는 노드가 있다');
      assert.strictEqual(linkRows().length, 88, `본인 1행을 뺀 88명이 눌려야 한다: ${linkRows().length}`);
      const mine = [...w.document.querySelectorAll('#mbList .mb-row')].find((r) => /· 나/.test(r.textContent));
      assert.ok(mine, '내 행에 「· 나」 꼬리표가 없다');
      assert.strictEqual(mine.tagName, 'DIV',
        '내 행이 버튼이다 — canViewSchedule 이 true 여도 내 캘린더로 가는 링크는 의미가 없다');
    });

    test('구성원(jsdom): 조회 실패는 호스트 사유를 그대로 — 명부를 추측해 그리지 않는다', async () => {
      login();
      membersReply({ found: true, scope: 'unit_tree', myUnit: 'SW개발본부', units: UNITS_ALL, members: roster(ALLOW_SW) });
      await w.eval('openMembers()');
      assert.strictEqual(rows(), 89, '전제: 직전 조회가 성공해 목록이 차 있다');
      reply({ ok: false, msg: '서버에 연결하지 못했습니다 — 잠시 후 다시 시도하세요.' });
      await w.eval('openMembers()');
      assert.strictEqual(rows(), 0, '실패했는데 직전(낡은) 명부가 그대로 남았다');
      assert.strictEqual(nodes().length, 0, '실패했는데 직전 조직 트리가 남았다');
      assert.ok(w.document.getElementById('mbList').textContent.includes('서버에 연결하지 못했습니다'),
        '목록 자리에 호스트가 준 사유가 없다');
      assert.ok(w.document.getElementById('mbEmpty').classList.contains('hidden'),
        '사유가 떠 있는데 「검색 결과가 없습니다」까지 겹쳤다');
    });

    test('구성원(jsdom) ㉑: 이름·조직명에 마크업이 와도 텍스트로만 들어간다', async () => {
      login();
      membersReply({
        found: true, scope: 'unit_tree', myUnit: '<i>SW 1팀</i>',
        units: [U('<i>SW 1팀</i>', null, 1)],
        members: [M('x', '<img src=x onerror=1>', '<b>연구원</b>', '<i>SW 1팀</i>', true)],
      });
      await w.eval('openMembers()');
      const tree = w.document.getElementById('mbTree');
      assert.strictEqual(tree.querySelector('i'), null, '조직명이 HTML 로 해석됐다');
      assert.ok(tree.textContent.includes('<i>SW 1팀</i>'), '조직명 원문이 그대로 보이지 않는다');
      const row = w.document.querySelector('#mbList .mb-row');
      assert.ok(row, '행이 그려지지 않았다');
      assert.strictEqual(row.querySelector('img'), null, 'img 요소가 실제로 만들어졌다');
      assert.strictEqual(row.querySelector('b > *'), null, '이름 안에 요소가 생성됐다 — HTML 로 해석됐다');
      assert.strictEqual(row.querySelector('i'), null, '소속이 HTML 로 해석됐다');
      assert.ok(row.textContent.includes('<img src=x onerror=1>'), '이름 원문이 그대로 보이지 않는다');
      assert.ok(row.textContent.includes('<i>SW 1팀</i>'), '소속 원문이 그대로 보이지 않는다');
    });

    test('구성원(jsdom): 구성원을 닫아도 #userModal 은 그대로 열려 있다(중첩)', async () => {
      login();
      membersReply({ found: true, scope: 'self', myUnit: 'SW 3팀', units: UNITS_ALL, members: roster([]) });
      w.eval('openUserInfo()');
      await w.eval('openMembers()');
      assert.ok(!w.document.getElementById('userModal').classList.contains('hidden'), '전제: 사용자 정보가 열려 있다');
      w.eval("closeModal('#membersModal')");
      assert.ok(!w.document.getElementById('userModal').classList.contains('hidden'),
        '구성원을 닫자 사용자 정보까지 닫혔다 — 겹쳐 연 모달은 자기 것만 닫아야 한다');
      assert.ok(!w.document.getElementById('userModal').classList.contains('closing'),
        '사용자 정보가 함께 닫히는 중이다(페이드아웃) — 중첩이 깨졌다');
    });

    test('구성원(jsdom) ㉒: 미로그인이면 구성원 진입점도 권한 구획과 함께 감춰진다', () => {
      w.eval('currentUser = null; updateUserUi();');
      assert.ok(w.document.getElementById('usMembersSec').classList.contains('hidden'),
        '미로그인인데 #usMembersSec 가 남았다 — 볼 범위를 정하는 권한이 없는 상태다');
      login();
      w.eval('updateUserUi();');
      assert.ok(!w.document.getElementById('usMembersSec').classList.contains('hidden'), '로그인했는데 구성원 진입점이 뜨지 않는다');
    });

    // ── 행 클릭 진입점(준비 중) ────────────────────────────────────────
    // 실제 일정 열람은 아직 없다(DB에 일정 테이블이 없다). 여기서 보는 건 '진입점의 모양'뿐이다:
    // 누를 수 있는 행 / 없는 행이 갈리는가, 눌렀을 때 딱 안내만 뜨는가.

    test('구성원(jsdom) ㉜㉝: 행은 3종이다 — 나(div·「· 나」) / 볼 수 있는 남(button.is-link) / 못 보는 남(div)', async () => {
      w.eval("currentUser = {loginId:'phmin', name:'박현민', title:'수석연구원', orgUnit:'SW 3팀'}; __usPermBusy = false;");
      const ms = [
        M('phmin', '박현민', '수석연구원', 'SW 3팀', true),      // 나 — canViewSchedule 이 true 라도 안 눌린다
        M('a5', '정민석', '책임연구원', 'SW 3팀', true),          // 볼 수 있는 남
        M('b1', '차은우', '책임연구원', '시스템 1팀', false),      // 못 보는 남 — 명부엔 있다
      ];
      membersReply({ found: true, scope: 'unit_tree', myUnit: 'SW 3팀', units: UNITS_ALL, members: ms });
      await w.eval('openMembers()');
      const list = [...w.document.querySelectorAll('#mbList .mb-row')];
      assert.strictEqual(list.length, 3, `전제: 3행이 그려져야 한다: ${list.length}`);
      const [mine, viewable, hidden] = list;
      // ① 나 — 눌리지 않고 꼬리표가 붙는다.
      assert.strictEqual(mine.tagName, 'DIV',
        '내 행이 버튼이다 — canViewSchedule 이 true 여도 이미 보고 있는 캘린더로 가는 링크는 의미가 없다');
      assert.ok(!mine.classList.contains('is-link'), '내 행에 is-link 가 붙었다');
      assert.ok(/· 나/.test(mine.textContent), '내 행에 「· 나」 꼬리표가 없다 — 왜 이 행만 안 눌리는지 알 수 없다');
      assert.ok(mine.querySelector('span.git-opt'), '「· 나」가 별도 요소가 아니다 — 맨 텍스트로 섞였다');
      // ② 볼 수 있는 남 — 진짜 버튼이다.
      assert.strictEqual(viewable.tagName, 'BUTTON', '볼 수 있는 남의 행이 <button> 이 아니다 — 키보드로 닿지 않는다');
      assert.strictEqual(viewable.getAttribute('type'), 'button', 'type="button" 이 아니다');
      assert.ok(viewable.classList.contains('is-link'), '볼 수 있는 남의 행에 is-link 가 없다');
      assert.ok(!/· 나/.test(viewable.textContent), '남의 행에 「· 나」가 붙었다');
      // ③ 못 보는 남 — 명부엔 있되 꼬리표 없이 그냥 안 눌리는 줄이다.
      assert.strictEqual(hidden.tagName, 'DIV', '일정을 볼 수 없는 남의 행이 눌린다 — 눌러도 열 것이 없다');
      assert.ok(!hidden.classList.contains('is-link'), '일정을 볼 수 없는 행에 is-link 가 붙었다');
      assert.ok(/차은우/.test(hidden.textContent), '일정을 볼 수 없는 사람이 명부에서 빠졌다 — 명부는 전원이다');
      assert.ok(!/· /.test(hidden.textContent.replace(' · 책임연구원', '')),
        '못 보는 행에 별도 꼬리표가 붙었다 — 꼬리표 자리는 「· 나」 하나뿐이다');
      assert.ok(!w.document.getElementById('mbSoon').classList.contains('hidden'),
        '누를 수 있는 행이 1개인데 「준비 중」 예고가 감춰졌다');
      assert.ok(/준비 중/.test(soonText()), `누를 행이 있는데 권한 없음 문구가 떴다: ${soonText()}`);
    });

    test('구성원(jsdom) ㉟: 행을 누르면 안내만 뜬다 — 모달 유지 · 추가 조회 0회', () => {
      // toast 는 스파이로, hostRequest 는 '부르면 세는' 함수로 갈아끼운다(추가 왕복이 있으면 잡힌다).
      w.eval('__toastCalls = []; toast = function(msg, kind){ __toastCalls.push([msg, kind]); };');
      w.eval('__hostCalls = 0; hostRequest = function(){ __hostCalls++; return Promise.resolve({ok:false}); };');
      const link = linkRows()[0];
      assert.ok(link, '전제: 누를 수 있는 행이 있다');
      link.click();
      const calls = w.eval('JSON.stringify(__toastCalls)');
      assert.strictEqual(calls, JSON.stringify([['일정 열람은 준비 중입니다', 'info']]),
        `행 클릭이 「준비 중」 안내 하나를 띄우지 않았다: ${calls}`);
      const md = w.document.getElementById('membersModal');
      assert.ok(!md.classList.contains('hidden'), '행을 눌렀더니 구성원 모달이 닫혔다 — 자리를 지켜야 한다');
      assert.ok(!md.classList.contains('closing'), '구성원 모달이 닫히는 중이다(페이드아웃)');
      assert.strictEqual(w.eval('__hostCalls'), 0,
        '행 클릭이 호스트에 추가 조회를 보냈다 — 그 사람 데이터를 더 가져올 이유가 없다(열람은 5단계)');
    });

    // ── 소속 미등록(org_unit NULL) ────────────────────────────────────
    // 예전엔 여기가 막다른 화면이었다(트리 12노드 전부 회색 → 통째로 접힘, 목록 0행, 「검색 결과가 없습니다」).
    // 이제 명부·트리가 범위와 무관하므로 화면은 self 와 같다: 전부 보이고, 누를 행만 0개다.
    test('구성원(jsdom) ㊴㊵㊶: 소속 미등록도 막다른 화면이 아니다 — 트리·명부 그대로, 누를 행만 0개', async () => {
      login();
      membersReply({ found: true, scope: 'unit_tree', myUnit: '', units: UNITS_ALL, members: roster([]) });
      await w.eval('openMembers()');
      assert.ok(!w.document.getElementById('mbTree').classList.contains('hidden'),
        '소속이 없다고 트리를 접었다 — 조직도는 소속과 무관하게 볼 수 있어야 한다');
      assert.strictEqual(nodes().length, 12, `트리 12노드가 그려지지 않았다: ${nodes().length}`);
      assert.strictEqual(nodes().filter((b) => b.disabled).length, 0, '눌리지 않는 노드가 있다');
      assert.strictEqual(nodes().filter((b) => b.classList.contains('is-mine')).length, 0,
        '소속이 없는데 「· 내 소속」이 붙은 노드가 있다');
      assert.strictEqual(rows(), 89, `명부 전원 89행이 아니다: ${rows()}`);
      assert.strictEqual(linkRows().length, 0, '일정 열람 가능 유닛이 없는데 눌리는 행이 있다');
      assert.strictEqual(soonText(), '명부만 볼 수 있습니다 — 일정 열람 권한이 없습니다',
        `왜 아무도 못 누르는지 말하지 않는다: ${soonText()}`);
      assert.ok(w.document.getElementById('mbEmpty').classList.contains('hidden'), '89행인데 빈 안내가 떴다');
      assert.ok(/^일정 열람 범위: 소속 조직/.test(txt('mbScope')), `범위 줄이 다르다: ${txt('mbScope')}`);
      assert.ok(!/볼 수 있는 조직 없음/.test(txt('mbScope')),
        `옛 「볼 수 있는 조직 없음」이 남았다 — 이제 그런 상태가 아니다: ${txt('mbScope')}`);
    });

    test('구성원(jsdom) ㊵: 조직은 골랐는데 0명이면 「빈 조직」이라고 말하고 예고 줄은 감춘다', async () => {
      login();
      const ms = roster(UNITS_ALL.map((u) => u.name)).filter((m) => m.orgUnit !== '경영지원팀');
      membersReply({ found: true, scope: 'all', myUnit: 'SW개발본부', units: UNITS_ALL, members: ms });
      await w.eval('openMembers()');
      w.eval("mbSelect('경영지원팀')");
      assert.strictEqual(rows(), 0, '전제: 빈 조직을 골랐다');
      assert.strictEqual(w.document.getElementById('mbEmpty').textContent, '이 조직에 등록된 구성원이 없습니다.',
        `빈 조직 안내가 바뀌었다: ${w.document.getElementById('mbEmpty').textContent}`);
      assert.ok(!/검색/.test(w.document.getElementById('mbEmpty').textContent),
        '검색한 적이 없는데 「검색 결과가 없습니다」라고 말한다 — 사용자가 원인을 자기 조작에서 찾게 된다');
      assert.ok(w.document.getElementById('mbSoon').classList.contains('hidden'),
        '목록이 0행인데 예고 줄이 남았다 — 안내할 대상이 없다');
      assert.ok(/경영지원팀 0명/.test(txt('mbScope')), `인원 수를 그대로 말하지 않는다: ${txt('mbScope')}`);
    });

    // 부팅에서 걸린 타이머(세션 조회 타임아웃·스켈레톤 폴백)가 러너를 붙잡지 않도록 창을 닫는다.
    test('사용자정보(jsdom): 창 정리', () => { w.close(); });
  }
}
