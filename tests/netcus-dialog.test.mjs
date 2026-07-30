// netcus 스크립트 다이얼로그 자동 수락 — 구조 불변식 + 변이 검증
//
// 이 파일의 존재 이유(실측으로 확정된 사고):
//   로그인이 항상 상한(4000ms)을 꽉 쓰고 실패했다. 제출은 정상(제출=1)인데, netcus의 실패 응답이
//     <script>window.alert('아이디를 입력해 주십시오.'); history.go(-1);</script>
//   이라서 alert()가 파서를 멈추고 → history.go(-1)이 안 돌고 → NavigationCompleted가 영영 안 왔다.
//   우리에겐 AttachDialogAutoAccept(자동 수락)가 있었지만 전체 로그에 'alert:' 0건 —
//   WebView2는 CoreWebView2Settings.AreDefaultScriptDialogsEnabled=false 일 때만
//   ScriptDialogOpening을 raise 하는데, 그 설정을 아무 데서도 하지 않아 7개 op 전부에서 죽은 코드였다.
//
// 그리고 이 수정은 '끄기만 하고 늦게 되돌리면' 더 나빠진다 — WebView2 실기 하네스로 측정한 두 가지:
//   ① AreDefaultScriptDialogsEnabled 는 '문서 로드 시점에 스냅샷'된다.
//      문서를 로드한 뒤 detach 에서 원복해도, 이미 로드된 그 문서에는 안 먹는다.
//   ② 핸들러를 붙였다 떼면 무음 취소가 아니라 '응답 주체 없는 영구 정지'가 된다
//      (기본 다이얼로그는 꺼져 있고 핸들러도 없다 = 아무도 응답하지 않는다).
//   실측 대조: detach 를 인계 문서 로드 '뒤'에 하면 다이얼로그가 아예 안 뜨고 정지,
//             핸들러를 붙인 채 두면 무음 ACCEPTED(삭제 confirm 이 확인 없이 통과),
//             인계 문서 로드 '전'에 detach 하면 순정과 동일하게 다이얼로그가 뜬다.
//
// → 그래서 이 파일이 기계로 잡는 계약은 "원복 줄이 있다"가 아니라
//   ★ 사용자에게 넘길 문서를 로드하기 '전에' detach 가 끝나 있다 ★ 는 순서다.
//   원복 줄의 존재만 보는 검사는 아무것도 증명하지 못한 채 통과한다(그렇게 사고가 났다).
import { test, assert } from './harness.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const NETCUS_URL = new URL('../widget/NetcusService.cs', import.meta.url);
const netcus = readFileSync(NETCUS_URL, 'utf8');
const widgetDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'widget');

// ── 도우미 ──────────────────────────────────────────────────────────
// 주석 제거 — 이 수정은 주석에 'AreDefaultScriptDialogsEnabled=false'를 그대로 적어 두었다.
// 주석을 안 걷어내면 코드 줄을 통째로 지워도 검사가 통과한다(불변식이 무의미해짐).
function stripComments(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
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

// from 이후 첫 '{'부터 짝이 맞는 '}'까지(문자열 리터럴 안의 중괄호는 세지 않는다).
function braceSlice(code, from) {
  let i = code.indexOf('{', from);
  assert.ok(i >= 0, '중괄호 블록을 찾지 못함');
  let depth = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"') { i++; while (i < code.length) { if (code[i] === '\\') { i += 2; continue; } if (code[i] === '"') { i++; break; } i++; } continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return code.slice(from, i + 1); }
    i++;
  }
  throw new Error('중괄호 짝이 맞지 않음');
}

// idx를 감싸는 C# 멤버(8칸 들여쓰기 선언 기준) 슬라이스.
function enclosingMember(code, idx) {
  const re = /\n {8}(?:public|private|internal|protected|static)\b/g;
  let start = 0, end = code.length, m;
  while ((m = re.exec(code)) !== null) {
    if (m.index + 1 <= idx) start = m.index + 1;
    else { end = m.index + 1; break; }
  }
  return code.slice(start, end);
}

// 문자열 needle의 모든 등장 위치.
function indexesOf(hay, needle) {
  const out = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}

// AttachDialogAutoAccept 본문(선언부 제외한 호출부는 아래 callSites가 따로 본다).
function attachBody(source) {
  const code = stripComments(source);
  const i = code.indexOf('private Action AttachDialogAutoAccept(');
  assert.ok(i >= 0, 'AttachDialogAutoAccept 선언을 찾지 못함');
  return braceSlice(code, i);
}

// 반환되는 detach 람다 본문(= 'return () =>' 이후).
function detachLambda(source) {
  const body = attachBody(source);
  const i = body.indexOf('return () =>');
  assert.ok(i >= 0, 'AttachDialogAutoAccept가 detach 람다를 반환하지 않는다');
  return braceSlice(body, i);
}

// 호출부 목록 — 선언을 제외한 모든 AttachDialogAutoAccept( 호출. tag와 감싸는 멤버를 함께 준다.
function callSites(source) {
  const code = stripComments(source);
  const out = [];
  const re = /AttachDialogAutoAccept\(\s*cw\s*,\s*"([^"]+)"\s*\)/g;
  let m;
  while ((m = re.exec(code)) !== null) out.push({ tag: m[1], idx: m.index, member: enclosingMember(code, m.index) });
  return out;
}

// op의 finally에서 확인창을 닫는가(=사용자에게 넘기는 문서가 없다).
function closesWindow(site) {
  const fi = site.member.indexOf('finally');
  if (fi < 0) return false;                       // finally 자체가 없으면 창을 남긴다(probe)
  return /_w2win\?\.Close\(\)/.test(braceSlice(site.member, fi));
}

// ── 인계(handoff) 지점 ────────────────────────────────────────────────
// '인계 문서' = 이 로드 이후 창이 사용자 손에 남는 문서. 그 로드보다 detach가 앞서야 한다.
// merge·weekly·userlogin·validate는 finally에서 창을 닫으므로 인계가 없다(아래에서 코드로 확인).
const HANDOFF_LOADS = {
  // 주간 채움: 목록에서 pjm_write.jsp로 POST하는 그 순간이 인계 문서의 로드다(창을 열어둔 채 반환).
  week: 'await cw.ExecuteScriptAsync(goWrite);',
  // 캡처: 게시판 홈으로 이동한 뒤 창을 그대로 열어두고 사용자가 직접 탐색·삭제한다.
  probe: 'await NavTo(cw, "https://www.netcus.com/pjm/pjm.jsp?id=" + Uri.EscapeDataString(id));',
  // 일간 전송: ①DryRun(미제출)이 남기는 폼 페이지 ②실제 제출 뒤 되읽기 페이지 — 같은 문장이 두 번 나온다.
  submit: 'await NavTo(cw, url);',
};

// detach 완료 표식 — 호출과 '다시 안 쓴다'는 표시를 한 문장으로 묶은 형태.
// 이 형태로 고정해야 조기이탈 경로의 detach(로그인 실패 등)와 구분되어 순서 검사가 의미를 갖는다.
const DETACH_DONE = /detach\?\.Invoke\(\);\s*detach = null;/g;

// ══ 검사 함수(테스트 + 변이 주입이 같은 함수를 쓴다) ══════════════════
// 각 함수는 위반 시 throw 한다. 변이 테스트는 "이 검사가 실제로 잡는가"를 증명한다.
const checks = {
  // ① 설정을 실제로 끈다(=false). 이 한 줄이 없으면 ScriptDialogOpening이 영영 안 온다.
  setsFalse(source) {
    const b = attachBody(source);
    assert.ok(/cw\.Settings\.AreDefaultScriptDialogsEnabled\s*=\s*false\s*;/.test(b),
      'AttachDialogAutoAccept가 AreDefaultScriptDialogsEnabled=false 를 설정하지 않는다 — 핸들러는 죽은 코드가 된다');
  },

  // ② 이전 값을 '끄기 전에' 캡처한다. 끈 뒤에 읽으면 prev가 항상 false라 원복이 원복이 아니게 된다.
  capturesPrevFirst(source) {
    const b = attachBody(source);
    const cap = b.search(/bool\s+prev\s*=\s*cw\.Settings\.AreDefaultScriptDialogsEnabled\s*;/);
    assert.ok(cap >= 0, '원복용 이전 값(prev)을 캡처하지 않는다');
    const off = b.search(/cw\.Settings\.AreDefaultScriptDialogsEnabled\s*=\s*false\s*;/);
    assert.ok(off >= 0 && cap < off, 'prev 캡처가 =false 뒤에 있다 — prev가 항상 false가 되어 원복이 무의미해진다');
  },

  // ③ detach가 설정을 원복한다 — 필요조건(이게 없으면 아무 문서도 정상으로 못 돌아온다).
  //    단 충분조건은 아니다: 원복은 '앞으로 로드될 문서'에만 먹는다 → 순서 계약은 ⑨가 본다.
  restoresOnDetach(source) {
    const l = detachLambda(source);
    assert.ok(/cw\.Settings\.AreDefaultScriptDialogsEnabled\s*=\s*prev\s*;/.test(l),
      'detach가 AreDefaultScriptDialogsEnabled를 prev로 원복하지 않는다 — 설정이 영영 꺼진 채로 남는다');
  },

  // ④ detach가 핸들러도 해제한다(설정 원복과 같은 곳에 묶여 짝이 어긋날 수 없어야 한다).
  removesHandlerOnDetach(source) {
    const l = detachLambda(source);
    assert.ok(/ScriptDialogOpening\s*-=\s*H\s*;/.test(l), 'detach가 ScriptDialogOpening 핸들러를 해제하지 않는다');
  },

  // ⑤ 핸들러는 메시지를 로그에 남기고 ev.Accept()로 수락한다(대기 해제의 본체).
  handlerAcceptsAndLogs(source) {
    const b = attachBody(source);
    const h = b.indexOf('void H(');
    assert.ok(h >= 0, '다이얼로그 핸들러 H를 찾지 못함');
    const hb = braceSlice(b, h);
    assert.ok(/ev\.Accept\(\)/.test(hb), '핸들러가 ev.Accept()를 부르지 않는다 — 다이얼로그가 그대로 걸려 op가 타임아웃을 꽉 쓴다');
    assert.ok(/Log\(\s*"netcus\("\s*\+\s*tag/.test(hb), '핸들러가 tag와 함께 로그를 남기지 않는다 — 다시 죽어도 로그로 알 수 없다');
    assert.ok(/ev\.Message/.test(hb), '핸들러가 다이얼로그 메시지를 로그에 남기지 않는다');
  },

  // ⑥ 호출부 계약 — 7곳 전부가 detach를 '반드시 도는 경로'에서 부른다.
  //    (인계 전에 중단되는 경로에서도 설정이 꺼진 채 남지 않게 하는 마지막 그물)
  allCallSitesDetach(source) {
    const sites = callSites(source);
    const tags = sites.map((s) => s.tag).sort();
    assert.deepStrictEqual(tags, ['merge', 'probe', 'submit', 'userlogin', 'validate', 'week', 'weekly'],
      `AttachDialogAutoAccept 호출부 목록이 계약과 다르다: ${tags}`);

    for (const s of sites) {
      if (s.tag === 'probe') continue;   // probe만 finally가 없다(창을 남긴 채 반환) — 아래 ⑦에서 따로 본다
      const fi = s.member.indexOf('finally');
      assert.ok(fi >= 0, `${s.tag}: detach를 보장할 finally 블록이 없다`);
      const fb = braceSlice(s.member, fi);
      assert.ok(/detach\?\.Invoke\(\)/.test(fb),
        `${s.tag}: finally에서 detach를 부르지 않는다 — 중단 경로에서 설정이 꺼진 채 남는다`);
    }
  },

  // ⑦ probe 계약(뒤집힘) — detach는 인계 '직전'에 끝난다. 창 Closed에서는 detach하지 않는다.
  //    Closed는 창이 닫힌 뒤 = 캡처 세션 내내 자동수락이 살아 있었다는 뜻이고,
  //    실측상 그 상태에서 목록의 confirm('정말로 삭제하시겠습니까?')이 무음 수락된다(주간보고가 그냥 삭제).
  probeNoDetachOnClose(source) {
    const site = callSites(source).find((s) => s.tag === 'probe');
    assert.ok(site, 'probe 호출부를 찾지 못함');
    const m = site.member;

    const ci = m.indexOf('.Closed +=');
    assert.ok(ci >= 0, 'probe가 창 Closed 핸들러를 배선하지 않는다 — _ncBusy/_probeOpen이 영영 안 풀린다');
    const cb = braceSlice(m, ci);
    assert.ok(!/detach/.test(cb),
      'probe가 detach를 창 Closed로 미룬다 — 캡처 세션 내내 자동수락이 살아 삭제 confirm이 무음 수락된다(주간보고가 확인창 없이 삭제)');
    assert.ok(!/detachOnClose/.test(m), 'probe가 detach를 Closed용으로 캡처해 둔다 — 인계 뒤로 미루는 형태의 잔재');

    // Closed의 나머지 정리는 그대로 유지돼야 한다 — 빠지면 다음 op가 busy로 영구 차단된다.
    assert.ok(/WebMessageReceived -= OnProbeMsg/.test(cb) && /NavigationCompleted -= OnProbeNav/.test(cb),
      'probe의 Closed 핸들러가 프로브 핸들러를 해제하지 않는다 — 핸들러 누수');
    assert.ok(/_ncBusy = false;/.test(cb) && /_probeOpen = false;/.test(cb),
      'probe의 Closed 핸들러가 busy/열림 플래그를 해제하지 않는다 — 이후 모든 netcus op가 막힌다');

    // 인계 전에 빠져나가는 경로(로그인 실패·예외)는 여전히 각자 detach를 불러야 한다.
    const li = m.indexOf('if (!await NetcusLoginVerify');
    assert.ok(li >= 0 && /detach\?\.Invoke\(\)/.test(braceSlice(m, li)), 'probe의 로그인 실패 경로가 detach를 부르지 않는다');
    const ei = m.lastIndexOf('catch (Exception');
    assert.ok(ei >= 0 && /detach\?\.Invoke\(\)/.test(braceSlice(m, ei)), 'probe의 예외 경로가 detach를 부르지 않는다');
  },

  // ⑧ 이 설정은 AttachDialogAutoAccept 한 곳만 만진다(전역으로 켜두는 코드 금지).
  onlyAttachTouchesSetting(source) {
    const code = stripComments(source);
    const body = attachBody(source);
    const bi = code.indexOf(body);
    const hits = [...code.matchAll(/AreDefaultScriptDialogsEnabled/g)].map((x) => x.index);
    assert.strictEqual(hits.length, 3, `AreDefaultScriptDialogsEnabled 참조가 3개(캡처·끄기·원복)가 아니다: ${hits.length}`);
    for (const h of hits) {
      assert.ok(h >= bi && h < bi + body.length,
        'AttachDialogAutoAccept 바깥에서 AreDefaultScriptDialogsEnabled를 만진다 — 전역으로 켜면 주간 채움 confirm이 죽는다');
    }
  },

  // ⑨ ★ 본 계약 ★ — 사용자에게 넘길 문서를 '로드하기 전에' detach가 끝나 있다.
  //    설정은 문서 로드 시점 스냅샷이라 로드 뒤 원복은 그 문서에 안 먹고(실측),
  //    붙였다 뗀 핸들러는 무음 취소가 아니라 응답 주체 없는 영구 정지가 된다.
  //    → attach → detach → 인계 로드 순서를 소스에서 직접 확인한다.
  detachBeforeHandoff(source) {
    for (const [tag, anchor] of Object.entries(HANDOFF_LOADS)) {
      const site = callSites(source).find((s) => s.tag === tag);
      assert.ok(site, `${tag} 호출부를 찾지 못함`);
      const m = site.member;
      const attachAt = m.indexOf('AttachDialogAutoAccept(');
      const loads = indexesOf(m, anchor);
      assert.ok(loads.length > 0, `${tag}: 인계 문서 로드 지점을 찾지 못함(${anchor}) — 계약을 검사할 수 없다`);
      const marks = [...m.matchAll(DETACH_DONE)].map((x) => x.index);

      for (const L of loads) {
        const before = marks.filter((d) => d > attachAt && d < L);
        assert.ok(before.length > 0,
          `${tag}: 사용자에게 넘길 문서를 로드하기 전에 detach가 끝나지 않는다(attach → 인계 로드 사이에 detach 없음) — `
          + '설정은 문서 로드 시점 스냅샷이라 로드 뒤 원복은 그 문서에 안 먹고, 그 문서의 confirm은 영구 정지한다');
        const d = Math.max(...before);
        assert.ok(!/\breturn;/.test(m.slice(d, L)),
          `${tag}: detach와 인계 로드 사이에 return이 있다 — 그 detach가 인계 경로 위에 있다고 보장할 수 없다`);
      }
    }
  },

  // ⑩ 인계 목록 자체가 계약이다 — 창을 남기는 op는 정확히 week·probe·submit 셋.
  //    새 op가 창을 남기게 되면 ⑨의 대상에도 반드시 등록돼야 한다(빠뜨리면 이번 사고 재발).
  handoffSetMatchesWindowKeepers(source) {
    const keeps = callSites(source).filter((s) => !closesWindow(s)).map((s) => s.tag).sort();
    assert.deepStrictEqual(keeps, ['probe', 'submit', 'week'],
      `창을 사용자에게 남기는 op 목록이 바뀌었다: ${keeps} — 인계 계약(⑨) 대상도 함께 갱신해야 한다`);
    assert.deepStrictEqual(Object.keys(HANDOFF_LOADS).sort(), keeps,
      '인계 계약(HANDOFF_LOADS)에 등록된 op와 실제로 창을 남기는 op가 다르다');
  },
};

// ══ 본 검사 ═══════════════════════════════════════════════════════════

test('다이얼로그 자동수락: AreDefaultScriptDialogsEnabled=false 를 실제로 설정한다(핸들러 raise 조건)', () => {
  checks.setsFalse(netcus);
});

test('다이얼로그 자동수락: 이전 값(prev)을 끄기 전에 캡처한다', () => {
  checks.capturesPrevFirst(netcus);
});

test('다이얼로그 자동수락: detach가 설정을 prev로 원복한다(원복 자체는 필요조건)', () => {
  checks.restoresOnDetach(netcus);
});

test('다이얼로그 자동수락: detach가 핸들러 해제 + 설정 원복을 한 곳에서 함께 한다', () => {
  checks.removesHandlerOnDetach(netcus);
  checks.restoresOnDetach(netcus);
  // 켜기와 되돌리기가 같은 함수 안에 있어야 짝이 어긋나지 않는다.
  const b = attachBody(netcus);
  assert.ok(b.includes('AreDefaultScriptDialogsEnabled = false') && b.includes('AreDefaultScriptDialogsEnabled = prev'),
    '켜기와 원복이 같은 함수에 묶여 있지 않다');
});

test('다이얼로그 자동수락: 핸들러가 ev.Accept()로 수락하고 메시지를 로그에 남긴다', () => {
  checks.handlerAcceptsAndLogs(netcus);
});

test('다이얼로그 자동수락: 호출부 7곳(userlogin·validate·submit·week·merge·weekly·probe)이 전부 detach를 부른다', () => {
  checks.allCallSitesDetach(netcus);
});

test('다이얼로그 자동수락: 설정은 AttachDialogAutoAccept 한 곳만 만진다(전역 활성 금지)', () => {
  checks.onlyAttachTouchesSetting(netcus);
});

test('다이얼로그 자동수락: 위젯 다른 소스는 AreDefaultScriptDialogsEnabled를 만지지 않는다', () => {
  for (const f of readdirSync(widgetDir).filter((x) => x.endsWith('.cs') && x !== 'NetcusService.cs')) {
    const s = stripComments(readFileSync(join(widgetDir, f), 'utf8'));
    assert.ok(!/AreDefaultScriptDialogsEnabled/.test(s),
      `${f}가 AreDefaultScriptDialogsEnabled를 만진다 — 스크립트 다이얼로그 정책은 NetcusService 한 곳에서만 관리한다`);
  }
});

// ══ ★ 인계 순서 계약 ★ ════════════════════════════════════════════════

test('인계 계약: week·probe·submit 모두 인계 문서를 로드하기 전에 detach가 끝난다', () => {
  checks.detachBeforeHandoff(netcus);
});

test('인계 계약: 창을 사용자에게 남기는 op는 week·probe·submit 셋뿐이다', () => {
  checks.handoffSetMatchesWindowKeepers(netcus);
});

test('인계 없는 op(merge·weekly·userlogin·validate)는 finally에서 확인창을 닫는다', () => {
  for (const tag of ['merge', 'weekly', 'userlogin', 'validate']) {
    const site = callSites(netcus).find((s) => s.tag === tag);
    assert.ok(site, `${tag} 호출부를 찾지 못함`);
    const fb = braceSlice(site.member, site.member.indexOf('finally'));
    assert.ok(/_w2win\?\.Close\(\)/.test(fb),
      `${tag}: finally에서 확인창을 닫지 않는다 — 창이 남으면 인계가 생겨 detach 시점 계약(인계 로드 전)이 필요해진다`);
    assert.ok(/detach\?\.Invoke\(\)/.test(fb), `${tag}: finally에서 detach를 부르지 않는다`);
  }
});

test('캡처(probe): detach는 인계 직전에 끝나고 창 Closed에서는 부르지 않는다', () => {
  checks.probeNoDetachOnClose(netcus);
});

test('일간 전송(submit): 자동 제출(go=write) 구간에서는 자동수락이 살아 있다', () => {
  // 인계 전 detach가 '너무 이른' 것도 회귀다 — netcus의 실패 alert()를 받아낼 구간이 사라진다.
  // 계약: DryRun 인계 detach는 DryRun 분기 안에서만 일어나고, 실제 제출 경로의 detach는 제출 뒤에 온다.
  const m = callSites(netcus).find((s) => s.tag === 'submit').member;
  assert.ok(/if \(req\.DryRun\) \{ detach\?\.Invoke\(\); detach = null; \}/.test(m),
    'submit의 첫 인계 detach가 DryRun 조건 안에 있지 않다 — 실제 제출 구간의 alert 자동수락이 사라진다');
  const fire = m.indexOf('var pres = await cw.ExecuteScriptAsync(post);');
  assert.ok(fire >= 0, 'submit의 제출 실행 지점(post 스크립트)을 찾지 못함');
  const marks = [...m.matchAll(DETACH_DONE)].map((x) => x.index);
  assert.ok(marks.some((d) => d > fire), '제출 실행 뒤(되읽기 인계 직전)의 detach가 없다');
});

// ══ 주간 채움 confirm 무변경(이번 수정이 깨뜨리면 안 되는 것) ═════════

test('주간 채움: Bwrite 오버라이드의 confirm(\'제출하시겠습니까?\')은 그대로 남아 있다', () => {
  const site = callSites(netcus).find((s) => s.tag === 'week');
  assert.ok(site, 'week 호출부를 찾지 못함');
  const m = site.member;
  assert.ok(/window\.Bwrite=function\(iscompletion\)/.test(m), '주간 채움의 Bwrite 오버라이드가 사라졌다');
  assert.ok(m.includes("if(iscompletion==='y'&&!confirm('제출하시겠습니까?'))return;"),
    "주간 채움의 confirm('제출하시겠습니까?')이 변경/제거됐다 — 사용자가 직접 제출하는 흐름의 마지막 확인이다");
  assert.ok(m.includes("alert('기간을 선택하세요.')") && m.includes("alert('제목을 입력하세요.')"),
    '주간 채움 Bwrite의 원본 검증 alert 2종이 사라졌다');
  assert.ok(/acceptCharset='euc-kr'/.test(m), '주간 채움 Bwrite의 euc-kr 인코딩이 사라졌다');
});

test('주간 채움: 창을 열어둔 채 finally에서 detach만 한다(창을 닫지 않는다)', () => {
  const site = callSites(netcus).find((s) => s.tag === 'week');
  const fb = braceSlice(site.member, site.member.indexOf('finally'));
  assert.ok(/detach\?\.Invoke\(\)/.test(fb), '주간 채움 finally가 detach를 부르지 않는다');
  assert.ok(!/_w2win\?\.Close\(\)/.test(fb),
    '주간 채움 finally가 창을 닫는다 — 사용자가 보완 후 직접 제출하는 흐름이 깨진다');
});

// ══ 변이 주입(검사가 실효성이 있는지 증명) ════════════════════════════
// 각 변이는 "실제로 났던/날 수 있는 회귀"다. 검사가 안 잡으면 그 검사는 장식이다.

const NL = netcus.includes('\r\n') ? '\r\n' : '\n';   // 소스는 CRLF — 여러 줄 변이 패턴이 조용히 빗나가지 않게 맞춘다.

function mutate(from, to, base = netcus) {
  const out = base.replace(from, to);
  assert.notStrictEqual(out, base, `변이가 원본을 바꾸지 못했다(대상 문자열 없음): ${from}`);
  return out;
}

test('변이①: 설정(=false)을 지우면 setsFalse가 실패한다', () => {
  const bad = mutate('try { cw.Settings.AreDefaultScriptDialogsEnabled = false; } catch { }', '');
  assert.throws(() => checks.setsFalse(bad), /설정하지 않는다/);
});

test('변이②: detach의 원복을 지우면 restoresOnDetach가 실패한다', () => {
  const bad = mutate('try { cw.Settings.AreDefaultScriptDialogsEnabled = prev; } catch { }', '');
  assert.throws(() => checks.restoresOnDetach(bad), /원복하지 않는다/);
});

test('변이③: 핸들러의 ev.Accept()를 지우면 handlerAcceptsAndLogs가 실패한다', () => {
  const bad = mutate('try { ev.Accept(); } catch { }', '');
  assert.throws(() => checks.handlerAcceptsAndLogs(bad), /ev\.Accept\(\)를 부르지 않는다/);
});

test('변이④: 호출부 한 곳의 detach를 빠뜨리면 allCallSitesDetach가 실패한다', () => {
  const bad = mutate('finally { detach?.Invoke(); _ncBusy = false; NetcusBusy(false); }',
    'finally { _ncBusy = false; NetcusBusy(false); }');
  assert.throws(() => checks.allCallSitesDetach(bad), /finally에서 detach를 부르지 않는다/);
});

test('변이⑤: prev 캡처를 =false 뒤로 옮기면 capturesPrevFirst가 실패한다(원복이 가짜가 됨)', () => {
  const bad = mutate(
    'bool prev = cw.Settings.AreDefaultScriptDialogsEnabled;' + NL + '            try { cw.Settings.AreDefaultScriptDialogsEnabled = false; } catch { }',
    'try { cw.Settings.AreDefaultScriptDialogsEnabled = false; } catch { }' + NL + '            bool prev = cw.Settings.AreDefaultScriptDialogsEnabled;');
  assert.throws(() => checks.capturesPrevFirst(bad), /prev 캡처가 =false 뒤에 있다/);
});

test('변이⑥: detach의 핸들러 해제를 지우면 removesHandlerOnDetach가 실패한다', () => {
  const bad = mutate('try { cw.ScriptDialogOpening -= H; } catch { }', '');
  assert.throws(() => checks.removesHandlerOnDetach(bad), /핸들러를 해제하지 않는다/);
});

test('변이⑦: probe가 detach를 창 Closed로 되미루면 probeNoDetachOnClose가 실패한다(무음 삭제 회귀)', () => {
  const bad = mutate('                    _ncBusy = false; _probeOpen = false; NetcusBusy(false);',
    '                    detach?.Invoke();' + NL + '                    _ncBusy = false; _probeOpen = false; NetcusBusy(false);');
  assert.throws(() => checks.probeNoDetachOnClose(bad), /창 Closed로 미룬다/);
});

test('변이⑧: 설정을 전역(다른 멤버)에서 켜두면 onlyAttachTouchesSetting이 실패한다', () => {
  const bad = mutate('        private async Task EnsureW2(bool background = false)' + NL + '        {',
    '        private async Task EnsureW2(bool background = false)' + NL + '        {' + NL
    + '            try { _w2!.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = false; } catch { }');
  assert.throws(() => checks.onlyAttachTouchesSetting(bad), /3개\(캡처·끄기·원복\)가 아니다|바깥에서/);
});

// ── ★ 이번 사고의 본질: detach를 인계 로드 '뒤'로 옮기는 변이 ★ ──────
// 이 형태가 실제 배포 직전까지 갔던 코드다(설정 원복 줄은 있었지만 로드 뒤라 아무 효과가 없었다).
// 실측: 이 상태로는 다이얼로그가 아예 뜨지 않고 영구 정지한다 → 주간보고 '제출'이 먹통.

test('변이⑨: week의 detach를 인계 로드(pjm_write.jsp POST) 뒤로 옮기면 detachBeforeHandoff가 실패한다', () => {
  let bad = mutate('                detach?.Invoke(); detach = null;' + NL + '                var wnav = NavOnce(cw, 15000);',
    '                var wnav = NavOnce(cw, 15000);');
  bad = mutate('                await wnav;' + NL,
    '                await wnav;' + NL + '                detach?.Invoke(); detach = null;' + NL, bad);
  assert.throws(() => checks.detachBeforeHandoff(bad), /week: 사용자에게 넘길 문서를 로드하기 전에 detach가 끝나지 않는다/);
});

test('변이⑩: probe의 인계 전 detach를 지우면(=창 Closed까지 자동수락 유지) detachBeforeHandoff가 실패한다', () => {
  const bad = mutate('                detach?.Invoke(); detach = null;' + NL + NL, '');
  assert.throws(() => checks.detachBeforeHandoff(bad), /probe: 사용자에게 넘길 문서를 로드하기 전에 detach가 끝나지 않는다/);
});

test('변이⑪: submit의 DryRun 인계 전 detach를 지우면 detachBeforeHandoff가 실패한다', () => {
  const bad = mutate('                if (req.DryRun) { detach?.Invoke(); detach = null; }' + NL, '');
  assert.throws(() => checks.detachBeforeHandoff(bad), /submit: 사용자에게 넘길 문서를 로드하기 전에 detach가 끝나지 않는다/);
});

test('변이⑫: submit의 되읽기 인계 전 detach를 지우면(원복을 finally에만 맡기면) detachBeforeHandoff가 실패한다', () => {
  const bad = mutate('                detach?.Invoke(); detach = null;' + NL + '                await NavTo(cw, url);',
    '                await NavTo(cw, url);');
  assert.throws(() => checks.detachBeforeHandoff(bad), /submit: detach와 인계 로드 사이에 return이 있다/);
});

test('변이⑬: submit의 detach를 제출 실행보다 앞으로 당기면(자동수락 구간 소실) 회귀 검사가 실패한다', () => {
  const bad = mutate('                if (req.DryRun) { detach?.Invoke(); detach = null; }',
    '                detach?.Invoke(); detach = null;');
  assert.throws(() => {
    const m = callSites(bad).find((s) => s.tag === 'submit').member;
    assert.ok(/if \(req\.DryRun\) \{ detach\?\.Invoke\(\); detach = null; \}/.test(m),
      'submit의 첫 인계 detach가 DryRun 조건 안에 있지 않다 — 실제 제출 구간의 alert 자동수락이 사라진다');
  }, /DryRun 조건 안에 있지 않다/);
});

test('변이⑭: 창을 남기는 op가 늘었는데 인계 계약에 등록하지 않으면 handoffSetMatchesWindowKeepers가 실패한다', () => {
  const bad = mutate('                try { Dispatcher.Invoke(() => { try { _w2win?.Close(); } catch { } }); } catch { }   // 읽기 전용 — 확인창 닫음', '');
  assert.throws(() => checks.handoffSetMatchesWindowKeepers(bad), /창을 사용자에게 남기는 op 목록이 바뀌었다/);
});
