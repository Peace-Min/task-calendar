# 날 바뀜(자정 넘김) 설계

앱을 켜 둔 채 날짜가 바뀌었을 때 화면이 어떻게 따라가는지 정한다. 이 문서는 설계만 담는다. 코드는 아직 바꾸지 않았다.
줄 번호는 `task-calendar-prototype.html` 기준(feat/db-app, 8ea768e)이다. 코드가 바뀌면 함수 이름으로 찾는다.

## 결정 요약

1. **오늘은 PC 시계 하나로 잰다.** 지금처럼 브라우저의 지역 시각(Date)을 쓰고 서버 시각은 쓰지 않는다. 다만 지금 흩어진 `new Date()` 를 시계 한 군데(`CLOCK.now`)로 모은다. 시험은 이 자리만 바꿔 시간을 움직인다.
2. **판정 함수는 하나다(`dayCheck`).** 지금 날짜(`todayYmd()`)와 기억한 오늘(`DAY.today`)을 문자열로 견준다. 같으면 아무것도 하지 않는다. 다르면 한 번만 새 날을 적용하고 타이머를 다시 건다. 날이 앞으로 가든 뒤로 가든(시계를 되돌림) 같은 길로 처리한다.
3. **타이머는 창마다 하나다.** 다음 지역 자정까지 남은 시간에 여유(1초에서 60초 사이, 창마다 한 번 정하는 흔들림)를 더한 `setTimeout` 하나를 건다. 걸기 전에 늘 앞의 것을 지운다. 손 동작이 끝나기를 기다리는 짧은 미룸도 같은 손잡이를 쓴다. 그래서 어느 때든 살아 있는 타이머는 0개 또는 1개다. 주기적 확인(setInterval, 폴링)은 없다.
4. **안전망은 이벤트다.** `visibilitychange`(보임), 창 `focus`, `pageshow`, 그리고 입력(`pointerdown`, `keydown`, 캡처 단계). 판정은 문자열 비교 한 번이라 이벤트마다 불러도 된다. 처음 제안의 "공백 뒤 첫 pointerdown" 은 `keydown` 을 더하고 공백 판정을 뺐다(아래 "처음 방향과 다른 점").
5. **입력에서 날 바뀜을 알아채면 바로 그리지 않는다.** 400ms 뒤로 미룬다(같은 타이머 손잡이). 누르는 순간 달력 칸을 갈아 끼우면 그 클릭과 더블클릭이 떨어진 칸에 맞아 사라진다(selectDate 주석, 12872행 부근의 같은 버그 기록).
6. **적용은 두 단계다.** (1) 상태 바꾸기: 기억한 오늘, 따라갈 선택과 기준일, 알림 다시 보내기. 늘 바로 한다. (2) 칠하기: 보이는 화면만 한 번씩 다시 그린다. 창이 숨겨져 있으면 칠하기만 다시 보일 때로 미룬다.
7. **보기 따라가기 규칙.** 고른 날이 옛 오늘이었으면(사용자가 옮기지 않았으면) 새 오늘로 옮긴다. 월간 달력은 고른 날이 따라갔고 그 달이 옛 오늘의 달이었을 때만 따라간다. 주간은 고른 날이 정하므로 고른 날을 따라간다. 사용자가 옮긴 날짜와 달은 건드리지 않는다. 과제 탭(`PCAL.anchor`)과 근태 탭(`ATT.anchor`)도 같은 규칙이다.
8. **쓰는 중인 것은 건드리지 않는다.** 근태 일간과 주간 보고 화면(`ATE.date`, `AWE.mon`), 열린 편집 창의 값, 취합 기간, 내보내기 창 기간은 그대로다. 열린 모달 때문에 미루지는 않는다. 모달 뒤의 달력만 다시 그린다(저장 뒤 `notifyDataChanged` 가 이미 그렇게 한다).
9. **끌기 중에는 미룬다.** 포인터를 누르고 있거나 HTML 끌어 놓기(dragstart~dragend)가 진행 중이면 500ms 뒤에 다시 본다. 20번(약 10초)이 넘으면 바쁨을 무시하고 적용한다(누름 표시가 꼬여도 영원히 밀리지 않게).
10. **알림 창(48시간)을 다시 보낸다.** 지금 웹은 저장할 때만 `reminderSync` 로 오늘부터 사흘 치 발생을 보낸다. 편집 없이 이틀 넘게 켜 두면 그 뒤 알림이 아예 없다. 날이 바뀌면 메인 창이 한 번 다시 보낸다. 호스트(Reminders.cs)의 20초 틱과 절전, 시계 변경 구독은 그대로 두고 새로 만들지 않는다.
11. **설치하는 창.** 오늘을 칠하는 화면이 있는 문맥에만 설치한다: 메인 창(위젯, 브라우저 모두)과 열람 프레임(`?peer=1`). 열람 껍데기(`?peerwin=1`), 관리 창(`?win=admin`), 근태 창(`?win=attend`)에는 설치하지 않는다(오늘 표시가 없거나 쓰는 중인 화면뿐이다).
12. **알림과 효과 없음.** 토스트, 애니메이션, 소리는 없다. 화면이 조용히 새 날을 가리킨다.

### 처음 방향과 다른 점

| 처음 방향 | 이 설계 | 까닭 |
|---|---|---|
| 공백 뒤 첫 `pointerdown` 에서 확인 | 모든 `pointerdown` 과 `keydown`(캡처, passive)에서 확인, 공백 판정 없음 | 판정은 Date 하나와 문자열 비교라 공백 상태를 둘 이득이 없다. 키보드만 쓰는 사람도 잡는다. |
| 바뀌면 바로 적용 | 입력에서 알아채면 400ms 미룸, 끌기 중이면 다시 미룸 | 누르는 순간 칸을 갈아 끼우면 클릭과 더블클릭이 사라진다. |
| 작은 여유(몇 초) | 창마다 1초에서 60초 사이 흔들림 | 달이나 주가 바뀌는 자정에 과제 탭과 근태 탭이 서버를 다시 읽는다. 여러 PC 가 같은 초에 몰리지 않게 한다. 오늘 표시가 1분 늦는 것은 문제가 아니다. |
| 모든 창에서 각자 확인 | 오늘을 칠하는 문맥(메인, 열람 프레임)에만 설치 | 근태 창, 관리 창, 열람 껍데기에는 따라갈 것이 없다. 타이머 수를 줄인다. |
| (언급 없음) | 상태와 칠하기를 나눔, 숨김이면 칠하기만 미룸 | 트레이에 숨은 동안에도 알림은 다시 보내야 하고, 그리기는 보일 때 한 번이면 된다. |
| (언급 없음) | 날 바뀜에 알림 48시간 창을 다시 보냄 | 지금 코드의 빈틈(결정 10). |
| (언급 없음) | 시계를 되돌려 날짜가 앞으로 가도 같은 규칙 | "다르면 적용" 이 "커지면 적용" 보다 단순하고 맞다. |

## 오늘에 기대는 곳 표

갈래: (a) 날이 바뀌면 다시 그려야 한다, (b) 쓸 때마다 계산하므로 저절로 맞다, (c) 부팅 때 한 번 잡혀 다시 잡아야 한다, (d) 사용자 상태나 쓰는 중인 값이라 바꾸면 안 된다.

### (a) 다시 그려야 하는 곳

| 위치 | 무엇 | 날 바뀜 때 |
|---|---|---|
| 5330 `calCellCls`, 5339 `calAria` | 모든 달력 칸의 `.today` 와 "오늘" 읽어 주기. 부르는 쪽이 넘긴 today 로 판정 | 부르는 그리기 함수를 다시 부르면 맞는다 |
| 12052 `renderMonthBars` (tY), 12055 roving 칸 | 개인 달력 월간의 오늘 칸, 고른 날이 화면 밖일 때 키보드 칸 | `renderGrid()` |
| 12131, 12147 `renderWeekRows` | 개인 달력 주간 머리의 오늘 | `renderGrid()` |
| 11765 `renderGrid` 의 `document.title` | 창 제목 "(YYYY년 M월)", view 를 따른다 | view 가 따라갔을 때 `renderGrid()` 로 같이 맞는다 |
| 12618, 12621 `todoOverdueCount`, `dayFootHtml` | 패널 아래 "밀린 할 일, 지남 n" | `renderPanel()` |
| 18746 `dueLabel`, 18803 `todoIsOverdue`, 18765 `todoRowHtml` | 할 일 줄의 "오늘, 내일, 어제" 글자와 지남 색 | `renderPanel()`(달력 칩은 `renderGrid()`) |
| 18805 `todoAllGroups`, 18844 `renderTodoAll` | 밀린 할 일 팝업의 "기한 지남" 묶음 | 팝업이 열려 있을 때만 `renderTodoAll()` |
| 21424~21454 `atRenderMonth` | 근태 달력의 오늘 칸, tabindex 0 자리, "오늘" 읽어 주기 | 근태 탭이 달력 화면일 때 `atRenderMonth()` 또는 `atLoadMonth()` |
| 25015 `pcRenderMonth`, 25050 `pcRenderWeek` | 과제 달력 오늘 칸 | 과제 탭이 보일 때 `pcRender()` |
| 열람 프레임(`?peer=1`)의 같은 `renderGrid` | 남의 일정 달력의 오늘 칸 | 프레임 문맥이 제 `dayCheck` 로 `renderGrid()` |

### (b) 쓸 때마다 계산해서 저절로 맞는 곳

| 위치 | 무엇 |
|---|---|
| 12854 `goToday`, 3193 [오늘] 단추, 20773 Home 키 | 누를 때 오늘을 읽는다. 단추 자체에는 상태가 없다 |
| 20183 달력 칸 키보드 Home | 누를 때 계산 |
| 21413 `atToday`, 26159 `pcToday` | 누를 때 계산 |
| 11686 `calWeekRange` 기본값, 11747 `setCalView` | 부를 때 계산 |
| 12406 `dayHeadHtml` | 고른 날만 본다(오늘 표시 없음) |
| 22879 `awNewWeek` | 주간보고 [작성]의 이번 주(회사 보고 주 월요일)는 누를 때 계산 |
| 22749 `awfRange`, 22862 `awfBind` | 주간 목록 "최근 3개월, 올해" 범위는 읽을 때 계산. 열려 있는 목록은 다음 읽기 때 맞는다. 자정에 일부러 다시 읽지 않는다 |
| 21270 `attDraftPrune`, 22683 `awDraftPrune` | 임시 저장 정리, 열 때 계산 |
| 23131 `awCalRender` | 주 고르기 팝업, 열 때 계산(근태 창 안이라 설치하지 않음) |
| 23457 `awWinRefresh` | 근태 창 새로고침의 기본 날짜 |
| 17580 `setExportRange`, 17574 `quarterRange` | 빠른 기간 단추, 누를 때 계산 |
| 17651 `openExportModal` | 내보내기 창 기본 기간(최근 30일), 열 때 계산 |
| 15033 `runOfficialXlsxExport`, 16777 `exportXML` | 파일 이름의 날짜 |
| 25287 `pcOpenForm` | 새 과제 일정의 기본 날짜(기준일이나 오늘) |
| 25661 `caActDays`, 25668 `caAgoText` | 관리 창 "오늘, n일 전". 목록을 다시 읽을 때 맞는다(관리 창에는 설치하지 않음) |
| 26069 `pcLoadChanges`, 26121 `pcRcDayGroups` | 바뀐 기록 목록의 기간과 날짜 묶음 |
| 18052 `rptMAt`, 17436 `ncNow`, 6936 `vgHHMM`, 24826 `pcSyncChecked` | 시각 글자 |
| 5467 `holidayOn` | 공휴일 표(2030년까지 고정 표). 날짜만 넣으면 된다 |
| 5860 `defaultState` | 첫 실행 견본 데이터의 날짜(한 번 만들어지는 데이터) |
| 5286 `nowIso`, `Date.now()` 쓰는 곳(5949, 6607, 6842, 10761, 24808, 26438 등) | 기록 시각과 도배 막기 타이머. 날짜 판정이 아니다 |

### (c) 부팅 때 한 번 잡혀 다시 잡아야 하는 곳

| 위치 | 무엇 | 날 바뀜 때 |
|---|---|---|
| 11190~11191 `view` | 개인 달력이 보는 달 | 따라가기 규칙(월간: 고른 날이 따라갔고 옛 오늘의 달이었을 때, 주간: 고른 날의 달) |
| 11192 `selectedDate` | 고른 날 | 옛 오늘과 같으면 새 오늘 |
| 11193 `focusDs` | 키보드 칸 | 옛 오늘이고 고른 날이 따라갔으면 새 오늘 |
| 24430 `PCAL.anchor` 처음 값, 24709 `pcResetFor` | 과제 달력 기준일(고른 날과 보는 범위를 겸한다) | 옛 오늘과 같으면 새 오늘. 범위가 바뀌면 한 번 다시 읽음 |
| 21369, 21392, 21424 `ATT.anchor` (비어 있을 때만 오늘) | 근태 달력 기준일 | 옛 오늘과 같으면 새 오늘. 달이 바뀌면 한 번 다시 읽음 |
| 26470 `buildReminderOccs`, 26489 `pushReminders` | 알림 창(보낸 날부터 사흘). 보낸 순간의 오늘로 잡힌다 | 메인 창에서 한 번 다시 보냄 |

참고: 11190 과 11192 는 Date 를 두 번 읽는다. 부팅이 자정에 걸치면 view 는 어제 달, 고른 날은 오늘이 될 수 있다. 한 번 읽은 값으로 둘을 정하고 같은 값을 `DAY.today` 의 처음 값으로 쓴다.
참고: 11786 `renderMonthGrid` 도 todayYmd 를 읽지만 지금 부르는 곳이 없다(죽은 코드). 이번 일과 별개로 지울 후보다.

### (d) 바꾸면 안 되는 곳

| 위치 | 무엇 | 까닭 |
|---|---|---|
| 20989 `ATE.date`, 21615 | 근태 일간 보고 화면이 쓰는 날 | 쓰는 중인 보고. 날이 바뀌어도 어제 보고를 이어 쓴다 |
| 22523 `AWE.mon`, 22960 | 근태 주간 보고 화면이 쓰는 주 | 같다 |
| `ATT.screen` 'edit', 'wedit' (브라우저의 근태 탭 안 보고 화면) | 보고 화면이 떠 있는 상태 | 상태만 맞추고 칠하지 않는다(달력이 가려져 있다) |
| 17468 `atSumInit`, 17864 `rptMOpen` 의 `#rptFrom`, `#rptTo` | 취합 기간(처음 열 때 지난달) | 만드는 중인 문서다. `rptMOpen` 을 다시 부르면 붙인 그림까지 지운다. 달이 바뀌어도 그대로 두고 사용자가 고친다 |
| 17651 내보내기 창이 열려 있는 동안의 `#expFrom`, `#expTo` | 입력 칸 값 | 열 때 정한 값은 사용자 입력과 같다 |
| 일정과 할 일 편집 창, 과제 일정 창(`pcOpenForm`)의 날짜 칸 | 입력 중인 값 | 편집 상태 |
| 5619 `peerApplyCarry` | 열람 창에서 사람을 바꿀 때 잇는 달과 고른 날 | 사용자가 보던 자리 |
| 사용자가 옮긴 `selectedDate`, `view`, `PCAL.anchor`, `ATT.anchor` | 탐색 상태 | 따라가기 규칙이 "옛 오늘과 같을 때만" 으로 지킨다 |
| `AWF.from`, `AWF.to`(직접 지정 기간) | 목록 찾기 기간 | 사용자 입력 |

갈래별 개수: (a) 10곳, (b) 20곳(묶은 줄 기준), (c) 6곳, (d) 9곳.

## 설계

### 시계 한 자리

`todayYmd` 옆(5283)에 둔다.

```js
//  날짜 판정이 읽는 시계는 여기 하나다(docs/DAY-ROLLOVER.md). 시험은 now, set, clear, rand 를 바꾼다.
const CLOCK = { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h), rand: () => Math.random() };
const nowDate = () => new Date(CLOCK.now());
const todayYmd = () => ymd(nowDate());
```

- `todayYmd()` 는 지금처럼 **늘 시계를 읽는다.** "앱의 오늘" 을 얼려 두는 방식은 쓰지 않는다. 얼리면 타이머가 늦을 때 [오늘] 단추와 Home 키까지 어제로 간다. 시계를 읽으면 자정과 적용 사이의 짧은 틈에 다른 까닭으로 다시 그려진 칸이 먼저 새 날을 보일 수 있지만 해가 없다. 따라가기 규칙은 `DAY.today`(옛 오늘)와 견주므로 틈이 있어도 같은 결과를 낸다.
- 오늘의 날짜를 읽는 `new Date()` 는 `nowDate()` 로 바꾼다: 11190(부팅), 12855(`goToday`), 17472(`atSumInit`), 17581(`setExportRange`), 17869(`rptMOpen`), 15033, 18056. 기록 시각(`nowIso`), id, 도배 막기의 `Date.now()` 는 날짜 판정이 아니라서 그대로 둔다.

### 상태

```js
const DAY = {
  on: false,        // 설치했는가(두 번 설치하지 않는다)
  today: '',        // 마지막으로 적용한 오늘 'YYYY-MM-DD'
  timer: 0,         // 살아 있는 타이머 손잡이 하나(자정용과 미룸용이 같은 손잡이)
  jitter: 0,        // 이 창의 자정 여유(1000~60000ms), 설치 때 한 번 정함
  paint: null,      // 칠하기 대기({ grid, pc, pcLoad, at, atLoad }), 없으면 null
  held: false,      // 포인터를 누르고 있다
  dnd: false,       // HTML 끌어 놓기 중
  busyN: 0,         // 바쁨으로 미룬 횟수(20 넘으면 무시)
  applied: 0,       // 적용 횟수(시험용 계수)
};
```

### 함수

```js
//  순수: nowMs 에서 다음 지역 자정까지 ms + 여유. 24*3600*1000 을 더하지 않고 지역 날짜로 만든다(23, 25시간 날에도 맞다).
function dayMsToNext(nowMs, jitter){
  const d = new Date(nowMs), next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return Math.min(Math.max(next - nowMs, 0) + jitter, 2147483647);
}
//  타이머는 하나. 늘 앞의 것을 지우고 건다. 1초보다 짧게 걸지 않는다(시계가 이상해도 빈 돌기가 없다).
function dayArm(ms){
  if(DAY.timer) CLOCK.clear(DAY.timer);
  DAY.timer = CLOCK.set(dayOnTimer, Math.max(1000, ms));
}
function dayArmMidnight(){ dayArm(dayMsToNext(CLOCK.now(), DAY.jitter)); }
function dayOnTimer(){
  DAY.timer = 0;
  dayCheck('timer');
  if(!DAY.timer) dayArmMidnight();   // 같은 날이었거나(일찍 깸) 적용을 마쳤다. 어느 쪽이든 다음 자정에 다시 건다
}
function dayBusy(){ return (DAY.held || DAY.dnd) && DAY.busyN < 20; }
//  판정 하나. src: 'timer' | 'vis' | 'focus' | 'show' | 'input'
function dayCheck(src){
  if(!DAY.on) return false;
  const t = todayYmd();
  if(t !== DAY.today){
    if(src === 'input'){ dayArm(400); return false; }            // 누르는 순간에는 칸을 갈아 끼우지 않는다
    if(dayBusy()){ DAY.busyN++; dayArm(500); return false; }      // 끌기 중이면 조금 뒤 다시
    DAY.busyN = 0;
    const old = DAY.today;
    DAY.today = t;                                               // 칠하기 전에 먼저 바꾼다(다시 들어와도 두 번 적용하지 않는다)
    DAY.applied++;
    dayApply(old, t);                                            // 상태 바꾸기(늘 바로)
    dayArmMidnight();
  }
  if(DAY.paint && document.visibilityState !== 'hidden') dayPaint();
  return true;
}
```

`dayCheck` 는 날짜가 같고 칠하기 대기가 없으면 문자열 비교 하나로 끝난다. 그래서 이벤트마다 불러도 된다.

### 누가 `dayCheck` 를 부르나

`dayInstall()` 이 한 번만 건다(`DAY.on` 이면 다시 걸지 않는다). 부팅 끝(26382 `renderAll()` 바로 뒤)에서 부른다. 설치 조건은 `!PEERWIN && !ADMINWIN && !ATTENDWIN` 이다(메인 창, 브라우저, 열람 프레임 `PEER`).

| 부르는 곳 | 하는 일 |
|---|---|
| 타이머(`dayOnTimer`) | 자정 여유 뒤, 또는 미룸 뒤 |
| `document` `visibilitychange` | 보이게 되면 판정, 숨김 동안 미룬 칠하기 |
| `window` `focus` | 창이 앞으로 옴 |
| `window` `pageshow` | 브라우저의 뒤로 가기 캐시에서 돌아옴. `dayArmMidnight()` 후 판정 |
| `window` `pagehide` | `dayStop()`: 타이머를 지운다(뒤로 가기 캐시와 시험 정리) |
| `document` `pointerdown`, `keydown` (캡처, passive) | `dayCheck('input')`. `pointerdown` 은 `DAY.held = true` 도 |
| `document` `pointerup`, `pointercancel` (캡처), `window` `blur` | `DAY.held = false` |
| `document` `dragstart` / `dragend`, `drop` (캡처) | `DAY.dnd = true / false` |
| `window.__test.day` | 시험 창구(아래 시험 계획) |

기존 `focus`, `visibilitychange` 듣기(6849 `connOnVisible`, 22499 근태 달력, 26334 `pcOnActivate`)에 끼워 넣지 않는다. 그쪽은 각자 조건(탭, 연결 상태, 5초 막기)이 있어 판정이 빠질 수 있다. 듣기를 늘리는 대신 판정 하나를 세 군데에서 부르는 편이 덜 엮인다.

호스트가 이미 부르는 `__peerWinActivated`, `__attendWinActivated` 는 쓰지 않는다. 그 둘은 설치하지 않는 창(껍데기, 근태 창)에서 돈다. 메인 창의 WPF 활성화가 웹 `focus` 로 늘 이어지는지는 불확실하지만(아래), 입력 안전망이 덮는다.

### `dayApply(old, t)`: 상태 바꾸기

여기서는 상태만 바꾸고 칠할 일을 `DAY.paint` 에 모은다. 그리지 않는다.

```js
function dayApply(old, t){
  const P = DAY.paint || (DAY.paint = {});
  const ym = s => s.slice(0, 7), ymOf = s => { const d = parseYmd(s); return { y: d.getFullYear(), m: d.getMonth() }; };
  //  개인 달력(메인과 열람 프레임)
  if(selectedDate === old){
    const wasMonth = view.y === ymOf(old).y && view.m === ymOf(old).m;
    selectedDate = t;
    if(focusDs === old) focusDs = t;
    if(calView() === 'week' || wasMonth) view = ymOf(t);
  }
  P.grid = true;
  if(!PEER){
    //  과제 달력. 기준일이 옛 오늘일 때만 따라간다. 범위가 바뀌면 다시 읽는다
    if(PCAL.anchor === old){
      const r0 = pcRange(); PCAL.anchor = t; const r1 = pcRange();
      if(r0.from !== r1.from || r0.to !== r1.to) P.pcLoad = true;
    }
    P.pc = true;
    //  근태 달력. 같은 규칙. 달이 바뀌면 다시 읽는다
    if(ATT.anchor === old){ ATT.anchor = t; if(ym(old) !== ym(t)) P.atLoad = true; }
    P.at = true;
    //  알림 사흘 창은 숨겨진 채(트레이)여도 바로 다시 보낸다
    if(HOST && !SUBWIN && bootOk) pushReminders();
  }
}
```

- 월간에서 고른 날은 옛 오늘인데 다른 달로 넘겨 보던 중이면(`moveMonth` 는 고른 날을 두지 않는다) 고른 날만 따라가고 보는 달은 그대로다. 오른쪽 패널은 오늘 내용을 보이고 달력은 사용자가 보던 달에 남는다.
- 주간은 `calWeekRange(selectedDate)` 가 그리는 주를 정한다. 고른 날이 따라가면 일요일에서 월요일로 넘어갈 때 다음 주로 넘어간다. 고른 날이 따라가지 않으면 그 주에 남는다.
- 달 경계(11/30에서 12/1)와 해 경계(12/31에서 1/1)는 따로 다루지 않는다. 고른 날과 보는 달이 위 규칙대로 함께 넘어가고 창 제목도 `renderGrid` 가 맞춘다.
- 근태 탭의 `ATT.anchor` 는 `atMove` 가 늘 1일로 놓으므로 "옛 오늘과 같다" 가 곧 "사용자가 옮기지 않았다" 다.
- 근태 보고 화면(`ATE`, `AWE`)은 읽지도 쓰지도 않는다.

### `dayPaint()`: 칠하기

보이는 화면만, 화면마다 한 번씩. 숨겨진 탭은 그 탭으로 들어올 때 이미 다시 그린다(`pcSetTab` 이 개인 탭으로 돌아오면 `renderAll`, 과제 탭이면 `pcRender` 와 `pcRefresh`, 근태 탭이면 `atEnterTab`).

```js
function dayPaint(){
  const P = DAY.paint; DAY.paint = null;
  const personal = PEER || PCAL.tab === 'personal';
  if(P.grid && personal){
    const g = document.getElementById('grid'), hadFocus = !!(g && g.contains(document.activeElement));
    renderGrid(); renderPanel();                                  // renderAll 이 아니다(보기 묶음은 오늘과 무관)
    if(hadFocus){ const c = g.querySelector('.cell[tabindex="0"]'); if(c) try{ c.focus({ preventScroll: true }); }catch(_){} }
  }
  if(!PEER && isOverlayOpen($('#todoAllModal'))) renderTodoAll();
  if(P.pc && pcOn()){
    const keep = PCAL.pop && PCAL.pop.day;
    pcRender(); if(keep) pcReopenDay(keep);                       // pcLoad 가 쓰는 것과 같은 되살리기
    if(P.pcLoad) pcLoad();
  }
  if(P.at && atOn() && ATT.screen === 'month'){ if(P.atLoad) atLoadMonth(); else atRenderMonth(); }
}
```

한 번 적용의 일은 많아야 `renderGrid` 1번, `renderPanel` 1번, 보이는 탭의 그리기 1번, 서버 읽기 1번(범위가 바뀐 탭만), `reminderSync` 1번이다. 키보드 포커스가 달력 칸에 있었으면 새 칸으로 되돌린다(다시 그리면 포커스가 body 로 떨어진다).

### 모달, 편집, 끌기

| 상황 | 정함 |
|---|---|
| 일정이나 할 일 편집 창이 열림 | 미루지 않는다. 뒤의 달력과 패널만 다시 그린다. 편집 창 값은 그대로 |
| 밀린 할 일 팝업이 열림 | 팝업을 다시 그린다(묶음은 상태에 있어 접힘이 유지된다) |
| 과제 탭의 그날 목록(PCAL.pop)이 열림 | 다시 그린 뒤 다시 연다 |
| 근태 보고 화면(브라우저 탭 안, 근태 창) | 건드리지 않는다 |
| 포인터를 누름(끌기, 창 옮기기와 크기 바꾸기, 순서 바꾸기 손잡이) | 500ms 뒤 다시. 놓으면 적용 |
| 칩 끌어 놓기(HTML DnD) | `dragstart` 에서 Chromium 이 `pointercancel` 을 보내므로 `DAY.dnd` 로 따로 잡는다 |
| 한글 입력 조합 중 | 미루지 않는다. 다시 그리는 곳(달력, 패널)에는 입력 칸이 없다 |

### 여러 창

- 각 문맥이 제 판정과 제 타이머를 가진다. 메인 창 하나, 열람 창마다 프레임 하나. 창끼리 알리지 않는다(저장소 이벤트나 호스트 중계 없음).
- 창마다 흔들림이 달라 최대 1분쯤 서로 다른 날을 가리킬 수 있다. 창 사이에 오늘을 주고받는 명령이 없으므로 해가 없다. `attendNav` 는 날짜를 실어 보내지만(근태 창 쪽 `AWE.mon || todayYmd()`) 근태 창에는 설치하지 않고 그 값은 쓰는 중인 날짜다.
- 열람 창이 사람을 바꾸면 프레임을 새로 만든다. 옛 프레임의 문서는 버려지고 HTML 규칙상 버려진 문서의 타이머는 돌지 않는다. 그래도 `pagehide` 에서 지운다.
- 근태 창은 닫으면 숨겨 두었다가 다시 쓴다(ReuseOnClose). 설치하지 않으므로 숨은 근태 창에 타이머가 남지 않는다.

### 숨은 창과 타이머 늦어짐

알려진 것:
- `setTimeout` 의 기한은 벽시계가 아니라 단조 시계로 잰다. 벽시계를 바꿔도 기한은 움직이지 않는다.
- Chromium 은 숨은 페이지의 타이머를 1초 단위로 모은다. 5분 넘게 숨어 있고 타이머가 다른 타이머 안에서 5단계 넘게 다시 걸리면 1분에 한 번으로 모은다(intensive wake up throttling, Chrome 88 부터). 이 설계는 타이머 안에서 다시 거므로 하루 지나면 그 조건에 들 수 있다. 그래도 늦음은 1분 안쪽이다.
- 호스트는 WebView2 를 일부러 멈추지 않는다(`TrySuspendAsync`, `MemoryUsageTargetLevel` 을 쓰지 않음, widget 검색 결과 없음).

불확실한 것(설계가 기대지 않는다):
- WPF 창을 `Hide()`(트레이)나 최소화했을 때 WebView2 의 `document.visibilityState` 가 'hidden' 이 되는지. WPF WebView2 컨트롤은 제 IsVisible 을 컨트롤러에 넘긴다고 알려져 있지만 최소화와 다른 창에 가림은 확인하지 않았다. 'hidden' 이 안 되면 칠하기를 미루지 않고 바로 할 뿐이다.
- 메인 창의 WPF 활성화가 웹 `focus` 로 이어지는지. 웹뷰 안으로 포커스가 들어가야 생긴다. 안 생기면 입력 안전망이 잡는다.
- 화면 잠금과 풀기에서 `visibilitychange` 가 오는지(Chromium 의 Windows 가림 추적이 WebView2 에도 켜졌는지).

### 절전과 깨어남

알려진 것:
- 절전과 깨어남 자체는 `visibilitychange` 나 `focus` 를 내지 않는다(창이 계속 보이는 상태였다면).
- 깨어나면 기한이 지난 타이머는 프로세스가 돌기 시작할 때 곧 실행된다.

불확실한 것:
- Windows 판 Chromium 의 단조 시계(QueryPerformanceCounter 기반)가 절전 동안 흐르는지. 흐르면 깨어나자마자 자정 타이머가 실행된다. 흐르지 않으면 잠든 시간만큼 늦게 실행된다. 현대식 대기(S0ix), S3 절전, 최대 절전마다 다를 수 있고 WebView2 판에서 재지 않았다.

그래서 설계는 이렇게 둔다: 타이머가 언제 실행되든 실행되면 실제 날짜로 판정한다. 늦게 실행되는 쪽이어도 사용자가 돌아와 누르거나 키를 치는 순간 입력 안전망이 400ms 안에 적용한다. 창이 숨어 있다 보이면 `visibilitychange` 가 잡는다. 최악은 "사용자가 아무것도 하지 않고 보기만 하는 동안 잠든 시간만큼 늦음" 이다. QA 에서 실측해 결과를 이 문단에 적는다(시험 계획 D).

### 시계 바꿈, 시간대

- **시계를 앞으로(자정 너머로)**: 타이머 기한은 그대로라 늦게 실행된다. 다음 입력, 포커스, 보임에서 잡힌다.
- **시계를 뒤로(어제로)**: 날짜가 달라졌으므로 같은 적용을 한다. 따라가기 규칙이 대칭이라 고른 날이 오늘(새 날짜, 실제로는 어제)로 간다. 이미 걸린 타이머는 벽시계 기준으로 일찍 실행되는데, 실행되면 날짜가 같으니 아무것도 안 하고 다음 자정으로 다시 건다. 최소 1초라 빈 돌기는 없다.
- **시간대 바꿈**: Chromium 은 Windows 시간대 바뀜을 알아채 V8 날짜 계산을 고친다고 알려져 있으나 WebView2 에서 확인하지 않았다. 고쳐지면 다음 판정에서 날짜가 달라져 적용된다. 안 고쳐지면 앱을 다시 켤 때까지 옛 시간대로 계산한다(지금과 같다).
- **일광 절약(DST)**: 한국에는 없다. 그래도 다음 자정을 `new Date(y, m, d + 1)` 로 만들고 86400000 을 더하지 않으므로 23시간, 25시간 날에도 맞다. 자정이 없는 날(자정에 시계가 넘어가는 지역)은 Date 가 01:00 으로 바로잡고, 판정은 시각이 아니라 날짜를 보므로 문제가 없다.
- **서버 시각**: 쓰지 않는다. 보고 날짜와 DB 저장 시각은 지금도 각자의 시계를 따른다. PC 시계가 틀린 사람은 지금도 틀린 오늘을 본다. 이 설계는 그것을 고치지 않는다.

### `setTimeout` 최대 기한

브라우저는 기한을 부호 있는 32비트 정수로 다룬다. 2^31-1ms(약 24.8일)를 넘으면 넘쳐서 곧바로 실행되고, 다시 거는 코드라면 빈 돌기가 된다. 이 설계의 기한은 길어야 하루와 60초라 넘지 않지만 `dayMsToNext` 가 상한으로 자른다. 하한 1초도 둔다.

## 안티패턴과 피하는 법

| 안티패턴 | 이 설계 |
|---|---|
| 주기적 확인(setInterval, 몇 분마다 날짜 보기) | 자정 타이머 하나와 이벤트. 하루 한 번 깬다. 미룸 재시도는 손 동작이 이어지는 동안만, 20번 상한 |
| 타이머 여러 개(자정용, 미룸용, 재시도용이 따로) | 손잡이 하나(`DAY.timer`). `dayArm` 만 걸고 늘 먼저 지운다. 다른 곳에서 `CLOCK.set` 을 부르지 않는다 |
| 흩어진 `new Date()` | `CLOCK.now` 한 자리, `nowDate()`, `todayYmd()`. 오늘을 읽는 `new Date()` 는 이 둘로 바꾸고 텍스트 가드로 막는다 |
| 다시 그리기 폭풍(`renderAll` 여러 번, 탭마다 다 그림, 창마다 서버 읽기) | 상태와 칠하기를 나누고 칠하기는 한 번에 모은다. 보이는 탭만. 서버 읽기는 범위가 바뀐 탭 하나. 흔들림으로 PC 끼리 흩뜨린다 |
| 사용자 선택 옮기기 | "옛 오늘과 같을 때만" 따라간다. 보는 달은 고른 날이 따라갔고 옛 오늘의 달이었을 때만 |
| 두 번 적용(타이머와 포커스가 겹침, 칠하는 중 다시 들어옴) | 칠하기 전에 `DAY.today` 를 먼저 바꾼다. 두 번째 판정은 같은 날이라 아무것도 안 한다. 칠하기 대기는 꺼내면서 비운다 |
| 창을 닫을 때 남는 것 | 문서와 함께 사라진다. `pagehide` 에서 타이머를 지운다. 숨겨 다시 쓰는 근태 창에는 설치하지 않는다. 듣기는 설치 때 한 번(`DAY.on`) |
| 누르는 순간 DOM 갈아 끼우기 | 입력에서 알아채면 400ms 미룸, 누르는 중과 끌기 중이면 다시 미룸 |
| 숨은 창에 그리기 | 칠하기는 보일 때. 알림 다시 보내기만 숨어 있어도 한다 |
| 호스트와 웹이 각자 다른 규칙 | 웹만으로 정한다. 호스트 이벤트(SystemEvents)를 웹에 새로 잇지 않는다. 알림의 시각 판정은 지금처럼 호스트, 무엇을 알릴지는 웹 |

## 시험 계획

새 파일 `tests/day-rollover.test.mjs`. 저장소 방식대로 jsdom 으로 앱 전체를 띄우고(`attendance-web.test.mjs` 의 `beforeParse` 와 shims), jsdom 이 없으면 skip(엄격 모드에서는 실패)으로 센다. 변이 시험은 `app-context.test.mjs` 처럼 소스를 바꿔 두 번째 jsdom 을 띄운다.

### 시험 창구

```js
window.__test.day = {
  state: () => ({ today: DAY.today, applied: DAY.applied, armed: !!DAY.timer, paint: !!DAY.paint }),
  check: (src) => dayCheck(src || 'timer'),
  msToNext: dayMsToNext,
};
```

시계는 `beforeParse` 에서 바꿀 수 없으므로(앱이 `CLOCK` 을 만든다) 부팅 직후 `w.eval` 로 `CLOCK.now`, `CLOCK.set`, `CLOCK.clear`, `CLOCK.rand` 를 가짜로 바꾸고 `dayStop(); DAY.on = false; dayInstall();` 로 다시 설치한다. 가짜 타이머는 살아 있는 손잡이 목록을 들고 `fire()` 로 가장 이른 것을 실행한다. 부팅 시각을 정해야 하는 시험은 `beforeParse` 에서 `win.Date` 를 고정 시각 Date 로 바꿔 부팅하고 그다음 CLOCK 을 바꾼다.

### 시험 목록

1. **순수 계산**: `dayMsToNext` 가 23:59:59.999, 00:00:00.000, 12:00, 12/31 23:59, 2/28 과 윤년 2/28 에서 맞는 값. 상한 2^31-1. jitter 를 더한다.
2. **타이머 하나**: 설치 직후 살아 있는 손잡이 1. `visibilitychange` 50번, `focus` 50번, `pointerdown` 50번, `keydown` 50번 뒤에도 1. 미룸(입력, 바쁨)과 적용을 오간 뒤에도 1. `pagehide` 뒤 0, `pageshow` 뒤 1.
3. **같은 날은 아무것도 안 함**: 같은 날 `check` 100번, 이벤트 200번 뒤 `applied` 0, `renderGrid`, `renderPanel`, `pcRender`, `atRenderMonth` 감시 계수 0, 게시된 `reminderSync` 0.
4. **자정 넘김은 한 번**: 23:59:30 부팅, 시계를 00:00:20 으로, 타이머 실행. `applied` 1, `renderGrid` 1, `renderPanel` 1. 이어서 `focus`, `visibilitychange`, 타이머 실행을 여러 번 해도 1. 다음 자정까지의 기한으로 다시 걸렸다.
5. **따라가기**: 고른 날 = 옛 오늘, 월간, 그 달을 봄. 11/12에서 11/13: 고른 날 11/13, 달 그대로. 11/30에서 12/1: 고른 날 12/1, 달 12월, 창 제목 "2026년 12월". 12/31에서 1/1: 해가 넘어간다. 주간 일요일에서 월요일: 고른 날과 그리는 주가 다음 주. `.cal-c.today` 칸이 새 날 하나뿐.
6. **두기**: 고른 날이 다른 날이면 고른 날과 달 그대로(오늘 칸만 옮겨짐). 월간에서 다음 달로 넘겨 보던 중이면 고른 날은 따라가고 보는 달은 그대로. 과제 탭 기준일과 근태 탭 기준일도 같은 두 갈래.
7. **근태 보고 화면은 그대로**: 브라우저 모드에서 근태 탭 일간 보고 화면을 연 채(`ATE.date` = 옛 오늘) 넘김. `ATE.date`, `#atEd` 의 innerHTML, 임시 저장 키가 그대로. 주간(`AWE.mon`)도 같다. 근태 창 모드(`?win=attend`)로 부팅하면 `DAY.on` 이 false 이고 `CLOCK.set` 호출이 0. 관리 창, 열람 껍데기도 0.
8. **입력 미룸**: 날이 바뀐 뒤 `pointerdown` 은 바로 적용하지 않는다(`applied` 0, 손잡이 1). 400ms 실행 때 아직 누르고 있으면 다시 미룸. `pointerup` 뒤 실행에서 1. `dragstart` 중에는 `pointercancel` 이 와도 미룸, `dragend` 뒤 적용. 20번 넘으면 누르고 있어도 적용.
9. **숨김**: `visibilityState` 를 'hidden' 으로 두고 실행. `DAY.today` 와 고른 날은 바뀌고 `renderGrid` 0, `reminderSync` 1(HOST 메인). 'visible' 로 바꾸고 `visibilitychange` 를 쏘면 `renderGrid` 1.
10. **알림**: HOST 메인 창은 넘김마다 `reminderSync` 1번, 그 occ 의 occStart 가 모두 새 오늘 이후. 열람 프레임(`?peer=1`)은 0.
11. **시계 되돌림**: 11/13 에서 11/12 로. `applied` 1, 고른 날이 11/12 로. 일찍 실행된 타이머는 같은 날이라 아무것도 안 하고 다시 건다.
12. **서버 읽기는 범위가 바뀔 때만**: 과제 탭(가짜 `pcReq`)에서 월 중간 넘김은 `projectCalendarLoad` 0번, 달 경계는 1번. 근태 탭 `reportDailyList` 도 같다.
13. **텍스트 가드**: 소스에 `setInterval` 이 새로 생기지 않았다(지금 개수 고정). `todayYmd` 정의가 `nowDate()` 를 쓴다. 날짜 판정 자리 목록(goToday, setExportRange, atSumInit, rptMOpen, 부팅 view)에 `new Date()` 가 없다. `CLOCK.set(` 를 부르는 곳이 `dayArm` 하나다.

### 변이 시험

각 변이는 정상 앱에서 기대값이 나오는지 먼저 보고 변이 앱에서 무너지는지 본다.

| 변이 | 무너져야 하는 시험 |
|---|---|
| `dayArm` 의 `CLOCK.clear` 줄을 지움 | 2(손잡이가 2 이상) |
| `dayCheck` 의 `t !== DAY.today` 를 `true` 로 | 3(같은 날 적용) |
| `DAY.today = t` 를 `dayApply` 뒤로 옮기고 dayApply 안에서 dayCheck 재진입 | 4(두 번 적용) |
| 따라가기 조건 `selectedDate === old` 를 지움 | 6(사용자 선택이 옮겨짐) |
| `src === 'input'` 미룸 줄을 지움 | 8(누르는 순간 적용) |
| 설치 조건에서 `!ATTENDWIN` 을 지움 | 7(근태 창에 타이머) |
| `dayApply` 의 `pushReminders()` 를 지움 | 10 |

### 실위젯 QA(릴리스 QA 틀의 D 에 넣는다)

- 9222 디버그 포트에서 `CLOCK.now` 를 지금 + n 으로 바꿔 23:59:50 을 흉내 내고 메인 창, 열람 창, 근태 창을 연 채 넘김을 본다(오늘 칸, 패널 밀린 할 일, 과제 탭, 근태 탭, 알림 로그 `reminderSync`).
- 트레이로 숨긴 채 넘김: 알림 로그에 `reminderSync` 가 찍히는지, 다시 띄우면 오늘 칸이 맞는지.
- 실제 절전: 자정 전에 절전, 자정 뒤 깨움. 깨어나 아무것도 누르지 않고 1분 지켜본 뒤 오늘 칸이 바뀌었는지(단조 시계가 절전 동안 흐르는지에 대한 실측). 결과를 위 "절전과 깨어남" 에 적는다.

### 크기

- 앱: 시계 자리와 `DAY` 모듈 약 110줄, `new Date()` 바꾸기 7곳, 부팅 두 번 읽기 고치기 1곳, 시험 창구 5줄.
- 시험: 새 파일 약 400줄(변이 7개 포함). 기존 시험은 `todayYmd` 의 모양이 바뀌어 텍스트 가드가 있는 곳만 손볼 수 있다.
- 호스트(C#): 바꾸지 않는다.
- 위키와 패치노트 한 줄("PC 를 켜 둔 채 날짜가 바뀌면 달력의 오늘과 알림이 새 날을 따라갑니다").

### 위험

- 타이머가 절전 동안 멈추는 쪽이면 보기만 하는 사용자는 잠든 시간만큼 늦게 본다. 입력 한 번이면 맞는다. 실측 전까지 남는 위험이다.
- `dayPaint` 의 `renderGrid` 가 칩 맞추기(`fitChips`)를 하는데, 창이 숨은 채 칠하면 높이를 못 잰다. 숨김이면 칠하지 않으므로 피하지만 WebView2 가 숨김을 'visible' 로 알리면 이 경우가 생긴다. 다시 보일 때 크기 변경이나 다음 그리기에서 맞는다(지금 탭 전환과 같은 수준).
- 시험이 앱 전체를 띄우므로 jsdom 의 `document.visibilityState` 를 바꾸는 shim 이 필요하다.

## 열린 질문

1. **달이나 주가 바뀌는 자정에 보이는 과제 탭, 근태 탭이 서버를 한 번 다시 읽는다.** 사람마다 1분 안에 흩어진다. 권장: 그렇게 한다. 읽지 않으면 새 달로 넘어간 달력이 빈 채로 보이다가 다음 창 복귀에야 채워진다.
2. **월간에서 다른 달을 넘겨 보던 중이고 고른 날이 옛 오늘이면 고른 날(오른쪽 패널)만 오늘로 간다.** 권장: 이대로. 패널은 오늘 내용이 맞고 달력은 사용자가 보던 달이다. 둘 다 두는 쪽을 원하면 조건 하나만 바꾸면 된다.
3. **어느 판에 넣나.** 버그 고침이라 패치(0.28.x)가 기본이다. 0.28.0 산출물을 이미 만들었으므로 권장은 다음 판(0.28.1 또는 다음 기능 판)에 넣는 것이다. 0.28.0 빌드는 다시 돌리지 않는다.
