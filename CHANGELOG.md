# CHANGELOG · 인계 문서 — 수행과제 캘린더

> **목적**: 이 저장소만 받아도(작업 메모리 없이) **현재 상태 · 빌드 · 배포 · 남은 일**을 파악해 다른 세션/사람이 이어서 작업할 수 있게 한다. 최신 항목을 위에 둔다.
> 의사결정 근거 보고서: `근본원인-진단-등록흐름.md`, `UX-RESEARCH-우측뷰어탭.md`, `창모드-조사-보고서.md`(+`창모드-비교-시각.html`). 데이터/검증 명세: `SPEC.md`. 운영 이슈: `ISSUES.md`.

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
