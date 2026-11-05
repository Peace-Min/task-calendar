# 스크롤 칸 안정성 (2026-11-05 기획)

대상: `task-calendar-prototype.html` (위젯 WebView2 와 웹이 같이 쓰는 단일 HTML).
브랜치: `fix/weekly-modify-viewno` 워크트리 `weekly-modify`.

## 1. 현상

스크롤을 내린 채 글을 쓰거나, 체크를 바꾸거나, 저장하거나, 창을 다시 활성화하면 스크롤 위치가 맨 위(scrollTop 0)로 튄다.
늘 그런 것은 아니고 칸에 내용이 많을 때는 잘 안 보여서 "가끔 튄다"로 보였다.

사용자 판단(2026-11-05): 앱이 스크롤 위치를 저장했다가 되돌리는 땜질이 아니라, 앱이 다시 그리는 동안 내용 높이를 흔들지 않게 고치는 것이 맞다. 앱 자체의 결함이다.

## 2. 원인 세 가지

브라우저는 스크롤 칸의 내용 높이(scrollHeight)가 보이는 높이(clientHeight) 이하로 줄어드는 순간 scrollTop 을 0(또는 새 최대값)으로 내린다. 그 뒤 내용이 다시 길어져도 scrollTop 은 돌아오지 않는다. 결함 세 가지는 모두 "한순간이라도 내용이 줄어든 상태로 레이아웃이 계산된다"는 같은 뿌리다.

### 2.1 입력칸을 재려고 접는다

```js
function atGrow(t){ if(!t) return; t.style.height = 'auto'; const h = t.scrollHeight; if(h > 0) t.style.height = h + 'px'; }
```

`height = 'auto'` 로 칸을 최소 높이(rows 높이 또는 CSS min-height)까지 접은 뒤 `scrollHeight` 를 읽는다. 이 읽기가 레이아웃을 강제하고, 그 레이아웃에서 부모 스크롤 칸이 짧아진다.

재현 수치(실제 브라우저):

| 칸 | 접기 전 scrollTop | 접은 순간 | 결과 |
|---|---|---|---|
| 일간 `#atList` | 703 | scrollHeight 556 = clientHeight 556 | scrollTop 0 |
| 주간 `#awScroll` | 50%~100% 어느 자리든 | 큰 칸 두 개(160px)가 접혀 내용이 칸보다 짧아짐 | scrollTop 0 |

다른 칸들이 길어서 하나를 접어도 스크롤할 거리가 남으면 브라우저 스크롤 앵커링으로 자리가 유지된다. 그래서 간헐적으로 보였다.

같은 모양: `ceGrow`(과제 수정 창 `#ceName`, 한 줄 칸). 창 안이 거의 스크롤되지 않아 위험은 낮지만 같은 함수 모양이라 같은 도우미로 정리한다(5.1).

### 2.2 스크롤 칸 자체를 새로 만든다

다시 그릴 때 스크롤되는 상자 요소까지 HTML 문자열로 새로 만들면 새 상자는 scrollTop 0, scrollLeft 0 에서 시작한다. 과제 탭 `pcRender` 가 `#pcView` 의 innerHTML 을 통째로 다시 쓰면서 왼쪽 목록 `.pc-side`, 좁은 폭 서랍 `.pc-drawer`, 주간 표 `.pc-wscroll#pcWScroll` 을 매번 새로 만든다.

### 2.3 비웠다가 비동기로 채운다

관리 목록 `reloadCustomerList`, `reloadCodeList`, `raReload` 는 목록 상자를 "불러오는 중" 한 줄로 비운 뒤 `await hostRequest(...)` 를 기다리고 회신으로 채운다. 비운 순간 scrollTop 이 0 이 되고, 회신 뒤 목록이 같은 길이로 돌아와도 맨 위다. 저장에 성공할 때마다 이 경로를 탄다.

### 2.4 반대 사례(유지되는 구조)

스크롤 칸 요소는 그대로 두고 안의 내용만 같은 높이로 갈아 끼우면, 갈아 끼운 뒤 첫 레이아웃에서 내용 높이가 그대로이므로 위치가 유지된다. 브라우저 시험으로 확인한 곳:

* 날짜 패널 `#dpBody` (renderPanel)
* 개인 달력 `#grid` (renderAll)

이 둘은 고치지 않는다(8절).

## 3. 고칠 곳 (6곳)

| 곳 | 스크롤 칸 | 원인 | 계기 | 고칠 함수 |
|---|---|---|---|---|
| A | 근태 주간 `#awScroll` | 2.1 | 입력마다(`awInit` input), `awRender`(세 칸 모두 atGrow), 창 활성화 `__attendWinActivated` > `atWinRefresh` > `awWinRefresh` > 회신 `awFromRefresh` > `awRender`, 과제 추가, 가져오기(`awImpDaily`, `awImpPlan` > `awRender`), 창 크기 조절 | `atGrow` (공용 도우미로) |
| B | 근태 일간 `#atList` | 2.1 과, innerHTML 재작성 뒤 강제 레이아웃 | 입력마다, `atGrowAll`(창 크기 조절, 패널 접기 `atToggleFold`), `atBlocksRender`(블록 추가, 삭제, 과제 고르기, 창 활성화 회신 `atEdOpen` 같은 날짜 경로) | `atGrow`, `atBlocksRender` |
| C | 과제 탭 주간 `.pc-wscroll#pcWScroll` | 2.2 | `pcOnActivate`(focus, visibilitychange, 5초 간격) > `pcLoad` > `pcRender`, 과제 체크(`pcOnViewChange`, pcRender 두 번), 전체 선택, 전체 해제, 메모 첫 줄 표시, 이전 다음 주, 창 크기 조절(150ms 뒤 pcRender), 저장 회신 | `pcRender`, `pcRenderWeek` |
| D | 과제 탭 왼쪽 `.pc-side`, 좁은 폭 `.pc-drawer` | 2.2 | C 와 같다 | `pcRender`, `pcSideHtml` |
| E | 관리 발주처 `#custList` | 2.3 | 저장 성공(`custSend` > `reloadCustomerList()`) | `reloadCustomerList` |
| F | 관리 구분, 상태 `#codeList` (+ 회의실 `#raList`) | 2.3 | 저장 성공(`codeSend` > `reloadCodeList()`), 회의실은 회신에 목록이 없을 때 `raSend` > `raReload()` | `reloadCodeList`, `raReload` |

회의실 `raReload` 는 같은 구조, 같은 원인이라 같이 고친다(코드 몇 줄이고 시험도 같은 틀로 짤 수 있다).

## 4. 지켜야 할 의도된 맨 위

다음은 지금처럼 맨 위로 간다. 고친 뒤에도 바뀌면 안 된다.

* 새 날짜 열기: `atEdOpen` 의 `$('#atList').scrollTop = 0` (다른 날짜일 때만 이 줄까지 온다. 같은 날짜 경로는 21253 에서 return).
* 새 주 열기: 주간 열기의 `$('#awScroll').scrollTop = 0`.
* 목록 내용이 바뀌는 경우: 구분과 상태 탭 바꾸기(`switchCodeKind`), 관리 창 열기(`openCustomerModal`, `openCodeModal`, `openRoomAdmin`). 이 셋은 지금처럼 비우고 스피너를 보인다(fresh).
* 과제 탭 보기 전환(월간과 주간): 주간 표 상자는 월간에 없으므로 주간으로 올 때 새로 만들어지고 맨 위에서 시작한다. 탭 전환, 창 열기도 같다.
* 과제 탭 넓은 폭과 좁은 폭 경계를 넘는 창 크기 조절: 껍데기 모양이 바뀌므로 새로 만든다(5.3 껍데기 열쇠). 서랍 열고 닫기는 해당하지 않는다. 서랍 요소 하나만 붙이고 떼므로 `.pc-main` 과 `#pcWScroll` 은 그대로다.

과제 탭 이전 다음 주, 오늘: 줄이 같은 과제들이라 세로 위치를 지킨다(새 규칙). 가로 위치도 지킨다.

## 5. 설계 결정

원칙: 스크롤 위치를 저장했다가 되돌리지 않는다. 어디서도 `scrollTop = 저장값` 을 쓰지 않는다. 내용 높이가 다시 그리는 동안 한순간도 줄지 않게 하고, 스크롤 상자 요소는 한 번 만들고 안만 바꾼다.

### 5.1 높이 잠금 도우미 (A, B, ceGrow)

공용 도우미 둘을 `atGrow` 자리(과제 블록 절 위)에 둔다.

```js
//  다시 재거나 갈아 끼우는 동안 el 의 높이가 지금보다 낮아지지 않게 잠근다. 돌려준 함수로 푼다(원래 inline min-height 로).
function holdHeight(el){
  if(!el) return () => {};
  const keep = el.style.minHeight;
  el.style.minHeight = el.offsetHeight + 'px';
  return () => { el.style.minHeight = keep; };
}
//  글 칸을 내용 높이로. 재는 동안 칸을 감싼 부모 높이를 잠가 스크롤 칸 내용이 줄지 않는다. extra = 테두리 보정(ceGrow 2).
function taGrow(t, extra){
  if(!t) return;
  const release = holdHeight(t.parentElement);
  t.style.height = 'auto';
  const h = t.scrollHeight;
  if(h > 0) t.style.height = (h + (extra || 0)) + 'px';
  release();
}
function atGrow(t){ taGrow(t, 0); }
```

* 부모(`.at-blk`, `.aw-v`, `#ceName` 의 부모)를 지금 높이로 잠그므로 칸을 접어 재는 동안에도 부모 높이가 그대로이고, 스크롤 칸의 scrollHeight 도 그대로다.
* 잰 뒤 새 높이를 넣고 잠금을 푼다. 줄을 지워 칸이 정말 짧아졌으면 그때 내용이 줄어드는데 이것은 실제로 내용이 줄어든 것이라 정상이다(브라우저가 최대값으로 맞출 뿐 0 으로 튀지 않는다. 0 이 되는 것은 더 스크롤할 내용이 없을 때뿐이다).
* 전역 `*{box-sizing:border-box}` 라 `offsetHeight` 를 그대로 min-height 로 넣어도 같은 높이다.
* 숨은 요소는 offsetHeight 0 이라 `min-height:0px` 을 잠깐 넣었다 푼다. 해가 없다.
* 높이 결과는 지금과 같다: `auto` 일 때의 scrollHeight 를 그대로 쓴다. CSS 최소 높이(`.aw-big` 160px, `.at-bt` 52px, `.at-memo .at-bt` 36px)는 그대로 적용된다. `ceGrow` 는 `taGrow(t, 2)` 로 지금의 `+2`(위아래 테두리)를 지킨다. 줄바꿈을 공백으로 바꾸는 앞부분과 글자 수 표시는 그대로 둔다.
* `atGrowAll` 은 그대로 `forEach(atGrow)` 이고 각 칸이 자기 부모를 잠근다.
* `awInit` 의 창 크기 조절 `document.querySelectorAll('#awEd textarea').forEach(atGrow)` 도 그대로다(도우미를 타므로 같이 고쳐진다).
* 함수 안에 `style.height = 'auto'` 가 남는 곳은 `taGrow` 하나뿐이어야 한다(정적 계약).

### 5.2 atBlocksRender (B)

`#atBlocks` 는 스크롤 칸 `#atList` 안의 내용 상자라 2.2 는 아니다. 그러나 `box.innerHTML = ...` 직후 첫 `atGrow` 가 레이아웃을 강제할 때 새 글 칸들이 모두 rows 높이로 접혀 있어 2.1 과 같은 일이 난다. 고치는 법:

```js
const release = holdHeight(box);     // innerHTML 을 바꾸기 전에 지금 높이로 잠근다
box.innerHTML = ...;
...각 textarea value, atGrow...
release();                            // 모든 칸 높이를 넣은 뒤 푼다
```

* `holdHeight(box)` 는 `box.innerHTML =` 보다 앞, `release()` 는 메모 칸 `atGrow(mt)` 뒤(비활성화 처리, 포커스 복원 앞이든 뒤든 상관없지만 `atAddPlace` 보다는 앞)에 둔다. `atAddPlace` 가 자리를 재므로 풀린 뒤의 실제 높이로 재야 한다.
* 블록을 지워 실제로 짧아지면 풀 때 짧아지는 것이 맞다.
* 포커스와 커서 복원(`atFocusKey`, `atFocusRestore`), 비활성화, 상태 줄은 그대로 둔다. 블록 키 단위로 DOM 을 맞추는 큰 재구성은 하지 않는다(필요 없다. 내용 상자는 스크롤 칸이 아니다).

### 5.3 과제 탭: 껍데기를 한 번 만들고 안만 바꾼다 (C, D)

`pcRender` 를 "껍데기"와 "안"으로 나눈다.

껍데기 = `.pc-main` > (넓은 폭이면 `aside.pc-side`) + `.pc-area#pcArea` > (막대, 오류 줄, `#pcBody`). 서랍 `.pc-drawer#pcDrawer` > `div.pc-side.in-drawer` 는 껍데기가 아니라 `#pcArea` 안 `#pcBody` 뒤의 형제 요소 하나다.

껍데기 열쇠 = `narrow ? 'n' : 'w'`. 서랍 열림 여부는 열쇠에 넣지 않는다. `.pc-main` 에 `data-shell` 로 적는다(보이지 않는 속성, 모양 변화 없음).

```
pcRender():
  (안내 경로 세 개: !HOST, !loaded, 과제 없음) 지금처럼 v.innerHTML = 안내  // 껍데기가 사라지고, 다음에 다시 만든다
  key = ...
  main = v.firstElementChild
  if(!main || !main.classList.contains('pc-main') || main.dataset.shell !== key):
     v.innerHTML = 껍데기 HTML(빈 side, 빈 pcBody)    // 껍데기 한 번
  서랍: 좁은 폭이고 열려 있으면 #pcDrawer 가 없을 때만 #pcBody 뒤에 insertAdjacentHTML('afterend') 로 붙이고, 아니면 있는 #pcDrawer 를 remove()
  side 들(.pc-side 넓은 폭 하나, 또는 열려 있는 서랍 안 하나).innerHTML = pcSideInner()
  #pcArea 의 막대와 오류 줄: 기존 .pc-bar1, .pc-bar2, .pc-err 를 지우고 #pcBody 앞에 insertAdjacentHTML('beforebegin', pcBarHtml(narrow) + err)
  나머지(fitTitleMinWidth, data-mixed, catFitName, 주간 또는 월간, 서랍 top, pcSyncChecked, pcRestoreFocus)는 지금 순서 그대로
```

* `pcSideHtml(inDrawer)` 이름과 출력은 그대로 둔다(껍데기를 만들 때 쓴다). 안쪽 내용만 돌려주는 `pcSideInner()` 를 새로 만들고 `pcSideHtml` 은 `여는 태그 + pcSideInner() + 닫는 태그` 로 줄인다. 기존 시험이 `pcSideHtml` 을 이름으로 뽑아 문장부호를 본다(9.4).
* 왼쪽 목록 상자(`.pc-side` 넓은 폭)는 껍데기의 일부라 열쇠가 같으면 같은 요소다. 서랍은 열려 있는 동안 같은 요소이고 안만 바뀐다. 체크를 바꿔도 줄 수가 같으므로 높이가 같다.
* `#pcArea` 는 스크롤 칸이 아니다. 막대는 바꿔도 된다.
* 팝오버 `#pcPop` 는 `v` 에 붙는다. 껍데기 판정은 `v.firstElementChild` 로 하므로 팝오버가 판정을 흐리지 않는다. pcRender 첫머리의 `pcClosePop(true)` 는 그대로다.

`pcRenderWeek(body)`:

```
let sc = body.firstElementChild;
if(!sc || sc.id !== 'pcWScroll'){ body.innerHTML = '<div class="pc-wscroll" id="pcWScroll"></div>'; sc = body.firstElementChild; }   // 주간으로 처음 올 때만
sc.innerHTML = '<div class="pc-wtable" role="grid" aria-label="과제 주간 보기">' + ... + '</div>';
```

* 표 HTML(머리, 과제 줄, 칸, 일정 단추)은 지금과 한 글자도 다르지 않게 둔다. 바뀌는 것은 바깥 `pc-wscroll` 을 문자열에 넣지 않는 것뿐이다.
* `pcRenderMonth` 는 `body.innerHTML` 을 통째로 쓴다(월간 격자는 스크롤 칸이 아니다). 그러면 주간 상자가 사라지고, 다시 주간으로 오면 새로 만든다(4절 의도된 맨 위).
* `pcBody` 가 껍데기 안에 남으므로 주간 상자도 pcRender 를 거듭해도 같은 요소다. 세로와 가로 위치가 모두 유지된다.
* 갈아 끼운 뒤에 레이아웃을 읽는 코드(`fitTitleMinWidth`, `catFitName`, 서랍 top)는 전부 내용이 다 들어간 뒤에 읽는다. 중간에 줄어든 상태로 레이아웃을 읽는 곳이 없으므로 잠금이 필요 없다. 순서를 바꾸지 않는다.
* 위임 이벤트(`pcView` 의 click, change, keydown)는 `v` 에 걸려 있어 영향이 없다. 막대 단추와 목록 줄의 `data-fk` 포커스 복원도 그대로다.

### 5.4 관리 목록: 비우지 않고 회신 뒤 바꾼다 (E, F)

세 함수에 같은 모양을 쓴다. 인자 `opt` 하나를 받는다.

```js
async function reloadCustomerList(opt){
  const box = ...; if(!box) return;
  const gen = ...; box.dataset.gen = gen;                    // 세대 표식은 지금 그대로(await 앞)
  const fresh = !!(opt && opt.fresh) || !box.querySelector('.cust-row');
  if(fresh) box.innerHTML = `<div class="cust-empty">${ICON.spinner} 불러오는 중…</div>`;   // 첫 로드, 창 열기, 탭 바꾸기만
  const res = await hostRequest('loadCustomersFull', {}, 20000);
  if(box.dataset.gen !== gen) return;
  if(!res || !res.ok){
    if(fresh) box.innerHTML = `<div class="cust-empty">발주처 목록을 불러오지 못했습니다.</div>`;
    else custMsgSet(ICON.alert + ' 발주처 목록을 불러오지 못했습니다.', 'err');   // 목록은 그대로 둔다
    return;
  }
  ...지금처럼 custList = ...; renderCustomerList();
}
```

* 스피너는 상자에 목록 줄(`.cust-row`)이 없을 때(첫 로드, 앞 회신 실패 뒤, 빈 목록)와 fresh 일 때만.
* 회신이 오면 `renderCustomerList()` 가 같은 상자의 innerHTML 을 바꾼다. 상자는 그대로이고 줄 수가 같거나 하나 차이라 위치가 유지된다.
* 실패 문구는 이미 있는 문장을 그대로 쓴다. 목록을 지키는 경우에만 그 문장을 메시지 줄(`custMsgSet`, `codeMsgSet`, `raMsgSet`)로 보낸다. 새 문구를 만들지 않는다. `raReload` 는 지금 문장 `esc((res && res.msg) || '회의실 목록을 불러오지 못했습니다.')` 를 그대로 쓴다.
* fresh 로 부르는 곳: `openCustomerModal`, `openCodeModal`, `switchCodeKind`, `openRoomAdmin`. 저장 성공 경로(`custSend`, `codeSend`, `raSend` 의 `raReload()`)는 지금처럼 인자 없이 부른다.
* 탭 바꾸기는 다른 목록이므로 fresh 여야 한다. fresh 가 아니면 상태 탭 회신이 오기 전까지 구분 목록이 보인다(틀린 목록). `switchCodeKind` 가 fresh 를 꼭 넘기는지 정적 계약으로 묶는다.
* 이름 바꾸기 중인 줄(`.cust-edit`)이 있을 때 저장 성공으로 다시 부르는 경로는 지금과 같다(성공 뒤 render 가 편집 줄을 지운다).
* 세대 표식 순서(찍기 < await < 확인 < 목록 변수 덮기)는 그대로 둔다. 기존 계약② 시험이 이 순서를 본다.

### 5.5 field-sizing: content 를 쓰지 않는다

검토했지만 이번에는 쓰지 않는다. 이유:

1. 폐쇄망 WebView2 는 반입한 Evergreen 런타임이고 자동 갱신이 안 돼 버전을 모른다. `field-sizing` 은 Chromium 123 이상이다. 쓰려면 `CSS.supports('field-sizing', 'content')` 감지와 JS 대체를 둘 다 둬야 하는데, 그러면 개발 PC(새 런타임)와 폐쇄망(옛 런타임일 수 있음)이 서로 다른 길을 탄다. 실제 사용자가 타는 길을 개발 PC 에서 볼 수 없게 된다.
2. 높이 결과가 지금과 다르다. `.aw-free` 는 1px 테두리가 있고 지금은 `height = scrollHeight`(테두리 제외 값)를 border-box 높이로 넣어 2px 를 덜 쓴다. `field-sizing` 은 테두리까지 더해 2px 높아진다. "높이 결과는 지금과 같아야 한다"를 어긴다.
3. jsdom 은 CSS 길을 재지 못한다. 시험으로 묶을 수 있는 것은 JS 길뿐이다.
4. 5.1 잠금 도우미가 같은 뿌리(재는 동안 내용이 줄어듦)를 없앤다. 두 길이 필요 없다.

다시 볼 조건: 폐쇄망의 모든 WebView2 가 123 이상임을 확인했고(설치기가 런타임 버전을 적어 오는 등), 2px 차이를 사용자가 받아들일 때. 그때도 감지와 대체를 같이 두는 두 길은 만들지 않는다(유지보수 부담, 2026-11-05 사용자 결정). `taGrow` 를 걷고 CSS 한 길로 바꾼다.

## 6. 스크롤 위치 저장 복원을 쓰는 곳

없다. 이번 수정 어디에도 `scrollTop` 을 읽어 두었다가 다시 넣는 코드를 쓰지 않는다. 껍데기 열쇠가 바뀌는 경우(넓은 폭과 좁은 폭 전환)는 화면 모양이 바뀌는 것이라 4절의 의도된 맨 위로 본다.

## 7. 앞으로 새 화면이 따를 규칙 (스크롤 칸 다시 그리기 규칙)

1. 스크롤되는 상자(overflow auto 또는 scroll) 요소는 그 화면을 처음 만들 때 한 번만 만든다. 다시 그릴 때는 그 상자의 안(innerHTML 또는 자식)만 바꾼다. 상자를 HTML 문자열에 넣어 다시 만들지 않는다.
2. 안을 갈아 끼우는 중간에 레이아웃을 읽는 코드(offsetHeight, clientHeight, scrollHeight, getBoundingClientRect, focus 의 스크롤 등)가 있으면, 갈아 끼우기 전에 내용 상자를 `holdHeight` 로 잠그고 다 채운 뒤 푼다.
3. 글 칸 높이를 맞출 때는 `taGrow`(또는 `atGrow`)만 쓴다. `style.height = 'auto'` 를 직접 쓰지 않는다.
4. 비동기 회신을 기다리는 동안 목록을 비우지 않는다. 스피너는 상자가 비어 있을 때(첫 로드)나 목록 자체가 바뀔 때(탭, 창 열기)만 보인다. 다시 읽기 실패는 목록을 지우지 말고 메시지 줄로 알린다.
5. 맨 위로 가야 하는 경우(새 날짜, 새 주, 목록 종류가 바뀜)는 `scrollTop = 0` 을 명시해 의도를 드러낸다. 저장한 위치를 되돌리는 코드는 쓰지 않는다.
6. 시험: 다시 그리기 전후로 스크롤 상자가 같은 요소인지(정체성) 보는 jsdom 시험을 하나 둔다.

## 8. 고치지 않는 곳과 이유

* 날짜 패널 `#dpBody`(renderPanel), 개인 달력 `#grid`(renderAll): 스크롤 칸은 그대로 두고 안만 바꾼다. 브라우저 시험에서 위치 유지를 확인했다.
* 회의실 외 다른 관리 창(`#otList`, `#uaList`, `#trList`, `#mbList`)의 "불러오는 중": 창을 열 때만 비운다(의도된 맨 위). `otSwitchTab` 은 `otListTop()` 으로 일부러 맨 위로 보낸다(org-title 시험이 묶는다).
* 사람 고르기 `pkNote('불러오는 중…')`: 열 때만.
* 근태 일간 `atEdOpen` 다른 날짜 경로, 주간 새 주 열기: 4절대로 맨 위가 맞다.

## 9. 시험 계획

새 파일 `tests/scroll-stability.test.mjs`. jsdom 은 레이아웃이 없어 실제 스크롤 수치는 재지 않는다. 정적 계약, 변이, jsdom 행동으로 묶는다. 실제 수치는 메인이 브라우저에서 잰다(10절).

### 9.1 정적 계약

* S1 접는 패턴: 앱 전체에서 `style.height = 'auto'` 가 `taGrow` 안에 한 번만 있다. `taGrow` 안에서 `holdHeight(t.parentElement)` 가 `style.height = 'auto'` 보다 앞, `release()` 가 높이 대입보다 뒤에 있다. `atGrow` 는 `taGrow(t, 0)`, `ceGrow` 는 `taGrow(t, 2)` 를 부른다.
* S2 `atBlocksRender`: `holdHeight(box)` 가 `box.innerHTML =` 보다 앞, 그 해제가 마지막 `atGrow(mt)` 보다 뒤이고 `atAddPlace` 보다 앞.
* S3 `pcRenderWeek`: `body.innerHTML =` 에 들어가는 문자열은 빈 `pc-wscroll` 상자 하나뿐이고 그 줄은 상자가 없을 때의 가지 안에 있다. 표 문자열은 `.innerHTML` 로 상자 안에 들어간다. 예전 `body.innerHTML = h;` 꼴이 없다.
* S4 `pcRender`: `v.innerHTML = '<div class="pc-main"` 은 껍데기 열쇠(`data-shell`)를 비교한 가지 안에만 있다. `pcSideInner(` 를 부른다.
* S5 관리 목록 세 함수: 스피너 대입이 `if(fresh)` 가지 안에만 있다. `switchCodeKind`, `openCodeModal`, `openCustomerModal`, `openRoomAdmin` 은 `{ fresh: true }` 를 넘긴다. `custSend`, `codeSend` 는 지금처럼 `reloadCustomerList()`, `reloadCodeList()` 를 인자 없이 부른다.
* S6 스크롤 저장 복원 금지: 고친 함수들(`taGrow`, `atBlocksRender`, `awRender`, `pcRender`, `pcRenderWeek`, 관리 목록 세 함수) 안에 `scrollTop` 이 없다(의도된 맨 위 두 줄은 이 함수들 밖이다).
* S7 문장부호: 새로 쓴 함수(`holdHeight`, `taGrow`, `pcSideInner`)와 고친 함수 주석에 엠 대시, en 대시, 낫표, 띄어 쓴 가운데 점이 없다.

### 9.2 jsdom 행동

* J1 `taGrow` 잠금: 부모에 `offsetHeight` 300 을, 글 칸에 `scrollHeight` 게터를 심는다. 게터가 불릴 때 부모의 `style.minHeight` 와 글 칸 `style.height` 를 적어 둔다. 기대: 읽는 순간 부모 min-height `300px`, 글 칸 `auto`. 끝난 뒤 부모 min-height 가 원래 값(빈 문자열, 미리 `10px` 을 넣은 경우는 `10px`)으로 돌아오고, 글 칸 높이는 `scrollHeight + 'px'`.
* J2 `ceGrow`: 같은 틀로 높이 `scrollHeight + 2`, 줄바꿈이 공백이 되고 커서 자리 그대로, 글자 수 표시 그대로.
* J3 scrollHeight 0(jsdom 기본)일 때 높이는 `auto` 로 남는다(지금과 같다).
* J4 `atBlocksRender`: `#atBlocks` 에 offsetHeight 를 심고 innerHTML 대입 순간(MutationObserver 가 아니라 글 칸 scrollHeight 게터 안에서 `#atBlocks.style.minHeight` 를 적는다)에 잠겨 있고, 끝나면 풀려 있다. 칸 값(블록 글, 메모)이 모델과 같다. 포커스: 블록 1 글 칸에 포커스와 선택 2~4 를 두고 다시 그리면 같은 칸, 같은 선택.
* J5 과제 탭 정체성: 부팅(기존 project-calendar-web, pc-watch 시험의 부팅 틀 재사용)해 주간 보기로 그린 뒤 `#pcWScroll`, `.pc-side` 요소를 잡아 둔다. `pcRender()` 다시, 과제 체크 바꾸기(change 이벤트), 전체 해제, 전체 선택, 메모 첫 줄, 다음 주, 창 크기 조절(타이머 진행) 뒤에도 같은 요소(`===`)다. 안 내용은 바뀌었다(체크 수, 과제 줄 수). 포커스 `data-fk` 가 복원된다.
* J6 과제 탭 의도된 새 상자: 월간으로 바꿨다가 주간으로 오면 `#pcWScroll` 은 다른 요소다. 좁은 폭에서 서랍을 열고 닫아도 `.pc-main` 과 `#pcWScroll` 은 같은 요소이고, 서랍은 열려 있는 동안 같은 요소이며 안에 목록이 있다.
* J7 관리 목록(inline-edit-guard 의 genHarnessJs 틀을 본뜬 새 하네스): 상자에 `.cust-row` 두 줄을 미리 넣고 `reloadCustomerList()` 를 부른 뒤 회신 전: 같은 줄 노드가 그대로 있다(스피너 없음). 회신 뒤: 새 목록. `{ fresh: true }` 로 부르면 회신 전 스피너. 줄이 있을 때 실패 회신: 줄이 그대로이고 메시지 함수가 기존 문장으로 불렸다. 줄이 없을 때 실패: 상자에 기존 실패 문장. 구분 상태(`reloadCodeList`), 회의실(`raReload`)도 같은 표로.

### 9.3 변이 (옛 코드로 되돌리면 실패해야 한다)

| 변이 | 잡는 시험 |
|---|---|
| `taGrow` 에서 `holdHeight` 줄 지우기 | S1, J1 |
| `release()` 지우기 | J1 |
| `atGrow` 를 옛 한 줄로 되돌리기 | S1 |
| `ceGrow` 를 옛 `t.style.height = 'auto'` 꼴로 되돌리기 | S1, J2 |
| `atBlocksRender` 의 `holdHeight(box)` 지우기 | S2, J4 |
| `pcRenderWeek` 를 `body.innerHTML = '<div class="pc-wscroll" ...` 통째 쓰기로 | S3, J5 |
| `pcRender` 가 껍데기 판정 없이 늘 `v.innerHTML` 을 쓰기 | S4, J5 |
| 관리 목록에서 `if(fresh)` 를 지워 늘 스피너 | S5, J7 |
| `switchCodeKind` 에서 `{ fresh: true }` 빼기 | S5, J7(탭 바꾸면 옛 목록이 남아 보임) |

변이 시험은 기존 `mutate(app, 옛, 새)` 꼴을 쓴다. 변이가 실제로 소스를 바꿨는지(앵커가 있었는지) 먼저 확인한다.

### 9.4 기존 시험 앵커 갱신 목록

* `tests/pc-watch.test.mjs` 186 줄 `보기만W①` 함수 목록: `pcSideInner` 를 더한다. `pcSideHtml` 은 이름을 지키므로 그대로 뽑힌다.
* `tests/cal-common.test.mjs` 146, 200 줄: `pcRenderWeek` 안에 `calCellCls(ds, 'pc-whday'` 와 `CAL_DOW` 가 남아야 한다. 표 문자열을 다른 함수로 빼지 않는다.
* `tests/inline-edit-guard.test.mjs` B 절(genHarnessJs, GEN_LINE, 계약②): 바꾸지 않아도 통과해야 한다. 고정 상자가 비어 있으므로 fresh 경로를 탄다. 세대 확인 줄 `if(box.dataset.gen !== gen) return;` 문자열과 순서(찍기, await, 확인, `custList = `/`codeList = `)를 지킨다. 실패 경로에서 부르는 `custMsgSet` 은 하네스에 없지만 그 경로를 타지 않는다.
* `tests/xlsx-export.test.mjs` 863 줄 `/reloadCustomerList\(\)/`: custSend 가 인자 없이 부르므로 그대로.
* `tests/shared-rooms.test.mjs` 99 줄: `raReload` 가 `'roomsFull'` 을 보내야 한다. 그대로.
* `tests/attendance-weekly-web.test.mjs` 53 줄: `awAddPick` 은 건드리지 않는다.
* `tests/attendance-web.test.mjs` 1282 줄 변이 앵커(`const moved = atSortBlocks();` 다음 `atBlocksRender();`): 호출자는 건드리지 않는다.
* `tests/loop-ui-integrity.mjs` 1536 줄(브라우저 루프, 오프라인 탭 전환): 탭 전환은 fresh 라 실패 문장이 목록 상자에 나온다. 그대로 통과해야 한다.
* `tests/project-calendar-web.test.mjs`, `tests/pc-watch.test.mjs` 의 `#pcView .pc-side` 선택자 시험: 클래스와 구조를 지키므로 그대로.

## 10. 메인이 브라우저에서 잴 항목

각 항목은 "스크롤을 내린 자리(중간, 끝)에서 계기를 일으킨 뒤 scrollTop 이 그대로인가"를 수치로 적는다. 고치기 전 수치(2절)와 나란히 적는다.

1. 일간 `#atList`: 703 근처와 끝에서 아래쪽 블록 글 칸에 글자 입력, 줄 지우기, 블록 추가, 블록 지우기, 과제 고르기, 창 다시 활성화(같은 날짜 회신), 창 크기 조절, 패널 접기와 펼치기. 접은 순간 scrollHeight 가 줄지 않는지(입력 중 scrollHeight 최소값 기록).
2. 주간 `#awScroll`: 50%, 100% 에서 진행사항, 차주계획, 회의내용 입력, 창 활성화(awFromRefresh), 과제 추가, 가져오기 두 가지, 창 크기 조절.
3. 과제 탭 주간 `#pcWScroll`: 세로와 가로를 내린 채 과제 체크, 전체 해제와 선택, 메모 첫 줄, 다음 주, 창 다시 활성화(5초 넘겨), 같은 폭 범위 안 창 크기 조절, 일정 저장 회신.
4. 과제 탭 왼쪽 `.pc-side`, 좁은 폭 `.pc-drawer`: 목록 끝에서 아래쪽 체크 바꾸기.
5. 관리 `#custList`, `#codeList`, `#raList`: 끝에서 이름 바꾸기 저장, 숨김, 추가, 순서 바꾸기(구분 상태, 회의실).
6. 의도된 맨 위가 지켜지는가: 새 날짜, 새 주, 구분과 상태 탭 바꾸기, 관리 창 다시 열기, 과제 탭 월간에서 주간으로.
7. 높이 같음: 같은 글(빈 칸, 한 줄, 열 줄, 긴 한 줄 줄바꿈)에서 고치기 전후 글 칸 높이(`offsetHeight`)가 같은가. `#ceName` 긴 이름 포함.
8. 비용: 블록 30개에서 `atGrowAll` 한 번 시간(고치기 전후).
