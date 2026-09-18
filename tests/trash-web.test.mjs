// 휴지통 — 화면 계약(docs/TRASH-DELETE.md §8 ⑥⑦)
//
// 이 파일이 존재하는 이유:
//   휴지통은 이 앱에서 **되돌릴 수 없는** 유일한 조작이다(복구 수단은 DB 백업뿐 · 설계 §7).
//   그래서 화면에 지켜야 할 것이 둘이다:
//     ⑥ 관리자가 아닌 사람의 DOM 에는 휴지통이 **아예 없다** — 진입 문(#uaTrash)도, 탭도, 행도.
//        숨김이 아니라 부재여야 한다: 숨김은 클래스 하나로 풀리고, 그러면 화면이 권한을 정하는
//        모양이 된다. 권한은 호스트가 요청 시점에 판정한다(ProjectDb.OpenAdminAsync).
//        ★ 그 문은 **둘**이고 둘 다 그 도메인의 화면에 있다(2026-09-18 사용자 결정):
//          ㆍ과제·발주처·구분·상태 → 「공식 과제 (DB)」 하단 줄의 #offTrash(위젯에서만 보인다 · 정적 마크업).
//          ㆍ퇴사자 → 「구성원 편집」 상단 막대의 #uaTrash(관리자·비순서편집일 때만 만들어진다).
//          ㆍ「사용자 정보」에는 휴지통이 **없다** — 그 줄에 있을 때 바로 위 구성원 안내문에 딸린 것처럼
//            읽혀 「퇴사자 휴지통」으로 오해됐다(TRASH-DELETE §11-32).
//     ⑦ 이름을 **글자까지 그대로** 입력해야 [영구 삭제]가 켜진다 — trim 도, 대소문자 접기도 없다.
//        느슨해지면 호스트의 대조(§3.4)와 기준이 갈리고, 화면만 통과시키는 길이 생긴다.
//
//   ★ 소스 문자열 검사만으로는 ⑥ 을 증명할 수 없다. 그리는 코드는 어차피 파일 안에 있고, 문제는
//     '그 코드가 언제 도는가'다. 그래서 실제로 그려 보고 DOM 을 센다(user-admin.test.mjs ⑦-DOM 과 같은 방식).
//   ★ 앱 전체를 부팅하지 않는다 — 그리는 함수만 떼어 내 빈 문서에 심는다. 부팅하면 호스트 브리지·
//     세션·타이머가 딸려 와 이 계약과 무관한 이유로 깨진다.
//   ★ 검사와 변이가 **같은 함수**를 쓴다. 변이로 안 깨지는 검사는 장식이다.
import { test, assert, loadAppSource, extractFunction, importOptional, useJsdom, runInJsdom, SKIP_NO_JSDOM } from './harness.mjs';

const app = loadAppSource();

function mutate(base, from, to) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

// 마크업 오려내기 — 못 오려 내면 '판정 불가'로 죽는다(통과가 아니다).
//   ★ 주석은 지운다: "왜 [영구 삭제] 를 마크업에 적지 않는가"를 **적어 둔 문장**이 계약을 깨뜨리면 안 된다.
function sliceMarkup(web, startMark, endMark, label) {
  const s = web.indexOf(startMark);
  assert.ok(s >= 0, `${label} 마크업을 찾지 못함(${startMark})`);
  const e = web.indexOf(endMark, s);
  assert.ok(e > s, `${label} 뒤의 경계(${endMark})를 찾지 못했다 — 판정 불가`);
  return web.slice(s, e);
}
const trashModalMarkup = (web) =>
  sliceMarkup(web, '<div class="overlay hidden" id="trashModal">', '<!-- ===== 자세한 사용설명서', '#trashModal')
    .replace(/<!--[\s\S]*?-->/g, '');
const confirmTypedMarkupRaw = (web) =>
  sliceMarkup(web, '<div class="overlay hidden" id="confirmTypedModal">', '<div id="toastWrap">', '#confirmTypedModal');

//  ★ async 함수는 extractFunction 이 'function 이름(' 부터 오려 내므로 **async 가 떨어진다** — 그대로
//    jsdom 에서 eval 하면 "await is only valid in async functions" 로 죽는다(2026-09-14, 쓰기가 왕복이 된 뒤).
//    선언을 보고 다시 붙인다: 붙였는지 아닌지를 **원본이** 정하므로, 변이가 async 를 떼면 그대로 따라간다.
function extractFn(web, name) {
  const isAsync = new RegExp('async\\s+function\\s+' + name + '\\s*\\(').test(web);
  return (isAsync ? 'async ' : '') + extractFunction(web, name);
}

//  trSetSaving 의 **마지막 줄** — 워치독을 되살려 보거나 '잠금을 렌더로 반영하던' 옛 판으로 되돌려 보는
//  변이가 끼어드는 자리다(2026-09-14 부터 잠금은 다시 그리지 않고 그 자리에서 건다: trSyncControls).
//   ★ 되살린 워치독은 **함수 안쪽**에 둔다 — 닫는 중괄호 바깥에 두면 extractFunction 이 떼어 오는 범위에
//     들어오지 않아 변이가 아무것도 바꾸지 못한다(초록이 그냥 뜬다).
const TR_LOCK_TAIL = '  trSyncControls();\n}';
const TR_LOCK_WATCHDOG = '  trSyncControls();\n  if(on) setTimeout(() => trSetSaving(false), 12000);\n}';
//  trSend 안의 **좌석 한 줄** — uaSend 에 글자가 똑같은 줄이 하나 더 있으므로(두 화면이 같은 문을 쓴다)
//  뒤따르는 주석 머리까지 묶어 그 한 곳만 가리킨다. String.replace 는 첫 일치만 바꾼다.
const TR_SEAT_IN_SEND = '  uaSeatReply(rep.roster, cmd);\n  return rep;\n}\n// 휴지통 목록의 컨트롤';

// 한 줄짜리 const 선언을 원본에서 그대로 떼어 낸다(사본은 반드시 낡는다).
function constLine(web, name) {
  const m = new RegExp('^const ' + name + ' = .*$', 'm').exec(web);
  assert.ok(m, `const ${name} 선언을 찾지 못했다 — 판정 불가`);
  return m[0];
}
// 여러 줄 블록(TR_TABS 배열) — 시작 표식부터 닫는 '];' 까지.
function constBlock(web, startMark) {
  const s = web.indexOf(startMark);
  assert.ok(s >= 0, `${startMark} 를 찾지 못했다 — 판정 불가`);
  const e = web.indexOf('\n];', s);
  assert.ok(e > s, `${startMark} 의 닫는 '];' 를 찾지 못했다 — 판정 불가`);
  return web.slice(s, e + 3);
}

// ══════════════════════════════════════════════════════════════════════
//  계약 — 형태(소스·마크업)로 보는 것들
// ══════════════════════════════════════════════════════════════════════

const checks = {
  // ⑥-a 휴지통 마크업은 **빈 자리**뿐이다 — 탭도 버튼도 admin:true 회신 뒤에만 생긴다.
  trashMarkupHasNoControls(web) {
    const md = trashModalMarkup(web);
    assert.ok(/<div class="modal wide">/.test(md), '#trashModal 이 .modal.wide 가 아니다 — 탭 줄과 행의 [복구][영구 삭제] 둘이 좁은 모달에 들어가지 않는다');
    assert.ok(/<div id="trTabs"><\/div>/.test(md),
      '#trTabs 가 비어 있지 않다 — 탭을 마크업에 적으면 admin:false 회신에도 DOM 에 남는다(숨김 ≠ 부재)');
    assert.ok(/<div id="trList"><\/div>/.test(md),
      '#trList 가 비어 있지 않다 — 행을 마크업에 적으면 비관리자에게도 남는다');
    assert.ok(/id="trScope"/.test(md), '#trScope(부제 자리)가 없다');
    assert.ok(/id="trEmpty"/.test(md), '#trEmpty(빈 탭 안내 자리)가 없다');
    assert.ok(/data-close>닫기<\/button>/.test(md), '하단에 [닫기]가 없다 — 휴지통을 빠져나갈 길이 사라진다');
    assert.ok(!/btn primary/.test(md),
      '#trashModal 에 primary 버튼이 있다 — 휴지통이 권하는 일은 없다(설계 §5.1)');
    for (const dead of ['영구 삭제', '복구', 'data-trtab', 'data-top']) {
      assert.ok(!md.includes(dead),
        `휴지통 마크업에 컨트롤(${dead})이 들어왔다 — 관리자 회신 없이는 DOM 에 없어야 한다(설계 §5.1)`);
    }
  },

  // ⑥-b 휴지통으로 들어가는 문은 **둘**이고, 둘 다 그 도메인의 화면에 있다(2026-09-18 사용자 결정).
  //   ㆍ과제·발주처·구분·상태 → 「공식 과제 (DB)」 하단 줄의 #offTrash — **숨기는 곳이 곧 되돌리는 곳**이다.
  //     이 하나는 정적 마크업이다(＋발주처 관리와 **같은 규칙**): 노출은 위젯 여부가 정하고, 관리자 여부는
  //     열 때 호스트 회신이 정해 안내 한 줄만 그린다. 그래서 숨김이어도 잃을 것이 없다 — 이 버튼 자체는
  //     권한을 가리키지 않는다(권한을 가리키는 것은 탭·행·[영구 삭제] 이고 그것들은 여전히 부재다).
  //   ㆍ퇴사자 → 「구성원 편집」 상단 막대의 #uaTrash — 관리자에게만, 그리고 순서 편집이 아닐 때만 **생긴다**.
  //   ㆍ「사용자 정보」에는 휴지통이 **없다**. 그 줄에 있을 때 바로 위 구성원 안내문에 딸린 것처럼 읽혀
  //     「퇴사자 휴지통」으로 오해됐고(TRASH-DELETE §11-32), 이제 그 이름의 문은 실제로 구성원 쪽에만 있다.
  trashEntryDoorsAreDomainScreens(web) {
    // ── ① 「사용자 정보」에는 없다(만드는 코드에도, 마크업에도)
    //  ★ 2026-09-18 사용자 결정으로 「구성원 편집」 버튼은 #usMemberBtns 줄에 상주하는 정적 공개 문이 됐고,
    //    그 「관리」 줄을 짓던 usAdminBtnSync 는 사라졌다(USER-ADMIN §11-38). 그래서 볼 것은 둘이다 —
    //    그 함수가 되살아나지 않았는가, 그리고 「사용자 정보」 마크업에 「휴지통」이 없는가.
    assert.ok(!/usAdminBtnSync/.test(web),
      'usAdminBtnSync 가 되살아났다 — 「사용자 정보」의 관리 줄을 JS 가 다시 지으면 휴지통도 그 줄로 돌아온다(USER-ADMIN §11-38)');
    const um = sliceMarkup(web, '<div class="overlay hidden" id="userModal">',
      '<div class="overlay hidden" id="membersModal">', '#userModal').replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!/휴지통/.test(um),
      '「사용자 정보」 마크업에 「휴지통」이 들어왔다 — 그 자리는 구성원 안내문에 딸려 읽힌다(§11-32). 휴지통은 그 도메인의 화면이 연다(#offTrash · #uaTrash)');

    // ── ② 과제 쪽 문 — 「공식 과제 (DB)」 하단 줄의 #offTrash(정적 · 위젯에서만 보인다 · 도구줄은 600px 에서 이미 꽉 차 두 줄로 접힌다)
    assert.ok(web.includes('<button type="button" class="btn" id="offTrash" style="display:none"'),
      '#offTrash 가 공식 과제 하단 줄의 정적 .btn 버튼이 아니다(또는 처음부터 보인 채로 선다) — 발주처 관리와 같은 규칙이어야 한다');
    const ex = extractFunction(web, 'offSyncExportBtn');
    assert.ok(/getElementById\('offTrash'\)/.test(ex),
      "offSyncExportBtn 이 #offTrash 의 노출을 동기화하지 않는다 — 브라우저에서 열어도 위젯 전용 문이 서 있게 된다");
    assert.ok(/HOST \? '' : 'none'/.test(ex),
      '#offTrash 의 노출 규칙이 위젯 여부(HOST)가 아니다 — ＋발주처 관리와 같은 한 규칙이어야 한다');
    const bind = extractFunction(web, 'bind');
    assert.ok(/\$\('#offTrash'\)/.test(bind), '#offTrash 가 배선되지 않았다 — 눌러도 아무 일이 없다');
    assert.ok(/offEditGuard\(\(\) => openTrash\('project'\)\)/.test(bind),
      "#offTrash 가 같은 관문(offEditGuard: 위젯·온라인)을 지나 openTrash('project') 를 열지 않는다 — 과제 쪽 조작과 다른 길이 생긴다");

    // ── ③ 인력 쪽 문 — 「구성원 편집」 상단 막대의 #uaTrash(관리자에게만 **생긴다**)
    assert.ok(!/id="uaTrash"/.test(web),
      '「퇴사자 휴지통」 버튼이 마크업에 있다 — 비관리자 DOM 에 남는다(숨김 ≠ 부재). uaAdminBar 가 만들어야 한다');
    const bar = extractFunction(web, 'uaAdminBar');
    assert.ok(/mk\('퇴사자 휴지통', 'uaTrash'/.test(bar),
      'uaAdminBar 가 「퇴사자 휴지통」을 만들지 않는다 — 퇴사자의 복구·영구 삭제로 가는 문이 사라진다');
    assert.ok(/openTrash\('user'\)/.test(bar),
      "uaAdminBar 가 만든 버튼이 openTrash('user') 에 묶이지 않는다 — 들어간 문이 보이는 탭을 정하는데 그 문이 자기 이름을 말하지 않는다");
    //  ★ **어디에서** 만드는가가 계약이다: 비관리자 조기 return 뒤 · 순서 편집 return 뒤.
    //    앞에 두면 숨김이 아니라 부재여야 할 것이 비관리자 DOM 에 남고, 순서 편집 중에 명부를 다시 읽는다.
    const iAdmin = bar.indexOf('if(!__uaAdmin) return;');
    const iOrder = bar.indexOf('    return;   // ★ 순서 편집 중에는');
    const iTrash = bar.indexOf("mk('퇴사자 휴지통', 'uaTrash'");
    assert.ok(iAdmin >= 0, 'uaAdminBar 의 비관리자 조기 return 을 찾지 못했다 — 판정 불가');
    assert.ok(iOrder >= 0, 'uaAdminBar 의 순서 편집 return 을 찾지 못했다 — 판정 불가');
    assert.ok(iTrash > iAdmin,
      '「퇴사자 휴지통」이 비관리자 조기 return **앞**에서 만들어진다 — 관리자가 아닌 DOM 에 문이 남는다(숨김 ≠ 부재)');
    assert.ok(iTrash > iOrder,
      '「퇴사자 휴지통」이 순서 편집 return 앞에서 만들어진다 — 편집 중에 휴지통을 열면 명부를 다시 읽어 편집 중인 순서를 날린다');
    //  ★ 그 자리에서 끄는 집합에도 함께 들어가야 한다 — 렌더가 잠그는 집합과 갈리면 재렌더가 잠금을 뒤집는다.
    assert.ok(/mk\('퇴사자 휴지통', 'uaTrash', 'btn sm', \(\) => openTrash\('user'\)\)\.disabled = __uaSaving;/.test(bar),
      '「퇴사자 휴지통」이 왕복 중에도 켜져 있다 — 결과를 기다리는 중에 휴지통이 열려 명부를 다시 읽는다');
    assert.ok(/'uaNew', 'uaOrderEdit', 'uaOrderSave', 'uaTrash'/.test(extractFunction(web, 'uaSyncControls')),
      "uaSyncControls 가 #uaTrash 를 그 자리에서 잠그지 않는다 — 렌더가 잠그는 집합과 갈려, 다시 그리는 순간 잠금이 뒤집힌다");
  },

  // ⑥-c 화면은 호스트가 준 순서를 그대로 그린다 — 정렬하는 곳이 둘이면 반드시 갈린다.
  renderDoesNotReorder(web) {
    for (const fn of ['trRender', 'trApplyData']) {
      assert.ok(!/\.sort\(/.test(extractFunction(web, fn)),
        `${fn} 이 목록을 다시 정렬한다 — 순서는 호스트가 정한다(설계 §4.2)`);
    }
  },

  // ⑥-d 관리자 여부는 **호스트 회신**이 정한다(화면이 지어내지 않는다) + 여는 순간 낡은 값을 비운다.
  adminFlagComesFromHost(web) {
    assert.ok(/__trAdmin = !!\(d && d\.admin === true\);/.test(extractFunction(web, 'trApplyData')),
      'trApplyData 가 관리자 여부를 호스트 회신(d.admin)에서 그대로 받지 않는다 — 화면이 권한을 지어내면 낡는다');
    const o = extractFunction(web, 'openTrash');
    assert.ok(/__trAdmin = false;/.test(o),
      'openTrash 가 __trAdmin 을 비우지 않는다 — 회신 전 한 프레임 동안 [영구 삭제]가 번쩍인다');
    assert.ok(/hostRequest\('trashGet'/.test(o), "openTrash 가 hostRequest('trashGet') 을 부르지 않는다");
    assert.ok(/openModal\('#trashModal'\)/.test(o), 'openTrash 가 모달을 열지 않는다');
    //  ★ 2026-09-14: 파싱·앉히기는 trSeat 한 곳이다 — 쓰기 회신(trSend)의 `trash` 가 지나는 유일한 문이고,
    //    사라진 푸시(__applyTrash)도 같은 문으로 들어왔었다. 문이 둘로 갈리면 한쪽만 낡는다.
    //    그 푸시의 **부재**는 계약⑭-h4(user-admin.test.mjs)가 호스트·웹 양쪽을 훑어 지킨다(§11-30).
    const seat = extractFunction(web, 'trSeat');
    assert.ok(/JSON\.parse/.test(seat) && /d\.found/.test(seat),
      'trSeat 가 문자열 JSON 을 파싱해 found 를 확인하지 않는다(__applyProjects 와 같은 전달 규약이다)');
    assert.ok(/return false;/.test(seat) && /return true;/.test(seat),
      "trSeat 가 '앉혔나'를 돌려주지 않는다 — 회신에 목록이 안 실려 온 경우를 부르는 쪽이 알 길이 없다");
  },

  // ⑦ 입력값은 **가공 없이** 호스트로 간다(TRIM 금지 · 설계 §5.2) + 확인창 대조도 엄격 일치다.
  confirmIsSentRaw(web) {
    const d = extractFunction(web, 'trDelete');
    assert.ok(/confirm:\s*inp\s*\?\s*inp\.value\s*:/.test(d),
      "trDelete 가 #ctInput 의 값을 그대로 confirm 으로 보내지 않는다 — 가공하면 호스트 대조(§3.4)와 기준이 갈린다");
    assert.ok(!/trim\(\)/.test(d), 'trDelete 가 입력값을 trim 한다 — 이름에 공백이 있으면 공백까지 같아야 한다');
    assert.ok(/confirmTyped\(/.test(d), 'trDelete 가 이름 입력형 확인창을 거치지 않는다 — 확인 한 번으로 DB 행이 사라진다');
    const c = extractFunction(web, 'confirmTyped');
    assert.ok(/ok\.disabled = inp\.value !== want;/.test(c),
      'confirmTyped 의 대조가 엄격 일치(inp.value !== want)가 아니다 — trim·대소문자 접기가 끼면 화면만 통과시킨다');
    assert.ok(!/trim\(\)|toLowerCase\(\)|toUpperCase\(\)/.test(c),
      'confirmTyped 가 입력을 가공한다 — 설계 §5.2 는 글자까지 같기를 요구한다');
    //  ★ 기존 확인창(#confirmModal/#cfOk)은 건드리지 않는다 — 앱 전체의 삭제 확인 경로이고 루프 시험이 그 버튼을 누른다.
    assert.ok(/\$\('#confirmModal'\), ok = \$\('#cfOk'\)/.test(extractFunction(web, 'confirmBox')),
      'confirmBox 가 더 이상 #confirmModal/#cfOk 를 쓰지 않는다 — 이름 입력형은 형제 모달이어야 한다');
  },

  // ⑦-b 쓰기 왕복 한 곳 — 회신은 **그 버튼을 누른 클로저**로 돌아온다(2026-09-14).
  //   ★ 2026-09-10: 가드가 두 번째 클릭을 **조용히** 버리던 것을 고쳤다. 잠금은 trSetSaving 한 곳으로
  //     모였으므로(uaSetSaving·offEdSetBusy 와 같은 장치) 여기서 보는 자리도 함께 옮겼다.
  //   ★ 2026-09-14(손으로 만든 상관관계 걷어내기 1단계): 복구·삭제가 hostRequest 왕복이 되면서
  //     요청 표(__trReq)와 워치독이 **함께 사라졌다**.
  //     · 늦게 온 회신이 다른 항목의 결과로 먹히던 자리 → Promise 가 자기 호출자에게만 풀리므로 불가능하다.
  //     · 회신이 영영 안 오는 경우 → hostRequest 의 타임아웃(20초)이 실패 회신으로 바꿔 준다(워치독의 일이었다).
  //     · 잠금은 여전히 **렌더가 진다**(trRender) — 노드를 걸어 다니며 끄면 왕복 중 재렌더가 잠금을 지운다.
  writeRoundTrip(web) {
    const s = extractFunction(web, 'trSend');
    assert.ok(/^async function trSend\(payload\)\{/m.test(web),
      'trSend 가 async 가 아니다 — 회신을 부르는 쪽에 돌려줄 수 없다(공용 회신함으로 되돌아간 것이다)');
    assert.ok(/if\(__trSaving\)\{[^}]*return null;/.test(s),
      'trSend 에 중복 전송 가드가 없다(또는 못 보냈음을 null 로 말하지 않는다) — 연타하면 같은 삭제가 두 번 나간다');
    assert.ok(/이전 요청을 처리 중입니다/.test(s),
      'trSend 가 가드에 걸린 클릭을 조용히 버린다 — 관리자에게는 버튼이 먹지 않는 것으로 보인다(2026-09-10)');
    assert.ok(/trSetSaving\(true\)/.test(s), 'trSend 가 trSetSaving 으로 잠그지 않는다 — 진행 중임이 화면에 드러나지 않는다');
    //  ★ 기한 30초 — uaSend 와 **같은 값**이어야 한다(같은 근거를 두 화면이 함께 쓴다). 휴지통 쪽은 한 왕복에
    //    DB 를 한 번 더 만지므로(쓰기 → 휴지통 재조회 → 인력이면 명부까지) 오히려 여기가 더 늦다(2026-09-14 W4).
    assert.ok(/await hostRequest\(cmd, Object\.assign\(\{ includeInactive: __uaInactive \}, payload\), 30000\)/.test(s),
      'trSend 가 hostRequest 왕복(includeInactive 동봉 · 30초)으로 보내지 않는다 — 회신을 짝지을 수단이 다시 손으로 만든 표가 되거나, 호스트가 일하는 중에 기한이 먼저 끊긴다(W4)');
    //  ★ 실패 문장은 「구성원 편집」과 **같은 곳**에서 나온다(hostWriteMsg) — 거부(사유를 안다)와
    //    회신 없음(결과를 모른다)은 관리자가 할 일이 다르고, 영구 삭제는 되돌릴 수 없는 조작이다.
    assert.ok(/msg: hostWriteMsg\(r\)/.test(s),
      "trSend 가 실패 문장을 hostWriteMsg 로 만들지 않는다 — 타임아웃이 '처리하지 못했습니다'로 뭉개져, 실제로는 지워진 항목을 다시 지우려 든다(W4)");
    assert.ok(!/r\.msg \|\| r\.error/.test(s),
      'trSend 가 아직 msg 와 error 를 한 덩어리로 뭉친다 — 결과를 모르는 왕복이 평범한 실패로 보고된다(W4)');
    assert.ok(/trSetSaving\(false\);/.test(s),
      '왕복이 끝나는 자리에서 잠금을 풀지 않는다 — 푸는 곳이 둘이면 한쪽이 낡는다');
    assert.ok(/const rep = \{ ok: [^\n]*\n?[^\n]*trash: [^\n]*roster: /.test(s) && /return rep;/.test(s),
      'trSend 가 { ok, msg, trash, roster } 를 돌려주지 않는다 — 부르는 쪽이 판단할 재료가 없다');
    //  ★ 2026-09-14(좌석 일원화) — 인력 복구·삭제가 실어 오는 **명부**는 「구성원 편집」과 **같은 문**을
    //    지난다(uaSeatReply): 순서 편집 중이면 미뤄 두고, 아니면 앉힌다. 휴지통이 자기 사본을 들면
    //    그 규칙이 한쪽에서만 지켜지고, 관리자가 잡고 있던 순서가 남의 복구 한 번에 날아간다.
    assert.ok(/\n  uaSeatReply\(rep\.roster, cmd\);/.test(s) && !/painted/.test(s),
      'trSend 가 회신의 명부를 공용 좌석(uaSeatReply)으로 들여보내지 않는다(또는 그 판정을 회신에 싣는다) — 규칙이 두 벌이 되면 한쪽은 반드시 낡는다');
    assert.ok(s.indexOf('trSetSaving(false);') >= 0 && s.indexOf('uaSeatReply(') > s.indexOf('trSetSaving(false);'),
      'trSend 가 잠금을 풀기 전에 명부를 앉힌다 — 그때 그려지는 명부 목록이 전부 꺼진 버튼으로 선다(uaSend 와 같은 차례여야 한다)');
    const b = extractFunction(web, 'trSetSaving');
    assert.ok(!/setTimeout/.test(b),
      'trSetSaving 에 워치독이 되살아났다 — 왕복 도중에 잠금을 푸는 두 번째 장치가 생기면 그 틈으로 두 번째 삭제가 나간다');
    assert.ok(/dataset\.busy = '1'/.test(b) && /delete ov\.dataset\.busy/.test(b),
      'trSetSaving 이 overlay dataset.busy 를 세우고 지우지 않는다 — 전송 중에 창을 닫으면 결과를 알릴 곳이 사라진다');
    //  ★ 2026-09-14(군더더기 걷기 2단계): 잠금은 **그 자리에서** 건다(trSyncControls). 목록을 다시 만들면
    //    스크롤과 포커스를 잃고, 그것을 되돌리는 한 벌이 또 필요해진다 — 줄일 것이 아니라 없앨 것이었다.
    assert.ok(/trSyncControls\(\);/.test(b) && !/trRender\(\)/.test(b),
      'trSetSaving 이 잠금 때문에 목록을 다시 그린다(또는 그 자리에서 잠그지 않는다) — 쓰기 한 번에 목록이 여러 번 새로 만들어진다(R2-W4)');
    //  ★ 손으로 만든 상관관계가 **하나도 남아 있지 않아야** 한다(주석은 빼고 본다).
    const bare = web.replace(/\/\/[^\n]*/g, '');
    for (const dead of ['__trReq', '__trSaveWatchdog', '__trashDone']) {
      assert.ok(!bare.includes(dead),
        `손으로 만든 상관관계 ${dead} 가 아직 살아 있다 — 왕복이 이미 짝을 지어 주는데 표를 또 들고 다니면 둘 중 하나는 반드시 낡는다`);
    }
    //  ★ 뒤처리는 **그 버튼을 누른 클로저**가 한다. 두 조작이 같은 길(trAfterWrite)을 쓴다.
    for (const [fn, cmd] of [['trRestore', 'trashRestore'], ['trDelete', 'trashDelete']]) {
      const f = extractFunction(web, fn);
      assert.ok(new RegExp("const rep = await trSend\\(\\{ cmd: '" + cmd + "'").test(f),
        `${fn} 이 자기 왕복의 회신을 받지 않는다 — 결과가 다시 공용 회신함으로 흘러간다`);
      assert.ok(/if\(rep\) trAfterWrite\(rep\);/.test(f),
        `${fn} 이 회신을 trAfterWrite 로 넘기지 않는다(또는 '못 보냈다(null)'를 회신과 같이 다룬다)`);
    }
    const aw = extractFunction(web, 'trAfterWrite');
    assert.ok(/r\.msg \|\|/.test(aw),
      'trAfterWrite 가 호스트 문구를 쓰지 않는다 — 거부 사유가 "처리하지 못했습니다"로 뭉개지면 무엇을 고칠지 알 수 없다');
    assert.ok(/trSeat\(r\.trash\);/.test(aw),
      '회신에 실려 온 갱신 목록을 앉히지 않는다 — 지운 항목이 화면에 그대로 남는다');
    //  ★ 명부는 **여기서 앉히지 않는다**(2026-09-14 좌석 일원화) — trSend 가 공용 좌석으로 이미 들여보냈다.
    //    뒤처리가 한 번 더 앉히면 '순서 편집 중이면 미뤄 둔다'를 두 곳이 각자 판단하게 된다.
    assert.ok(!/uaSeatRoster\(|uaSeatReply\(/.test(aw),
      'trAfterWrite 가 명부를 스스로 앉힌다 — 좌석이 둘로 갈리면 순서 편집 보호가 한쪽에서만 지켜진다');
    //  ★ (재)오픈은 낡은 잠금을 남기지 않는다. 다만 **도는 중이면 풀지 않는다**(그 왕복이 끝나는 자리가 푼다).
    const o = extractFunction(web, 'openTrash');
    assert.ok(/if\(__trSaving\) trSetSaving\(true\); else trSetSaving\(false\);/.test(o),
      'openTrash 가 낡은 잠금을 정리하지 않는다 — 회신 없이 닫았다 다시 열면 화면이 잠긴 채로 선다(2026-09-10)');
  },

  // ⑦-c 잠금은 **데이터가 아니라 렌더**가 진다(2026-09-11 적대 검토 R3-W2).
  //   trRender 가 deletable 만 보고 그리면, 왕복 중에 도착한 푸시가 버튼을 새로 만드는 순간
  //   잠금이 사라진다 — 되돌릴 수 없는 [영구 삭제]를 두 번 누를 수 있게 된다.
  lockIsDerivedAtRender(web) {
    const r = extractFunction(web, 'trRender');
    assert.ok(/rb\.disabled = __trSaving;/.test(r),
      'trRender 가 [복구]를 그릴 때 __trSaving 을 보지 않는다 — 재렌더가 잠금을 지운다');
    assert.ok(/db\.disabled = !deletable \|\| __trSaving;/.test(r),
      'trRender 가 [영구 삭제]의 잠금을 데이터와 왕복 상태로 함께 정하지 않는다 — 둘 중 하나만 보면 나머지가 샌다');
    //  ★ 그리고 **그 자리에서 거는 겹**도 같은 한 식을 쓴다(2026-09-14). 집합이나 식이 갈리면
    //    잠금 한 번이 '지울 수 없음'을 뒤집는다 — 되돌릴 수 없는 [영구 삭제]가 켜진다.
    const s = extractFunction(web, 'trSyncControls');
    assert.ok(/querySelectorAll\('\[data-top\]'\)/.test(s),
      'trSyncControls 가 #trList 의 행 컨트롤을 훑지 않는다 — 잠금이 그 자리에서 걸리지 않는다');
    assert.ok(/deletable\(b\.dataset\.tkey\)/.test(s) && /it\.deletable === true/.test(s),
      "trSyncControls 가 '지울 수 있나'를 목록 데이터에서 다시 읽지 않는다 — 판정을 따로 적어 두면 렌더와 갈린다");
    assert.ok(/__trSaving \|\| \(b\.dataset\.top === 'delete'/.test(s),
      'trSyncControls 가 잠금과 삭제 가능 여부를 한 식으로 정하지 않는다 — 잠금을 푸는 순간 지울 수 없는 항목이 켜진다');
    assert.ok(/lockLineBtn\(/.test(s),
      'trSyncControls 가 lockLineBtn 을 쓰지 않는다 — 포커스를 쥔 버튼이 꺼지면 그대로 body 로 떨어진다');
  },

  // ⑦-d 목록을 다시 그리는 것은 **내용이 실제로 달라졌을 때뿐**이다(2026-09-14 군더더기 걷기 2단계) —
  //   목록이 새로 앉았다 · 탭을 바꿨다 · 관리자 여부가 뒤집혔다.
  //   ★ 2026-09-14 적대 검토(W2) — 그 셋이 같은 답을 갖지 않는다. '탭을 바꿨다'와 '관리자 여부가 뒤집혔다'는
  //     맨 위가 옳지만, '목록이 새로 앉았다'는 **복구·삭제 회신이 오는 길**이다(trAfterWrite → trSeat →
  //     trRender). 한 건 복구할 때마다 맨 위로 튀면 관리자는 다음 대상을 매번 다시 찾아야 하고, 쥐고 있던
  //     [복구] 버튼이 사라져 포커스가 body 로 떨어진다(R5-W1 이 닫았던 자리다).
  //   ★ 그래서 렌더는 자리·포커스를 **지역 변수로** 들었다 놓고, 맨 위는 그 이유를 아는 쪽이 고른다
  //     (탭 버튼·tablistRoving → trListTop). uaRender 와 **같은 한 벌**이다.
  renderKeepsPlace(web) {
    const r = extractFunction(web, 'trRender');
    assert.ok(/const keepTop = list\.scrollTop;/.test(r) && /list\.scrollTop = keepTop;/.test(r),
      'trRender 가 보던 자리를 들었다 놓지 않는다 — 한 건 복구할 때마다 목록이 맨 위로 튄다(W2)');
    assert.ok(!/list\.scrollTop = 0;/.test(r),
      "trRender 가 아직 스스로 맨 위로 보낸다 — 이 함수는 자기가 **왜** 불렸는지 모른다(탭 전환인지 복구 회신인지). 그 판단은 호출부의 trListTop() 이 한다(W2)");
    assert.ok(/dataset\.top/.test(r) && /dataset\.tkey/.test(r) && /list\.contains\(act\)/.test(r),
      'trRender 가 쥐고 있던 버튼의 신원을 적어 두지 않는다 — 복구 한 번에 포커스가 body 로 떨어져 Tab 이 문서 처음부터 다시 시작한다(W2)');
    assert.ok(/if\(!b\.disabled\) try\{ b\.focus\(\); \}catch\(_\)\{\}/.test(r),
      '되돌아온 버튼이 꺼져 있어도 포커스를 준다(또는 되돌리지 않는다) — 지울 수 없는 항목의 [영구 삭제]에 포커스가 앉으면 브라우저가 도로 body 로 떨어뜨린다');
    //  ★ '맨 위'를 아는 쪽 — 탭 전환 둘(마우스·화살표키)과 관리자 뒤집힘, 그리고 화면을 여는 순간.
    const top = extractFunction(web, 'trListTop');
    assert.ok(/getElementById\('trList'\)/.test(top) && /scrollTop = 0/.test(top),
      'trListTop 이 #trList 를 맨 위로 보내지 않는다 — 맨 위가 옳은 자리들이 갈 곳을 잃는다');
    assert.ok(/b\.addEventListener\('click', \(\) => \{ __trTab = t\.kind; trRender\(\); trListTop\(\); \}\);/.test(r),
      '탭 버튼이 새 탭을 맨 위에서 열지 않는다 — 새 탭의 첫 줄이 화면 밖에서 시작한다(W2)');
    const bare0 = web.replace(/\/\/[^\n]*/g, '');
    assert.ok(/tablistRoving\('#trTabs', '\.tab', b => \{ __trTab = b\.dataset\.trtab; trRender\(\); trListTop\(\); \}\);/.test(bare0),
      '화살표키로 옮긴 탭은 맨 위에서 열리지 않는다 — 마우스와 키보드가 다른 화면을 낸다(W2)');
    const ap = extractFunction(web, 'trApplyData').replace(/\/\/[^\n]*/g, '');
    assert.ok(/const wasAdmin = __trAdmin;/.test(ap) && /if\(__trAdmin !== wasAdmin\) trListTop\(\);/.test(ap),
      '관리자 여부가 뒤집혔는데 맨 위로 보내지 않는다(또는 목록이 앉을 때마다 보낸다) — 복구 회신도 그 길로 온다(W2)');
    const bare = web.replace(/\/\/[^\n]*/g, '');
    for (const dead of ['__trShown', '__trKeepBtn']) {
      assert.ok(!bare.includes(dead),
        `모듈 전역 ${dead} 가 아직 살아 있다 — 다시 그릴 이유가 없는 재렌더를 메우려고 자란 장치다`);
    }
    //  ★ 탭 줄은 **여전히 통째로 다시 만든다**(건수 배지가 바뀐다) — 그래서 탭에 있던 포커스는 지금도
    //    그리는 쪽이 되돌려야 한다. 이건 '내용이 달라진 재렌더'라 되돌리는 것이 옳다(R2-W4 와 무관하다).
    assert.ok(/const hadFocus = tabs\.contains\(document\.activeElement\);/.test(r) && /cur\.focus\(\)/.test(r),
      '탭 줄을 다시 만들면서 그 안에 있던 포커스를 되돌리지 않는다 — 키보드로 탭을 옮기면 화살표키가 먹지 않는다');
    //  ★ 행의 손잡이는 **그대로 남는다**: tabIndex=-1 은 잠금이 포커스를 물러 세울 자리다(lockLineBtn).
    assert.ok(/line\.tabIndex = -1;/.test(r),
      '행(.mba-line)이 포커스를 받을 수 없다 — 잠금이 버튼을 끌 때 물러설 자리가 없어 포커스가 body 로 떨어진다');
    assert.ok(/line\.dataset\.tkey = key;/.test(r),
      '행(.mba-line)에 data-tkey 가 없다 — 어느 행인지 가리킬 열쇠가 사라진다');
    assert.ok(!/line\.dataset\.top/.test(r),
      "행에 data-top 을 달았다 — 버튼을 찾는 셀렉터('[data-top]')에 행이 끼어든다");
    //  ★ 여는 순간의 렌더는 **남아 있어야 한다**: 바로 위 trSetSaving 은 잠금만 그 자리에서 다시 걸 뿐
    //    목록을 그리지 않는다. 지우면 방금 비운 __trData·__trAdmin 이 화면에 닿지 않아 지난번에 열었던
    //    목록이 그대로 남는다(회신 전 한 프레임).
    const o = extractFunction(web, 'openTrash');
    assert.ok(/if\(__trSaving\) trSetSaving\(true\); else trSetSaving\(false\);\s*\n[\s\S]{0,400}?\n  trRender\(\);/.test(o),
      'openTrash 가 여는 순간 목록을 그리지 않는다 — trSetSaving 은 잠금만 걸 뿐 그리지 않는다');
  },

  // ⑧ 빈 탭 문구의 조사는 **받침이 정한다**(2026-09-10). 「이(가)」 병기는 다섯 탭 어디서도 맞지 않는 타협이다.
  emptyTextJosa(web) {
    const blk = constBlock(web, 'const TR_TABS = [');
    assert.ok(!/이\(가\)/.test(web.slice(web.indexOf('function trRender'), web.indexOf('function trApplyData'))),
      "trRender 가 아직 '이(가)' 병기를 쓴다 — 문구는 탭 표(TR_TABS)가 진다");
    for (const label of ['과제', '인력', '발주처', '구분', '상태']) {
      assert.ok(new RegExp("empty: trEmptyLabel\\('" + label + "'\\)").test(blk),
        `TR_TABS 의 ${label} 탭에 빈 탭 문구(empty)가 없다 — 문구가 렌더로 흩어지면 다섯 벌이 된다`);
    }
    assert.ok(/josa\(label, '이', '가'\)/.test(constLine(web, 'trEmptyLabel')),
      'trEmptyLabel 이 josa 로 조사를 고르지 않는다 — 라벨마다 손으로 적으면 다음 탭에서 반드시 틀린다');
  },

  // ⑥-e 숨김 확인창은 '숨긴 뒤 어디로 가는가'를 말한다(설계 §5.4) — 지금은 숨기면 사라지기만 한다.
  hideConfirmPointsToTrash(web) {
    //  ★ 2026-09-18 — 문이 그 화면으로 옮겨 온 뒤로는 **어느 화면의 휴지통인지**까지 말한다.
    //    과제 숨김은 바로 그 화면에서 일어나므로 '이 화면의', 발주처·구분·상태는 다른 모달에서
    //    일어나므로 '공식 과제 화면의' 다 — 「휴지통」이라고만 하면 어디로 가야 하는지 다시 물어야 한다.
    assert.ok(/숨긴 과제는 이 화면의 「🗑 휴지통」에서 복구하거나 영구 삭제할 수 있습니다/.test(extractFunction(web, 'offHideProject')),
      '과제 숨김 확인창이 **이 화면의** 「🗑 휴지통」을 가리키지 않는다 — 숨긴 과제를 다시 볼 곳이 화면 어디에도 안내되지 않는다');
    for (const fn of ['custDoHide', 'codeDoHide']) {
      assert.ok(/숨긴 항목은 공식 과제 화면의 「🗑 휴지통」에서/.test(extractFunction(web, fn)),
        `${fn} 의 확인창이 **공식 과제 화면의** 「🗑 휴지통」을 가리키지 않는다 — 발주처·구분·상태도 같은 곳에서 복구·삭제한다`);
    }
  },
};

// ── 형태 계약 ────────────────────────────────────────────────────────
test('계약⑥-a: #trashModal 마크업에는 탭·[영구 삭제] 가 없다(빈 자리뿐)', () => checks.trashMarkupHasNoControls(app));
test('계약⑥-b: 휴지통 진입은 도메인 화면의 두 문이다 — 「사용자 정보」에는 없다', () => checks.trashEntryDoorsAreDomainScreens(app));
test('계약⑥-c: 휴지통 렌더는 목록을 다시 정렬하지 않는다(순서는 호스트가 정한다)', () => checks.renderDoesNotReorder(app));
test('계약⑥-d: 관리자 여부는 호스트 회신이 정하고, 열 때 낡은 값을 비운다', () => checks.adminFlagComesFromHost(app));
test('계약⑥-e: 숨김 확인창이 「휴지통」을 가리킨다(설계 §5.4)', () => checks.hideConfirmPointsToTrash(app));
test('계약⑦: 입력한 이름은 가공 없이 호스트로 가고, 대조는 엄격 일치다', () => checks.confirmIsSentRaw(app));
test('계약⑦-b: 복구·삭제 왕복은 한 곳(trSend)이고 회신은 그 버튼을 누른 클로저가 받는다', () => checks.writeRoundTrip(app));
test('계약⑦-c: 행 버튼의 잠금은 렌더가 진다(재렌더가 잠금을 지우지 않는다)', () => checks.lockIsDerivedAtRender(app));
test('계약⑦-d: 렌더는 보던 자리·쥔 버튼을 지키고, 맨 위는 탭을 바꾼 쪽이 고른다', () => checks.renderKeepsPlace(app));
test('계약⑧: 빈 탭 문구는 탭 표가 지고 조사는 받침이 정한다(「이(가)」 병기 없음)', () => checks.emptyTextJosa(app));

test('변이⑦-b: 진행 중 클릭을 조용히 버리게 되돌리면 계약⑦-b 가 실패한다', () => {
  const bad = mutate(app, "  if(__trSaving){ toast('이전 요청을 처리 중입니다 — 잠시 후 다시 시도하세요', 'warn'); return null; }",
    '  if(__trSaving) return null;');
  assert.throws(() => checks.writeRoundTrip(bad), /중복 전송 가드가 없다|조용히 버린다/);
  assert.doesNotThrow(() => checks.writeRoundTrip(app));   // 통제군
});

test('변이⑦-b2: 회신을 부르는 쪽이 안 받게 되돌리면 계약⑦-b 가 실패한다(결과가 갈 곳이 없다)', () => {
  const bad = mutate(app, "    const rep = await trSend({ cmd: 'trashRestore', kind: kind, key: key });\n    if(rep) trAfterWrite(rep);\n",
    "    trSend({ cmd: 'trashRestore', kind: kind, key: key });\n");
  assert.throws(() => checks.writeRoundTrip(bad), /trRestore 이 자기 왕복의 회신을 받지 않는다/);
  assert.doesNotThrow(() => checks.writeRoundTrip(app));   // 통제군
});

test('변이⑦-b3: 워치독을 되살리면 계약⑦-b 가 실패한다(왕복 도중에 잠금이 풀린다)', () => {
  const bad = mutate(app, TR_LOCK_TAIL, TR_LOCK_WATCHDOG);
  assert.throws(() => checks.writeRoundTrip(bad), /워치독이 되살아났다/);
  assert.doesNotThrow(() => checks.writeRoundTrip(app));   // 통제군
});

test('변이⑦-b3b: 잠금을 렌더로 반영하게 되돌리면 계약⑦-b 가 실패한다(쓰기 한 번에 목록이 여러 번 새로 선다)', () => {
  const bad = mutate(app, TR_LOCK_TAIL, '  trRender();\n}');
  assert.throws(() => checks.writeRoundTrip(bad), /목록을 다시 그린다|그 자리에서 잠그지 않는다/);
  assert.doesNotThrow(() => checks.writeRoundTrip(app));   // 통제군
});

test('변이⑦-b4: 회신의 갱신 목록을 안 앉히면 계약⑦-b 가 실패한다(지운 항목이 화면에 남는다)', () => {
  const bad = mutate(app, '  trSeat(r.trash);\n', '');
  assert.throws(() => checks.writeRoundTrip(bad), /갱신 목록을 앉히지 않는다/);
  assert.doesNotThrow(() => checks.writeRoundTrip(app));   // 통제군
});

test('변이⑦-b5: 인력 쪽 명부를 안 들여보내면 계약⑦-b 가 실패한다(「구성원 편집」이 낡은 채로 남는다)', () => {
  const bad = mutate(app, TR_SEAT_IN_SEND, '  return rep;\n}\n// 휴지통 목록의 컨트롤');
  assert.throws(() => checks.writeRoundTrip(bad), /공용 좌석\(uaSeatReply\)으로 들여보내지 않는다/);
  assert.doesNotThrow(() => checks.writeRoundTrip(app));   // 통제군
});

//  ★ 좌석을 **휴지통이 자기 손으로** 다시 들면(옛 판) 규칙이 두 벌이 된다 — 그쪽에는 '순서 편집 중이면
//    미뤄 둔다'가 없어, 인력 복구 한 번이 관리자가 잡고 있던 순서를 덮는다(user-admin 의 C20 과 같은 결함).
test('변이⑦-b5b: 뒤처리가 명부를 다시 앉히면 계약⑦-b 가 실패한다(좌석이 둘로 갈린다)', () => {
  const bad = mutate(app, '  trSeat(r.trash);\n  toast(r.msg', '  trSeat(r.trash);\n  uaSeatRoster(r.roster);\n  toast(r.msg');
  assert.throws(() => checks.writeRoundTrip(bad), /trAfterWrite 가 명부를 스스로 앉힌다/);
  assert.doesNotThrow(() => checks.writeRoundTrip(app));   // 통제군
});

test('변이⑦-c: 잠금을 렌더에서 빼면 계약⑦-c 가 실패한다', () => {
  const bad = mutate(app, '    rb.disabled = __trSaving;', '    rb.disabled = false;');
  assert.throws(() => checks.lockIsDerivedAtRender(bad), /\[복구\]를 그릴 때 __trSaving 을 보지 않는다/);
  assert.doesNotThrow(() => checks.lockIsDerivedAtRender(app));   // 통제군
});

//  ★ trRender 의 '보던 자리로 돌아온다' 한 줄 — uaRender 에도 같은 이름의 줄이 있으므로 바로 위 안내
//    문구까지 묶어 그 한 곳만 가리킨다(두 화면이 같은 규칙을 쓴다는 뜻이기도 하다).
const KEEP_IN_TR_RENDER = "  //    '맨 위'가 옳은 경우(탭 전환·관리자 뒤집힘)는 그것을 아는 쪽이 trListTop() 으로 말한다.\n" +
  '  list.scrollTop = keepTop;';

test('변이⑦-d: trRender 가 다시 스스로 맨 위로 보내면 계약⑦-d 가 실패한다(복구 한 번에 목록이 튄다 · W2)', () => {
  const bad = mutate(app, KEEP_IN_TR_RENDER, '  list.scrollTop = 0;');
  assert.throws(() => checks.renderKeepsPlace(bad), /보던 자리를 들었다 놓지 않는다|아직 스스로 맨 위로 보낸다/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑦-d4: 탭 전환의 맨 위 한 줄을 지우면 계약⑦-d 가 실패한다(새 탭이 화면 밖에서 시작한다)', () => {
  //  ★ 렌더의 되돌리기는 **남겨 둔 채** 호출부의 한 줄만 뗀다 — 이 변이가 치는 자리가 분명해진다.
  const bad = mutate(app, 'b.addEventListener(\'click\', () => { __trTab = t.kind; trRender(); trListTop(); });',
    'b.addEventListener(\'click\', () => { __trTab = t.kind; trRender(); });');
  assert.throws(() => checks.renderKeepsPlace(bad), /탭 버튼이 새 탭을 맨 위에서 열지 않는다/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑦-d6: 화살표키 탭 전환만 맨 위를 잃어도 계약⑦-d 가 실패한다(마우스와 다른 화면이 된다)', () => {
  const bad = mutate(app, "tablistRoving('#trTabs', '.tab', b => { __trTab = b.dataset.trtab; trRender(); trListTop(); });",
    "tablistRoving('#trTabs', '.tab', b => { __trTab = b.dataset.trtab; trRender(); });");
  assert.throws(() => checks.renderKeepsPlace(bad), /화살표키로 옮긴 탭은 맨 위에서 열리지 않는다/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑦-d5: 모듈 전역의 맡아 둔 버튼 표를 되살리면 계약⑦-d 가 실패한다(노드가 그대로인데 표를 또 든다)', () => {
  const bad = mutate(app, 'let __trAdmin = false;', 'let __trKeepBtn = null;\nlet __trAdmin = false;');
  assert.throws(() => checks.renderKeepsPlace(bad), /__trKeepBtn 가 아직 살아 있다/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑦-d2: 탭 줄의 포커스 되돌리기를 지우면 계약⑦-d 가 실패한다(화살표키가 먹지 않는다)', () => {
  const bad = mutate(app, '  const hadFocus = tabs.contains(document.activeElement);\n', '  const hadFocus = false;\n');
  assert.throws(() => checks.renderKeepsPlace(bad), /탭 줄을 다시 만들면서/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑦-d3: 행이 포커스를 못 받게 되돌리면 계약⑦-d 가 실패한다(잠금이 물러설 자리가 없다)', () => {
  const bad = mutate(app, '    line.tabIndex = -1;\n', '');
  assert.throws(() => checks.renderKeepsPlace(bad), /포커스를 받을 수 없다/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑧: 조사를 「이(가)」 병기로 되돌리면 계약⑧ 이 실패한다', () => {
  const bad = mutate(app, "  if(empty){ empty.textContent = def.empty;",
    "  if(empty){ empty.textContent = '숨긴 ' + def.label + '이(가) 없습니다.';");
  assert.throws(() => checks.emptyTextJosa(bad), /'이\(가\)' 병기를 쓴다/);
  assert.doesNotThrow(() => checks.emptyTextJosa(app));   // 통제군
});

test('변이⑥-a: 마크업에 탭 버튼을 하나 적으면 계약⑥-a 가 실패한다', () => {
  const bad = mutate(app, '      <div id="trTabs"></div>',
    '      <div id="trTabs"><button type="button" data-trtab="project">과제</button></div>');
  assert.throws(() => checks.trashMarkupHasNoControls(bad), /trTabs 가 비어 있지 않다|data-trtab/);
  assert.doesNotThrow(() => checks.trashMarkupHasNoControls(app));   // 통제군
});

//  ★ 퇴사자 쪽 문을 **비관리자 조기 return 앞**으로 올리면 숨김이 아니라 부재여야 할 것이 DOM 에 남는다.
test('변이⑥-b: 「퇴사자 휴지통」을 비관리자 분기 앞에서 만들면 계약⑥-b 가 실패한다(숨김 ≠ 부재)', () => {
  const bad = mutate(app, "  if(!__uaAdmin) return;   // ★ 비관리자",
    "  mk('퇴사자 휴지통', 'uaTrash', 'btn sm', () => openTrash('user')).disabled = __uaSaving;\n  if(!__uaAdmin) return;   // ★ 비관리자");
  assert.throws(() => checks.trashEntryDoorsAreDomainScreens(bad), /비관리자 조기 return \*\*앞\*\*에서 만들어진다/);
  assert.doesNotThrow(() => checks.trashEntryDoorsAreDomainScreens(app));   // 통제군
});

test('변이⑥-b2: 「퇴사자 휴지통」을 마크업에 적으면 계약⑥-b 가 실패한다', () => {
  const bad = mutate(app, '      <div id="uaAdmin"></div>',
    '      <div id="uaAdmin"><button type="button" class="btn sm" id="uaTrash">퇴사자 휴지통</button></div>');
  assert.throws(() => checks.trashEntryDoorsAreDomainScreens(bad), /마크업에 있다/);
  assert.doesNotThrow(() => checks.trashEntryDoorsAreDomainScreens(app));   // 통제군
});

//  ★ 옛 자리(「사용자 정보」)로 문을 되돌리면 계약⑥-b 가 실패한다 — 그 자리가 곧 §11-32 의 오해다.
test('변이⑥-b3: 「사용자 정보」에 휴지통을 되살리면 계약⑥-b 가 실패한다(§11-32 의 자리로 되돌아간다)', () => {
  const bad = mutate(app, '>구성원 편집</button>',
    '>구성원 편집</button>\n          <button type="button" class="btn sm" id="usTrash">휴지통</button>');
  assert.throws(() => checks.trashEntryDoorsAreDomainScreens(bad), /「휴지통」이 들어왔다/);
  assert.doesNotThrow(() => checks.trashEntryDoorsAreDomainScreens(app));   // 통제군
});

//  ★ 과제 쪽 문의 노출 규칙을 발주처 관리와 다르게 만들면(무조건 보이게) 계약⑥-b 가 실패한다.
test('변이⑥-b4: 과제 쪽 문의 배선을 떼면 계약⑥-b 가 실패한다(눌러도 아무 일이 없다)', () => {
  const bad = mutate(app, "  { const b = $('#offTrash'); if(b) b.addEventListener('click', () => { offEditGuard(() => openTrash('project')); }); }\n", '');
  assert.throws(() => checks.trashEntryDoorsAreDomainScreens(bad), /배선되지 않았다|같은 관문/);
  assert.doesNotThrow(() => checks.trashEntryDoorsAreDomainScreens(app));   // 통제군
});

test('변이⑦: 대조에 trim 을 끼우면 계약⑦ 이 실패한다', () => {
  const bad = mutate(app, 'const sync = () => { ok.disabled = inp.value !== want; };',
    'const sync = () => { ok.disabled = inp.value.trim() !== want; };');
  assert.throws(() => checks.confirmIsSentRaw(bad), /엄격 일치|입력을 가공한다/);
  assert.doesNotThrow(() => checks.confirmIsSentRaw(app));   // 통제군
});

// ══════════════════════════════════════════════════════════════════════
//  DOM 계약 — 실제로 그려 보고 센다(jsdom)
// ══════════════════════════════════════════════════════════════════════

const jsdom = useJsdom(await importOptional('jsdom'));   // 부팅 다섯 줄은 harness(runInJsdom) 한 곳에 있다

const SNAP_JS = [
  'function __snap(){',
  '  var tabs = document.getElementById("trTabs");',
  '  var list = document.getElementById("trList");',
  '  var empty = document.getElementById("trEmpty");',
  '  var scope = document.getElementById("trScope");',
  '  return {',
  '    tabs: Array.prototype.map.call(tabs.querySelectorAll("[data-trtab]"), function(b){',
  '      return { kind: b.dataset.trtab, text: String(b.textContent || ""),',
  '               on: b.className.split(" ").indexOf("on") >= 0, sel: b.getAttribute("aria-selected"),',
  '               role: b.getAttribute("role") || "", tabIndex: b.tabIndex }; }),',
  '    tabsClass: String(tabs.className || ""),',
  '    tabsRole: tabs.getAttribute("role") || "",',
  '    listRole: list.getAttribute("role") || "",',
  '    whys: Array.prototype.map.call(list.querySelectorAll("[data-trwhy]"), function(d){',
  '      return { key: d.dataset.trwhy, text: String(d.textContent || "") }; }),',
  '    ops: Array.prototype.map.call(list.querySelectorAll("[data-top]"), function(b){',
  '      return { op: b.dataset.top, key: b.dataset.tkey, text: String(b.textContent || ""),',
  '               disabled: !!b.disabled, title: String(b.title || "") }; }),',
  '    lines: list.querySelectorAll(".mba-line").length,',
  '    rows: list.querySelectorAll(".mb-row").length,',
  '    acts: list.querySelectorAll(".mba-act").length,',
  '    links: list.querySelectorAll(".mb-row.is-link").length,',
  '    text: String(list.textContent || ""),',
  '    scope: scope ? String(scope.textContent || "") : "",',
  '    emptyText: empty ? String(empty.textContent || "") : "",',
  '    emptyHidden: empty ? empty.classList.contains("hidden") : true,',
  '  };',
  '}',
].join('\n');

// 그리는 데 실제로 필요한 것만 원본에서 떼어 낸다(사본은 반드시 낡는다).
function renderHarnessJs(src) {
  return [
    //  __trSaving 은 **꺼진 채**로 둔다 — 여기서 보는 것은 '무엇이 그려지는가' 하나다.
    //  잠금이 걸린 화면은 busyHarnessJs 가 본다(계약⑦-DOM).
    //  ★ __trScope 는 '어느 문으로 들어왔나'다(2026-09-18) — 그것이 **보이는 탭**을 정하므로, 이 하네스도
    //    앱과 같은 초기값(과제 쪽)에서 시작한다. 퇴사자 쪽은 탐침이 스스로 바꿔 놓는다.
    'var __trData = null, __trTab = "project", __trAdmin = false, __trSaving = false;',
    'var __trScope = "project";',
    '// 이 계약과 무관한 협력자는 빈 함수로 — 여기서 보는 것은 "무엇이 그려지는가" 하나다.',
    'function trRestore(){} function trDelete(){} function toast(){} function hostRequest(){}',
    constLine(src, 'josa'),
    constLine(src, 'trEmptyLabel'),
    constBlock(src, 'const TR_TABS = ['),
    constLine(src, 'trTabDef'),
    constLine(src, 'trRows'),
    constLine(src, 'trTabs'),
    extractFunction(src, 'trApplyData'),
    extractFunction(src, 'trRender'),
    //  ★ '맨 위로'는 2026-09-14(W2)부터 렌더가 아니라 **탭을 바꾼 쪽**의 일이다 — 탭 버튼이 그것을 부르므로
    //    떼어 오지 않으면 탭 전환이 ReferenceError 로 죽는다.
    extractFunction(src, 'trListTop'),
    SNAP_JS,
    //  ★ 'user' 는 이제 **탭이 아니라 문**이다(2026-09-18) — 퇴사자 쪽에는 탭 줄이 없으므로 눌러서 갈 수
    //    없다. 그래서 탐침이 openTrash 와 같은 일을 한다: 문을 고르고(__trScope) 그 문의 첫 탭에서 연다.
    'function __door(clickTab){',
    '  var sc = (clickTab === "user") ? "user" : "project";',
    '  __trData = null; __trAdmin = false; __trScope = sc; __trTab = (sc === "user") ? "user" : "project";',
    '  return sc;',
    '}',
    'window.__probe = function(payload, clickTab){',
    '  var sc = __door(clickTab);',
    '  trApplyData(payload);',
    '  if(clickTab && sc === "project"){ var tb = document.querySelector("[data-trtab=\'" + clickTab + "\']"); if(tb) tb.click(); }',
    '  return __snap();',
    '};',
    //  들어온 문이 **보이는 탭과 부제**를 정한다(계약⑥-DOM(scope)) — 문을 곧장 고른다(탭 클릭이 아니다).
    'window.__probeScope = function(payload, scope){',
    '  __door(scope === "user" ? "user" : null);',
    '  trApplyData(payload);',
    '  return __snap();',
    '};',
    //  탭 전환은 탭 줄을 통째로 다시 만든다 — 그때 포커스가 body 로 떨어지지 않는지 본다(키보드 사용자에게 치명적).
    //   ★ 탭 줄이 있는 쪽(과제)에서만 물을 수 있는 계약이다 — 퇴사자 쪽은 탭이 하나라 줄 자체를 안 그린다.
    'window.__probeFocus = function(payload, clickTab){',
    '  __door(null);',
    '  trApplyData(payload);',
    '  var first = document.querySelector("[data-trtab=\'project\']");',
    '  first.focus();',
    '  var started = document.activeElement === first;',
    '  var target = document.querySelector("[data-trtab=\'" + clickTab + "\']");',
    '  target.click();',
    '  var act = document.activeElement;',
    '  return { started: started, onTab: (act && act.dataset) ? String(act.dataset.trtab || "") : "",',
    '           isBody: act === document.body };',
    '};',
  ].join('\n');
}

// 쓰기 잠금(진행 중 표시) — trSend·trSetSaving·trAfterWrite 가 실제로 행 버튼과 overlay 를 잠그고 푸는지 본다.
//   ★ 2026-09-14: 왕복은 hostRequest 다 — 그것을 **우리 손에 둔다**(바꿔 끼운다). 회신을 무엇으로 돌려줄지
//     시험이 정하고, 그 회신은 trSend 를 부른 **그 자리로** 돌아온다(요청 표도 워치독도 없다).
//   ★ setTimeout 은 세기만 한다(바꿔치기가 아니다) — 워치독이 되살아나면 그 수가 0 이 아니게 된다.
function busyHarnessJs(src) {
  return [
    'var __trData = null, __trTab = "project", __trAdmin = false, __trSaving = false;',
    'var __trScope = "project";',   // 어느 문으로 들어왔나 — 보이는 탭을 정한다(2026-09-18)
    'var __uaInactive = false, HOST = true, __toasts = [];',
    'var __sent = [], __reply = null, __timers = 0;',
    'var __realSetTimeout = window.setTimeout;',
    'window.setTimeout = function(fn, ms){ __timers++; return __realSetTimeout(fn, ms); };',
    'function hostRequest(cmd, params, timeoutMs){',
    '  __sent.push({ cmd: String(cmd), timeoutMs: timeoutMs, params: JSON.parse(JSON.stringify(params || {})) });',
    '  return Promise.resolve(__reply);',
    '}',
    'function toast(m, k){ __toasts.push({ msg: String(m), kind: String(k || "") }); }',
    'function trRestore(){} function trDelete(){}',
    //  명부 쪽 좌석(uaSeatReply)의 **내용**은 이 계약과 무관하다 — 앉힐까 미룰까는 「구성원 편집」 시험이
    //  진다(계약⑭-e). 여기서 재는 것은 하나다: **휴지통 회신이 그 문을 지나는가**(수를 센다).
    'var __rosters = 0;',
    'function uaSeatReply(json, cmd){ if(json) __rosters++; }',
    constLine(src, 'josa'),
    constLine(src, 'trEmptyLabel'),
    constBlock(src, 'const TR_TABS = ['),
    constLine(src, 'trTabDef'),
    constLine(src, 'trRows'),
    constLine(src, 'trTabs'),
    extractFunction(src, 'trApplyData'),
    extractFunction(src, 'trRender'),
    extractFunction(src, 'trListTop'),
    extractFunction(src, 'trSeat'),
    //  ★ 실패 문장의 한 곳(2026-09-14 W4) — trSend 가 이것으로 회신의 말을 정한다(uaSend 와 같은 함수다).
    extractFunction(src, 'hostWriteMsg'),
    extractFn(src, 'trSend'),
    //  ★ 잠금은 **그 자리에서** 걸린다(2026-09-14) — trSetSaving 이 trSyncControls 를 부르고, 그것이
    //    lockLineBtn 으로 한 버튼씩 끈다. 둘 다 떼어 오지 않으면 잠금 계약이 아예 돌지 못한다.
    extractFunction(src, 'lockLineBtn'),
    extractFunction(src, 'trSyncControls'),
    extractFunction(src, 'trSetSaving'),
    extractFunction(src, 'trAfterWrite'),
    'function __state(){',
    '  var ov = document.getElementById("trashModal");',
    '  return { busy: ov ? String(ov.dataset.busy || "") : "",',
    '    ops: Array.prototype.map.call(document.querySelectorAll("#trList [data-top]"), function(b){',
    '      return { op: b.dataset.top, key: b.dataset.tkey, disabled: !!b.disabled }; }),',
    '    posts: __sent.length, toasts: __toasts.slice() };',
    '}',
    //  ★ 'user' 는 탭이 아니라 **문**이다(2026-09-18) — 퇴사자 쪽에는 탭 줄이 없어 눌러서 갈 수 없다.
    'function __reset(payload, clickTab){',
    '  var sc = (clickTab === "user") ? "user" : "project";',
    '  __trData = null; __trAdmin = false; __trSaving = false;',
    '  __trScope = sc; __trTab = (sc === "user") ? "user" : "project";',
    '  __sent.length = 0; __toasts.length = 0; __reply = null; __timers = 0; __rosters = 0;',
    '  trApplyData(payload);',
    '  if(clickTab && sc === "project"){ var tb = document.querySelector("[data-trtab=\'" + clickTab + "\']"); if(tb) tb.click(); }',
    '}',
    'window.__probe = function(payload, clickTab, reply){',
    '  __reset(payload, clickTab);',
    '  var out = { idle: __state() };',
    '  __reply = reply;',
    '  var p1 = trSend({ cmd: "trashDelete", kind: "user", key: "31", confirm: "zzU_a" });',
    '  out.sending = __state();',
    '  var p2 = trSend({ cmd: "trashDelete", kind: "user", key: "31", confirm: "zzU_a" });',
    '  out.second = __state();',
    '  out.inflightTimers = __timers;',
    '  return Promise.all([p1, p2]).then(function(rs){',
    '    out.first = rs[0]; out.refused = rs[1];',
    '    trAfterWrite(rs[0]);',
    '    out.done = __state(); out.timers = __timers; out.sent = __sent.slice();',
    '    return out;',
    '  });',
    '};',
    //  왕복 **중에** 목록이 통째로 다시 앉는다 — 그래도 잠금이 남아 있어야 한다.
    //  (잠금을 노드에 칠해 두던 옛 판은 바로 여기서 증발했다 · 2026-09-11)
    'window.__probeRerender = function(payload, clickTab, reply){',
    '  __reset(payload, clickTab);',
    '  __reply = reply;',
    '  var p = trSend({ cmd: "trashDelete", kind: "user", key: "31", confirm: "zzU_a" });',
    '  var out = { sending: __state() };',
    '  window.__applyTrashLike();',   // 목록이 앉는 경로(trApplyData)를 그대로 태워 다시 그린다
    '  out.afterPush = __state();',
    '  return p.then(function(r){ trAfterWrite(r); out.done = __state(); return out; });',
    '};',
    //  ★ 시험 쪽 대역이다 — 앱의 수신부를 쓰지 않고 trApplyData 를 곧장 부른다. 그래서 2026-09-14 에
    //    웹의 __applyTrash 수신부가 사라진 뒤에도 이 탐침은 그대로 선다(이름만 그 시절에서 왔다).
    'window.__applyTrashLike = function(){ trApplyData(JSON.parse(JSON.stringify(__trData))); };',
    //  ★ 렌더 횟수를 센다(2026-09-11 R2-W4) — '몇 번 그리는가'는 화면 결과만 봐서는 보이지 않는다.
    //    원본 함수를 감싸기만 한다(바꿔치기가 아니다): 세는 것 말고는 같은 함수가 돈다.
    'var __renders = 0;',
    'var __trRenderReal = trRender;',
    'trRender = function(){ __renders++; return __trRenderReal.apply(null, arguments); };',
    //  목록이 새로 앉는 것은 **복구·삭제 회신**이 오는 길이다(trAfterWrite → trSeat) — 보던 자리와 쥐고
    //  있던 버튼이 그대로여야 한다. 맨 위가 옳은 것은 **탭을 바꿨을 때**뿐이다(2026-09-14 W2).
    'window.__probeScrollKeep = function(payload, toTab){',
    '  __reset(payload, null);',
    '  var list = document.getElementById("trList");',
    '  var b = document.querySelector("#trList [data-top=\'restore\']");',
    '  var key = b ? String(b.dataset.tkey || "") : "";',
    '  list.scrollTop = 120;',
    '  var set = list.scrollTop;',
    '  if(b) b.focus();',
    '  var started = !!(b && document.activeElement === b);',
    '  window.__applyTrashLike();',   // 목록이 새로 앉았다(복구·삭제 회신이 이 길이다) — 자리는 그대로
    '  var seated = list.scrollTop;',
    '  var a = document.activeElement;',
    '  var kept = { op: (a && a.dataset) ? String(a.dataset.top || "") : "",',
    '               key: (a && a.dataset) ? String(a.dataset.tkey || "") : "",',
    '               isBody: a === document.body,',
    '               sameNode: !!(b && document.body.contains(b)) };',
    '  list.scrollTop = 120;',
    '  var tb = document.querySelector("[data-trtab=\'" + toTab + "\']");',
    '  if(tb) tb.click();',           // 탭 전환 — 보이는 목록이 통째로 다른 것이 된다 → 맨 위
    '  var switched = list.scrollTop;',
    '  return { set: set, started: started, key: key, seated: seated, kept: kept,',
    '           switched: switched, found: !!tb };',
    '};',
    //  ★ 화살표키 탭 전환(tablistRoving)의 배선은 bind() 안이라 떼어 올 수 없다 — 그 한 줄이 마우스와
    //    같은 규칙인지는 형태 쪽 계약(renderKeepsPlace)이 본다.
    //  잠금은 **목록을 다시 만들지 않고** 그 자리에서 걸린다. 포커스를 쥔 버튼이 꺼질 때만 그 행으로
    //  물러났다가, 풀리면 그 버튼으로 돌아온다 — 행도 버튼도 같은 노드 그대로다.
    'window.__probeLockFocus = function(payload, clickTab){',
    '  __reset(payload, clickTab);',
    '  var list = document.getElementById("trList");',
    '  var b = document.querySelector("#trList [data-top=\'restore\']");',
    '  if(!b) return { found: false };',
    '  list.scrollTop = 120;',
    '  b.focus();',
    '  var started = document.activeElement === b;',
    '  var key = String(b.dataset.tkey || "");',
    '  trSetSaving(true);',
    '  var a1 = document.activeElement;',
    '  var locked = { isBody: a1 === document.body,',
    '                 line: !!(a1 && a1.classList && a1.classList.contains("mba-line")),',
    '                 op: (a1 && a1.dataset) ? String(a1.dataset.top || "") : "",',
    '                 off: !!b.disabled, top: list.scrollTop,',
    //  ★ 노드가 그대로 살아 있는가 — 잠금이 목록을 다시 만들었다면 거짓이 된다.
    '                 sameNode: document.querySelector("#trList [data-top=\'restore\']") === b };',
    '  trSetSaving(false);',
    '  var a2 = document.activeElement;',
    '  var unlocked = { isBody: a2 === document.body,',
    '                   op: (a2 && a2.dataset) ? String(a2.dataset.top || "") : "",',
    '                   key: (a2 && a2.dataset) ? String(a2.dataset.tkey || "") : "",',
    '                   disabled: !!(a2 && a2.disabled), top: list.scrollTop };',
    '  return { found: true, started: started, key: key, locked: locked, unlocked: unlocked };',
    '};',
    //  잠금 중에 관리자가 **다른 행**으로 포커스를 옮겼다면, 푸는 쪽은 그것을 도로 뺏지 않는다(옛 R4-W4 의 요구).
    //   ★ 이제 행도 버튼도 다시 만들어지지 않으므로 '어느 행이었나'를 열쇠로 대조할 필요가 없다 —
    //     돌아갈 자리를 적어 둔 그 행 노드에 포커스가 아직 있는지만 보면 된다.
    'window.__probeFocusMoved = function(payload, clickTab){',
    '  __reset(payload, clickTab);',
    '  var b = document.querySelector("#trList [data-top=\'restore\']");',
    '  if(!b) return { found: false };',
    '  b.focus();',
    '  var key = String(b.dataset.tkey || "");',
    '  trSetSaving(true);',   // 잠금 — 포커스가 그 행으로 물러나고, 돌아갈 자리를 그 행에 적어 둔다
    '  var lines = document.querySelectorAll("#trList .mba-line");',
    '  var other = lines.length > 1 ? lines[1] : null;',
    '  if(!other) return { found: true, twoRows: false };',
    '  var otherKey = String(other.dataset.tkey || "");',
    '  other.focus();',      // 관리자가 다른 행으로 옮겼다
    '  var moved = document.activeElement === other;',
    '  trSetSaving(false);', // 잠금 해제 — 여기서 도로 뺏으면 결함이다
    '  var a = document.activeElement;',
    '  return { found: true, twoRows: true, key: key, otherKey: otherKey, moved: moved,',
    '           op: (a && a.dataset) ? String(a.dataset.top || "") : "",',
    '           actKey: (a && a.dataset) ? String(a.dataset.tkey || "") : "",',
    //  ★ '뺏지 않았다'로는 부족하다(R5-W1) — 아무도 앉히지 않으면 포커스는 body 다. 어디에 앉았는지까지 본다.
    '           isBody: a === document.body,',
    '           sameRow: a === other,',
    '           line: !!(a && a.classList && a.classList.contains("mba-line")) };',
    '};',
    //  잠금은 목록을 **한 번도** 다시 만들지 않는다 — 켜든 끄든, 같은 값을 다시 넣든 0 번이다(2026-09-14).
    'window.__probeRenderCount = function(payload, clickTab){',
    '  __reset(payload, clickTab);',
    '  __renders = 0;',
    '  trSetSaving(false);',   // 이미 꺼져 있다
    '  var noop = __renders;',
    '  trSetSaving(true);',    // 꺼짐 → 켜짐
    '  var on = __renders;',
    '  trSetSaving(true);',    // 이미 켜져 있다
    '  var again = __renders;',
    '  trSetSaving(false);',   // 켜짐 → 꺼짐
    '  var off = __renders;',
    '  return { noop: noop, on: on - noop, again: again - on, off: off - again };',
    '};',
    //  회신은 **그 버튼을 누른 자리로** 돌아온다(2026-09-14) — 지난 요청의 늦은 회신이 지금 대상의
    //  결과로 먹히던 자리는 구조적으로 사라졌다(Promise 는 자기 호출자에게 한 번만 풀린다).
    //  그래서 여기서 보는 것은 '내 회신이 내 자리로 왔는가'와 '그 회신의 목록이 앉는가' 다.
    'window.__probeReplySeats = function(payload, clickTab, reply){',
    '  __reset(payload, clickTab);',
    '  __reply = reply;',
    '  return trSend({ cmd: "trashDelete", kind: "user", key: "31", confirm: "zzU_a" }).then(function(r){',
    '    trAfterWrite(r);',
    '    return { reply: r, state: __state(), sent: __sent.slice(), timers: __timers, rosters: __rosters };',
    '  });',
    '};',
  ].join('\n');
}

function ctHarnessJs(src) {
  return [
    'function $(s){ return document.querySelector(s); }',
    'function openModal(sel){ var ov = $(sel); if(ov) ov.classList.remove("hidden"); }',
    'function closeOverlay(ov){ if(ov) ov.classList.add("hidden"); }',
    extractFunction(src, 'confirmTyped'),
    'window.__probe = function(mustType, typings){',
    '  var out = [];',
    '  confirmTyped("과제 영구 삭제", "본문", mustType, "영구 삭제");',
    '  var ok = document.getElementById("ctOk"), inp = document.getElementById("ctInput");',
    '  out.push({ at: "(열림)", disabled: !!ok.disabled, label: String(ok.textContent || ""),',
    '             labelFor: String(document.getElementById("ctLabel").textContent || ""), value: String(inp.value) });',
    '  for(var i = 0; i < typings.length; i++){',
    '    inp.value = typings[i];',
    '    inp.dispatchEvent(new window.Event("input"));',
    '    out.push({ at: JSON.stringify(typings[i]), disabled: !!ok.disabled });',
    '  }',
    '  return out;',
    '};',
    //  ★ 앱의 모달 공통 배선(× · 취소 · 배경)과 **같은 모양**으로 [data-close] 를 묶는다. 이 하네스는 앱을
    //    부팅하지 않으므로 그 배선이 없고, 없으면 '취소를 눌렀을 때'를 아예 재 볼 수 없다.
    '(function(){ var ov = document.getElementById("confirmTypedModal");',
    '  ov.addEventListener("click", function(ev){',
    '    if(ev.target === ov || (ev.target.closest && ev.target.closest("[data-close]"))) closeOverlay(ov);',
    '  }); })();',
    'window.__probeCancel = function(){',
    '  var p = confirmTyped("과제 영구 삭제", "본문", "zzP 과제 A", "영구 삭제");',
    '  var inp = document.getElementById("ctInput");',
    '  inp.value = "zzP 과제 A";',
    '  inp.dispatchEvent(new window.Event("input"));',
    '  var okBtn = document.getElementById("ctOk");',
    '  var armed = !okBtn.disabled;',   // 전제: 이름을 다 쳐서 [영구 삭제]가 켜진 상태에서 취소를 누른다
    '  var cancel = document.querySelector("#confirmTypedModal .modal-foot [data-close]");',
    '  var found = !!cancel;',
    '  if(cancel) cancel.click();',
    '  return p.then(function(v){',
    '    return { result: String(v), armed: armed, found: found,',
    '             hidden: document.getElementById("confirmTypedModal").classList.contains("hidden") };',
    '  });',
    '};',
  ].join('\n');
}

//  ★ overlay(#trashModal)까지 감싼다 — 쓰기 잠금이 dataset.busy 를 그 요소에 세운다(closeOverlay 의 busy 가드).
const RENDER_FIXTURE = '<!doctype html><html><body><div class="overlay" id="trashModal">' +
  '<div class="set-hint" id="trScope">—</div><div id="trTabs"></div><div id="trList"></div>' +
  '<div class="set-hint hidden" id="trEmpty"></div></div></body></html>';
//  ★ 마크업을 **원본에서** 실어 온다(사본을 적으면 마크업이 바뀌어도 시험은 옛 모양을 계속 통과시킨다).
//    최상위에서 오려 내지 않는 이유: import 루프에서 던지면 전 스위트 판정이 증발한다(러너 규약).
const ctFixture = (src = app) => '<!doctype html><html><body>' + confirmTypedMarkupRaw(src) + '</body></html>';

//  회신 본보기 — 다섯 표를 한 화면이 진다는 계약을 한 덩어리로 시험한다.
//    · 과제 2(둘 다 삭제 가능 · 하나는 편입 2건) · 인력 2(하나는 기록 7건이라 삭제 불가)
//    · 발주처 1(쓰는 과제 1건이라 삭제 불가) · 구분 0(빈 탭) · 상태 1
const WHY_USER = '기록 7건이 있어 지울 수 없습니다. 퇴사 상태로 유지됩니다.';
const WHY_CUST = '이 값을 쓰는 과제가 1건(숨긴 과제 포함) 있어 지울 수 없습니다.';
const PAYLOAD = {
  found: true,
  admin: true,
  projects: [
    { key: 'zzP-uid-1', name: 'zzP 과제 A', sub: 'zzC 발주처 · 개발', refs: 2, deletable: true, why: '' },
    { key: 'zzP-uid-2', name: 'zzP 과제 B', sub: 'zzC 발주처 · 연구', refs: 0, deletable: true, why: '' },
  ],
  users: [
    { key: '31', name: 'zzU_a', sub: 'zzU-조직 · 사원 · zzUa', refs: 0, deletable: true, why: '' },
    { key: '32', name: 'zzU_b', sub: 'zzU-조직 · 대리 · zzUb', refs: 7, deletable: false, why: WHY_USER },
  ],
  customers: [{ key: 'zzC 발주처', name: 'zzC 발주처', sub: '', refs: 1, deletable: false, why: WHY_CUST }],
  sections: [],
  statuses: [{ key: 'zzT 상태', name: 'zzT 상태', sub: '', refs: 0, deletable: true, why: '' }],
};
//  ★ 부제의 건수는 **그 문이 보여 주는 표들**만 센다(2026-09-18) — 과제 쪽 문은 넷(2+1+0+1),
//    퇴사자 쪽 문은 인력 하나(2)다. 다섯을 다 세면 화면에 없는 것까지 세어 말하게 된다.
const TOTAL = 4;        // 과제 2 + 발주처 1 + 구분 0 + 상태 1
const TOTAL_USER = 2;   // 인력 2

//  ★ jsdom 부팅·JSON 왕복은 harness 의 runInJsdom 한 곳에 있다(사본은 반드시 낡는다).
//    JSON 왕복이 필요한 이유: jsdom 의 Array 는 다른 realm 이라 deepStrictEqual 이
//    프로토타입 불일치로 항상 실패한다(값은 같은데 판정이 거짓말을 한다).
const probeRender = (payload, clickTab, src = app) => runInJsdom(RENDER_FIXTURE, renderHarnessJs(src), '__probe', payload, clickTab);
const probeFocus = (payload, clickTab, src = app) => runInJsdom(RENDER_FIXTURE, renderHarnessJs(src), '__probeFocus', payload, clickTab);
//  어느 문으로 들어왔나(scope)가 보이는 탭·부제를 정한다 — 탭을 눌러 가는 것이 아니라 문을 고른다.
const probeScopeDoor = (payload, scope, src = app) => runInJsdom(RENDER_FIXTURE, renderHarnessJs(src), '__probeScope', payload, scope);
//  ★ 왕복이 된 뒤로 probe 도 Promise 를 돌려준다 — harness 의 runInJsdom 은 동기 창구 전용이라 여기서
//    같은 일을 한 번 더 한다(그 파일은 이 작업의 소유가 아니다).
async function runInJsdomAsync(fixture, js, name, ...args) {
  const dom = new jsdom.JSDOM(fixture, { runScripts: 'outside-only' });
  dom.window.eval(js);
  const fn = dom.window[name];
  assert.ok(typeof fn === 'function', `runInJsdomAsync: window.${name} 창구가 없다 — 판정 불가`);
  return JSON.parse(JSON.stringify(await fn(...args)));
}
//  회신 하나를 만드는 손잡이 — 호스트가 돌려줄 모양 { ok, msg, trash, roster } 그대로다.
const trReply = (ok, msg, trash, roster) => ({
  ok: !!ok, msg: String(msg || ''),
  trash: trash ? JSON.stringify(trash) : '', roster: roster ? JSON.stringify(roster) : '',
});
const probeBusy = (payload, clickTab, rep, src = app) =>
  runInJsdomAsync(RENDER_FIXTURE, busyHarnessJs(src), '__probe', payload, clickTab, rep);
const probeRerender = (payload, clickTab, rep, src = app) =>
  runInJsdomAsync(RENDER_FIXTURE, busyHarnessJs(src), '__probeRerender', payload, clickTab, rep);
const probeReplySeats = (payload, clickTab, rep, src = app) =>
  runInJsdomAsync(RENDER_FIXTURE, busyHarnessJs(src), '__probeReplySeats', payload, clickTab, rep);
const probeRenderCount = (payload, clickTab, src = app) => runInJsdom(RENDER_FIXTURE, busyHarnessJs(src), '__probeRenderCount', payload, clickTab);
const probeScrollKeep = (payload, toTab, src = app) => runInJsdom(RENDER_FIXTURE, busyHarnessJs(src), '__probeScrollKeep', payload, toTab);
const probeLockFocus = (payload, clickTab, src = app) => runInJsdom(RENDER_FIXTURE, busyHarnessJs(src), '__probeLockFocus', payload, clickTab);
const probeFocusMoved = (payload, clickTab, src = app) => runInJsdom(RENDER_FIXTURE, busyHarnessJs(src), '__probeFocusMoved', payload, clickTab);
const probeTyped = (mustType, typings, src = app) => runInJsdom(ctFixture(src), ctHarnessJs(src), '__probe', mustType, typings);
//  ★ [취소]는 **진짜 클릭**으로 본다(closeModal 직접 호출이 아니라). confirmTyped 의 해소는 MutationObserver 라
//    비동기다 — 그래서 이 한 건만 Promise 를 기다린다.
async function probeTypedCancel(src = app) {
  const { JSDOM } = jsdom;
  const dom = new JSDOM(ctFixture(src), { runScripts: 'outside-only' });
  dom.window.eval(ctHarnessJs(src));
  return JSON.parse(JSON.stringify(await dom.window.__probeCancel()));
}

//  퇴사자 쪽 문(#uaTrash) — uaAdminBar 하나만 떼어 내 관리자·순서편집·왕복 상태로 굴린다
//  (user-admin.test.mjs 와 같은 방식이되 그 파일을 import 하지 않는다: 시험끼리 얽히면 한쪽 실패가
//   다른 쪽 판정을 덮는다). 여기서 보는 것은 '그 문이 언제 DOM 에 있는가' 하나다.
function doorHarnessJs(src) {
  return [
    'var __uaAdmin = false, __uaOrder = false, __uaSaving = false, __uaInactive = false, __uaPendingData = null;',
    '// 이 계약과 무관한 협력자는 빈 함수로.',
    'function openTrash(){} function uaOrderToggle(){} function uaOrderSave(){} function userEdOpen(){}',
    'function uaReload(){} function uaListTop(){} function toast(){} function openOrgTitle(){}',
    extractFunction(src, 'uaAdminBar'),
    'window.__probe = function(admin, order, saving){',
    '  __uaAdmin = !!admin; __uaOrder = !!order; __uaSaving = !!saving;',
    '  __uaInactive = false; __uaPendingData = null;',
    '  uaAdminBar();',
    '  var bar = document.getElementById("uaAdmin");',
    '  var t = document.getElementById("uaTrash");',
    '  var ids = Array.prototype.map.call(bar.querySelectorAll("button"), function(b){ return String(b.id || ""); });',
    '  return { present: !!t, text: t ? String(t.textContent || "") : "",',
    '           inBar: t ? t.parentNode === bar : null, disabled: !!(t && t.disabled),',
    '           ids: ids, barBtns: ids.length };',
    '};',
  ].join('\n');
}
//  ★ 마크업과 같은 모양이다 — 상단 막대도 하단 자리도 **비어 있다**(숨김 ≠ 부재).
const DOOR_FIXTURE = '<!doctype html><html><body><div id="uaAdmin"></div>' +
  '<span id="uaFoot"></span></body></html>';
const probeDoor = (admin, order, saving, src = app) =>
  runInJsdom(DOOR_FIXTURE, doorHarnessJs(src), '__probe', admin, order, saving);
//  진짜 관문은 '한 번 만든 뒤 내려갔을 때'다 — 만들어 본 적이 없으면 숨김 변이도 통과한다.
function probeDoorSeq(states, src = app) {
  const { JSDOM } = jsdom;
  const dom = new JSDOM(DOOR_FIXTURE, { runScripts: 'outside-only' });
  dom.window.eval(doorHarnessJs(src));
  return states.map((s) => JSON.parse(JSON.stringify(dom.window.__probe(s[0], s[1], s[2]))));
}

if (!jsdom) {
  const { skip } = await import('./harness.mjs');
  skip('계약⑥-DOM(a): 「퇴사자 휴지통」 문은 관리자·비순서편집일 때만 DOM 에 있다', SKIP_NO_JSDOM, '이 파일의 DOM 계약 6건이 세어지지 않음');
  skip('계약⑥-DOM(scope): 들어온 문이 보이는 탭과 부제를 정한다', SKIP_NO_JSDOM);
  skip('변이⑥-DOM(scope): 탭을 거르지 않으면 과제 쪽 문에 퇴사자 탭이 선다', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(b): admin:false 면 탭도 행도 그리지 않는다(안내 한 줄뿐)', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(c): admin:true 면 탭 넷(과제 쪽) + 현재 탭의 행을 그린다', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(d): 삭제 불가 항목은 [영구 삭제]가 꺼지고 사유가 title 에 붙는다', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(e): 빈 탭 문구의 조사는 받침이 정한다', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(f): 삭제 불가 사유가 행에 보이는 줄로 나온다', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(g): 탭 줄은 tablist 이고 전환해도 포커스가 남는다', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(h): 비관리자 안내는 호스트가 준 사유를 그대로 쓴다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(c): 전송 중에는 행 버튼이 잠기고 두 번째 클릭은 사유가 뜬다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(e): 왕복 중 푸시가 목록을 다시 그려도 잠금이 남는다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(f): 회신은 그 버튼을 누른 자리로 돌아오고, 실려 온 목록이 앉는다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(f): 회신의 목록을 안 앉히면 지운 항목이 화면에 그대로 남는다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(h): 잠금은 목록을 한 번도 다시 만들지 않는다(켜든 끄든 0 번)', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(i): 목록이 새로 앉아도 자리·포커스는 그대로, 탭을 바꾸면 맨 위다(W2)', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(i2): 탭 전환의 맨 위 한 줄을 지우면 새 탭이 옛 자리에서 열린다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(l): 회신이 안 온 왕복은 토스트에 결과를 모른다고 말한다(W4)', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(l): 실패 문장을 다시 msg||error 로 뭉치면 타임아웃이 맨 문장으로 나간다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(j): 잠금은 목록을 다시 만들지 않고, 포커스는 행으로 물러났다 돌아온다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(i): 렌더가 스스로 맨 위로 보내면 복구 한 번에 자리와 포커스를 잃는다(W2)', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(j): 행이 포커스를 못 받으면 잠기는 순간 포커스가 body 로 떨어진다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(k): 잠금 중에 옮긴 포커스를 풀 때 도로 뺏지 않는다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(k): 옮겨 갔는지 보지 않고 되돌리면 포커스가 원래 행으로 끌려간다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(h): 잠금을 렌더로 반영하게 되돌리면 계약⑦-DOM(h) 가 실패한다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(e): 렌더에서 잠금을 빼면 푸시 한 번에 잠금이 증발한다', SKIP_NO_JSDOM);
  skip('변이⑥-DOM: 세 계약이 각각 한 줄 변이로 깨진다', SKIP_NO_JSDOM);
  skip('변이⑥-DOM(f): 사유 줄을 지우면 계약⑥-DOM(f) 가 실패한다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(c): 잠금 복구를 무조건 켜기로 바꾸면 계약⑦-DOM(c) 가 실패한다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM: 이름이 글자까지 같을 때만 [영구 삭제]가 켜진다(trim 없음)', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(d): [취소]를 실제로 누르면 확인창이 cancel 로 해소된다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM: 대조에 trim 을 끼우면 앞뒤 공백이 통과한다', SKIP_NO_JSDOM);
} else {
  test('계약⑥-DOM(a): 「퇴사자 휴지통」 문은 관리자·비순서편집일 때만 DOM 에 있다(숨김이 아니라 부재)', () => {
    //  ① 비관리자 — 막대 자체가 비어 있다(위도 아래도 컨트롤이 하나도 없다).
    const off = probeDoor(false, false, false);
    assert.strictEqual(off.present, false,
      '관리자가 아닌데 「퇴사자 휴지통」이 DOM 에 있다 — 영구 삭제의 문은 관리자만 본다');
    assert.strictEqual(off.barBtns, 0, `비관리자 막대에 버튼이 ${off.barBtns}개 있다: ${JSON.stringify(off.ids)}`);
    //  ② 관리자 · 평소 — 「순서 편집」 **뒤에** 선다(관리 동작끼리 붙어 있고, 조회 조건은 그 뒤다).
    const on = probeDoor(true, false, false);
    assert.strictEqual(on.present, true, '관리자인데 「퇴사자 휴지통」이 만들어지지 않았다');
    assert.strictEqual(on.text, '퇴사자 휴지통', `버튼 문구가 다르다: ${JSON.stringify(on.text)}`);
    assert.strictEqual(on.inBar, true, '「퇴사자 휴지통」이 상단 막대(#uaAdmin)가 아닌 곳에 앉았다');
    //  ★ 2026-09-18 — 막대에 「직급·소속 관리」(#uaOrgTitle)가 한 자리 늘었다(ORG-TITLE-ADMIN §5.0).
    //    휴지통 **뒤**다: 이 파일이 보는 것은 여전히 '퇴사자 휴지통이 어디에 서는가' 하나이고,
    //    구성을 통째로 적어 두는 이유는 옆자리가 조용히 늘거나 줄면 그것도 계약 변경이기 때문이다.
    assert.deepStrictEqual(on.ids, ['uaOrderEdit', 'uaTrash', 'uaOrgTitle'],
      `상단 막대의 버튼 구성이 계약과 다르다: ${JSON.stringify(on.ids)} — 「순서 편집」 다음이 「퇴사자 휴지통」이고 그다음이 「직급·소속 관리」다`);
    //  ③ 순서 편집 중 — 없다. 휴지통을 열면 명부를 다시 읽어 **편집 중인 순서를 날린다**(등록과 같은 이유).
    const ord = probeDoor(true, true, false);
    assert.strictEqual(ord.present, false,
      '순서 편집 중인데 「퇴사자 휴지통」이 서 있다 — 열면 명부를 다시 읽어 편집 중인 순서가 날아간다');
    //  ④ 쓰기 왕복 중 — 서 있되 꺼진 채다(렌더가 __uaSaving 을 보고 그린다).
    const busy = probeDoor(true, false, true);
    assert.strictEqual(busy.present, true, '왕복 중이라고 문이 사라졌다 — 잠금은 부재가 아니다');
    assert.strictEqual(busy.disabled, true,
      '왕복 중인데 「퇴사자 휴지통」이 켜져 있다 — 결과를 기다리는 중에 휴지통이 열려 명부를 다시 읽는다');
    //  ★ 진짜 관문: 관리자였다가 내려간 경우. 숨김으로 바꾸면 여기서만 드러난다.
    const seq = probeDoorSeq([[true, false, false], [false, false, false], [true, false, false], [true, true, false]]);
    assert.deepStrictEqual(seq.map((x) => x.present), [true, false, true, false],
      `상태가 바뀔 때 문이 생겼다 사라지지 않는다: ${JSON.stringify(seq.map((x) => x.present))}`);
    assert.deepStrictEqual(seq.map((x) => x.barBtns), [3, 0, 3, 2],
      `막대가 비었다 채워지지 않는다: ${JSON.stringify(seq.map((x) => x.barBtns))}`);
  });

  //  ★ 문이 둘인데 화면은 하나다(2026-09-18) — 들어온 문(__trScope)이 **보이는 탭과 부제**를 정한다.
  //    퇴사자 쪽은 고를 것이 하나라 탭 줄 자체를 그리지 않는다: 없는 선택지를 가리키는 탭은 거짓말이고,
  //    탭이 하나도 없는데 role=tablist 라고 하면 보조기술에 없는 구조를 알린다.
  test('계약⑥-DOM(scope): 들어온 문이 보이는 탭과 부제를 정한다(과제 넷 · 퇴사자 탭 줄 없음)', () => {
    const p = probeScopeDoor(PAYLOAD, 'project');
    assert.deepStrictEqual(p.tabs.map((t) => t.kind), ['project', 'customer', 'section', 'status'],
      `과제 쪽 문의 탭 구성이 계약과 다르다: ${JSON.stringify(p.tabs.map((t) => t.kind))} — 퇴사자는 여기 없다`);
    assert.ok(!p.tabs.some((t) => t.kind === 'user'),
      '과제 쪽 문에 퇴사자 탭이 섞였다 — 그 문은 「구성원 편집」에 따로 있다');
    assert.strictEqual(p.tabsRole, 'tablist', '탭이 넷인데 #trTabs 가 tablist 가 아니다');
    assert.strictEqual(p.tabsClass, 'tabs', '탭 줄이 기존 탭 컨트롤(.tabs)을 쓰지 않는다');
    assert.ok(p.scope.startsWith('숨긴 항목 '), `과제 쪽 부제가 계약과 다르다: ${JSON.stringify(p.scope)}`);

    const u = probeScopeDoor(PAYLOAD, 'user');
    assert.strictEqual(u.tabs.length, 0,
      `퇴사자 쪽 문에 탭이 ${u.tabs.length}개 그려졌다 — 고를 것이 하나인데 탭을 그리면 없는 선택지를 가리킨다`);
    assert.strictEqual(u.tabsRole, '', '탭이 하나도 없는데 #trTabs 에 role 이 남아 있다 — 보조기술에 없는 구조를 알린다');
    assert.strictEqual(u.listRole, '', '탭 줄이 없는데 #trList 가 tabpanel 이다 — 가리킬 탭이 없다');
    assert.strictEqual(u.tabsClass, '', '탭이 없는데 탭 줄 클래스가 남았다 — 빈 자리에 밑줄만 선다');
    assert.strictEqual(u.lines, PAYLOAD.users.length,
      `퇴사자 쪽 문에 행이 ${u.lines}개다(${PAYLOAD.users.length}개여야 한다) — 목록은 그대로 그린다`);
    assert.ok(u.scope.startsWith('퇴사자 ') && /명/.test(u.scope),
      `퇴사자 쪽 부제가 '퇴사자 N명 …' 이 아니다: ${JSON.stringify(u.scope)} — 무엇을 보고 있는지 화면이 말해야 한다`);
    assert.ok(/기록이 0건인 계정만 영구 삭제할 수 있습니다/.test(u.scope),
      `퇴사자 쪽 부제가 '무엇을 지울 수 있는가'를 말하지 않는다: ${JSON.stringify(u.scope)}`);
  });

  test('변이⑥-DOM(scope): 탭을 거르지 않으면 과제 쪽 문에 퇴사자 탭이 선다', () => {
    const bad = mutate(app, 'const trTabs = () => TR_TABS.filter(t => t.scope === __trScope);',
      'const trTabs = () => TR_TABS;');
    const r = probeScopeDoor(PAYLOAD, 'project', bad);
    assert.strictEqual(r.tabs.length, 5,
      `변이 전제: 거르지 않으면 탭이 다섯이어야 한다(실제: ${JSON.stringify(r.tabs.map((t) => t.kind))})`);
    assert.strictEqual(probeScopeDoor(PAYLOAD, 'project').tabs.length, 4);   // 통제군
  });

  test('계약⑥-DOM(b): admin:false 면 탭도 행도 그리지 않는다(안내 한 줄뿐)', () => {
    const off = probeRender({ found: true, admin: false });
    assert.strictEqual(off.tabs.length, 0, `admin:false 인데 탭이 ${off.tabs.length}개 그려졌다`);
    assert.strictEqual(off.ops.length, 0, `admin:false DOM 에 조작 버튼이 있다: ${JSON.stringify(off.ops)}`);
    assert.strictEqual(off.lines, 0, 'admin:false 인데 행이 그려졌다 — 휴지통은 보기 화면이 아니다(설계 §6)');
    assert.strictEqual(off.tabsClass, '', 'admin:false 인데 탭 자리에 클래스가 남아 있다 — 빈 자리에 밑줄만 남는다');
    assert.ok(/관리자만 사용할 수 있습니다/.test(off.text),
      `admin:false 안내 문구가 없다(실제: ${JSON.stringify(off.text.slice(0, 60))}) — 빈 화면은 고장처럼 보인다`);
    assert.ok(/관리자만 사용할 수 있습니다/.test(off.scope), '부제까지 안내로 바뀌지 않았다');
  });

  test('계약⑥-DOM(c): admin:true 면 탭 넷(과제 쪽 · 건수 배지) + 현재 탭의 행을 그린다', () => {
    const r = probeRender(PAYLOAD);
    assert.deepStrictEqual(r.tabs.map((t) => t.kind), ['project', 'customer', 'section', 'status'],
      `탭 구성이 계약과 다르다: ${JSON.stringify(r.tabs.map((t) => t.kind))} — 과제 쪽 문이 지는 표는 넷이다(퇴사자는 다른 문)`);
    assert.deepStrictEqual(r.tabs.map((t) => t.text), ['과제2', '발주처1', '구분0', '상태1'],
      `탭 문구·건수 배지가 계약과 다르다: ${JSON.stringify(r.tabs.map((t) => t.text))}`);
    assert.deepStrictEqual(r.tabs.map((t) => t.sel), ['true', 'false', 'false', 'false'],
      '첫 탭(과제)이 선택 상태로 서지 않는다(aria-selected)');
    assert.strictEqual(r.tabsClass, 'tabs', '탭 줄이 기존 탭 컨트롤(.tabs)을 쓰지 않는다 — 세그먼트 문법을 새로 만들지 않는다');
    assert.strictEqual(r.lines, 2, `과제 탭에 행이 ${r.lines}개다(2개여야 한다)`);
    assert.strictEqual(r.acts, 2, '행마다 조작칸(.mba-act)이 서지 않는다');
    assert.strictEqual(r.links, 0, `휴지통 행이 눌린다(.mb-row.is-link ${r.links}개) — 행은 눌리지 않는다(설계 §5.1)`);
    assert.deepStrictEqual(r.ops.map((o) => o.op), ['restore', 'delete', 'restore', 'delete'],
      `행 버튼 구성이 계약과 다르다: ${JSON.stringify(r.ops.map((o) => o.op))}`);
    assert.deepStrictEqual(r.ops.map((o) => o.text), ['복구', '영구 삭제', '복구', '영구 삭제'],
      `행 버튼 문구가 계약과 다르다: ${JSON.stringify(r.ops.map((o) => o.text))}`);
    assert.deepStrictEqual(r.ops.map((o) => o.key), ['zzP-uid-1', 'zzP-uid-1', 'zzP-uid-2', 'zzP-uid-2'],
      '버튼이 호스트가 준 key 를 그대로 달고 있지 않다 — 이름으로 잡으면 동명·한글 이스케이프에서 갈린다');
    assert.deepStrictEqual(r.ops.map((o) => o.disabled), [false, false, false, false],
      '과제는 참조가 있어도 지울 수 있다(설계 §2) — 그런데 버튼이 꺼져 있다');
    assert.strictEqual(r.scope, '숨긴 항목 ' + TOTAL + '건 · 되돌릴 수 없는 삭제는 이름을 입력해야 합니다',
      `부제가 계약과 다르다: ${JSON.stringify(r.scope)}`);
    //  참조 요약은 종류마다 다른 문장이고, 0 이면 아예 내지 않는다.
    assert.ok(/편입 2건/.test(r.text), `과제 행에 '편입 2건' 이 없다: ${JSON.stringify(r.text.slice(0, 120))}`);
    assert.ok(!/편입 0건/.test(r.text), "참조 0건인데 '편입 0건' 을 적었다 — 아무것도 알려 주지 않는 문장이다");
    assert.ok(/zzC 발주처 · 개발/.test(r.text), '부제(발주처·구분)가 행에 없다');
    assert.strictEqual(r.emptyHidden, true, '행이 있는데 빈 탭 안내가 떠 있다');

    const cu = probeRender(PAYLOAD, 'customer');
    assert.ok(/과제 1건/.test(cu.text), `발주처 탭의 참조 문구가 '과제 {n}건' 이 아니다: ${JSON.stringify(cu.text)}`);
    assert.deepStrictEqual(cu.tabs.map((t) => t.sel), ['false', 'true', 'false', 'false'],
      '탭을 눌러도 선택 표시가 따라오지 않는다');
  });

  test('계약⑥-DOM(d): 삭제 불가 항목은 [영구 삭제]가 꺼지고 사유가 title 에 붙는다', () => {
    const r = probeRender(PAYLOAD, 'user');
    assert.strictEqual(r.lines, 2, `인력 탭에 행이 ${r.lines}개다(2개여야 한다)`);
    const dels = r.ops.filter((o) => o.op === 'delete');
    assert.deepStrictEqual(dels.map((o) => o.disabled), [false, true],
      `deletable:false 인 계정의 [영구 삭제]가 꺼지지 않았다: ${JSON.stringify(dels)}`);
    assert.strictEqual(dels[1].title, WHY_USER,
      `불가 사유가 title 에 그대로 붙지 않았다: ${JSON.stringify(dels[1].title)} — 눌러 봐야 거부되는 버튼은 이유를 알려 주지 않는다`);
    assert.deepStrictEqual(r.ops.filter((o) => o.op === 'restore').map((o) => o.disabled), [false, false],
      '[복구]까지 꺼졌다 — 지울 수 없는 계정도 명부로는 되돌릴 수 있어야 한다');
    assert.ok(/기록 7건/.test(r.text), `인력 탭의 참조 문구가 '기록 {n}건' 이 아니다: ${JSON.stringify(r.text)}`);
  });

  test('계약⑥-DOM(e): 빈 탭 문구의 조사는 받침이 정한다(「이(가)」 병기 없음)', () => {
    const r = probeRender(PAYLOAD, 'section');
    assert.strictEqual(r.lines, 0, '빈 탭인데 행이 그려졌다');
    assert.strictEqual(r.emptyHidden, false, '빈 탭인데 안내가 숨겨져 있다 — 빈 화면은 고장처럼 보인다');
    //  ★ 2026-09-10: '숨긴 구분이(가) 없습니다.' → 받침 있는 「구분」은 '이' 하나다.
    assert.strictEqual(r.emptyText, '숨긴 구분이 없습니다.', `빈 탭 안내 문구가 다르다: ${JSON.stringify(r.emptyText)}`);
    //  탭 자체는 남는다 — 0건이라고 탭이 사라지면 '왜 넷이 아니지'가 된다.
    assert.strictEqual(r.tabs.length, 4, '빈 탭을 골랐더니 탭 줄이 무너졌다');
    //  받침 없는 라벨은 '가' 다 — 한 탭만 맞춰 놓고 나머지를 놓치는 것을 막는다.
    const only = (kind) => probeRender({ found: true, admin: true, projects: [], users: [], customers: [], sections: [], statuses: [] }, kind).emptyText;
    assert.strictEqual(only('project'), '숨긴 과제가 없습니다.', `과제 탭 문구가 다르다: ${JSON.stringify(only('project'))}`);
    assert.strictEqual(only('user'), '숨긴 인력이 없습니다.', `인력 탭 문구가 다르다: ${JSON.stringify(only('user'))}`);
    assert.strictEqual(only('customer'), '숨긴 발주처가 없습니다.', `발주처 탭 문구가 다르다: ${JSON.stringify(only('customer'))}`);
    assert.strictEqual(only('status'), '숨긴 상태가 없습니다.', `상태 탭 문구가 다르다: ${JSON.stringify(only('status'))}`);
  });

  test('계약⑥-DOM(f): 삭제 불가 사유는 행에 **보이는 줄**로 나온다(꺼진 버튼의 title 은 뜨지 않는다)', () => {
    const r = probeRender(PAYLOAD, 'user');
    assert.deepStrictEqual(r.whys.map((w) => w.key), ['32'],
      `사유 줄이 붙은 행이 계약과 다르다: ${JSON.stringify(r.whys)} — deletable:false 인 행에만 붙는다`);
    assert.strictEqual(r.whys[0].text, WHY_USER, `사유 줄의 문구가 호스트 문장 그대로가 아니다: ${JSON.stringify(r.whys[0].text)}`);
    //  title 은 그대로 남는다 — 보이는 줄이 생겼다고 기존 손잡이를 없애지 않는다.
    assert.strictEqual(r.ops.filter((o) => o.op === 'delete')[1].title, WHY_USER, '사유가 title 에서 사라졌다');
    //  지울 수 있는 행에는 붙지 않는다(사유가 없으니 할 말도 없다).
    assert.strictEqual(probeRender(PAYLOAD).whys.length, 0, '삭제 가능한 과제 행에 사유 줄이 붙었다');
  });

  test('계약⑥-DOM(g): 탭 줄은 tablist·목록은 tabpanel 이고, 탭을 바꿔도 포커스가 남는다', () => {
    const r = probeRender(PAYLOAD);
    assert.strictEqual(r.tabsRole, 'tablist', `#trTabs 가 tablist 가 아니다: ${JSON.stringify(r.tabsRole)}`);
    assert.strictEqual(r.listRole, 'tabpanel', `#trList 가 tabpanel 이 아니다: ${JSON.stringify(r.listRole)}`);
    assert.deepStrictEqual(r.tabs.map((t) => t.role), ['tab', 'tab', 'tab', 'tab'], '탭 버튼에 role=tab 이 없다');
    assert.deepStrictEqual(r.tabs.map((t) => t.tabIndex), [0, -1, -1, -1],
      `roving tabindex 가 아니다: ${JSON.stringify(r.tabs.map((t) => t.tabIndex))} — 탭 줄은 Tab 한 번으로 지나가야 한다(APG)`);
    //  비관리자에게는 구조 자체가 없다(탭이 없는데 tablist 라고 하면 보조기술에 없는 것을 알린다).
    const off = probeRender({ found: true, admin: false });
    assert.strictEqual(off.tabsRole, '', 'admin:false 인데 tablist role 이 남아 있다');
    assert.strictEqual(off.listRole, '', 'admin:false 인데 tabpanel role 이 남아 있다');
    //  ★ 탭을 누르면 탭 줄이 통째로 다시 그려진다 — 그때 포커스가 body 로 떨어지면 키보드 사용자는 길을 잃는다.
    //    (탭 줄이 있는 쪽, 곧 과제 쪽 문에서만 물을 수 있는 계약이다.)
    const f = probeFocus(PAYLOAD, 'customer');
    assert.strictEqual(f.started, true, '전제 붕괴: 탭 버튼에 포커스가 가지 않았다');
    assert.strictEqual(f.isBody, false, '탭을 바꾸자 포커스가 body 로 떨어졌다 — 다음 화살표키가 아무 데도 닿지 않는다');
    assert.strictEqual(f.onTab, 'customer', `포커스가 새로 선택된 탭에 있지 않다: ${JSON.stringify(f.onTab)}`);
  });

  test('계약⑥-DOM(h): 비관리자 안내는 호스트가 준 사유를 그대로 쓴다(뭉개지 않는다)', () => {
    const MSG = '퇴사 처리된 계정입니다 — 관리자에게 문의하세요.';
    const r = probeRender({ found: true, admin: false, msg: MSG });
    assert.ok(r.text.includes(MSG), `호스트 사유가 목록 자리에 없다: ${JSON.stringify(r.text.slice(0, 80))}`);
    assert.ok(r.scope.includes(MSG), `호스트 사유가 부제에 없다: ${JSON.stringify(r.scope)}`);
    //  msg 가 없으면 예전 기본 문구 그대로다.
    const bare = probeRender({ found: true, admin: false });
    assert.ok(/관리자만 사용할 수 있습니다/.test(bare.text), '사유가 없을 때의 기본 안내가 사라졌다');
  });

  test('계약⑦-DOM(c): 전송 중에는 행 버튼이 모두 잠기고, 두 번째 클릭은 사유를 말한다', async () => {
    const r = await probeBusy(PAYLOAD, 'user', trReply(true, '지웠습니다', null, null));
    assert.deepStrictEqual(r.idle.ops.map((o) => o.disabled), [false, false, false, true],
      `전제 붕괴: 평소 상태의 버튼 구성이 다르다 — ${JSON.stringify(r.idle.ops)}`);
    assert.strictEqual(r.idle.busy, '', '아무것도 안 보냈는데 overlay 가 busy 다');
    //  ① 보내는 순간 — 행 버튼 전부 잠기고 창도 닫히지 않는다.
    assert.deepStrictEqual(r.sending.ops.map((o) => o.disabled), [true, true, true, true],
      `전송 중인데 행 버튼이 잠기지 않았다: ${JSON.stringify(r.sending.ops)} — 같은 삭제를 두 번 누를 수 있다`);
    assert.strictEqual(r.sending.busy, '1', '전송 중인데 overlay dataset.busy 가 서지 않았다 — Esc 로 닫으면 결과를 알릴 곳이 사라진다');
    assert.strictEqual(r.sending.posts, 1, `요청이 ${r.sending.posts}번 나갔다(1번이어야 한다)`);
    //  ② 두 번째 클릭 — 조용히 버리지 않는다.
    assert.strictEqual(r.second.posts, 1, '가드를 뚫고 두 번째 요청이 나갔다');
    const warn = r.second.toasts.filter((t) => /이전 요청을 처리 중입니다/.test(t.msg));
    assert.strictEqual(warn.length, 1, `진행 중 안내가 뜨지 않았다: ${JSON.stringify(r.second.toasts)} — 버튼이 먹지 않는 것으로 보인다`);
    assert.strictEqual(warn[0].kind, 'warn', `진행 중 안내의 종류가 warn 이 아니다: ${JSON.stringify(warn[0])}`);
    //  ③ 회신 뒤 — **원래 꺼져 있던 [영구 삭제]는 그대로 꺼져 있어야 한다**(잠금 한 번이 계약을 뒤집으면 안 된다).
    assert.deepStrictEqual(r.done.ops.map((o) => o.disabled), [false, false, false, true],
      `회신 뒤 버튼 상태가 원래대로 돌아오지 않았다: ${JSON.stringify(r.done.ops)}`);
    assert.strictEqual(r.done.busy, '', '회신이 왔는데 overlay 가 busy 인 채로 남았다 — 창을 닫을 길이 없다');
    //  ④ 회신은 **이 자리로** 돌아오고, 가드에 걸린 두 번째 호출은 null 이다(못 보냈다 ≠ 회신이 왔다).
    assert.ok(r.first && r.first.ok === true, `첫 왕복이 회신을 받지 못했다: ${JSON.stringify(r.first)}`);
    assert.strictEqual(r.refused, null,
      `가드에 걸린 호출이 회신처럼 생긴 값을 돌려줬다: ${JSON.stringify(r.refused)} — '못 보냈다'와 '회신이 왔다'가 구별되지 않는다`);
    //  ⑤ 왕복 내내 잠긴 채로 있고, 그 잠금을 푸는 두 번째 장치(워치독)는 없다.
    assert.strictEqual(r.inflightTimers, 0,
      `왕복을 시작하면서 타이머를 걸었다(${r.inflightTimers}개) — 워치독이 되살아나면 잠금이 도중에 풀리고, 그 틈으로 두 번째 삭제가 나간다`);
    assert.strictEqual(r.timers, 0, `회신 처리에서 타이머를 걸었다(${r.timers}개)`);
    assert.strictEqual(r.sent[0].cmd, 'trashDelete', `보낸 명령이 다르다: ${JSON.stringify(r.sent[0])}`);
    assert.strictEqual(r.sent[0].timeoutMs, 30000, `왕복 타임아웃이 30초가 아니다: ${JSON.stringify(r.sent[0])} — 휴지통의 한 왕복은 DB 를 두세 번 만진다(W4)`);
    assert.ok('includeInactive' in r.sent[0].params,
      `includeInactive 가 함께 나가지 않았다: ${JSON.stringify(r.sent[0].params)} — 인력을 지운 뒤 되읽을 명부가 「퇴사자 보기」 상태를 잃는다`);
  });

  //  ★ W4 — 회신이 **안 온** 왕복. 영구 삭제는 되돌릴 수 없는 조작이라, '결과를 모른다'를 '처리하지
  //    못했습니다'로 말하면 관리자는 **이미 지워진** 항목을 다시 지우려 들거나(그 거부가 또 혼란이다)
  //    지워지지 않은 줄 알고 넘어간다. 무엇을 해야 하는지까지 말해야 한다.
  test('계약⑦-DOM(l): 회신이 안 온 왕복은 토스트에 결과를 모른다고 말한다(W4)', async () => {
    const r = await probeBusy(PAYLOAD, 'user', { ok: false, error: '호스트 응답 시간 초과' });
    assert.strictEqual(r.done.busy, '', '회신이 없었는데 overlay 가 busy 인 채로 남았다 — 창을 닫을 길이 없다');
    const said = r.done.toasts.map((t) => t.msg).join(' | ');
    assert.ok(/결과를 알 수 없습니다/.test(said),
      `타임아웃을 '결과를 모른다'로 말하지 않는다: ${JSON.stringify(r.done.toasts)} — 이미 지워진 항목을 다시 지우려 든다(W4)`);
    assert.ok(/확인한 뒤 다시 시도/.test(said),
      `무엇을 해야 하는지 말하지 않는다: ${JSON.stringify(r.done.toasts)}`);
    assert.ok(!r.done.toasts.some((t) => t.msg === '처리하지 못했습니다'),
      `타임아웃이 평범한 실패로 나갔다: ${JSON.stringify(r.done.toasts)}`);
  });

  test('변이⑦-DOM(l): 실패 문장을 다시 msg||error 로 뭉치면 타임아웃이 맨 문장으로 나간다(W4)', async () => {
    const TIMEOUT = { ok: false, error: '호스트 응답 시간 초과' };
    const bad = mutate(app, '  const rep = { ok: !!(r && r.ok), msg: hostWriteMsg(r),\n',
      "  const rep = { ok: !!(r && r.ok), msg: String((r && (r.msg || r.error)) || ''),\n");
    const r = await probeBusy(PAYLOAD, 'user', TIMEOUT, bad);
    assert.ok(r.done.toasts.some((t) => t.msg === '호스트 응답 시간 초과'),
      `변이 전제: 뭉치면 맨 문장이 그대로 나가야 한다(실제: ${JSON.stringify(r.done.toasts)})`);
    const ctrl = await probeBusy(PAYLOAD, 'user', TIMEOUT);
    assert.ok(ctrl.done.toasts.some((t) => /결과를 알 수 없습니다/.test(t.msg)));   // 통제군
  });

  test('변이⑥-DOM(f): 사유 줄을 지우면 계약⑥-DOM(f) 가 실패한다(title 만 남으면 아무도 못 본다)', () => {
    const bad = mutate(app, "    if(it && it.deletable === false && it.why){", '    if(false){');
    const r = probeRender(PAYLOAD, 'user', bad);
    assert.strictEqual(r.whys.length, 0, '변이 전제: 사유 줄이 사라져야 한다');
    assert.strictEqual(probeRender(PAYLOAD, 'user').whys.length, 1);   // 통제군
  });

  //  ★ '지울 수 있나'를 정하는 곳이 **둘**이다(렌더 · 그 자리에서 거는 잠금) — 둘 다 같은 답을 내야
  //    한다. 그래서 변이도 둘을 함께 친다: 한쪽만 치면 나머지가 되살려 놓아 결함이 드러나지 않는다
  //    (그 사실 자체가 '한 식으로 정해야 한다'는 계약의 근거다).
  test('변이⑦-DOM(c): 잠금 복구를 "무조건 켜기"로 바꾸면 계약⑦-DOM(c) 가 실패한다', async () => {
    const OK = trReply(true, '지웠습니다', null, null);
    const bad = mutate(
      mutate(app, '    db.disabled = !deletable || __trSaving;', '    db.disabled = __trSaving;'),
      "    lockLineBtn(b, __trSaving || (b.dataset.top === 'delete' && !deletable(b.dataset.tkey)));",
      '    lockLineBtn(b, __trSaving);');
    const r = await probeBusy(PAYLOAD, 'user', OK, bad);
    assert.deepStrictEqual(r.done.ops.map((o) => o.disabled), [false, false, false, false],
      '변이 전제: 데이터 쪽 잠금을 빼면 지울 수 없는 계정의 [영구 삭제]도 켜져야 한다');
    const ctrl = await probeBusy(PAYLOAD, 'user', OK);
    assert.strictEqual(ctrl.done.ops[3].disabled, true);   // 통제군
  });

  //  ★ 진짜 관문은 '왕복 **중에** 목록이 다시 그려졌을 때'다(2026-09-11 적대 검토 R3-W2).
  //    잠금을 노드에 칠해 두던 옛 판은 여기서만 드러난다 — 평범한 왕복은 그 판에서도 멀쩡히 통과했다.
  test('계약⑦-DOM(e): 왕복 중에 푸시가 목록을 다시 그려도 잠금이 남는다', async () => {
    const r = await probeRerender(PAYLOAD, 'user', trReply(true, '지웠습니다', null, null));
    assert.deepStrictEqual(r.sending.ops.map((o) => o.disabled), [true, true, true, true],
      `전제 붕괴: 보내는 순간 행 버튼이 잠기지 않았다 — ${JSON.stringify(r.sending.ops)}`);
    assert.deepStrictEqual(r.afterPush.ops.map((o) => o.disabled), [true, true, true, true],
      `왕복 중에 목록이 다시 그려지자 잠금이 증발했다: ${JSON.stringify(r.afterPush.ops)} — 되돌릴 수 없는 삭제를 두 번 누를 수 있다`);
    assert.strictEqual(r.afterPush.busy, '1', '푸시 뒤 overlay 의 busy 가 사라졌다 — 결과를 알리기 전에 창이 닫힌다');
    //  회신이 오면 원래 상태로 돌아온다(꺼져 있던 [영구 삭제]는 꺼진 채로).
    assert.deepStrictEqual(r.done.ops.map((o) => o.disabled), [false, false, false, true],
      `회신 뒤 버튼 상태가 원래대로 돌아오지 않았다: ${JSON.stringify(r.done.ops)}`);
    assert.strictEqual(r.done.busy, '', '회신이 왔는데 overlay 가 busy 인 채로 남았다');
  });

  test('변이⑦-DOM(e): 렌더에서 잠금을 빼면 푸시 한 번에 잠금이 증발한다(그래서 이 계약이 필요하다)', async () => {
    const OK = trReply(true, '지웠습니다', null, null);
    const bad = mutate(app, '    rb.disabled = __trSaving;', '    rb.disabled = false;');
    const r = await probeRerender(PAYLOAD, 'user', OK, bad);
    assert.strictEqual(r.afterPush.ops[0].disabled, false,
      '변이 전제: 렌더가 잠금을 보지 않으면 푸시 뒤 [복구]가 켜져 있어야 한다');
    const ctrl = await probeRerender(PAYLOAD, 'user', OK);
    assert.strictEqual(ctrl.afterPush.ops[0].disabled, true);   // 통제군
  });

  //  ★ 2026-09-14 — '지난 요청의 늦은 회신'을 reqId 로 가려내던 자리가 **구조적으로 사라졌다**:
  //    회신은 그 버튼을 누른 클로저의 Promise 로 한 번만 풀리므로, 남의 결과로 먹힐 길이 없다.
  //    그래서 여기서 보는 것은 '내 회신이 내 자리로 왔는가'와 '거기 실려 온 목록이 앉는가' 다.
  test('계약⑦-DOM(f): 회신은 그 버튼을 누른 자리로 돌아오고, 실려 온 목록이 그 자리에서 앉는다', async () => {
    //  지운 뒤의 목록 — 인력 탭에서 zzU_a(31)가 사라진 모양이다.
    const AFTER = JSON.parse(JSON.stringify(PAYLOAD));
    AFTER.users = AFTER.users.filter((u) => u.key !== '31');
    const r = await probeReplySeats(PAYLOAD, 'user', trReply(true, '지웠습니다', AFTER, null));
    assert.ok(r.reply && r.reply.ok === true, `회신이 부르는 자리로 돌아오지 않았다: ${JSON.stringify(r.reply)}`);
    assert.strictEqual(r.state.busy, '', '회신이 왔는데 잠금이 풀리지 않았다');
    assert.strictEqual(r.state.toasts.length, 1, `결과 안내가 ${r.state.toasts.length}건이다(1건이어야 한다)`);
    assert.strictEqual(r.state.toasts[0].kind, 'success', `결과 안내의 종류가 다르다: ${JSON.stringify(r.state.toasts[0])}`);
    assert.strictEqual(r.state.toasts[0].msg, '지웠습니다',
      `호스트 문구를 화면이 다시 썼다: ${JSON.stringify(r.state.toasts[0])} — 거부 사유가 뭉개지면 무엇을 고칠지 알 수 없다`);
    assert.deepStrictEqual([...new Set(r.state.ops.map((o) => o.key))], ['32'],
      `회신에 실려 온 갱신 목록이 앉지 않았다: ${JSON.stringify(r.state.ops)} — 지운 항목이 화면에 그대로 남는다`);
    assert.strictEqual(r.timers, 0, `왕복 어디에서도 타이머를 걸지 않아야 한다(실제 ${r.timers}개)`);
  });

  test('변이⑦-DOM(f): 회신의 목록을 안 앉히면 지운 항목이 화면에 그대로 남는다', async () => {
    const AFTER = JSON.parse(JSON.stringify(PAYLOAD));
    AFTER.users = AFTER.users.filter((u) => u.key !== '31');
    const REP = trReply(true, '지웠습니다', AFTER, null);
    const bad = mutate(app, '  trSeat(r.trash);\n', '');
    const r = await probeReplySeats(PAYLOAD, 'user', REP, bad);
    assert.deepStrictEqual([...new Set(r.state.ops.map((o) => o.key))], ['31', '32'],
      `변이 전제: 목록을 안 앉히면 지운 항목이 남아야 한다(실제: ${JSON.stringify(r.state.ops)})`);
    const ctrl = await probeReplySeats(PAYLOAD, 'user', REP);
    assert.deepStrictEqual([...new Set(ctrl.state.ops.map((o) => o.key))], ['32']);   // 통제군
  });

  //  ★ 2026-09-14(좌석 일원화) — 인력을 복구·삭제하면 **명부도 함께** 회신에 실려 온다(kind==='user').
  //    그 명부는 「구성원 편집」과 **같은 문**(uaSeatReply)을 지나야 한다 — 그래야 순서 편집 중이면
  //    미뤄 두기가 여기에도 그대로 걸린다. 여기서 재는 것은 '지나갔는가' 하나다(앉힐까 미룰까는 그쪽 시험).
  const ROSTER = { found: true, admin: true, includeInactive: false, units: [], titles: [], members: [] };
  test('계약⑦-DOM(g): 인력 회신에 실려 온 명부는 공용 좌석(uaSeatReply)을 지난다', async () => {
    const AFTER = JSON.parse(JSON.stringify(PAYLOAD));
    AFTER.users = AFTER.users.filter((u) => u.key !== '31');
    const r = await probeReplySeats(PAYLOAD, 'user', trReply(true, '지웠습니다', AFTER, ROSTER));
    assert.strictEqual(r.rosters, 1,
      `회신의 명부가 공용 좌석을 ${r.rosters}번 지났다(1번이어야 한다) — 안 지나면 「구성원 편집」이 낡은 채로 남고, ` +
      '휴지통이 자기 손으로 앉히면 순서 편집 중 미뤄 두기가 그쪽에서만 빠진다');
    //  명부가 안 실려 온 회신(과제·발주처 등)은 그 문을 두드리지도 않는다 — 헛돌면 명부가 괜히 다시 그려진다.
    const none = await probeReplySeats(PAYLOAD, 'user', trReply(true, '지웠습니다', AFTER, null));
    assert.strictEqual(none.rosters, 0,
      `명부가 안 실려 온 회신인데 좌석을 ${none.rosters}번 두드렸다 — 빈 명부를 앉히려 들면 화면이 헛돈다`);
  });

  test('변이⑦-DOM(g): 회신의 명부를 좌석으로 안 보내면 「구성원 편집」이 낡은 채로 남는다', async () => {
    const AFTER = JSON.parse(JSON.stringify(PAYLOAD));
    AFTER.users = AFTER.users.filter((u) => u.key !== '31');
    const REP = trReply(true, '지웠습니다', AFTER, ROSTER);
    const bad = mutate(app, TR_SEAT_IN_SEND, '  return rep;\n}\n// 휴지통 목록의 컨트롤');
    const r = await probeReplySeats(PAYLOAD, 'user', REP, bad);
    assert.strictEqual(r.rosters, 0, `변이 전제: 좌석으로 안 보내면 0번이어야 한다(실제 ${r.rosters}번)`);
    const ctrl = await probeReplySeats(PAYLOAD, 'user', REP);
    assert.strictEqual(ctrl.rosters, 1);   // 통제군
  });

  //  ★ 2026-09-14 적대 검토(W2) — 목록이 새로 앉는 길은 **복구·삭제 회신**이 오는 길이다
  //    (trAfterWrite → trSeat → trApplyData → trRender). 한 건 복구할 때마다 맨 위로 튀면 관리자는 다음
  //    대상을 매번 다시 찾아야 하고, 쥐고 있던 [복구]가 사라져 포커스가 body 로 떨어진다.
  //    맨 위가 옳은 것은 **탭을 바꿨을 때**다(보이는 목록이 통째로 다른 것이 된다).
  test('계약⑦-DOM(i): 목록이 새로 앉아도 자리·포커스는 그대로, 탭을 바꾸면 맨 위다(W2)', () => {
    const r = probeScrollKeep(PAYLOAD, 'customer');
    assert.strictEqual(r.found, true, '전제 붕괴: 발주처 탭 버튼을 찾지 못했다');
    assert.strictEqual(r.set, 120, '전제 붕괴: jsdom 이 scrollTop 을 기억하지 못한다 — 이 계약을 잴 수 없다');
    assert.strictEqual(r.started, true, '전제 붕괴: [복구] 버튼에 포커스를 주지 못했다');
    assert.strictEqual(r.kept.sameNode, false,
      '전제 붕괴: 목록을 다시 만들지 않았다 — 그러면 이 계약(신원으로 되찾기)이 재는 것이 없다');
    assert.strictEqual(r.seated, 120,
      `목록이 새로 앉자 보던 자리가 ${r.seated} 로 튀었다 — 한 건 복구할 때마다 맨 위로 돌아간다(W2·R5-W1)`);
    assert.strictEqual(r.kept.op, 'restore',
      `새로 앉은 뒤 쥐고 있던 [복구]로 돌아오지 않았다: ${JSON.stringify(r.kept)} — 포커스가 body 로 떨어지면 Tab 이 문서 처음부터 다시 시작한다`);
    assert.strictEqual(r.kept.key, r.key, `포커스가 다른 항목으로 갔다: ${JSON.stringify(r.kept)}`);
    assert.strictEqual(r.switched, 0,
      `탭을 바꿨는데 옛 스크롤 자리(${r.switched})가 그대로 앉았다 — 새 탭의 첫 줄이 화면 밖에서 시작한다`);
  });

  //  ★ 잠금은 **목록을 다시 만들지 않는다**(2026-09-14). 그래서 보던 자리도 노드도 그대로고, 포커스를 쥔
  //    버튼이 꺼질 때만 그 행으로 물러났다가 풀리면 돌아온다 — 물러서기가 없으면 body 로 떨어져
  //    Tab 이 문서 처음부터 다시 시작한다.
  test('계약⑦-DOM(j): 잠금은 목록을 다시 만들지 않고, 포커스는 행으로 물러났다 돌아온다', () => {
    const r = probeLockFocus(PAYLOAD, 'user');
    assert.strictEqual(r.found, true, '전제 붕괴: [복구] 버튼을 찾지 못했다');
    assert.strictEqual(r.started, true, '전제 붕괴: 행 버튼에 포커스를 주지 못했다');
    assert.strictEqual(r.locked.sameNode, true,
      '잠그면서 목록을 통째로 다시 만들었다 — 스크롤과 누르던 버튼을 잃고, 그것을 되돌리는 한 벌이 다시 필요해진다');
    assert.strictEqual(r.locked.top, 120, `잠그자 보던 자리가 ${r.locked.top} 로 튀었다 — 잠금은 내용 변경이 아니다`);
    assert.strictEqual(r.locked.off, true, '잠갔는데 행 버튼이 꺼지지 않았다');
    //  ★ jsdom 은 '포커스를 쥔 컨트롤이 꺼지면 body 로 떨어뜨린다'는 브라우저 규칙(focus fixup)을 구현하지
    //    않는다 — isBody 를 재면 늘 거짓이라 아무것도 가리지 못한다. 대신 **물러섰는가**를 직접 잰다.
    assert.strictEqual(r.locked.line, true,
      `잠금 중 포커스가 행(.mba-line)에 있지 않다: ${JSON.stringify(r.locked)} — 물러설 자리는 그 행이다`);
    assert.strictEqual(r.unlocked.op, 'restore',
      `잠금이 풀렸는데 누르던 버튼으로 돌아오지 않았다: ${JSON.stringify(r.unlocked)} — 다음 항목을 이어서 누를 수 없다`);
    assert.strictEqual(r.unlocked.key, r.key, `풀린 뒤 포커스가 다른 행으로 갔다: ${JSON.stringify(r.unlocked)}`);
    assert.strictEqual(r.unlocked.disabled, false, '되돌아온 버튼이 아직 꺼져 있다 — 잠금이 풀리지 않았다');
    assert.strictEqual(r.unlocked.top, 120, `잠금을 푸는 것만으로 보던 자리가 ${r.unlocked.top} 로 튀었다`);
  });

  test('변이⑦-DOM(i): 렌더가 스스로 맨 위로 보내면 복구 한 번에 자리와 포커스를 잃는다(W2)', () => {
    const bad = mutate(app, KEEP_IN_TR_RENDER, '  list.scrollTop = 0;');
    const r = probeScrollKeep(PAYLOAD, 'customer', bad);
    assert.strictEqual(r.seated, 0,
      `변이 전제: 렌더가 맨 위로 보내면 새로 앉은 뒤 0 이어야 한다(실제: ${JSON.stringify(r)})`);
    assert.strictEqual(probeScrollKeep(PAYLOAD, 'customer').seated, 120);   // 통제군
  });

  //  ★ 통제군의 반대쪽 — 탭 전환의 맨 위 한 줄을 지우면 **탭만** 옛 자리에 선다(자리 지키기는 그대로다).
  //    두 변이가 서로 다른 자리를 치므로, 한 줄이 다른 한 줄을 대신해 주지 않는다는 것이 드러난다.
  test('변이⑦-DOM(i2): 탭 전환의 맨 위 한 줄을 지우면 새 탭이 옛 자리에서 열린다', () => {
    const bad = mutate(app, "b.addEventListener('click', () => { __trTab = t.kind; trRender(); trListTop(); });",
      "b.addEventListener('click', () => { __trTab = t.kind; trRender(); });");
    const r = probeScrollKeep(PAYLOAD, 'customer', bad);
    assert.strictEqual(r.seated, 120, '변이 전제: 자리 지키기는 그대로여야 한다(치는 자리가 다르다)');
    assert.strictEqual(r.switched, 120,
      `변이 전제: 맨 위 한 줄을 지우면 탭을 바꿔도 옛 자리가 남아야 한다(실제: ${JSON.stringify(r)})`);
    assert.strictEqual(probeScrollKeep(PAYLOAD, 'customer').switched, 0);   // 통제군
  });

  //  ★ 잠금 중에 관리자가 다른 행으로 포커스를 옮겨 뒀다면, 푸는 쪽은 그것을 **도로 뺏지 않는다**
  //    (옛 R4-W4 가 열쇠 대조로 지키던 요구다 — 지금은 그 행 노드가 그대로라 대조할 것이 없다).
  test('계약⑦-DOM(k): 잠금 중에 옮긴 포커스를 풀 때 도로 뺏지 않는다', () => {
    const r = probeFocusMoved(PAYLOAD, 'user');
    assert.strictEqual(r.found, true, '전제 붕괴: [복구] 버튼을 찾지 못했다');
    assert.strictEqual(r.twoRows, true, '전제 붕괴: 두 행이 필요하다(옮겨 갈 다른 행이 없다)');
    assert.strictEqual(r.moved, true, '전제 붕괴: 다른 행으로 포커스를 옮기지 못했다');
    assert.notStrictEqual(r.otherKey, r.key, `전제 붕괴: 옮겨 간 행이 같은 행이다(${r.otherKey})`);
    assert.strictEqual(r.isBody, false,
      `잠금이 풀리자 포커스가 body 로 떨어졌다: ${JSON.stringify(r)} — 옮겨 둔 자리도 함께 사라졌다`);
    assert.strictEqual(r.sameRow, true,
      `관리자가 옮겨 둔 행에서 포커스를 끌어냈다: ${JSON.stringify(r)} — 관리자가 둔 자리가 옳다(R4-W4)`);
    assert.strictEqual(r.op, '', `옮겨 둔 포커스를 원래 버튼으로 끌고 갔다: ${JSON.stringify(r)}`);
    assert.strictEqual(r.actKey, r.otherKey, `포커스가 옮겨 둔 그 행이 아니다: ${JSON.stringify(r)}`);
  });

  test('변이⑦-DOM(k): 옮겨 갔는지 보지 않고 되돌리면 포커스가 원래 행으로 끌려간다', () => {
    const bad = mutate(app, '    if(document.activeElement === ln) try{ b.focus(); }catch(_){}',
      '    try{ b.focus(); }catch(_){}');
    const r = probeFocusMoved(PAYLOAD, 'user', bad);
    assert.strictEqual(r.actKey, r.key,
      `변이 전제: 옮겨 갔는지 보지 않으면 포커스가 원래 행의 버튼으로 끌려가야 한다(실제: ${JSON.stringify(r)})`);
    assert.strictEqual(probeFocusMoved(PAYLOAD, 'user').actKey, r.otherKey);   // 통제군
  });

  test('변이⑦-DOM(j): 행이 포커스를 못 받으면 물러설 자리가 없다(실제 브라우저에선 body 로 떨어진다)', () => {
    const bad = mutate(app, '    line.tabIndex = -1;\n', '');
    const r = probeLockFocus(PAYLOAD, 'user', bad);
    assert.strictEqual(r.locked.line, false,
      `변이 전제: 행이 포커스를 못 받으면 물러서기가 실패해야 한다(실제: ${JSON.stringify(r.locked)})`);
    assert.strictEqual(probeLockFocus(PAYLOAD, 'user').locked.line, true);   // 통제군
  });

  test('계약⑦-DOM(h): 잠금은 목록을 **한 번도** 다시 만들지 않는다(켜든 끄든 0 번)', () => {
    const r = probeRenderCount(PAYLOAD, 'user');
    assert.strictEqual(r.noop, 0, `이미 꺼진 잠금을 다시 끄는데 목록을 ${r.noop}번 그렸다`);
    assert.strictEqual(r.on, 0,
      `잠글 때 목록을 ${r.on}번 그렸다 — 그 한 번으로 스크롤과 누르던 버튼이 사라지고, 되돌리는 한 벌이 다시 필요해진다`);
    assert.strictEqual(r.again, 0, `이미 잠긴 상태를 다시 잠그는데 목록을 ${r.again}번 그렸다`);
    assert.strictEqual(r.off, 0, `풀 때 목록을 ${r.off}번 그렸다`);
  });

  test('변이⑦-DOM(h): 잠금을 렌더로 반영하게 되돌리면 계약⑦-DOM(h) 가 실패한다', () => {
    const bad = mutate(app, TR_LOCK_TAIL, '  trRender();\n}');
    const r = probeRenderCount(PAYLOAD, 'user', bad);
    assert.strictEqual(r.noop, 1, `변이 전제: 렌더로 반영하면 헛호출도 1번 그려야 한다(실제: ${JSON.stringify(r)})`);
    assert.strictEqual(r.on, 1, '변이 전제: 잠글 때도 그려야 한다');
    assert.strictEqual(probeRenderCount(PAYLOAD, 'user').on, 0);   // 통제군
  });

  test('변이⑥-DOM: 세 계약이 각각 한 줄 변이로 깨진다(안 깨지면 그 검사는 장식이다)', () => {
    // (b) 비관리자 분기를 지우는 한 줄 → admin:false 에도 탭·행이 그려진다
    const badB = mutate(app, '  if(!__trAdmin){\n', '  if(false){\n');
    const rb = probeRender({ found: true, admin: false, projects: PAYLOAD.projects }, null, badB);
    assert.ok(rb.tabs.length > 0 || rb.ops.length > 0,
      '변이 전제: 분기를 지우면 admin:false 에도 탭·조작 버튼이 그려져야 한다');

    // (d) 삭제 가능 판정을 무조건 참으로 바꾸면 지울 수 없는 계정의 버튼이 켜진다
    const badD = mutate(app, '    const deletable = !!(it && it.deletable === true);', '    const deletable = true;');
    const rd = probeRender(PAYLOAD, 'user', badD);
    assert.deepStrictEqual(rd.ops.filter((o) => o.op === 'delete').map((o) => o.disabled), [false, false],
      '변이 전제: 잠금을 지우면 기록이 있는 계정의 [영구 삭제]도 켜져야 한다');

    // (a) 퇴사자 쪽 문의 제거를 '숨김'으로 바꾸는 한 줄 → 비관리자 DOM 에 그대로 남는다
    //   ★ 막대는 맨 위에서 **통째로 비워지므로**, '숨김' 판을 재현하려면 문을 조기 return **앞**에서
    //     만들고 클래스로만 가려야 한다 — 실제로 옛 판이 그랬던 모양이다(숨김은 클래스 하나로 풀린다).
    const badA = mutate(app, "  if(!__uaAdmin) return;   // ★ 비관리자",
      "  { const t0 = document.createElement('button'); t0.id = 'uaTrash'; t0.className = 'hidden';" +
      " t0.textContent = '퇴사자 휴지통'; box.appendChild(t0); }\n  if(!__uaAdmin) return;   // ★ 비관리자");
    const ra = probeDoorSeq([[true, false, false], [false, false, false]], badA);
    assert.strictEqual(ra[1].present, true,
      '변이 전제: 숨김으로 바꾸면 내려간 뒤에도 버튼이 DOM 에 남아야 한다(그래서 부재 계약이 필요하다)');

    // 통제군 — 원본은 셋 다 계약을 지킨다.
    assert.strictEqual(probeRender({ found: true, admin: false }).tabs.length, 0);
    assert.strictEqual(probeRender(PAYLOAD, 'user').ops.filter((o) => o.op === 'delete')[1].disabled, true);
    assert.strictEqual(probeDoorSeq([[true, false, false], [false, false, false]])[1].present, false);
  });

  test('계약⑦-DOM: 이름이 글자까지 같을 때만 [영구 삭제]가 켜진다(trim·대소문자 접기 없음)', () => {
    const NAME = 'zzP 과제 A';
    const r = probeTyped(NAME, [NAME + ' ', NAME, ' ' + NAME, NAME.toLowerCase(), '']);
    assert.strictEqual(r[0].disabled, true, '열자마자 [영구 삭제]가 켜져 있다 — 이름 입력이 장식이 된다');
    assert.strictEqual(r[0].value, '', '입력칸에 지난 대상의 이름이 남아 있다 — 그대로 눌려 버린다');
    assert.strictEqual(r[0].label, '영구 삭제', `확인 버튼 문구를 호출부가 정하지 못했다: ${JSON.stringify(r[0].label)}`);
    assert.strictEqual(r[0].labelFor, "확인을 위해 '" + NAME + "' 을(를) 그대로 입력하세요",
      `입력 안내 문구가 다르다: ${JSON.stringify(r[0].labelFor)} — 무엇을 쳐야 하는지 화면이 말해야 한다`);
    assert.strictEqual(r[1].disabled, true, '뒤에 공백이 붙었는데 버튼이 켜졌다 — TRIM 하지 않는다(설계 §5.2)');
    assert.strictEqual(r[2].disabled, false, '이름이 정확히 같은데 버튼이 켜지지 않았다 — 지울 방법이 사라진다');
    assert.strictEqual(r[3].disabled, true, '앞에 공백이 붙었는데 버튼이 켜졌다');
    assert.strictEqual(r[4].disabled, true, '대소문자만 다른데 버튼이 켜졌다 — 대조는 글자까지 같아야 한다');
    assert.strictEqual(r[5].disabled, true, '입력을 지웠는데 버튼이 켜진 채로 남았다');
  });

  test("계약⑦-DOM(d): [취소]를 실제로 누르면 확인창이 'cancel' 로 해소된다(닫히기만 하고 멈추지 않는다)", async () => {
    const r = await probeTypedCancel();
    assert.strictEqual(r.found, true, '#confirmTypedModal 하단에 [취소]([data-close])가 없다 — 빠져나갈 길이 사라진다');
    assert.strictEqual(r.armed, true, '전제 붕괴: 이름을 다 쳤는데 [영구 삭제]가 켜지지 않았다');
    //  ★ 켜진 상태에서 [취소]를 눌러도 **삭제가 아니다.** 여기서 'ok' 가 나오면 취소가 삭제를 부른다.
    assert.strictEqual(r.result, 'cancel',
      `[취소] 클릭이 ${JSON.stringify(r.result)} 로 해소됐다 — 'cancel' 이어야 한다(호출부는 r !== 'ok' 로만 판단한다)`);
    assert.strictEqual(r.hidden, true, '[취소]를 눌렀는데 확인창이 닫히지 않았다');
  });

  test('변이⑦-DOM: 대조에 trim 을 끼우면 앞뒤 공백이 통과한다(그래서 이 계약이 필요하다)', () => {
    const NAME = 'zzP 과제 A';
    const bad = mutate(app, 'const sync = () => { ok.disabled = inp.value !== want; };',
      'const sync = () => { ok.disabled = inp.value.trim() !== want; };');
    const r = probeTyped(NAME, [NAME + ' '], bad);
    assert.strictEqual(r[1].disabled, false,
      '변이 전제: trim 을 끼우면 뒤에 공백이 붙어도 버튼이 켜져야 한다');
    // 통제군
    assert.strictEqual(probeTyped(NAME, [NAME + ' '])[1].disabled, true);
  });
}
