# 과제관리 DB 테이블 설계와 유지보수 기준

> **대상 독자**: 이 DB를 이어받아 유지·확장할 사람 (PM·후임 개발자)
> **범위**: `taskmgr` 데이터베이스의 테이블 구조, 식별·유니크 규칙, 그 결정 근거와 유지보수 지침
> **관련**: 배포/운영은 [`ARCHITECTURE.md`](ARCHITECTURE.md), 진행 계획은 [`ROADMAP.md`](ROADMAP.md), DDL은 [`deploy/schema-structure.sql`](deploy/schema-structure.sql)(옛 `schema.sql` 은 2026-10-15 에 지웠다)
> **최종 갱신**: 2026-10-15 (ADR-23: 코드표를 번호 키로, `schema_version` 13). 그 전은 2026-07-24 (ADR-21, 22: 유니크 규칙 재정의, 구분/상태 코드테이블 전환, note 컬럼)
> **DB 이름**: 지금 앱이 쓰는 DB 는 `taskcalendar` 다. 이 문서가 `taskmgr` 이라 적은 곳은 옛 DB(과제 트랙 원본) 이야기다.

---

## 1. 한 장 요약

- **DB가 원본(source of truth)**: Admin이 캘린더 앱으로 과제를 관리하고, Excel은 DB에서 뽑는 리포트다.
- **테이블은 4개**: `customer`(발주처) + `section_code`/`status_code`(구분·상태 코드) + `project`(과제). 셋 다 `project`의 FK 타겟인 룩업이고, 과제 본체는 하나뿐이다.
- **코드표는 번호가 기본키다**(2026-10-15, ADR-23). `customer_id`, `section_id`, `status_id` 가 기본키이고 `name` 은 `UNIQUE` 라벨이다. `project` 는 `customer_id`, `section_id`, `status_id` 로 번호를 가리킨다.
- **구분/상태는 ENUM이 아니라 룩업 코드테이블**(2026-07-24)이고, 발주처와 대칭이다. 런타임에 추가/개명/순서변경/숨김이 가능하고, FK가 무결성을 승계한다(없는 값 거부). 개명은 라벨 한 행 `UPDATE` 이고 화면은 조인으로 따라온다.
- **과제의 정체성은 이름이 아니라 `uid`(UUID)다.** 같은 이름의 과제가 여럿 존재할 수 있다(구성품별 계약·연도별 갱신). 실데이터가 이를 증명했다.
- **이름 기반 하드 유니크 제약은 두지 않는다.** 대신 앱에서 "비슷한 과제가 있습니다" **소프트 경고**로 실수 중복을 거른다.
- 삭제는 소프트(`is_active=0`). 발주처, 구분, 상태 개명은 그 표의 `name` 한 행만 바꾼다(과제 행은 번호를 들고 있어 바뀌지 않는다).
- **동작이 묶인 코드는 고정 번호로 판정한다**: 구분 2=선진행, 상태 2=종료. 이 두 행은 숨기거나 지울 수 없고 이름은 바꿀 수 있다(§2.5).

---

## 2. 테이블: `customer` (발주처 마스터)

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `customer_id` | SMALLINT UNSIGNED | **PK**, AUTO_INCREMENT | 발주처 번호. `project.customer_id` 가 가리킨다(2026-10-15, ADR-23) |
| `name` | VARCHAR(100) | NOT NULL, **UNIQUE**(`uq_customer_name`), CHECK `name<>''` | 발주처명(라벨). 옛 기본키가 하던 중복 막기를 넘겨받았다(ai_ci 라 대소문자만 다른 이름도 막는다) |
| `is_active` | TINYINT(1) | NOT NULL, 기본 1, CHECK `IN (0,1)` | 소프트 삭제(0=숨김) |
| `created_at` | DATETIME(3) | NOT NULL, 자동 | 생성 시각 |
| `updated_at` | DATETIME(3) | NOT NULL, 자동 | 수정 시각(자동 갱신) |

- 발주처는 **이름만** 관리한다(담당자·연락처 등 없음). 원본 장표의 발주처 시트가 이름 목록뿐이었다.
- **개명**: `UPDATE customer SET name=? WHERE customer_id=?` 한 행이다. 과제는 번호로 가리키므로 따라 고칠 것이 없고, 화면은 조인으로 새 이름을 읽는다.
- **삭제**: 앱은 숨김(소프트 삭제)이 기본이고, 영구 삭제는 휴지통에서 쓰는 과제가 0건일 때만 된다(최종 보증은 FK `ON DELETE RESTRICT`).
- 2026-10-15 전에는 `name` 이 기본키였고 `project.customer` 가 이름을 들고 있었다(`ON UPDATE CASCADE` 로 개명 전파). 바꾼 이유는 §9 ADR-23.

> **감사 컬럼(`created_at`/`updated_at`)의 값은 UTC다.** 서버 기본값 `CURRENT_TIMESTAMP(3)`는 세션 `time_zone`으로
> 평가되고 이 서버의 `time_zone`은 `SYSTEM`(KST)이므로, 그것이 UTC로 평가되는 근거는 **접속 프리앰블의
> `SET SESSION time_zone='+00:00'` 하나뿐이다**(`ProjectDb`의 읽기/쓰기 양쪽, 2026-09-09 신설).
> **프리앰블 없는 쓰기 주체를 새로 만들면 한 컬럼에 KST와 UTC가 섞이고 되돌릴 수 없다**.
> `DATETIME`에는 '한 번 밀렸는지'를 사후에 가릴 수단이 없다. 2026-09-09 이전 행은 실제로 KST로 적혀 있었고
> `deploy/migrate-2026-09-09-integrity.sql`(2026-10-15 에 지웠다. git 이력에 있다)이 **-9h 1회 정규화**로
> 되돌렸다(그래서 그 파일은 재실행 안전이 아니다). 이 표뿐 아니라 `project`, `section_code`, `status_code`,
> `app_user` 계열의 감사 컬럼이 전부 같은 근거 위에 있다.

---

## 2.5 테이블: `section_code` / `status_code` (구분·상태 코드, 발주처와 대칭)

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `section_id` / `status_id` | SMALLINT UNSIGNED | **PK**, AUTO_INCREMENT | 코드 번호. `project.section_id`/`project.status_id` 의 FK 타겟(2026-10-15, ADR-23) |
| `name` | VARCHAR(50) | NOT NULL, **UNIQUE**(`uq_section_code_name`/`uq_status_code_name`), CHECK `name<>''` | 코드값(라벨) |
| `sort_order` | INT | NOT NULL, 기본 0 | 드롭다운 정렬(작을수록 먼저). 앱 ▲▼로 재부여 |
| `is_active` | TINYINT(1) | NOT NULL, 기본 1, CHECK `IN (0,1)` | 소프트 삭제(0=숨김, 새 과제 선택에서 빠짐) |
| `created_at`/`updated_at` | DATETIME(3) | NOT NULL, 자동 | 감사 |

- **왜 코드테이블인가**: ENUM은 값 추가/개명/순서변경에 `ALTER TABLE`이 필요하고 런타임 관리가 불가능하다. 코드테이블 + FK면
  발주처와 똑같이 앱에서 관리(추가는 INSERT, 개명은 `name` 한 행 UPDATE, 재배치는 `sort_order`, 숨김은 `is_active`)하면서
  무결성은 FK가 승계한다(내부망 LLM의 직접 SQL 대량 INSERT에서도 없는 번호를 DB가 거부).
- **표준 시드(번호 명시)**: section 은 1 일반계약(10), **2 선진행**(20), 3 사업부관리(30). status 는 1 진행중(10), **2 종료**(20), 3 1차 납품완료(30), 4 미정(40). 괄호는 `sort_order`. 정본은 `deploy/schema-structure.sql` 끝의 `INSERT` 두 줄이다.
- **고정 번호와 보호**: 앱(웹과 호스트)은 이름 글자가 아니라 **번호로** 동작을 판정한다. 구분 2(선진행)는 계약 날짜와 상태를 비우고 잠그고, 상태 2(종료)는 '진행중만' 필터에서 빠지고 엑셀에서 회색이다. 이 두 행은 **숨김과 삭제를 막고**(호스트가 거부하고 웹은 버튼을 끈다) **개명과 순서 바꾸기는 허용**한다. 색만 묶인 행은 막지 않는다. 구분 색은 웹 코드의 색 표(`DB_SECTION_COLORS`)가 번호 기준으로 들고 있다. 상세는 [`CALENDAR-TABLE-DESIGN.md`](CALENDAR-TABLE-DESIGN.md) §5.6.3-a.
- **개명**: `UPDATE section_code SET name=? WHERE section_id=?` 한 행. 그 값을 쓰는 과제 행은 바뀌지 않고, 화면은 조인으로 새 이름을 읽는다.
- **삭제**: 숨김(소프트)이 기본. 참조 중인 코드값은 `ON DELETE RESTRICT`로 하드삭제가 막힌다.
- **`status_id`는 nullable**이다. `NULL`(상태 없음. 선진행이면 비운다)이면 FK 검사를 스킵한다(정상).

---

## 3. 테이블: `project` (과제 마스터, 핵심)

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | **PK**, AUTO_INCREMENT | 내부 대리키. 외부에 노출/참조하지 않음 |
| `uid` | CHAR(36) | **UNIQUE**, 기본 `UUID()` | **외부 안정 식별자.** 일정이 `db-<uid>`로 참조. rename, 덤프복원, 서버이관에도 불변 |
| `section_id` | SMALLINT UNSIGNED | NOT NULL, **FK→section_code.section_id** | 구분 번호. ON UPDATE RESTRICT / DELETE RESTRICT |
| `customer_id` | SMALLINT UNSIGNED | NOT NULL, **FK→customer.customer_id** | 발주처 번호. ON UPDATE RESTRICT / DELETE RESTRICT |
| `project_name` | VARCHAR(200) | NOT NULL | 사업명 |
| `contract_name` | VARCHAR(200) | NOT NULL, 기본 `''` ¹ | 계약명 |
| `common_name` | VARCHAR(200) | NOT NULL, 기본 `''` ¹ | 통상명칭 |
| `start_date` | DATE | NULL | 계약시작일(선진행/미정=NULL) |
| `end_date` | DATE | NULL | 계약종료일(선진행/미정=NULL) |
| `dev_end_date` | DATE | NULL | **개발종료일**. 계약종료일과 **별개**(개발 완료 목표·실제). **선진행이어도 잠그지 않는다**(계약 전이어도 개발은 진행 중이라 이 날짜만이 의미를 갖는다). 미정=NULL. 목록 행에는 안 나온다(폭 고정). 상세, 편집, Excel 전용 |
| `status_id` | SMALLINT UNSIGNED | NULL, **FK→status_code.status_id** | 상태 번호(NULL=상태 없음, FK 스킵). RESTRICT / RESTRICT |
| `note` | VARCHAR(500) | NOT NULL, 기본 `''` | **비고**. 관리 화면 전용 내부메모. **캘린더·보고서엔 미노출** |
| `is_active` | TINYINT(1) | NOT NULL, 기본 1, CHECK `IN (0,1)` | 소프트 삭제(0=숨김) |
| `created_at` / `updated_at` | DATETIME(3) | NOT NULL, 자동 | 감사. **값은 UTC**. 그 근거는 접속 프리앰블의 `SET SESSION time_zone='+00:00'` 하나뿐이다(2026-09-09 신설. §2 발주처 표 아래 주 참조) |

**인덱스·FK**
- `PRIMARY KEY (id)`
- `UNIQUE KEY (uid)`: 외부 참조 무결성(assign-once)
- `KEY ix_project_customer_id`, `KEY ix_project_section_id`, `KEY ix_project_status_id`, `KEY ix_project_active`: 조회 보조, FK 받침
- `FK fk_project_customer_id` → customer.customer_id (ON UPDATE RESTRICT / ON DELETE RESTRICT)
- `FK fk_project_section_id` → section_code.section_id (RESTRICT / RESTRICT)
- `FK fk_project_status_id` → status_code.status_id (RESTRICT / RESTRICT. NULL이면 스킵)
- `CHECK chk_project_active (is_active IN (0,1))`. 계약일 순서 CHECK(`start_date <= end_date`)는 아직 없다. 실데이터 역전은 0건이었고(로컬 `taskcalendar`, 원본 `taskmgr`, 2026-10-15) 넣을지는 따로 정한다
- 번호는 바뀌지 않으므로 갱신 전파(CASCADE)가 필요 없다. 2026-10-15 전에는 이름 열 `customer`, `section`, `status` 와 `fk_project_customer`(ON UPDATE CASCADE) 등이 있었다
- ~~`UNIQUE KEY (customer, project_name)`~~: **제거**(§4 참조)

> **note**: 관리 화면(편집 폼)에서만 읽고 쓰는 내부 메모다. 편입분(앱 XML `state.categories`)에도, 캘린더·보고서 전시에도
> 절대 노출하지 않는다(라벨 최소 메타 = `name`/`color`만, ADR-18과 같은 원칙).

> ¹ **2026-07-24 목표 설계, 반영 완료(실측 2026-09-09).** `contract_name`/`common_name`의 `NOT NULL DEFAULT ''`와 `uq_project` 제거는 실 `taskmgr`에 들어가 있다(`information_schema` 직접 조회: 두 컬럼 `IS_NULLABLE=NO`에 기본값 `''`, `project`의 유니크 인덱스는 `PRIMARY`와 `uq_project_uid` 뿐). 원문은 *"코드 반영 전이면 현재 `schema.sql`(2026-10-15 에 지웠다)은 이전 정의일 수 있다. 이 문서가 기준이며 반영은 별도 작업으로 추적한다"*였다. 그 추적은 끝났다.

---

## 4. ★ 식별·유니크 규칙 (가장 중요한 결정)

### 4.1 결정: 이름 기반 하드 유니크를 두지 않는다

| 규칙 | 결정 | 이유 |
|---|---|---|
| 과제 정체성 | **`uid`(UUID) 하드 유니크** | 이름은 정체성이 아님. UPSERT·일정 참조 모두 uid 기반 |
| `(customer, project_name)` 유니크 | **제거** | 정당한 중복이 다수 존재(아래 실데이터) |
| 이름 조합 유니크 전반 | **두지 않음** | 어떤 이름 조합으로도 실데이터의 유일성을 깔끔히 정의할 수 없음 |
| 실수 중복 방지 | **앱 소프트 경고**(하드 제약 아님) | 정규화 비교로 오히려 더 촘촘히 잡음 |

### 4.2 근거: 실데이터 144건 검수 (2026-07-24)

*아래 예시는 형태 설명용 더미다.*

- **`(발주처, 사업명)` 중복: 22조합 / 68건**. 정당한 **구성품별 계약**이다.
  ```
  (발주처A, 체계1, 저장장치)
  (발주처A, 체계1, 처리장치)   ← 같은 사업명, 계약명만 다름 = 정상
  ```
  원래 `UNIQUE(customer, project_name)`은 이 도메인에 **틀린 규칙**이었다.

- **`(발주처, 사업명, 계약명)` 중복: 1조합 / 2건**. **연도별 갱신** 유지보수 계약이다.
  ```
  (발주처B, ○○유지보수, ○○유지보수)  2024–2025 종료
  (발주처B, ○○유지보수, ○○유지보수)  2026–2027 진행중   ← 이름 4컬럼 동일, 날짜만 다름
  ```
  **매년 반복**된다. 계약명을 키에 넣으면 갱신마다 이름에 연도를 손으로 붙여야 한다(영구적 땜질·계약서명과 불일치). 그래서 계약명 포함 유니크도 채택하지 않는다.

- **보이지 않는 차이(데이터 위생)**:
  ```
  (발주처C, 체계2, 개발벤치SW)
  (발주처C, 체계2, 개발벤치SW␣)   ← 끝에 공백. 사람 눈엔 동일
  ```
  하드 유니크(`utf8mb4_0900_ai_ci`, NO PAD)는 이 둘을 **다른 값으로 통과**시킨다 = 진짜 실수를 못 잡는다. **쓰기 시 TRIM + 소프트 경고의 정규화 비교**가 이걸 잡는다.

### 4.3 소프트 경고 규칙 (실수 중복 방지)

저장 시 이름을 **정규화**(TRIM + 연속공백 축소, ai_ci 대소문자/악센트 무시)한 뒤 `(customer, project_name, contract_name)`이 기존 행과 같으면 **막지 않고 경고**한다:

> "비슷한 과제가 이미 있습니다: … 그래도 추가하시겠습니까?"

- 연도 갱신이나 구성품 차이면 확인 후 진행한다(정당한 별건).
- 오타나 공백 변형이면 사용자가 알아채고 정정한다.
- 하드 제약과 달리 **정규화 비교라 공백 변형까지 포착**된다.

---

## 5. 데이터 규칙

| 항목 | 규칙 |
|---|---|
| `section_id` | 코드테이블(section_code)에 있는 번호만. 없는 번호는 FK 거부(ERROR 1452). 표준 3값 + 앱에서 추가 가능 |
| `customer_id` | 발주처(customer)에 있는 번호만. 같은 FK 규칙 |
| `status_id` | 코드테이블(status_code)에 있는 번호 또는 NULL(상태 없음). 표준 4값 + 앱에서 추가 가능 |
| **선진행(계약 전, `section_id`=2)** | `start_date`, `end_date`, `status_id` = NULL (`dev_end_date` 는 잠그지 않음, 계약 전이어도 개발은 진행 중). 앱은 이름이 아니라 번호 2 로 판정한다 |
| 날짜 | `'YYYY-MM-DD'` 또는 NULL |
| 이름 필드 쓰기 | **앞뒤 공백 TRIM**(위생) |
| 빈 계약명/통상명칭 | `''`(빈 문자열)로 저장, NULL 금지(비교 함정 방지) ¹ |
| `-`/공백 사업명(레거시) | 이관 시 계약명으로 대체 후 TRIM |

---

## 6. 관계 & 무결성

```
customer(customer_id)    1 ────< project(customer_id)   FK ON UPDATE RESTRICT / DELETE RESTRICT
section_code(section_id) 1 ────< project(section_id)    같음
status_code(status_id)   1 ────< project(status_id)     같음 (status_id NULL 허용)
project(uid)             ────< cal_category(project_uid)  ※ 외래키가 아닌 외부 식별자('db-<uid>')
```

- 발주처, 구분, 상태를 **개명**하면 그 표의 한 행만 바뀌고, 과제 화면은 조인으로 새 이름을 보인다. 과제 행은 그대로다.
- 참조하는 과제가 있으면 코드 행 **하드 삭제 불가**(RESTRICT). 숨기려면 소프트 삭제.
- 사용자 쪽도 같은 모양이다. `app_user.title_id` 가 `title_code.title_id` 를 가리킨다(DDL 은 회사 저장소 `01-schema-users.sql`).
- 일정↔과제 링크는 `uid` 기반이라 **채번·이관에도 안 깨진다**. `cal_category.project_uid` 는 FK 가 아니라 외부 식별자다(웹과 XML 의 `db-<uid>` 정체성).

---

## 7. 유지보수 지침

### 7.1 과제 추가
- **앱(권장)**: 발주처, 구분, 상태 관리에서 코드값을 먼저 넣고 새 공식 과제를 만든다. FK·소프트경고를 앱이 대신 지켜준다.
- **대량(내부망 LLM)**: `deploy/load-template.sql` 규칙대로 INSERT 생성. 순서는 코드값(section/status)과 발주처가 먼저, 과제가 나중이다. 과제는 **이름으로 적어 임시 표에 넣고, 템플릿 끝에서 이름으로 번호를 찾아** `project` 로 옮긴다(못 찾는 이름이 하나라도 있으면 멈춘다). `id`/`uid`/감사컬럼은 넣지 않는다(자동).

### 7.2 발주처, 구분, 상태 이름 변경
- 앱 관리 화면에서 바꾸면 그 표의 `name` 한 행만 바뀐다(`WHERE <id>=?`). 과제는 번호로 가리키므로 수동 UPDATE 가 필요 없고, 화면은 조인으로 새 이름을 읽는다.
- 선진행(구분 2)과 종료(상태 2)도 이름은 바꿀 수 있다. 동작은 번호에 묶여 있어 그대로다. 숨김과 삭제는 막힌다(§2.5).

### 7.3 서버 구축 (개발자 PC → 회사 서버)
```
진입점: deploy/setup-taskcalendar.cmd -DbHost <서버>
        스키마 파일로 taskcalendar 를 처음부터 만들고(코드표 기본 행은 고정 번호),
        원본 taskmgr 에서 과제 트랙을 복사하면서 코드표 이름을 번호로 바꾸고, 앱 권한과 검증까지 한다
앱:    DeployConfig.DbHost 를 새 서버로 바꿔 재빌드
```
구조를 다시 설계하지 않는다. 같은 스크립트를 새 서버에서 실행하면 동일 구조가 재현된다. 옛 진입점(`schema.sql`, `init-db.cmd`, `migrate.cmd`)은 2026-10-15 에 지웠다.
이미 데이터가 있는 v12 DB(개발자 로컬)는 `deploy/migrate-2026-10-15-code-ids.sql` 한 번으로 v13 으로 옮긴다(백업 먼저. 실행법은 [`deploy/README.md`](deploy/README.md)).

### 7.4 하지 말 것
- **이름으로 과제를 식별/조인하지 말 것.** 반드시 `uid`. 이름은 중복될 수 있다.
- **이름 글자로 코드의 동작을 판정하지 말 것.** 선진행, 종료는 고정 번호(구분 2, 상태 2)로 판정한다. 이름은 바뀔 수 있다.
- **연도 갱신을 막으려고 이름에 연도를 붙이지 말 것.** 소프트 경고로 처리한다.
- **데이터 폴더(`*.ibd`) 통째 복사 이관 금지.** `mysqldump` 사용.
- **`setup-taskcalendar`/`schema-structure.sql` 재실행 주의.** 멱등 재구축이라 기존 테이블을 DROP한다(최초 구축용).

---

## 8. 향후 (스키마에 영향 있는 것)

| 시점 | 변경 |
|---|---|
| **P6.5** | `app_user`(=`Employee(NetcusId)`) 테이블 추가. 편집 권한 per-user. 코어 2테이블과 독립이라 지연 무비용 |
| 필요 시 | `updated_by`(누가 수정했는지) 컬럼. 지금은 없음(공유 관리자) |
| 필요 시 | 연도 갱신을 "묶어 집계"할 요구가 크면 `contract_year`/차수 컬럼 검토(현재는 불필요, 반복 1건뿐) |

---

## 9. 설계 결정 로그 (스키마 관련 ADR 요약)

| # | 결정 | 근거 |
|---|---|---|
| - | 모델 B: DB가 원본, Excel은 추출 | 캘린더 결합·Excel 미러 서사 폐기 |
| 13 | 안정 `uid`(UUID) 도입, 일정은 `db-<uid>` 참조 | 채번·이관 불변 |
| **21** | **`(customer, project_name)` 유니크 제거 + 소프트 경고로 대체** *(2026-07-24)* | 실데이터: 구성품별 계약 68건, 연도갱신, 공백변형. 이름 유니크가 도메인과 충돌 |
| **22** | **구분/상태 ENUM → 룩업 코드테이블(section_code/status_code) + FK, note 컬럼** *(2026-07-24)* | ENUM은 런타임 추가/개명/순서/숨김 불가. 발주처와 대칭 코드테이블 + FK CASCADE면 앱에서 관리하고 무결성은 FK가 승계(LLM 직접 INSERT의 오타도 거부). *(키 모양은 ADR-23 이 바꿨다. 코드테이블이라는 결정은 그대로다)* |
| **23** | **코드표 넷(발주처, 구분, 상태, 직급)을 번호 키로** *(2026-10-15, `schema_version` 13)* | 아래 상세 |

### ADR-23: 코드표 넷을 번호 키로 바꾼다 (2026-10-15)

**맥락**
- 검토 지적(2026-08-23): *"외래키로 쓰이는 기본키는 `varchar` 가 아니라 id 로. 서버에 올리기 전에 최적화 거리는 미리 다 해 놓고 옮겨라."*
- 그때까지 `customer`, `section_code`, `status_code`, `title_code` 는 이름이 기본키였고, 자식(`project.customer`, `project.section`, `project.status`, `app_user.title`)이 이름을 들고 `ON UPDATE CASCADE` 로 개명을 받았다. 유지 근거는 [`CALENDAR-TABLE-DESIGN.md`](CALENDAR-TABLE-DESIGN.md) §5.6 의 옛 판정이었다(개명 전파가 실제로 돈다, 공간 이득이 작다, 이미 운영 중이라 옮기는 순이익이 음수다).
- 2026-10-15 확인: 새 DB `taskcalendar` 는 **회사 서버에 아직 없고** 개발자 로컬 PC 가 서버 역할을 한다. "운영 중이라 순이익이 음수" 가 성립하지 않았다. 그리고 옛 판정이 비용으로 센 "개명 전파를 앱 코드로 다시 만들어야 한다" 는 틀렸다(번호 키와 조인이면 라벨 한 행으로 끝난다. §5.6.4-a 정정 주).

**결정**
- 넷의 기본키를 `SMALLINT UNSIGNED AUTO_INCREMENT` 대리키(`customer_id`, `section_id`, `status_id`, `title_id`)로 바꾸고, `name` 은 `UNIQUE` 라벨(CHECK `name<>''`)로 남긴다. 자식 열은 `project.customer_id`, `project.section_id`, `project.status_id`(NULL 허용), `app_user.title_id`(NULL 허용). 외래키는 `ON UPDATE RESTRICT ON DELETE RESTRICT`.
- 동작이 묶인 코드값은 **고정 번호**로 판정한다(구분 2=선진행, 상태 2=종료). 그 두 행은 숨김과 삭제를 막고 개명과 순서 바꾸기는 허용한다. 시드 번호를 명시한다.
- 웹과 호스트 사이의 편집, 관리 메시지는 번호로 주고받고, 표시용 값은 이름과 번호를 함께 보낸다(`org_unit` 선례).
- 데이터가 있는 v12 DB 는 `deploy/migrate-2026-10-15-code-ids.sql`(절단 관문, 사후 검증), 새 DB 는 `deploy/setup-taskcalendar.ps1`(원본 `taskmgr` 복사 때 이름을 번호로). 두 경로의 `information_schema` 가 같아야 한다.
- 결정 문서는 [`../docs/CODE-TABLE-IDS.md`](../docs/CODE-TABLE-IDS.md).

**결과**
- 개명은 `UPDATE <표> SET name=? WHERE <id>=?` 한 행이고, 이름 길이를 바꿔도 자식 열을 건드리지 않는다. 규칙이 하나(외래키가 가리키는 기본키는 번호)라 검토가 쉽다.
- 이름을 보여주는 조회마다 코드표 조인이 붙는다. 호스트가 조회 SQL 에서 조인해 이름과 번호를 함께 보낸다. 원시 행이나 덤프에서 `project` 만 보고는 발주처 이름을 읽을 수 없다(받아들인다).
- 대소문자만 다른 이름을 막던 옛 기본키의 역할은 `UNIQUE(name)`(ai_ci)이 넘겨받는다.
- 실측(2026-10-15, 실데이터 로컬 복제본): 이관의 절단 관문과 사후 검증 0, 재실행은 v12 가드에서 멈춤, 대소문자만 다른 표류는 절단 관문에서 멈추고 옛 열 보존, 이관 결과와 재구축 결과의 `information_schema` 359줄 차이 0.
- `cal_room (user_id, name)`, `cal_schema_meta (k)` 는 그대로 둔다. 가리키는 자식이 없어 검토 규칙의 대상이 아니고, 구조상 지금이 낫다(§5.6.7).

**기각한 안**
- **이름 키 유지**: 2026-08-24 판정. 마지막 근거(운영 중이라 옮기는 비용)가 사실이 아니었고, 비용으로 센 "개명 전파 재구현" 은 틀렸다. 남는 장점(표시할 때 조인이 없음, 원시 행 가독성)은 작다.
- **역할 열**(코드표에 '선진행 역할', '종료 역할' 같은 표시 열을 둠): 동작이 묶인 행이 둘뿐이라 웹과 호스트에 한 곳씩 둔 번호 상수로 충분하다(사용자 결정 2026-10-15). 열을 두면 그 열을 지키는 제약과 관리 화면이 따로 필요해진다.
- **색 열**(구분 색을 DB 에): 색은 웹 코드의 색 표(`DB_SECTION_COLORS`)에 그대로 두고 기준만 이름에서 번호로 바꾼다(사용자 결정 2026-10-15). 표에 없는 번호는 기본색.

*(ADR 전체 목록은 [`ARCHITECTURE.md`](ARCHITECTURE.md) §5)*
