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

// 사용자 정보 모달 마크업 — #userModal 부터 그 다음 모달(사용설명서) 직전까지.
function userModalMarkup(source) {
  const s = source.indexOf('<div class="overlay hidden" id="userModal">');
  assert.ok(s >= 0, '#userModal 마크업을 찾지 못함(.overlay 여야 한다)');
  const e = source.indexOf('<!-- ===== 자세한 사용설명서', s);
  assert.ok(e > s, '#userModal 뒤의 사용설명서 모달을 찾지 못함');
  return source.slice(s, e);
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
  const bad = mutate(src, ", viewer:'열람자 — 조회만 가능' }", ' }');
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

    // 부팅에서 걸린 타이머(세션 조회 타임아웃·스켈레톤 폴백)가 러너를 붙잡지 않도록 창을 닫는다.
    test('사용자정보(jsdom): 창 정리', () => { w.close(); });
  }
}
