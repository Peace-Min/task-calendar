/* =====================================================================================
 * tests/loop-adminwin.mjs — 관리 창(docs/ADMIN-WINDOW.md) 실동작 루프 공용 도우미
 *
 * ★ 이 파일은 시험이 아니다(.test.mjs 가 아니라 러너가 모으지 않는다). 관리 화면을 다루는 루프들
 *   (loop-admin-hub, loop-user-admin, loop-trash, loop-org-title)이 가져다 쓴다.
 *
 * 2026-10-22 부터 관리 화면(⚙ 관리 허브와 거기 붙는 화면)은 메인 창 안이 아니라 **따로 뜨는 관리 창**에서 열린다.
 * 그 창은 같은 HTML 을 ?win=admin 으로 띄운 두 번째 page 대상이다(CDP /json 에 메인 창과 나란히 보인다).
 *   - 메인 창 대상: tcapp.local 이고 열람 창(?peerwin=1), 열람 프레임(?peer=1), 관리 창(?win=admin)이 아닌 것.
 *   - 관리 창 대상: tcapp.local 이고 ?win=admin.
 * 관리 창은 메인 창의 입구(openAdminHub, 호스트 adminOpen)로만 열린다. 호스트가 세션의 사람이 관리자인지 보고 연다.
 * ===================================================================================== */

export const isAdminWinUrl = (u) => /tcapp\.local/i.test(u || '') && /[?&]win=admin\b/.test(u || '');
export const isMainWinUrl = (u) => /tcapp\.local/i.test(u || '') && !/peer(win)?=1/.test(u || '') && !/[?&]win=admin\b/.test(u || '');

//  CDP 의 page 대상 목록(webSocketDebuggerUrl 이 있는 것만)
export async function pageTargets(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })).json();
  return (Array.isArray(list) ? list : []).filter((x) => x.type === 'page' && x.webSocketDebuggerUrl);
}

//  관리 창 대상이 뜰 때까지(gone=true 면 사라질 때까지) 기다린다. 뜨면 그 대상, 시간 안에 안 되면 null.
export async function waitAdminTarget(port, { timeout = 20000, gone = false } = {}) {
  const t0 = Date.now();
  for (;;) {
    let t = null;
    try { t = (await pageTargets(port)).find((x) => isAdminWinUrl(x.url)) || null; } catch (_) { t = null; }
    if (gone ? !t : !!t) return gone ? true : t;
    if (Date.now() - t0 > timeout) return gone ? false : null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

//  메인 창에서 관리 창을 연다(이미 열려 있으면 앞으로 가져온다). mainEv = 메인 창에서 식을 평가하는 함수.
//  관리 창 대상이 뜨고, 그 안의 웹이 허브를 열 때까지(준비 알림, 대상 넘김, 관리자 확인) 기다린 뒤 대상을 돌려준다.
export async function openAdminWindow(port, mainEv, item = null, { timeout = 20000 } = {}) {
  await mainEv(`(openAdminHub(${JSON.stringify(item)}), 1)`);
  const t = await waitAdminTarget(port, { timeout });
  if (!t) throw new Error('관리 창(?win=admin)이 뜨지 않았다. 메인 창의 로그인 계정이 관리자인지, 위젯이 이 빌드인지 확인하세요');
  return t;
}

//  관리 창 안에서 허브가 열릴 때까지 기다리는 식(관리 창의 ev 로 평가한다)
export const ADMIN_HUB_OPEN_JS = `(typeof ADMINWIN !== 'undefined' && ADMINWIN && isOverlayOpen(document.getElementById('adminHub')))`;

//  관리 창 안에서 허브만 내린다(창은 그대로). 단독 모달 흐름으로 관리 화면을 직접 여는 루프(openUserAdmin, openTrash,
//  openOrgTitle 등)는 허브를 내린 뒤 지금처럼 돈다. 허브를 내리면 붙어 있던 화면은 제자리로 돌아가 단독으로 열리고,
//  관리 창의 allowlist 가 그 화면들을 보여 준다. 닫기(closeModal)도 단독 모달 닫기라 창이 닫히지 않는다.
//  ★ closeOverlay(허브)를 부르지 않는다. 관리 창에서 허브 닫기는 창 닫기다.
export const HIDE_HUB_JS = `(function(){ var h = document.getElementById('adminHub'); if(h && !h.classList.contains('hidden')){ h.classList.remove('closing'); h.classList.add('hidden'); } return 1; })()`;

//  관리 창을 닫는다(허브 닫기 길 = 창 닫기. 저장 안 한 입력이 없으면 묻지 않는다). 닫히면 true.
export async function closeAdminWindow(port, adminEv, { timeout = 8000 } = {}) {
  try { await adminEv(`(typeof adminWinRequestClose === 'function' && adminWinRequestClose(), 1)`); } catch (_) { /* 이미 닫혀 연결이 끊겼다 */ }
  return await waitAdminTarget(port, { timeout, gone: true });
}
