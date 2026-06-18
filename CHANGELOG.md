# CHANGELOG · 인계 문서 — 수행과제 캘린더

> **목적**: 이 저장소만 받아도(작업 메모리 없이) **현재 상태 · 빌드 · 배포 · 남은 일**을 파악해 다른 세션/사람이 이어서 작업할 수 있게 한다. 최신 항목을 위에 둔다.
> 의사결정 근거 보고서: `근본원인-진단-등록흐름.md`, `UX-RESEARCH-우측뷰어탭.md`, `창모드-조사-보고서.md`(+`창모드-비교-시각.html`). 데이터/검증 명세: `SPEC.md`. 운영 이슈: `ISSUES.md`.

---

## 🆕 2026-06-18 — 잔여 작업 A~G 완주 (프로토타입 승인 후 페이즈 9~12)

최종 게이트(8.6) 이후 사용자에게 [잔여작업-프로토타입.html](잔여작업-프로토타입.html)(A~G before/after) 제시 → 사용자 결정 "A~G 전부 진행, B(셀 위계)는 A안 현행 유지". 페이즈별 구현→실제 UI 전문 피드백→보완으로 완주, 매 페이즈 회귀 보완:

- **Phase9 (A) 인-칩·패널 아이콘 SVG화**: ICON 맵에 repeat/star/starFill/box/boxCheck. 칩 git🔧·반복🔁→선행 SVG(클립 해소), 패널 할 일 체크박스 ☑☐·★☆·삭제✕·'중요만' 토글·작업일지 배지·과제 cat-git/desc·더보기 help-row 🖱️↔️⌨️→전부 단색 SVG. 별표 의미색 골드(#e0a32e) 통일. *(Visual 9, P1 별표3색·help-row→보완)*
- **Phase10 (C+D) 폼 폴리시**: entryModal 종일 시 #timeRow 흐림→숨김(quick-add 통일). 제목 placeholder 유형별 단문('일정 제목'/'할 일'), quick-add 반복 선택 시 '격주·횟수는 자세히 편집' 힌트, qaPrio ★→골드 별 SVG. *(IA/Form 9, 보완 불필요)*
- **Phase11 (E+F) 토스트·탭**: 토스트 퇴장 dismiss() 페이드 통일(_leaving 플래그, 비-Undo 우선 제거), error→#toastStackErr(assertive)/나머지→#toastStack(polite) 분리(role 중첩 이중낭독 해소). #dpReport를 .dp-tabbar로 감싸 tablist 밖 형제로(SR 'tab N of M' 오집계 해소). *(Polish 9, 보완 불필요)*
- **Phase12 (G) 부팅 스켈레톤**: #bootSkeleton 오버레이(7열×5 펄스, 실 그리드 모사), HOST 부팅 시 표시→__applyXml 실데이터 렌더 후 제거. 폴백 __xmlApplied 가드+4s, reduced-motion 정적 placeholder, 다크 가시성(--border-hover). *(Polish 8, P1 폴백타이밍·reduced-motion→보완)*
- **B(셀 위계)**: 사용자 선택대로 현행 backfill(밀도 우선) 유지 — 코드 변경 없음.

> 페이즈 9~12 전문가 피드백이 잡은 회귀(P1) 모두 같은 턴 보완·재검증. 8개 페이즈(1~7+게이트보완8) + A~G(9~12) 전부 commit·exe 재빌드(171MB)·배포·재실행 완료. 의미 마커 전 표면 SVG화로 직전 게이트의 P1(아이콘 일관성) 해소.

---

## 🆕 2026-06-18 — 상용화 로드맵 7페이즈 자율 완주 (페이즈별 전문가 피드백·보완)

직전 재평가(6.2→7.4)가 제시한 잔여 P1/P2 로드맵을 7페이즈로 나눠 **페이즈마다 구현 → 실제 UI(헤드리스 Edge 캡처) UI/UX 전문 에이전트 피드백 → 보완 → 다음**으로 완주. 각 페이즈 preview_eval 검증 후 커밋. 마지막에 exe 재빌드(self-contained 단일, 171MB)→운영 위치 배포·재실행(PID 확인).

- **Phase1 생성/수정 폼 통일** `+ commit`: editEntry(id) 라우팅 — 단순 일정→openQuickAdd(edit, 프리필+updateEntry), git·반복→entryModal. '자세히 편집'은 폼값 이월 후 entryModal(손실 방지). 저장 라벨 생성='추가'/편집='저장'. *(전문가: IA/폼 8/10, P1 1건[에스컬레이션 값 미이월]→보완)*
- **Phase2 entryModal 섹션화**: 9필드 평면 폼→기본·시간·반복/기간·연동·메모 5섹션(.fsect/.fsect-cap, --sp-5). git 출처 편집 시 반복·기간 섹션(#recurSect) 통째 숨김(고아 캡션 방지). *(IA/폼 8/10, P1[고아 캡션]+P2[캡션 위계]→보완)*
- **Phase3 탭 ARIA 계약**: #dpTabs 완전한 WAI-ARIA 탭(aria-selected/controls·role=tabpanel·labelledby·←/→/Home/End roving 자동활성), .qa-tg는 role=group+aria-pressed 강등. *(접근성 9/10, 보완 불필요)*
- **Phase4 이모지→단색 SVG**: 단일 소스 ICON 맵(svgIc currentColor·.ic 16px), 크롬 버튼 전부 치환(applyIcons). .ic{pointer-events:none}로 위임 클릭 회귀 방지. 의미 마커(🔧·★·🔁) 유지. *(Visual 9/10, P0[SVG 삽입 클릭 회귀]→pointer-events:none로 해소)*
- **Phase5 토스트 카드 스택**: #toastStack 정적 live region(polite), 카드별 독립 타이머·Undo, 최대 3(비-Undo 우선 제거로 Undo 보존), Undo→'되돌렸습니다' 확인, error=alert. *(Polish 8/State 9, 보완 불필요)*
- **Phase6 칩 폴리시**: 단일칩 빈 레인 backfill(세로 낭비↓·막대 연속성 유지), 멀티데이 막대 tint 0.13→0.2, --chip-outline #818a9e(3.38:1) hollow 경계. *(Calendar UI 9/10, 보완 불필요)*
- **Phase7 a11y/반응형**: 검색·보고서 요약 aria-live(role=status·polite·atomic), 전역 PageUp/Down 월이동, ≤440 .btn.icon 히트영역 40px+간격 8px(아이콘 시각 17px 유지). *(접근성 9/10, 보완 불필요)*
- **Phase8 최종 게이트 보완**: 재평가가 짚은 P1 — ① 아이콘 일관성(ICON 맵에 more/wrench/check/alert/xmark/dot 추가, btnMore·토스트 글리프·git 카드 타이틀 SVG화; 인-칩 의미 마커는 점선 테두리로 구분돼 의미 보존 판단으로 유지) ② .nd-sec 섹션 헤더 키보드 동작(tabindex+Enter/Space 토글, WCAG 2.1.1) ③ '자세히 편집' 무음 유실 방지(제목 공란 차단).
- **도구**: tools/capture-state.py(임의 JS 주입 헤드리스 실측 캡처, PID별 고유 프로필).

> **최종 게이트 재평가(ui-ux-eval-loop, 13 에이전트, 적대검증 7/7 confirmed): 종합 7.4 → 8.6**. 5차원 모두 8+ (Visual 9·IA/폼 8·Calendar UI 9·Polish 9·접근성 8), **P0 0 — 상용선(전 차원 8+ & P0 0) 도달**. "상용 완성"까지 남은 P1(전 표면 아이콘 완전 SVG화·셀 막대↔단일칩 위계 분리 등)은 Phase8에서 핵심분 보완, 잔여는 사용자 검토 항목. 페이즈별 전문가 피드백이 잡은 회귀(Phase1~4의 P0/P1)는 모두 같은 턴에 보완·재검증.

---

## 🆕 2026-06-17 — UI/UX 평가 루프 반영 4배치 (전부 커밋·재빌드·배포 완료)

전문 평가(ui-ux-eval-loop, 실제 UI 기준) P0/P1/P2를 4배치로 구현. 각 배치 preview_eval/스크린샷 검증 후 커밋, 마지막에 self-contained 단일 exe 재빌드 → 운영 위치 배포.

- **배치1 빠른수정** `8d9ac51`: 완료 할 일 텍스트 `--faint`→`--faint-text`(2.6:1→4.6:1 AA), 마감일·커밋시각 11→12px, 토스트 능동태+`success`(✓), 상단 아이콘버튼 aria-label·로고 aria-hidden, spacing 토큰(`--sp-1..6`)·중복 `--radius` 제거.
- **배치2 P0 접근성** `3ef9abc`: 월 그리드 키보드 내비(ARIA `role=grid`/`row`(.gridrow{display:contents}로 7열 레이아웃 보존)/`gridcell`, roving tabindex, 방향키·PgUp/Dn·Home·Enter/Space, 월경계 재렌더, `aria-selected`/`aria-label`). 모달 포커스 트랩/복원/배경 inert(MutationObserver로 전 열기·닫기 경로 일괄, Tab 순환, `role=dialog`/`aria-modal`/`aria-labelledby` JS 부여).
- **배치3-1 P1** `5711005`: ≤440px 모달→하단 시트(flex-end·전폭·상단라운드·그립·slideUp). 다크 모드(`prefers-color-scheme`, 역할토큰 리맵+`color-scheme:dark`, 토큰 밖 하드코딩 surface만 가법 오버라이드 → 라이트 CSS 불변; 칩 틴트는 13% 알파라 자동 적응).
- **배치3-2 P1** `b83f898`: 멀티데이 레인 배치 — 주별 greedy 구간채색으로 기간 막대에 고정 레인, 빈 레인은 `.chip-spacer`로 채워 겹치는 막대 staircase 해소(Google식 연속 밴드). fitChips는 spacer를 +N에서 제외.
- **배치4 P2** `d91136b`: 로고 이모지→인라인 SVG(currentColor), 빈 상태 아이콘(`.dp-empty`/`.nd-empty` ::before 데이터URI SVG 마스크+`--faint`, 라이트/다크 적응).
- **호스트**(`MainWindow.xaml.cs`): WebView2 `DefaultBackgroundColor`를 OS 테마(레지스트리 `AppsUseLightTheme`)로 분기(라이트 `#f3f4f7`/다크 `#0f1420`) → 다크 모드 초기 흰 플래시 방지.

> 검증 한계: 다크모드 흰 플래시 완화는 실제 위젯(WebView2 `--disable-gpu`)에서만 최종 확인 가능 — 코드는 반영했고 빌드/배포 완료, 위젯 가동(PID 확인). 멀티데이 레인은 겹치는 범위 주입 테스트로 레인 연속성(top px 동일) 확인.

**버그픽스(2026-06-17, `622bc31`)**: 사용자 실위젯 피드백 2건. ① 우측 '할 일' 탭이 **그 날 마감(due)인 완료 할 일을 누락** — 그리드는 마감일 기준 (취소선) 칩을 보이는데 패널 '이 날 완료'만 완료일(completedAt) 기준이라, 다른 날 완료한 그 날 마감 할 일이 그리드엔 뜨고 패널엔 안 떠 "이 날 할 일이 없습니다"로 보임 → '이 날 완료'를 `covers`(마감일 포함) 기준으로 변경(그리드와 축 일치). ② 분할바 최소(240px) 패널에서 **`📋 보고서` 버튼이 잘림**(탭 3개 + margin-left:auto 액션이 컨테이너 48px 초과) → `.dp-tabs container-type:inline-size` + 탭 패딩 축소 + `@container(max-width:300px)`로 라벨 숨기고 📋만(aria-label 유지), 넓은 패널은 전체 표시. exe 재배포(06-17 17:41). **교훈: 그리드(마감일 축)와 패널 섹션(완료일 축)이 다른 날짜축을 쓰면 같은 데이터가 두 뷰에서 불일치** — 같은 데이터의 두 뷰는 같은 축으로.

---

## 📌 현재 상태 스냅샷 (2026-06-16)

- **제품**: 폐쇄망(망분리) Windows 11용 **오프라인 데스크톱 캘린더 위젯**. WPF(.NET 9, `net9.0-windows`) + WebView2가 단일 임베드 HTML(`task-calendar-prototype.html`, 약 3000줄)을 창 100%로 호스팅.
- **핵심 목적**: 과제별 로컬 git 커밋 → **일간/주간 보고서 자동화** + 일정·할 일(TODO) 관리.
- **운영 배포 산출물**: `C:\Users\CEO\Desktop\수행과제캘린더\수행과제캘린더.exe` (자체포함 단일파일, ~163MB, win-x64, WinForms 포함).
- **데이터**: `%APPDATA%\TaskCalendar\` — `data.xml`(taskCalendar XML v1) · `widget.settings.json`(창 위치/크기/모드) · `WebView2\`(브라우저 프로필).
- **창 모드**(2026-06-16 확정): ⚙ 메뉴 **"트레이 아이콘 사용"** = 일반 앱 창(작업표시줄+Alt+Tab 노출, ✕=트레이 숨김) / 끄면 바탕화면 최하위 위젯(작업표시줄 제외). 사용자 현재 설정 = ON.
- **상태**: 기능적으로 완성·배포 운영 중. 미결은 아래 [남은 일](#-미결--남은-일) 참고.

---

## 🛠 빌드 & 배포 런북

> 이 개발 PC는 **인터넷 연결됨**(망분리 대상은 *배포될* 위젯이지 이 빌드 PC가 아님) + .NET 9 SDK + win-x64 런타임 팩/WindowsDesktop 런타임 캐시 보유 → 자체포함 단일 exe 빌드 가능.

```powershell
# 1) 파일 락 해제 — 반드시 두 이름 모두 종료(빌드명 + 배포 rename명이 다름)
Get-Process -Name 'TaskCalendarWidget','수행과제캘린더' -ErrorAction SilentlyContinue | Stop-Process -Force

# 2) 자체포함 단일파일 publish (HTML은 csproj EmbeddedResource로 빌드 시 임베드됨 → HTML만 바꿔도 재빌드 필요)
dotnet publish widget\TaskCalendarWidget.csproj -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o dist\portable

# 3) 운영 위치로 복사(파일명을 한글로 rename해 배포)
Copy-Item dist\portable\TaskCalendarWidget.exe "$env:USERPROFILE\Desktop\수행과제캘린더\수행과제캘린더.exe" -Force

# 4) 실행 (PID/Responding 확인)
Start-Process "$env:USERPROFILE\Desktop\수행과제캘린더\수행과제캘린더.exe"
```

**주의/함정**
- **파일 락**: 빌드 전 두 프로세스(`TaskCalendarWidget`, `수행과제캘린더`)를 모두 죽여야 함. 배포본은 rename돼 프로세스명이 다르다.
- HTML(`task-calendar-prototype.html`) 변경분은 `widget` csproj가 `index.html`로 EmbeddedResource 임베드 → **반드시 재빌드**해야 위젯에 반영됨(프리뷰만으론 위젯 안 바뀜).
- `dotnet publish`가 ".NET 미리보기 버전" 안내(NETSDK1057)를 출력해도 무해(빌드 PC SDK가 10.0 preview).
- 프레임워크 종속 빌드(`-o dist\app`, dll 다수)도 가능하며 시작이 더 빠름. 단 대상 PC에 .NET 9 데스크톱 런타임 필요. 폐쇄망 배포 옵션은 `DEPLOY.md` 참고.

**검증 방법**
- HTML/UI: 프리뷰 서버(task-calendar/ 루트)에서 `preview_eval`/`preview_snapshot`/`preview_inspect`로 계산된 스타일·동작 확인(스크린샷은 이 환경에서 타임아웃 → eval 기반 검증). 넓은 폭(1100px)+좁은 폭(380px) 둘 다.
- XML 무결성: HTML 콘솔에서 `xmlRoundTrip().ok === true`.
- 창 스타일(트레이/작업표시줄): P/Invoke `EnumWindows`+`GetWindowLong(-20)`로 ex-style 확인 — 트레이 ON `WS_EX_APPWINDOW`(0x40000)+`MainWindowHandle≠0`, OFF `WS_EX_TOOLWINDOW`(0x80)+`MainWindowHandle=0`.

---

## 🗂 핵심 파일 지도

| 경로 | 역할 |
|---|---|
| `task-calendar-prototype.html` | **UI/로직 전부**(의존성 0, 단일 HTML). 위젯에 임베드되는 본체. 가장 많이 수정됨. |
| `widget/MainWindow.xaml(.cs)` | WPF 호스트 — 창 모드/트레이/포커스/드래그·리사이즈/git 브리지/자동시작/데이터 IO. |
| `widget/App.xaml(.cs)` | 단일 인스턴스 뮤텍스, 종료/크래시 훅, 트레이 정리. |
| `widget/TaskCalendarWidget.csproj` | `index.html`=`task-calendar-prototype.html` EmbeddedResource, net9.0-windows, UseWPF+UseWindowsForms. |
| `SPEC.md` | 데이터 스키마 + 초기 검증 루프 기록. |
| `근본원인-진단-등록흐름.md` | 등록 마찰 근본원인 진단(→ quick-create 도입 근거). |
| `UX-RESEARCH-우측뷰어탭.md` | 우측 패널 탭 뷰어 상용앱 조사. |
| `창모드-조사-보고서.md` / `창모드-비교-시각.html` | 트레이/작업표시줄/Alt+Tab 창 모드 조사(실제 앱 스크린샷 포함, `img/`). |
| `ISSUES.md` | 운영/버그 추적. |

---

## 📜 변경 이력 (최신 순)

### 2026-06-17
- **feat(P0②): 380px 밀도 개선(크롬 압축)** — 필터바 2줄 wrap→**1줄 가로스크롤**(66→40px) + topbar 패딩·버튼·제목 압축(≤440 미디어쿼리). **실측(프리뷰, 헤드리스 아님)**: 크롬 41%→34%, 셀 49→55px, 칩 영역 14→20px, 가로 오버플로 없음. 참고: 코드리뷰의 '셀 40px'·헤드리스 캡처의 '토 열 잘림'은 실측(docW=vw=380)으로 **과장/캡처 아티팩트** 확인. nav+actions 1줄 merge는 '오늘' 버튼 희생이 필요해 비채택(2줄 유지).
- **feat(P0①): 멀티데이 기간 막대 연속 표시** — 기간 칩의 빈 mid/end 세그먼트가 콘텐츠 높이로 ~4px 붕괴해 '끊긴 회색 선'으로 보이던 것 → `.chip-range{height:19px;line-height:15px}` 고정 높이로 모든 세그먼트 균일화 → **연속 밴드**. 비겹침 기간은 `segSort`(기간 우선·seriesId)로 셀마다 같은 행에 정렬돼 셀 간 이어짐. **실측 캡처(헤드리스 Edge)로 확인**: 출장 9~13(초록)·감사 16~19(파랑) 끊김 없이 연속, 단일/시간 일정은 그 아래 행. (겹치는 부분 span의 lane 패킹은 드문 케이스라 미적용 — 필요 시 후속.)
- **tooling: 위젯 UI 실측 캡처 해결** — PrintWindow(PW_RENDERFULLCONTENT)가 WebView2(Chromium GPU/DirectComposition 표면)를 못 읽어 '검은 화면'이던 문제를, **헤드리스 Edge로 `task-calendar-prototype.html`을 실제 렌더해 `--screenshot`** 으로 우회. 재사용 스크립트 [tools/capture-widget.ps1](tools/capture-widget.ps1)(`-W -H -Out [-Demo]`). **핵심 함정: PowerShell 5.1 `Get-Content` 기본 디코딩이 CP949라 UTF-8 한글이 깨져 렌더 블랭크 → 반드시 `-Encoding UTF8` 읽기 + UTF8(no BOM) 쓰기.** `--virtual-time-budget`은 블랭크 유발하므로 미사용. 이제 코드가 아니라 실제 렌더로 UI/UX 평가/검증 가능(380px 위젯폭·1100px 넓게보기 둘 다 확인).
- **UI/UX 전문 리뷰 + 개선 1차** — 전체 리뷰([UIUX-리뷰-2026-06-17.md](UIUX-리뷰-2026-06-17.md), 워크플로 wpqf6dcyk; 점수 Calendar UX 4 최저) + 케이스별 Before/After 프로토타입([개선안-프로토타입.html](개선안-프로토타입.html)). 사용자 선택분 중 **저위험 3건(③⑥⑪) 구현**:
  - **③ 시간 일정 칩 시각 표시** — 컨테이너 쿼리 숨김(좁은 셀서 미발화) 폐기 → `chipTimeShort`(정시 'N시'/그 외 H:MM) 축약 시각을 **좁은 셀에서도 항상** 표시(9시/4시 구분 복원).
  - **⑥ 시맨틱 토스트 + 되돌리기** — `toast(msg,kind,action)`: success(✓녹)/warn(⚠앰버)/error(✕적)/info + role(status/alert) + Undo 액션. IO 실패(저장/내보내기/가져오기/커밋) → error. 파괴 동작(기록·할 일 삭제, 전체 초기화)에 **[실행 취소]**(제거 객체/스냅샷 클로저 보관 후 복원).
  - **⑪ Git 호출 로딩 스피너** — ⏳ 정지 이모지 → CSS `.spin`(reduced-motion 정지), 일괄은 '과제 k/N' 진행률.
  - 검증: chipTimeShort·timed칩 표시·토스트 3변형/role/Undo발동·스피너 애니·콘솔 무에러. **미적용(사용자 선택했으나 L공수 → 후속)**: P0 멀티데이 막대·380px 밀도. 미선택: P1 칩대비/오늘선택/선택통일/모달, P2 나머지.
- **feat: 위젯 리사이즈 8방향 완성(상단 두 모서리 추가)** — 위 좌·우·하단+하단 모서리에 더해 좌상(nw)·우상(ne) 모서리 핸들 추가, 좌/우 가장자리를 top:14로 올려 상단 모서리와 연결. 호스트 `resizemove`는 `edge.Contains("n")`로 이미 상단 지원(C# 변경 없음). 우상단 `✕`는 중앙 클릭 유지(모서리 14px만 — Windows 타이틀바 옆 모서리 리사이즈와 동일). 검증: 7핸들 위치/커서·✕ 중앙 클릭 유지.
- **feat: 위젯 리사이즈를 좌·우·하단 가장자리 + 하단 두 모서리로 확장** — 기존엔 우하단 그립 1곳만 가능해 불편. WebView2가 창을 100% 덮어 네이티브 리사이즈 테두리가 안 먹으므로 HTML 핸들 방식 유지하되, 5방향(`.rsz-w/-e/-s/-sw/-se`) 핸들 추가(상단은 호스트바=타이틀바라 제외=일반 창 규범). 좌/우 핸들은 호스트바 아래(34px)부터라 버튼과 안 겹침. 제스처에 `edge` 방향 전달(`__gBegin`/`__gMove`), 호스트 `resizemove`가 edge별로 left/top/right/bottom을 계산(끄는 변만 이동, 반대편 고정, min 크기 보장). 핀(부착) 여부와 무관하게 리사이즈 허용. 검증: 프리뷰서 5핸들 위치·커서(ew/ns/nesw/nwse) 정상, 빌드 컴파일 OK. 실제 드래그 리사이즈는 위젯 전용.
- **fix: 좁은 셀에서 시간 일정 칩 제목 깨짐 → 적응형(점+제목, 넓으면 시각 추가)** — A안(시간=점+굵은 시각)을 `display:flex`로 만들며 제목이 flex 텍스트 노드라 말줄임(…) 없이 하드 클립돼 "글씨 깨짐". 게다가 63px 셀에선 점+시각(27px)이 공간을 다 먹어 제목이 0px로 사라짐. 수정: 제목을 `.ctitle`(flex:1·min-width:0·ellipsis) span으로 감싸 깨끗이 말줄임 + `.chips`에 `container-type:inline-size` 부여해 **셀이 좁으면 시각 숨기고(점+제목 우선) 넓을 때(≥120px)만 시각 표기**(시각은 항상 툴팁에). 검증: 63px=시간숨김·제목28px 보임·하드클립 없음·fitChips 측정 정상(135px), 146px=점+17:00+제목 전체.
- **feat: 작업일지 기간 일괄 불러오기(즉시 자동 등록)** — 작업일지 탭에 `📥 기간 일괄 불러오기` 버튼 추가(단건 `📥 이 날 커밋`은 세밀 편집용으로 유지). 모달(`#bulkGitModal`): 범위 프리셋(이번주/지난주/이번달/지난달/직접 from~to, `setBulkRange`) + 과제 범위(전체 git 과제/특정 `#bgCat`) → `[불러오기 & 등록]`(`runBulkGitFetch`). 동작: 과제별로 호스트 `gitlog`를 since/until **범위**로 조회(백엔드 이미 지원) → 커밋을 **날짜별로 분류** → (과제·날짜)마다 작업일지(source=git) 생성/갱신(같은 날·과제는 커밋 교체 = **중복 없음**) → `과제 N·M일·K커밋` 요약 토스트. 사용자 선택 = 즉시 자동 등록. 검증: 등록 알고리즘 재현(2일 신규2→재실행 갱신2·중복0), 프리셋 날짜 계산, 모달/입력/함수 존재, 콘솔 무에러. 실제 git 호출 경로는 위젯(HOST) 전용.
- **fix: 그리드 "+0개 더보기" / 작업일지 필터 제거** — (1) `fitChips`가 `.chips`(내용물로 줄어듦)의 높이를 재 1칩짜리도 '안 들어간다'고 오판→바닥값 3 적용→숨김 0인데 더보기 버튼이 붙던 문제: `.chips{flex:1}`로 셀 가용 높이를 채워 정확히 측정 + `hidden>0`일 때만 버튼 렌더. (2) 더보기 무반응은 위 +0 버그 증상 — 진짜 오버플로는 클릭 시 그날 선택→우측 패널 전체 표시(정상). (3) 좌측 필터바의 `🔧 작업일지` 칩 제거 — 작업일지는 우측 '작업일지' 탭(날짜별)으로 일원화돼 그리드 필터는 무의미(`filterSource` 항상 null → git 기록은 그리드에 안 뜸).
- **fix: 트레이 모드 작업표시줄/Alt+Tab 버튼 브랜드 아이콘** — `Window.Icon` 미설정이라 트레이 모드(일반 앱 창)에서 작업표시줄 버튼이 빈 아이콘이던 문제. 브랜드 그리기를 `BuildBrandBitmap(size)`로 공용화하고 `ApplyWindowIcon()`(생성자 호출)으로 `Window.Icon` 설정(WPF가 small/big HICON 적용). 트레이 NotifyIcon도 동일 비트맵 사용. 검증: `WM_GETICON` small/big 둘 다 ≠0.
- **fix: 우측 패널 할 일 변이가 그리드에 즉시 반영** — `#dpBody`의 할 일 액션(삭제·완료토글·별표·편집저장)이 `renderPanel()`만 호출하고 `renderGrid()`를 빠뜨려 캘린더 체크칩이 안 갱신되던 문제. 다섯 변이 경로에 `renderGrid()` 추가(커밋 `83f328b`).
- **일정/할 일 그리드 가시성 개선** (UI/UX 평가 루프 wq04j4a32 기반, 케이스별 프로토타입 `가시성-개선-프로토타입.html`로 사용자 확인 후 구현). `task-calendar-prototype.html` 5케이스:
  - **A. 시간 vs 종일 구분** — 단일일 시간 일정 = 선행 색점(`.cdot`)+굵은 시각+투명 본체(`.chip-timed`), 종일 = 채운 색막대. (기간/반복/작업일지는 기존 막대 유지)
  - **B. 좁은 셀 가독성** — 칩 줄높이 1.25→1.35(`--lh-tight`, 한글 받침 안전).
  - **C. 칩 캡 동적화** — 셀당 고정 3개 → 셀 높이 기반 `fitChips()`(렌더 최대 12 → 들어갈 만큼 표시+나머지 `+N개 더보기`, **최소 3 보장**으로 좁은 셀 회귀 방지, resize 시 rAF 재계산). 380px=3칩 / 넓은 화면=4+칩.
  - **D. 주말/오늘/숫자** — 오늘 = 옅은 배경+얇은 링(꽉 찬 파랑 채움 폐기, 선택과 충돌 완화), 주말 컬럼 옅은 틴트(`.wknd-sun/.wknd-sat`), body `tabular-nums`, 주말색 AA(`--sun #c43a3f`/`--sat #4b62a0`).
  - **E. 파랑 단일화** — hover wash(`title-btn`/`dp-tab`/`nd-tab`/`more`)를 `--accent-soft`→중립 `--hover-bg`. 파랑은 primary 액션·선택·활성탭 전용.
  - 토큰 추가: `--lh-tight/--lh-body`, `--hover-bg`. 안정 베이스(렌더러·우측탭·보고서·드래그) 보존. 프리뷰 전수검증(콘솔 무에러). 평가 기준선: Calendar UX 6·접근성 5·Visual 7 → 가시성 항목 개선. 미착수 P0: 그리드 키보드 내비·본문 대비 AA(--muted-2)·다크모드·모달 포커스트랩(별도 트랙).

### 2026-06-16
- **인계 문서화** — README/SPEC/DEPLOY/ISSUES 최신화 + 본 CHANGELOG 신설(6/12 이후 문서 정체 해소).
- **창 모드 = 트레이 토글로 전환** — 트레이 ON이면 일반 앱 창(`WS_EX_APPWINDOW`+`ShowInTaskbar`, 최하위 강제 해제) → **작업표시줄/Alt+Tab 노출**, OFF면 기존 바탕화면 위젯. 조사 보고서(`창모드-조사-보고서.md`)로 "바탕화면 상주(항상 아래) ↔ Alt+Tab 호출은 상호 배타" 규명, 사용자 옵션 A(현행 결합) 선택. 메뉴 라벨 "트레이 아이콘 사용 (작업표시줄·Alt+Tab에 표시, 닫기→트레이)".
- **커밋 버튼 → 작업일지 탭** 이동 + **할일/일정 색-독립 구분** — todo 고정 초록 제거, 할 일 칩을 HOLLOW(투명+외곽선+선행 원형 링), 완료=링 채움+취소선+흐림. 같은 과제색이어도 채움/모양으로 구분(색맹 안전). 상용앱(Google·Apple·Notion·TickTick) 패턴.
- **우측 패널 3탭 모두 선택 날짜 종속 + 탭 유지** — 일정 상세/할 일/작업일지가 모두 `selectedDate`를 따르고, 날짜 클릭 시 탭 강제전환 안 함.
- **할 일 그리드 칩 + 기간(endDate) + 등록 일원화** — 기한 있는 할 일을 캘린더 칩으로(단일/기간 세그먼트), 인라인 추가 제거하고 quick-create로 일원화, 일정·할일 모두 기간 지원, 중요=할일 전용.
- **Google식 한 줄 빠른 캡처(quick-create)** — 모든 인간 생성 진입점을 경량 `#quickAdd`(일정/할일 토글+제목+날짜+과제, 옵션 더보기)로 통합. 16필드 entryModal은 편집 전용으로 강등. (근거: `근본원인-진단-등록흐름.md`)

### 2026-06-15
- **우측 패널 탭 뷰어** — `🗂 작업` 버튼/드로어 제거, `.day-panel`을 `[일정 상세 | 할 일 | 작업일지]` 세그먼트 탭으로 승격(+`📋 보고서` 액션). 380px에선 하단 시트. (근거: `UX-RESEARCH-우측뷰어탭.md`)
- **노트 IA 재설계 + TODO 고도화** — 평면 나열 폐기→마감축 구조화, ★중요 토글·"중요만" 필터·완료 섹션. todo 스키마 확장(due/prio/completedAt).
- **UI 정리(declutter)** — 상단 툴바 6→4 버튼(⋯ 오버플로 통합), 월 타이틀 강조, AA 대비, 선택 링.

### 2026-06-12
- **기간 + 반복 일정** — entry에 `endDate`·`recur{freq,interval,until,count}`·`recurExcept[]`. `expandOccurrences`로 그리드(세그먼트 칩)·패널·보고서 전개. 매월 31일 없는 달 건너뜀.
- **Git 커밋 → 작업일지 연동** — 과제별 `gitRepo` + 전역 `gitAuthor`로 `git log --author=나` 실행 → `source="git"` 기록(구조화 `commits[]`). **보고서 뷰**(기간 프리셋→과제별/날짜별 Markdown 초안→복사/저장).
- **트레이 + 포커스 모드("넓게 보기")** 도입. 더블클릭 버그·UI 스트레스 수정. (자세히는 `SPEC.md` §6~7)
- 바탕화면 배치 방식을 Progman reparent → **톱레벨 최하위(HWND_BOTTOM)** 도구창으로 변경(reparent 시 WebView2 흰 화면 회피).

### 2026-06-11
- 초기 구현 — 단일 HTML 프로토타입(과제/월그리드/기록/검색/과제별 모아보기/XML 내보내기·가져오기) + 자체 검증 루프(L1~L5) 통과. WPF+WebView2 위젯 셸. (`SPEC.md` §1~6)

---

## 🚧 미결 / 남은 일

- **[운영 이슈, 미결] 자동시작 경로 불일치** (`ISSUES.md` #1) — HKCU\Run이 옛 빌드 경로(`widget\bin\Release\...`)를 가리켜 로그인 시 옛 빌드가 단일인스턴스 뮤텍스를 선점 → 새 exe가 조용히 종료("계속 잠김"으로 체감). 근본원인 규명됨, **사용자가 수정 보류**. 조치: 자동시작 값을 배포 exe 경로로 교체(또는 ⚙에서 자동시작 껐다 켜기).
- **[창 모드, 선택지 보류] 옵션 B/C/D** (`창모드-조사-보고서.md`) — 사용자는 옵션 A(트레이 토글에 결합) 선택. 추후 원하면: B(작업표시줄표시/트레이숨김/Z순서/트레이아이콘 독립 토글), C(Rainmeter식 Z순서 항상위/일반/항상아래), D(전역 핫키 소환).
- **[로드맵]** 주간/일간 타임라인 뷰, 데스크톱 알림, 음력 명절(설·추석), 회차별 반복 편집(현재는 건너뛰기만), HTML 표 클립보드 복사(HWP/그룹웨어), 미완료 할 일 롤오버.
- **[보류 백로그]** 메일 탭(.eml 가져오기), 다크모드(인라인 색 → tint() CSS 변수화 선행 필요).

---

## ⚠️ 알아두면 좋은 함정 (재발 방지)

- 빌드 전 **두 프로세스명 모두 kill**(위 런북).
- HTML 변경은 **재빌드해야** 위젯 반영(EmbeddedResource).
- WPF 창을 Progman 자식으로 reparent하면 **WebView2 흰 화면** → 절대 복귀 금지(톱레벨 최하위 유지).
- 모든 텍스트 Enter 핸들러에 **IME 가드**(`ev.isComposing || ev.keyCode===229`) 필수(한글 조합 중 오발동 방지).
- 트레이 ON(일반 창)에서 **Win+D는 위젯도 최소화**되고 바탕화면 상주는 안 함(상호 배타 — `창모드-조사-보고서.md`).
- 프리뷰 **스크린샷은 이 환경에서 타임아웃** → `preview_eval`/`snapshot`/`inspect`로 검증.
