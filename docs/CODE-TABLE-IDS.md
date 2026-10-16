# 코드표 번호 키 전환과 배포 전 스키마 정리 (CODE-TABLE-IDS)

작성 2026-10-15. 0.20.0 에 합친다(0.20.0 은 아직 어디에도 배포하지 않았다).

> **2026-10-16 변경(사용자 결정): 0.20.0 에 합치지 않고 0.21.0 으로 따로 낸다.** 0.20.0(배포 안 함)은 보고서 글 편집 판으로 스키마 v12 그대로 두고,
> 이 문서의 번호 키 전환(스키마 v13)은 0.21.0 이 싣는다. 사내 설치본(0.19.0)은 0.21.0 으로 바로 올린다. 아래 본문의 "0.20.0" 은 0.21.0 으로 읽는다.
> 데이터가 있는 v12 DB 는 이관 SQL 을 손으로 돌리지 않고 마스터 cmd `db/deploy/migrate-code-ids.cmd` 로 옮긴다(판번호와 앱 세션 확인, 백업 검증, `--force` 없는 실행, 실패 판정과 되돌리기 안내).

## 0. 배경과 결정

- 검토 지적(2026-08-23): "외래키로 쓰이는 기본키는 varchar 가 아니라 id 로. 서버에 올리기 전에 최적화 거리는 미리 다 해 놓고 옮겨라."
- 지금까지 발주처, 구분, 상태, 직급 넷은 이름이 기본키였다. 근거는 "이미 운영 중이라 옮기면 순이익이 음수"였다(CALENDAR-TABLE-DESIGN §5.6.3).
- 2026-10-15 확인: 새 DB `taskcalendar` 는 **회사 서버에 아직 없다.** 개발자 로컬 PC 가 서버 역할을 한다. 그래서 위 근거가 성립하지 않는다. 옮기는 비용은 기계적인 작업이다.
- DB 실행과 관리 양쪽에서 번호 키가 같거나 유리하다. 키가 바뀌지 않고, 이름 길이를 바꿔도 자식 열을 건드리지 않으며, 규칙이 하나라 검토가 쉽다. 이름 키의 장점(표시할 때 조인이 없음)은 작다.
- 사용자 결정(2026-10-15):
  1. 코드표 넷을 번호 키로 바꾼다.
  2. 웹과 호스트 사이의 편집, 관리 메시지는 **번호**로 주고받는다(`org_unit` 선례). 화면 표시용 값은 이름 그대로 함께 보낸다.
  3. 동작이 묶인 코드값(선진행, 종료 등)은 **고정 번호**로 판정한다. 그 행은 숨김과 삭제를 막고, 라벨 개명은 허용한다. 역할 열과 색 열은 두지 않는다.
  4. 구분 색은 웹 코드의 색 표에 그대로 두되 기준을 이름에서 번호로 바꾼다.
  5. 회사 서버를 만들 때도 구버전 DB `taskmgr` 에서 과제 트랙을 복사한다. 복사 단계에서 이름을 번호로 바꾼다.
  6. 낡은 진입점과 지난 마이그레이션 파일은 지운다(git 이력에 남는다).
  7. 전체 점검에서 나온 작은 항목을 함께 고친다(§8).

## 1. 목표와 범위 밖

목표
- `customer`, `section_code`, `status_code`, `title_code` 의 기본키를 정수 대리키로 바꾸고, 자식 열을 번호 참조로 바꾼다.
- 이름은 라벨 열로 남긴다(UNIQUE). 라벨을 바꾸면 그 한 행만 바뀌고 화면은 조인으로 저절로 따라온다.
- 이름 글자에 묶인 동작을 모두 번호 판정으로 옮긴다.
- 로컬 DB 는 데이터를 보존하며 옮기고(v12 → v13), 회사 서버는 고친 스키마 파일로 처음부터 만든다.

범위 밖(그대로 둔다, 이유)
- `cal_room (user_id, name)`, `cal_schema_meta (k)`: varchar 키지만 참조하는 자식이 없어 검토 규칙(외래키로 쓰이는 기본키)에 해당하지 않는다. 이관 비용과 상관없이 DB 구조만 봐도 지금이 낫다.
  - `cal_room`: id 를 붙이면 중복을 막을 `UNIQUE(user_id, name)` 이 따로 필요해 인덱스가 2개에서 3개가 된다. 앱은 `WHERE user_id=?` 로 한 사람의 목록을 통째로 읽는데(`CalendarDb.cs` 806행) 지금 기본키는 그 행들을 붙여 둔다. 저장은 지우고 다시 넣는 방식이라(`CalendarWriteDb.cs` 428행) id 는 번호만 소모한다.
  - `cal_schema_meta`: 행이 `schema_version` 하나이고 앱은 늘 `k` 로 찾는다(`CalendarDb.cs` 527행). id 를 붙여도 `k` 에 UNIQUE 를 또 걸어야 한다.
- `cal_category.project_uid`: 외래키가 아닌 외부 식별자다(웹, XML 의 'db-<uid>' 정체성). 문서에 그렇게 밝힌다.
- 쓰이지 않는 인덱스(`ix_cal_entry_user_date` 등): 나중에 온라인으로 지울 수 있고 지금 체감 이득이 없다.
- `project.id` 이름(`*_id` 관례와 다름): 최적화가 아니라 이름 문제라 이번에 하지 않는다.

## 2. 스키마 변경

| 부모 | 새 기본키 | 라벨 | 자식 열(지금 → 바꾼 뒤) | 외래키 규칙 |
|---|---|---|---|---|
| `customer` | `customer_id SMALLINT UNSIGNED AUTO_INCREMENT` | `name` UNIQUE, `CHECK(name<>'')` | `project.customer` → `project.customer_id NOT NULL` | ON UPDATE RESTRICT, ON DELETE RESTRICT |
| `section_code` | `section_id` | 같음 | `project.section` → `project.section_id NOT NULL` | 같음 |
| `status_code` | `status_id` | 같음 | `project.status` → `project.status_id NULL`(NULL 은 상태 없음) | 같음 |
| `title_code` | `title_id` | 같음 | `app_user.title` → `app_user.title_id NULL` | 같음 |

- 타입은 `org_id`, `user_id` 와 맞춰 `SMALLINT UNSIGNED`.
- 자식 열 이름은 부모 기본키 이름과 같게 둔다(`org_id` 선례).
- 인덱스와 외래키 이름을 명시한다(`ix_project_customer_id`, `fk_project_customer_id` 등). 지금 자동 이름인 것도 정리된다.
- UNIQUE(name) 은 지금 기본키가 하던 일(대소문자만 다른 중복 막기, ai_ci)을 넘겨받는다. 호스트의 1062 처리 경로를 그대로 쓴다.
- 코드표 넷과 과제 트랙의 `is_active` 에 `CHECK (is_active IN (0,1))` 을 단다(cal_* 와 같게). 기존 데이터를 먼저 확인한다.
- 스키마 판번호 12 → **13**. `CalendarDb.ExpectedSchemaVersion` 과 스키마 파일의 버전 시드를 함께 바꾼다.

## 3. 고정 번호와 보호

시드 번호를 명시한다(`org_id` 와 같은 방식). 로컬 DB 의 `sort_order` 는 시드와 다르므로 순서로 번호를 매기지 않는다.

| 표 | 번호 | 라벨(시드) | 묶인 동작 |
|---|---|---|---|
| section_code | 1 | 일반계약 | 색만 |
| section_code | **2** | 선진행 | 날짜와 상태를 비우고 잠근다(호스트 `ProjectDb.cs` 1305~1308, 웹 `offEdApplySectionRule`) |
| section_code | 3 | 사업부관리 | 색만 |
| status_code | 1 | 진행중 | 목록 초록 점, 엑셀 초록(색만, 보호하지 않음) |
| status_code | **2** | 종료 | 필터 제외(`offFilters`), 엑셀 회색(`MainWindow.xaml.cs` 의 `ProjectStatusAccents`) |
| status_code | 3 | 1차 납품완료 | 엑셀 파랑(`CodeIds.StatusDelivered`, 색만, 보호하지 않음), 목록 점은 그 밖(주황) |
| status_code | 4 | 미정 | 그 밖(주황 점), 엑셀 기본 |
| title_code | 회사 저장소 02 에 명시 | | 없음 |

- 동작은 번호 상수로 판정한다(웹, 호스트 각각 한 곳에 상수를 둔다). 이름 글자 비교는 모두 없앤다.
- 앱 코드(웹과 호스트)는 이름 글자가 아니라 **id 로 판단**한다(사용자 결정 2026-10-15).
- 숨김과 삭제를 막는 행은 **동작이 묶인 구분 2번(선진행)과 상태 2번(종료)** 둘이다. 색만 묶인 행은 지워도 깨지는 것이 없어 막지 않는다.
- 동작이 묶인 행은 관리 화면에서 **숨김과 삭제를 막는다**(호스트가 거부하고 웹은 버튼을 끄고 이유를 보인다). 라벨 개명과 순서 바꾸기는 허용한다.
- 구분 색 표 `DB_SECTION_COLORS` 는 번호 기준으로 바꾼다. 표에 없는 번호는 기본색.
- 앞으로 고정 번호를 늘릴 때는 같은 상수와 보호 목록에 더한다.
- 보호 행은 언제나 있고 켜져 있어야 한다(2026-10-15 리뷰). 이관 SQL 과 setup 은 옛 DB 에서 라벨을 바꿔 구분 2 나 상태 2 가 비면 멈추고(옛 DB 에서 라벨을 시드 이름으로 되돌린 뒤 다시 돌린다), 숨겨져(`is_active=0`) 왔으면 켜고 알린다.
- AUTO_INCREMENT 바닥은 고정 번호의 최댓값 + 1 이다(구분 4, 상태 5, 직급 12). 옛 DB 에 시드 이름이 빠져 있어도 다음 새 행이 비어 있는 고정 번호를 차지하지 않는다. 이관 SQL 과 setup 둘 다 카운터를 max(바닥, MAX+1)로 올린다. 발주처는 고정 번호가 없다.

## 4. 통신 규약 (org_unit 선례)

- **표시용 payload**: 지금 키 이름(`customer`, `section`, `status`, `title`)에 이름을 그대로 싣고, 번호(`customerId`, `sectionId`, `statusId`, `titleId`)를 함께 싣는다. 호스트가 조인해서 만든다.
- **드롭다운 목록**: `[{id, name, ...}]` 로 보낸다.
- **편집과 관리 메시지**: 과제 저장, 사용자 저장, 발주처, 구분, 상태, 직급 관리(추가, 개명, 숨김, 순서), 휴지통(복구, 삭제)은 번호로 보낸다. 이름으로 찾던 호스트 SQL 은 번호로 찾는다.
- 개명은 `UPDATE <표> SET name=@n WHERE <id>=@id` 한 행이다. CASCADE 가 필요 없다.
- 웹이 이름을 키로 들고 있던 상태(선택 상자 값, 사용 개수 지도 등)는 번호 키로 바꾼다.

## 5. 회사 서버 구축 경로 (`db/deploy/setup-taskcalendar.ps1`)

- 스키마 파일로 새 DB 를 만들고 시드를 고정 번호로 넣는다.
- 원본 `taskmgr`(0.16 모양, 이름 키)에서 과제 트랙을 복사할 때: 코드표를 먼저 복사하면서 이름을 고정 번호 지도에 맞추고(지도에 없는 이름은 MAX+1 부터 이름순), `project` 는 `JOIN ... ON name` 으로 번호를 채워 넣는다.
- 교집합 복사(지금 758~800행), `KEY_COLS`, `ORPHAN_CHECKS`, `EXPECTED` 상수를 새 구조에 맞춘다.
- 복사 뒤 검증: 번호로 되살린 이름이 원본과 `BINARY` 로 같고, 고아 0, 행 수 불변.
- `load-template.sql`(일괄 INSERT 규약)과 `seed-dummy.mjs` 도 새 구조로 바꾼다.

## 6. 로컬 DB 이관 (v12 → v13, 데이터 보존)

새 파일 `db/deploy/migrate-2026-10-15-code-ids.sql`. 로컬 `taskcalendar` 에는 실데이터가 있다(user_id 58).

0. 백업(`taskcalendar` 를 명시). `schema_version='12'` 가 아니면 중단.
1. 옛 값 스냅샷을 임시 표로 남긴다(project uid 별 customer, section, status / app_user user_id 별 title).
2. 부모 표에 번호 열을 더하고 배정한다. 시드 이름은 고정 번호 지도로, 나머지는 MAX+1 부터 이름순.
3. 자식에 `*_id` 열을 NULL 허용으로 더하고 `JOIN ... ON name` 으로 채운다.
4. **절단 관문**: 번호로 되살린 이름이 옛 값과 `BINARY` 로 한 글자도 다르지 않고 NULL 여부도 같아야 한다. 하나라도 다르면 중단. 이어서 구분 2, 상태 2 행이 없으면 중단하고(4-b), 숨겨져 있으면 켠다(4-c, §3).
5. 옛 외래키, 옛 열, 옛 인덱스를 지우고 부모 기본키를 번호로 바꾼다. UNIQUE(name), CHECK, 자식 NOT NULL, 인덱스와 외래키를 건다. AUTO_INCREMENT 를 MAX 보다 크고 고정 번호 바닥(구분 4, 상태 5, 직급 12) 이상으로(5-3b).
6. v13 을 기록하고 사후 검증: 고아 0, 표별 행 수 불변, cal_* 행 수와 cal_user_rev 불변.
7. 재구축 경로와 대조: 빈 격리 DB 에 setup 으로 만든 결과와 information_schema(열, 인덱스, 외래키, CHECK, COMMENT)가 같아야 한다.

DDL 은 암묵 커밋이라 원자적이지 않다. 0번 백업과 4번 관문이 안전장치다. **로컬 실 DB 에 적용하기 전에 복제한 격리 DB 에서 먼저 돌린다.**

## 7. 회사 저장소 (`taskmgr-company-data`)

`title_code` DDL 과 `app_user.title` 외래키는 이 저장소에 있다. 같은 라운드에 고친다(브랜치 `feat/code-ids`).
- `01-schema-users.sql`: `title_code.title_id`, `app_user.title_id`.
- `02-seed-org.sql`: 직급 시드에 번호 명시.
- `03-seed-users.sql`: `_user_seed.title` 을 `title_id` 조인으로.
- `apply.ps1` 게이트.

## 8. 점검에서 나온 것 함께 고침

1. **운영 스크립트 기본 DB 이름**: 앱은 `taskcalendar` 인데 `backup-taskmgr.ps1`, `restore-taskmgr.ps1`, `init-calendar.ps1`, `org-ops.ps1`, `app-account.ps1` 의 기본값이 `taskmgr` 다. 기본값을 `taskcalendar` 로 바꾼다. 파일 이름은 그대로 둔다(안내 문서와 사람의 습관이 그 이름을 쓴다).
2. **낡은 진입점 삭제**: `db/deploy/init-db.ps1`, `init-db.cmd`, `migrate.ps1`, `migrate.cmd`, `db/schema.sql`, 지난 `migrate-2026-*.sql` 과 `rollback-2026-08-24-org-id.sql`. 진입점은 `setup-taskcalendar` 하나로. 지우기 전에 이 파일들을 읽는 스크립트와 시험을 찾아 함께 정리한다. `db/deploy/README.md` 의 안내도 고친다.
3. **안 쓰는 권한**: `cal_entry_commit`, `cal_todo_day_note`, `cal_room` 의 GRANT UPDATE 를 뺀다(호스트는 DELETE 뒤 INSERT 만 한다).
4. **CHECK**: 코드표 `name<>''`, 과제 트랙 `is_active IN (0,1)`. 과제 계약일 순서 CHECK 는 기존 데이터를 확인한 뒤 넣을지 정한다.
   - 결정(2026-10-15): **계약일 순서 CHECK(`start_date <= end_date`)는 넣지 않았다.** 로컬 `taskcalendar` 와 원본 `taskmgr` 모두 순서가 뒤집힌 과제가 0건이고, 호스트(`ProjectDb.UpsertProjectAsync`)가 저장 전에 검사한다. 로컬 DB 는 이미 v13 으로 이관했으므로 지금 넣으려면 이관을 한 번 더 해야 한다. 필요해지면 다음 판번호에서 넣는다.
5. **문서 속 비밀번호**: `db/README.md` 61행에 적혀 있던 문서 속 root 비밀번호(명령줄 `-p` 뒤의 글자)를 지운다(이미 GitHub 에 올라갔다. 비밀번호를 바꿀지는 사용자가 정한다). 저장소 어디에도 그 글자가 남지 않게 `tests/code-ids-db.test.mjs` 가 추적 파일 전체를 훑는다.
6. **문서 어긋남**: cal_task_hours, cal_attendance 머리 주석(updated_at), §5.6.7 cal_room 길이(실제 40), §5.6.1 title_code 길이(실제 30), "실 DB 미적용" 배너.

## 9. 문서

- `db/CALENDAR-TABLE-DESIGN.md` §5.6 을 새 결정으로 다시 쓴다. §5.6.0 의 검토자 질문 상자, §5.6.3 판정, §5.6.4-a(어제 적은 "잃는 것 2: 개명 전파를 코드로 다시 만들어야 한다"는 **틀렸다**. 번호 키와 조인이면 라벨 한 행만 바꿔도 화면이 따라온다)를 정정하고 정정 이력을 남긴다.
- `db/TABLE-DESIGN.md` §2, §2.5, §3, §6, §7, §9(ADR 추가), `db/README.md`, `db/deploy/README.md`.
- `docs/DB-SCHEMA.html`, `db/table-design-report.html` 은 `tools/schema-report` 로 다시 만든다(덤프는 새 스키마의 격리 DB 에서).
- 위키: 관리 화면 문서에 "선진행, 종료는 이름을 바꿀 수 있지만 숨기거나 지울 수 없다"를 적는다.

## 10. 시험

- 정적 시험(SQL, 스키마 문자열 고정): code-tables, xlsx-export, trash-host, org-title-host, user-admin, uniqueness, project-dev-end, setup-taskcalendar, admin-hub(1, 3, 4), app-context, trash-web, org-title-web, schema-integrity, version 관련.
- 새 시험:
  - 고정 번호 판정: 구분 2번의 라벨을 바꿔도 날짜 잠금이 유지되고, 상태 2번의 라벨을 바꿔도 필터와 엑셀 강조가 유지된다. 이름 글자 비교가 소스에 남지 않았다.
  - 보호: 고정 번호 행의 숨김과 삭제를 호스트가 거부하고 웹은 버튼을 끈다.
  - 통신: 편집과 관리 메시지가 번호를 싣는다. 표시 payload 에 이름과 번호가 함께 있다.
  - 이관 SQL: 격리 DB 복제본에서 절단 관문, 사후 검증, 재구축 경로와 information_schema 대조.
- 실 위젯 루프: loop-org-title, loop-trash, loop-ui-integrity, loop-admin-hub, loop-user-admin, loop-org-compat 등. 전부 33/33.
- 게이트: `TC_TEST_STRICT=1 node tests/run-tests.mjs` exit 0, 0 fail, 0 skip.

## 11. 릴리스

- 0.20.0 패치노트와 RELEASE_NOTES, CHANGELOG 의 "스키마 변경 없음(v12)" 을 **v13** 과 배포 순서(DB 먼저)로 고친다.
- **2026-10-16 변경**: 위 줄 대신 0.21.0 으로 낸다(사용자 결정). 0.20.0 절은 v12(스키마 변경 없음, 배포 안 함)로 되돌리고, v13 과 배포 순서(DB 먼저), 기존 DB 이관(`migrate-code-ids.cmd`)은 0.21.0 절(앱 패치노트, RELEASE_NOTES, CHANGELOG)에 적는다.
- 인스톨러를 다시 빌드하고 `latest.json` 해시를 대조한다.

## 12. 위험

- 이관 SQL 이 로컬 실데이터를 망가뜨리는 것: 백업, 절단 관문, 격리 DB 선행 실행으로 막는다.
- 이름으로 찾던 코드를 하나라도 놓치는 것: 소스에서 `section`, `status`, `customer`, `title` 문자열 비교를 전수 검색하고 시험으로 고정한다.
- 회사 저장소와 이 저장소가 어긋나는 것: 같은 라운드에 함께 고치고 setup 시험이 둘을 함께 읽는다.

## 정정 이력

- 2026-10-15 신설.
- 2026-10-15 보강: 앱 코드는 id 로 판단(사용자 확인). 보호 대상은 구분 2번, 상태 2번. cal_room, cal_schema_meta 를 그대로 두는 DB 구조상의 이유를 적음.
- 2026-10-15 리뷰 수정 라운드: §3 표의 상태 3번(1차 납품완료)이 엑셀 파랑(`CodeIds.StatusDelivered`)인 것을 바로잡음. §3 에 보호 행 존재와 활성, AUTO_INCREMENT 바닥(4, 5, 12)을 더함(이관 SQL 4-b, 4-c, 5-3b 와 setup 이 같은 규칙). §8-4 에 계약일 CHECK 를 넣지 않은 결정을 적음. §8-5 에서 비밀번호 글자를 지우고 추적 파일 전체 검사로 바꿈. 릴리스 문서(RELEASE_NOTES, CHANGELOG, 앱 패치노트)를 v13 과 배포 순서(DB 먼저)로 고침(§11). 그 밖에 직원 편집의 직급 없음 유지, 코드 순서 저장의 낡은 화면 거부, 스키마 보고서 생성기의 v13 문장.
- 2026-10-16: 0.20.0 에 합치지 않고 0.21.0 으로 따로 내기로 함(사용자 결정, 머리말과 §11). 기존 DB 이관 마스터 cmd(`db/deploy/migrate-code-ids.cmd`)를 더함.
