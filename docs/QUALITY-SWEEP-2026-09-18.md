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

## 3. 2차 — §3.1·§3.2·§3.3 은 2026-09-18 구현·커밋됨 ✅ / §3.4 는 남음(다음 세션이 여기서 시작)

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

### 3.4 P2 — 판단이 필요한 것(사용자 확인 후) ← **남은 일은 여기부터**
- `#categoryModal .modal-foot` 의 「수정 취소」 hidden 토글로 380px 에서 푸터가 한 줄↔두 줄.
- `.rem-row` 「직접」 선택 시 320px 에서 2줄(잔여).
- `#raHint`·`#qaRecurHint`·`#qaTodoNoteWrap` 의 흐름 이탈 토글(빠른등록 모달이 튐) — `#mbSoon` 패턴(visibility + min-height).
- `.pv-frame{min-height:420px}` → `min(420px,60vh)`.
- 주간 복사본에 과제투입시간 블록이 없음(전송본과 불일치) · 일간 payload `hours` 를 `rows` 에서 만들기 · 「기타」 병합 정확일치 vs 정규화 · 중복 제목 강등 시 `body`/`dayDetails` 유실 · `currentReportFormatPref()` 의 레거시 필드 부수효과 · 포함 항목 5개만 localStorage(나머지는 XML) · 전송 dry/real 이 보고서 화면에 안 보임 · `gitCommitBody` 한 체크박스 두 뜻 · 내보내기가 커밋 본문 미포함 · 반복 일정 공수 전액 산입(합계를 되살리면 과대) · `reportSource` 정규화가 'week' 누락.
- ot 인라인 편집(이름변경·상위 변경)이 탭 전환·숨김 토글로 말없이 버려짐(cust/code 도 동일).
- `trDelete` 가 닫힌 확인창의 `#ctInput` 을 되읽음 — `confirmTyped` 가 값을 resolve 로 돌려주게.
- `reloadCodeList/reloadCustomerList` 탭 연타 시 늦은 회신이 덮음 — 세대 토큰.
- `.s-date`·`mark` 하드코딩 색(forest/sepia/contrast 미보정) · `#reportModal .modal-body{overflow:hidden}` 넓고 낮은 창.

## 4. 검토 원문

네 검토의 전체 보고는 이 세션의 산출물이라 저장소에 없다. 위 §1·§3 이 확인된 항목의 정본이며, 각 항목의 "원인" 은 코드의 주석(2026-09-18 표기)으로 옮겨 적었다.
