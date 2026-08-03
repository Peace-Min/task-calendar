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

  // ㉕ IN 절은 자리표시자(@u0,@u1,…)로만 만든다 — 유닛 이름도 DB 문자열이라 SQL 에 이어 붙이면 주입 표면이 된다.
  membersInClauseBound(csDb) {
    const q = csMember(csDb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)');
    assert.ok(/IN \(/.test(q), '전제: 명부 조회에 IN 절이 없다');
    assert.ok(/ph\.Add\("@u"/.test(q),
      'IN 절 자리표시자(@u0,@u1,…)를 만들지 않는다 — 유닛 이름이 SQL 문자열로 그대로 들어간다');
    assert.ok(/string\.Join\(",", ph\)/.test(q), 'IN 절을 자리표시자 목록으로 잇지 않는다');
    assert.ok(/AddWithValue\(ph\[i\], unitNames\[i\]\)/.test(q), '자리표시자에 값을 바인딩하지 않는다');
    assert.ok(!/"'" \+/.test(q) && !/\+ "'"/.test(q),
      'SQL 에 작은따옴표로 값을 감싸 이어 붙인다 — 전형적인 주입 형태다');
    // 빈 IN 절은 문법 오류이기도 하다. 허용 집합이 비면 쿼리를 아예 돌리지 않는다.
    assert.ok(/else if \(allowed\.Count > 0\)/.test(q), '허용 집합이 비어도 명부 쿼리를 돌린다');
  },

  // ㉖ scope='self' 는 본인 1행만. '전체를 읽어 화면에서 거르기'로 바꾸면 payload 에 남의 명부가 그대로 실린다
  //    (개발자도구 한 번이면 다 보인다 — 화면 필터는 방어가 아니다).
  membersSelfOnly(csDb) {
    const q = csMember(csDb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)');
    const m = /switch \(scope\)\s*\{([\s\S]*?)\n\s*\}/.exec(q);
    assert.ok(m, '허용 유닛 집합을 정하는 switch (scope) 를 찾지 못함');
    const sw = m[1];
    assert.ok(/case "all":/.test(sw) && /case "unit_tree":/.test(sw), '전제: all·unit_tree 분기가 없다');
    assert.ok(!/"self"/.test(sw),
      'self 가 허용 유닛 집합을 받는다 — self 는 빈 집합이어야 본인 1행만 나간다');
    assert.ok(/default:\s*break;/.test(sw), 'default(self·알 수 없는 값)가 빈 집합으로 떨어지지 않는다');
    const s = q.indexOf('if (isSelf)');
    assert.ok(s >= 0, 'self 분기(if (isSelf))가 없다');
    const e = q.indexOf('else if', s);
    assert.ok(e > s, 'self 분기 뒤의 else if 를 찾지 못함');
    const selfBranch = q.slice(s, e);
    assert.ok(/\["loginId"\]\s*=\s*id/.test(selfBranch), 'self 분기가 본인 행을 담지 않는다');
    assert.ok(!/ExecuteReader/.test(selfBranch), 'self 분기에서 명부 쿼리를 돈다 — 본인 1행만이어야 한다');
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

  // ㉙ 범위 밖 노드는 '보이되 눌리지 않는다'. 숨기면 내 위에 무엇이 있는지조차 알 수 없고,
  //    조직도 자체는 사내망에 이미 공개된 정보라 감출 이유가 없다.
  membersOutOfScopeDisabled(source) {
    const b = jsBody(source, 'renderUnitTree');
    assert.ok(/b\.disabled = true/.test(b), 'allowed:false 노드를 disabled 로 만들지 않는다');
    assert.ok(/열람 범위 밖입니다/.test(b), '왜 안 눌리는지 title 로 알려주지 않는다');
    assert.ok(!/if\(!\(u && u\.allowed\)\)\s*continue/.test(b) && !/filter\(u => u\.allowed\)/.test(b),
      '범위 밖 노드를 아예 그리지 않는다 — 숨기지 말고 disabled 로 두는 것이 요구사항이다');
    // disabled 만 믿지 않는다 — 프로그램 호출로 우회되면 범위 밖 조직이 선택된다.
    const s = jsBody(source, 'mbSelect');
    assert.ok(/!u\.allowed/.test(s), 'mbSelect 가 allowed 를 확인하지 않는다');
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

  // ㉓ 일정 관련 UI는 5단계 자리다. 그리고 행은 '누를 수 있는 것처럼' 보이면 안 된다 — 열 것이 없다.
  membersNoScheduleUi(source) {
    const md = membersModalMarkup(source);
    const b = jsBody(source, 'renderMembers');
    for (const w of ['일정', '캘린더', '스케줄']) {
      assert.ok(!md.includes(w), `구성원 모달에 「${w}」 UI 가 들어왔다 — 타인 일정 열람은 5단계다(빈 약속 금지)`);
      assert.ok(!b.includes(w), `renderMembers 가 「${w}」 를 그린다 — 행은 아직 이름·직급·소속뿐이다`);
    }
    const css = source.slice(source.indexOf('<style>'), source.indexOf('</style>'));
    assert.ok(!/cursor:pointer/.test(cssRule(source, '.mb-row')),
      '.mb-row 에 cursor:pointer 가 붙었다 — 눌러도 아무 일도 일어나지 않는 행이 된다');
    assert.ok(!/\.mb-row:hover/.test(css),
      '.mb-row:hover 강조가 생겼다 — 클릭 가능한 것처럼 보인다(열 것이 아직 없다)');
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
test('구성원 ㉓: 행에 일정·캘린더·스케줄 UI 가 없고 클릭 가능해 보이지 않는다', () => checks.membersNoScheduleUi(src));
test('구성원 ㉔: 호스트 membersGet 은 읽기 경로다(OpenWriteAsync 금지)', () => checks.membersHostReadPath(main, pdb));
test('구성원 ㉕: 명부 IN 절은 파라미터 바인딩이다(유닛 이름 문자열 연결 금지)', () => checks.membersInClauseBound(pdb));
test('구성원 ㉖: scope=self 는 본인 1행만 담는다(전체 조회 금지)', () => checks.membersSelfOnly(pdb));
test('구성원 ㉗: unit_tree 확장은 반복 + 방문 집합 가드다(재귀 CTE 금지)', () => checks.membersTreeExpansion(pdb));
test('구성원 ㉘: renderUnitTree·renderMembers·mbFail 이 DOM API 로만 그린다', () => checks.membersTreeNoHtmlInjection(src));
test('구성원 ㉙: 범위 밖 노드는 숨기지 않고 disabled 로 그린다', () => checks.membersOutOfScopeDisabled(src));
test('구성원 ㉚: openMembers 는 열 때마다 membersGet 을 다시 부른다(캐시 금지)', () => checks.membersRefetchOnOpen(src));
test('구성원 ㉛: .mb-split 은 2열 그리드다(좌 트리 · 우 목록)', () => checks.membersSplitTwoCols(src));

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
  const bad = mutate(src, "    set('usOrg', currentUser.orgUnit || '');",
                          "    document.getElementById('usOrg').innerHTML = currentUser.orgUnit || '';");
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

test('변이㉓: 구성원 모달에 일정 UI 를 넣으면 membersNoScheduleUi 가 실패한다', () => {
  const bad = mutate(src, '      <div id="mbList"></div>',
                          '      <div id="mbList"></div>\n      <button type="button" class="btn sm" id="mbSchedule">일정 보기</button>');
  assert.throws(() => checks.membersNoScheduleUi(bad), /「일정」 UI 가 들어왔다/);
});

test('변이㉓-b: .mb-row 에 cursor:pointer 를 주면 membersNoScheduleUi 가 실패한다', () => {
  const bad = mutate(src, '.mb-row{padding:8px 2px;', '.mb-row{cursor:pointer;padding:8px 2px;');
  assert.throws(() => checks.membersNoScheduleUi(bad), /cursor:pointer 가 붙었다/);
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

test('변이㉕: IN 절 자리표시자를 유닛 이름 문자열 연결로 바꾸면 membersInClauseBound 가 실패한다', () => {
  const bad = mutateInMember(pdb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)',
    'ph.Add("@u" + i.ToString(CultureInfo.InvariantCulture));', 'ph.Add("\'" + unitNames[i] + "\'");');
  assert.throws(() => checks.membersInClauseBound(bad), /자리표시자.*만들지 않는다/);
});

test('변이㉖: self 를 unit_tree 와 같은 case 로 묶으면 membersSelfOnly 가 실패한다', () => {
  const bad = mutateInMember(pdb, 'public async Task<string?> LoadMembersJsonAsync(string loginId)',
    '                    case "unit_tree":', '                    case "self":\n                    case "unit_tree":');
  assert.throws(() => checks.membersSelfOnly(bad), /self 가 허용 유닛 집합을 받는다/);
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

test('변이㉙: 범위 밖 노드를 숨기면 membersOutOfScopeDisabled 가 실패한다', () => {
  const bad = mutate(src, "      if(!(u && u.allowed)){ b.disabled = true; b.title = '열람 범위 밖입니다'; }",
                          '      if(!(u && u.allowed)) continue;');
  assert.throws(() => checks.membersOutOfScopeDisabled(bad), /disabled 로 만들지 않는다/);
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
    // 실제 org_unit(12행 3계층)·app_user 를 그대로 본뜬 표본을 hostRequest 회신으로 먹인다.
    // ★ payload 의 members 에는 '범위 안 사람만' 들어 있다 — 호스트가 이미 잘랐기 때문이다.
    //   그러니 화면 필터를 검증하는 게 아니라 '트리 선택 → 서브트리 집계'를 검증하는 것이다.
    const rows = () => w.document.querySelectorAll('#mbList .mb-row').length;
    const nodes = () => [...w.document.querySelectorAll('#mbTree .mb-node')];
    const node = (name) => nodes().find((b) => b.dataset.unit === name);

    const U = (name, parent, sortOrder, allowed) => ({ name, parent, sortOrder, allowed });
    const UNITS_SW = [
      U('기술개발총괄', null, 10, false),
      U('SW개발본부', '기술개발총괄', 20, true),
      U('SW 1팀', 'SW개발본부', 21, true),
      U('SW 2팀', 'SW개발본부', 22, true),
      U('SW 3팀', 'SW개발본부', 23, true),
      U('SW 4팀', 'SW개발본부', 24, true),
      U('디자인팀', 'SW개발본부', 25, true),
      U('시스템개발본부', '기술개발총괄', 30, false),
      U('시스템 1팀', '시스템개발본부', 31, false),
      U('시스템 2팀', '시스템개발본부', 32, false),
      U('사업부', '기술개발총괄', 40, false),
      U('경영지원팀', '기술개발총괄', 50, false),
    ];
    const M = (loginId, name, title, orgUnit) => ({ loginId, name, title, orgUnit });
    const MEMBERS_SW = [
      M('a1', '김서연', '수석연구원', 'SW개발본부'),
      M('a2', '박도현', '책임연구원', 'SW 1팀'),
      M('a3', '이지훈', '선임연구원', 'SW 1팀'),
      M('a4', '최유진', '연구원', 'SW 2팀'),
      M('a5', '정민석', '책임연구원', 'SW 3팀'),
      M('a6', '한소영', '선임연구원', 'SW 3팀'),
      M('a7', '오세훈', '연구원', 'SW 4팀'),
      M('a8', '윤가람', '선임연구원', '디자인팀'),
    ];
    const membersReply = (data) => reply({ ok: true, data });

    test('구성원(jsdom): unit_tree — 트리 12노드 · 범위 밖은 disabled · 내 소속이 기본 선택', async () => {
      login();
      membersReply({ found: true, scope: 'unit_tree', myUnit: 'SW개발본부', units: UNITS_SW, members: MEMBERS_SW });
      await w.eval('openMembers()');
      assert.ok(!w.document.getElementById('membersModal').classList.contains('hidden'), '구성원 모달이 열리지 않았다');
      assert.strictEqual(nodes().length, 12, `조직 트리가 12노드로 그려지지 않았다: ${nodes().length}`);
      // 구조는 전부 보이되 범위 밖은 눌리지 않는다.
      assert.ok(node('기술개발총괄').disabled, '범위 밖(기술개발총괄)이 disabled 가 아니다');
      assert.strictEqual(node('기술개발총괄').title, '열람 범위 밖입니다', 'disabled 이유가 title 에 없다');
      assert.ok(node('시스템 1팀').disabled, '범위 밖(시스템 1팀)이 disabled 가 아니다');
      assert.ok(!node('SW 3팀').disabled, '범위 안(SW 3팀)이 눌리지 않는다');
      // 기본 선택 = 내가 누를 수 있는 가장 위 노드 = 내 소속.
      assert.ok(node('SW개발본부').classList.contains('sel'), '내 소속이 기본 선택이 아니다');
      assert.strictEqual(node('SW개발본부').getAttribute('aria-current'), 'true', '선택 노드에 aria-current 가 없다');
      assert.ok(node('SW개발본부').classList.contains('is-mine'), '내 소속에 .is-mine 이 없다');
      assert.ok(/· 내 소속/.test(node('SW개발본부').textContent), '「· 내 소속」 꼬리표가 없다');
      assert.ok(node('SW개발본부').querySelector('span.git-opt'), '꼬리표가 별도 요소가 아니다 — 맨 텍스트로 섞였다');
      // 선택의 의미는 '그 노드 + 모든 하위' — 본부를 고르면 산하 전원이다.
      assert.strictEqual(rows(), 8, `SW개발본부 서브트리 8명이 그려지지 않았다: ${rows()}`);
      assert.ok(/소속 조직/.test(txt('mbScope')), `범위 줄에 권한 문구가 없다: ${txt('mbScope')}`);
      assert.ok(/SW개발본부 8명/.test(txt('mbScope')), `범위 줄에 선택 조직·인원이 없다: ${txt('mbScope')}`);
      assert.ok(w.document.getElementById('mbEmpty').classList.contains('hidden'), '결과가 있는데 빈 안내가 떠 있다');
      assert.ok(!w.document.getElementById('mbTree').classList.contains('hidden'), 'unit_tree 인데 트리가 감춰졌다');
    });

    test('구성원(jsdom): 하위 조직을 고르면 그 서브트리로 좁혀진다 · 범위 밖 노드는 눌러도 그대로', () => {
      node('SW 3팀').click();
      assert.strictEqual(rows(), 2, `SW 3팀 2명으로 좁혀지지 않았다: ${rows()}`);
      assert.ok(node('SW 3팀').classList.contains('sel'), '선택 표시가 옮겨오지 않았다');
      assert.ok(!node('SW개발본부').classList.contains('sel'), '이전 선택이 남아 있다 — 선택이 둘로 보인다');
      assert.strictEqual(node('SW개발본부').getAttribute('aria-current'), null, '이전 선택의 aria-current 가 남았다');
      assert.ok(/SW 3팀 2명/.test(txt('mbScope')), `범위 줄이 따라오지 않았다: ${txt('mbScope')}`);
      // 범위 밖 노드 — 눌러도 아무 일도 일어나지 않는다.
      node('기술개발총괄').click();
      w.eval("mbSelect('기술개발총괄')");   // disabled 를 우회해 직접 불러도 마찬가지여야 한다
      assert.strictEqual(rows(), 2, '범위 밖 노드를 눌렀는데 목록이 바뀌었다');
      assert.ok(node('SW 3팀').classList.contains('sel'), '범위 밖 노드가 선택을 가져갔다');
    });

    test('구성원(jsdom): 검색은 현재 서브트리 안에서만 — 0건이면 빈 안내', () => {
      w.eval("mbSelect('SW개발본부')");
      assert.strictEqual(rows(), 8, '전제: 본부 서브트리 8명');
      w.eval("document.getElementById('mbSearch').value = 'SW 1'; filterMembers();");
      assert.strictEqual(rows(), 2, `소속 부분일치가 안 된다: ${rows()}`);
      w.eval("document.getElementById('mbSearch').value = '없는이름'; filterMembers();");
      assert.strictEqual(rows(), 0, '결과가 0건이 아니다');
      assert.ok(!w.document.getElementById('mbEmpty').classList.contains('hidden'), '0건인데 「검색 결과가 없습니다」가 뜨지 않는다');
      // 서브트리 밖(범위 밖 조직)은 검색으로도 끌려 나오지 않는다 — 애초에 payload 에 없다.
      w.eval("document.getElementById('mbSearch').value = '시스템'; filterMembers();");
      assert.strictEqual(rows(), 0, '범위 밖 조직 인원이 검색으로 노출됐다');
      w.eval("mbSelect('SW 3팀'); document.getElementById('mbSearch').value = '한소영'; filterMembers();");
      assert.strictEqual(rows(), 1, '선택 조직 안 이름 검색이 안 된다');
      w.eval("document.getElementById('mbSearch').value = ''; filterMembers();");
      assert.strictEqual(rows(), 2, '검색어를 지우면 선택 조직 전체로 돌아와야 한다');
      assert.ok(w.document.getElementById('mbEmpty').classList.contains('hidden'), '결과가 돌아왔는데 빈 안내가 남았다');
    });

    test('구성원(jsdom): scope=all 이면 루트(기술개발총괄)가 기본 선택이고 전원이 보인다', async () => {
      login();
      const all = UNITS_SW.map((u) => ({ ...u, allowed: true }));
      const more = MEMBERS_SW.concat([M('b1', '차은우', '책임연구원', '시스템 1팀'), M('b2', '남도일', '연구원', '경영지원팀')]);
      membersReply({ found: true, scope: 'all', myUnit: 'SW 3팀', units: all, members: more });
      await w.eval('openMembers()');
      assert.ok(node('기술개발총괄').classList.contains('sel'), 'all 인데 루트가 기본 선택이 아니다');
      assert.ok(node('SW 3팀').classList.contains('is-mine'), '내 소속 표시가 사라졌다');
      assert.strictEqual(rows(), 10, `전원 10명이 보이지 않는다: ${rows()}`);
      assert.strictEqual(nodes().filter((b) => b.disabled).length, 0, 'all 인데 눌리지 않는 노드가 있다');
    });

    test('구성원(jsdom): scope=self 면 트리를 접고 본인 1행만 보여준다', async () => {
      login();
      membersReply({ found: true, scope: 'self', myUnit: 'SW 3팀', units: [], members: [M('hjlee', '이현진', '책임연구원', 'SW 3팀')] });
      await w.eval('openMembers()');
      assert.ok(w.document.getElementById('mbTree').classList.contains('hidden'),
        'self 인데 트리 칸이 남아 있다 — 그릴 노드가 없다');
      assert.strictEqual(w.document.querySelector('.mb-split').style.gridTemplateColumns, '1fr',
        'self 인데 2열 정의가 남아 목록이 좁은 첫 칸으로 끌려간다');
      assert.strictEqual(rows(), 1, '본인 1행이 아니다');
      assert.strictEqual(txt('mbScope'), '열람 범위: 본인만 · 1명', `범위 줄이 다르다: ${txt('mbScope')}`);
    });

    test('구성원(jsdom): 조회 실패는 호스트 사유를 그대로 — 명부를 추측해 그리지 않는다', async () => {
      login();
      membersReply({ found: true, scope: 'unit_tree', myUnit: 'SW개발본부', units: UNITS_SW, members: MEMBERS_SW });
      await w.eval('openMembers()');
      assert.strictEqual(rows(), 8, '전제: 직전 조회가 성공해 목록이 차 있다');
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
        units: [U('<i>SW 1팀</i>', null, 1, true)],
        members: [M('x', '<img src=x onerror=1>', '<b>연구원</b>', '<i>SW 1팀</i>')],
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
      membersReply({ found: true, scope: 'self', myUnit: 'SW 3팀', units: [], members: [M('hjlee', '이현진', '책임연구원', 'SW 3팀')] });
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

    // 부팅에서 걸린 타이머(세션 조회 타임아웃·스켈레톤 폴백)가 러너를 붙잡지 않도록 창을 닫는다.
    test('사용자정보(jsdom): 창 정리', () => { w.close(); });
  }
}
