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
├─ loop-org-compat.mjs        ★ 별도 실행 전용(MySQL 필요·복제본에서만 씀) — org_unit 완전 절단 루프, 아래 참조
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
