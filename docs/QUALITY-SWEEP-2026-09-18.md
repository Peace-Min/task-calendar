# 코드 품질 전면 조사 — 2026-09-18 (QUALITY-SWEEP)

> 배경: 사용자 — *"단기간에 기능 추가를 하다 보니 코드 품질을 확인할 기회가 없었다. 유사 현상 전면 조사."*
> 계기가 된 결함 두 개(같은 병): 보고서 `buildReport` 에서 **저장값→컨트롤 표시 동기화**와 **독립 슬롯(근태·초과시간)** 이 본문 가드(포함 항목 0개·과제 0행·날짜 오류) **뒤**에 있어, 가드가 먼저 return 하면 사라지거나 안 바뀌었다(커밋 7cc8916 · 91a2998).
> 조사 방식: 읽기 전용 검토 4축(오퍼스) → 페이블이 코드로 확인 → P0·P1 만 구현. 이 문서가 **남은 일의 정본**이다 — 다음 세션은 §3 부터 이어간다.

## 0. 규칙 (이번 조사에서 확정된 것 — 새 코드는 이 규칙을 지킨다)

1. **저장값 → 컨트롤 표시, 저장, 요약줄, 독립 슬롯은 함수 첫머리(가드 앞)** 에서. 렌더는 저장값을 읽기만 한다. (`syncReportFontUI` · `syncReportFormatUI` · 근태 블록이 모범)
2. **미리보기·복사·전송(일간·주간)은 같은 rows/flags 에서 나온다(WYSIWYG).** 출처(cal/net/week) 판정이 세 경로에서 같아야 한다.
3. **표시 옵션은 숫자를 바꾸지 않는다.** 공수·미입력 건수·회사 전송의 시간 줄은 옵션과 무관.
4. **목록 상자는 `height` 고정, 빈 안내는 상자 안에.** 검색·탭·토글로 창 높이가 출렁이면 안 된다.
5. **모달을 여는 모달보다 뒤에 둔다**(`.overlay` 는 z-index 단일값 → DOM 순서 = 쌓임 순서). 앞에 있는 모달을 열어야 하면 여는 쪽을 먼저 닫는다(`toSettings` 패턴).
6. **조회 재진입 가드는 조용히 삼키지 않는다** — 토스트 한 줄("불러오는 중입니다 — 잠시 후 다시 시도하세요").
7. **키 입력 이벤트에서 DB 저장·전체 재빌드 금지** — 디바운스 미리보기 + change 저장.
8. 재렌더는 **쥐고 있던 컨트롤의 신원을 저장해 포커스를 되돌린다**(`uaRender`/`trRender` 규율). 잠금은 `lockLineBtn` 으로 제자리에서.

## 1. 확정 목록 — 1차 구현(보고서·옵션) ✅ 커밋됨

| # | 등급 | 자리 | 증상 → 수정 |
|---|---|---|---|
| 1 | P0 | 주간 전송 `#btnRptSend` · `setReportMode` | 기간 취합에서 출처 「netcus 주간」을 고른 뒤 주간 탭으로 가면 출처가 남는데 전송은 캘린더 기록으로 새로 만든 내용을 보냄 → 모드 전환 시 `week` 를 `cal` 로 되돌리고 세그 동기화(`syncReportSourceSeg`), 전송 핸들러에 week 거부 |
| 2 | P1 | `collectReportData` git 분기 | 「설명 포함」 OFF 여도 커밋 전체 본문 전송 → `includeDetails` 를 본다 |
| 3 | P1 | `buildWeeklyFields` | 커밋 본문이 주간 전송에서만 빠짐 → `reportTextBody(m,pad)` 공용화 |
| 4 | P1 | 일간 카드 `.rcard-h-in` | 미분류 「기타」 행의 시간 입력이 payload·DB 에서 버려짐(FK) → 미분류 행에는 입력 없음 + 안내 |
| 5 | P1 | `reportFormatKeyForMode` | 기간 취합이 주간의 옵션 키를 공유하는데 표시가 없음 → 패널 안 힌트 한 줄(공유는 유지 — 시험이 고정) |
| 6 | P1 | netcus 병합 캐시 | 기간 변경 시 주간 캐시가 남아 이전 기간이 복사됨 → from/to 변경·모드 전환에서 두 캐시 무효화, `buildReportText` 도 key 대조 |
| 7 | P1 | `rowHasHours` | 「내용 없는 항목 제외」 판정이 화면에 안 나오는 일정 공수(`r.minutes`)를 봄 → (날짜×과제) 공수표만 |
| 8 | P1 | `buildReport` | 날짜 오류 상태에서 옵션 변경이 저장되지 않고 요약줄이 낡음 → 저장·요약을 가드 앞으로 |
| 9 | P0 | `#rptCatLink` | 「과제 관리」가 보고서 모달 **뒤**에서 열림 → 보고서를 먼저 닫고 연다 |
| 10 | P1 | `.rpt-send-hint/.rpt-send-status` | 좁은 폭에서 문구가 세로로 쏟아져 푸터가 수십 줄 → nowrap+ellipsis+title |
| 11 | P1 | 검색 `#sResults` | 결과 0 이면 `:empty` 로 상자가 사라져 창이 튐 → 빈 안내를 상자 안에 |
| 12 | P2 | `openReport` 세그 | 잠금 중 재오픈 시 활성 버튼 없음 → 활성 판정에서 disabled 제외 |
| 13 | P1 | `loadUserPerm` | 재오픈 시 직전 계정 권한이 잠시 보임 → 첫머리에서 「확인 중…」 |
| 14 | P1 | `openTrash/openOrgTitle/openUserAdmin/openMembers` | 조회 중 닫고 다시 누르면 무반응 → 토스트 |
| 15 | P1 | `#rptMarkerCustom` | 키 입력마다 DB 저장·전체 재빌드 → 디바운스 미리보기 + change 저장 |

## 2. 검토했지만 문제 없음(요약)

- 휴지통·구성원 편집·직급·소속의 열기 순서(상태 비움→빈 렌더→불러오는 중→openModal), 회신 seat 한 길, busy 가드 고착 없음(`hostRequest` 는 항상 resolve), 호스트 계약 키·회신 모양 전부 일치, 죽은 식별자 없음.
- 글꼴(기간 취합 전용)·머리기호·들여쓰기는 미리보기·복사·전송 3자 일치. 근태·초과시간은 옵션과 결합 없음.
- 중첩 모달 DOM 순서는 `#rptCatLink` 한 건 빼고 전부 정상. 푸터 도달성(320px 높이)은 `.modal-body{overflow:auto}` 로 보장.

## 3. 2차 — §3.1·§3.2·§3.3 은 2026-09-18, §3.4-A·B·C(1차 6건) 는 2026-09-23 구현·커밋됨 ✅ / §3.4-C 나머지 5건은 **사용자 결정으로 보류**(2026-09-23 · "지금 시점에 불필요, 필요할 때 요청") — 조사는 종료, 요청 시 §3.4-C 하단 표에서 재개

> 순서대로. 각 항목은 검토 보고에서 코드로 확인된 것이며, 줄 번호는 2026-09-18 기준(내용으로 다시 찾을 것). 구현은 dev-delegate(오퍼스), 게이트는 페이블: Debug 재빌드 → CDP 실화면 → `loop-ui-visual`(해당 화면) → 엄격 게이트.

### 3.1 P1 — 구성원 편집·직급·소속 (`ua*`/`ot*`) ✅ 완료
- **`otRender` 포커스 미복원**: ▲▼·숨김·복구 회신마다 목록을 통째로 다시 만들며 포커스가 body 로 떨어진다. `uaRender`/`trRender` 의 keep/restore 블록(쥐고 있던 `data-otop`·`data-otkey` 저장 → 재생성 뒤 같은 신원에 포커스)을 ot 에도. `.cust-row` 에 `tabIndex=-1`.
- **`otSyncControls` 가 `lockLineBtn` 을 안 씀**: 왕복 시작 순간 포커스를 쥔 버튼이 disabled 되며 포커스 유실. `lockLineBtn(b, …)` 재사용(행 열쇠 `data-otkey`). `<select>`(상위 변경)도 잠근다.
- **`uaAdminBar()` 가 명부 안착마다 상단/하단 막대를 통째로 재생성**: 직급·소속 창을 닫으면(`otAfterClose`→`uaReload`) 또는 「퇴사자 보기」 토글 시 포커스가 body 로. 막대도 id 기준 포커스 복원, 또는 모드 전환·관리자 뒤집힘일 때만 재생성하고 나머지는 제자리 갱신.

### 3.2 P1 — 레이아웃(공식 과제·직급·소속·검색·상세) ✅ 완료(+ 500px 하단 줄 0.2px 부족 → 패딩 8px, _onModalClosed 가 재생성된 opener 를 id 로 다시 찾음)
- **`#otList .cust-row` 421~500px**: 보정이 `@media (max-width:420px)` 뿐이라 421px 부터 가로 스크롤. 임계는 ≈560px → `max-width:560px` 로.
- **`#officialModal .modal-foot` 5요소(관리자)**: 441~600px 에서 두 줄 경계. 「발주처 관리·구분·상태 관리」를 ≤660px 에서 `.btn.sm` 로 강등하거나 한 버튼(「기준 정보 관리」)으로 묶기. 600×700 실화면 캡처로 확정.
- **`.off-toolrow` 441~560px**: `＋ 새 공식 과제` 만 둘째 줄로. ≤440 규칙을 ≤660 으로 넓히거나 `.off-fcount` 를 `#offCount` 에 합침.
- **`.off-detail` (<900px 세로 스택)**: 행을 고를 때마다 상세 패널 높이가 달라져 모달이 튄다. 고정 높이 + 내부 스크롤(목록 42vh 와 합쳐 92vh 안에 들어가는지 380×600·600×700 에서 확인).

### 3.3 P2 — 싸고 안전한 것 ✅ 완료
- `.cust-row` 접힘 보정 선택자를 `#otList` → `.cust-list .cust-row` 로(`#codeList` 도 4버튼).
- `#hostbar .hb-drag{min-width:0;overflow:hidden;white-space:nowrap}` — 버튼 하나만 늘어도 ✕ 가 화면 밖으로.
- `.swatch.on` 흰 인셋 링 → `var(--panel)`.
- `trSeat` 의 안 읽히는 반환값 제거(2026-09-18 `uaSeatRoster` 와 같은 이유) · `if(__uaSaving) uaSetSaving(true); else uaSetSaving(false);` → `uaSetSaving(__uaSaving)`(openUserAdmin·openTrash).
- `otSwitchTab` 인라인 → `otListTop()` 헬퍼 · `#otShowHidden` 토글 시 맨 위로.
- `closeOverlay` 의 reportModal 부수효과에 `clearNetcusWeeklyMerge()` 추가(대칭).
- `#uaSearch` 디바운스(검색 `#sInput` 처럼 180ms).
- `otAfterClose` 의 열림 판정을 `isOverlayOpen` 으로.

### 3.4 P2 — 판단이 필요한 것(사용자 확인 후) — A·B·C-1차 완료 ✅ · C 의 5건(1·8·3·6·5)은 **보류**(사용자 결정 2026-09-23)

#### 3.4-A 레이아웃 튐·하드코딩 색 ✅ 2026-09-23 구현·커밋(실화면 CDP 측정 전후 + loop-ui-visual 0건 + 계약 `tests/layout-stability.test.mjs` 10건)
| 자리 | 전(측정) | 후 | 수정 |
|---|---|---|---|
| `#categoryModal .modal-foot` 편집 모드 | 380px 62→107px(두 줄) · 320px 6.9px 부족 | 62 / 55px 한 줄 | `#btnRelinkOpen` 글자를 `.btn-label` 로 감싸 ≤440px 아이콘만(title·aria-label 유지) + ≤360px 컴팩트 버튼(#officialModal 선례) |
| `.rem-row` 「직접」 320px | 44→96px(둘째 줄) | 44px | ≤360px 에서 gap·세그 패딩·숫자칸·단위 패딩만 줄여 42px 회수(높이 규칙 `--rem-ctl-h` 불변) |
| `#qaRecurHint` | 반복 선택 시 +38px | 불변 | `.hidden{display:block!important;visibility:hidden}` + 문구를 켜짐·꺼짐 모두 채움 |
| `#qaTodoNoteWrap` | 종료일 입력 시 −95px(칸을 안내문으로 교체) | 불변 | 칸은 그대로, 라벨 「시작일 설명 (나머지는 추가 후 날짜별로)」·placeholder 로 뜻 전달(addTodo isPeriod 가 이 값을 시작일 dayNote 로 넣는다 — 진실 그대로) · `#qaTodoPeriodHint` 삭제 |
| `#raHint` | 근태 선택 시 레일 −39px(좁은 폭 −23px) | 불변 | `#raHint.hidden` visibility 규칙(JS 불변) |
| `.pv-frame`·`.pv-skeleton` | `min-height:420px` | `min(420px,60vh)` | 낮은 창 비례 |
| `.s-date`·`mark` | `#f5f7fd`·`#ffe27a` 하드코딩 + `html.dark` 개별 재정의 | `var(--dim-bg)` · `--mark-bg/--mark-ink` 토큰(contrast `--mark-ink:#000`) | hex 래칫 49→45(app-context) |
| `#reportModal` ≥900px 격자 | 1000×420 에서 `.rpt-body` 277px > 본문 269px → overflow:hidden 에 잘림 | 253px(본문 안) | 본문 flex 열 + `.rpt-body{flex:0 1 min(66vh,600px);min-height:0}` — 평소 600px 그대로 |

#### 3.4-B 경합·상태 정확성 ✅ 2026-09-23 구현·커밋(실화면 CDP 시나리오 + loop-trash·loop-org-title 실 DB 루프 + 계약 `tests/inline-edit-guard.test.mjs` 9건 · trash-web ⑦ 갱신)
| 자리 | 증상 | 수정 |
|---|---|---|
| `trDelete` ↔ `confirmTyped` | 확인창이 닫힌 뒤 `#ctInput` 을 되읽어 보냄 — 그 사이 다른 확인창이 열리면 칸이 비워진다 | `confirmTyped` 가 [영구 삭제] 순간의 값을 `{ ok:true, typed }` 로 resolve(취소는 `'cancel'` 그대로) · `trDelete` 는 `r.typed` 만 보낸다(가공 없음 · `ctInput` 참조 0) |
| `reloadCodeList` · `reloadCustomerList` | 탭 연타·재조회 시 먼저 보낸 요청의 늦은 회신이 새 목록을 덮음(구분 회신이 상태 탭에 앉음) | 목록 상자 `dataset.gen` 세대 표식(모듈 상태 0 증가): await 앞에서 찍고 회신 직후 낡았으면 return — 목록 변수 대입 전에 |
| 인라인 편집 × 탭 전환·「숨김 표시」 (cust · code · ot) | 이름변경 입력칸·상위 변경 select 가 재렌더로 말없이 버려짐 | 공용 `inlineEditDirty/guardInlineEdit`(DOM 만 판정 · ot 모듈 상태 5개 불변): 값이 그대로면 조용히 진행(Esc 와 같음), 바뀌었으면 `confirmBox` 「저장하지 않은 변경이 있습니다 — 버리고 계속 / 계속 편집」. 체크박스는 「계속 편집」 시 되돌림. 일곱 배선(`#custShowHidden`·`#codeTabSection/Status`·`#codeShowHidden`·`#otTabTitle/Unit`·`#otShowHidden`)만 감싸고 `otSwitchTab`·`switchCodeKind` 본문 불변 |

#### 3.4-C 보고서 의미 변경 — 1차(사용자 「바로 진행」 승인 6건) ✅ 2026-09-23 구현·커밋(엄격 1724/0/0 · CDP 실화면 · loop-ui-visual reportModal 위반 0 · app-context 새 시험 7건 · report-wiring ⑤·⑩ 갱신)
| # | 자리 | 증상 | 수정 | 변화 |
|---|---|---|---|---|
| C-4 | `pushTitle` 강등 | 같은 제목이 다시 오면 메타를 새로 만들며 `body`·`dayDetails` 를 버림 → 제목이 같은 커밋 두 건이면 본문이 미리보기·복사·주간 전송에서 전부 사라짐 | `mergeReportBody`(같으면 1회·다르면 줄바꿈 연결)·`mergeReportDayDetails`(date+text 중복 제거·날짜순) 로 보존. 강등 메타(kind:null)의 날짜별 줄은 `reportDayLinesHtml` 이 읽기전용으로 그림(`canEdit` = todo+todoId 일 때만) | **전송 본문에 본문이 다시 실림**(버그 수정) |
| C-2 | 일간 payload `hours` | `state.categories` 등록 순서·`!= null` 조건으로 따로 만듦(본문 헤더는 rows·`>0`) | 공용 `reportDailyHours(rows, date)` — 본문 헤더(`_hmap`)와 payload 가 같은 rows·같은 함수. payload 는 `collectReportData(from,to,rptSources()).rows` 에서 | 숫자 불변 · payload 순서가 본문과 같아짐(기타 마지막) |
| C-10 | `collectReportData` 죽은 합계 | 항목당 `e.hours` 전액 합산(`sumMin·grandMin·uninput·rows[].minutes`) — 반복·여러 날 일정에서 틀린 숫자이고 어디에도 표시 안 됨 | 전부 제거, `return { rows }`. 시간의 단일 출처 = `getTaskHours`(날짜×과제) | 표시·전송 불변(죽은 코드 제거) · app-context 4개 시험·변이⑥-c·report-wiring ⑩ 갱신 |
| C-9 | `buildCalendarExportMd` | 커밋을 `- subject (hash)` 한 줄로만 — 앱에서 편집한 본문·수기 커밋 본문이 어디에도 남지 않음 | body 줄을 불릿 아래 2칸 들여쓰기로(빈 줄 제외) | export md 만 바뀜 · 회사 전송 불변 |
| C-11 | `load()` `reportSource` | `'net'` 만 살리고 나머지 cal — 브라우저 새로고침 뒤 주간 탭이 「위젯에서만」 안내로 열림 | 항상 `'cal'`(buildStateFrom 과 같게, "인메모리 전용" 주석과 일치) | 표시만 |
| C-7 | 보고서 푸터 | dry/real 이 설정 모달에만 있어 누르기 전 이번 전송이 실제 제출인지 알 수 없음 | `#rptSendMode` 배지(「미제출 테스트 모드 / ⚠ 실제 제출 모드」, real 은 danger 톤) — 일간·위젯(reportAuto)에서만, 누르면 보고서를 닫고 설정을 연다(§0-5), 설정 라디오 변경이 배지도 갱신. **≤440px(위젯 실폭)에서는 배지가 푸터를 두 줄로 밀어(측정 380px 62→107px) CSS 로 숨기고 전송 버튼이 `.real` danger 톤 + title 로 모드를 입는다**(loop-ui-visual V3·V7 로 잡은 뒤 정정) | 표시만 · 전송 불변 |

#### 3.4-C 남은 5건 — **보류**(2026-09-23 사용자: "지금 시점에 굳이 불필요, 나중에 필요할 때 요청") · 비포·애프터 장표는 그 세션 산출물(저장소 밖). 재개 시 각 항목의 권장안/대안을 아래에서 고른다.
- **1 주간 복사본에 과제투입시간 블록**(권장: 복사본 끝에 전송과 같은 함수로 시간 블록 추가 — 복사 텍스트 바뀜 · app-context 1708 계약 갱신) vs 안내만.
- **8 `gitCommitBody` 한 체크박스 두 뜻**(권장: 보고서는 저장된 `c.body` 유무+「설명 포함」만으로 판정, 체크박스는 수집 전용 — 전송 내용 바뀜 · app-context 1300·1308·1316 계약 뒤집힘) vs ⚙ 별도 「커밋 본문」 항목.
- **3 「기타」 병합 정규화 통일**(권장: 공용 `isEtcName()` NFC+공백 제거를 병합·정렬·두 파서에 — 행 수·배치 바뀔 수 있음 · netcus-weekly 153 등 갱신) vs 정확일치 통일+저장 시 trim.
- **6 포함 항목 저장 위치**(권장: `cal_user_pref` 칼럼/JSON + XML prefs 로 이관 — 스키마 v13, v0.19 릴리스 창과 함께) vs ⚙에 「이 PC 에만 저장」 표기.
- **5 `currentReportFormatPref()` 레거시 필드 부수효과**(권장: 읽기 순수화 + 동기화를 update/쓰기 시점으로 — 불변) — 후순위.
- (참고, 원문) 주간 복사본에 과제투입시간 블록이 없음(전송본과 불일치) · 일간 payload `hours` 를 `rows` 에서 만들기 · 「기타」 병합 정확일치 vs 정규화 · 중복 제목 강등 시 `body`/`dayDetails` 유실 · `currentReportFormatPref()` 의 레거시 필드 부수효과 · 포함 항목 5개만 localStorage(나머지는 XML) · 전송 dry/real 이 보고서 화면에 안 보임 · `gitCommitBody` 한 체크박스 두 뜻 · 내보내기가 커밋 본문 미포함 · 반복 일정 공수 전액 산입(합계를 되살리면 과대) · `reportSource` 정규화가 'week' 누락.

## 4. 검토 원문

네 검토의 전체 보고는 이 세션의 산출물이라 저장소에 없다. 위 §1·§3 이 확인된 항목의 정본이며, 각 항목의 "원인" 은 코드의 주석(2026-09-18 표기)으로 옮겨 적었다.
