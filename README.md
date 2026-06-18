<div align="center">

# 📅 수행과제 캘린더 · TaskCalendar

**바탕화면에 상주하는 오프라인 데스크톱 캘린더 위젯 — 과제별 git 커밋으로 일/주 보고서까지 자동화**

[![Platform](https://img.shields.io/badge/Platform-Windows%2011-0078D6?logo=windows&logoColor=white)](#)
[![.NET](https://img.shields.io/badge/.NET-9.0%20WPF-512BD4?logo=dotnet&logoColor=white)](#)
[![WebView2](https://img.shields.io/badge/UI-WebView2%20%2B%20HTML-1E9BF0)](#)
[![Offline](https://img.shields.io/badge/Network-100%25%20Offline-2e9e6b)](#)
[![Data](https://img.shields.io/badge/Data-XML%20(open%20format)-e08a00)](#)
[![License](https://img.shields.io/badge/License-MIT-555)](LICENSE)

<img src="assets/screenshot.png" alt="수행과제 캘린더 — 월 그리드, 멀티데이 막대, 우측 일정/할 일/작업일지 패널" width="860">

</div>

---

## 소개

**수행과제 캘린더**는 인터넷 없이 동작하는 Windows 데스크톱 캘린더 위젯입니다. "수행 과제"를 카테고리로 두고 일정·할 일을 기록하며, 과제별 로컬 **git 저장소의 내 커밋을 끌어와 작업일지**로 만들고, 기간을 골라 **보고서(일간/주간) 초안**을 한 번에 뽑습니다. 데이터는 다른 소프트웨어에서도 읽기 쉬운 **XML**로 저장됩니다.

- 🔒 **완전 오프라인** — 외부 리소스·네트워크 호출 0개. 폐쇄망(망분리)에서 그대로 동작.
- 🖥️ **두 가지 창 모드** — 바탕화면 최하위 위젯(기본) ↔ 일반 앱 창(작업표시줄·Alt+Tab 노출, 트레이). ⚙에서 전환.
- 🧾 **보고서 자동화** — 과제별 git 커밋 → 작업일지 → 기간별 Markdown 보고서 초안.
- 🗂️ **개방형 데이터** — `taskCalendar` XML v1. 내보내기/가져오기로 백업·이전.
- ♿ **접근성(WCAG AA)** — 월 그리드 키보드 내비(방향키·PageUp/Down·Enter), 모달 포커스 트랩·복원, ARIA 탭/그리드, 가시 포커스 링.
- 🌗 **다크 모드** — OS 테마(`prefers-color-scheme`) 자동 전환. 단색 인라인 SVG 아이콘이 currentColor로 라이트/다크 모두 적응.

> 단일 HTML(`task-calendar-prototype.html`)을 **그대로 본체로 임베드**해 WPF + WebView2 위젯으로 패키징합니다. 브라우저에서 HTML만 열어도 동일하게 동작합니다(데이터는 localStorage).

> 📖 **사용 방법**: 기능별 상세 사용법·키보드 단축키·문제 해결은 **[USAGE.md (사용 설명서)](USAGE.md)** 참고.
> 📄 **이어서 작업하려면**: 현재 상태·빌드·배포·남은 일은 **[CHANGELOG.md](CHANGELOG.md)** (인계 문서)에 모여 있습니다.

## ✨ 주요 기능

- 🏷️ **수행 과제 관리** — 생성/수정/삭제, 색상, 과제별 **git 저장소 경로** 연결
- 🗓️ **월간 캘린더** — 월/연·월 점프, 양력 공휴일, 오늘 강조, **기간(다일) + 반복(매주/매월) 일정**(세그먼트 막대)
- ⚡ **한 줄 빠른 캡처(quick-create)** — 일정/할 일 토글 + 제목 + 날짜 + 과제(+옵션 더보기). 모든 등록 진입점이 여기로 일원화
- 🧩 **우측 패널 탭** — `[일정 상세 | 할 일 | 작업일지]`, 셋 다 **선택한 날짜**를 따라감. 380px에선 하단 시트
- ✅ **할 일(TODO)** — ★중요·완료 섹션·기한/기간, 캘린더에 **초록 체크 칩**으로 표시(일정 막대와 모양으로 구분)
- 🔧 **Git 커밋 → 작업일지** — 과제별 저장소에서 `내 커밋`을 끌어와 `source=git` 기록으로(구조화 커밋 목록)
- 📋 **보고서** — 기간 프리셋(오늘/이번주/지난주/이번달/지난달) → 과제별·날짜별 Markdown/텍스트 초안 → 복사/저장
- 🔍 **검색 / 과제별 모아보기** — 날짜별 그룹 + 하이라이트, 과제 필터 칩
- 🧲 **드래그 이동**, ↔️ **좌/우 너비 조절**, 🔳 **넓게 보기(포커스 모드)**
- 🖥️ **창 모드/트레이** — 바탕화면 위젯 ↔ 일반 앱 창(작업표시줄·Alt+Tab), 닫기→트레이 숨김
- ♿ **접근성** — 키보드 전용 조작(그리드 방향키 내비·탭 roving·모달 포커스 트랩/복원), WCAG AA 대비, aria-live 알림, ≥40px 터치 타깃(좁은 폭)
- 🌗 **다크 모드 · 단색 아이콘 시스템** — OS 테마 자동 전환, 전 표면 currentColor SVG 아이콘(단일 ICON 맵)
- 🔔 **피드백** — 동작별 토스트(성공·경고·오류)+**되돌리기**, 부팅 로딩 스켈레톤, 빈 상태 일러스트
- 💾 **XML 내보내기/가져오기**, 자동 시작(첫 실행 1회 질문)

## 🚀 시작하기

> **사전 요구**: **.NET 9 SDK**(또는 .NET 9 지원 **Visual Studio 2022 17.12+**). 폐쇄망이면 [.NET 9 SDK 오프라인 설치 파일](https://dotnet.microsoft.com/download/dotnet/9.0)(x64)을 USB로 반입해 1회 설치. WebView2 NuGet은 저장소에 동봉되어 오프라인 복원됩니다.

### ① 직접 빌드
```powershell
# 프레임워크 종속(대상 PC에 .NET 9 런타임 필요, 빠름)
dotnet publish widget\TaskCalendarWidget.csproj -c Release -o dist\app

# 자체포함 단일 exe(런타임 불필요, ~171MB) — 인터넷+런타임팩 캐시 있는 빌드 PC에서
dotnet publish widget\TaskCalendarWidget.csproj -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o dist\portable
```
- 결과 실행 → 바탕화면 위젯 시작. 배포/시작프로그램/단일 exe 상세는 **[DEPLOY.md](DEPLOY.md)**, 빌드·배포 런북은 **[CHANGELOG.md](CHANGELOG.md)** 참고.

### ② 브라우저로 바로 써보기 (빌드 없이)
- `task-calendar-prototype.html`을 더블클릭해 Edge로 열면 그대로 동작합니다(오프라인, 데이터는 localStorage).

## 🧩 사용법

| 동작 | 방법 |
|---|---|
| 새 일정/할 일 | 날짜 더블클릭 · 우측 패널 **＋ 추가** · 상단 **＋ 새 기록** → **빠른 캡처**(일정/할일 토글) |
| 상세(반복·시간·기간·메모) | 빠른 캡처의 **옵션 더보기**, 또는 카드 클릭 → 편집 모달 |
| 우측 패널 전환 | `[일정 상세 / 할 일 / 작업일지]` 탭 — 모두 선택한 날짜 기준 |
| Git 커밋 가져오기 | **작업일지 탭**의 `📥 이 날 커밋 가져오기`(과제에 git 경로 연결 필요, 위젯 전용) |
| 보고서 | 우측 패널 **📋 보고서** → 기간 선택 → 복사/저장 |
| 검색 / 과제별 | 상단 **🔍 검색** / 과제 필터 칩 |
| 창 모드 전환 | ⚙ → **트레이 아이콘 사용**(켜면 작업표시줄·Alt+Tab 노출 / 끄면 바탕화면 위젯) |
| 넓게 보기 | 호스트바 **🔳** (일시 확대·앞으로) |
| 위젯 이동/크기 | 📌 해제 후 상단 바 드래그 / 우하단 그립 · ⚙ 크기 프리셋·모니터 이동 |
| 백업/이전 | ⚙(⋯) → **XML 내보내기 / 가져오기** |

## 🗂️ 데이터 포맷

`%APPDATA%\TaskCalendar\data.xml` 에 `taskCalendar` XML v1으로 저장(식별/날짜/플래그는 속성, 자유 텍스트는 자식 요소). 전체 스키마는 **[SPEC.md](SPEC.md)**.

```xml
<taskCalendar version="1" gitAuthor="hong@corp">
  <categories>
    <category id="c-..." color="#3e5be0" gitRepo="D:\repos\report"><name>보고서 작성</name><description/></category>
  </categories>
  <entries>
    <entry id="e-..." date="2026-06-11" categoryId="c-..." allDay="false" startTime="10:00" endTime="11:30">
      <title>요구사항 정리</title><memo/>
    </entry>
    <entry id="e-..." date="2026-06-12" categoryId="c-..." source="git" allDay="true">
      <title>리팩터링</title><memo/><commits><commit hash="..." short="abc123" time="10:00">fix: ...</commit></commits>
    </entry>
    <entry id="e-..." date="2026-06-15" endDate="2026-06-19" categoryId="c-..." allDay="true">
      <title>출장</title><memo/><recur freq="weekly" interval="1"><except date="2026-06-26"/></recur>
    </entry>
  </entries>
  <todos>
    <todo id="t-..." done="false" categoryId="c-..." due="2026-06-16" prio="high"><text>보고서 초안</text><note/></todo>
  </todos>
</taskCalendar>
```

## 🏗️ 기술 스택 / 구조

- **UI/로직**: 의존성 없는 단일 HTML/CSS/JS (`task-calendar-prototype.html`)
- **위젯 셸**: WPF (.NET 9) + **WebView2**가 HTML을 창 100%로 호스팅 (`widget/`, UseWPF+UseWindowsForms)
- **데이터**: `taskCalendar` XML v1 (`%APPDATA%\TaskCalendar\`), 호스트 브리지로 저장
- **창 모드**: 톱레벨 최하위 도구창(바탕화면 위젯) ↔ 일반 앱 창(트레이 ON, 작업표시줄·Alt+Tab). Progman reparent는 WebView2 흰 화면 유발로 미사용
- 인계/이력: **[CHANGELOG.md](CHANGELOG.md)** · 명세/검증: **[SPEC.md](SPEC.md)** · 위젯 상세: **[widget/README.md](widget/README.md)**

## 🗺️ 로드맵

- [x] 기간 + 반복 일정 · [x] Git 커밋 → 작업일지 + 보고서 · [x] 할 일(TODO) · [x] 트레이/창 모드 · [x] 자체포함 단일 exe
- [x] **접근성(WCAG AA)** — 키보드 그리드 내비·모달 포커스 트랩·ARIA 탭/그리드·요약 aria-live
- [x] **다크 모드**(prefers-color-scheme) · **단색 SVG 아이콘 시스템** · 토스트+되돌리기 · 부팅 스켈레톤
- [x] 멀티데이 연속 막대(주별 레인) · 좁은 폭 바텀시트 모달
- [ ] 주간 / 일간 타임라인 뷰
- [ ] 데스크톱 알림
- [ ] 음력 명절(설·추석) 표시
- [ ] 회차별 반복 편집 · 미완료 할 일 롤오버
- [ ] 자동시작 경로 이슈 해소 (`ISSUES.md` #1)

## ⌨️ 접근성 · 키보드

마우스 없이 전체 조작 가능. 자세한 표는 [USAGE.md](USAGE.md#키보드-단축키).

| 영역 | 키 |
|---|---|
| 월 그리드 | `←/→` 일 이동 · `↑/↓` 주 이동 · `PageUp/Down` 월 이동 · `Home` 오늘 · `Enter/Space` 선택 |
| 전역 | `←/→`·`PageUp/Down` 월 이동 · `Home` 오늘 · `Esc` 모달/시트/넓게보기 닫기 |
| 우측 탭 | `←/→/Home/End` 탭 이동(roving) |
| 모달 | `Tab/Shift+Tab` 순환(포커스 트랩) · `Esc` 닫기 · 닫으면 호출 요소로 포커스 복원 |

- WCAG AA 대비(본문 ≥4.5:1), 가시 포커스 링, ARIA(grid·tab·dialog·status live region), `prefers-reduced-motion` 존중.

## 📄 라이선스

[MIT License](LICENSE) — 자유롭게 사용·수정·재배포 가능. 저작권자 표기만 유지.
