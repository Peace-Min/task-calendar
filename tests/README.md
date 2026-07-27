# tests/ — 수행과제 캘린더 테스트 하네스

2층 구조 — **Layer 1(순수 함수)** 은 의존성 0(Node 내장만, `npm install` 없이 실행), **Layer 2(app-context: XML 왕복·보고서 생성)** 는 jsdom이 실제 앱을 부팅해 검증하는 **test-only devDependency**. jsdom 미설치 시 Layer 2는 graceful-skip(러너는 여전히 green). **배포 산출물(폐쇄망 반입 exe/HTML)은 그대로 의존성 0** — jsdom은 오직 테스트에서만.
지금까지 손으로 하던 검증을 재사용 가능한 자동 테스트로 옮긴 것. Layer 2를 돌리려면 `cd tests && npm ci`(CI가 자동 수행).

## 실행

```
node tests/run-tests.mjs
```

프로젝트 루트(`task-calendar/`)에서 실행. 전부 통과하면 exit 0, 하나라도 실패하면 exit 1.

## 구조

```
tests/
├─ run-tests.mjs              러너 — tests/*.test.mjs 전부 import 후 run() 호출, 결과 요약·실패 시 exit 1
├─ harness.mjs                공용 하네스(test/run, loadAppSource, extractFunction, FakeDoc)
├─ harness-selftest.test.mjs  하네스 자체 검증 테스트
├─ loop-ui-integrity.mjs      ★ 별도 실행 전용(라이브 위젯+MySQL 필요) — 아래 참조
├─ loop-ui-visual.mjs         ★ 별도 실행 전용(라이브 위젯 필요·읽기 전용) — 레이아웃 결함 검출, 아래 참조
├─ fixtures/
│  ├─ mock-pjm-daily.html     netcus 일간보고 폼 모의(pjm_work_view.jsp) — 필드명 실제와 동일
│  └─ mock-pjm-weekly.html    netcus 주간보고 폼 모의(pjm_write.jsp) — 필드명 실제와 동일
└─ README.md                  이 파일
```

## loop-ui-integrity.mjs — 루프 UI 정합성 테스트(실배포 전 게이트)

기본 스위트에 **포함되지 않는다**. 러너가 `*.test.mjs`만 수집하므로 확장자가 `.mjs`인 이 파일은 자동수집에서 빠진다.
(→ 이 파일을 `*.test.mjs`로 개명하면 CI가 라이브 위젯·MySQL을 요구하게 되어 깨진다. 개명 금지.)

실행 중인 위젯에 CDP로 붙어 **실제 DOM을 클릭·입력**해 구분/상태·발주처를 무작위 반복 편집하고,
매 조작마다 MySQL을 직접 조회해 정합성 불변식(FK·무손실·CASCADE·숨김보존·정렬·UI↔DB·하드삭제·오프라인 불변)을 검사한다.
중간에 DB 계정을 잠가 온라인→오프라인→온라인 전환(A: 알려진 오프라인 / B: 오프라인 열람 / C: stale-online)을 주입한다.

**DB 관리자 자격은 환경변수로만 받는다**(소스에 비번을 두지 않는다 — 이 파일들은 커밋된다).
`TC_TEST_DB_ADMIN_PW`가 없으면 실행을 거부한다. 계정명 기본값은 `root`, 다르면 `TC_TEST_DB_ADMIN_USER`(또는 `--admin-user=`).
계정 잠금(오프라인 시뮬레이션)과 하드삭제 검사에 DDL/계정 권한이 필요하다.

```
# 사전: 위젯을 TC_DEBUG_PORT=9222로 띄우고, 관리자 인증(adminUnlocked)을 해 둔 상태여야 한다.
#       PowerShell:  $env:TC_TEST_DB_ADMIN_PW = '<DB 관리자 비번>'
node tests/loop-ui-integrity.mjs                 # 60조작, 고정 시드
node tests/loop-ui-integrity.mjs --ops=120 --seed=42
node tests/loop-ui-integrity.mjs --selfcheck     # 위젯 없이 DB 계층만 읽기 전용 점검
node tests/loop-ui-integrity.mjs --no-offline    # 계정 잠금 권한이 없을 때
```

시드 고정 RNG라 `--seed`/`--ops`가 같으면 시퀀스가 그대로 재현된다. 위반 0이면 exit 0, 아니면 1.
**데이터를 바꾸는 테스트**다(코드값·발주처 추가/개명/숨김). 실행 전 `taskmgr` 스냅샷을 확보할 것 — 스크립트는 스스로 복원하지 않는다.
단, 오프라인 시뮬레이션으로 건 `ACCOUNT LOCK`은 중단·예외 시에도 종료 훅에서 반드시 해제한다.

## loop-ui-visual.mjs — 실제 화면 기반 UI 루프 테스트(레이아웃 결함 검출)

기본 스위트에 **포함되지 않는다**. 러너가 `*.test.mjs`만 수집하므로 확장자가 `.mjs`인 이 파일은 자동수집에서 빠진다.
(→ 이 파일을 `*.test.mjs`로 개명하면 CI가 라이브 위젯을 요구하게 되어 깨진다. **개명 금지**.)

`loop-ui-integrity.mjs`가 **데이터 정합성**(DB↔UI 값)을 본다면, 이쪽은 **레이아웃**을 본다.
실제로 나온 결함이 그쪽이었기 때문이다 — 공식 과제 상세 액션 바가 `필요 275px vs 가용 274px`로 1px 모자라
통째로 두 줄로 밀렸고, 재연결 픽커는 값이 밀려 잘렸다. 둘 다 **우연히** 발견됐다.

실행 중인 위젯에 CDP로 붙어 뷰포트(`Emulation.setDeviceMetricsOverride`)·테마(`applyTheme`)·화면(앱의 `open*` 함수)·
데이터(`__applyProjects`로 **화면에만** 더미 주입)를 조합해 순회하고, 각 상태에서 DOM을 훑어 아래를 판정한다.

| 코드 | 검사 | violation 기준(오탐 억제) |
|---|---|---|
| V1 | 가로 스크롤 | `overflow-x:auto/scroll`인데 실제로 넘침. `#filterbar`·`.ovf-scroll`은 의도된 가로 스크롤이라 예외 |
| V2 | 텍스트 잘림 무표시 | 잘리는데 `text-overflow:ellipsis`도 `title`도 없음(조상 title 포함 확인) |
| V3 | 액션 바 줄바꿈 | 버튼 행이 접혔고 **부족분 ≤ max(16px, 가용폭 6%)** — 크게 넘치면 설계 판단이라 warn |
| V4 | 형제 겹침 | 박스 요소(비인라인)끼리 25% 이상 교차. 절대/음수마진/transform/인라인은 제외 |
| V5 | 컨테이너 이탈 | 모달 rect 밖으로 나간 인터랙티브 요소(세로는 스크롤 조상이 없을 때만) |
| V6 | 보이지만 크기 0 | `checkVisibility` 통과인데 width/height 0 |
| V7 | 터치 타깃 과소 | 높이 <24px. **≤440px 구간만 violation**(앱이 스스로 40/38/32px 하한을 세운 구간), 그보다 넓으면 warn |
| V8 | 대비(AA) | 4.5:1(큰 글씨 3:1) 미만. 배경은 조상까지 합성해 계산, 이미지·반투명 조상은 **판정 불가**로 분리 |
| V9 | 모달 세로 넘침 | 뷰포트를 넘는데 스크롤 가능한 자손이 없음 |
| V10 | 빈 상태 문구 부재 | 목록 0건인데 안내 문구도 없음 |

```
# 사전: 위젯을 TC_DEBUG_PORT=9222로 띄워 둘 것(이 스크립트는 위젯을 실행하지 않는다).
node tests/loop-ui-visual.mjs                       # 기본 계획(576상태)
node tests/loop-ui-visual.mjs --widths=320,400 --themes=light,dark
node tests/loop-ui-visual.mjs --screens=officialModal.subbed --shot-all
node tests/loop-ui-visual.mjs --selftest            # 검출기 자체 검증(일부러 깨진 마크업을 심어 V1~V10 확인)
```

**읽기 전용이다** — MySQL을 아예 건드리지 않고, 시작 시 `window.save`를 스텁으로 바꿔 디스크(`data.xml`)에도 쓰지 않는다.
종료(예외·Ctrl+C 포함) 시 테마·카탈로그·편입 목록·뷰포트를 원래대로 되돌린다.
위반 상태는 `dist/ui-shots/<폭>x<높이>-<테마>-<화면>-<데이터>.png`로 캡처한다(`dist/`는 gitignore). 위반 0이면 exit 0.

조합 축소 규칙(계획 로그에 매번 출력된다): **폭×테마는 전수**, 데이터 변형은 대표 폭/테마/데이터 민감 화면만,
최소 높이(320px)는 폭 2종×light만. 무엇을 줄였는지 실행할 때마다 로그에 남으므로 무음 축소는 없다.

## 하네스 API (harness.mjs)

- `test(name, fn)` / `run()` — 테스트 등록·일괄 실행. `fn`은 sync/async 모두 가능.
  실패 시 이름+스택 출력, 요약(`N pass / M fail`), fail>0이면 `process.exitCode=1`.
- `assert` — Node `node:assert` 재수출(편의).
- `loadAppSource()` — `../task-calendar-prototype.html`을 UTF-8 텍스트로 반환.
- `extractFunction(source, fnName)` — 소스에서 `function fnName(...){...}` 선언을 중괄호 짝 맞춰
  잘라 문자열로 반환(문자열·템플릿 리터럴·주석 내부 중괄호 무시). 못 찾으면 에러.
  앱의 순수 함수를 eval 기반 단위테스트할 때 사용.
- `FakeDoc(fixtureHtml)` — 브라우저 없는 Node에서 폼 채우기 로직을 검증하는 초경량 가짜 DOM.
  - `getElementsByName(name)` → 배열(없으면 `[]`)
  - `querySelector('input[type=password]')` → 요소 또는 `null`(그 외 셀렉터는 null)
  - `createElement` / `appendChild` → 에러 안 나게 시늉만
  - 요소: `{ tagName, name, type, value(get/set) }`. select는 `options[{value,text}]`,
    `selectedIndex`(set 시 value 동기화), value set 시 일치 option 있으면 selectedIndex 동기화.

## 작성 규칙

- 테스트 파일은 `*.test.mjs` — 러너가 자동 수집(이름순).
- 각 파일은 `harness.mjs`에서 `test`/`assert` 등을 import하고 `test(name, fn)`으로 등록만 한다.
  `run()`은 러너가 한 번만 호출하므로 테스트 파일에서 부르지 말 것.
- 앱 본체(`task-calendar-prototype.html`)는 **수정하지 않는다** — 소스를 읽어 검증만 한다.
- 주석은 이 리포 관례대로 한국어로 간결하게.
- fixture의 **필드명은 실제 netcus 폼과 동일**해야 한다(값이 아니라 name 속성이 계약).
