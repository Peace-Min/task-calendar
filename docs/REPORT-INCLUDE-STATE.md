# 보고서 포함 상태(포함/기타) + 보고서 창 X: 기획서

> 2026-10-06, 대상 v0.19.x 다음 판. 작업 폴더 `work/20261006-1420-report-include-state`(기획, 개발, QA 기록). 개발과 QA 의 정본.

## 0. 요구

지금은 '내 과제'에 등록한 과제가 전부 보고서에 과제 행으로 나간다. 사용자가 과제마다 보고서에서 어떻게 보일지 정하고(포함 또는 기타), 보고서를 쓰는 순간에는 특정 과제를 그 보고서에서만 뺄 수 있게 한다.

사용자 결정(2026-10-06 인터뷰):

- 저장되는 상태는 둘: **포함**(기본, 지금과 같음) / **기타**(그 과제의 업무와 공수가 보고서의 '기타' 행으로 합쳐짐).
- 영구 '제외' 상태는 두지 않는다. 대신 보고서 창에서 과제 행마다 **X** 로 그 보고서에서만 뺀다. 업무와 공수(시간)를 함께 뺀다. 창을 닫으면 모두 돌아온다(저장하지 않음). 창 안에서 되돌리기.
- 포함/기타는 서버 DB 에 저장한다(어느 PC 에서든 같음).
- '내 과제' 각 줄에서 바로 바꾼다(작은 전환 버튼 [포함 | 기타], 누르면 바로 저장).
- 모든 보고서에 적용: 일간, 주간, 기간 취합, 복사, 회사 전송(netcus 일간/주간).

## 1. 현재 동작(2026-10-06 조사)

| 영역 | 지금 | 근거 |
|---|---|---|
| 보고서 행 | 등록 과제 전부(내용 없어도 행) + 미분류가 있으면 '기타'(`__uncat__`) 행. 이름이 '기타'인 과제가 있으면 미분류가 그 과제로 합쳐지고 맨 뒤 | `collectReportData` |
| 공수 | (날짜 x 과제) 공수표 `getTaskHours(date, key)` 하나 | `reportDailyHours`, `buildWeeklyFields` |
| 행 빼기 | '내용 없는 항목 제외'(제목 0개이고 공수 0인 행)뿐 | `collectReportData` 의 `skipEmpty` |
| DB | `cal_category` 에 보고서 관련 컬럼 없음(schema_version 12) | `db/deploy/schema-calendar.sql` |

## 2. 목표 동작

| # | 상황 | 동작 |
|---|---|---|
| T1 | 내 과제 줄 | ▲▼ 옆에 [포함 \| 기타]. 누르면 바로 저장(저장 1회). 지금 값은 버튼 모양과 `aria-pressed`. 그룹 이름 `보고서 묶음: 과제명` |
| T2 | 기타로 둔 과제 | 보고서에 자기 행이 없다. 그 과제의 일정, 할 일, 커밋 제목과 (날짜 x 과제) 공수가 '기타' 행으로 간다. 사용자 '기타' 과제가 있으면 그 행, 없으면 미분류 '기타'(`__uncat__`) 행. '기타' 행은 맨 뒤 |
| T3 | 보고서 창 X | 일간/주간/기간 취합 미리보기의 행 카드마다 X('기타' 행 포함). 누르면 그 행(업무와 공수)이 미리보기, 복사, 회사 전송에서 함께 빠진다 |
| T4 | 뺀 과제 막대 | 요약줄 아래 `뺀 과제 N개` + 과제별 되돌리기(`되돌리기: 과제명`) + `모두 되돌리기`. 비면 숨김 |
| T5 | 전부 뺐을 때 | 미리보기는 비고 요약줄은 `모든 과제를 뺐습니다. 되돌리기로 다시 넣을 수 있습니다`. 복사는 '복사할 내용이 없습니다', 전송은 '보낼 내용이 없습니다' |
| T6 | 일간 공수 입력칸 | 지금처럼 실재 과제 자기 id 에만 저장한다. 합쳐진 공수가 있으면 옆에 `기타로 합친 과제 Nh 포함` |
| T7 | 서버 끊김 | [포함 \| 기타] 를 눌러도 바뀌지 않고 기존 잠금 안내가 뜬다(관문 `guardEdit`) |
| T8 | XML 사본 | 내보내기는 기타일 때만 `reportGroup="etc"` 속성. 옛 XML(속성 없음)은 모두 포함 |

### 2.1 보고서 창 X 의 수명

- **창 단위**다. 모듈 변수 `rptExcluded`(Map: 행 키 → 과제명) 하나에만 있다.
- 일간, 주간, 기간 취합 탭을 오가도 유지된다(키가 과제 id 라 어느 기간에도 맞는다). 날짜를 바꿔도 유지된다.
- `openReport` 의 첫 문장과 `closeOverlay`(보고서 창을 닫는 모든 길)에서 비운다. 서버에도 localStorage 에도 쓰지 않는다(`tc_rptSources` 에 섞이지 않는다).
- 막대 개수는 이번 렌더에서 실제로 빠진 행만 센다. 뺀 뒤 그 과제를 기타로 바꾸면(행이 없어지면) 개수에서 빠지고, 다시 포함으로 돌리면 빠진 채로 돌아온다.
- 포커스: X 를 누른 뒤에는 막대의 그 과제 되돌리기 버튼, 되돌리기 뒤에는 되살아난 카드의 X, 모두 되돌리기 뒤에는 첫 카드의 X.

### 2.2 범위 해석(사용자 결정 2026-10-06)

1. **회사 기록(netcus) 출처에는 X 만 적용되고, 기타 묶기는 캘린더 출처 보고서에만 적용된다.** 주간/기간 취합에서 출처가 netcus 일간보고 병합(`net`)이나 netcus 주간보고 병합(`week`)이면, 그 미리보기의 카드마다 X 가 있고 복사와 `net` 출처의 주간 전송에서도 빠진다. netcus 기록의 과제는 이름으로만 이어져 불안정하므로 기타로 합치지 않는다(기타로 둔 과제도 netcus 출처에서는 자기 이름 카드로 보인다). 매칭된 과제는 캘린더 출처와 같은 키(과제 id)라 한 번 빼면 두 출처에서 함께 빠진다. '[미분류]' 블록도 X 로 뺄 수 있다(키 `__nc_uncat__`).
2. **기타로 둔 과제의 시간은 일간 보고서에서 '기타' 행으로만 적을 수 있다.** 그 과제의 행과 공수 입력칸이 사라지기 때문이다. 사용자 '기타' 과제가 있으면 그 행의 입력칸에 적고, 없으면 미분류 '기타' 행에는 입력칸이 없다(전과 같음. 실재 과제가 아니라 DB 에 저장할 곳이 없다). 이미 그 과제 id 로 적어 둔 공수는 '기타' 행 합계에 그대로 들어간다.

## 3. 데이터, DB, XML 계약

| 자리 | 계약 |
|---|---|
| 앱 상태 | `category.reportGroup` = `'include'`(기본) \| `'etc'`. 판독은 `catReportGroup(c)` 하나: `'etc'` 일 때만 `'etc'`, 그 밖(키 없음, null, 1, 'ETC', 'exclude' 등)은 전부 `'include'`. `isEtcCat(c)` |
| 바꾸기 | `setCategoryReportGroup(id, group)`: `guardEdit()` → 과제 없음이나 같은 값이면 false → 값 변경 → `save()` 1회 → true |
| DB | `cal_category.report_group VARCHAR(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT 'include'`, `AFTER uses_repo`, `CONSTRAINT chk_cal_category_rgroup CHECK (report_group IN ('include','etc'))`. schema_version 12 → 13 |
| 마이그레이션 | `db/deploy/migrate-2026-10-06-category-report-group.sql`. 멱등(컬럼, CHECK 가 있으면 건너뜀), 가드 `schema_version IN ('12','13')`, 차단형 사후 검증 |
| 읽기 | `CalendarDb` 부팅 조회(`catSql`)가 `c.report_group` 을 SELECT 하고 모든 과제 객체에 `reportGroup` 키를 **항상** 싣는다(usesRepo 바로 뒤). `ExpectedSchemaVersion = "13"` |
| 쓰기 | `CalendarWriteDb.CategoryParams` 의 `@rg` = `S(c,"reportGroup") == "etc" ? "etc" : "include"`. 과제 UPDATE SET 과 INSERT 컬럼 목록 양쪽에 `report_group` |
| XML | `toXML` 은 `'etc'` 일 때만 `reportGroup="etc"`(포함 과제는 옛 파일과 같은 바이트). `fromXML` 은 키를 항상 만든다. `xmlRoundTrip` 도 이 값을 본다 |
| 손대지 않는 곳 | 타인 열람(peer) 조회, xml-to-db 이관 도구(DEFAULT 가 메운다) |

### 3.1 보고서 수집(`collectReportData`)

- `catKey`: 과제가 없거나 `isEtcCat` 이면 '기타' 키(사용자 '기타' 과제 id, 없으면 `__uncat__`).
- rows 는 etc 과제를 뺀다(사용자 '기타' 과제 자신은 etc 여도 남는다). etc 과제가 있고 사용자 '기타' 과제가 없으면 `__uncat__` 행을 만든다(제목이 없어도).
- 각 row 의 `hourKeys`: 일반 행 `[key]`, 사용자 '기타' 행 `[자기 id, ...etcIds]`, `__uncat__` 행 `['__uncat__', ...etcIds]`. 중복 없이, 어느 과제의 공수도 한 행에서 한 번만 더한다.
- `reportRowHours(row, date)` = hourKeys 의 `getTaskHours` 합(전부 비면 null). 일간 헤더, 일간 전송 hours(`reportDailyHours`), 주간 content(`buildWeeklyFields`), 내용 없는 항목 판정(`rangeTaskHours`)이 이 값을 쓴다.
- `sources.exclude` 가 있으면 '기타' 맨 뒤 정렬과 '내용 없는 항목 제외' 뒤 **맨 마지막**에 거른다. 반환은 `{ rows, excluded }`(excluded = 이번에 빠진 행 `[{key, name}]`).
- etc 과제가 없으면 출력이 이전과 바이트 단위로 같다(A1, `tests/tools/report-golden.mjs` 로 기준 커밋과 맞댄다).

### 3.2 다섯 호출부

보고서 창의 출처는 `rptReportSources()` = `rptSources()`(체크박스) + `{ exclude: rptExcluded }` 이다. `rptSources()` 자체는 exclude 를 모른다(`saveRptSourcePrefs` 가 그대로 저장하는 객체다). 다섯 곳이 모두 `rptReportSources()` 를 지난다.

| # | 자리 | 무엇 |
|---|---|---|
| ① | `buildWeeklyFields(from, to, sources)` 의 기본 인자 | 주간 필드 |
| ② | `buildReport` 의 `src` | 미리보기 |
| ③ | `buildReportText` | 복사와 일간 전송 본문 |
| ④ | `#btnRptSend` 일간의 `rptHours` | 일간 전송 hours |
| ⑤ | `#btnRptSend` 주간의 `buildWeeklyFields(from, to, rptReportSources())` | 주간 전송 |

`rptSources()` 를 직접 부르는 곳은 `saveRptSourcePrefs` 와 `rptReportSources()` 안, 둘뿐이다.

netcus 출처는 순수 헬퍼 `netcusParsedWithout(parsed, exclude)`(키 함수 `ncRowKey(t)`: 매칭된 과제는 `t.catId`, 아니면 `'nc:' + 정규화 이름`)로 거른 사본을 쓴다: `renderNetcusPreview`, `renderNetcusWeeklyPreview`, `buildReportText` 의 net/week 분기, `#btnRptSend` 의 `net` 주간 전송. 캐시(`netcusMerge.parsed`)는 원본 그대로 두고 그릴 때마다 거른다. `buildNetcusSendText/HoursText/PlanText/WeeklyText` 와 파서는 손대지 않는다(전역 없이 도는 순수 함수다).

## 4. 알려진 위험

1. **업그레이드된 DB + 구버전 위젯(v0.19.1 이하)**: 무해하다. 구버전의 과제 INSERT 는 `report_group` 을 모르지만 `DEFAULT 'include'` 가 메운다. 다만 구버전 위젯으로 과제를 저장하면 그 과제의 기타 설정이 포함으로 되돌아갈 수 있다(구버전은 이 값을 모르고 저장한다). 모든 PC 의 위젯을 새 판으로 올리면 사라진다.
2. **새 위젯 + 마이그레이션 안 한 v12 DB**: 부팅 과제 조회(`catSql` 의 `c.report_group`)가 **ERROR 1054 로 죽어 과제 목록이 통째로 빈다.** 판번호 게이트는 평소 조회를 막지 않는다(전량 교체만 막는다). 그래서 **DB 를 먼저 올린다**(`db/deploy/README.md` 적용 순서표와 경고 상자).
3. **xml-to-db 이관 도구**: 이 컬럼을 쓰지 않는다. DEFAULT 'include' 로 들어간다(옛 XML 은 모두 포함이라 결과가 같다).

## 5. 시험과 루프

| 파일 | 무엇 |
|---|---|
| `tests/report-include-state.test.mjs` | 정적 계약(헬퍼, 저장 순서, 마크업, XML, 수집, 다섯 호출부, netcus 순수 헬퍼, 수명, 막대 위치) + 변이 + jsdom 행동(A2~A7, netcus 출처, 탭, 전부 빼기, 유령 키, 보존, 이상값) |
| `tests/report-group-db.test.mjs` | DB 계약(정본 DDL, 마이그레이션 표식, 부팅 SELECT 와 키, 저장 SQL) + 변이. 보조 증거 |
| `tests/tools/report-golden.mjs` | A1 골든: 옛 HTML 과 새 HTML 의 보고서 출력(rows, 복사, 공수, 주간 필드, 전송 payload)을 바이트로 맞댄다 |
| `tests/loop-report-include.mjs` | 실 위젯 루프(CDP, 비밀번호 불필요): 진짜 클릭으로 기타 → 저장 1회 → reloadState → 보고서 기타 묶기 → X → 주간 → 창 닫기 복귀 → 끊김 중 전환 |
| `tests/loop-migrate-report-group.mjs` | 실 MySQL 마이그레이션 증명(비밀번호는 env `TC_TEST_DB_ADMIN_PW` → `MYSQL_PWD`): 스크래치 DB 에서 v12 강등 → 1회차 → 2회차(멱등) → v12 꼴 INSERT → 가드 |
| `tests/loop-calendar-write.mjs` | 호스트 왕복: 오남용 값('ETC', 1, null, 'exclude')은 include 로, etc 는 etc 로 되읽힌다. 연속 저장과 전량 교체(XML 가져오기) 절 포함 |
| `tests/calendar-adapter.mjs` | XML 대 DB 심층 비교: synth 픽스처에 etc 과제, 상시 키 검사, 변이 M21/M22 |
| `tests/loop-category-order.mjs` | C4 '모든 포함 과제가 행'(기타로 합친 과제 제외) |

**로컬 `dist/rehearsal/run-loops.ps1` 사본의 `$once` 에 `loop-report-include` 와 `loop-migrate-report-group` 을 추가해야 한다**(dist 는 git 에 없다). 같은 파일 4단계(taskmgr → taskcalendar cal_* 복사)는 두 DB 의 공통 컬럼만 옮기도록 바꿨다(새 컬럼 때문에 `SELECT *` 가 ERROR 1136 으로 깨진다).

## 6. 보류 기록

- `docs/DB-SCHEMA.html`, `db/table-design-report.html` 재생성(`tools/schema-report`, 실 DB 와 env 비밀번호 필요)은 실 DB 마이그레이션 뒤 마스터가 돌린다. 이 작업에서는 하지 않는다(`tools/schema-report/build-schema-html.mjs` 의 이력 표에 13 줄을 그때 더한다).
- 폐쇄망 PC 의 실제 DB 마이그레이션 실행은 사용자 단계다(스크립트만 제공).

## 7. 범위 밖

- 영구 '제외' 상태(사용자가 필요 없다고 결정).
- X 로 뺀 상태를 날짜나 기간별로 기억하기(창을 닫으면 초기화가 결정).
- 다른 사람 일정 열람 창, 관리 화면, 공식 과제 원본(DB `project`)의 변경.
- 근태, 초과시간 등 과제 행이 아닌 보고서 항목.
- 버전 갱신(릴리스)과 배포.
