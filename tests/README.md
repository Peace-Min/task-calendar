# tests/ — 수행과제 캘린더 테스트 하네스

2층 구조 — **Layer 1(순수 함수·소스 텍스트)** 은 의존성 0(Node 내장만, `npm install` 없이 실행), **Layer 2(app-context: XML 왕복·보고서 생성 등)** 는 jsdom이 실제 앱을 부팅해 검증하는 **test-only devDependency**. jsdom이 없으면 Layer 2는 **skip(판정 없음) → exit 2**다. 초록이 아니다. **배포 산출물(폐쇄망 반입 exe/HTML)은 그대로 의존성 0** — jsdom은 오직 테스트에서만.
지금까지 손으로 하던 검증을 재사용 가능한 자동 테스트로 옮긴 것. Layer 2를 돌리려면 `cd tests && npm ci`(CI가 자동 수행).

## 실행

```
node tests/run-tests.mjs
```

저장소 루트에서 실행. 요약은 `N pass / M fail / K skip` 이고, skip이 있으면 **사유별 집계**가 한 줄 더 붙는다(예: `skip 4 — jsdom 미설치: 4`).

### 종료코드

| 코드 | 뜻 | 사람이 할 일 |
|---|---|---|
| `0` | 전부 통과 · skip 0 | 없음 |
| `1` | **실패**(fail>0). `TC_TEST_STRICT=1` 이면 skip도 여기로 | 코드·설계를 본다 |
| `2` | **판정 없음**(fail 0인데 skip>0) — 그만큼은 아예 돌지 않았다 | **환경**을 본다(의존성 설치) |

`loop-*.mjs`·`calendar-adapter.mjs` 가 쓰는 0/1/2 규약과 같은 뜻이다(아래 각 절의 「종료코드」).
**`2`를 통과로 읽지 말 것.**

> **왜 생겼나.** 옛 판은 jsdom이 없으면 Layer 2 파일마다 *빈 함수*를 `test()` 로 등록해
> 「생략」이라는 이름의 **통과 1건**을 만들었다. 실측(2026-09-02): jsdom을 막으면
> `820 pass` → `598 pass + 가짜 통과 4건`, **fail 0 · exit 0** — 222건이 조용히 사라진 채 초록이었다.
> 지금은 같은 상황에서 `598 pass / 0 fail / 4 skip` · **exit 2** 가 나온다.

### 환경변수

| 변수 | 효과 |
|---|---|
| `TC_TEST_STRICT=1` | **skip을 fail로 취급** → exit 1. 릴리스 게이트가 켜는 스위치다(「돌지 않았다」를 통과로 읽지 않기 위해) |
| `TC_TEST_FORCE_MISSING=jsdom` | 설치돼 있어도 없는 척한다. **게이트 자체를 시험하는 주입구**(`loop-*.mjs` 의 `TC_TEST_INJECT_TRUNC` 와 같은 관례). 쉼표로 여러 개 |

```powershell
node tests/run-tests.mjs                                     # 정상 → 0
$env:TC_TEST_FORCE_MISSING='jsdom'; node tests/run-tests.mjs # jsdom 부재 재현 → 2
$env:TC_TEST_STRICT='1';            node tests/run-tests.mjs # 위 + 엄격 → 1
Remove-Item Env:TC_TEST_FORCE_MISSING, Env:TC_TEST_STRICT
```

### ★ `tests/node_modules` 는 심링크다 (환경 사실 — 고치지 말 것)

이 워크트리(`task-calendar-db/`)의 `tests/node_modules` 는 main 워크트리
`console/task-calendar/tests/node_modules` 를 가리키는 **디렉터리 심링크**다(실물은 하나, 공유).
지우거나 이름을 바꾸면 **main 워크트리의 테스트가 함께 죽는다**.

그래서 **새 클론·폐쇄망 반입 PC에는 jsdom이 없다** — 거기서는 상시 exit 2 가 정상이다.
채우는 방법은 두 가지뿐이다.

- 개발 PC: `cd tests && npm ci`
- 폐쇄망: 같은 Node 버전 PC에서 만든 `tests/node_modules` 를 통째로 반입(레지스트리 접근 없음)

jsdom이 없으면 러너가 이 세 줄을 요약 뒤에 직접 찍는다(사람이 문서를 찾아 헤매지 않도록).

## 구조

```
tests/
├─ run-tests.mjs              러너 — tests/*.test.mjs 전부 import 후 run() 호출, 결과 요약·종료코드(0/1/2)·jsdom 부재 힌트
├─ harness.mjs                공용 하네스(test/skip/run, importOptional, loadAppSource, extractFunction, FakeDoc)
├─ harness-selftest.test.mjs  하네스 자체 검증 테스트
├─ canon-schema.mjs           정본 파서 헬퍼 — `db/deploy/schema-calendar.sql` 에서 판번호·허용 코드 목록을 읽는다(러너 미수집)
├─ ps-guard-lib.mjs           배포 스크립트(db/deploy/*.ps1) 소스 검사 공용 기계 — restore/backup-guards 가 공유(러너 미수집)
├─ schema-integrity.test.mjs  접속 프리앰블·소유자 FK·보고 표 CHECK·공수 상한·cat_no FK·판본 정합 계약 + 변이
├─ *.test.mjs                 기본 스위트 — 러너가 이름순으로 자동 수집한다(목록은 파일 시스템이 정본)
├─ ── 아래는 ★ 별도 실행 전용(`.mjs`라 자동수집에서 빠진다. 개명 금지) ──
├─ loop-ui-integrity.mjs      라이브 위젯(CDP) + MySQL — 구분/상태·발주처 무작위 편집 + 매 조작 DB 불변식
├─ loop-ui-visual.mjs         라이브 위젯 · 읽기 전용 — 레이아웃 결함 검출
├─ loop-org-compat.mjs        MySQL(복제본) — org_unit 완전 절단 루프
├─ loop-calendar-write.mjs    라이브 위젯 + MySQL(복제본) — 캘린더 쓰기 경로 루프
├─ loop-conflict-ui.mjs       라이브 위젯(CDP) + MySQL — 충돌 안내의 실동작: 충돌이 화면에 뜨는가 ·
│                            재시도하지 않는가 · DB 를 덮지 않는가 · 되돌릴 문이 있는가
├─ loop-user-admin.mjs        **실제 위젯**(CDP) + 실 DB — 사용자 관리(USER-ADMIN) 실동작: 등록·수정·권한·퇴사·복구·순서 저장 ·
│                            잠금 방지·검증 5종·null 정수 내성·비관리자 뷰·재진입 가드 — 케이스마다 DB 불변식, zzU 잔재 0
├─ loop-report-wiring.mjs     라이브 위젯 + MySQL(복제본) — 보고 기록 배선("저장이 정말 불리는가")
├─ loop-peer-view.mjs        실 DB + 앱 계정 — **타인 일정 열람의 권한 경계**(허용/거부/최소 payload)
├─ loop-peer-frame.mjs       **실 위젯**(CDP) + 실 DB — 열람 **창**(iframe)의 실동작: 그 사람 것이 뜨나 ·
│                            postMessage 를 한 번도 안 부르나(봉인) · 게이트 없나 · rev/행수 불변 · 프레임 정리
├─ loop-import-ui.mjs        **실제 위젯**(CDP) + 실 DB — 「XML 가져오기」 실동작(교체·병합 왕복)
├─ loop-schema-gate.mjs     **실제 위젯**(CDP) + 실 DB — P1-1 스키마 게이트·P1-2 부팅 재시도·P1-8 개명 가드 회귀
├─ calendar-adapter.mjs       MySQL + .NET SDK(복제본) — DB 읽기 계층 대조(어댑터 계약 G)
├─ migrate-tool.mjs           이관 도구(`db/deploy/xml-to-db`) 왕복 대조
├─ dryrun-xml-to-db.mjs       이관 예행연습 — 실제 `data.xml`을 읽어 이관 전 필수 조치를 찾아낸다
├─ fixtures/
│  ├─ mock-pjm-daily.html     netcus 일간보고 폼 모의(pjm_work_view.jsp) — 필드명 실제와 동일
│  └─ mock-pjm-weekly.html    netcus 주간보고 폼 모의(pjm_write.jsp) — 필드명 실제와 동일
└─ README.md                  이 파일
```

> **별도 실행 스크립트의 정본은 이 목록이 아니라 `tests/*.mjs` 중 `*.test.mjs`가 아닌 파일들**이다(`harness.mjs`·`run-tests.mjs` 제외). 여기 없는 파일이 보이면 이 표가 뒤처진 것이다 — 실제로 2026-09-02까지 넷만 적혀 있었다.
> 아래 개별 절이 있는 것은 그중 일부다. 절이 없는 스크립트는 **파일 머리말이 사용법의 정본**이다.

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
# 사전: 위젯을 TC_DEBUG_PORT=9222로 띄우고, **edit_role이 editor/admin인 계정으로 로그인**해 둘 것.
#       (이 스크립트는 로그인 UI 왕복을 하지 않는다 — 로그인 상태인지 확인만 하고 아니면 중단한다.
#        옛 '관리자 인증(adminUnlocked)'은 v0.17.0에서 폐지됐다. 권한은 app_user.edit_role이 정한다.)
#       PowerShell:  $env:TC_TEST_DB_ADMIN_PW = '<DB 관리자 비번>'
node tests/loop-ui-integrity.mjs                 # 60조작, 고정 시드
node tests/loop-ui-integrity.mjs --ops=120 --seed=42
node tests/loop-ui-integrity.mjs --selfcheck     # 위젯 없이 DB 계층만 읽기 전용 점검
node tests/loop-ui-integrity.mjs --no-offline    # 계정 잠금 권한이 없을 때
```

시드 고정 RNG라 `--seed`/`--ops`가 같으면 시퀀스가 그대로 재현된다. 위반 0이면 exit 0, 아니면 1.
**데이터를 바꾸는 테스트**다(코드값·발주처 추가/개명/숨김). 실행 전 `taskmgr` 스냅샷을 확보할 것 — 스크립트는 스스로 복원하지 않는다.
단, 오프라인 시뮬레이션으로 건 `ACCOUNT LOCK`은 중단·예외 시에도 종료 훅에서 반드시 해제한다.

### 시험 행 정리 — 2026-09-07
- 이 러너가 만드는 임시값(`zzT<seed>_*`·`zzC<seed>_*`, 개명 중간의 `_zzR<seed>`)은 **어느 경로로 끝나든** 걷어낸다:
  시작 시 **선행 정리**(이전 실행이 강제 종료돼 남긴 것) → 정상 종료 시 재수렴 **앞**에서 정리 → 예외·신호·`exit` 핸들러에서도 정리.
  `kill -9` 는 어떤 핸들러도 못 받으므로 선행 정리가 있어야 닫힌다(실측: 5초에 kill → 3건 잔재 → 다음 실행이 3건 걷고 exit 0).
- 정리 뒤에는 위젯의 드롭다운 소스(`offSections` 등)를 `loadCodes/loadCustomers` 로 **다시 조회**시킨다 — `#dbReload` 로는 안 새로워진다.
  안 하면 다음 실행 op#1 의 I6 가 지운 이름을 든 유령 목록과 비교해 운다(실측).
- 잔여 임시값은 요약에 **출력만 하지 않고 위반(FIN)** 이다. 2026-09-07 까지 개발 DB 에 18건이 조용히 쌓여 있었다 — 정상 실행도 I7 이 표당 1건만 지워 매번 ~12건을 남기고 있었다.
- project 가 참조 중인 임시값(FK 1451)은 지우지 않고 보고한다.

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

## loop-org-compat.mjs — org_unit 완전 절단 루프 테스트

기본 스위트에 **포함되지 않는다**. 러너가 `*.test.mjs`만 수집하므로 확장자가 `.mjs`인 이 파일은 자동수집에서 빠진다.
(→ 이 파일을 `*.test.mjs`로 개명하면 CI(ubuntu-latest)가 MySQL을 요구하게 되어 깨진다. **개명 금지**.)

`org_unit`의 PK를 `name` → `org_id`로 옮기면서 **구 컬럼을 미러로 남기지 않고 잘라낸다**(2026-08-24 방향 전환).
직전 판(확장-수축 A단계)은 `org_unit.parent`·`app_user.org_unit`을 이름 미러로 남겨 배포된 v0.17.1 89대를 살렸는데,
그 미러가 **DB가 아무것도 검증하지 않는 중복 상태**라 적대검증 결함의 절반이 거기서 나왔다.
완전 절단의 근거는 실측이다 — 부팅 경로(`userSessionGet`)는 로컬 세션 파일만 읽고 DB를 안 보며(MainWindow.xaml.cs:1578),
세션에 만료(TTL)가 없다(UserSession.cs). 미러를 지우면 배포본 6문 중 **S1(과제 편집 권한 관문)은 생존**하고
S2~S6만 `ERROR 1054`로 죽는다 — **쓰기 문장이 없어 데이터 손상 위험 0**이고, 깨지는 것은 조회 화면 둘뿐이다.

증명하는 명제 하나: **조직에 무슨 짓을 해도 트리는 건강하고, 신버전 앱이 받는 payload가 정확하다.**
무작위 조작 루프(개명 리프/본부/루트·신설·이관·숨김/살림·인사이동·정렬변경)로 두들기며 매 조작마다 전 불변식을 본다.
★ 절단 뒤에는 **모든 조작이 1문장**이다(미러 판에서는 개명·이관·인사이동이 전부 2문장이었고 그 둘째 문장이 결함의 온상이었다).

| 코드 | 검사 | violation 기준 |
|---|---|---|
| I0 | 스키마 계약 | 확정 설계와 다르면 **루프 전에 중단**. 있어야 할 것: `org_id` PK(AUTO_INCREMENT) · `uq_org_unit_name` · `fk_org_parent_id`·`fk_user_org_id`(CASCADE/RESTRICT). ★ **없어야 할 것**: `org_unit.parent` 컬럼 · `app_user.org_unit` 컬럼 · `fk_org_parent` · `ix_org_parent` · `ix_user_org`. ＋ **배포본 낙진**을 동작으로 확인 — 6문을 실제로 쏴서 S1은 생존, S2~S6은 errno 1054인지 본다 |
| I1 | 트리 건강 | 순환이 있거나, 루트가 정확히 1개가 아니거나, **루트에서 도달불가한 조직**이 있으면. 도달불가는 재귀 CTE(깊이 512 가드)와 스냅샷 BFS **두 경로로 세어 교차 검증**한다 |
| I2 | 고아 | `org_unit.parent_id` / `app_user.org_id`가 실재하지 않는 `org_id`를 가리키면. FK가 강제하지만 FK가 무력화되는 회귀가 있으므로 매번 확인한다 |
| I3 | 비활성 부모의 활성 자식 | 1행이라도 있으면. 배포본도 신버전도 `is_active=1`로 조직을 읽으므로, 부모가 목록에서 빠지면 그 하위 트리가 통째로 끊겨 열람 범위가 조용히 줄어든다(피해 규모 — 끊기는 조직 수·인원 — 까지 찍는다) |
| I4 | 이름 유일성·표기 | 앞뒤 공백·전각·빈 이름·제어문자·50자 초과·완전 중복이 있으면. **`BINARY`로는 다르지만 `ai_ci`로는 같은 쌍**도 위반 — DB는 정합하다 하지만 호스트 `StringComparer.Ordinal`과 앱 `===`는 다른 이름으로 읽어 트리가 끊긴다. 값이 리터럴 `'NULL'`인 행도 막는다(batch 출력에서 진짜 NULL과 구분이 안 돼 I5 판정을 무의미하게 만든다) |
| I5 | **신버전 payload 정확성** | 호스트가 쓸 JOIN SQL이 만드는 `units`/`members`가 id 경로로 직접 계산한 정답과 다르면. **내용**의 오라클은 JS가 스냅샷에서 직접 만든 정답(다중집합 완전 일치), **순서**의 오라클은 같은 답을 다른 SQL 형태(상관 서브쿼리)로 뽑은 대조본이다 — 콜레이션 정렬을 JS로 재구현하면 그 재구현이 틀려 가짜 실패가 나기 때문. 여기에 콜레이션과 무관한 순서 성질(`sort_order` 단조성·같은 조직 묶임·NULL 선두)을 더해 'ORDER BY가 통째로 빠진' 결함을 잡는다. NULL 소속·비활성 포함 |
| I6 | `ExpandUnitTree` 재현 | 이름 경로 순회(ProjectDb.cs:443 포팅) ≠ id 경로 순회, 또는 앱 JS `mbSubtree`(prototype.html:3932 포팅) ≠ 이름 경로. 전 유닛(비활성 포함) + 전 사용자를 루트로 전수 대조. ★ 이름 경로의 입력은 **호스트가 실제로 받는 payload 그 자체**다(필터를 다시 흉내내면 두 경로가 함께 틀려 상쇄된다) |
| I7 | **개명이 1문장** | `UPDATE org_unit SET name=? WHERE org_id=?` 이 에러로 죽거나(옛 스키마의 ERROR 1451), **그 한 행 말고 다른 행이 하나라도 바뀌면**(=이름 사본이 있다는 뜻). 리프·본부·루트를 각각 두 번 개명한 뒤 **스키마의 모든 텍스트 컬럼**에서 옛 이름을 전수 검색해 잔존 0건 / 새 이름은 `org_unit.name` 1행뿐임을 확인한다. **"에러가 안 났다"는 성공의 증거로 치지 않는다** |
| I8 | 조작 효과 | 조작이 기대 모델대로 실제로 일어나지 않으면. 실행 **전에** ①문장별 기대 `ROW_COUNT` ②실행 후 특정 행이 가져야 할 값 ③바뀌어도 되는 행 목록을 선언하고, 셋을 다 통과한 조작만 '효과 확인'으로 센다(③이 곧 I7의 근거이기도 하다) |

★ 옛 I1/I2(미러 정합)·I3(배포본 SQL 대조)·I8(배포본 결과 컬럼 계약)은 **삭제됐다** — 미러가 없으므로 지킬 것이 없다.

```
# 사전: $env:TC_TEST_DB_ADMIN_PW = '<DB 관리자 비번>'   (계정 기본값 root)
node tests/loop-org-compat.mjs                     # 기본 60조작, 고정 시드
node tests/loop-org-compat.mjs --ops=150 --seed=7
node tests/loop-org-compat.mjs --selfcheck         # 복제 없이 현재 DB 불변식만(읽기 전용·절단된 DB여야 한다)
node tests/loop-org-compat.mjs --selftest          # 검출기 자체 검증(일부러 깨뜨려 I0~I8이 우는지)
node tests/loop-org-compat.mjs --reference-ddl     # 마이그레이션 파일 대신 내장 참조 DDL로 시험대
node tests/loop-org-compat.mjs --keep              # 복제본을 남긴다(사후 조사용)
```

**실 DB를 절대 건드리지 않는다.** `mysqldump`로 통째 복제한 별도 스키마(기본 `org_probe_loop_<pid>` — 이름에 프로세스 id를 섞는다)에서만 쓰고,
끝나면 — 예외·Ctrl+C에도 — `DROP DATABASE`한다. 원본에는 `--single-transaction` 덤프(=락 없음)와 SELECT만 나간다.
`--clone`은 `org_probe_` 접두사를 강제한다(그 이름을 DROP하기 때문에, 접두사 강제가 유일한 안전장치다).
`CREATE TABLE ... LIKE`를 쓰지 않는 이유는 그것이 **FK를 복사하지 않아** 가짜 결과를 내기 때문이다.

시험대 DDL은 `db/deploy/migrate-*org*.sql`을 자동으로 찾아 쓴다(`--migration=`으로 지정, `--reference-ddl`로 내장본 강제).
어느 쪽이든 I0이 결과 모양을 확정 설계와 대조해 먼저 막는다. 내장 참조 DDL도 `org_id`를
**depth → sort_order → name 재귀 CTE로 명시 배정**하므로, 마이그레이션 경로와 재구축 경로가 같은 번호를 내는지가
요약의 `org_id 배정` 줄에서 바로 보인다(실측 2026-08-25: 두 경로 모두 1=루트 · 2~5=본부 · 6~12=팀으로 일치).

절단 **전** 복제본에서 자식을 가진 조직의 개명을 한 번 시도해 `ERROR 1451`이 나는 것도 확인한다 —
이 테스트가 무엇을 없앴는지의 근거다(절단이 없애려던 증상이 실제로 거기 있었다는 것).

**활성 조직 수 하한(편향 보정).** 숨김/살림 조작이 누적 편향되면 활성 조직이 1개까지 줄어 후반 검출력이 통째로 사라진다
(앞선 판의 실제 문제다). 숨김은 `max(5, ceil(전체×0.5))` 아래로 내려가는 후보를 **아예 뽑지 않고**, 활성 비율이 낮을수록
살림 쪽으로 확률을 기울인다. 요약이 최종 활성 수·하한·루프 중 최소 활성을 함께 찍으므로 편향이 생기면 눈에 보인다.

한글 조직명은 셸 변수·argv로 넘기지 않는다. SQL을 JS 템플릿 문자열로 만들어 **stdin(UTF-8)** 으로 `mysql.exe`에 먹인다
(argv로 넘기면 Windows ANSI 코드페이지 변환에 깨진다). 루프가 만드는 조직명은 전부 합성 한글이라
**실명이 이 파일에 들어가지 않는다**(실명은 비공개 저장소 소관).

### --selftest — 검출기 자체 검증 14케이스

"잡아내지 못하면 그 불변식은 가짜다." 각 케이스는 (준비 → 파괴 → 검사 → **기대한 검출 갈래까지** 확인 → 복구 → 재검사 clean → 정리) 순으로 돈다.
DB를 깨뜨려서는 만들 수 없는 결함(계약 SQL이 틀림·앱 포팅이 틀림·조작이 no-op)은 **코드 변이 훅**으로 만든다 —
그러지 않으면 그 검출기들은 영원히 검증되지 않는다.

| 케이스 | 무엇을 깨뜨리나 | 기대 |
|---|---|---|
| C1~C3 | 순환 · 루트 2개 · 도달불가 섬 | I1 (각각 `/순환/` `/루트/` `/도달불가/` 갈래까지 확인) |
| C4 | 활성 자식을 둔 비-리프를 혼자 숨김 | I3 |
| C5 | `FOREIGN_KEY_CHECKS=0`으로 고아 생성 | I2 |
| C6·C7 | 이름에 뒤 공백 / 전각 문자 | I4 |
| C8 | `uq_org_unit_name`을 떼고 대소문자만 다른 두 조직 | I0 + I4(`BINARY` 갈래) |
| C9 | payload `units`를 INNER JOIN으로(루트가 사라진다) | I5 |
| C10 | payload `members`의 ORDER BY 제거 | I5 |
| C11 | 앱 `mbSubtree`가 자식 하나를 빠뜨림 | I6 |
| C12 | 조작을 통째로 `DO 0`으로(옛 판이 exit 0을 내던 구멍) | I8 |
| C13 | 구 컬럼(`parent`·`org_unit`)을 되살림 | I0 |
| C14 | 옛 `fk_org_parent`를 다시 검 → 개명 1문장이 1451로 죽는다 | I0 + I7 |

기대한 불변식 코드만 맞추면 '아무 이유로나 울기만 하면 통과'가 되므로, `mustText`로 **어느 검출 갈래가 울었는지**까지 본다.
CAUGHT가 아닌 케이스가 하나라도 있으면 `violations`를 거치지 않는 경로로도 exit 1이 되게 이중으로 잠가 둔다
(실측 사고: SETUP-FAIL이 `continue`로 빠져 '9/10'을 찍고도 「위반 없음 ✓」+exit 0으로 끝난 실행이 있었다).

루프 전체를 no-op으로 돌려 보는 변이도 밖에서 걸 수 있다 — `$env:TC_TEST_MUTATE_NOOP='1'`. 기대 결과는 **exit 1**이다.

### ★ 출력 무결성 계약 — 이게 없으면 이 테스트는 무작위로 거짓말을 한다

**실측(2026-08-24)**: `spawnSync(mysql.exe)`가 **종료코드 0 · stderr 비어 있음**인 채로 stdout을
**행 중간에서 잘라먹는 일이 약 0.1% 확률로 일어난다**(3,000회 중 2~4회). stdout을 파이프 대신 임시 파일로
받아도 **같은 지점에서 잘렸다** — Node의 파이프 읽기 문제가 아니라 `mysql.exe` 출력 경로의 문제라
부모 쪽에서는 예방할 수 없다. 잘려도 **SQL 자체는 온전히 실행된다**(3,000회 검증: 잘린 회차의 INSERT도 전부 반영).

옛 코드는 이 잘림을 성공으로 받아 사라진 블록을 **빈 배열**로 바꿨다. 그 결과 *멀쩡한 DB에서* 「루트 0개」·
「사용자 7명 누락」 같은 **가짜 불변식 위반**이 나왔다(정상 DB에서 `--selftest` 16회 중 1회 실패, 매번 다른 케이스).

그래서 지금은 **모든 호출에 종결 마커(`SELECT '__TCEOF__';`)를 별도 문장으로 붙이고**, 마지막 유효 줄이
그 마커가 아니면 잘림으로 판정한다. 계약 SQL(신버전 호스트가 쏠 문자열·배포본 6문)은 **원문 그대로** 실행하고
마커는 뒤에 따로 붙여 파싱에서 제외한다(원문을 변형하면 그 계약을 시험하는 의미가 없어진다).
블록마다 여는·닫는 마커를 두어 **'0행'과 '유실'을 구조적으로 구분**한다.

| 경로 | 잘렸을 때 |
|---|---|
| 읽기 전용(스냅샷·검사) | **최대 3회 재시도**. 회복하면 그대로 진행하고 요약에 감지·회복 횟수를 찍는다. 회복 못 하면 exit 2 |
| 쓰기 조작(`execPlan`) | 재시도하면 **두 번 적용**되므로 재시도하지 않는다. `ROW_COUNT` 계측만 유실로 기록하고, 효과 판정은 재시도로 보호된 스냅샷이 맡는다 |
| 그 밖의 쓰기 | 즉시 exit 2 |

계약 자체를 시험하려면 고장을 주입한다 — 실측된 잘림과 같은 모양(exit 0·stderr 없음·행 중간 절단)이 들어간다:

```
$env:TC_TEST_INJECT_TRUNC = '1'          # 앞으로 1회의 성공한 호출을 자른다 → 재시도로 회복, exit 0
$env:TC_TEST_INJECT_TRUNC = '999'        # 전부 자른다 → '판정 없음', exit 2
$env:TC_TEST_INJECT_TRUNC_WHAT = '스냅샷'   # 그 문자열이 들어간 호출만(경로 지정)
$env:TC_TEST_INJECT_TRUNC_WHAT = '조작 ['   # 쓰기 경로만 → ROW_COUNT 계측만 유실, 스냅샷이 효과를 확인, exit 0
```

실측(2026-08-25, 절단판): ①1회 잘림 → 재시도 1회로 회복·exit 0 · ②전부 잘림 → exit 2「판정 없음」 ·
③쓰기 경로만 잘림 → 「ROW_COUNT 마커 유실 1건(계측 사고·위반 아님)」으로 기록되고 효과는 스냅샷이 확인·exit 0.

### 종료코드

`0` 위반 0 · `1` **불변식 위반** · `2` **판정 없음**(검사를 끝까지 못 했다) · `130` 중단(Ctrl+C 등).

`2`가 나오는 경우: mysql/mysqldump 없음 · `TC_TEST_DB_ADMIN_PW` 없음 · 알 수 없는 인자 · 원본 스키마 없음 ·
**다른 실행이 잠금을 쥐고 있음**(20초까지 재시도한 뒤) · **출력 잘림을 재시도로 회복하지 못함**.

> **`2`를 통과로 읽지 말 것.** 검사를 하지 않았으므로 요약이 「위반된 불변식: 없음 ✓」 대신
> 「판정 없음 — 검사를 끝까지 수행하지 못했다」를 찍는다. `1`과 `2`를 가르는 이유는 사람이 할 일이 다르기 때문이다 —
> `1`은 설계·데이터를 봐야 하고, `2`는 환경을 봐야 한다.

동시 실행은 `GET_LOCK('tc_org_loop')`로 막는다(복제본 이름이 겹쳐 서로를 `DROP`하던 사고가 있었다).
실행이 끝나면 유지 접속을 `KILL`해 잠금을 즉시 돌려주므로 **연달아 돌려도 된다**.

위반은 시드·회차·**실행한 SQL 원문**과 함께 찍히고, 요약 끝에 재현 커맨드 한 줄이 나온다.

## calendar-adapter.mjs — DB 읽기 계층(1b) 대조 테스트

기본 스위트에 **포함되지 않는다**. 러너가 `*.test.mjs`만 수집하므로 확장자가 `.mjs`인 이 파일은 자동수집에서 빠진다.
(→ `*.test.mjs`로 개명하면 CI(ubuntu-latest)가 MySQL과 .NET SDK를 요구하게 되어 깨진다. **개명 금지**.)

증명하는 명제 하나: **같은 데이터를 XML에서 읽은 것과 DB에서 읽은 것이 완전히 같다.**

`widget/CalendarDb.cs`가 만드는 객체가 앱의 `fromXML()`이 돌려주던 것과 **모양까지 같은지**를 본다.
앱 전체를 고치지 않고 재료만 바꾸는 일이라, 모양이 한 군데라도 다르면 그 자리에서 화면이 깨지거나(터지면 다행)
**조용히 다르게 그려진다** — 어댑터 계약 G절이 존재하는 이유가 그것이고, 이 파일이 그 절의 게이트다.

### 기준(expected)은 코드다, 문서가 아니다

`fromXML()`을 **재구현하지 않고 실행**한다. ① 위젯이 `TC_DEBUG_PORT=9222`로 떠 있으면 CDP로,
② 없으면 jsdom으로 같은 `task-calendar-prototype.html`을 부팅해서. ③ 둘 다 안 되면 **exit 2** — 조용히 건너뛰지 않는다.
`JSON.stringify`가 값이 `undefined`인 키를 통째로 지우므로 센티널 replacer로 키를 살려 둔다
(**"키가 없다"와 "키는 있는데 undefined"는 이 테스트가 반드시 구분해야 하는 두 상태**다 — 개인 과제에는 `source` 키가 *없어야* 한다).

### 흐름

XML → `fromXML()` → **expected** → INSERT(복제 DB) → `CalendarDb.cs` → **actual** → 깊은 비교.
적재 방향이 이 순서인 것은 설계 §8이 못박은 계약("이관 도구와 런타임 저장은 `fromXML()`을 통과한 결과만 DB에 넣는다")과 같다.

| 픽스처 | 무엇 |
|---|---|
| `real` | `%APPDATA%/TaskCalendar/data.xml` — **읽기만 한다. 고치지 않는다** |
| `synth` | 실 데이터가 안 건드리는 계약면을 덮는 합성 XML — 반복·예외·dayNotes·taskHours·`remind` 3상태(null/0/n)·공식과제 `source`/`dbGone`·완료시각·NULL 자리 전수. '이관 도구'가 아니라 **시험용 픽스처**다 |

★ `_no`(cat_no·entry_no·todo_no)는 표시 순서와 **일부러 어긋나게** 배정한다. 그래야 `ORDER BY`를 빠뜨린 어댑터가
PK 순서를 돌려주고 그 자리에서 잡힌다. **오름차순만 깨는 것으로는 부족하다** — 실측(2026-08-27) 옛 구현이
`_no`를 완전 역순으로 배정했더니 계약 G-5가 금지한 `ORDER BY <표>_no DESC` 어댑터가 real·synth 양쪽에서
**초록으로 통과**했다. 그래서 조건은 "표시 순서가 `_no`의 오름차순으로도 내림차순으로도 재현되지 않는다"이고,
그렇지 못하면 「픽스처 조건 미달」로 그 사실을 찍는다(고정 시드 Fisher-Yates라 실행마다 같은 배치가 나온다).

★ 커밋은 **일부러 적재한다.** G-7이 요구하는 것은 '없다'가 아니라 '부팅 조회에 넣지 않는다'이므로,
DB에 있는데도 `commits`가 `[]`로 오는지를 봐야 그 계약이 실제로 시험된다.

### ★ 이 게이트가 증명하지 **못하는** 것 — 픽스처 한계

판정력은 픽스처가 그 결함을 **만들 수 있는 모양인가**에 달려 있다. 두 픽스처의 성격이 다르다.

| | 고칠 수 있나 | 무엇을 덮나 | 무엇을 못 덮나 |
|---|---|---|---|
| `real` | **아니다** — 사용자 실데이터·읽기 전용 | 실제 사용 형태·실제 규모 | 실 데이터가 우연히 갖지 않은 모양 |
| `synth` | 그렇다 | real이 못 덮는 계약면을 겨냥해 채운다 | 실제 사용 형태(우리가 상상한 것만 들어 있다) |

실측된 real의 한계 3건 — 모두 `synth`가 덮는다:

| 변이 | real에서 못 만드는 이유 |
|---|---|
| `M6` rooms `ORDER BY` 누락 | 실 `data.xml`의 회의실 4개가 **우연히 이미 이름순**이다. `cal_room`은 `_no`가 없고 PK가 `(user_id,name)`이라, `ORDER BY sort_order`를 빠뜨린 어댑터는 이름순을 돌려준다 — 표시 순서가 이미 이름순이면 그 결함이 **정답과 구분되지 않는다** |
| `M14` `remind` 0 → null | 실 데이터에 `remind=0`(알림 없음)인 일정이 없다 |
| `M15` `taskHours` DECIMAL→문자열 | 실 데이터에 `taskHours`가 없다 |

> **그래서 `--fixture=real` 단독 실행을 완전한 게이트로 쓰면 안 된다.**
> 그 실행의 `SKIP`은 '통과'가 아니라 **'그 결함을 만들지 못했다'**이다.
> 요약이 그 자리를 `✗ SKIP 중 아무 픽스처도 덮지 못한 것`과
> `★ 이 실행은 완전한 게이트가 아니다`로 찍는다. 게이트로 쓸 실행은 **`--fixture=both --selftest`**(기본값 `both`)다.
> `--fixture=both`로 돌면 같은 자리가 `· SKIP 중 덮인 것 : M6(→synth) · M14(→synth) · M15(→synth)`로 바뀐다.

「픽스처 조건」은 요약에 **별도 블록**으로 남는다(참고 더미에 섞지 않는다). 그 줄이 늘어나면 그만큼 '같다'의 뜻이 약해진 것이다.
지금 남는 줄은 real의 회의실 한 줄뿐이고, 그것은 **고칠 수 없으므로 계속 찍히는 것이 정상**이다.

검출기 자체의 시험(잘못된 초록 방지): `TC_TEST_INJECT_NOSCRAMBLE=1`로 돌리면 `_no`를 표시 순서 그대로 배정해
「픽스처 조건 미달」이 정말 우는지 볼 수 있다(`_no`는 state에 나가지 않으므로 대조 결과는 그대로 0건이다).

그 밖에 이 게이트가 **증명하지 않는** 것: 쓰기 경로(2)·이관 도구(3)·앱 배선(1c)은 대상이 아니다.
증명하는 명제는 **읽기 한 방향** 하나다 — "같은 데이터를 XML에서 읽은 것과 DB에서 읽은 것이 완전히 같다".

### 비교 규칙

- **키 유무까지** 본다 · `undefined`와 `null`을 구분한다 · 다르면 **어느 경로의 어느 키가 어떻게** 다른지 찍는다(해시 아님)
- 순서를 보는 배열: `categories`·`rooms`·`recurExcept`·`commits`
- `entries`·`todos`도 **배열 그대로 인덱스별로** 본다(`diffArrayOrdered`). 화면 순서 = 배열 순서이고
  렌더 정렬(`entrySort`)도 `createdAt`에서 끝나므로, 정렬 키가 동률이면 배열 순서가 그대로 화면에 새어 나온다.
  보고는 `[ORDER]`(자리 어긋남 — 동률 그룹 안의 재배치는 따로 센다)와 `[DIFF]`(항목 누락/잉여·내용 차이)로 갈린다.
  → 예전에는 대조 **직전에** `byId`로 배열을 접어 순서가 비교에서 통째로 빠져 있었다(자리가 뒤바뀌어도 "차이 0건").
  순서를 포기해야 하는 구간은 `ORDER_EXEMPT`에 적고 요약에 **반드시** 찍는다 — **지금은 비어 있다**
- 맵(`taskHours`·`attendance`·`dayNotes`)의 **키 순서는 계약이 아니다.** 키 집합과 값만 본다
- **계약상 차이표** — `entry.hours→null`(컬럼 폐지) · `category.usesRepo` 신설 키를 기준에 얹음(2026-08-27) ·
  `gitRepo`/`svnRepo`(로컬 소유). 이 표에 **없는** 차이는 전부 위반이고, 표에 있는 것은 요약에 **반드시 찍는다**.
  ※ 옛 항목 둘은 없어졌다 — `commits→[]`는 **G-7 개정(2026-09-01)으로 대조 대상이 됐고**(커밋을 지우던 정규화를 제거했다),
  `lsMigrated→true`는 그 키 자체가 사라졌다. 차이표의 정본은 `calendar-adapter.mjs`의 `normalizeExpected()`다

### 계약별 개별 검사(깊은 비교와 별개로 돈다)

| 코드 | 검사 |
|---|---|
| G-0 | 최상위 키가 정확히 **14개**인가(그 이상도 이하도 아니다). 명부는 `calendar-adapter.mjs`의 `TOP15` 상수가 정본이다 — **이름은 `TOP15`인데 항목은 14개**다(2026-09-01 `lsMigrated` 제거로 15 → 14가 됐고 상수 이름만 남았다) |
| G-1b/c | `categoryId`가 실재하는 과제 **uid**인가. **숫자(cat_no)를 흘리면 오류 없이 전 일정이 '미분류'가 된다** · `taskHours` 안쪽 키도 uid |
| G-1d | `user_id`·`*_no`·`sort_order`·`seq`·`uid`·DB 컬럼명 그대로가 state에 새지 않았나 |
| G-2 | NULL → `''`(start/end time · endDate 둘 · due · recur.until · completedAt) |
| G-2b | 반대로 NULL을 유지해야 하는 둘 — `cat_no`(→null, `''` 아님) · `remind`(null=기본 사다리 / 0=알림 없음) |
| G-3 | 시각 6자리가 ISO `Z` · 소수 **정확히 3자리**(자릿수가 흔들리면 §8 왕복 서명이 어긋난다) |
| G-4 | `allDay`·`done`·`gitCommitBody`·`lsMigrated`·`dbGone`이 boolean(0/1이면 화면은 같고 내보내기만 달라진다) |
| G-5 | `recurExcept`가 `except_date` 오름차순 · 근태에 빈 status 키 없음 · `taskHours` 값이 숫자(DECIMAL을 문자열로 흘리면 합계가 문자열 접합이 된다). ※ `entries`/`todos`의 **배열 순서**는 여기서가 아니라 `[ORDER]`가 기준과 인덱스별로 대조해 본다(더 강한 판정 — 날짜뿐 아니라 문서 순서를 본다). 옛 "`entry_date` 단조" 검사는 기준이 갖지 않은 성질을 요구하던 것이라 삭제됐다 |
| G-6 | `hours`가 명시적 null(컬럼 폐지) · `source`/`dbGone`은 공식 과제에만(개인 과제에는 키 자체가 없다) · `usesRepo`는 DB에만 있는 거울값(경로에서 파생하지 않는다) · `gitRepo`/`svnRepo`는 로컬 저장소 몫. ※ 옛 **`lsMigrated` 검사는 2026-09-01에 삭제**됐다 — 자동이관(`migrateLocalStores()`)이 사라지면서 그 키 자체가 없어졌다(G-0 15 → 14) |
| G-7 | **(2026-09-01 개정)** `entry.commits`를 **부팅 조회가 실어 왔는가** — DB 행수와 일치해야 한다. 개정 전에는 *"`commits`가 `[]`인가"*(지연 조회 전제)였는데, **그 지연 조회가 한 번도 배선된 적이 없어** DB 모드에서 커밋이 영영 빈 배열이었고 커밋 기반 일간·주간 보고가 통째로 비어 나갔다. **DB에 커밋이 실제로 있는 상태에서** 통과해야 의미가 있다(0행이면 「검출력 없음」으로 찍는다) |
| §3.5/§3.6 | `performance_schema` 문장 다이제스트로 **관측**한다: `START TRANSACTION WITH CONSISTENT SNAPSHOT` · 격리수준·time_zone·lock_wait_timeout 설정 · **부팅 조회가 읽어야 하는 표 전부**(명부는 `calendar-adapter.mjs`의 부팅 조회 표 목록이 정본 — **`cal_entry_commit`도 2026-09-01 G-7 개정으로 들어왔다.** 예전엔 "없음"을 확인했다) · COMMIT · **연결 1회**. 다이제스트는 리터럴을 `?`로 지우므로 **값**(`REPEATABLE-READ`·`+00:00`·`5`)은 소스 텍스트로 따로 본다 |

### 변이 시험 — `--selftest`

"잡아내지 못하면 그 불변식은 가짜다." 21케이스(M1~M17·M6b·MO1~MO3)를 **일부러 깨뜨려**
기대한 검출 갈래(코드 + 문구)까지 울었는지 본다. 그냥 아무 이유로나 울면 통과가 아니고,
**변이하지 않은 상태에서 울어도** 실패다(오탐 확인 ②). 순서 비교기는 **기준과 같은 순서로 다시 늘어놓으면
`[ORDER]`가 0건인지**까지 따로 본다(오탐 확인 ①).

픽스처에 해당 자료가 없어 만들 수 없는 변이는 `SKIP`으로 남긴다 — **통과로 세지 않는다.**
요약이 그 `SKIP`을 **다른 픽스처가 CAUGHT 했는지 대조**해서, 덮였으면 `M6(→synth)`로, 아무도 못 덮었으면
`★ 이 실행은 완전한 게이트가 아니다`로 찍는다(위 「픽스처 한계」 참조).

실측(2026-08-27, `widget/CalendarDb.cs` 대상 · `--fixture=both --selftest`):

| 픽스처 | 결과 |
|---|---|
| `synth` | **21/21 CAUGHT · MISSED 0 · SKIP 0 · 오탐 0** |
| `real` | 18 CAUGHT · MISSED 0 · **3 SKIP**(M6·M14·M15 — 전부 `synth`가 덮는다) |

두 픽스처 모두 깊은 비교 **차이 0건**(순서까지 인덱스별로 대조).

### 안전

**실 DB를 절대 건드리지 않는다.** `mysqldump`로 통째 복제한 별도 스키마(기본 `cal_probe_adapter_<pid>`)에서만 쓰고,
끝나면 — 예외·Ctrl+C에도 — `DROP DATABASE`한다. 원본에는 `--single-transaction` 덤프(락 없음)와 SELECT만 나간다.
`--clone`은 `cal_probe_` 접두사를 강제한다(그 이름을 DROP하기 때문에, 접두사 강제가 유일한 안전장치다).
`CREATE TABLE ... LIKE`를 쓰지 않는 이유는 그것이 **FK를 복사하지 않아** 가짜 결과를 내기 때문이다.
`data.xml`도 **읽기 전용**이다.

어댑터는 **일회용 전용 계정**(`calprobe_<pid>`, 복제본 SELECT만)으로 붙는다 — 실 앱 계정(`taskmgr_app`)의 GRANT를
건드리지 않기 위해서다. `DROP DATABASE`는 그 스키마에 준 권한을 자동으로 지우지 않으므로(mysql.db에 유령 행이 남는다)
계정 자체를 지운다. 이전 실행이 죽어 남긴 `calprobe_%`도 시작할 때 함께 치운다.

동시 실행은 `GET_LOCK('tc_cal_adapter')`로 막는다. **출력 무결성 계약**(종결 마커·읽기 3회 재시도)은
`loop-org-compat.mjs`와 같고 고장 주입도 같은 환경변수(`TC_TEST_INJECT_TRUNC`)를 쓴다.

### 실행

```
# 사전: $env:TC_TEST_DB_ADMIN_PW = '<DB 관리자 비번>'   (계정 기본값 root)
node tests/calendar-adapter.mjs                       # real+synth 전부
node tests/calendar-adapter.mjs --selftest            # ★ 게이트로 쓸 실행(both + 변이 시험)
node tests/calendar-adapter.mjs --fixture=synth -v
node tests/calendar-adapter.mjs --fixture=real        #   ※ 단독으로는 완전한 게이트가 아니다(위 「픽스처 한계」)
node tests/calendar-adapter.mjs --oracle=cdp          # 기준을 위젯(9222)에서만 받는다
node tests/calendar-adapter.mjs --login-id=hjlee      # 복제본에서 쓸 app_user.login_id
node tests/calendar-adapter.mjs --reference-adapter   # 내장 참조 어댑터로 하네스 자체 검증
node tests/calendar-adapter.mjs --keep                # 복제본·프로브를 남긴다(사후 조사용)
```

`--reference-adapter`는 `loop-org-compat.mjs`의 '내장 참조 DDL'과 같은 자리다 — 대상이 없거나 의심스러울 때
**하네스(픽스처 SQL·비교기·검출기)가 맞는지**를 독립 대조본으로 증명한다. 이 모드의 통과는
"어댑터가 옳다"가 아니라 "하네스가 옳다"의 증거다(요약에도 그렇게 찍힌다).
`widget/CalendarDb.cs`가 아예 없으면 기본 모드는 **exit 2**로 그 사실을 알린다 — 조용히 통과하지 않는다.

### 종료코드

`0` 위반 0 · `1` **계약 위반**(모양이 다르다) · `2` **판정 없음**(기준 오라클 없음 · MySQL/dotnet 없음 ·
`CalendarDb.cs` 없음 · `login_id`가 `app_user`에 없음 · 출력 잘림 미회복 · 다른 실행이 잠금 보유) · `130` 중단.

> **`2`를 통과로 읽지 말 것.** `1`은 설계·코드를 봐야 하고, `2`는 환경을 봐야 한다.
> ★ `login_id`가 `app_user`에 0행이면 **user_id를 만들어 내지 않고** 멈춘다(§3.6) — 없는 사람의 캘린더를 새로 파는 셈이 되기 때문이다.

## schema-guards.test.mjs — 재구축·마이그레이션 정합 가드 (Layer 1, 기본 스위트)

DB도 jsdom도 없이 `db/deploy/*.sql` **텍스트만** 읽어 재적용 가능성을 본다.
`schema-calendar.sql` 에는 `SET FOREIGN_KEY_CHECKS=0` 이 **없어서** DROP/CREATE의 *순서*가 실행 성패를 가른다.

| 가드 | 무엇 | 안 지키면 |
|---|---|---|
| DROP ⊇ CREATE | 만드는 표는 전부 먼저 지운다 | 재적용이 `ERROR 1050` |
| DROP-only 허용 목록 | `cal_audit_trash`(폐지 §7.5)만 예외 — 사유는 테스트 파일 안에 | 재생성 누락과 구분 불가 |
| DROP 순서 | 자식 → 부모 | `ERROR 3730` |
| CREATE 순서 | 부모 → 자식 | FK 대상 부재(`ERROR 1824/3734`) |
| 체인 연속성 | `migrate-*.sql` 의 `schema_version` (N→M)이 구멍·중복 없이 정본 값까지 | 마이그레이션한 DB와 새로 구축한 DB의 버전이 어긋난다 |
| 위젯 상수 일치 ⑨ | `widget/CalendarDb.cs` 의 `ExpectedSchemaVersion` == 정본이 심는 값 | 「낡은 클라이언트 차단」(설계 §5.5)이 **거꾸로** 터진다 — 새 서버에서 최신 위젯이 스스로를 낡았다고 판정해 가져오기·초기화가 막힌다 |

실측 체인: `sort-order 3→4` → `repo-flag 4→5` → `report-daily 5→6` → `report-weekly 6→7` → `sent-only 7→8` → `integrity 8→9` = 정본(`db/deploy/schema-calendar.sql` 끝의 `cal_schema_meta` 시딩 줄).
`07-24-uniqueness` · `08-24-user-id` · `08-24-org-id` 3개는 **`cal_schema_meta` 를 아예 건드리지 않아** 제외 목록(`PRE_VERSION_FILES`)에 사유와 함께 있고,
검사가 매번 "정말 안 건드리는가"를 되확인한다 — 나중에 버전 갱신이 들어가면 제외가 거짓이라고 실패한다.

검출기 자신은 **변이 시험**으로 증명한다(이 저장소 관례 · 건수는 파일이 정본). 그중 하나는 실제로 났던 결함
(`c4cf813` — 8-31 보고 기록 3표가 DROP 블록에서 빠져 있던 것)을 그대로 재현해 잡는지 본다.
파싱은 SQL 전용 마스커로 `--`/`#`/`/* */` 주석과 문자열 리터럴을 지운 판에서 한다
(harness의 `skipString` 은 JS용 — SQL의 `''` 이스케이프·백틱 식별자를 모른다).

## boot-retry.test.mjs — 부팅 실패 재시도 (Layer 1 + 배선 계약)

아침에 PC 가 서버보다 먼저 켜지면 부팅 조회가 실패한다. 그 상태의 탈출구가 "위젯을 다시 켜세요" 뿐이면 89명 규모에서는 그대로 장애 신고가 된다.
앱의 스케줄러(`createBootRetry`)는 **타이머를 주입받도록** 만들어져 있어서, 이 파일이 가짜 시계로 15·30·60초를 **실제로 흘려 보내며** 검증한다 —
정규식으로 `15000` 이 소스에 있는지만 보면 그 숫자를 **쓰지 않는** 코드와 구분되지 않는다.

| 무엇 | 왜 |
|---|---|
| 지연 15→30→60, 그 뒤 중단 | 무한 재시도는 서버가 죽은 아침에 89대가 영원히 두드리는 것이고, 화면에도 '실패'가 안 남는다 |
| 성공 시 타이머 해제 + 카운터 리셋 | 살아난 화면 위에서 계속 서버를 두드리면 안 된다 |
| 수동 [다시 시도]는 시리즈를 리셋하지 않는다 | 리셋하면 누를 때마다 상한이 되살아나 '중단'이 영영 안 온다 |
| `retryable=false` 면 자동 재시도 없음 | 로그인 없음·미등록은 몇 번을 걸어도 같은 답이다 |
| 재시도는 `hostRequest` 가 아니라 `hpost` | `reloadState` 는 **회신이 없는 명령**이라 hostRequest 로 보내면 성공해도 25초 뒤 '응답 시간 초과'로 끝난다 |

## 하네스 API (harness.mjs)

- `test(name, fn)` / `run()` — 테스트 등록·일괄 실행. `fn`은 sync/async 모두 가능.
  실패 시 이름+스택 출력, 요약(`N pass / M fail / K skip`).
  종료코드는 fail>0 → `1`, fail 0인데 skip>0 → `2`, 둘 다 0 → `0`.
- `skip(name, reason, detail)` (= `test.skip`) — **판정 없음**으로 등록한다. 빈 `test()` 로 초록을 만들지 말 것.
  `reason`은 요약의 집계 키(짧게, 예: `'jsdom 미설치'`), `detail`은 그 줄에만 붙는 자유 문구.
  `TC_TEST_STRICT=1` 이면 fail로 승격된다.
- `importOptional(spec)` — 없을 수도 있는 모듈 로드(없으면 `null`). `TC_TEST_FORCE_MISSING` 에 걸리면 있어도 `null`.
- `SKIP_NO_JSDOM` — jsdom 미설치 skip의 공용 사유 문자열(러너가 이 키를 보고 설치 힌트를 찍는다).
- `countTestsBelow(fileUrl, marker)` — marker 뒤의 `test(` **자리 수**를 정적으로 센다(주석·문자열 제외).
  skip 줄에 사라진 규모를 붙이는 용도 — 루프 등록분을 못 세므로 정확한 건수가 아니다.
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
- 의존성이 없어 못 도는 테스트는 **빈 `test()` 로 초록을 만들지 말고 `skip(name, reason, detail)`** 을 쓴다.
  「돌지 않았다」와 「통과했다」가 요약에서 구분되지 않으면 게이트가 조용히 거짓말을 한다(실제로 그랬다 — 위 「종료코드」).
- 주석은 이 리포 관례대로 한국어로 간결하게.
- fixture의 **필드명은 실제 netcus 폼과 동일**해야 한다(값이 아니라 name 속성이 계약).

---

## 미커버 영역 · 추후 테스트 백로그

> 갱신: 2026-09-07. (앞선 갱신 2026-07-27 = v0.12.0 릴리스 직후)

### 지금 커버되는 것
`run-tests.mjs`가 `*.test.mjs`를 자동 수집한다 — 순수 로직·보고서 포맷·
netcus 병합·공휴일 표 정합성·토큰 드리프트·폰트 불변식·호스트(.cs) 배선 계약·배포 스크립트 가드.
**jsdom 기반이라 계산과 계약은 잡지만 레이아웃은 원리적으로 못 잡는다**(`offsetHeight === 0`).

건수는 여기 적지 않는다 — 적으면 낡고, 낡은 숫자는 아무도 안 믿는다. 대신 **게이트가 스스로
총량을 본다**: `run-tests.mjs`의 `러너①`(수집 파일 수가 `MIN_TEST_FILES` 하한 미만이면 실패)과
`러너②`(0건을 등록한 파일이 있으면 실패). 계약은 `harness-selftest.test.mjs`의 `census①~③`.

### 가장 큰 공백 — 레이아웃 회귀 (P1)
v0.12.0에서 나온 결함이 **대부분 레이아웃**이었고 전부 수작업(CDP 실측 + 스크린샷)으로 잡았다:

| 결함 | 증상 |
|---|---|
| 미리알림 '직접' 클릭 | 행 높이 31.6 → 39px 변동(아래가 밀림) |
| 세그 라벨 | `할 일` → `할 ...` 말줄임 |
| 월 그리드 `+N개 더보기` | `overflow:hidden` 밖으로 밀려 잘림 |
| 장소/반복 칼럼 | 라벨·셀렉트 8px 어긋남 |
| 우측 탭바 보고서 버튼 | `커밋 내역` 탭 글자를 덮음 |

- [ ] **레이아웃 회귀 테스트를 main에 도입** — `feat/db-app`의 `tests/loop-ui-visual.mjs`가
      같은 역할이므로 이식 검토(브랜치 UI 기준으로 작성돼 있어 그대로는 안 돌 수 있음).
      최소 불변식: `scrollWidth <= ceil(clientWidth)`(잘림 0) · 모드 전환 시 행 높이 불변 ·
      칩/버튼이 부모 밖으로 안 나감 · 대비 3:1(비텍스트)·4.5:1(텍스트).
      **판정은 픽셀 비교가 아니라 측정값 불변식으로** — 폰트·테마가 바뀌어도 안 깨지게.

### 2026-09-07 에 메운 구멍 — 전부 '측정으로' 확인한 것들
게이트가 초록인데도 **못 보고 있던 자리**들이다. 각 항목은 "고쳤다"가 아니라 "고치기 전에
실제로 새는 것을 재현했다"가 근거다.

| 구멍 | 어떻게 재현했나 | 지금 |
|---|---|---|
| `data.xml` 폐기 게이트가 `.cs` 15개 중 **2개만** 훑었다 | 실제 `widget/Reminders.cs`에 `data.xml` 코드 줄을 심었더니 옛 게이트는 **9 pass / 0 fail / exit 0** | `widget/` 디렉터리를 **열거**해 전부 훑는다(새 `.cs`도 자동). `xml-retirement`의 폐기⑤·변이⑲ |
| 게이트가 **총량을 안 봤다** — 시험 파일이 개명·삭제되면 수집조차 안 되므로 skip 도 안 남는다 | `holiday.test.mjs`를 잠깐 감췄더니 **1085 → 1060 pass, 0 fail** (24건 증발했는데 초록) | `러너①`·`러너②` + `census①~③` |
| `gitcheck`만 `ResolveVcs`를 안 부르고 같은 식을 복제 — `Svn.cs` 주석은 "세 진입점 모두 통일"이라고 단언 | 동작은 같았다(그래서 아무 시험도 안 빨개졌다). 주석이 앞서고 코드가 뒤처진 상태 | 통일 + `vcs-branching.test.mjs`(분기①~⑤·변이㉑~㉔) |
| `loop-peer-frame`·`loop-peer-view`의 `sql()`이 stdout을 `'\n'`으로만 잘라 여러 행일 때 마지막 열에 `\r` 잔존 | 한 행짜리는 바깥 `.trim()`이 가려 줘서 조용했다. `Number()`가 `\r`를 공백으로 먹어 더 조용 | `/\r?\n/` + 셀에 CR가 남으면 **크게 실패** |
| `db/deploy`의 배포 스크립트에 계약이 **0** | `backup-taskmgr.ps1`은 데이터를 지키는 스크립트인데 검사가 없었다 | `restore-guards.test.mjs`가 첫 계약(복구) → `backup-guards.test.mjs`가 그 짝(백업). 공용 기계는 `ps-guard-lib.mjs` |
| `restore-taskmgr.ps1`이 **무인 실행에서 영원히 멎었다** | stdin이 리다이렉트되고 **파이프가 열린 채 비어 있으면** `[Console]::In.ReadLine()`이 안 돌아온다 — `-WhatIf`가 5분 뒤에도 안 끝났다(25초 상한으로 강제 종료, 코드 `124`). `< NUL`(즉시 EOF)에서는 멀쩡해서 **대화형·수동 실행으로는 절대 안 드러난다** | 자격 획득 순서를 `.cnf` → 환경변수 `TASKMGR_ADMIN_PW` → **상한 10초** stdin → 대화형으로 바꾸고, 상한 초과는 코드 `2`. `restore-guards`의 가드 ⑧⑨⑩ + 변이 ⑧·⑧-b~e·⑨·⑨-b~e |

### 정합성 정리 (P1)
- [ ] `feat/db-app`의 `tests/loop-ui-integrity.mjs` 에러 문구 `(migadmin 권한 확인)` →
      `root`(또는 `--admin-user`로 지정한 계정). **migadmin 계정은 2026-07-27 삭제됨**
      (레포 어떤 스크립트도 만들지 않은 수동 생성 계정이었고, 테스트 기본값은 원래 `root`.
      `dbHost`가 `127.0.0.1` 하드코딩이라 원격 관리계정은 애초에 불필요했다).

### 사람이 확인해야 하는 것 — 자동화 불가 (P2, 실배포 전)
- [ ] **공휴일 3건 대조**(폐쇄망이라 권위 출처 조회 불가):
      ① 2028 부처님오신날(5/1 vs 5/2) ② 2030 설날(2/2 vs 2/3 — 대체공휴일까지 연쇄)
      ③ 연휴가 토·일 2일과 겹치는 해의 대체공휴일 **일수**(2027 설날·2029 추석·2030 설날).
      표의 **내부 정합성**(연휴 연속·대체는 평일·원일이 주말인 해만)은 `holiday.test.mjs`가 잠갔지만,
      **날짜 자체가 맞는지는 기계가 알 수 없다**. 근태 판단에 쓰이므로 배포 전 필수.

### 의도적으로 남긴 것 (이유와 함께)
- [ ] **시험 러너가 비밀번호를 `-p<비번>`으로 명령줄에 싣는다** — `loop-calendar-write`·
      `loop-org-compat`·`calendar-adapter`·`dryrun-xml-to-db`·`migrate-tool`·`seed-dummy`.
      Windows는 같은 사용자 권한이면 다른 프로세스의 명령줄을 읽는다. **다만 이건 외부망
      개발 PC의 시험 하네스이고 대상은 개발용 DB다**(배포 스크립트는 이미 `.cnf`를 쓴다 —
      `backup-taskmgr.ps1`·`restore-taskmgr.ps1` 모두 `--defaults-extra-file` 전용).
      고치려면 전 호출부를 `MYSQL_PWD`/`.cnf`로 바꾸고 **루프 러너를 전부 다시 돌려야** 하는데,
      그건 위젯과 DB가 다 필요하다. 실이익 대비 검증 비용이 커서 **미룬다**. 폐쇄망 서버로
      옮길 때 함께 정리할 것.
- [ ] **`tests/pure-logic.test.mjs`의 줄끝이 섞여 있다**(CRLF 297 + LF 108). 기능에는 영향이
      없지만 문자열 앵커 변이를 쓸 때 앵커가 안 잡히는 원인이 된다. 이 저장소는 파일마다
      줄끝이 다르다 — `MainWindow.xaml.cs`는 `\r\r\n`(CR 중복)이다. **편집 전 반드시 실측할 것**
      (`grep -c $'\r'`는 `\r\r\n`과 CRLF를 구분하지 못한다 — 2026-09-07에 이걸로 한 번 깨뜨렸다).
- [ ] **`widget/NetcusService.cs`(1,164줄) 실왕복** — 회사망이 있어야 한다. 외부망 개발 PC에서는
      원리적으로 판정 불가. 폐쇄망에서 확인할 것.
- [ ] **`widget/Update.cs`(367줄)** — 인스톨러·배포 경로와 함께 볼 것(사용자 지시로 후순위).

### 실환경 검증 (P2)
- [ ] **업데이트 경로 전환 후 검증** — 현재 소스가 개인 PC FTP라 그 PC가 꺼지면 팀 전체가
      조용히 구버전에 머문다(`Update.cs`가 **모든 실패를 무음** 처리). 파일서버/`www.netcus.com`
      전환 시 ①새 위치 수신 ②옛 주소 설치본 이관 ③전환 후 FTP 내림 순서 확인.
- [ ] `ISSUES.md` #1 잔여 3건(옛 빌드 재현 확인 등).

### 기능과 함께 (P3)
- [ ] **업데이트 무음 실패 완화** — 설정에 "마지막 업데이트 확인: N일 전" 노출 + 테스트.
      팝업 없이 정보만 남기는 방식(현 설계 철학 유지).
- [x] ~~**`feat/db-app` → main 병합 시 통합 검증**~~ — **결정 1(2026-09-02)로 종결.** 승격·병합하지 않는다(`docs/ROADMAP.md` §5-1). main 잔여 커밋 중 이 백로그(`5d371c6`)는 cherry-pick됐고(`4953c30`), 나머지(`a90e56c`, 옛 로드맵 주석)는 로드맵 재작성으로 불필요 — main 잔여 0건.

## loop-schema-gate.mjs — 스키마 게이트·부팅 재시도·개명 가드 회귀(P1-1·P1-2·P1-8)

`f6d6c2d`로 넣은 배포 전 안전장치 셋을, **다음 빌드가 스스로 재증명**하게 하는 실동작 테스트다.
만들 때는 CDP로 실위젯 검증했지만 그 검증이 일회성이라, 부팅 경로·스키마 비교·배지처럼
**실행돼야 드러나는** 것을 회귀로 못 박았다(계약 테스트·순수 로직 게이트가 못 보는 영역).

- **P1-1** 정본 판번호 N을 읽어 서버 스키마를 잠깐 **N+1**로 올려(위젯은 N) 배지 경고·웹 게이트·호스트 게이트 삼중 확인,
  통상 저장은 §5.5대로 허용됨을 확인, **시작할 때 읽은 값**으로 복구.
- **P1-2** `__applyStateError`로 15·30·60초 백오프·수동 재시도·성공 시 해제·retryable=false 무재시도.
- **P1-8** pick 없이 온 전량 교체는 개명하지 않음(`_lastImportPath` null 가드). 네이티브 파일창으로
  고른 원본의 실개명은 범위 밖(모달) — 계약 `data-source ⑨` + 2026-09-03 수기 로그로 증명됨.

```bash
# 사전: 위젯을 TC_DEBUG_PORT=9222로 로그인된 채 띄워 둘 것.
#       Bash:        export TC_TEST_DB_ADMIN_PW=<DB 관리자 비번>
#       PowerShell:  $env:TC_TEST_DB_ADMIN_PW = '<DB 관리자 비번>'
node tests/loop-schema-gate.mjs
```

**⚠️ 전역 행을 만진다.** 이 테스트는 `cal_schema_meta.schema_version`을 잠깐 **정본 판번호 + 1**로 바꾼다 —
그 창 동안 이 DB를 보는 **모든** 위젯이 전량 교체를 거부하므로 **테스트 DB에서만** 돌린다.
판번호는 시험 코드에 박아 두지 않는다 — 정본(`db/deploy/schema-calendar.sql` 끝의 `cal_schema_meta` 시딩 줄)을 읽어
`CANON`으로 삼고, 불일치는 `CANON+1`로 만든다. 끝나면(중단돼도) `finally`가 **시작할 때 읽은 값**으로 되돌리고,
되돌림 실패 시 마지막에 크게 경고한다. 한 번도 바꾸지 않았으면(`touched=false`) **아무것도 쓰지 않는다.**

> **왜 이 두 규칙이 생겼나(2026-09-09).** 판번호를 박아 둔 옛 시험이 선행조건에서 아무것도 바꾸지 않은 채 중단했는데도
> `finally`가 무조건 '8'을 써서 **실 DB를 강등**시켰다. 구조는 v9인데 판번호만 v8이 된 DB를 보는 위젯은 전량 교체를 전부 거부한다.

**종료코드**: 통과=0, 실패 또는 schema_version 복구 실패=1, `TC_TEST_DB_ADMIN_PW` 없음=2.

## loop-user-admin.mjs — 사용자 관리 실동작 루프(USER-ADMIN §8-8)

실행 중인 위젯(CDP 9222, **관리자 계정으로 로그인**)과 실 DB 로 `docs/USER-ADMIN.md` 의 편집 경로를 한 라운드에 15 케이스로 돈다.
등록(폼 경로·전체 필드) · 수정(이름·직급·소속·열람 범위·편집 권한) · 순서 편집(실제 ▲▼ 클릭 → 저장 → DB 순서·10 간격·NULL 0) ·
퇴사·복구 · 잠금 방지(자기 퇴사·자기 권한) · 검증 5종(잘못된 ID·중복 ID·빈 이름·미등록 직급·도메인 밖) · `orgId:null`/`userId:null` 회귀 ·
비관리자 뷰(로그인 계정을 잠시 editor 로 내려 편집 컨트롤 부재 확인 후 **반드시 복원**) · 재진입 가드. 케이스마다 불변식 I1~I5
(활성 admin ≥ 1 · sort_order NULL 은 순서 저장 전 신규뿐 · 총원 = 실직원 + zzU · zzU 외 8필드 불변 · schema_version 불변).

```
# 사전: 위젯을 TC_DEBUG_PORT=9222 로 띄우고 admin 계정으로 로그인 · $env:TC_TEST_DB_ADMIN_PW
node tests/loop-user-admin.mjs                 # 시각 기반 시드
node tests/loop-user-admin.mjs --seed=66       # 재현
```

**종료코드**: 통과=0 · 실패 또는 복원 실패=1 · 자격 없음/선행 조건 미달(활성 admin 2 미만이면 C13 판정 없음)=2.
정리는 시작(sweep)·종료(finally)·프로세스 exit 그물 세 겹이다 — 시험 계정(zzU) 삭제 · 로그인 계정 권한 복원 · 실직원 sort_order 복원.
알려진 구멍(§7-1a: 퇴사자 보기를 끈 채 순서 저장 → 퇴사자 순번 충돌)은 C15 가 재현만 하고 실패로 두지 않는다.
배포 전 게이트 규약: **무작위 시드로 5회 연속 통과**, 한 번이라도 실패하면 1부터 다시 센다(2026-09-10 실측: 5/5).
