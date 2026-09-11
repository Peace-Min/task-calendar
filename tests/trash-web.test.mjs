// 휴지통 — 화면 계약(docs/TRASH-DELETE.md §8 ⑥⑦)
//
// 이 파일이 존재하는 이유:
//   휴지통은 이 앱에서 **되돌릴 수 없는** 유일한 조작이다(복구 수단은 DB 백업뿐 · 설계 §7).
//   그래서 화면에 지켜야 할 것이 둘이다:
//     ⑥ 관리자가 아닌 사람의 DOM 에는 휴지통이 **아예 없다** — 진입 버튼(#usTrash)도, 탭도, 행도.
//        숨김이 아니라 부재여야 한다: 숨김은 클래스 하나로 풀리고, 그러면 화면이 권한을 정하는
//        모양이 된다. 권한은 호스트가 요청 시점에 판정한다(ProjectDb.OpenAdminAsync).
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

// window.__xxx = function(...){...} 형태의 호스트 콜백 — extractFunction 은 `function 이름(` 만 찾으므로
// 여기서 따로 오려 낸다(선언 모양이 다르다고 계약을 못 보면 안 된다).
function windowFn(web, name) {
  const s = web.indexOf('window.' + name + ' = function');
  assert.ok(s >= 0, `window.${name} 선언을 찾지 못했다 — 판정 불가`);
  const e = web.indexOf('\n};', s);
  assert.ok(e > s, `window.${name} 의 끝(';};')을 찾지 못했다 — 판정 불가`);
  return web.slice(s, e + 3);
}

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
    assert.ok(/<div class="modal wide">/.test(md), '#trashModal 이 .modal.wide 가 아니다 — 5개 탭이 좁은 모달에 들어가지 않는다');
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

  // ⑥-b 진입 버튼(#usTrash)은 edit_role==='admin' 회신일 때만 만들어진다 — 「구성원 편집」과 한 함수·한 판정.
  trashEntryButtonIsBuiltNotHidden(web) {
    assert.ok(!/id="usTrash"/.test(web),
      '「휴지통」 버튼이 마크업에 있다 — 비관리자 DOM 에 남는다(숨김 ≠ 부재). JS 가 만들어야 한다');
    const b = extractFunction(web, 'usAdminBtnSync');
    assert.ok(/usTrash/.test(b),
      'usAdminBtnSync 가 「휴지통」 버튼을 만들지 않는다 — 진입 판정이 두 곳으로 갈라지면 한쪽이 반드시 낡는다');
    assert.ok(/openTrash/.test(b), 'usAdminBtnSync 가 만든 버튼이 openTrash 에 묶이지 않는다 — 눌러도 아무 일이 없다');
    assert.ok((b.match(/removeChild/g) || []).length >= 2,
      'usAdminBtnSync 가 버튼 둘을 모두 DOM 에서 제거하지 않는다 — 남겨 두면 관리자에서 내려가도 문이 남는다');
    //  ★ 숨김으로 바꾸는 변이를 형태로도 막는다(user-admin 계약⑦-c 와 같은 규칙 — 이 함수에는 숨김이 없다).
    assert.ok(!/classList|\.hidden|style\.display/.test(b),
      'usAdminBtnSync 가 숨김(classList/hidden/display)을 쓴다 — 부재여야 한다. 숨김은 클래스 하나로 풀린다');
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
    const ap = windowFn(web, '__applyTrash');
    assert.ok(/JSON\.parse/.test(ap) && /d\.found/.test(ap),
      '__applyTrash 가 문자열 JSON 을 파싱해 found 를 확인하지 않는다(__applyMembers 와 같은 전달 규약이다)');
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

  // ⑦-b 쓰기 왕복 한 곳 — 가드·워치독·includeInactive, 그리고 호스트 문장을 다시 쓰지 않는다.
  //   ★ 2026-09-10: 가드가 두 번째 클릭을 **조용히** 버리던 것을 고쳤다. 잠금·워치독은 trSetSaving 한 곳으로
  //     모였으므로(uaSetSaving·offEdSetBusy 와 같은 장치) 여기서 보는 자리도 함께 옮긴다.
  //   ★ 2026-09-11(적대 검토 R3): 셋이 더 붙었다.
  //     · 요청·회신을 **reqId 로 짝짓는다** — 늦게 온 회신이 지금 기다리는 다른 항목의 결과로 먹히던 자리다.
  //     · 워치독은 **요청 표를 지우지 않는다** — 지우면 12초를 넘겨 도착한 성공 회신이 버려져
  //       "지워졌는데 실패로 안내"가 된다. 그래서 문구도 '없다'가 아니라 '늦다'다.
  //     · 잠금은 **렌더가 진다**(trRender) — 노드를 걸어 다니며 끄면 왕복 중 재렌더가 잠금을 지운다.
  writeRoundTrip(web) {
    const s = extractFunction(web, 'trSend');
    assert.ok(/if\(__trSaving\)\{[^}]*return;/.test(s), 'trSend 에 중복 전송 가드가 없다 — 연타하면 같은 삭제가 두 번 나간다');
    assert.ok(/이전 요청을 처리 중입니다/.test(s),
      'trSend 가 가드에 걸린 클릭을 조용히 버린다 — 관리자에게는 버튼이 먹지 않는 것으로 보인다(2026-09-10)');
    assert.ok(/trSetSaving\(true\)/.test(s), 'trSend 가 trSetSaving 으로 잠그지 않는다 — 진행 중임이 화면에 드러나지 않는다');
    assert.ok(/includeInactive: __uaInactive/.test(s),
      'trSend 가 includeInactive 를 함께 보내지 않는다 — 인력 삭제 뒤 밀려오는 명부가 「퇴사자 보기」 상태를 잃는다');
    //  ★ reqId 발번 + 요청 표. 발번기는 hostRequest 와 같은 것(__reqSeq)이어야 페이지 안에서 겹치지 않는다.
    assert.ok(/\+\+__reqSeq/.test(s),
      'trSend 가 reqId 를 발번하지 않는다 — 회신이 어느 요청의 것인지 짐작할 수밖에 없다(2026-09-11)');
    assert.ok(/__trReq = \{ id: reqId/.test(s),
      'trSend 가 요청 표(__trReq)를 세우지 않는다 — 대조할 기준이 없으면 늦은 회신을 구별할 수 없다');
    assert.ok(/reqId: reqId/.test(s),
      'trSend 가 payload 에 reqId 를 싣지 않는다 — 호스트가 되돌려줄 것이 없다');
    const b = extractFunction(web, 'trSetSaving');
    assert.ok(/setTimeout/.test(b) && /응답이 늦습니다 — 회신이 오면 반영됩니다\./.test(b),
      'trSetSaving 의 워치독이 "늦다"고 말하지 않는다 — 회신은 아직 살아 있는데 실패로 안내하면 관리자가 다시 지운다');
    assert.ok(/dataset\.busy = '1'/.test(b) && /delete ov\.dataset\.busy/.test(b),
      'trSetSaving 이 overlay dataset.busy 를 세우고 지우지 않는다 — 전송 중에 창을 닫으면 결과를 알릴 곳이 사라진다');
    assert.ok(/trRender\(\)/.test(b),
      'trSetSaving 이 잠금을 렌더로 반영하지 않는다 — 왕복 중 푸시가 목록을 다시 그리면 잠금이 증발한다(2026-09-11)');
    assert.ok(!/trwas/.test(b) && !/querySelectorAll\('\[data-top\]'\)/.test(b),
      'trSetSaving 이 아직 행 버튼을 걸어 다니며 끈다 — 다시 그린 버튼에는 그 표가 없어 되돌리기가 헛돈다');
    //  ★ 워치독은 **요청 표를 지우지 않는다**. 지우면 늦게 온 성공 회신이 통째로 버려진다.
    assert.ok(!/__trReq = null/.test(b),
      'trSetSaving(워치독)이 __trReq 를 지운다 — 12초를 넘겨 도착한 성공 회신이 버려져 "지워졌는데 실패로 안내"가 된다');
    const dn = windowFn(web, '__trashDone');
    assert.ok(/msg \|\|/.test(dn),
      '__trashDone 이 호스트 문구를 쓰지 않는다 — 거부 사유가 "처리하지 못했습니다"로 뭉개지면 무엇을 고칠지 알 수 없다');
    assert.ok(/trSetSaving\(false\)/.test(dn), '__trashDone 이 잠금을 trSetSaving 으로 풀지 않는다 — 푸는 곳이 둘이면 한쪽이 낡는다');
    assert.ok(/function\(ok, msg, reqId\)/.test(dn),
      '__trashDone 이 reqId 를 받지 않는다 — 호스트가 실어 보낸 짝을 화면이 읽지 않으면 있으나 마나다');
    assert.ok(/rid !== rq\.id/.test(dn),
      '__trashDone 이 회신의 reqId 를 기다리는 요청과 대조하지 않는다 — 지난 요청의 늦은 회신이 지금 대상의 결과로 먹힌다');
    assert.ok(/__trReq = null;/.test(dn), '__trashDone 이 처리한 요청 표를 닫지 않는다 — 같은 회신이 두 번 처리될 수 있다');
    //  ★ (재)오픈은 낡은 잠금을 남기지 않는다. 다만 **도는 중이면 풀지 말고 워치독만 다시 건다**.
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
  },

  // ⑦-d 목록을 다시 그려도 **보던 자리와 누르던 버튼**을 잃지 않는다(2026-09-11 적대 검토 R2-W4).
  //   trRender 는 #trList 를 통째로 다시 만든다. 옛 판은 쓰기 한 번에 그 일이 세 번 났고(잠금 · 회신 ·
  //   호스트 푸시), 그때마다 스크롤이 맨 위로 튀고 방금 누른 버튼이 사라져 포커스가 body 로 떨어졌다 —
  //   긴 휴지통에서 연달아 복구하는 것이 사실상 불가능했다(uaMove 가 명부에서 겪은 것과 같은 일이다).
  //   그래서 둘을 함께 고친다: ⓐ 그리는 쪽이 자리·포커스를 되돌리고, ⓑ 잠금은 **바뀔 때만** 그린다.
  renderKeepsPlace(web) {
    const r = extractFunction(web, 'trRender');
    assert.ok(/const keepTop = list\.scrollTop;/.test(r) && /list\.scrollTop = sameView \? keepTop : 0;/.test(r),
      'trRender 가 스크롤 자리를 찍어 두고 되돌리지 않는다 — 다시 그릴 때마다 목록이 맨 위로 튄다(R2-W4)');
    //  ★ 되돌리는 것은 **같은 화면일 때만**이다(2026-09-11 적대 검토 R3-W2). 탭을 바꾸거나 관리자 여부가
    //    뒤집히면 목록의 내용이 통째로 달라진다 — 그 자리에 옛 스크롤을 앉히면 관리자가 고른 적 없는
    //    중간에서 시작하고, 새 탭이 더 짧으면 아무것도 없는 자리에 선다. 화면이 바뀌면 맨 위가 옳다.
    assert.ok(/const sameView = !!__trShown && __trShown\.tab === view\.tab && __trShown\.admin === view\.admin;/.test(r),
      "trRender 가 '지금 그리는 것이 직전과 같은 화면인가'를 재지 않는다 — 탭을 바꿔도 옛 스크롤 자리가 그대로 앉는다(R3-W2)");
    assert.ok((r.match(/__trShown = view;/g) || []).length >= 2,
      'trRender 가 그린 화면(__trShown)을 갈래마다 남기지 않는다 — 안내 한 줄뿐인 화면에서 빠져나오면 판정이 낡는다');
    assert.ok(/let keepBtn = \(af && af\.dataset && af\.dataset\.top && af\.dataset\.tkey\)/.test(r),
      'trRender 가 포커스를 쥔 행 버튼을 data-top·data-tkey 로 찍어 두지 않는다 — 이름으로 잡으면 한글 이스케이프가 낀다');
    assert.ok(/if\(keepBtn\)\{/.test(r) && /\.focus\(\);/.test(r),
      'trRender 가 찍어 둔 행 버튼으로 포커스를 되돌리지 않는다 — 다시 그린 순간 포커스가 body 로 떨어진다');
    assert.ok(/if\(kb && !kb\.disabled\)/.test(r),
      'trRender 가 꺼진 버튼에도 포커스를 준다 — 브라우저가 그 포커스를 body 로 떨어뜨려 결국 같은 문제로 돌아온다');
    //  ★ 꺼진 버튼일 때 **행으로 물러난다**(R3-W2). 잠금이 걸린 첫 렌더는 행 버튼을 전부 끈 채로 그리므로
    //    되돌릴 곳이 없어 포커스가 body 로 떨어졌다 — 그러면 Tab 이 문서 처음부터 다시 시작한다.
    //    그리고 잠금이 풀린 다음 렌더가 그 버튼으로 되돌릴 수 있게 표(__trKeepBtn)를 맡아 둔다.
    assert.ok(/line\.tabIndex = -1;/.test(r),
      '행(.mba-line)이 포커스를 받을 수 없다 — 꺼진 버튼에서 물러설 자리가 없어 포커스가 body 로 떨어진다(R3-W2)');
    assert.ok(/closest\('\.mba-line'\)/.test(r) && /ln\.focus\(\)/.test(r),
      'trRender 가 꺼진 버튼일 때 그 행으로 물러나지 않는다 — 잠기는 순간 키보드 조작이 끊긴다(R3-W2)');
    assert.ok(/if\(__trSaving\) __trKeepBtn = keepBtn;/.test(r),
      '잠금 동안 되돌릴 버튼을 맡아 두지 않는다 — 잠금이 풀려도 포커스가 행에 남아 다음 항목을 이어서 못 누른다(R3-W2)');
    assert.ok(/if\(!keepBtn && __trKeepBtn && af && af\.classList && af\.classList\.contains\('mba-line'\)/.test(r),
      '맡아 둔 버튼을 되돌리지 않는다(또는 포커스가 그 행을 떠났는데도 도로 뺏는다) — 되돌리는 조건은 "아직 그 행에 있을 때"다(R3-W2)');
    //  ★ '아직 그 행에 있을 때' 는 **어느 행인지까지** 본다(2026-09-11 적대 검토 R4-W4). 목록 안의 아무
    //    행이나로 보면, 잠금 중에 관리자가 다른 행으로 옮겨 둔 포커스를 다음 렌더가 도로 뺏어 엉뚱한
    //    줄로 끌고 간다(#trList 안이기만 하면 참이던 옛 판의 구멍이다). 그래서 행에도 열쇠를 단다.
    assert.ok(/line\.dataset\.tkey = key;/.test(r),
      '행(.mba-line)에 data-tkey 가 없다 — 물러난 포커스가 어느 행인지 다음 렌더가 알 길이 없다(R4-W4)');
    assert.ok(/String\(af\.dataset\.tkey \|\| ''\) === __trKeepBtn\.key/.test(r),
      '맡아 둔 표를 되돌릴 때 **그 행인지** 대조하지 않는다 — 관리자가 잠금 중에 옮겨 둔 포커스를 엉뚱한 행으로 끌고 간다(R4-W4)');
    assert.ok(!/line\.dataset\.top/.test(r),
      "행에 data-top 을 달았다 — 버튼을 찾는 셀렉터('[data-top][data-tkey]')에 행이 끼어든다");
    const s = extractFunction(web, 'trSetSaving');
    assert.ok(/const changed = \(__trSaving !== !!on\);/.test(s),
      'trSetSaving 이 "잠금이 실제로 바뀌었나"를 재지 않는다 — 쓰기 한 번에 목록이 세 번 다시 만들어진다(R2-W4)');
    assert.ok(/if\(changed\) trRender\(\);/.test(s),
      'trSetSaving 의 재렌더가 changed 로 좁혀져 있지 않다');
    assert.ok((s.match(/return changed;/g) || []).length >= 2,
      "trSetSaving 이 두 갈래(잠금 해제·워치독 설치) 모두에서 '다시 그렸나'를 돌려주지 않는다");
    //  ★ 여는 순간의 렌더는 **남아 있어야 한다**: 바로 위 trSetSaving 은 지금 값을 그대로 다시 넣어
    //    잠금이 바뀌지 않고, 바뀌지 않으면 그리지 않는다. 지우면 방금 비운 __trData·__trAdmin 이
    //    화면에 닿지 않아 지난번에 열었던 목록이 그대로 남는다.
    const o = extractFunction(web, 'openTrash');
    assert.ok(/if\(__trSaving\) trSetSaving\(true\); else trSetSaving\(false\);\s*\n[\s\S]{0,400}?\n  trRender\(\);/.test(o),
      'openTrash 가 여는 순간 목록을 그리지 않는다 — 잠금이 바뀌지 않는 호출이라 trSetSaving 은 그리지 않는다(R2-W4)');
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
    assert.ok(/숨긴 과제는 「휴지통」에서 복구하거나 영구 삭제할 수 있습니다/.test(extractFunction(web, 'offHideProject')),
      '과제 숨김 확인창이 「휴지통」을 가리키지 않는다 — 숨긴 과제를 다시 볼 곳이 화면 어디에도 안내되지 않는다');
    for (const fn of ['custDoHide', 'codeDoHide']) {
      assert.ok(/숨긴 항목은 「휴지통」에서/.test(extractFunction(web, fn)),
        `${fn} 의 확인창이 「휴지통」을 가리키지 않는다 — 발주처·코드도 같은 곳에서 복구·삭제한다`);
    }
  },
};

// ── 형태 계약 ────────────────────────────────────────────────────────
test('계약⑥-a: #trashModal 마크업에는 탭·[영구 삭제] 가 없다(빈 자리뿐)', () => checks.trashMarkupHasNoControls(app));
test('계약⑥-b: 「휴지통」 진입 버튼은 마크업에 없고 usAdminBtnSync 가 만들고 없앤다', () => checks.trashEntryButtonIsBuiltNotHidden(app));
test('계약⑥-c: 휴지통 렌더는 목록을 다시 정렬하지 않는다(순서는 호스트가 정한다)', () => checks.renderDoesNotReorder(app));
test('계약⑥-d: 관리자 여부는 호스트 회신이 정하고, 열 때 낡은 값을 비운다', () => checks.adminFlagComesFromHost(app));
test('계약⑥-e: 숨김 확인창이 「휴지통」을 가리킨다(설계 §5.4)', () => checks.hideConfirmPointsToTrash(app));
test('계약⑦: 입력한 이름은 가공 없이 호스트로 가고, 대조는 엄격 일치다', () => checks.confirmIsSentRaw(app));
test('계약⑦-b: 복구·삭제 왕복은 한 곳(trSend)이고 회신은 reqId 로 짝지어진다', () => checks.writeRoundTrip(app));
test('계약⑦-c: 행 버튼의 잠금은 렌더가 진다(재렌더가 잠금을 지우지 않는다)', () => checks.lockIsDerivedAtRender(app));
test('계약⑦-d: 목록을 다시 그려도 스크롤 자리와 누른 버튼의 포커스가 남는다', () => checks.renderKeepsPlace(app));
test('계약⑧: 빈 탭 문구는 탭 표가 지고 조사는 받침이 정한다(「이(가)」 병기 없음)', () => checks.emptyTextJosa(app));

test('변이⑦-b: 진행 중 클릭을 조용히 버리게 되돌리면 계약⑦-b 가 실패한다', () => {
  const bad = mutate(app, "  if(__trSaving){ toast('이전 요청을 처리 중입니다 — 잠시 후 다시 시도하세요', 'warn'); return; }",
    '  if(__trSaving) return;');
  assert.throws(() => checks.writeRoundTrip(bad), /중복 전송 가드가 없다|조용히 버린다/);
  assert.doesNotThrow(() => checks.writeRoundTrip(app));   // 통제군
});

test('변이⑦-b2: __trashDone 의 reqId 대조를 지우면 계약⑦-b 가 실패한다(늦은 회신이 남의 결과가 된다)', () => {
  const bad = mutate(app, "  if(rid && rid !== rq.id){\n    try{ console.warn('[__trashDone] 지난 요청의 회신을 버린다:', rid, '≠', rq.id); }catch(_){}\n    return;\n  }",
    '  ');
  assert.throws(() => checks.writeRoundTrip(bad), /reqId 를 기다리는 요청과 대조하지 않는다/);
  assert.doesNotThrow(() => checks.writeRoundTrip(app));   // 통제군
});

test('변이⑦-b3: 워치독이 요청 표를 지우게 되돌리면 계약⑦-b 가 실패한다(늦은 성공이 버려진다)', () => {
  const bad = mutate(app, '  __trSaveWatchdog = setTimeout(() => {\n    trSetSaving(false);',
    '  __trSaveWatchdog = setTimeout(() => {\n    __trReq = null;\n    trSetSaving(false);');
  assert.throws(() => checks.writeRoundTrip(bad), /__trReq 를 지운다/);
  assert.doesNotThrow(() => checks.writeRoundTrip(app));   // 통제군
});

test('변이⑦-c: 잠금을 렌더에서 빼면 계약⑦-c 가 실패한다', () => {
  const bad = mutate(app, '    rb.disabled = __trSaving;', '    rb.disabled = false;');
  assert.throws(() => checks.lockIsDerivedAtRender(bad), /\[복구\]를 그릴 때 __trSaving 을 보지 않는다/);
  assert.doesNotThrow(() => checks.lockIsDerivedAtRender(app));   // 통제군
});

test('변이⑦-d: 스크롤 자리 복원을 지우면 계약⑦-d 가 실패한다(다시 그릴 때마다 맨 위로 튄다)', () => {
  const bad = mutate(app, '  list.scrollTop = sameView ? keepTop : 0;\n', '');
  assert.throws(() => checks.renderKeepsPlace(bad), /스크롤 자리를 찍어 두고 되돌리지 않는다/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑦-d4: 화면이 바뀌어도 옛 스크롤 자리를 앉히게 되돌리면 계약⑦-d 가 실패한다(R3-W2)', () => {
  const bad = mutate(app, '  list.scrollTop = sameView ? keepTop : 0;', '  list.scrollTop = keepTop;');
  assert.throws(() => checks.renderKeepsPlace(bad), /스크롤 자리를 찍어 두고 되돌리지 않는다/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑦-d5: 잠금 동안 맡아 둔 버튼을 지우면 계약⑦-d 가 실패한다(잠금이 풀려도 포커스가 행에 남는다)', () => {
  const bad = mutate(app, '      if(__trSaving) __trKeepBtn = keepBtn;\n', '');
  assert.throws(() => checks.renderKeepsPlace(bad), /되돌릴 버튼을 맡아 두지 않는다/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑦-d2: trSetSaving 이 무조건 다시 그리게 되돌리면 계약⑦-d 가 실패한다(쓰기 한 번에 세 번 그린다)', () => {
  const bad = mutate(app, '  const changed = (__trSaving !== !!on);', '  const changed = true;');
  assert.throws(() => checks.renderKeepsPlace(bad), /"잠금이 실제로 바뀌었나"를 재지 않는다/);
  assert.doesNotThrow(() => checks.renderKeepsPlace(app));   // 통제군
});

test('변이⑦-d3: 꺼진 버튼에도 포커스를 주게 바꾸면 계약⑦-d 가 실패한다(포커스가 body 로 떨어진다)', () => {
  const bad = mutate(app, '    if(kb && !kb.disabled){ try{ kb.focus(); }catch(_){} }',
    '    if(kb){ try{ kb.focus(); }catch(_){} }');
  assert.throws(() => checks.renderKeepsPlace(bad), /꺼진 버튼에도 포커스를 준다/);
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

test('변이⑥-b: 진입 버튼 제거를 숨김으로 바꾸면 계약⑥-b 가 실패한다(숨김 ≠ 부재)', () => {
  const bad = mutate(app, '  if(!on && curT && curT.parentNode) curT.parentNode.removeChild(curT);',
    "  if(!on && curT) curT.classList.add('hidden');");
  assert.throws(() => checks.trashEntryButtonIsBuiltNotHidden(bad), /제거하지 않는다|숨김\(classList/);
  assert.doesNotThrow(() => checks.trashEntryButtonIsBuiltNotHidden(app));   // 통제군
});

test('변이⑥-b2: 진입 버튼을 마크업에 적으면 계약⑥-b 가 실패한다', () => {
  const bad = mutate(app, '          <button type="button" class="btn sm" id="usMembers">구성원 보기</button>',
    '          <button type="button" class="btn sm" id="usMembers">구성원 보기</button>\n' +
    '          <button type="button" class="btn sm" id="usTrash">휴지통</button>');
  assert.throws(() => checks.trashEntryButtonIsBuiltNotHidden(bad), /마크업에 있다/);
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
    'var __trData = null, __trTab = "project", __trAdmin = false, __trSaving = false;',
    //  ★ 렌더가 기억하는 두 값 — 직전에 그린 화면(__trShown)과 잠금 동안 맡아 둔 버튼(__trKeepBtn · R3-W2).
    'var __trShown = null, __trKeepBtn = null;',
    '// 이 계약과 무관한 협력자는 빈 함수로 — 여기서 보는 것은 "무엇이 그려지는가" 하나다.',
    'function trRestore(){} function trDelete(){} function toast(){} function hostRequest(){}',
    constLine(src, 'josa'),
    constLine(src, 'trEmptyLabel'),
    constBlock(src, 'const TR_TABS = ['),
    constLine(src, 'trTabDef'),
    constLine(src, 'trRows'),
    extractFunction(src, 'trApplyData'),
    extractFunction(src, 'trRender'),
    SNAP_JS,
    'window.__probe = function(payload, clickTab){',
    '  __trData = null; __trAdmin = false; __trTab = "project"; __trShown = null; __trKeepBtn = null;',
    '  trApplyData(payload);',
    '  if(clickTab){ var tb = document.querySelector("[data-trtab=\'" + clickTab + "\']"); if(tb) tb.click(); }',
    '  return __snap();',
    '};',
    //  탭 전환은 탭 줄을 통째로 다시 만든다 — 그때 포커스가 body 로 떨어지지 않는지 본다(키보드 사용자에게 치명적).
    'window.__probeFocus = function(payload, clickTab){',
    '  __trData = null; __trAdmin = false; __trTab = "project"; __trShown = null; __trKeepBtn = null;',
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

// 쓰기 잠금(진행 중 표시) — trSend·trSetSaving·__trashDone 이 실제로 행 버튼과 overlay 를 잠그고 푸는지 본다.
//   ★ __reqSeq·__trReq 도 함께 심는다 — 2026-09-11 부터 이 왕복은 reqId 로 요청·회신을 짝짓는다.
function busyHarnessJs(src) {
  return [
    'var __trData = null, __trTab = "project", __trAdmin = false, __trSaving = false, __trSaveWatchdog = 0;',
    'var __trReq = null, __reqSeq = 0;',
    'var __trShown = null, __trKeepBtn = null;   // 렌더가 기억하는 화면·맡아 둔 버튼(R3-W2)',
    'var __uaInactive = false, HOST = true, __posts = [], __toasts = [];',
    'function hpost(p){ __posts.push(p); }',
    'function toast(m, k){ __toasts.push({ msg: String(m), kind: String(k || "") }); }',
    'function trRestore(){} function trDelete(){} function hostRequest(){}',
    constLine(src, 'josa'),
    constLine(src, 'trEmptyLabel'),
    constBlock(src, 'const TR_TABS = ['),
    constLine(src, 'trTabDef'),
    constLine(src, 'trRows'),
    extractFunction(src, 'trApplyData'),
    extractFunction(src, 'trRender'),
    extractFunction(src, 'trSend'),
    extractFunction(src, 'trSetSaving'),
    windowFn(src, '__trashDone'),
    'function __state(){',
    '  var ov = document.getElementById("trashModal");',
    '  return { busy: ov ? String(ov.dataset.busy || "") : "",',
    '    ops: Array.prototype.map.call(document.querySelectorAll("#trList [data-top]"), function(b){',
    '      return { op: b.dataset.top, key: b.dataset.tkey, disabled: !!b.disabled }; }),',
    '    posts: __posts.length, toasts: __toasts.slice() };',
    '}',
    'function __reset(payload, clickTab){',
    '  __trData = null; __trAdmin = false; __trTab = "project"; __trSaving = false; __trReq = null;',
    '  __trShown = null; __trKeepBtn = null;',
    '  __posts.length = 0; __toasts.length = 0;',
    '  trApplyData(payload);',
    '  if(clickTab){ var tb = document.querySelector("[data-trtab=\'" + clickTab + "\']"); if(tb) tb.click(); }',
    '}',
    'function __rid(){ return __trReq ? __trReq.id : ""; }',
    'window.__probe = function(payload, clickTab){',
    '  __reset(payload, clickTab);',
    '  var out = { idle: __state() };',
    '  trSend({ cmd: "trashDelete", kind: "user", key: "31", confirm: "zzU_a" });',
    '  out.sending = __state();',
    '  trSend({ cmd: "trashDelete", kind: "user", key: "31", confirm: "zzU_a" });',
    '  out.second = __state();',
    '  window.__trashDone(true, "지웠습니다", __rid());',
    '  out.done = __state();',
    '  return out;',
    '};',
    //  왕복 **중에** 호스트 푸시가 도착한다 — 목록이 통째로 다시 그려져도 잠금이 남아 있어야 한다.
    //  (잠금을 노드에 칠해 두던 옛 판은 바로 여기서 증발했다 · 2026-09-11)
    'window.__probeRerender = function(payload, clickTab){',
    '  __reset(payload, clickTab);',
    '  trSend({ cmd: "trashDelete", kind: "user", key: "31", confirm: "zzU_a" });',
    '  var out = { sending: __state() };',
    '  window.__applyTrashLike();',   // 푸시와 같은 경로(trApplyData)로 목록을 다시 그린다
    '  out.afterPush = __state();',
    '  window.__trashDone(true, "지웠습니다", __rid());',
    '  out.done = __state();',
    '  return out;',
    '};',
    'window.__applyTrashLike = function(){ trApplyData(JSON.parse(JSON.stringify(__trData))); };',
    //  ★ 렌더 횟수를 센다(2026-09-11 R2-W4) — '몇 번 그리는가'는 화면 결과만 봐서는 보이지 않는다.
    //    원본 함수를 감싸기만 한다(바꿔치기가 아니다): 세는 것 말고는 같은 함수가 돈다.
    'var __renders = 0;',
    'var __trRenderReal = trRender;',
    'trRender = function(){ __renders++; return __trRenderReal.apply(null, arguments); };',
    //  목록이 다시 만들어져도 **누르고 있던 행 버튼**에 포커스가 남는가(긴 휴지통에서 연달아 복구하기).
    'window.__probeFocusKeep = function(payload, clickTab){',
    '  __reset(payload, clickTab);',
    '  var b = document.querySelector("#trList [data-top=\'restore\']");',
    '  if(!b) return { found: false };',
    '  b.focus();',
    '  var started = document.activeElement === b;',
    '  var key = String(b.dataset.tkey || "");',
    '  window.__applyTrashLike();',   // 호스트 푸시와 같은 경로 — #trList 를 통째로 다시 만든다
    '  var act = document.activeElement;',
    '  return { found: true, started: started, key: key, same: act === b,',
    '           op: (act && act.dataset) ? String(act.dataset.top || "") : "",',
    '           actKey: (act && act.dataset) ? String(act.dataset.tkey || "") : "",',
    '           isBody: act === document.body };',
    '};',
    //  보던 자리(스크롤)는 **같은 화면일 때만** 남는다 — 탭을 바꾸면 내용이 통째로 달라지므로 맨 위가 옳다(R3-W2).
    'window.__probeScrollKeep = function(payload, toTab){',
    '  __reset(payload, null);',
    '  var list = document.getElementById("trList");',
    '  list.scrollTop = 120;',
    '  var set = list.scrollTop;',
    '  window.__applyTrashLike();',   // 같은 화면(같은 탭) — 보던 자리가 남아야 한다
    '  var same = list.scrollTop;',
    '  list.scrollTop = 120;',
    '  var tb = document.querySelector("[data-trtab=\'" + toTab + "\']");',
    '  if(tb) tb.click();',           // 탭 전환 — 다른 화면이므로 맨 위로
    '  var switched = list.scrollTop;',
    '  return { set: set, same: same, switched: switched, found: !!tb };',
    '};',
    //  잠금이 걸린 렌더는 행 버튼을 전부 끈다 — 그때 포커스는 **행**으로 물러나고, 풀리면 그 버튼으로 돌아온다(R3-W2).
    //   ★ 진짜 길(trSetSaving → trRender)로 몬다: __applyTrashLike 로 바로 그리면 '잠기는 순간'이 재현되지 않는다.
    'window.__probeLockFocus = function(payload, clickTab){',
    '  __reset(payload, clickTab);',
    '  var b = document.querySelector("#trList [data-top=\'restore\']");',
    '  if(!b) return { found: false };',
    '  b.focus();',
    '  var started = document.activeElement === b;',
    '  var key = String(b.dataset.tkey || "");',
    '  trSetSaving(true);',
    '  var a1 = document.activeElement;',
    '  var locked = { isBody: a1 === document.body,',
    '                 line: !!(a1 && a1.classList && a1.classList.contains("mba-line")),',
    '                 op: (a1 && a1.dataset) ? String(a1.dataset.top || "") : "" };',
    '  trSetSaving(false);',
    '  var a2 = document.activeElement;',
    '  var unlocked = { isBody: a2 === document.body,',
    '                   op: (a2 && a2.dataset) ? String(a2.dataset.top || "") : "",',
    '                   key: (a2 && a2.dataset) ? String(a2.dataset.tkey || "") : "",',
    '                   disabled: !!(a2 && a2.disabled) };',
    '  return { found: true, started: started, key: key, locked: locked, unlocked: unlocked };',
    '};',
    //  잠금 중에 관리자가 **다른 행**으로 포커스를 옮겼다면, 다음 렌더는 그것을 도로 뺏지 않는다(R4-W4).
    //   ★ 맡아 둔 표(__trKeepBtn)가 가리키는 행과 지금 포커스가 있는 행을 열쇠(data-tkey)로 대조한다.
    'window.__probeFocusMoved = function(payload, clickTab){',
    '  __reset(payload, clickTab);',
    '  var b = document.querySelector("#trList [data-top=\'restore\']");',
    '  if(!b) return { found: false };',
    '  b.focus();',
    '  var key = String(b.dataset.tkey || "");',
    '  trSetSaving(true);',   // 잠금 렌더 — 포커스가 그 행으로 물러나고, 되돌릴 버튼을 맡아 둔다
    '  var lines = document.querySelectorAll("#trList .mba-line");',
    '  var other = lines.length > 1 ? lines[1] : null;',
    '  if(!other) return { found: true, twoRows: false };',
    '  var otherKey = String(other.dataset.tkey || "");',
    '  other.focus();',      // 관리자가 다른 행으로 옮겼다
    '  var moved = document.activeElement === other;',
    '  trSetSaving(false);', // 잠금 해제 렌더 — 여기서 도로 뺏으면 결함이다
    '  var a = document.activeElement;',
    '  return { found: true, twoRows: true, key: key, otherKey: otherKey, moved: moved,',
    '           op: (a && a.dataset) ? String(a.dataset.top || "") : "",',
    '           actKey: (a && a.dataset) ? String(a.dataset.tkey || "") : "",',
    '           kept: !!__trKeepBtn };',
    '};',
    //  잠금이 **바뀔 때만** 그리는가 — 같은 값을 다시 넣는 호출은 목록을 건드리지 않아야 한다.
    'window.__probeRenderCount = function(payload, clickTab){',
    '  __reset(payload, clickTab);',
    '  __renders = 0;',
    '  trSetSaving(false);',   // 이미 꺼져 있다
    '  var noop = __renders;',
    '  trSetSaving(true);',    // 꺼짐 → 켜짐
    '  var on = __renders;',
    '  trSetSaving(true);',    // 이미 켜져 있다
    '  var again = __renders;',
    '  trSetSaving(false);',   // 켜짐 → 꺼짐(워치독도 함께 꺼진다)
    '  var off = __renders;',
    '  return { noop: noop, on: on - noop, again: again - on, off: off - again };',
    '};',
    //  지난 요청의 늦은 회신 — id 가 어긋나면 아무것도 하지 않는다(잠금도 그대로, 토스트도 없다).
    'window.__probeStale = function(payload, clickTab){',
    '  __reset(payload, clickTab);',
    '  trSend({ cmd: "trashDelete", kind: "user", key: "31", confirm: "zzU_a" });',
    '  var id = __rid();',
    '  window.__trashDone(true, "지웠습니다", id + "-STALE");',
    '  var out = { id: id, stale: __state() };',
    '  window.__trashDone(true, "지웠습니다", id);',
    '  out.done = __state();',
    '  return out;',
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
const TOTAL = 6;   // 2 + 2 + 1 + 0 + 1

//  ★ jsdom 부팅·JSON 왕복은 harness 의 runInJsdom 한 곳에 있다(사본은 반드시 낡는다).
//    JSON 왕복이 필요한 이유: jsdom 의 Array 는 다른 realm 이라 deepStrictEqual 이
//    프로토타입 불일치로 항상 실패한다(값은 같은데 판정이 거짓말을 한다).
const probeRender = (payload, clickTab, src = app) => runInJsdom(RENDER_FIXTURE, renderHarnessJs(src), '__probe', payload, clickTab);
const probeFocus = (payload, clickTab, src = app) => runInJsdom(RENDER_FIXTURE, renderHarnessJs(src), '__probeFocus', payload, clickTab);
const probeBusy = (payload, clickTab, src = app) => runInJsdom(RENDER_FIXTURE, busyHarnessJs(src), '__probe', payload, clickTab);
const probeRerender = (payload, clickTab, src = app) => runInJsdom(RENDER_FIXTURE, busyHarnessJs(src), '__probeRerender', payload, clickTab);
const probeStale = (payload, clickTab, src = app) => runInJsdom(RENDER_FIXTURE, busyHarnessJs(src), '__probeStale', payload, clickTab);
const probeFocusKeep = (payload, clickTab, src = app) => runInJsdom(RENDER_FIXTURE, busyHarnessJs(src), '__probeFocusKeep', payload, clickTab);
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

//  진입 버튼 — usAdminBtnSync 하나만 떼어 내 역할 문자열로 굴린다(user-admin.test.mjs 와 같은 방식,
//  다만 그 파일을 import 하지 않는다: 시험끼리 얽히면 한쪽 실패가 다른 쪽 판정을 덮는다).
function entryHarnessJs(src) {
  return [
    'function openUserAdmin(){} function openTrash(){}',
    extractFunction(src, 'usAdminBtnSync'),
    'window.__probe = function(role){',
    '  usAdminBtnSync(role);',
    '  var b = document.getElementById("usTrash");',
    '  var a = document.getElementById("usUserAdmin");',
    '  return { present: !!b, text: b ? String(b.textContent || "") : "", title: b ? String(b.title || "") : "",',
    '           after: !!(a && b && a.nextElementSibling === b), adminPresent: !!a };',
    '};',
  ].join('\n');
}
const ENTRY_FIXTURE = '<!doctype html><html><body><div class="us-mem-row" id="usMemberBtns">' +
  '<button type="button" class="btn sm" id="usMembers">구성원 보기</button></div></body></html>';
const probeEntry = (role, src = app) => runInJsdom(ENTRY_FIXTURE, entryHarnessJs(src), '__probe', role);
//  진짜 관문은 '한 번 만든 뒤 내려갔을 때'다 — 만들어 본 적이 없으면 숨김 변이도 통과한다.
function probeEntrySeq(roles, src = app) {
  const { JSDOM } = jsdom;
  const dom = new JSDOM(ENTRY_FIXTURE, { runScripts: 'outside-only' });
  dom.window.eval(entryHarnessJs(src));
  return roles.map((r) => JSON.parse(JSON.stringify(dom.window.__probe(r))));
}

if (!jsdom) {
  const { skip } = await import('./harness.mjs');
  skip('계약⑥-DOM(a): 「휴지통」 진입 버튼은 admin 회신일 때만 DOM 에 있다', SKIP_NO_JSDOM, '이 파일의 DOM 계약 6건이 세어지지 않음');
  skip('계약⑥-DOM(b): admin:false 면 탭도 행도 그리지 않는다(안내 한 줄뿐)', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(c): admin:true 면 탭 다섯 + 현재 탭의 행을 그린다', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(d): 삭제 불가 항목은 [영구 삭제]가 꺼지고 사유가 title 에 붙는다', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(e): 빈 탭 문구의 조사는 받침이 정한다', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(f): 삭제 불가 사유가 행에 보이는 줄로 나온다', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(g): 탭 줄은 tablist 이고 전환해도 포커스가 남는다', SKIP_NO_JSDOM);
  skip('계약⑥-DOM(h): 비관리자 안내는 호스트가 준 사유를 그대로 쓴다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(c): 전송 중에는 행 버튼이 잠기고 두 번째 클릭은 사유가 뜬다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(e): 왕복 중 푸시가 목록을 다시 그려도 잠금이 남는다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(f): 지난 요청의 늦은 회신은 아무것도 하지 않는다(reqId 대조)', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(g): 목록을 다시 그려도 누르던 행 버튼에 포커스가 남는다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(h): 잠금은 바뀔 때만 그린다(같은 값을 다시 넣는 호출은 목록을 건드리지 않는다)', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(i): 탭을 바꾸면 보던 자리는 맨 위다(같은 화면일 때만 되돌린다)', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(j): 잠기면 포커스가 행으로 물러나고, 풀리면 그 버튼으로 돌아온다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(i): 화면이 바뀌어도 옛 자리를 앉히면 관리자가 고른 적 없는 중간에서 시작한다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(j): 행이 포커스를 못 받으면 잠기는 순간 포커스가 body 로 떨어진다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(k): 잠금 중에 옮긴 포커스를 다음 렌더가 도로 뺏지 않는다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(k): 행을 가리지 않고 되돌리면 옮겨 둔 포커스가 엉뚱한 행으로 끌려간다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(g): 포커스 복원을 지우면 다시 그린 순간 포커스가 body 로 떨어진다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(h): trSetSaving 이 무조건 그리게 되돌리면 계약⑦-DOM(h) 가 실패한다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(e): 렌더에서 잠금을 빼면 푸시 한 번에 잠금이 증발한다', SKIP_NO_JSDOM);
  skip('변이⑥-DOM: 세 계약이 각각 한 줄 변이로 깨진다', SKIP_NO_JSDOM);
  skip('변이⑥-DOM(f): 사유 줄을 지우면 계약⑥-DOM(f) 가 실패한다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM(c): 잠금 복구를 무조건 켜기로 바꾸면 계약⑦-DOM(c) 가 실패한다', SKIP_NO_JSDOM);
  skip('계약⑦-DOM: 이름이 글자까지 같을 때만 [영구 삭제]가 켜진다(trim 없음)', SKIP_NO_JSDOM);
  skip('계약⑦-DOM(d): [취소]를 실제로 누르면 확인창이 cancel 로 해소된다', SKIP_NO_JSDOM);
  skip('변이⑦-DOM: 대조에 trim 을 끼우면 앞뒤 공백이 통과한다', SKIP_NO_JSDOM);
} else {
  test("계약⑥-DOM(a): 「휴지통」 진입 버튼은 edit_role==='admin' 일 때만 DOM 에 있다(숨김이 아니라 부재)", () => {
    for (const role of ['viewer', 'editor', '', null, 'superuser', 'Admin']) {
      const r = probeEntry(role);
      assert.strictEqual(r.present, false,
        `edit_role=${JSON.stringify(role)} 인데 「휴지통」 버튼이 DOM 에 있다 — 영구 삭제의 문은 관리자만 본다`);
    }
    const on = probeEntry('admin');
    assert.strictEqual(on.present, true, "edit_role='admin' 인데 「휴지통」 버튼이 만들어지지 않았다");
    assert.strictEqual(on.text, '휴지통', `버튼 문구가 다르다: ${JSON.stringify(on.text)}`);
    assert.ok(/관리자 전용/.test(on.title), `버튼 title 이 관리자 전용임을 말하지 않는다: ${JSON.stringify(on.title)}`);
    assert.strictEqual(on.after, true, '「휴지통」이 「구성원 편집」 바로 뒤가 아니다 — 관리 진입점 둘은 한 자리에 붙어 있어야 한다');
    //  ★ 진짜 관문: 관리자였다가 내려간 경우. 숨김으로 바꾸면 여기서만 드러난다.
    const seq = probeEntrySeq(['admin', 'editor', 'admin', '']);
    assert.deepStrictEqual(seq.map((x) => x.present), [true, false, true, false],
      `역할이 바뀔 때 버튼이 생겼다 사라지지 않는다: ${JSON.stringify(seq.map((x) => x.present))}`);
    assert.deepStrictEqual(seq.map((x) => x.adminPresent), [true, false, true, false],
      '「구성원 편집」과 「휴지통」이 함께 나고 지지 않는다 — 한 함수·한 판정이어야 한다');
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

  test('계약⑥-DOM(c): admin:true 면 탭 다섯(건수 배지) + 현재 탭의 행을 그린다', () => {
    const r = probeRender(PAYLOAD);
    assert.deepStrictEqual(r.tabs.map((t) => t.kind), ['project', 'user', 'customer', 'section', 'status'],
      `탭 구성이 계약과 다르다: ${JSON.stringify(r.tabs.map((t) => t.kind))} — 다섯 표를 한 화면이 진다`);
    assert.deepStrictEqual(r.tabs.map((t) => t.text), ['과제2', '인력2', '발주처1', '구분0', '상태1'],
      `탭 문구·건수 배지가 계약과 다르다: ${JSON.stringify(r.tabs.map((t) => t.text))}`);
    assert.deepStrictEqual(r.tabs.map((t) => t.sel), ['true', 'false', 'false', 'false', 'false'],
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
    assert.deepStrictEqual(cu.tabs.map((t) => t.sel), ['false', 'false', 'true', 'false', 'false'],
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
    //  탭 자체는 남는다 — 0건이라고 탭이 사라지면 '왜 다섯이 아니지'가 된다.
    assert.strictEqual(r.tabs.length, 5, '빈 탭을 골랐더니 탭 줄이 무너졌다');
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
    assert.deepStrictEqual(r.tabs.map((t) => t.role), ['tab', 'tab', 'tab', 'tab', 'tab'], '탭 버튼에 role=tab 이 없다');
    assert.deepStrictEqual(r.tabs.map((t) => t.tabIndex), [0, -1, -1, -1, -1],
      `roving tabindex 가 아니다: ${JSON.stringify(r.tabs.map((t) => t.tabIndex))} — 탭 줄은 Tab 한 번으로 지나가야 한다(APG)`);
    //  비관리자에게는 구조 자체가 없다(탭이 없는데 tablist 라고 하면 보조기술에 없는 것을 알린다).
    const off = probeRender({ found: true, admin: false });
    assert.strictEqual(off.tabsRole, '', 'admin:false 인데 tablist role 이 남아 있다');
    assert.strictEqual(off.listRole, '', 'admin:false 인데 tabpanel role 이 남아 있다');
    //  ★ 탭을 누르면 탭 줄이 통째로 다시 그려진다 — 그때 포커스가 body 로 떨어지면 키보드 사용자는 길을 잃는다.
    const f = probeFocus(PAYLOAD, 'user');
    assert.strictEqual(f.started, true, '전제 붕괴: 탭 버튼에 포커스가 가지 않았다');
    assert.strictEqual(f.isBody, false, '탭을 바꾸자 포커스가 body 로 떨어졌다 — 다음 화살표키가 아무 데도 닿지 않는다');
    assert.strictEqual(f.onTab, 'user', `포커스가 새로 선택된 탭에 있지 않다: ${JSON.stringify(f.onTab)}`);
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

  test('계약⑦-DOM(c): 전송 중에는 행 버튼이 모두 잠기고, 두 번째 클릭은 사유를 말한다', () => {
    const r = probeBusy(PAYLOAD, 'user');
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
  });

  test('변이⑥-DOM(f): 사유 줄을 지우면 계약⑥-DOM(f) 가 실패한다(title 만 남으면 아무도 못 본다)', () => {
    const bad = mutate(app, "    if(it && it.deletable === false && it.why){", '    if(false){');
    const r = probeRender(PAYLOAD, 'user', bad);
    assert.strictEqual(r.whys.length, 0, '변이 전제: 사유 줄이 사라져야 한다');
    assert.strictEqual(probeRender(PAYLOAD, 'user').whys.length, 1);   // 통제군
  });

  test('변이⑦-DOM(c): 잠금 복구를 "무조건 켜기"로 바꾸면 계약⑦-DOM(c) 가 실패한다', () => {
    const bad = mutate(app, '    db.disabled = !deletable || __trSaving;', '    db.disabled = __trSaving;');
    const r = probeBusy(PAYLOAD, 'user', bad);
    assert.deepStrictEqual(r.done.ops.map((o) => o.disabled), [false, false, false, false],
      '변이 전제: 데이터 쪽 잠금을 빼면 지울 수 없는 계정의 [영구 삭제]도 켜져야 한다');
    assert.strictEqual(probeBusy(PAYLOAD, 'user').done.ops[3].disabled, true);   // 통제군
  });

  //  ★ 진짜 관문은 '왕복 **중에** 목록이 다시 그려졌을 때'다(2026-09-11 적대 검토 R3-W2).
  //    잠금을 노드에 칠해 두던 옛 판은 여기서만 드러난다 — 평범한 왕복은 그 판에서도 멀쩡히 통과했다.
  test('계약⑦-DOM(e): 왕복 중에 푸시가 목록을 다시 그려도 잠금이 남는다', () => {
    const r = probeRerender(PAYLOAD, 'user');
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

  test('변이⑦-DOM(e): 렌더에서 잠금을 빼면 푸시 한 번에 잠금이 증발한다(그래서 이 계약이 필요하다)', () => {
    const bad = mutate(app, '    rb.disabled = __trSaving;', '    rb.disabled = false;');
    const r = probeRerender(PAYLOAD, 'user', bad);
    assert.strictEqual(r.afterPush.ops[0].disabled, false,
      '변이 전제: 렌더가 잠금을 보지 않으면 푸시 뒤 [복구]가 켜져 있어야 한다');
    assert.strictEqual(probeRerender(PAYLOAD, 'user').afterPush.ops[0].disabled, true);   // 통제군
  });

  //  ★ 늦은 회신 — 호스트가 우리가 보낸 reqId 를 그대로 실어 준다. 어긋나면 지난 요청의 것이다.
  test('계약⑦-DOM(f): 지난 요청의 늦은 회신은 아무것도 하지 않는다(reqId 대조)', () => {
    const r = probeStale(PAYLOAD, 'user');
    assert.ok(r.id, '전제 붕괴: trSend 가 reqId 를 발번하지 않았다');
    //  ① 어긋난 id — 잠금도 그대로, 토스트도 없다.
    assert.strictEqual(r.stale.busy, '1', '지난 요청의 회신이 overlay 의 busy 를 풀었다 — 아직 기다리는 요청이 있다');
    assert.deepStrictEqual(r.stale.ops.map((o) => o.disabled), [true, true, true, true],
      `지난 요청의 회신이 행 버튼을 풀었다: ${JSON.stringify(r.stale.ops)}`);
    assert.deepStrictEqual(r.stale.toasts, [],
      `지난 요청의 회신이 토스트를 띄웠다: ${JSON.stringify(r.stale.toasts)} — 지금 대상의 결과인 양 말하면 화면이 거짓말을 한다`);
    //  ② 맞는 id — 그때 처리된다.
    assert.strictEqual(r.done.busy, '', '맞는 회신이 왔는데 잠금이 풀리지 않았다');
    assert.strictEqual(r.done.toasts.length, 1, `맞는 회신의 안내가 ${r.done.toasts.length}건이다(1건이어야 한다)`);
    assert.strictEqual(r.done.toasts[0].kind, 'success', `결과 안내의 종류가 다르다: ${JSON.stringify(r.done.toasts[0])}`);
  });

  //  ★ 긴 휴지통에서 연달아 복구하기 — 목록은 쓰기마다 여러 번 다시 만들어진다(잠금·회신·푸시).
  //    누르던 버튼이 그때마다 사라져 포커스가 body 로 떨어지면, 다음 항목을 키보드로 이어서 못 고른다
  //    (명부의 ▲▼ 가 겪은 것과 같은 일이다 · 2026-09-11 적대 검토 R2-W4).
  test('계약⑦-DOM(g): 목록을 다시 그려도 누르던 행 버튼에 포커스가 남는다', () => {
    const r = probeFocusKeep(PAYLOAD, 'user');
    assert.strictEqual(r.found, true, '전제 붕괴: [복구] 버튼을 찾지 못했다');
    assert.strictEqual(r.started, true, '전제 붕괴: 행 버튼에 포커스를 주지 못했다');
    assert.strictEqual(r.isBody, false, '다시 그리자 포커스가 body 로 떨어졌다 — 여기서 키보드 조작이 끊긴다');
    assert.strictEqual(r.same, false, '전제 붕괴: 목록이 다시 만들어지지 않았다(같은 노드가 그대로 있다)');
    assert.strictEqual(r.op, 'restore', `포커스가 다른 버튼으로 옮겨 갔다: ${JSON.stringify(r)}`);
    assert.strictEqual(r.actKey, r.key, `포커스가 다른 행으로 옮겨 갔다: ${JSON.stringify(r)}`);
  });

  //  ★ 자리를 되돌리는 것은 **같은 화면일 때만**이다(2026-09-11 적대 검토 R3-W2). 탭을 바꾸면 목록의
  //    내용이 통째로 달라진다 — 옛 자리를 그대로 앉히면 관리자가 고른 적 없는 중간에서 시작하고,
  //    새 탭이 더 짧으면 아무것도 없는 자리에 선다(빈 화면처럼 보인다).
  test('계약⑦-DOM(i): 탭을 바꾸면 보던 자리는 맨 위다(같은 화면일 때만 되돌린다)', () => {
    const r = probeScrollKeep(PAYLOAD, 'customer');
    assert.strictEqual(r.found, true, '전제 붕괴: 발주처 탭 버튼을 찾지 못했다');
    assert.strictEqual(r.set, 120, '전제 붕괴: jsdom 이 scrollTop 을 기억하지 못한다 — 이 계약을 잴 수 없다');
    assert.strictEqual(r.same, 120,
      `같은 화면을 다시 그렸는데 보던 자리가 ${r.same} 로 튀었다 — 푸시 한 번에 목록이 맨 위로 돌아간다(R2-W4)`);
    assert.strictEqual(r.switched, 0,
      `탭을 바꿨는데 옛 스크롤 자리(${r.switched})가 그대로 앉았다 — 새 탭의 첫 줄이 화면 밖에서 시작한다(R3-W2)`);
  });

  //  ★ 잠금이 걸린 첫 렌더는 행 버튼을 **전부 끈 채로** 그린다 = 방금 누른 버튼이 꺼져 포커스를 줄 수 없다.
  //    그때 body 로 떨어지면 Tab 이 문서 처음부터 다시 시작한다 — 행으로 물러났다가, 풀리면 돌아와야 한다.
  //    ★ 진짜 길(trSetSaving → trRender)로 몬다: 렌더만 직접 부르면 '잠기는 순간'이 재현되지 않는다.
  test('계약⑦-DOM(j): 잠기면 포커스가 행으로 물러나고, 풀리면 그 버튼으로 돌아온다', () => {
    const r = probeLockFocus(PAYLOAD, 'user');
    assert.strictEqual(r.found, true, '전제 붕괴: [복구] 버튼을 찾지 못했다');
    assert.strictEqual(r.started, true, '전제 붕괴: 행 버튼에 포커스를 주지 못했다');
    assert.strictEqual(r.locked.isBody, false,
      `잠기는 순간 포커스가 body 로 떨어졌다 — 여기서 Tab 이 문서 처음으로 돌아간다: ${JSON.stringify(r.locked)}`);
    assert.strictEqual(r.locked.line, true,
      `잠금 중 포커스가 행(.mba-line)에 있지 않다: ${JSON.stringify(r.locked)} — 물러설 자리는 그 행이다`);
    assert.strictEqual(r.unlocked.isBody, false, '잠금이 풀리자 포커스가 body 로 떨어졌다');
    assert.strictEqual(r.unlocked.op, 'restore',
      `잠금이 풀렸는데 누르던 버튼으로 돌아오지 않았다: ${JSON.stringify(r.unlocked)} — 다음 항목을 이어서 누를 수 없다`);
    assert.strictEqual(r.unlocked.key, r.key, `풀린 뒤 포커스가 다른 행으로 갔다: ${JSON.stringify(r.unlocked)}`);
    assert.strictEqual(r.unlocked.disabled, false, '되돌아온 버튼이 아직 꺼져 있다 — 잠금이 풀리지 않았다');
  });

  test('변이⑦-DOM(i): 화면이 바뀌어도 옛 자리를 앉히면 관리자가 고른 적 없는 중간에서 시작한다', () => {
    const bad = mutate(app, '  list.scrollTop = sameView ? keepTop : 0;', '  list.scrollTop = keepTop;');
    const r = probeScrollKeep(PAYLOAD, 'customer', bad);
    assert.strictEqual(r.switched, 120,
      `변이 전제: 같은 화면 판정을 지우면 탭을 바꿔도 옛 자리가 앉아야 한다(실제: ${JSON.stringify(r)})`);
    assert.strictEqual(probeScrollKeep(PAYLOAD, 'customer').switched, 0);   // 통제군
  });

  //  ★ 되돌리는 조건은 "포커스가 아직 **물러났던 그 행**에 있을 때"다(2026-09-11 적대 검토 R4-W4).
  //    목록 안의 아무 행이나로 보던 옛 판은, 잠금 중에 관리자가 다른 행으로 옮겨 둔 포커스를 다음
  //    렌더가 도로 뺏어 엉뚱한 줄로 끌고 갔다(연달아 지우는 중에 커서가 제멋대로 뛴다).
  test('계약⑦-DOM(k): 잠금 중에 옮긴 포커스를 다음 렌더가 도로 뺏지 않는다', () => {
    const r = probeFocusMoved(PAYLOAD, 'user');
    assert.strictEqual(r.found, true, '전제 붕괴: [복구] 버튼을 찾지 못했다');
    assert.strictEqual(r.twoRows, true, '전제 붕괴: 두 행이 필요하다(옮겨 갈 다른 행이 없다)');
    assert.strictEqual(r.moved, true, '전제 붕괴: 다른 행으로 포커스를 옮기지 못했다');
    assert.notStrictEqual(r.otherKey, r.key, `전제 붕괴: 옮겨 간 행이 같은 행이다(${r.otherKey})`);
    assert.notStrictEqual(r.actKey, r.key,
      `잠금이 풀리자 포커스를 원래 행으로 도로 뺏었다: ${JSON.stringify(r)} — 관리자가 옮겨 둔 자리가 옳다(R4-W4)`);
    assert.notStrictEqual(r.op, 'restore',
      `옮겨 둔 포커스를 맡아 둔 버튼으로 끌고 갔다: ${JSON.stringify(r)}`);
    assert.strictEqual(r.kept, false, '되돌리지 않았는데 맡아 둔 표가 남아 있다 — 다음 렌더가 또 끌고 간다');
  });

  test('변이⑦-DOM(k): 행을 가리지 않고 되돌리면 옮겨 둔 포커스가 엉뚱한 행으로 끌려간다', () => {
    const bad = mutate(app, "     && af.dataset && String(af.dataset.tkey || '') === __trKeepBtn.key){", '     ){');
    const r = probeFocusMoved(PAYLOAD, 'user', bad);
    assert.strictEqual(r.actKey, r.key,
      `변이 전제: 행을 가리지 않으면 옮겨 둔 포커스가 맡아 둔 행으로 끌려가야 한다(실제: ${JSON.stringify(r)})`);
    assert.notStrictEqual(probeFocusMoved(PAYLOAD, 'user').actKey, r.key);   // 통제군
  });

  test('변이⑦-DOM(j): 행이 포커스를 못 받으면 잠기는 순간 포커스가 body 로 떨어진다', () => {
    const bad = mutate(app, '    line.tabIndex = -1;\n', '');
    const r = probeLockFocus(PAYLOAD, 'user', bad);
    assert.strictEqual(r.locked.isBody, true,
      `변이 전제: 행이 포커스를 못 받으면 잠금 렌더에서 body 로 떨어져야 한다(실제: ${JSON.stringify(r.locked)})`);
    assert.strictEqual(probeLockFocus(PAYLOAD, 'user').locked.isBody, false);   // 통제군
  });

  test('계약⑦-DOM(h): 잠금은 바뀔 때만 그린다(같은 값을 다시 넣는 호출은 목록을 건드리지 않는다)', () => {
    const r = probeRenderCount(PAYLOAD, 'user');
    assert.strictEqual(r.noop, 0,
      `이미 꺼진 잠금을 다시 끄는데 목록을 ${r.noop}번 그렸다 — 그 호출 하나로 스크롤과 누른 버튼이 사라진다`);
    assert.strictEqual(r.on, 1, `잠글 때 목록을 ${r.on}번 그렸다(1번이어야 한다)`);
    assert.strictEqual(r.again, 0, `이미 잠긴 상태를 다시 잠그는데 목록을 ${r.again}번 그렸다`);
    assert.strictEqual(r.off, 1, `풀 때 목록을 ${r.off}번 그렸다(1번이어야 한다)`);
  });

  test('변이⑦-DOM(g): 포커스 복원을 지우면 다시 그린 순간 포커스가 body 로 떨어진다(그래서 이 계약이 필요하다)', () => {
    //  ★ 두 갈래(버튼 · 물러설 행)를 **함께** 끈다 — 버튼 갈래만 끄면 행으로 물러나 body 로 떨어지지 않는다.
    const bad = mutate(app, '    if(kb && !kb.disabled){ try{ kb.focus(); }catch(_){} }\n    else if(kb){',
      '    if(false){ try{ kb.focus(); }catch(_){} }\n    else if(false){');
    const r = probeFocusKeep(PAYLOAD, 'user', bad);
    assert.strictEqual(r.started, true, '변이 전제: 처음 포커스는 잡혔어야 한다');
    assert.strictEqual(r.isBody, true,
      `변이 전제: 복원을 지우면 포커스가 body 로 떨어져야 한다(실제: ${JSON.stringify(r)})`);
    assert.strictEqual(probeFocusKeep(PAYLOAD, 'user').isBody, false);   // 통제군
  });

  test('변이⑦-DOM(h): trSetSaving 이 무조건 그리게 되돌리면 계약⑦-DOM(h) 가 실패한다', () => {
    const bad = mutate(app, '  const changed = (__trSaving !== !!on);', '  const changed = true;');
    const r = probeRenderCount(PAYLOAD, 'user', bad);
    assert.strictEqual(r.noop, 1, `변이 전제: 무조건 그리면 헛호출도 1번 그려야 한다(실제: ${JSON.stringify(r)})`);
    assert.strictEqual(r.again, 1, '변이 전제: 이미 잠긴 상태를 다시 잠글 때도 그려야 한다');
    assert.strictEqual(probeRenderCount(PAYLOAD, 'user').noop, 0);   // 통제군
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

    // (a) 진입 버튼 제거를 숨김으로 바꾸는 한 줄 → 내려간 뒤에도 DOM 에 남는다
    const badA = mutate(app, '  if(!on && curT && curT.parentNode) curT.parentNode.removeChild(curT);',
      "  if(!on && curT) curT.classList.add('hidden');");
    const ra = probeEntrySeq(['admin', 'editor'], badA);
    assert.strictEqual(ra[1].present, true,
      '변이 전제: 숨김으로 바꾸면 내려간 뒤에도 버튼이 DOM 에 남아야 한다(그래서 부재 계약이 필요하다)');

    // 통제군 — 원본은 셋 다 계약을 지킨다.
    assert.strictEqual(probeRender({ found: true, admin: false }).tabs.length, 0);
    assert.strictEqual(probeRender(PAYLOAD, 'user').ops.filter((o) => o.op === 'delete')[1].disabled, true);
    assert.strictEqual(probeEntrySeq(['admin', 'editor'])[1].present, false);
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
