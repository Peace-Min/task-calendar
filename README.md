<div align="center">

# 📅 수행과제 캘린더 · TaskCalendar

**바탕화면에 붙는 오프라인 데스크톱 캘린더 위젯**
업무 과제를 날짜별로 기록하고, 키워드·과제별로 다시 찾아보세요.

[![Platform](https://img.shields.io/badge/Platform-Windows%2011-0078D6?logo=windows&logoColor=white)](#)
[![.NET](https://img.shields.io/badge/.NET-9.0%20WPF-512BD4?logo=dotnet&logoColor=white)](#)
[![WebView2](https://img.shields.io/badge/UI-WebView2%20%2B%20HTML-1E9BF0)](#)
[![Offline](https://img.shields.io/badge/Network-100%25%20Offline-2e9e6b)](#)
[![Data](https://img.shields.io/badge/Data-XML%20(open%20format)-e08a00)](#)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](#-라이선스)

<img src="assets/screenshot.png" width="720" alt="수행과제 캘린더 위젯 스크린샷">

</div>

---

## 소개

**수행과제 캘린더**는 인터넷 없이 동작하는 Windows 데스크톱 캘린더 위젯입니다.
"수행 과제"를 카테고리로 등록하고, 날짜를 클릭해 기록을 남기고, 나중에 **키워드** 또는 **과제별**로 전체 기록을 다시 찾아볼 수 있습니다. 데이터는 다른 소프트웨어에서도 읽기 쉬운 **XML**로 저장되어 확장·이전이 자유롭습니다.

- 🔒 **완전 오프라인** — 외부 리소스·네트워크 호출 0개. 폐쇄망에서 그대로 동작.
- 🖥️ **바탕화면 위젯** — 로그인 시 자동 상주, 바탕화면에 부착(아이콘처럼 항상 그 자리), 일반 앱 뒤로 깔림.
- 🗂️ **개방형 데이터** — `taskCalendar` XML v1. 내보내기/가져오기로 백업·이전.

> 단일 HTML 프로토타입(`task-calendar-prototype.html`)을 **그대로 본체로 임베드**해 WPF + WebView2 위젯으로 패키징했습니다. 브라우저에서 HTML만 열어도 동일하게 동작합니다.

## ✨ 주요 기능

- 🏷️ **수행 과제 관리** — 과제 생성/수정/삭제, 색상 지정, 과제별 기록 수 표시
- 🗓️ **월간 캘린더** — 월 이동·오늘·연·월 점프, 양력 공휴일 표시, 오늘 강조
- ✍️ **기록 작성** — 날짜 클릭/더블클릭 → 제목·과제·시간(종일/시간)·메모 입력
- 🔍 **키워드 검색** — 제목·메모·과제명에서 찾아 **날짜별 그룹 + 하이라이트**, 클릭 시 해당 날짜로 이동
- 📚 **과제별 모아보기** — 특정 과제의 전체 기록을 시간순 + 기간 요약으로 한눈에
- 🧲 **드래그 이동** — 일정 칩을 다른 날짜로 끌어 이동
- ↔️ **좌/우 너비 조절** — 캘린더와 기록 패널 사이 분할바로 비율 조절(저장됨)
- 📌 **바탕화면 부착** — 부착 시 제자리 고정(이동 잠금), 해제하면 자유 이동·크기 조절
- 💾 **XML 내보내기/가져오기** — 기계가독 포맷으로 백업·다른 PC 이전
- 🌙 양력 공휴일 내장 (음력 명절은 로드맵)

## 🖥️ 스크린샷

<div align="center">
<img src="assets/screenshot.png" width="760" alt="좌측 캘린더 · 분할바 · 우측 기록 패널">
</div>

## 🚀 시작하기

> **사전 요구**: **.NET 9 SDK** (또는 .NET 9을 지원하는 **Visual Studio 2022 17.12 이상**).
> 폐쇄망이면 [.NET 9 SDK 오프라인 설치 파일](https://dotnet.microsoft.com/download/dotnet/9.0)(x64)을 USB로 반입해 1회 설치하면 됩니다. WebView2 NuGet 패키지는 **저장소에 동봉**되어 인터넷 없이 복원됩니다.

### ① 직접 빌드 (권장)
clone 후 셋 중 편한 방법으로:
```powershell
# 방법 A — 원클릭: build.cmd 더블클릭 → dist\app\TaskCalendarWidget.exe 생성
# 방법 B — 명령줄:
dotnet publish widget\TaskCalendarWidget.csproj -c Release -o dist\app
# 방법 C — Visual Studio: TaskCalendarWidget.sln 열고 Release 빌드
```
- 결과: `dist\app\TaskCalendarWidget.exe` 실행 → 바탕화면 위젯 시작. (exe 하나만 떼지 말고 폴더째 두세요)
- 배포·다른 PC 이전·시작프로그램 등록·단일 exe(인터넷 PC) 는 **[DEPLOY.md](DEPLOY.md)** 참고.

### ② 브라우저로 바로 써보기 (빌드 없이)
- `task-calendar-prototype.html` 을 더블클릭해 Edge로 열면 캘린더가 그대로 동작합니다(오프라인).

## 🧩 사용법

| 동작 | 방법 |
|---|---|
| 새 기록 | 날짜 더블클릭, 또는 우측 패널 **+ 추가** / 상단 **+ 새 기록** |
| 기록 수정/삭제 | 칩 클릭 또는 우측 카드의 **수정/삭제** |
| 다른 날짜로 이동 | 일정 칩을 다른 날짜 칸으로 드래그 |
| 검색 | 상단 **🔍 검색** → 키워드 / 과제별 탭 |
| 과제 관리 | 상단 **🏷️ 과제 관리** |
| 좌/우 너비 | 캘린더-기록 패널 사이 **세로 분할바 드래그** |
| 위젯 이동 | 📌 부착 해제 후 상단 바 드래그 (부착 중엔 잠금) |
| 위젯 크기 | 우하단 그립 드래그 (부착/해제 모두) |
| 백업/이전 | 상단 **💾 데이터 → XML 내보내기 / 가져오기** |

## 🗂️ 데이터 포맷

기록은 `%APPDATA%\TaskCalendar\data.xml` 에 `taskCalendar` XML v1으로 저장됩니다(식별/날짜/시간은 속성, 자유 텍스트는 자식 요소). 스키마와 설계는 **[SPEC.md](SPEC.md)** 참고.

```xml
<taskCalendar version="1">
  <categories>
    <category id="c-..." color="#3e5be0"><name>보고서 작성</name><description>주간 보고서</description></category>
  </categories>
  <entries>
    <entry id="e-..." date="2026-06-11" categoryId="c-..." allDay="false" startTime="10:00" endTime="11:30">
      <title>프로토타입 요구사항 정리</title><memo>키워드 검색 포함</memo>
    </entry>
  </entries>
</taskCalendar>
```

## 🏗️ 기술 스택 / 구조

- **UI/로직**: 의존성 없는 단일 HTML/CSS/JS (`task-calendar-prototype.html`)
- **위젯 셸**: WPF (.NET 9, `net9.0-windows`) + **WebView2** 가 HTML을 100% 채워 호스팅 (`widget/`)
- **데이터**: `taskCalendar` XML v1 (`%APPDATA%\TaskCalendar\`)
- **부착**: 창을 바탕화면(Progman)의 자식으로 붙여 Win+D에도 잔존하며 조작 가능
- 자세한 검증 기록(자체 테스트 루프·멀티에이전트 리뷰): **[SPEC.md](SPEC.md)**, 위젯 상세: **[widget/README.md](widget/README.md)**

## 🗺️ 로드맵

- [ ] 주간 / 일간 뷰
- [ ] 반복 일정
- [ ] 데스크톱 알림
- [ ] 음력 명절(설·추석) 표시
- [ ] 자체 포함 단일 exe 자동 빌드(릴리스 워크플로)

## 🤝 기여

이슈와 PR을 환영합니다. 변경 시 소스만 커밋되며(빌드 산출물은 `.gitignore` 제외), 위젯 변경은 `dotnet build`로 빌드가 통과하는지 확인해 주세요.

## 📄 라이선스

MIT License 사용을 권장합니다. (저장소 루트에 `LICENSE` 파일 추가 권장 — 다른 라이선스를 원하면 교체하세요.)
