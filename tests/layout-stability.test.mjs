// 레이아웃 안정성 — "토글로 높이가 출렁이지 않는다" 계약 회귀 방지
//
// 왜 이 파일이 있나 (docs/QUALITY-SWEEP-2026-09-18.md §3.4-A, 규칙 §0-4 "목록/모달 높이가 토글로 출렁이면 안 된다"):
//   ① 안내문·버튼이 켜지고 꺼질 때 display:none 으로 빠지면 모달 높이가 튀고(실측 +38 / −39 / −95px),
//      사용자가 누르려던 아래 컨트롤이 커서 밑에서 도망간다. 인정된 패턴은 #mbSoon 과 같은
//      `.hidden{display:block !important;visibility:hidden}` — 자리는 남기고 글만 숨긴다.
//   ② 좁은 폭(320~380px)에서 버튼 하나가 늘면 푸터·미리알림 행이 두 줄로 접혀 44→96 / 62→107px 로 커졌다.
//   ③ 넓고 낮은 창(1000×420)에서 보고서 격자의 고정 height 가 본문보다 커 overflow:hidden 에 잘려 닿을 수 없었다.
//   ④ 하드코딩 색(#f5f7fd·#ffe27a)은 테마(세피아·포레스트·고대비·다크)를 따라가지 못한다 → 토큰으로.
// 전부 정적 소스 계약이다 — 실측은 실제 위젯(CDP)에서 했고, 여기선 그 수정이 되돌아가지 않았는지만 본다.
import { test, assert, loadAppSource } from './harness.mjs';

const src = loadAppSource();

// 선택자부터 다음 '}' 까지(단일 CSS 규칙) 잘라낸다. 앵커는 소스에 정확히 1번 있어야 한다.
function rule(text, anchor) {
  const s = text.indexOf(anchor);
  assert.ok(s >= 0, `CSS 규칙 앵커를 찾지 못함: ${anchor}`);
  assert.equal(text.indexOf(anchor, s + 1), -1, `CSS 규칙 앵커가 여러 번 나온다(모호): ${anchor}`);
  const e = text.indexOf('}', s);
  assert.ok(e > s, `규칙의 닫는 중괄호를 찾지 못함: ${anchor}`);
  return text.slice(s, e + 1);
}

// 계약 3 — 할 일 설명칸은 종료일을 넣어도 통째로 빠지지 않는다(라벨·placeholder 만 바뀜).
function assertTodoNoteStays(text) {
  assert.ok(!text.includes('qaTodoPeriodHint'),
    '#qaTodoPeriodHint 가 되살아났다 — 설명칸을 안내문으로 바꿔치기하면 종료일 입력 순간 빠른등록 모달이 95px 줄어든다');
  assert.ok(text.includes('id="qaMemoLb"'),
    '설명 라벨 #qaMemoLb 가 없다 — 종료일 지정 시 "시작일 설명" 으로 바뀌어야 칸의 값이 어디로 가는지 알 수 있다');
  const s = text.indexOf('const syncNote = () =>');
  assert.ok(s >= 0, 'syncNote 를 찾지 못함');
  const e = text.indexOf('if(ed){', s);
  assert.ok(e > s, 'syncNote 뒤의 if(ed){ 경계를 찾지 못함');
  const body = text.slice(s, e);
  assert.ok(!/style\.display/.test(body),
    'syncNote 가 다시 style.display 로 칸을 숨긴다 — 종료일을 넣고 빼는 순간 모달 높이가 출렁인다');
}

test('#qaRecurHint 는 숨겨도 자리를 남긴다(visibility)', () => {
  assert.ok(/#qaRecurHint\.hidden\s*\{\s*display\s*:\s*block\s*!important\s*;\s*visibility\s*:\s*hidden/.test(src),
    '#qaRecurHint.hidden 자리 유지 규칙이 없다 — 반복을 고를 때마다 빠른등록 모달이 38px 튄다');
});

test('할 일 설명칸은 종료일 지정으로 빠지지 않는다', () => {
  assertTodoNoteStays(src);
});

test('변이: 설명칸 계약은 공허하지 않다(라벨 id 제거·style.display 부활·안내문 부활을 잡는다)', () => {
  assert.throws(() => assertTodoNoteStays(src.replace('id="qaMemoLb"', '')), /qaMemoLb/,
    '라벨 id 를 지운 변이를 계약이 잡지 못했다');
  assert.throws(() => assertTodoNoteStays(src.replace('const syncNote = () => {', 'const syncNote = () => { wrap.style.display = "none";')), /style\.display/,
    'style.display 부활 변이를 계약이 잡지 못했다');
  assert.throws(() => assertTodoNoteStays(src + '<div id="qaTodoPeriodHint"></div>'), /qaTodoPeriodHint/,
    '안내문 부활 변이를 계약이 잡지 못했다');
});

test('반복 안내 문구는 꺼져 있어도 채워 둔다(높이 동일)', () => {
  assert.ok(!src.includes('if(on) rh.textContent'),
    'rh.textContent 가 다시 켜질 때만 채워진다 — 빈 요소는 0px 이라 visibility 규칙이 있어도 반복을 고를 때 높이가 튄다');
  //  2026-10-23 한 화면 폼(docs/PERSONAL-IMPROVE-PLAN.md 결정 8): 안내는 '자세히 편집에서 설정' 이 아니라 반복 한 줄 요약이다.
  //  켜짐(요약)과 꺼짐('반복 없음', 보이지 않음) 모두 글을 넣는 한 줄 대입이어야 높이가 같다.
  assert.ok(src.includes("rh.textContent = on ? recurLabel({ date, recur: r })") && src.includes(": '반복 없음';"), '반복 안내 문구 대입(켜짐 요약, 꺼짐 자리 글)을 찾지 못함');
});

test('미리보기 프레임·스켈레톤 하한은 뷰포트 비례(min(420px,60vh))', () => {
  for (const anchor of ['.pv-frame{', '.pv-skeleton{']) {
    const r = rule(src, anchor);
    assert.ok(r.includes('min-height:min(420px,60vh)'),
      `${anchor} 하한이 뷰포트 비례가 아니다 — 낮은 위젯 창에서 미리보기 모달이 화면 밖으로 밀린다`);
    assert.ok(!r.includes('min-height:420px'),
      `${anchor} 에 420px 고정 하한이 되살아났다 — 320px 높이 창에서 모달 아래가 잘린다`);
  }
});

test('검색 강조·날짜 머리 색은 테마 토큰을 쓴다', () => {
  const sd = rule(src, '.s-date{');
  assert.ok(sd.includes('var(--dim-bg)'), '.s-date 배경이 --dim-bg 토큰이 아니다 — 세피아·포레스트에서 푸른 띠로 튄다');
  assert.ok(!sd.includes('#f5f7fd'), '.s-date 에 하드코딩 #f5f7fd 가 되살아났다');
  const mk = rule(src, '\nmark{');
  assert.ok(mk.includes('var(--mark-bg)') && mk.includes('var(--mark-ink)'),
    'mark 가 --mark-bg/--mark-ink 토큰을 쓰지 않는다 — 고대비·다크에서 강조 잉크 대비를 테마별로 못 맞춘다');
  assert.ok(!src.includes('html.dark mark{'), 'html.dark mark 하드코딩 재정의가 되살아났다 — 토큰 한 곳에서 관리해야 한다');
  const root = rule(src, '\n:root{');
  assert.ok(root.includes('--mark-bg:') && root.includes('--mark-ink:'), ':root 에 --mark-bg/--mark-ink 선언이 없다 — mark 가 색을 잃는다');
});

//  2026-10-30(내 과제 목록 정리): 내 과제 창에는 푸터가 없다([🔗 공식 과제로 연결] 과 [닫기] 를 없앴다 — 연결은 줄 ⋯ 메뉴, 닫기는 머리 ✕).
//  푸터에 버튼이 다시 생기면 좁은 폭(380px)에서 접힐 수 있어 이 시험이 잡는다.
test('내 과제 창에는 푸터와 연결 단추가 없다', () => {
  assert.ok(!/id="btnRelinkOpen"/.test(src), '#btnRelinkOpen 이 되살아났다');
  const i = src.indexOf('<div class="overlay hidden" id="categoryModal">');
  const modal = src.slice(i, src.indexOf('<!-- ===== 다른 과제와 합치기', i));
  assert.ok(!modal.includes('modal-foot'), '내 과제 창에 푸터가 되살아났다');
});

test('미리알림 행은 ≤360px 에서 한 줄에 들어간다', () => {
  // ≤360px 미디어 블록은 여러 개다(과제 모달 푸터 컴팩트 규칙도 같은 폭) — 숫자칸 규칙을 먼저 찍고 그 앞의 블록 시작을 찾는다.
  const anchor = src.indexOf('.rem-row .rem-num{width:46px}');
  assert.ok(anchor >= 0, '≤360px 숫자칸 축소가 없다 — 「직접」을 고르면 미리알림 행이 둘째 줄로 떨어져 44→96px 로 커진다');
  const s = src.lastIndexOf('@media (max-width:360px){', anchor);
  assert.ok(s >= 0, '숫자칸 규칙이 @media (max-width:360px) 블록 안에 있지 않다 — 넓은 폭에서도 칸이 좁아진다');
  const block = src.slice(s, src.indexOf('\n}', s) + 2);
  assert.ok(block.includes('.rem-row .rem-num{width:46px}'),
    '≤360px 숫자칸 축소가 없다 — 「직접」을 고르면 미리알림 행이 둘째 줄로 떨어져 44→96px 로 커진다');
  assert.ok(block.includes('.rem-row .seg-b{padding-left:7px;padding-right:7px}'),
    '≤360px 세그 패딩 축소가 없다 — 320px 위젯에서 미리알림 행이 두 줄로 접힌다');
});

// 공식 과제 도구줄 — 320px 에서 「＋ 새 공식 과제」가 둘째 줄로 접히지 않게 360px 이하 보정이 있다(loop-ui-visual V3 · 2026-10-01)
test('레이아웃: 공식 과제 도구줄 360px 이하 보정(패딩 4px·간격 2px)이 600px 보정 뒤에 있다', () => {
  const src = loadAppSource();
  const i600 = src.indexOf('@media (max-width:600px){ .off-toolrow .btn.sm{padding:4px 7px}');
  const i360 = src.indexOf('@media (max-width:360px){ .off-toolrow .btn.sm{padding:4px 4px} .off-toolrow{gap:2px} }');
  assert.ok(i600 > 0, '600px 도구줄 보정이 사라졌다');
  assert.ok(i360 > i600, '360px 도구줄 보정이 없거나 600px 보정보다 앞에 있다(뒤에 있어야 덮어쓴다)');
});
