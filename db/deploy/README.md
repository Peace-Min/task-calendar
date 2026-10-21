# DB 프로비저닝 키트 (taskcalendar, 옛 taskmgr)

MySQL 서버에 **DB 구조(테이블) + 앱 계정**을 만드는 도구. **지금(개인 PC 임시)과 나중(서버 이관) 모두 같은 스크립트**로 실행하므로 동일 구조가 재현됩니다. 데이터는 이 키트가 만들지 않습니다(구조/권한만).

> **2026-10-15 진입점 정리(docs/CODE-TABLE-IDS.md §8-2).** 새 DB 를 만드는 진입점은 **`setup-taskcalendar.cmd` 하나**입니다.
> 옛 진입점 `init-db.cmd`/`init-db.ps1`, `migrate.cmd`/`migrate.ps1`, `../schema.sql`, 지난 `migrate-2026-*.sql` 열두 개와
> `rollback-2026-08-24-org-id.sql` 은 지웠습니다(git 이력에 있습니다). 아래 본문에 그 이름이 남은 곳은 옛 기록입니다.
> - **새 DB(회사 서버 포함)**: `setup-taskcalendar.cmd`. 스키마 파일로 `taskcalendar` 를 만들고, 원본 `taskmgr` 에서 과제 트랙을 복사하면서 코드표 이름을 번호로 바꿉니다.
> - **데이터가 있는 로컬 DB(v12)**: `migrate-2026-10-15-code-ids.sql` 한 번(v12 → v13, 코드표 번호 키). 백업 먼저(`backup-taskmgr.cmd -DbName taskcalendar`), 복제한 격리 DB 에서 먼저. 실행법은 그 파일 머리말.
>   2026-10-16 부터는 손으로 돌리지 않고 마스터 cmd `migrate-code-ids.cmd` 를 씁니다(판번호와 앱 세션 확인, 백업과 검증, `--force` 없는 실행, 실패 판정). 아래 '기존 PC 의 DB 이관(마스터 cmd)' 절.
> - 운영 스크립트(`backup-taskmgr`, `restore-taskmgr`, `init-calendar`, `org-ops`, `app-account`)의 기본 DB 는 `taskcalendar` 입니다. 옛 DB 는 `-DbName taskmgr` 처럼 이름을 적습니다(`restore-taskmgr` 는 `-LiveDb`, `-TargetDb`). 파일 이름은 그대로 둡니다.
> - 코드표(발주처, 구분, 상태, 직급)는 번호 키입니다(`schema_version` 13). `project` 와 `app_user` 는 이름이 아니라 `customer_id`, `section_id`, `status_id`, `title_id` 를 담습니다. 아래 본문에서 *"과제 트랙의 자연키 PK"* 라고 적은 곳은 그 전의 기록입니다. 근거는 [`../TABLE-DESIGN.md`](../TABLE-DESIGN.md) §9 ADR-23.

**이 폴더에는 서로 독립적인 트랙 둘**이 들어 있습니다. 같은 DB(지금은 `taskcalendar`)를 대상으로 하지만 다루는 테이블도, 앱 계정에 주는 권한도 다릅니다. **한쪽 문서를 다른 쪽 근거로 쓰지 마세요.**

- **과제 트랙**: `project`·`customer` 등. 진입점 `setup-taskcalendar.cmd`(2026-10-15 부터. 옛 `init-db.cmd` 는 지웠습니다). 설계는 [`../TABLE-DESIGN.md`](../TABLE-DESIGN.md)
- **캘린더 트랙**: `cal_*`(개인 일정, 할 일, 공수, 근태). 새 DB 에서는 `setup-taskcalendar.cmd` 가 함께 만들고, 캘린더만 다시 세울 때 `init-calendar.cmd` 를 씁니다. 설계는 [`../CALENDAR-TABLE-DESIGN.md`](../CALENDAR-TABLE-DESIGN.md)

그리고 트랙과 무관하게 **DB 전체를 대상으로 하는 운영 도구**가 하나 있습니다. 바로 **백업**(`backup-taskmgr`)입니다.
구축이 아니라 **설치**라 위 두 진입점에 딸려 오지 않습니다. 아래 '백업' 절.

사용 설명 영상 녹화용 데모 DB(가상 이름, `(예시)` 과제, 백업 뒤 넣기와 되돌리기)는 [`../demo/README.md`](../demo/README.md) 에 있습니다.

## 구성: 과제 트랙

| 파일 | 역할 |
|---|---|
| `setup-taskcalendar.cmd` / `setup-taskcalendar.ps1` | **원큐(진입점)**: 새 DB 구조 + 회사 시드 + 원본 과제 복사(코드표 이름을 번호로) + 앱 권한 + 검증. 아래 캘린더 트랙 표의 같은 줄 참조 |
| `schema-structure.sql` | 과제 트랙 구조 DDL(customer, section_code, status_code, project, room_code). 코드표는 번호 키(2026-10-15), 기본 코드 행은 고정 번호로 시드. room_code 는 회사 공용 회의실 목록(2026-10-21, 관리자만 고친다, docs/SHARED-ROOMS.md) |
| `migrations/v15-shared-rooms.sql` | **이관 조각**(14 → 15, 2026-10-21). 혼자 돌리지 않는다. 배포 SQL(release-v<버전>.sql)에 들어가 room_code 를 만들고, 사람마다 두던 cal_room 의 이름을 모아(앞뒤 공백 정리, 중복 제거) 넣고 검증한 뒤 cal_room 을 지운다. 이미 15 이상이면 건너뛴다 |
| `create-app-user.sql` | 앱 계정 생성과 과제 표 권한(setup 이 스키마 이름을 바꿔 적용한다) |
| `load-template.sql` | **내부망 LLM용** 데이터 INSERT 템플릿 + 규칙(이름으로 적고 번호로 바꿔 넣는다) |
| `migrate-2026-10-15-code-ids.sql` | **데이터가 있는 로컬 DB 전용 1회 이관**(v12 → v13). 코드표 넷(발주처, 구분, 상태, 직급)을 번호 키로. 절단 관문(BINARY)과 사후 검증이 어긋나면 에러로 멈춘다. 언제, 어떻게는 아래 '코드표 번호 키 이관' 절 |
| `migrate-code-ids.cmd` / `migrate-code-ids.ps1` | **위 이관 SQL 의 마스터 cmd**(2026-10-16). 더블클릭 한 번으로 판번호 확인(13 이면 할 일 없음), 앱 세션 확인, 확인(Y), 백업과 검증, 이관 SQL(`--force` 없이), 결과 판정까지 한다. 멈추면 절단 전인지 뒤인지 DB 상태로 가르고 되돌리는 명령을 보여 준다. 종료코드 0~5. 아래 '기존 PC 의 DB 이관(마스터 cmd)' 절 |
| `migrations/v<번호>-*.sql` | **이관 조각**(2026-10-21 부터의 구조 변경, 첫 조각 `v14-version-gate.sql` 13 에서 14). 혼자 돌리지 않는다. `installer/publish-update.ps1` 이 구조 번호 순서로 이어 붙여 배포 SQL `release-v<버전>.sql` 하나를 만들고, 운영자는 그 파일만 Workbench 에서 한 번 실행한다. 규칙은 `docs/DB-RELEASE-OPS.md` 5절 |

## 구성: 캘린더 트랙 (`cal_*`), 백업

> 아래 여섯 중 **앞의 셋만** 캘린더 트랙입니다. **백업과 복구 파일은 DB 전체**(기본 `taskcalendar`)가 대상이며,
> 캘린더 트랙 작업 중에 만들어졌을 뿐 과제 표도 함께 받습니다.

| 파일 | 역할 |
|---|---|
| `init-calendar.cmd` / `init-calendar.ps1` | **원큐**: 아래 두 `.sql` 을 정해진 순서로 적용하고 **배포 게이트**까지 돌린다. 보통은 `.cmd` 더블클릭 |
| `schema-calendar.sql` | `cal_*` 테이블 DDL **단일 소스**. 컬럼, CHECK, FK 의 정본은 설계 문서가 아니라 이 파일이다. 스키마 버전 행 시딩 + `cal_user_rev` 전원 시딩도 여기서 한다 |
| `grants-calendar.sql` | 앱 계정(`taskmgr_app`) 권한 **단일 소스**. 표마다 '왜 그 동사를 주는지 / 왜 안 주는지'가 주석으로 붙어 있다 |
| `backup-taskmgr.cmd` / `backup-taskmgr.ps1` | **주간 mysqldump 백업 + '온전한 덤프인지' 대조.** 구축이 아니라 **운영** 도구라 `init-calendar` 와 별개로 돈다. `-Install` 로 작업 스케줄러에 등록. 아래 '백업' 절 |
| `create-backup-user.sql` | 백업 전용 최소권한 계정(`taskmgr_backup`). **주는 권한과 안 주는 권한의 근거가 주석에 붙어 있다.** 특히 `TRIGGER` 를 왜 함께 줘야 하는지 |
| `setup-taskcalendar.cmd` / `setup-taskcalendar.ps1` | **새 주 DB `taskcalendar` 원큐 구축(2026-09-23, 09-29 개정).** 기존 `taskmgr`(0.16 전용, 읽기만) 옆에 정본 DDL 3개로 최신 구조(2026-10-15 부터 v13)를 세우고, 사용자 3표는 회사 시드(02, 03, 04)로, 과제 4표는 원본에서 id/uid 보존으로 복사(시각 KST→UTC. 코드표 이름은 고정 번호 지도에 맞춰 번호로 바꾸고, 번호로 되살린 이름이 원본과 `BINARY` 로 같은지 확인한다), 앱 권한 3파일 적용, 검증 보고서. 원본 사용자 표는 login_id 대조(경고)에만 읽는다. 어떻게 끝나든 보고서(`-FAILED`)가 남는다. **대상이 이미 있으면 실행할 때마다 백업(`<대상>-before-drop-<시각>.sql`) 후 DROP 하고 처음부터 다시 만든다**(2026-09-30, `-Force` 불필요. 받기만 하고 무시). 운영 전환 뒤 다시 돌리면 대상의 캘린더 데이터가 지워진다(before-drop 덤프가 유일한 사본). 종료코드 0/1/2/3. 왜, 언제 쓰는지는 DEPLOY.md §0-6 |
| `restore-taskmgr.cmd` / `restore-taskmgr.ps1` | **덤프 되살리기 + '정말 되살아났는지' 대조.** `backup-taskmgr` 의 짝이다. 기본은 라이브가 아닌 **별도 DB** 로 복구하고, 라이브 덮어쓰기는 스위치+**이름 타이핑**이 있어야만 열린다. `-Grants` 가 `복구방법.txt` 4번(계정과 권한은 덤프에 없다)을 대신한다. 아래 '복구' 절 |

> 두 `.sql` 은 `init-calendar` 없이 `mysql` 로 직접 돌려도 되지만, **순서와 게이트를 사람이 대신 지켜야 한다.** 아래 두 절이 그 내용이다.

> **`init-calendar` 는 최초 1회 구축용이다.** 이미 데이터가 든 DB 의 구조를 바꿀 때는 이것이 아니라 **`migrate-*.sql`** 을 쓴다. 목록, 적용 순서, `schema_version` 개념은 아래 '캘린더 표 마이그레이션' 절.

> **2026-08-11: `triggers-calendar.sql`(감사 트리거) 이 이 표에서 빠졌습니다.** 파일째 폐기됐습니다.
> 근거는 설계 [`../CALENDAR-TABLE-DESIGN.md`](../CALENDAR-TABLE-DESIGN.md) **§7.5**. 요약하면
> ① 휴지통이 **감사 대상과 같은 DB 안**이라 서버나 디스크 장애에는 함께 사라져 무력했고,
> ② 실수나 우회 삭제를 실제로 되돌리는 **표준 경로는 덤프 + binlog** 이며,
> ③ API 서버를 도입하면 어차피 그 계층으로 옮길 물건이기 때문입니다.
> **그 대신 이번에 `backup-taskmgr` 가 생겼습니다.** 없던 것(주간 덤프)을 만들고 있던 것(트리거)을 뺐습니다.

## 지금: 과제 구조 만들기

2026-10-15 부터 **`setup-taskcalendar.cmd` 더블클릭**(root 비번, 앱 계정이 없으면 앱 계정 비번). 과제, 사용자, 캘린더 구조를 한 번에 만듭니다(옛 `init-db.cmd` 는 지웠습니다).
서버를 대상으로 하려면:
```
setup-taskcalendar.cmd -DbHost 192.168.0.50 -Port 3306
```
- **앱 계정 비번**은 위젯 빌드의 `DeployConfig.DbPassword` 와 **똑같이** 넣어야 앱이 붙습니다.
- 앱 계정은 **과제 테이블에 대해** `SELECT`/`INSERT`/`UPDATE` 만(DDL, DROP 없음).
  근거는 `create-app-user.sql` 이 적어 둔 *"삭제는 `is_active=0` 이라 UPDATE"* 이고, **어느 표에 무엇을 주는지는 그 파일이 단일 소스**입니다(여기 목록을 두면 표가 늘 때마다 뒤처집니다. 예전 이 줄은 "두 테이블"이라고 적혀 있었지만 실제로는 그보다 많습니다).
  > ⚠️ **이 문장을 캘린더에 적용하지 마세요.** `cal_*` 에는 소프트삭제가 없어 삭제가 곧 `DELETE` 이고,
  > `grants-calendar.sql` 은 **의도적으로 `DELETE` 를 줍니다**. 이 README 를 근거로 "앱 계정에 DELETE 가
  > 있으면 잘못"이라고 판단하면 반대로 결론이 납니다. 캘린더 쪽 근거는 아래 절과 `grants-calendar.sql` 입니다.

## 지금: 캘린더(`cal_*`) 구조 만들기

로컬(개인 PC)에서 **`init-calendar.cmd` 더블클릭** 후 관리(root) 비번만 입력. 서버를 대상으로 하려면:
```
init-calendar.cmd -DbHost 192.168.0.50 -Port 3306
```
- **선행 조건**: `app_user` 가 이미 있어야 하고, **그 표에 `user_id` 컬럼이 있어야** 합니다(`cal_*` 가 그 컬럼을 FK 로 가리킵니다). `init-calendar` 는 이것을 선행 조건 단계(`1-4`)에서 확인하고 어긋나면 **아무것도 만들지 않고 멈춥니다**(코드 `1`). `mysql` 로 `schema-calendar.sql` 을 직접 돌려도 **그 파일 자신의 선행조건 가드**(맨 앞 `0.` 절)가 `DROP` 보다 **먼저** 멈춰 세웁니다. 실측하면 기존 `cal_*` 가 살아남고 에러 메시지가 *"중단: app_user.user_id 없음 - 01-schema-users.sql 로 다시 만들 것"* 으로 나옵니다(`ERROR 1146`. 2026-10-15 전에는 지운 이관 파일 이름을 가리켰습니다). 두 겹인 이유는 러너를 안 거치는 사람이 실재하기 때문입니다.
  > **⚠️ 그 가드는 `mysql --force` 하나로 무력화됩니다.** `--force` 는 에러가 나도 계속 진행하므로
  > 가드 다음 줄의 `DROP TABLE` 이 그대로 돕니다. **이 파일을 돌릴 때 `--force` 를 붙이지 마세요.**
  > **무엇을 보는가: '컬럼이 있나' 하나가 아닙니다**(`init-calendar.ps1` 의 `1-4`·`1-4b`가 정본):
  > - `app_user.user_id` 가 **존재**하는가. 없으면 지금 PK 가 무엇인지까지 찍고, **어떻게 다시 만들지**
  >   (`setup-taskcalendar.cmd` / 새 DB 라면 `taskmgr-company-data\apply.cmd`)를 알려 주고 멈춥니다. 옛 키 DB 를 옮기던
  >   `migrate-2026-08-24-user-id.sql` 은 2026-10-15 에 지웠습니다.
  > - **타입이 글자 하나까지 같은가**: `schema-calendar.sql` 이 선언한 `user_id` 타입을 파일에서 읽어
  >   실제 컬럼과 대조합니다. InnoDB 는 폭이나 부호가 다르면 FK 를 만들지 않습니다.
  > - **`NOT NULL` 인가**, **PK/UNIQUE 인덱스가 있는가**: FK 의 부모 컬럼은 인덱스의 선두여야 합니다.
  > - (`1-4b`) `login_id` 가 **여전히 UNIQUE 인가**: 여기서는 멈추지 않고 **경고**만 합니다.
  >   `login_id` 는 이제 FK 대상이 아니지만 로그인 입구로 남고, 중복되면 앱이 남의 캘린더를 열 수 있습니다.
  > **★ 2026-08-24: 선행 조건이 '표가 있는가' 에서 '표에 그 컬럼이 있는가' 로 좁아졌습니다.**
  > `cal_*` 의 소유자 FK 대상이 `app_user.login_id` → **`app_user.user_id`(대리키)** 로 바뀌었기 때문입니다
  > (설계 [`../CALENDAR-TABLE-DESIGN.md`](../CALENDAR-TABLE-DESIGN.md) **§5.2**).
  > **`app_user` 쪽 DDL 은 이 저장소에 없습니다.** 실명 89명과 함께 별도 비공개 저장소
  > (`taskmgr-company-data/01-schema-users.sql`)에서 관리합니다. **그쪽을 먼저 적용**하세요.
  > `app_user` 는 있는데 `user_id` 가 없는 서버(전환 전에 만든 서버)가 그 대상입니다. **가드가 없다면**
  > `schema-calendar.sql` 은 `cal_*` 를 전부 `DROP` 한 **뒤에** 첫 `CREATE TABLE` 의 FK 에서 죽습니다.
  > DDL 은 롤백이 없으므로 `cal_*` 가 0개인 **반파** 상태가 되고, `cal_user_rev` 89행(§3.1, 계약 H-1 의
  > 전제)이 그 자리에서 사라집니다. 그래서 **두 겹으로** 막습니다: `init-calendar` 의 선행 조건 단계와
  > `schema-calendar.sql` 자신의 `0.` 가드(둘 다 `DROP` 전).
  > - **이 전환으로 표가 늘거나 줄지 않았습니다.** 바뀐 것은 각 표의 키입니다. *(그 뒤 08-27과 08-31 마이그레이션으로는 표가 늘었습니다. 지금 몇 개인지는 `schema-calendar.sql`의 `CREATE TABLE` 목록이 정본이고, `init-calendar.ps1`의 `$DESIGN_TABLES` 명부가 그것과 대조합니다. **문서에 숫자를 박지 마세요.** 이 줄이 예전에 "여전히 13개"라고 적고 있었고, 스키마가 그보다 늘어난 뒤에도 그 문장이 남아 다음 사람에게 거짓을 말했습니다. 같은 함정이 `init-calendar.ps1` 의 명부에서도 터져 2026-09-02까지 원큐 구축 진입점을 `Die` 로 막고 있었습니다.)*
  > - 캘린더 트랙의 전환일 뿐 **과제 트랙은 그날의 대상이 아니었습니다.** 그쪽은 2026-10-15 에 따로 번호 키로
  >   바꿨습니다(코드표 넷, `migrate-2026-10-15-code-ids.sql`, 설계 **§5.6**). 그 전에는 자연키 PK 와
  >   `ON UPDATE CASCADE` 를 정상 설계로 남겨 두었습니다.
- 앱 계정 비번은 묻지 않습니다. 이 키트는 **계정을 만들지 않고 권한만 줍니다**(비번이 두 파일에 흩어지는 것을 피하려고 `create-app-user.sql` 과 역할을 갈랐습니다).

### 배포 순서: `schema` → `grants` (바꾸지 마세요)

`init-calendar` 가 이 순서로 돌립니다. 손으로 돌릴 때도 같은 순서여야 합니다:

0. **(이 키트 밖) `app_user`: `user_id` 컬럼까지 갖춘 상태.** `cal_*` 의 FK 대상이라 없으면 1의 FK 생성이
   errno 1824 입니다. **`init-calendar` 는 이것을 확인만 하고 만들지 않습니다**(코드 `1` 로 멈춤).
   **여기부터 경로가 둘로 갈립니다. 어느 쪽인지 먼저 판정하세요:**

   ```sql
   -- 지금 DB 가 어느 쪽인가 (한 줄이라도 나오면 '기존 DB')
   SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_user' AND COLUMN_NAME='user_id';
   ```

   | | 상태 | 0 단계에서 할 일 |
   |---|---|---|
   | **신규 DB** | `app_user` 가 아예 없다 | 비공개 저장소 `taskmgr-company-data` 의 **`apply.cmd`**(`01-schema-users.sql` → `03-seed-users.sql` …). 처음부터 `user_id` 가 있는 표가 만들어집니다 |
   | **기존 DB** | `app_user` 는 있는데 **PK 가 `login_id`** 이고 `user_id` 가 없다 | *(2026-08-24 ~ 10-14)* **`migrate-2026-08-24-user-id.sql` 을 먼저 적용**했습니다(대리키 신설 + `login_id` UNIQUE 강등). **2026-10-15 부터 그 파일은 없습니다.** 옛 키 DB 는 더 옮기지 않고 `setup-taskcalendar.cmd` 로 새 DB 를 만듭니다(원본은 읽기만 합니다). `01-schema-users.sql` 을 그 DB 에 그냥 다시 돌리면 **`DROP TABLE app_user` 로 실명 89명이 사라집니다.** 재실행 안전이 아닙니다 |

   > **★ 이 단계를 건너뛰면 무엇이 막아 주는가: 두 겹입니다. 둘 다 `DROP` 보다 앞에 있습니다.**
   > `schema-calendar.sql` 은 `cal_*` 를 전부 `DROP` 한 **뒤에** 첫 `CREATE TABLE` 의 FK 를 만나는
   > 구조라, 막는 것이 없으면 *"옛 표는 이미 지워졌고 새 표는 FK 에서 멈춘"* **반파**가 됩니다
   > (DDL 은 롤백이 없습니다). 그래서 둘로 막습니다:
   > - `init-calendar.ps1` 선행 조건 `1-4`: 코드 `1` 로 멈추고 적용할 파일 이름을 찍습니다.
   > - `schema-calendar.sql` 자신의 `0.` 가드: 러너를 안 거치고 `mysql` 로 직접 돌려도 멈춥니다
   >   (실측: 기존 `cal_*` 가 살아남고 `ERROR 1146` 메시지가 뜬다. 2026-10-15 부터 그 메시지는 *"01-schema-users.sql 로 다시 만들 것"*).
   > **⚠️ 단, `mysql --force` 를 붙이면 두 번째 겹이 무력화됩니다.** 붙이지 마세요.
   > 그리고 **0 단계는 사람이 먼저 하는 것이 정답**입니다. 스크립트는 막아 줄 뿐 대신 해 주지 않습니다.
   > ※ **2026-08-24 현재 실 `taskmgr` 은 이 단계를 이미 마쳤습니다.** `app_user` PK = `user_id`
   > (`information_schema.STATISTICS` 직접 확인). 이 줄은 원래 *"아직 `login_id` 다"* 라고
   > 적혀 있었습니다. **눈으로 짐작하지 말고 위 판정 쿼리를 한 번 돌리세요.**
   >
   > **★ 그리고 이것과 짝을 이루는 마이그레이션이 하나 더 있습니다. `org_unit` 의 조직 대리키**
   > (`migrate-2026-08-24-org-id.sql`). **`init-calendar` 는 그것을 요구하지 않지만**
   > `taskmgr-company-data\apply.cmd` 는 요구합니다. 아래 **'사용자·조직 표 마이그레이션'** 절.
   > (2026-08-24 현재 실 `taskmgr` 은 **아직 안 했습니다.** `org_unit.org_id` 없음, 직접 확인.)
   > (2026-10-15: 지금은 적용됐고 그 이관 파일과 되돌리기 파일은 지웠습니다. `setup-taskcalendar` 가 만드는 새 DB 는 처음부터 `org_id` 구조입니다.)
1. **`schema-calendar.sql`**: 표가 없으면 GRANT 를 걸 대상이 없습니다(없는 표에 GRANT 는 `ERROR 1146`).
2. **`grants-calendar.sql`**: 계정이 없으면 `ERROR 1410` 으로 시끄럽게 멈춥니다(의도. 조용히 건너뛰면 앱이 배포 후 첫 조회에서 `ERROR 1142` 로 죽습니다).

> **2026-08-24: `0` 은 새 단계가 아니라 원래 있던 선행 조건을 번호로 드러낸 것입니다.**
> `cal_*` 는 처음부터 `app_user` 를 FK 로 가리켰습니다. 달라진 것은 **가리키는 컬럼**이
> `login_id` 에서 **`user_id`** 로 바뀌어, *"표가 있으면 된다"* 가 더 이상 참이 아니라는 점입니다
> (설계 §5.2). **`init-calendar` 의 종료코드 계약은 그대로입니다.** 이 실패도 기존 `1` 입니다.
> 값을 새로 만들지 않았습니다(아래 종료코드 표의 ★ 경고와 같은 이유).

> **2026-08-11: 세 단계였고 가운데가 `triggers-calendar.sql` 이었습니다.** 그 단계에는
> *"반드시 grants 보다 먼저. 3의 `DELETE` 부여를 상쇄하는 근거가 이 트리거"* 라는 강한 주의가
> 붙어 있었습니다. 트리거를 폐기하면서(설계 §7.5) **그 순서 제약도 함께 사라졌습니다.**
> `DELETE` 부여의 근거는 상쇄가 아니라 *필수 동사* 이고(아래 절), 위험을 실제로 상쇄하는 것은
> **주간 덤프 + binlog** 입니다. 그건 배포 순서가 아니라 **운영 설치**의 문제라 이 순서에 안 들어옵니다.
> 마찬가지로 *"`schema-calendar.sql` 을 다시 돌리면 `DROP TABLE` 이 트리거까지 지우니 트리거를 다시
> 돌리라"* 던 경고도 대상이 없어져 뺐습니다(재구축이 데이터를 지우는 것은 그대로입니다. 아래 ⚠️ 참고).

### 왜 앱 계정에 `DELETE` 를 주는가: 과제 트랙과 갈리는 지점

- `cal_*` 에는 **소프트삭제가 없습니다.** 일정, 할 일, 과제, 회의실, 예외일, 커밋, 공수, 근태는 행을 지우는 것이 정상 동작이고, 공수에 0 을 넣는 것도 0 저장이 아니라 **행 삭제**입니다(`chk_cal_task_hours_range` 가 0 을 거부합니다). **근태를 '미기록'으로 되돌리는 것도 같은 규약**입니다. `cal_attendance` 는 `status=''` 를 저장하지 않고(`chk_cal_attendance_status` 의 IN 목록에 `''` 가 없어 INSERT, UPDATE 모두 `ERROR 3819`) 행을 지웁니다.
- 그래서 과제 트랙의 관례(`SELECT`/`INSERT`/`UPDATE` 만)를 글자대로 옮기면 **앱의 모든 삭제 UI 가 `ERROR 1142` 로 실패**합니다. 그것도 사용자가 저장에 실패한 뒤에야 드러납니다.
  **즉 `DELETE` 는 "위험하지만 감수하는 동사" 가 아니라 안 주면 앱이 동작하지 않는 필수 동사**입니다. 부여 근거는 그것 하나로 충분하고, 무엇이 상쇄하느냐와는 별개입니다.
- **남는 위험과 그 상쇄**: 접속 자격은 배포본에 담겨 전 사용자 PC 에 퍼집니다(노출 전제). 우회 접속자가 남의 행을 지울 수 있습니다. 이걸 되돌리는 수단은 **DB 밖에 두 가지뿐**입니다. **주간 mysqldump**(기준 스냅샷)와 **binlog 30일**(그 이후 변경). 아래 '백업' 절.
  > **2026-08-11 정정.** 여기에는 *"DEFINER 감사 트리거가 전 이미지를 `cal_audit_trash` 에 적재하므로 우회 접속자는 지운 흔적을 지우지 못한다"* 고 적혀 있었습니다. **그 트리거는 폐기됐습니다**(설계 §7.5). 그리고 그건 애초에 **탐지**였지 복구가 아니었습니다. 되돌리는 일은 그때도 덤프와 binlog 가 했습니다. **없는 상쇄를 있다고 적어 두지 않으려고 문장을 갈았습니다.**
  > 지금 공백으로 남은 것은 *"누가 우회했는가"* 를 아는 수단입니다. 80명이 `taskmgr_app` 한 계정을 공유하는 한 무엇을 남겨도 행위자가 갈리지 않으므로, 그 공백은 API 서버(또는 사용자별 계정) 도입 시 메웁니다.
- 표별로 어떤 동사를 주고 무엇을 안 주는지, 그 근거가 무엇인지는 **`grants-calendar.sql` 주석이 단일 소스**입니다. 여기 목록을 복사해 두지 않습니다. 복사본은 반드시 원본보다 뒤처집니다.

### 종료코드: `0` 이 아니면 배포가 끝난 것이 아닙니다

`init-calendar.cmd` 는 `init-calendar.ps1` 의 종료코드를 그대로 돌려줍니다. 무인 실행에서 **`0` 만 성공으로 세세요.**

| 코드 | 뜻 | 그다음에 할 일 |
|---|---|---|
| `0` | 게이트 전 항목 통과, 구축 완료 | 이관 도구(설계 §8) → 앱 DB 모드 전환 |
| `1` | 실패. 무엇이 왜 틀렸는지 화면에 찍고 멈춘다 | 메시지대로 고치고 재실행 |
| `2` | **사용자가 취소**. 아무것도 바꾸지 않음 | `0` 과 같이 취급하면 '취소된 실행'을 구축 완료로 세게 된다 |
| `3` | **(결번)** 옛 *'감사 트리거 없음'*. 2026-08-11 트리거 폐기로 사라졌다 | - |
| `4` | **미완**: 구조는 됐지만 **앱 계정이 없어 GRANT 미부여** | `create-app-user.sql` 로 계정을 만든 뒤 재실행. 그 전에는 앱이 `cal_*` 를 한 줄도 못 읽는다 |
| `5` | **(결번)** 옛 *'3 과 4 가 동시에'* | - |

> **★ `3`·`5` 를 결번으로 비워 두고 `4` 를 `3` 으로 당기지 않습니다.** 종료코드는 호출자와의 계약입니다.
> 이미 `4` 를 *'계정 없음'* 으로 읽도록 짜 둔 배치가 있다면, **값 하나를 비워 두는 것보다 `4` 의 뜻을
> 바꾸는 쪽이 훨씬 위험합니다**(오류 없이 조용히 다른 분기를 탑니다). 값을 재사용하지 마세요.
> 이 표의 정본은 `init-calendar.ps1` 머리말의 종료코드 상자입니다.

`1` 과 `4` 를 한 값으로 합치지 않은 이유는 **사람이 할 일이 다르기 때문**입니다. `1` 은 *"만든 것이 틀렸다(고쳐서 다시 돌려라)"*, `4` 는 *"만든 것은 맞고 남은 단계가 있다(그 단계만 하면 된다)"* 입니다. 합치면 멀쩡한 구조를 지우고 처음부터 다시 돌리는 대응을 부릅니다.

### 검증: 게이트를 통과했다고 끝이 아닙니다

`init-calendar` 의 게이트는 **구조**(표 명부, FK, CHECK 강제, rev 전원 시딩, 스키마 버전 행, GRANT 대조)를 봅니다. 그 밖에 **사람이 눈으로 볼 것**은 `grants-calendar.sql` 파일 끝의 확인 목록입니다. 특히 앱 계정으로 직접 접속해 **주면 안 되는 동사가 실제로 거부되는지**(스키마 버전 행에 대한 쓰기, DB 단위 권한, DDL).

> **2026-08-11.** 이 절에는 게이트 항목으로 *'트리거 실재'* 가, 육안 확인으로 *'`cal_audit_trash` 조회·삭제와 `DROP TRIGGER` 가 1142 로 거부되는지'* 가 적혀 있었습니다. 감사 트리거와 그 표가 폐기돼(설계 §7.5) 확인할 대상 자체가 없습니다. **게이트가 봐야 할 것이 하나 뒤집혔습니다.** 트리거가 *있는지* 가 아니라 `cal_*` 트리거가 **하나도 없는지**(기대값 0)입니다. 남아 있으면 폐기 전에 만든 DB 를 그대로 쓰고 있다는 뜻입니다.
>
> **2026-08-24: 게이트가 봐야 할 것이 하나 늘었습니다: `cal_*` 에 `login_id` 컬럼이 하나도 없어야 합니다**(기대값 0).
> 남아 있으면 대리키 전환(설계 §5.2) 전에 만든 DB 를 그대로 쓰고 있다는 뜻입니다.
> 표 개수와 FK 개수만 보는 게이트는 **이 상태를 통과시킵니다**(개수가 같기 때문입니다).
> ```sql
> SELECT TABLE_NAME FROM information_schema.COLUMNS
>  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'cal\_%' AND COLUMN_NAME = 'login_id';
> ```
> **개수가 아니라 이름을 보는 검사**라는 점이 핵심입니다. 표 명부를 셀 때 겪은 것과 같은 함정입니다.

> **백업은 이 게이트가 보지 않습니다.** 별도 도구라서입니다. 아래 '백업' 절의 확인을 따로 하세요.

> ⚠️ `init-calendar`/`schema-calendar.sql` 도 **멱등 재구축이라 기존 `cal_*` 를 DROP** 합니다(최초 1회 구축용). 데이터가 든 DB 에 다시 돌리면 캘린더 데이터가 사라집니다. 운영 중 구조 변경은 별도 `migrate-*.sql` 로 하세요(지금 남은 것은 `migrate-2026-10-15-code-ids.sql` 하나).

## 캘린더 표 마이그레이션: `cal_*`, `schema_version`

**`init-calendar`(=`schema-calendar.sql`)는 최초 1회 구축용입니다.** 기존 `cal_*` 를 `DROP` 하므로 데이터가 든 DB 에 다시 돌리면 캘린더가 사라집니다. **운영 중 구조 변경은 아래 `migrate-*.sql` 로만** 합니다.

### `schema_version`: 무엇이고 왜 있나

`cal_schema_meta` 표의 `k='schema_version'` 한 행이 **지금 이 DB 구조가 몇 번째 판인지**를 담습니다(단조증가 정수 문자열). 각 마이그레이션이 자기 앞뒤 값을 명시하고 **적용하면서 이 행을 올립니다.** `schema-calendar.sql` 은 새로 구축할 때 **최신 값을 곧바로 시딩**하므로, 새 DB 와 마이그레이션을 순서대로 돌린 DB 가 같은 값으로 만납니다. **그것이 "같은 구조인가"의 판정 기준**입니다(표 개수보다 강한 기준입니다).

- 앱은 접속 프리앰블에서 이 행을 **1회 읽습니다.** 권한도 `SELECT` 만 줍니다(`grants-calendar.sql`). 앱이 이 값을 올릴 수 있으면 '낡은 클라이언트 차단'이 성립하지 않기 때문이고, `init-calendar` 가 그 권한을 게이트로 확인합니다(설계 §5.5).
- 그 비교는 **`widget/CalendarDb.cs` 의 `ExpectedSchemaVersion` 상수**와 합니다(2026-09-03 구현). 다르면 **전량 교체(가져오기, 전체 초기화)만** 거부하고 조회와 통상 저장은 그대로 둡니다(설계 §5.5. 전 쓰기 봉인은 과합니다).
- ⚠️ **`migrate-*.sql` 을 하나 더할 때 `CalendarDb.ExpectedSchemaVersion` 도 같은 커밋에서 올리세요**(`tests/schema-guards.test.mjs` 가드 ⑨ 가 잡습니다). 안 올리면 게이트가 **거꾸로** 터집니다. 새 서버에서 최신 위젯이 스스로를 낡은 클라이언트로 판정해 가져오기·초기화가 전부 막힙니다.
- **버전 번호를 이 문서에 적지 않습니다.** 값의 정본은 `schema-calendar.sql` 끝의 `INSERT INTO cal_schema_meta … VALUES ('schema_version', …)` 한 줄이고, 실 DB 값은 아래로 확인합니다:
  ```sql
  SELECT v FROM cal_schema_meta WHERE k = 'schema_version';
  ```

### 적용 순서: 번호 오름차순, 건너뛰지 마세요

> **2026-10-15:** 아래 표의 파일(3~12)은 지웠습니다(git 이력에 있습니다). 지금 남은 이관 파일은
> `migrate-2026-10-15-code-ids.sql`(12 → 13, 코드표 번호 키) 하나이고, 데이터가 있는 로컬 DB 에만 씁니다.
> 새 DB 는 `setup-taskcalendar.cmd` 가 최신 판(13)으로 바로 만듭니다.

| 파일 | 무엇을 바꾸나 | `schema_version` |
|---|---|---|
| `migrate-2026-08-24-user-id.sql` | (사용자 표) `app_user` PK `login_id` → **`user_id`**. `cal_*` 의 FK 대상이라 **이것이 먼저입니다** | (전제) |
| `migrate-2026-08-24-org-id.sql` | (조직 표) `org_unit` PK `name` → **`org_id`** + 구 컬럼 절단 | (전제) |
| `migrate-2026-08-27-sort-order.sql` | `cal_entry`·`cal_todo` 에 **`sort_order`** 신설. 배열(문서) 순서를 박제. `created_at` 만으로는 되살릴 수 없었습니다(실 `data.xml` 계측: 일정 23건 중 **22건이 같은 밀리초**) | 3 → 4 |
| `migrate-2026-08-27-repo-flag.sql` | `cal_category` 에 **`uses_repo`** 신설. '저장소를 쓰는 과제' 한 비트. **경로 자체는 DB 에 올리지 않으므로**(PC 마다 달라야 하는 값이다. 올리면 남의 커밋이 내 보고서에 실립니다) 화면이 판단할 근거로 비트만 올립니다. 경로의 보관처는 `%APPDATA%\TaskCalendar\repo-paths.json` | 4 → 5 |
| `migrate-2026-08-31-report-daily.sql` | **`cal_report_daily`·`cal_report_hours`** 신설. 일간보고 사본 2표 | 5 → 6 |
| `migrate-2026-08-31-report-weekly.sql` | **`cal_report_weekly`** 신설. 주간보고 사본 1표. 일간과 달리 `content_from` 이 없습니다(위젯이 주간은 폼만 채우고 전송하지 않아 **전송 시점 자체를 모릅니다**) | 6 → 7 |
| `migrate-2026-08-31-sent-only.sql` | 위 세 표를 **캘린더가 만든 것만** 으로 좁힘. 사이트는 우리에게 무효화 신호를 주지 않으므로 "지금 사이트에 뭐가 있나"는 물어보기 전엔 알 수 없고 물어본 뒤에도 그 순간의 사진일 뿐입니다(2026-08-31 사용자 결정) | 7 → 8 |
| `migrate-2026-09-09-integrity.sql` | 무결성 규칙 통일 한 판. ① 소유자 FK 통일(`cal_report_daily`·`cal_report_weekly` 의 `app_user` FK 를 `CASCADE` → **`RESTRICT`**. GRANT 는 보고 이력을 못 지우게 하는데 FK 가 지우고 있었습니다) ② `cal_report_hours` 의 **과제 FK 신설**(쌍둥이 `cal_task_hours` 만 잠겨 있었습니다) ③ `cal_report_daily` **CHECK 2종**(근태 코드와 초과시간. 쌍둥이 `cal_attendance` 만 잠겨 있었습니다) ④ `hours` 를 **`DECIMAL(4,2)`** 로 ⑤ **감사 시각 KST → UTC 1회 정규화**(`ProjectDb` 가 프리앰블 없이 써 온 표들) ⑥ 표 주석 드리프트 복구 | 8 → 9 |
| `migrate-2026-09-10-dev-end-date.sql` | `project` 에 **`dev_end_date`**(개발종료일) 신설. 계약종료일(`end_date`)과 **별개**의 날짜입니다(개발을 먼저 끝내고 검수·납품 기간이 남거나, 계약만 연장되거나, **선진행**처럼 계약 날짜가 아예 없는데 개발은 도는 경우). `AFTER end_date` 로 자리까지 못 박습니다. 정본(신규 구축)과 컬럼 순서가 같아야 `mysqldump --no-data` 대조가 성립합니다. 기존 행은 전부 NULL(미정). **위젯이 이 컬럼을 SELECT 하므로 DB 를 먼저 올리세요**(구버전 DB + 새 위젯 = `ERROR 1054` 로 과제 목록이 통째로 빔) | 9 → 10 |
| `migrate-2026-09-10-user-sort-order.sql` | (사용자 표) `app_user` 에 **`sort_order`**(명부 서열) 신설. 관리자가 앱 안에서 정하는 **전사 단일** 서열입니다(설계 [`../../docs/USER-ADMIN.md`](../../docs/USER-ADMIN.md)). `AFTER title` 로 자리까지 못 박습니다. 정본(비공개 `01-schema-users.sql`)과 컬럼 순서가 같아야 `mysqldump --no-data` 대조가 성립합니다. 기존 행은 **NULL 로 두지 않고** 직급 서열 → 이름 순으로 10 간격을 채웁니다(참고값. 관리자가 한 번 저장하면 앱이 전량 재작성). **같은 날 두 번째 판이라 위 `dev-end-date` 를 먼저 적용하세요.** 가드가 그 순서를 강제합니다 | 10 → 11 |
| `migrate-2026-09-10-user-sort-order-int.sql` | `app_user.sort_order` 를 **SMALLINT → INT UNSIGNED** 로 넓힌다(값·위치 보존, MODIFY 만). SMALLINT 은 10 간격 6,553명이 천장이었다(격리 DB 실측 6,554명째 ERROR 1264 전량 롤백). 가드가 11 에서만 열린다. 위젯 `ExpectedSchemaVersion` 12 와 같은 창에 | 11 → 12 |
| **`migrate-2026-10-15-code-ids.sql`** *(지금 남은 유일한 이관 파일)* | (과제 트랙과 사용자 표) 코드표 넷 `customer`, `section_code`, `status_code`, `title_code` 의 PK 를 이름에서 **번호**(`customer_id`, `section_id`, `status_id`, `title_id`)로. 자식 `project.customer`/`section`/`status`, `app_user.title` 을 `*_id` 번호 열로 바꾸고 옛 열을 지운다. 위젯 `ExpectedSchemaVersion` 13 과 같은 창에. 아래 '코드표 번호 키 이관' 절 | 12 → 13 |

> 위 표에서 이 줄 앞의 파일은 전부 지웠습니다(2026-10-15). 아래 두 ⚠️ 상자도 그 파일들의 기록입니다.

> ### ⚠️ `migrate-2026-09-10-user-sort-order.sql`: 적용 전에 알아야 할 셋
>
> - **초기값 UPDATE 가 `updated_at` 을 자기 값으로 명시해 덮습니다.** `ON UPDATE` 발화를 일부러 막는 것입니다. 안 그러면 컬럼 하나 늘린 일로 **전 직원의 마지막 수정 시각이 지금으로 덮입니다.** 그건 인사 이력이지 이 마이그레이션이 지울 값이 아닙니다(같은 이유가 `migrate-2026-09-09-integrity.sql` (5) 에도 있습니다). **그 한 줄을 지우고 돌리지 마세요.**
> - **비공개 `05-grants.sql` 을 반드시 다시 적용하세요.** 이 파일은 컬럼만 세웁니다. 앱 계정이 `app_user` 에 **INSERT·UPDATE** 를 갖는 것은 `taskmgr-company-data/05-grants.sql` 이 하는 일이고, 그게 없으면 **명부는 보이는데 직원 관리 저장만 `ERROR 1142` 로 전부 죽습니다**(이 폴더의 `grants-calendar.sql` 은 그 사실을 **서술만** 하고 `app_user` 에는 `SELECT` 만 발행합니다. 그 파일 머리말의 ★ 참조).
> - **배포 순서는 DB 가 먼저입니다.** 새 위젯의 구성원 명부 조회가 이 컬럼을 `SELECT`·`ORDER BY` 하는데, **판번호 게이트는 명부 조회를 막지 않습니다**(전량 교체만 거부합니다. 설계 §5.5). 그래서 **이 파일을 적용하지 않은 DB 에 새 위젯이 붙으면** 게이트가 아무 말 없이 **명부가 `ERROR 1054` 로 통째로 빕니다.** 반대(적용한 DB + 구버전 위젯)는 무해합니다. 컬럼을 모를 뿐입니다.

> **각 파일의 머리말이 그 마이그레이션의 정본**입니다. 왜 필요한지, 무엇을 깨뜨리는지, 되돌릴 수 있는지가 거기 적혀 있습니다. 이 표는 색인일 뿐입니다.

> ### ⚠️ `migrate-2026-09-09-integrity.sql` 만 성질이 다릅니다: 적용 전에 이 상자를 읽으세요
>
> 위의 다른 파일들은 `CREATE TABLE IF NOT EXISTS`·`ALTER … IF NOT EXISTS` 계열이라 몇 번을 돌려도 무해했습니다. **이 파일은 아닙니다.**
>
> - **재실행 안전이 아닙니다.** ⑤가 **데이터 시프트**입니다. 두 번 돌면 시각이 **18시간** 어긋나고, `DATETIME` 은 '한 번 밀렸는지 두 번 밀렸는지'를 값만 보고 구분할 수단이 없어 **복구가 불가능**합니다. 그래서 파일 맨 앞 가드가 **`schema_version` 이 정확히 8 이 아니면 중단**시킵니다(멱등을 흉내내는 대신 두 번째 실행 자체를 막습니다).
> - **적용 전 백업은 선택이 아닙니다.** `db\deploy\backup-taskmgr.ps1`(=`backup-taskmgr.cmd`)로 먼저 받으세요. 구조만 바꾸는 다른 마이그레이션과 달리 이 파일은 **값을 바꿉니다.**
> - **`widget/ProjectDb.cs` 의 접속 프리앰블과 반드시 같은 배포에 실어야 합니다.** 한쪽만 나가면 한 컬럼에 **KST 와 UTC 가 섞입니다.** SQL 만 나가면 정규화 뒤에 앱이 다시 KST 로 쓰고, 코드만 나가면 옛 행은 KST 인 채로 새 행만 UTC 가 됩니다. 어느 쪽이든 사후 구분이 안 됩니다.
> - 적용 뒤에는 **표 주석이 바뀌므로**(⑥) `tools/schema-report/` 의 재생성까지 한 라운드입니다. 절차는 파일 머리말에 있습니다.

### 코드표 번호 키 이관: `migrate-2026-10-15-code-ids.sql` (12 → 13)

결정과 근거는 [`../../docs/CODE-TABLE-IDS.md`](../../docs/CODE-TABLE-IDS.md) §6, 설계는 [`../TABLE-DESIGN.md`](../TABLE-DESIGN.md) §9 ADR-23. **실행법과 단계의 정본은 그 파일의 머리말**이고 아래는 색인입니다.

**언제 쓰나.** 이미 데이터가 있고 지우면 안 되는 **v12 DB 하나**에만 씁니다. 지금은 개발자 로컬 PC 의 `taskcalendar` 가 그것입니다.
- 새로 세우는 DB(회사 서버 포함)에는 **쓰지 않습니다.** `setup-taskcalendar.cmd` 가 고친 스키마 파일로 처음부터 v13 을 만들고, 원본 `taskmgr` 에서 과제를 복사할 때 이름을 번호로 바꿉니다.
- `title_code` 와 `app_user` 는 회사 저장소가 만든 표지만 같은 물리 DB 안에 있으므로 이 파일이 함께 옮깁니다.
- 판번호가 12 가 아니면 할 일이 없습니다(이미 13 이면 가드에서 멈춥니다).

**어떻게.** 2026-10-16 부터는 아래 '기존 PC 의 DB 이관(마스터 cmd)' 절의 `migrate-code-ids.cmd` 가 이 순서를 대신합니다. 손으로 할 때의 순서는 이렇습니다.
1. 위젯을 모두 닫습니다(열린 트랜잭션이 있으면 첫 `ALTER` 가 10초 뒤 `ERROR 1205` 로 멈춥니다. 이때는 바뀐 것이 없습니다).
2. **백업. DB 이름을 꼭 적습니다**: `backup-taskmgr.cmd -DbName taskcalendar`. 덤프가 끝난 것을 확인하고 다음으로 갑니다.
3. 관리자 계정으로, 문자셋 `utf8mb4` 로, **`--force` 없이** 돌립니다(비밀번호는 명령줄에 쓰지 않습니다):
   ```
   mysql -u root -p --default-character-set=utf8mb4 taskcalendar < db\deploy\migrate-2026-10-15-code-ids.sql
   ```
4. 끝나면 위젯을 v13 판(`ExpectedSchemaVersion` 13)으로 바꿔 띄웁니다. 옛 위젯(12)은 이 DB 를 거부합니다.
- 실 DB 에 돌리기 전에 **복제한 격리 DB 에서 먼저** 돌립니다(CODE-TABLE-IDS §6, §12).

**무엇을 확인하나.**
- **가드(아무것도 바꾸기 전)**: 대상 표 7개, `schema_version = '12'`, 옛 모양(이름 키)인지, 문자셋, 뷰와 트리거 없음, 외래키 모양, 데이터 사전 점검.
- **절단 관문(옛 열을 지우기 직전)**: 번호로 되살린 이름이 스냅숏(과제 uid 별 발주처, 구분, 상태와 사용자별 직급)과 `BINARY` 로 한 글자도 다르지 않고 NULL 여부도 같아야 합니다. 시드 이름은 고정 번호 지도(구분 2=선진행, 상태 2=종료 등)로 번호를 받고, 나머지는 MAX+1 부터 이름순입니다.
- **사후 검증**: 고아 0, 표별 행 수 불변, 이름 복원 `BINARY` 일치, `cal_*` 행 수와 `cal_user_rev` 불변, 구조, `AUTO_INCREMENT` > MAX. 어긋나면 실행을 실패시킵니다.
- 끝으로 앱 계정의 안 쓰는 `UPDATE` 권한(`cal_entry_commit`, `cal_todo_day_note`, `cal_room`)을 거둡니다(CODE-TABLE-IDS §8-3). `cal_room` 은 2026-10-21 구조 번호 15 에서 표째 없앴습니다(SHARED-ROOMS).
- 사람이 따로 할 대조: 빈 격리 DB 에 `setup-taskcalendar` 로 새로 만든 결과와 `information_schema`(열, 인덱스, 외래키, CHECK, 표 COMMENT)가 같아야 합니다. 질의 예는 파일 머리말 【대조】.

**멈추면.** 조건이 어긋나면 '없는 표 이름'을 SELECT 해 `ERROR 1146` 으로 멈춥니다. 마지막 *"중단: …"* 줄이 이유입니다.
- **가드나 절단 관문에서 멈춤**: 옛 열과 옛 키가 그대로입니다(관문에서 멈췄다면 더한 번호 열만 남습니다). 원인(데이터)을 고친 뒤 이 파일을 그대로 다시 돌리면 됩니다.
- **절단 관문 뒤에서 멈춤**: 반쯤 바뀐 상태입니다. 가드가 재실행을 막으므로 2번의 백업으로 되돌린 뒤 다시 합니다.
- DDL 은 암묵 커밋이라 이 파일은 원자적이지 않습니다. 안전장치는 백업과 절단 관문입니다. **`--force` 를 붙이면 관문이 무력화됩니다**(에러가 나도 다음 줄로 가서 옛 열을 지웁니다).

**실측(2026-10-15, MySQL 8.4.9, 실데이터 로컬 복제본: 발주처 8, 구분 3, 상태 4, 직급 11, 과제 14, 사용자 89, 일정 3,625)**:
절단 관문과 사후 검증 전부 0. 다시 돌리면 v12 가드에서 멈춤. 대소문자만 다른 표류(`project.customer` 가 `'ZZCASE'`, `customer.name` 이 `'zzCase'`)는 절단 관문에서 멈추고 옛 열이 그대로 남음. 이관한 DB 와 `setup-taskcalendar` 로 새로 만든 DB 의 `information_schema` 가 양쪽 359줄로 차이 0. 계약일 역전(`start_date > end_date`)은 로컬 `taskcalendar` 와 원본 `taskmgr` 모두 0건(그래서 순서 CHECK 를 넣을지는 따로 정합니다. 이 파일은 넣지 않습니다).

### 기존 PC 의 DB 이관(마스터 cmd): `migrate-code-ids.cmd`

위 이관 SQL 을 사람이 지켜야 하는 순서(위젯 닫기, 백업, 백업 확인, `--force` 없이 실행, 멈춘 자리 판단)째로 한 번에 돌리는 도구입니다(2026-10-16). 0.21.0 이상 앱(지금은 0.22.0)을 올리기 전에, 데이터가 있는 v12 DB(예: 서버 노릇을 하는 PC 의 `taskcalendar`)에 한 번 씁니다. 정본은 `migrate-code-ids.ps1` 머리말입니다.

**언제 쓰지 않나.** 새로 세우는 DB(회사 서버 포함)는 `setup-taskcalendar.cmd` 로 만듭니다. 이미 v13 인 DB 는 이 도구가 판번호를 읽고 "이미 v13 입니다. 할 일이 없습니다." 로 끝냅니다(종료코드 0).

```
migrate-code-ids.cmd                                  # 더블클릭: 묻고, 백업하고, 옮긴다
migrate-code-ids.cmd -DbName taskcalendar_copy        # 복제한 격리 DB 로 먼저 리허설
migrate-code-ids.cmd -DbHost 192.168.0.50 -BackupDir "D:\taskmgr-backup"
```

**하는 일(첫 실패에서 멈춥니다).**
1. 사전 점검: `mysql.exe`, `mysqldump.exe`(`-BaseDir`, 서비스 `MySQL84` 의 binPath, `C:\Program Files\MySQL\MySQL Server 8.4` 순서), 같은 폴더의 `migrate-2026-10-15-code-ids.sql`, 접속, DB 와 `cal_schema_meta`, `schema_version`(13 이면 끝, 12 가 아니면 멈춤), 옛 모양(이름 키). 판번호가 12 인데 옛 모양이 아니면 앞선 실행이 반쯤 바꾼 DB 로 보고 멈춥니다(이전 백업 목록을 보여 줍니다).
2. 앱 세션 확인: `information_schema.PROCESSLIST` 에서 앱 계정(`taskmgr_app`)이 이 DB 에 붙은 연결을 셉니다. 하나라도 있으면 목록을 보여 주고 멈춥니다(종료코드 4). `-Force` 는 이 확인 하나만 건너뜁니다.
3. 확인: DB, 서버, 행 수(project, app_user, cal_entry), 백업 경로를 보여 주고 `Y` 를 받습니다(`-Yes` 면 묻지 않습니다. 입력이 리다이렉트된 무인 실행은 `-Yes` 가 있어야 합니다).
4. 백업: `mysqldump --single-transaction --no-tablespaces --routines --triggers --events --set-gtid-purged=OFF` 를 `<BackupDir>\<DB>-before-code-ids-<시각>.sql` 로 뜹니다. 1KB 를 넘고 끝에 `-- Dump completed` 가 있어야 통과이고, 그전에는 `.partial` 이름이라 `restore-taskmgr` 가 고르지 않습니다. `--databases` 는 쓰지 않습니다(덤프에 `USE` 가 들어가면 `restore-taskmgr -TargetDb` 가 라이브로 들어갑니다). 기본 `BackupDir` 는 `dist\migrate-code-ids\backup` 입니다.
5. 이관 SQL: `mysql --default-character-set=utf8mb4 -t <DB> < migrate-2026-10-15-code-ids.sql`, `--force` 없이. 출력과 오류는 `<BackupDir>\<DB>-migrate-code-ids-<시각>.log` 에 남습니다.
6. 판정: 판번호를 다시 읽어 13 인지, 사전 점검, 절단 관문(`cut_*`), 사후 검증(`e1`~`e8`) 표가 모두 0 인지, 행 수가 같은지 봅니다. 성공하면 "이제 0.21.0 이상(최신) 앱을 설치하세요" 로 끝납니다.

**멈추면(종료코드 1).** 출력 문구가 아니라 DB 상태(판번호, 옛 열, 이름 기본키, 이름 외래키)를 다시 읽어 가릅니다.
- **절단 전**(옛 열과 키가 그대로): "옛 열은 그대로입니다. 메시지대로 데이터를 고친 뒤 다시 실행하세요." 마지막 *"중단: …"* 줄이 이유입니다. `ERROR 1205` 면 위젯이 열려 있던 것입니다.
- **스키마는 13 이고 마지막 권한 회수만 실패**: 관리자가 칠 `REVOKE UPDATE …` 세 줄을 보여 줍니다.
- **절단 뒤이거나 알 수 없음**: 그 DB 를 쓰지 말고 백업으로 되돌립니다. 도구가 아래 꼴의 명령을 경로까지 채워 보여 줍니다(비밀번호는 `restore-taskmgr` 가 따로 묻습니다):
  ```
  restore-taskmgr.cmd -DumpPath "<백업>" -BackupDir "<백업 폴더>" -LiveDb taskcalendar -TargetDb taskcalendar_before_code_ids
  restore-taskmgr.cmd -DumpPath "<백업>" -BackupDir "<백업 폴더>" -LiveDb taskcalendar -TargetDb taskcalendar -OverwriteLive
  restore-taskmgr.cmd -BackupDir "<백업 폴더>" -LiveDb taskcalendar -TargetDb taskcalendar_before_code_ids -DropTarget
  ```
  첫 줄은 별도 DB 로 되살려 내용을 확인하는 것이고, 둘째 줄이 라이브를 이관 전으로 되돌립니다. 둘째 줄은 대화형 콘솔에서만 열리고 DB 이름을 그대로 입력해야 합니다. `restore-taskmgr` 가 지금 상태를 pre-restore 덤프로 먼저 남긴 뒤 DB 를 지우고 다시 만들어 붓습니다(앱 계정 권한은 DB 를 지워도 남습니다). 셋째 줄은 확인용 DB 뒷정리입니다.

**종료코드.** `0` 성공 또는 이미 v13, `1` 이관 실패(위 안내), `2` 취소, `3` 사전 점검 실패(아무것도 안 바꿈), `4` 앱 세션이 열려 있음(아무것도 안 바꿈), `5` 백업 실패(DB 는 그대로). 표의 정본은 `.ps1` 과 `.cmd` 머리의 같은 ASCII 블록입니다.

**비밀번호.** 인자로 받지 않습니다. 환경변수 `TASKMGR_ADMIN_PW`, 입력이 리다이렉트돼 있으면 stdin 첫 줄(상한 10초), 대화형이면 가려진 입력 순서이고, mysql 에는 임시 `.cnf`(`--defaults-extra-file`)로만 넘기며 끝나면 지웁니다. 회귀 계약은 `tests/migrate-code-ids-cmd.test.mjs`.

### 모든 직원의 열람 범위를 전체로(scope-all.cmd)

이 회사는 주간보고를 이미 서로 다 볼 수 있으므로, 캘린더의 일정 열람 범위도 모든 직원이 '전체' 입니다(2026-10-16 결정). `scope-all.cmd` 는 `<DB>.app_user` 의 모든 행(재직, 비활성 모두)의 `view_scope` 를 `all` 로 바꿉니다. `edit_role` 과 다른 열은 건드리지 않습니다. 정본은 `scope-all.ps1` 머리말입니다.

```
scope-all.cmd                                  # 더블클릭: 지금 분포를 보여 주고, 묻고, 바꾼다
scope-all.cmd -DbName taskcalendar_copy        # 복제한 격리 DB 로 먼저 리허설
scope-all.cmd -DbHost 192.168.0.50 -OutDir "D:\taskmgr-ops"
```

**언제 다시 돌리나.**
- `setup-taskcalendar.cmd` 로 서버를 새로 세운 뒤. 새 행의 기본값이 `self` 이고, setup 이 붓는 회사 시드 `04-permissions.sql` 도 대부분을 `self` 로 둡니다.
- 관리 화면에서 새 직원을 등록하면서 열람 범위를 기본값(본인만)으로 둔 뒤.

이미 모두 `all` 이면 "이미 모두 전체입니다. 할 일이 없습니다." 로 끝납니다(종료코드 0). 몇 번을 돌려도 안전합니다.

**하는 일(첫 실패에서 멈춥니다).**
1. 사전 점검: `mysql.exe`(`-BaseDir`, 서비스 `MySQL84` 의 binPath, `C:\Program Files\MySQL\MySQL Server 8.4` 순서), 접속, DB, `app_user` 와 `user_id`, `view_scope` 열. `cal_schema_meta` 의 `schema_version` 은 보여 주기만 합니다(특정 판을 요구하지 않습니다). 지금 분포(`view_scope`, 재직 여부별 인원)와 바뀔 행 수를 보여 주고 `Y` 를 받습니다(`-Yes` 면 묻지 않습니다. 입력이 리다이렉트된 무인 실행은 `-Yes` 가 있어야 합니다).
2. 되돌리기 파일: 바뀔 행마다 `UPDATE app_user SET view_scope='<옛 값>' WHERE user_id=<번호>;` 한 줄씩 `<OutDir>\<DB>-scope-before-<시각>.sql` 에 씁니다. 다시 읽어 줄 수와 `user_id` 목록이 계획과 같아야 다음으로 갑니다(아니면 종료코드 5, DB 는 그대로). 기본 `OutDir` 는 `dist\scope-all` 입니다.
3. 변경: 트랜잭션 하나입니다. 바뀔 행을 잠그고, `user_id` 목록이 계획과 같은지 보고, `UPDATE app_user SET view_scope = 'all'` 을 한 뒤 바뀐 행 수가 계획과 같을 때만 `COMMIT` 합니다. 어긋나면 커밋 전에 멈추고 되돌려집니다(종료코드 1). `'all'` 인지는 글자 그대로 봅니다(위젯이 대소문자까지 그대로 비교하므로 `ALL` 같은 값도 바꿀 대상입니다).
4. 확인: `'all'` 이 아닌 행이 0 인지 다시 세고 새 분포와 되돌리기 파일 경로를 보여 줍니다.

`app_user.updated_at` 은 `ON UPDATE CURRENT_TIMESTAMP(3)` 라서 실제로 바뀐 행만 지금 시각으로 바뀝니다(표가 스스로 하는 일입니다).

**위젯은 다시 시작하지 않아도 됩니다.** 위젯은 열람 범위를 부팅 때 읽어 두지 않고, 구성원 창이나 사람 고르기 목록을 열 때(`membersGet`), 다른 사람 일정을 열 때(`CanViewScheduleAsync`) 마다 DB 에서 새로 읽습니다. 이미 열려 있는 구성원 창이나 사람 고르기 목록만 닫았다가 다시 열면 됩니다.

**되돌리기.** 되돌리기 파일 머리말에 명령이 적혀 있습니다. MySQL 의 bin 폴더에서 아래처럼 붓습니다(비밀번호는 mysql 이 묻습니다). `user_id` 로 행을 골라 `view_scope` 하나만 되돌리므로, 그 사이 관리 화면에서 그 사람들에게 바꾼 열람 범위도 파일의 값으로 덮입니다.
```
mysql --default-character-set=utf8mb4 -u root -p taskcalendar < "<OutDir>\taskcalendar-scope-before-<시각>.sql"
```

**종료코드.** `0` 완료 또는 할 일 없음, `1` 변경 실패(되돌려짐) 또는 커밋 뒤 확인 실패, `2` 취소, `3` 사전 점검 실패(아무것도 안 바꿈), `5` 되돌리기 파일 실패(아무것도 안 바꿈). 표의 정본은 `.ps1` 과 `.cmd` 머리의 같은 ASCII 블록입니다. 비밀번호는 `migrate-code-ids.cmd` 와 같은 방식으로 받습니다(인자 없음, `TASKMGR_ADMIN_PW`, stdin 첫 줄, 가려진 입력). 회귀 계약은 `tests/scope-all-cmd.test.mjs`.

### 검토자 읽기 전용 계정(reviewer-account.cmd)

외부 검토자가 자기 PC 에서 MySQL 클라이언트(Workbench, DBeaver, HeidiSQL)로 `taskcalendar` 를 읽어야 할 때 씁니다(2026-10-16). 검토자 PC 의 IP 에서만 붙는 전용 계정 `reviewer` 를 만들고 `SELECT, SHOW VIEW` 만 줍니다. 바뀌는 것은 MySQL 의 계정과 권한 정보뿐이고 DB 안의 표와 행은 그대로입니다. 정본은 `reviewer-account.ps1` 머리말입니다.

**왜 root 나 앱 계정을 주지 않나.**
- root 는 `root@localhost` 하나뿐이라 다른 PC 에서는 붙지 못하고, 붙는다 해도 모든 권한입니다. 원격 root 를 새로 여는 것은 하지 않습니다.
- 앱 계정 `taskmgr_app` 은 쓰기 권한이 있고, 비밀번호가 위젯 설정에 들어 있어 바꾸면 모든 위젯이 끊깁니다.
- 그래서 검토용 계정을 따로 둡니다. 이름은 `root`, `taskmgr_app`, `taskmgr_backup` 을 받지 않습니다(같은 이름에 더 구체적인 호스트를 붙이면 그 PC 에서 기존 계정 대신 이 계정이 맞습니다).

**데이터 노출.** 이 계정은 그 DB 의 모든 표를 읽습니다. 모든 직원의 일정, 할 일, 주간보고, 이름과 조직이 보입니다. 검토가 끝나면 바로 지웁니다(아래 지우기).

**서버 PC 에서 하는 일.**
1. 검토자 PC 의 IP 를 받습니다(검토자 PC 에서 `ipconfig`). 한 대면 `192.168.16.25`, 그 대역 아무 PC 면 `192.168.16.%`(/24) 꼴입니다. `%` 하나, 이름(`localhost` 등), 다른 와일드카드는 받지 않습니다.
2. `reviewer-account.cmd` 를 오른쪽 단추로 눌러 **관리자 권한으로 실행** 합니다(방화벽 규칙을 만들려면 관리자 권한이 있어야 합니다). 명령 창에서는 관리자 명령 창을 열고:
   ```
   reviewer-account.cmd -ReviewerIp 192.168.16.25
   reviewer-account.cmd -ReviewerIp 192.168.16.%
   ```
   더블클릭하면 IP 를 묻습니다. 다른 배치 파일 안에서 부를 때는 `%` 를 `%%` 로 적습니다.
3. 도구가 root 비밀번호를 묻고 접속한 뒤 `bind_address`, `port`, `skip_networking` 을 보여 줍니다. `skip_networking=ON` 이거나 `bind_address` 가 `127.0.0.1`(또는 localhost)뿐이면 다른 PC 에서 붙을 수 없다고 경고하고, 고칠 my.ini 경로(서비스 `MySQL84` 의 `--defaults-file`)를 알려 줍니다. `[mysqld]` 에서 `skip-networking` 을 지우고 `bind-address=0.0.0.0`(또는 서버의 내부망 IP)로 둔 뒤 서비스를 다시 띄웁니다. 계정은 경고와 상관없이 만듭니다.
4. 확인 화면(계정 `'reviewer'@'<IP>'`, DB, 권한 "읽기 전용(SELECT, SHOW VIEW)", 모든 직원 데이터 경고)에서 `Y` 를 누르고 검토자 비밀번호를 두 번 입력합니다. 12자 이상, 영문과 숫자와 기호만(따옴표, 역슬래시, 백틱, 공백, 한글은 안 됨), root 비밀번호와 달라야 합니다.
5. 도구가 `CREATE USER ... PASSWORD EXPIRE NEVER` 와 `GRANT SELECT, SHOW VIEW ON taskcalendar.* TO ...` 를 내고, `SHOW GRANTS FOR` 가 `USAGE` 와 그 한 줄뿐인지 봅니다. 다르면 방금 만든 계정을 `DROP USER` 로 되돌리고 멈춥니다(종료코드 1). GRANT OPTION 은 주지 않습니다.
6. 관리자 권한이면 받는 규칙 `TaskCalendar MySQL reviewer <IP>` 를 만듭니다(TCP 3306, 원격 주소는 그 IP 나 `a.b.c.0/24`, 프로필 Domain,Private). 관리자 권한이 아니면 실패로 치지 않고 관리자 PowerShell 에서 칠 `New-NetFirewallRule ...` 명령을 그대로 보여 줍니다. 이미 3306 을 아무 주소에나 여는 규칙이 있으면 알려 줍니다(그때 IP 제한은 MySQL 계정의 호스트만 남습니다). 네트워크가 공용(Public)이면 이 규칙이 듣지 않는다고도 알려 줍니다.
7. 마지막에 검토자에게 줄 접속 정보를 보여 줍니다. 이 PC 의 IPv4(검토자와 같은 대역 표시), 포트, 사용자, DB, 클라이언트별 입력 칸입니다. 비밀번호는 화면과 보고서에 없습니다.

**검토자에게 줄 것.** 클라이언트(Workbench, DBeaver, HeidiSQL 중 하나), 서버 IP, 포트(3306), 사용자 `reviewer`, 기본 스키마 `taskcalendar`. 비밀번호는 메신저 대화방이나 메일 본문이 아닌 길로 따로 전달합니다. DBeaver 에서 "Public Key Retrieval is not allowed" 가 나오면 드라이버 속성 `allowPublicKeyRetrieval=true` 로 둡니다.

**비밀번호 바꾸기, 보기, 지우기.**
```
reviewer-account.cmd -ReviewerIp 192.168.16.25 -ResetPassword   # 비밀번호만 바꾼다(ALTER USER)
reviewer-account.cmd -List                                      # reviewer 계정(모든 호스트), 권한, 방화벽 규칙
reviewer-account.cmd -Drop -ReviewerIp 192.168.16.25            # 계정과 방화벽 규칙을 지운다
```
`-Drop` 은 확인(`Y`) 뒤 `DROP USER IF EXISTS` 를 내고 사라졌는지 확인합니다. `DROP USER` 는 열린 세션을 끊지 않으므로 그 호스트에서 온 세션을 `KILL` 합니다. 방화벽 규칙은 관리자 권한이면 지우고, 아니면 `Remove-NetFirewallRule` 명령을 보여 줍니다.

**리허설(이 PC 에서만).** `-AllowLocal -ReviewerIp 127.0.0.1 -NoFirewall` 이면 `'reviewer'@'127.0.0.1'` 을 만들고, 그 계정으로 실제로 붙어 표 목록은 읽히고 `CREATE TABLE` 은 거부되는지(오류 1142)까지 봅니다. 끝나면 `-AllowLocal -Drop -ReviewerIp 127.0.0.1 -NoFirewall` 로 지웁니다.

**종료코드.** `0` 완료(만들기, 비밀번호 바꾸기, 지우기, 보기), `1` 계정 단계 실패(새로 만든 계정은 되돌림), `2` 취소, `3` 사전 점검 실패(IP, 계정 이름, 도구, 비밀번호, 접속, DB, 이미 있는 계정. 아무것도 안 바꿈), `6` 방화벽 단계 실패(계정은 있음, 보여 준 명령을 관리자 PowerShell 에서 실행). 관리자 권한이 아니어서 방화벽을 건너뛴 것은 실패가 아닙니다(종료코드 0, 보고서에 할 일로 남음). 표의 정본은 `.ps1` 과 `.cmd` 머리의 같은 ASCII 블록입니다.

**비밀번호.** 둘 다 인자로 받지 않습니다. root 는 `scope-all.cmd` 와 같은 방식(`TASKMGR_ADMIN_PW`, stdin 첫 줄, 가려진 입력)이고, 검토자 비밀번호는 `TASKMGR_REVIEWER_PW` 나 가려진 입력 두 번입니다. 계정 SQL 은 `%TEMP%` 의 임시 `.sql` 에만 쓰고 mysql 의 stdin 으로 흘린 뒤 바로 지웁니다. mysql 출력은 비밀번호 글자를 가린 뒤에만 화면에 옮깁니다. 기록은 `dist\reviewer-account\reviewer-account-<시각>.txt` 입니다. 회귀 계약은 `tests/reviewer-account-cmd.test.mjs`.

---

## 사용자·조직 표 마이그레이션: `app_user`, `org_unit`

> **이 폴더의 `migrate-2026-08-24-*.sql` 두 개는 캘린더 트랙도 과제 트랙도 아닙니다.**
> 대상 표(`app_user`·`org_unit`)의 **DDL 은 비공개 저장소**(`taskmgr-company-data`)에 있는데,
> **이미 서 있는 DB 를 옮기는 1회용 SQL 만** 이쪽에 있습니다. 실명 데이터가 안 들어가기 때문입니다.
> 둘은 서로 **독립**입니다(건드리는 키가 겹치지 않습니다. 저쪽은 `app_user` 의 키, 이쪽은
> `org_unit` 의 키 + `app_user` 에 컬럼 하나). 어느 쪽을 먼저 돌려도 되지만 **결국 둘 다** 돌려야 합니다.
>
> **2026-10-15: 아래 표의 앞 세 파일(`migrate-2026-08-24-user-id.sql`, `migrate-2026-08-24-org-id.sql`,
> `rollback-2026-08-24-org-id.sql`)은 지웠습니다**(git 이력에 있습니다). 옛 키 DB 를 더 옮기지 않고, 새 DB 는
> `setup-taskcalendar.cmd` 가 처음부터 `user_id`, `org_id` 구조로 만들기 때문입니다. 이 절과 바로 아래
> '조직 대리키 전환' 절은 그 파일들이 무엇을 했고 무엇을 지켰는지의 기록입니다. **지금도 쓰는 것은 `org-ops` 둘**입니다.
> 직급(`title_code`, `app_user.title_id`)의 번호 키 전환은 위 '코드표 번호 키 이관' 절의 파일이 함께 합니다.

| 파일 | 무엇을 바꾸나 | 누가 요구하나 |
|---|---|---|
| ~~`migrate-2026-08-24-user-id.sql`~~ (지움) | `app_user` PK: `login_id` → **`user_id`** | `cal_*` 의 소유자 FK(위 '배포 순서' 단계 `0`), `init-calendar` 선행조건 `1-4` |
| ~~`migrate-2026-08-24-org-id.sql`~~ (지움) | `org_unit` PK: `name` → **`org_id`** (+ `app_user.org_id` 신설, **구 컬럼 `org_unit.parent`·`app_user.org_unit` DROP**) | `taskmgr-company-data\apply.cmd` 의 `02`·`03` 시드, `apply.ps1` 의 `org_id` 게이트 |
| ~~`rollback-2026-08-24-org-id.sql`~~ (지움) | 위 org-id 를 **되돌린다**(구 컬럼을 정본에서 **재생성**) | (사고 시에만) |
| `org-ops.cmd` (=`org-ops.ps1`) | 구축이 아니라 **운영**용. 조직 개명, 신설, 팀 이동, 인사이동. **보통 쓰는 것이 이쪽입니다** (사전 불변식 점검, `-WhatIf`, `repair`, 종료코드 계약) | 조직이 바뀔 때마다 |
| `org-ops.sql` | 같은 4종의 **`mysql` 전용 대체본**. PowerShell 을 못 쓰는 환경용 | 〃 |

> **★ `app_user` 를 바꾸는 마이그레이션이 이 절에만 있는 것은 아닙니다.**
> `migrate-2026-09-10-user-sort-order.sql`(명부 서열)도 대상 표가 `app_user` 지만
> **`schema_version` 을 올리므로** 위 '캘린더 표 마이그레이션' 의 적용 순서표에 있습니다.
> 판번호를 올리는 파일은 전부 그 표 한 곳에 모여 있어야 순서가 끊기지 않기 때문입니다.
> 여기 08-24 두 개가 `(전제)` 인 것은 판번호 체계가 서기 **전**의 파일이라서입니다.

### 조직 대리키 전환: `migrate-2026-08-24-org-id.sql`

> **2026-10-15: 이 파일은 지웠습니다(git 이력에 있습니다).** 아래는 그 파일의 기록입니다. 조직을 바꾸는 지금의
> 도구는 이 절 뒤쪽의 `org-ops.cmd`/`org-ops.sql` 이고, 그 부분은 지금도 유효합니다(기본 DB 는 `taskcalendar`).

**무엇을 하나.** `org_unit` 의 기본키를 이름에서 번호로 옮깁니다. `org_id`(PK, AUTO_INCREMENT) 신설,
`name` 은 `UNIQUE` 로 강등, 계층의 정본을 `parent_id`(FK)로 옮기고, **개명을 막던 자기참조 FK
`fk_org_parent` 를 뗍니다.** `app_user` 에는 `org_id` 컬럼을 추가해 89행을 백필합니다.
**그리고 구 컬럼 두 개를 지웁니다.** `org_unit.parent` 와 `app_user.org_unit` 은 9·10단계에서
`fk_org_parent`·`fk_user_org` 와 함께 **영구히 사라집니다**(단일 컬럼 인덱스 `ix_org_parent`·
`ix_user_org` 도 컬럼과 함께 사라집니다). 이름을 들고 있는 곳은 **`org_unit.name` 한 곳뿐**이 됩니다.
지우기 직전에 **[8단계 절단 관문]** 이 *"정본(`parent_id`·`org_id`)만으로 구 컬럼의 모든 값을
`BINARY` 로 한 글자도 틀리지 않게 되살릴 수 있는가"* 를 네 값(양쪽 `NULL` 일치 2 + `BINARY` 이름
일치 2)으로 확인하고, 하나라도 0 이 아니면 **지우지 않고 멈춥니다.** 설계 근거는
[`../CALENDAR-TABLE-DESIGN.md`](../CALENDAR-TABLE-DESIGN.md) **§5.6.6, §5.6.6-a**.

**왜 하나.** 하위 조직을 가진 본부를 개명하면 `ERROR 1451` 로 막혔습니다. `ON UPDATE CASCADE` 로
선언돼 있어도 InnoDB 는 **자기참조 FK 에 cascade 를 수행하지 않습니다.** 전환 뒤에는 개명이
**1문장**으로 끝납니다:

```sql
UPDATE org_unit SET name = ? WHERE org_id = ?;
```

복제본 실측(`SW개발본부` → `SW연구본부`): `ROW_COUNT() = 1`, 자식 5개는 `parent_id` 로 매달려
있어 **따라 고칠 것이 없고**, 소속자 2명도 `org_id` 로 가리키므로 그대로이며, 옛 이름 잔존 0행.

> **⚠️ 컷오버 경고: 이 파일을 돌리면 배포된 v0.17.1 위젯이 그 자리에서 깨집니다.**
> 무엇이 어떻게 깨지는지는 바로 아래 **[컷오버 낙진]** 표가 정본입니다. **먼저 읽고 돌리세요.**

```
mysql -u root -p --default-character-set=utf8mb4 taskmgr < migrate-2026-08-24-org-id.sql
```

> **⚠️ `--force` 를 붙이지 마세요.** 이 파일의 안전장치는 전부 *'에러로 멈추는'* 방식입니다
> (순수 SQL 에는 `IF/THEN` 도 `SIGNAL` 도 없어서, 조건이 깨지면 **없는 테이블명 자리에 사람이 읽을
> 메시지를 넣어** `ERROR 1146` 을 냅니다). `--force` 는 그 멈춤을 전부 무력화합니다.
> **특히 [가드 1](조직 명부 해시)이 무력화되면 89명 전원의 소속이 한 칸씩 밀립니다.**
> 번호가 곧 소속이고, `app_user.org_id` 백필이 그 번호를 그대로 씁니다. 오류 없이 틀립니다.

#### ★ 컷오버 낙진: 배포된 v0.17.1 위젯 89대에 **무슨 일이 일어나나**

구 컬럼이 사라지는 순간, 배포본이 쏘는 조직 관련 6문 중 **다섯이 `ERROR 1054` 로 죽습니다.**
아래는 앱 계정(`taskmgr_app`)으로 복제본에 **실제로 쏘아 본 결과**입니다. 짐작이 아닙니다.

| | 배포본 SQL (v0.17.1) | 어디 | 결과 |
|---|---|---|---|
| `S1` | `SELECT edit_role, is_active FROM app_user WHERE login_id=?` | `ProjectDb.cs:102` | **exit 0, 생존** |
| `S2` | `SELECT login_id, name, title, org_unit, view_scope, edit_role, is_active FROM app_user …` | `ProjectDb.cs:232` | `ERROR 1054 Unknown column 'org_unit'` |
| `S3` | `SELECT name, title, org_unit, view_scope, edit_role, is_active FROM app_user …` | `ProjectDb.cs:278` | `ERROR 1054 Unknown column 'org_unit'` |
| `S4` | `SELECT org_unit, view_scope, is_active FROM app_user WHERE login_id=?` | `ProjectDb.cs:339` | `ERROR 1054 Unknown column 'org_unit'` |
| `S5` | `SELECT name, parent, sort_order FROM org_unit WHERE is_active=1 …` | `ProjectDb.cs:364` | `ERROR 1054 Unknown column 'parent'` |
| `S6` | `SELECT login_id, name, title, org_unit FROM app_user WHERE is_active=1 …` | `ProjectDb.cs:395` | `ERROR 1054 Unknown column 'org_unit'` |

**★ 그런데 사람마다 피해가 다릅니다. 갈리는 것은 버전이 아니라 <u>로컬 세션 파일의 유무</u>입니다.**
부팅 경로(`userSessionGet` → `MainWindow.xaml.cs:1578`)는 **로컬 세션 파일만 읽고 DB 를 보지 않으며**,
그 세션에는 **만료(TTL)가 없습니다**(`UserSession.cs`: `savedAt` 조차 저장하지 않습니다).

| | **세션이 있는 사람** (직접 로그아웃하지 않은 대다수) | **세션이 없는 사람** (새 PC, 직접 로그아웃, 세션 파일 유실) |
|---|---|---|
| 부팅 | **정상**. 세션 파일로 복원되고 DB 를 안 봅니다 | `bootUserSession`(`task-calendar-prototype.html:4152`)이 **첫 프레임부터 로그인 게이트로 앱 전체를 덮습니다**(`_gateInert`) |
| 캘린더, 할일, 근태 | **정상** | **못 씁니다**(게이트에 덮여 있음) |
| 과제 편집 | **정상**. 권한 관문이 `S1` 이고 `S1` 은 생존합니다 | **못 씁니다** |
| 깨지는 것 | **'사용자 정보' 모달**(`S3`: `LoadUserInfoJsonAsync`)**과 구성원 명부**(`S4`, `S5`, `S6`: `LoadMembersJsonAsync`) **둘뿐** | **위젯 전체** |
| 로그인 시도 | (할 일 없음) | `S2` 가 `1054` 로 죽으면 `LoadAppUserJsonAsync` 가 `null` 을 반환하고, `MainWindow.xaml.cs:1609` 가 **“DB에 연결하지 못했습니다.”** 를 띄웁니다 |

> **★★ 그 문구가 원인을 오진합니다.** 화면에는 *"DB에 연결하지 못했습니다"* 라고 뜨지만
> **DB 접속은 멀쩡합니다.** 컬럼이 없어서 나는 `1054` 입니다. 컷오버 당일 이 신고가 들어오면
> 네트워크, 서비스, 방화벽을 보지 마세요. **그 사람은 세션이 없는 사람이고, 답은 위젯을
> v0.18 로 갱신하는 것 하나뿐입니다.**

**데이터 손상 위험은 0 입니다.** 위 6문은 전부 `SELECT` 이고, 앱 계정은 `app_user`·`org_unit` 에
**`SELECT` 권한만** 가집니다(`create-app-user.sql`). 죽는 것은 조회이지 쓰기가 아닙니다.

그래서 순서가 정해집니다. **위젯 v0.18 배포를 먼저 끝내고**, 세션 없는 사람이 남지 않게 한 뒤
이 마이그레이션을 돌리는 것이 피해가 가장 작습니다. 반대 순서로 가면 그날 **새 PC, 재설치, 직접
로그아웃한 사람은 위젯을 전혀 못 씁니다.**

**선행조건**

- `org_unit` 과 `app_user` 가 **둘 다** 있어야 합니다(가드 `0-A`·`0-B` 가 확인하고 멈춥니다).
- `org_unit` 의 PK 가 **`name` 단일**이어야 합니다(가드 `0-D`). 아니면 손으로 봐야 합니다.
- **조직 명부가 `taskmgr-company-data\02-seed-org.sql` 과 같아야 합니다**(가드 `1`, SHA-256 대조).
  조직이 하나라도 다르면(신설, 폐지, 소속 변경, `sort_order` 변경) 번호가 밀리므로 **여기서 멈춥니다.**
- `app_user.org_unit` 과 `org_unit.parent` 에 **고아가 0** 이어야 합니다(가드 `2`·`3`).
- **어느 쪽 DB 인지 먼저 판정하세요**(눈으로 짐작하지 말 것):
  ```sql
  SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA='taskmgr' AND TABLE_NAME='org_unit' AND COLUMN_NAME='org_id';
  ```
  | | 상태 | 할 일 |
  |---|---|---|
  | **신규 DB** | `org_unit` 이 아예 없다 | 이 파일이 **아닙니다.** 비공개 저장소의 `apply.cmd`(`01-schema-users.sql`)가 처음부터 `org_id` PK 로 만듭니다 |
  | **기존 DB** | `org_unit` 은 있는데 `org_id` 가 없다 | **이 파일을 적용합니다** |
  | **이미 전환됨** | 위 쿼리가 한 줄을 낸다 | 다시 돌려도 **전 단계가 no-op** 입니다(멱등). 중단된 실행의 재개도 됩니다 |

**`apply.cmd` 와의 순서: 마이그레이션이 먼저입니다**

```
1) mysql … < migrate-2026-08-24-org-id.sql     # 구조를 옮긴다
2) taskmgr-company-data\apply.cmd -SkipSchema  # 02·03 시드 + org_id 게이트
```

`02-seed-org.sql` 과 `03-seed-users.sql` 은 **`org_id` 가 있는 표를 전제**합니다. 순서를 뒤집으면
`apply.ps1` 이 선행검사에서 *"이 DB 는 조직 대리키(org_id) 전환 전 스키마입니다"* 로 멈춥니다.
**`-SkipSchema` 없이 돌리면 `app_user`·`org_unit` 을 `DROP` 후 재생성**하므로, 운영 중인 DB 에서는
반드시 `-SkipSchema` 입니다.

> **`init-calendar` 는 이 마이그레이션을 요구하지 않습니다.** `cal_*` 가 가리키는 것은
> `app_user.user_id` 이지 `org_id` 가 아닙니다. 캘린더 구축과 조직 전환은 서로 독립입니다.
> 다만 **둘 다** 해야 `apply.cmd` 게이트가 통과합니다.

**실패 시 대응**

| 화면에 뜨는 것 | 뜻 | 할 일 |
|---|---|---|
| `중단: org_unit 없음` / `중단: app_user 없음` | 대상 표가 없다 | 신규 DB 입니다. `apply.cmd`(`-SkipSchema` 없이) |
| `중단: org_unit PK 가 name 단일이 아니다` | 예상 못 한 스키마 | 손으로 볼 것. **`--force` 로 밀지 말 것** |
| `중단: org_unit 명부가 02-seed-org.sql 과 다르다` | 조직이 시드와 달라 **번호가 밀린다** | 시드와 DB 중 어느 쪽이 옳은지 먼저 정한다. 시드가 옳으면 DB 를 맞추고, DB 가 옳으면 `02-seed-org.sql` 과 마이그레이션의 해시 상수를 **함께** 갱신한다. **해시만 고치는 것은 가드를 끄는 것이지 푸는 것이 아니다** |
| `중단: … 고아` | `parent` 나 `org_unit` 이 실재하지 않는 이름을 가리킨다 | 그 행을 먼저 고친다 |
| `중단: org_id 가 일부만 배정된 상태` | 앞선 실행이 중간에 죽었다 | 손으로 볼 것 |
| `중단: 루트에서 도달 못하는 조직이 있다` | 부모 사슬에 순환이 있거나 루트가 없다 (번호를 새로 박는 **첫 실행**에서만 나오는 가드) | 트리를 먼저 고친다 |
| `중단: 사후검증 실패 - 루트에서 도달 못하는 조직(순환). E5 를 볼 것` | **이미 번호가 있는 DB 를 다시 돌렸을 때**의 같은 사고. 위 가드는 첫 실행 전용이라 이쪽이 잡는다(`(E5)` 가 끊긴 조직과 그 인원을 표로 찍는다) | `org-ops.cmd move` 로 순환을 풀고 다시 실행. 손 SQL 로 `parent_id` 를 고치면 같은 일이 반복된다 |
| `중단: 정본이 구 컬럼을 재현하지 못한다 - 지우면 롤백이 무손실이 아니다` | **[8단계 절단 관문]** 이 막았다. 정본과 구 컬럼이 어긋나 있어(한쪽만 `NULL` 이거나 이름이 `BINARY` 로 다르다) **지우면 롤백이 원본을 못 되살린다** | 지우기 전이라 아직 안전하다. 어긋난 행을 먼저 맞추고 다시 돌린다. **관문을 낮추지 말 것.** 대소문자 표류(`SW 1팀` vs `sw 1팀`)가 여기서 잡힌다 |
| `중단: 절단 미완 - 구 컬럼(parent/org_unit)이 남아 있다. E2 를 볼 것` | 9·10단계가 안 돌았다 = 이 DB 는 아직 절단 전이다 | 다시 돌린다(멱등). 계속 남으면 손으로 볼 것 |
| `MISMATCH` (확인 쿼리 `(E3)`) | 번호가 시드와 다르게 박혔다 | **멈추고 사람에게 보고.** 이미 `DDL` 이 지나갔으므로 롤백(아래)이나 덤프 복원 |

> **DDL 은 롤백이 없습니다.** 그래서 이 파일은 **`ALTER` 앞에서** 막고(가드 `0-A`~`5`),
> **지우기 직전에** 한 번 더 막고(**[8단계 절단 관문]**), **끝에서도** 막습니다.
> 마지막 **[E9 차단]** 이 구조, 번호, 불변식과 *"구 컬럼이 정말 사라졌는가"* 를 한 줄로 세고,
> 하나라도 0 이 아니면 **에러로 끝냅니다**(무인 실행에서 종료코드로 드러납니다).
> 그래도 화면 출력을 **눈으로 보세요**: 시작 직후의 `(P0)` **지문 두 줄**(되돌린 뒤 '정말
> 원래대로인가' 를 증명할 유일한 값이라 **로그에 남겨 두어야 합니다.** 절단 뒤에는 구 컬럼이
> 없어 **다시 계산할 수 없습니다**)과, 끝의 `(E1)`~`(E7)`.
> `(E2)`(구 컬럼 0행)와 `(E4)`(불변식 여섯. 아래 '전환 뒤 조직을 바꿀 때' 참조)가
> 이 판의 핵심 사후조건입니다.

**되돌리기: `rollback-2026-08-24-org-id.sql`**

**되돌리기의 계약은 '걷어내기'가 아니라 '재생성'입니다.** 구 컬럼은 이미 지워졌으므로 되살릴
원본이 없습니다. 그래서 이 파일은 **정본에서 구 컬럼을 다시 만들어 냅니다**:

```
org_unit.parent   := (parent_id 가 가리키는 조직의 name)
app_user.org_unit := (org_id 가 가리키는 조직의 name)
```

그런 뒤에야 새 컬럼 셋(`org_unit.org_id`, `org_unit.parent_id`, `app_user.org_id`)을 걷어내고
PK 를 `name` 으로, `fk_org_parent`, `fk_user_org`, `ix_org_parent`, `ix_user_org` 를 복원합니다.
**덤프 전체를 되붓는 것과 다릅니다.** 조직 관련 컬럼만 되돌리므로 그 사이 들어온
과제, 일정, 근태는 그대로 남습니다.

> **실행 절차는 그 파일 머리의 `[적용]` 블록이 단일 소스입니다.** 여기 복사해 두지 않습니다
> (복사본은 반드시 원본보다 뒤처집니다). 요지는 **① 먼저 `mysqldump`, ② 마이그레이션 로그의
> `(P0)` 지문을 손에 쥐고, ③ 실행, ④ 지문 대조** 입니다. 여기도 **`--force` 금지**입니다.

- **정본이 성립할 때만 진행합니다.** 재생성의 입력이 정본이므로, 정본이 틀려 있으면 그 틀림이
  **그대로 이름에 새겨집니다.** 그것도 조용히. 그래서 **[R-가드 2]** 가 재생성 *전에* 고아, 루트
  개수, 도달불가를 보고, **[R5 관문]** 이 재생성 *직후* 에 절단 관문과 같은 네 값을 다시 세어
  **완결됐을 때만 정본을 지웁니다.**
- **무손실의 근거는 [8단계 절단 관문]입니다.** 마이그레이션은 *"정본만으로 구 컬럼을 `BINARY`
  로 완전히 재현할 수 있다"* 가 참일 때만 지웠습니다. 즉 지워진 값은 **정의상 정본에서 유도
  가능한 값뿐**입니다. **실측**(복제본, MySQL 8.4.9): 마이그레이션하고 롤백한 뒤 `(P0)` 지문
  `org_unit_fp`·`app_user_fp` 가 **마이그레이션 전과 완전히 동일**했습니다.
- **절단판 DB 도, 구 컬럼이 아직 남아 있는 DB 도 이 한 파일로 되돌립니다.** 구 컬럼이 남아 있는
  DB 에서는 재생성 단계(`R1`~`R4`)가 no-op 이 되고 나머지가 그대로 돕니다.
  **실측**: 구 컬럼이 남아 있는 상태를 만들어 이 파일을 돌렸더니 컬럼 순서, PK, FK 2개, 인덱스
  2개가 모두 복원되고, 감사 컬럼을 뺀 데이터가 원본과 해시까지 일치했습니다.
- 되돌리면 **본부 개명이 다시 `ERROR 1451` 로 막힙니다.** 그것이 원래 상태입니다.
  그 스키마에서 개명이 필요하면 [`../CALENDAR-TABLE-DESIGN.md`](../CALENDAR-TABLE-DESIGN.md)
  **§5.6.6 의 4문장** 절차를 쓰세요(그 절차는 `fk_org_parent` 가 **있는** 스키마 전용입니다).
- 되돌린 DB 에서는 `apply.cmd -SkipSchema` 가 **더 이상 통하지 않습니다**(`02`·`03` 이 `org_id` 를 전제).

> ### ⚠ **롤백은 `DB` 만 무손실입니다. 이미 v0.18 로 올라간 PC 를 되돌릴 채널이 없습니다**
> 업데이트 판정(`widget/Update.cs` 의 `IsNewer`)은 **전진 전용**입니다. 매니페스트 버전이
> 자기 버전보다 **높을 때만** 갱신하고, 같거나 낮으면 *"이미 최신 버전입니다"* 로 끝냅니다.
> 즉 `latest.json` 을 v0.17.1 로 되돌려 놔도 **v0.18 이 깔린 PC 는 내려오지 않습니다.**
>
> 그런데 **신버전 위젯 + 구 스키마 조합은 동작하지 않습니다**(신버전은 `org_id`·`parent_id` 를
> 읽는데 롤백된 DB 에는 그 컬럼이 없습니다). 그러므로:
>
> **롤백은 '신버전 배포 전' 또는 '배포 직후의 짧은 창' 안에서만 실질적인 선택지입니다.**
> 갱신이 사내에 퍼진 뒤에는 되돌리는 쪽이 아니라 **앞으로 고치는 쪽**이 유일한 길입니다.
> (되돌려야만 한다면 위젯을 **수동 재설치**로 내리는 것 말고는 방법이 없습니다.
> 89대를 손으로 도는 일입니다.)

**전환 뒤 조직을 바꿀 때: 도구가 둘입니다**

**보통은 `org-ops.cmd`** 를 쓰세요(실행체는 `org-ops.ps1`). `mysql` 만 있는 환경이면 `org-ops.sql`.

```
:: 권장 — 비밀번호는 명령줄이 아니라 환경변수로 (같은 사용자의 다른 프로세스가 명령줄을 읽습니다)
set TC_OPS_DB_ADMIN_PW=<db admin password>
org-ops.cmd show
org-ops.cmd rename -Id 2 -Name "SW연구본부" -WhatIf
org-ops.cmd rename -Id 2 -Name "SW연구본부"
org-ops.cmd add    -Name "SW 5팀" -ParentId 2 [-SortOrder 26]
org-ops.cmd move   -Id 10 -ParentId 3
org-ops.cmd assign -LoginId hjlee -OrgId 7
org-ops.cmd repair -WhatIf
org-ops.cmd repair -DeactivateOrphanedChildren -WhatIf   :: 숨긴 조직 밑 정리(미리보기)
org-ops.cmd repair -DeactivateOrphanedChildren           :: 그 아래 전부와 함께 숨긴다
```

```
# 대체 — mysql 만 있는 환경. 파일 맨 위 [입력] 블록만 고치고 통째로 실행
#   (@op = show | rename | new | move | assign)
mysql -u root -p --default-character-set=utf8mb4 taskcalendar < org-ops.sql   # 옛 DB 면 taskmgr
```

**★ 신설만 명령 이름이 갈립니다.** 나머지는 이름이 같습니다. 옮겨 적을 때 주의하세요.

| 무엇 | `org-ops.cmd` (권장) | `org-ops.sql` `@op` |
|---|---|---|
| 조직 개명 | `rename -Id -Name` | `rename` |
| **조직 신설** | **`add` -Name -ParentId [-SortOrder]** | **`new`** |
| 팀 이동(개편) | `move -Id -ParentId` | `move` |
| 인사이동 | `assign -LoginId -OrgId` | `assign` |
| 명부 확인 | `show` | `show` |
| 이름 표기 정규화(예외 조치) | `repair` | **없음** (`.cmd` 전용) |
| 숨긴 조직 밑 정리(예외 조치) | `repair -DeactivateOrphanedChildren` | **없음** (`.cmd` 전용) |

> **★ `repair` 의 임무가 바뀌었습니다.** 미러가 있던 판에서 `repair` 는 *'미러를 정본에서 다시
> 세우는 것'* 이었습니다. 미러가 사라졌으므로 그 임무는 **통째로 없어졌고**, 지금 `repair` 가
> 하는 일은 **이름 앞뒤 공백 제거(표기 정규화)** 와 `-DeactivateOrphanedChildren` 뿐입니다.
> (실행하면 화면에 `이름 앞뒤 공백을 떼어 낸 조직 — 0 개` 처럼 찍힙니다.)

**`org-ops.cmd` 만 갖는 것**

- **사전 불변식 점검**: **불변식은 여섯입니다**(전부 '작을수록 좋다', 목표 0):
  `루트 수`(기대 1), `도달불가(순환 포함)`, `이름 표기 위반`, `고아(부모·소속)`,
  `비활성 부모의 활성 자식`, `숨긴 조직의 재직 인원`.
  **미러가 없으므로 '두 값이 같은가' 를 보는 검사는 하나도 없습니다.**
  앞의 **넷이 경성(hard)** 이고, 실행 *전부터* 그중 하나라도 깨져 있으면 `rename`, `add`, `assign`
  은 **아무것도 시도하지 않고** 종료코드 `6` 으로 멈춥니다. 그때는 `org-ops.cmd repair -WhatIf`
  로 무엇이 깨졌는지 보고 `repair`(표기) 또는 `move`(트리)로 세운 뒤 다시 합니다.
  `show`, `move`, `repair` 셋은 코드 `6` 으로 막지 않습니다(그것들이 유일한 탈출구입니다).
  뒤의 **둘은 연성(soft)** 이라 차단하지 않고 **경고만** 합니다. 막아 두면 안내가 지목하는
  `repair` 조차 실패하는 막다른 골목이 되기 때문입니다(F13).
  해소는 `move`(자식을 살아 있는 부모로) 또는 `repair -DeactivateOrphanedChildren`(함께 숨김).
  > **★ `숨긴 조직의 재직 인원`을 왜 따로 세나.** `비활성 부모의 활성 자식`은 **조직만** 셉니다.
  > 그래서 자식 조직까지 전부 숨겨 그 값을 0 으로 만들면, **그 안의 사람은 살아 있는데
  > 조직도에서 통째로 사라집니다**(조직도를 `is_active=1` 로 긁기 때문). 조직 수만 보는 눈은
  > 사람이 사라지는 것을 못 봅니다.
  > 마이그레이션의 `(E4)` 와 `[E9 차단]` 도 **같은 여섯**을 셉니다. 목록이 한 벌이라
  > 전환 직후와 운영 중의 판정이 갈리지 않습니다.
- **`-WhatIf`**: 무엇이 바뀔지 보여 주고 **반드시 `ROLLBACK`** 합니다. **`-Force`** 는 확인 프롬프트만 건너뜁니다.
- **종료코드 계약**: `0` 성공, `1` 실패(롤백됨, DB 안 바뀜), `2` 시도조차 안 함(인자, 자격증명, 대상 없음,
  또는 사용자가 확인에서 No), `3` 접속·권한, `4` `mysql.exe` 없음, `5` **절단 전 스키마**:
  `org_id`/`parent_id` 가 없거나, **이름 미러 컬럼(`org_unit.parent`·`app_user.org_unit`)이 남아
  있음**(마이그레이션이 덜 끝난 상태. 이 도구는 그 컬럼을 쓰지 않으므로 두면 낡은 이름이 남습니다),
  `6` 실행 전부터 **경성** 불변식 위반, `9` **롤백 검증 실패. 실패했는데 데이터가 바뀌었다. 즉시 사람에게 보고.**
  (`7`·`8` 은 미사용. 은퇴·예약값을 새 뜻으로 재사용하지 마세요.)
- 실패하면 **어느 불변식이 몇이었고 기대가 얼마인지**를 이름으로 찍습니다
  (예: `· 비활성 부모의 활성 자식 = 5 (기대 0)`).

**절단 뒤에는 네 연산이 전부 1문장입니다.** 조직을 가리키는 길이 번호 하나뿐이기 때문입니다.
`org-ops` 가 여전히 필요한 이유는 **문장이 어려워서가 아니라 검산 때문**입니다(아래 참조).

| 무엇 | 도는 문장 |
|---|---|
| 개명 | `UPDATE org_unit SET name=? WHERE org_id=?` |
| 조직 신설 | `INSERT INTO org_unit (name, parent_id, sort_order, is_active) SELECT …` (번호는 DB 가 발급) |
| 팀 이동 | `UPDATE org_unit SET parent_id=? WHERE org_id=?` |
| 인사이동 | `UPDATE app_user SET org_id=? WHERE login_id=?` |

> ### ⚠ **DB 를 바꿨으면 시드(`02`/`03`)도 같은 내용으로 고친 뒤 `apply` 를 돌리세요**
> 비공개 저장소 `taskmgr-company-data` 의 `02-seed-org.sql`(조직)·`03-seed-users.sql`(사람)은
> **'현재 조직도'의 정본** 노릇을 합니다. `org-ops` 로 DB 만 바꾸고 시드를 그대로 두면
> 다음 `apply.cmd -SkipSchema` 가 **`02`/`03` 의 가드에 걸려 멈춥니다**(`중단: …` 으로 시작하는 `ERROR 1146`).
>
> **그 자리에서 화면이 권하는 `-AllowSeedOverwrite` 를 쓰면 안 됩니다.** 그 스위치는
> *'시드가 옳다'* 고 사람이 판단했을 때 쓰는 것이라, 방금 한 **DB 쪽 변경이 시드값으로 조용히
> 덮이고 `apply` 는 성공(`0`)으로 끝납니다.** 복제본 실측: `move` 로 옮긴 팀과 `assign` 으로
> 옮긴 사람이 각각 옛 값으로 복귀했습니다.
>
> 순서는 언제나 **① `org-ops.cmd`, ② `02`/`03` 수정, ③ `apply.cmd -SkipSchema`** 입니다.
> 무엇을 고쳐야 하는지는 `taskmgr-company-data/README.md` 의 **'인사이동·조직 개편'** 표.
>
> **덧붙여, `-AllowSeedOverwrite` 로도 못 뚫는 가드가 있습니다.** 그 스위치는 구조·명단 드리프트
> (`@org_drift`·`@user_drift`)만 건너뜁니다. **이름 충돌 가드(`@org_clash`)는 못 건너뜁니다.**
> 그래서 **개명 뒤에는 `-AllowSeedOverwrite` 를 붙여도 `apply` 가 계속 멈춥니다.**
> 시드를 고치는 것 말고는 길이 없습니다.
>
> **팀 신설만 예외적으로 `apply` 가 멈추지 않습니다**(시드에 없는 조직은 비교 대상이 아니라
> 그대로 둡니다). 하지만 시드를 안 고치면 **그 시드로 새로 구축한 DB 에는 그 팀이 없습니다.**

- **손으로 `UPDATE` 하지 마세요.** 문장 자체는 한 줄이지만 **트리를 깨는 것은 여전히 조용합니다.**
  `move` 를 자기 자손 밑으로 하면 트리가 고리가 되고(FK 는 순환을 못 봅니다), 살아 있는 조직을
  숨긴 부모 밑에 두면 배포본·신버전 모두 `is_active=1` 로 조직을 읽으므로 **그 하위 트리가 통째로
  끊겨** 본부장의 열람 범위에서 산하 직원이 빠집니다. 오류도 경고도 없습니다.
- 이 도구는 연산 뒤 **`COMMIT` 앞**에서 **불변식 여섯을 다시 세고**, **하나라도 실행 전보다
  커졌으면 커밋하지 않습니다**(에러가 나면 세션이 끝나고 InnoDB 가 되돌림). 판정이 '전부 0' 이 아니라
  **'악화시키지 않았는가'** 인 이유는, 이미 깨진 DB 에서 그것을 고치는 명령까지 롤백시키면
  탈출구가 손 SQL 밖에 안 남기 때문입니다. 그래서 여기도 **`--force` 금지**입니다.
- 조직 **폐지**는 행 삭제가 아니라 `UPDATE org_unit SET is_active = 0` 입니다(과거 소속 표기 보존).
- 불변식을 실제로 검사하는 것: `apply.ps1` 의 **`org_id` 게이트**(`apply.cmd` 실행 때 자동),
  `org-ops.cmd`/`org-ops.sql` 의 커밋 전 검산, 그리고 **수동 실행**하는 `../../tests/loop-org-compat.mjs`
  (`I0`~`I9`). **마지막 것은 `node tests/run-tests.mjs` 기본 스위트에 들어 있지 않습니다.**
  러너가 `*.test.mjs` 만 수집하는데 그 파일은 `.mjs` 입니다(CI 에 MySQL 이 없어 의도한 것).
  **기본 테스트 통과 = 이 검사가 돌았다, 가 아닙니다.**

## 백업: `backup-taskmgr` (주간 mysqldump)

### 무엇을, 왜

`taskmgr` DB 전체를 **주 1회 mysqldump 로 통째로 받아** 다른 볼륨에 세대별로 쌓습니다.
설계 [`../CALENDAR-TABLE-DESIGN.md`](../CALENDAR-TABLE-DESIGN.md) **§9** 가 백업 정책을
*"binlog 30일 + 주간 mysqldump"* 로 확정해 두었는데, **binlog 쪽은 서버 기본값이라 저절로 참이었고
mysqldump 쪽은 문장만 있고 실행체가 한 줄도 없었습니다.** 이 스크립트가 그 실행체입니다.

**binlog 는 백업이 아닙니다.** binlog 는 *변경 이력* 이고, 이력을 재생하려면 **출발점이 될 스냅샷**이
있어야 합니다. 덤프가 없으면 30일치 binlog 를 다 갖고 있어도 **재생을 시작할 지점이 없습니다.**
반대로 덤프만 있으면 마지막 회차 이후(최대 7일)를 잃습니다. **둘은 대체재가 아니라 짝**입니다.

| | 무엇 | 없으면 |
|---|---|---|
| **주간 mysqldump** | 기준 스냅샷 | binlog 가 있어도 복구 불가(출발점 없음) |
| **binlog 30일** | 스냅샷 이후 변경 이력 | 마지막 덤프 이후 유실 |

이 백업은 캘린더 트랙 전용이 아닙니다. `taskmgr` DB 전체(과제 표 + `cal_*`)가 대상입니다.
그리고 **앱 계정에 `DELETE` 를 준 위험을 실제로 상쇄하는 것이 이것**입니다(위 '왜 DELETE 를 주는가').

### 어디에 두는가: **원본과 다른 볼륨**

같은 디스크에 두면 백업이 아닙니다. 디스크가 죽는 시나리오가 백업이 존재하는 첫째 이유인데,
같은 볼륨에 있으면 그 시나리오에서 **원본과 함께 사라집니다.**
(폐기한 감사 휴지통이 무력했던 이유와 **정확히 같은 논리**입니다. 그건 같은 DB 안에 있었습니다.)
그러니 다른 물리 디스크 또는 네트워크 공유를 출력 경로로 지정하세요. 기본 경로를 그대로 쓰지 말고
**서버의 실제 볼륨 구성을 보고 정할 것.**

### 설치: 계정 → `.cnf` → `-Install` (관리자 권한 필요)

```
mysql -u root -p < create-backup-user.sql      # 1) 백업 전용 계정 (비번을 먼저 교체할 것)
backup-taskmgr.cmd                             # 2) .cnf 가 없으면 만드는 법을 찍고 멈춘다(코드 2)
                                               #    → 안내대로 .cnf 를 만들고 다시 실행 = 1회 수동 백업
backup-taskmgr.cmd -Install                    # 3) 주 1회 작업 스케줄러 등록 (관리자 콘솔)
backup-taskmgr.cmd -Status                     # 등록 상태만 조회
```

- **`-Install` / `-Uninstall` 은 관리자 권한이 필요합니다**(작업 스케줄러 등록). 아니면 코드 `5` 로 멈춥니다.
- **비밀번호를 인자로 받지 않습니다.** Windows 는 같은 사용자면 다른 프로세스의 명령줄을 그대로
  읽을 수 있어서(실측), 무인 실행에 필요한 자격은 **명령줄이 아니라 권한을 좁힌 `.cnf` 파일**에 둡니다.
  기본 위치는 `%ProgramData%\taskmgr\` 이고, 파일이 없으면 스크립트가 만드는 법과 `icacls` 예시를 찍습니다.
- **백업 계정은 `SELECT` 만으로 부족합니다. `TRIGGER` 도 필요합니다**(다음 절이 그 이유).
  `create-backup-user.sql` 이 그 근거와 함께 *안 주는 권한*(`PROCESS`, `LOCK TABLES`, `RELOAD`)까지 적어 둡니다.
- 등록 대상은 **DB 서버가 도는 PC** 입니다(계정 호스트도 `localhost`). 원격에서 받으면 전량이 네트워크로 오갑니다.
- 기본값은 `-BackupDir D:\taskmgr-backup`, `-Keep 8`(주 1회라 약 2개월). **기본 경로를 그대로 쓰지 말고
  서버의 실제 볼륨 구성을 보고 정하세요**(위 '어디에 두는가').

### ★ 왜 이 스크립트가 필요한가: 종료코드 `0` 은 성공의 증거가 아닙니다

`mysqldump` 는 **권한이 없어 못 읽은 객체 종류를 조용히 건너뛰고 성공으로 끝냅니다.** 실측:

| 백업 계정 권한 | 종료코드 | 산출물 |
|---|---|---|
| `SELECT` 만 | **0** (오류, 경고 0) | **48K**: 표 20, **트리거 15 → 0(통째로 빠짐)** |
| `SELECT` + `TRIGGER` | 0 | **72K**: 트리거 포함 |

**24K 가 사라졌는데 종료코드는 0 이었습니다.** 그래서 이 스크립트는 덤프 뒤에 **파일 내용 ↔ DB
(`information_schema`)** 를 대조합니다. 표 이름, 트리거 이름, 루틴 수, 마감 표시, 크기를 봅니다. 어긋나면
`.partial` 로 남기고 실패(코드 `1`)로 끝냅니다.

> **★★ 대조만으로도 부족합니다.** `information_schema.TRIGGERS` **자체가 `TRIGGER` 권한으로 걸러집니다.**
> `SELECT` 만 가진 계정 눈에는 DB 쪽 트리거 수도 `0` 으로 보여서 **'덤프 0 == DB 0' 으로 대조까지
> 통과**합니다(실측: 같은 DB 를 SELECT 만으로 세면 0, TRIGGER 까지 있으면 3).
> 그래서 덤프 **전에** `SHOW GRANTS` 로 `TRIGGER` 보유를 확인합니다(없으면 코드 `3`).
> **두 겹 중 실제로 걸러 내는 겹은 이쪽**입니다. 검증 대상이 검증 기준을 오염시키면 대조는 무력합니다.

- **백업 계정 권한을 "최소화" 한다고 깎지 마세요.** *덜 준 만큼 조용히 덜 담깁니다.*
  이 실측은 트리거로 드러났지만 뷰(`SHOW VIEW`)와 저장 프로시저(`SHOW_ROUTINE`)도 같습니다.
  `create-backup-user.sql` 이 그 줄을 주석으로 준비해 두었습니다(생기면 함께 부여).
- 캘린더 트랙에서 감사 트리거를 폐기했다고 이 문제가 사라지지 않습니다. 백업 대상은 **`taskmgr` DB 전체**이고,
  앞으로 생길 객체에 그대로 해당됩니다.
- 무인 실행이라 **화면을 아무도 안 봅니다.** 스크립트가 회차마다 로그 한 줄을 남기니,
  최소한 **첫 회차와 서버 이관 직후에는 사람이** 로그와 파일 크기를 확인하세요.

### 종료코드: 백업

`backup-taskmgr.cmd` 는 `.ps1` 의 종료코드를 그대로 돌려줍니다. **`0` 만 성공으로 세세요.**

| 코드 | 뜻 | 그다음에 할 일 |
|---|---|---|
| `0` | 성공. 파일이 생겼고 **검증을 전부 통과**. (`-Install`/`-Uninstall`/`-Status` 성공도 0) | 없음 |
| `1` | **덤프 실패 또는 검증 불일치.** 뜬 파일은 `.partial` 로 남는다 | 그 파일은 **복구에 쓸 수 없다.** 로그의 불일치 항목을 보고 고친 뒤 재실행 |
| `2` | 설정 문제. `.cnf` 가 없거나 못 읽음 / 백업 폴더 생성 불가 | 화면에 찍힌 `.cnf` 작성법·`icacls` 예시대로 |
| `3` | 접속·권한 문제. DB 에 못 붙거나 백업 계정에 `SELECT`·`TRIGGER` 가 없음 | `create-backup-user.sql` |
| `4` | 도구 없음. `mysqldump.exe` / `mysql.exe` 를 못 찾음 | `-BaseDir` 로 위치 지정 |
| `5` | 관리자 권한 필요(`-Install` / `-Uninstall`) | 관리자 콘솔에서 재실행 |

`1` 과 `2`, `3`, `4` 를 나눈 이유는 사람이 할 일이 달라서입니다. `1` 은 *"백업이 반쪽이다(복구에 못 쓴다)"*,
`2`, `3`, `4` 는 *"백업을 시작조차 못했다"* 입니다. **전자가 더 위험합니다**(파일이 있으니 있는 줄 안다).

## 복구: `restore-taskmgr` (덤프 되살리기 + 대조)

`backup-taskmgr` 의 짝입니다. 저쪽이 *"제대로 떴는가"* 를 보고, 이쪽이 *"되살아나는가"* 를 봅니다.
**검증되지 않은 백업은 백업이 아닙니다.** 2026-09-07 이전까지 복구는 문서(`D:\taskmgr-backup\복구방법.txt`)
로만 있었고 실행체가 없었습니다.

```
restore-taskmgr.cmd -WhatIf                                        # 계획만 보기(쓰기 없음)
restore-taskmgr.cmd -TargetDb taskmgr_restore_drill -Grants        # 최신 덤프를 별도 DB 로 복구
restore-taskmgr.cmd -DumpPath "D:\taskmgr-backup\taskmgr-<날짜>.sql" -Grants
restore-taskmgr.cmd -TargetDb taskmgr_restore_drill -DropTarget    # 리허설 뒷정리(권한 회수까지)
```

- 기본 대상은 **라이브가 아닌 별도 DB**(`taskmgr_restore`)입니다. `-TargetDb` 가 `-LiveDb` 와 같으면
  스크립트가 **거부**합니다(코드 `6`). `-OverwriteLive` 스위치만으로도 열리지 않습니다.
  **사람이 DB 이름을 직접 타이핑해야** 하고, 비대화형(stdin 리다이렉트)이면 무조건 거부합니다.
  가드가 스크립트 **안**에 있는 이유: 호출자의 조심성에 기대면 언젠가 반드시 집니다.
- **비밀번호를 명령줄로 받지 않습니다**(`-p<비번>` 금지. 같은 PC 의 다른 프로세스가 명령줄을 읽습니다).
  자격은 아래 **자격 획득 순서**대로 구합니다.

#### 자격 획득 순서: 무인 실행이 조용히 멎지 않게

| 순서 | 통로 | stdin 을 읽나 |
|---|---|---|
| ① | `-CnfPath <파일>` | 안 읽음 |
| ② | 기본 `.cnf` = **`%ProgramData%\taskmgr\restore-taskmgr.cnf`** (`backup-taskmgr.cnf` 와 같은 자리 관례) | 안 읽음 |
| ③ | 환경변수 **`TASKMGR_ADMIN_PW`** (이 저장소가 시험에서 `TC_TEST_DB_ADMIN_PW` 를 쓰는 것과 같은 관례) | 안 읽음 |
| ④ | stdin 첫 줄, **상한 10초**. 그 안에 한 줄이 안 오면 코드 `2` 로 끝냅니다 | 읽음(상한 있음) |
| ⑤ | 대화형이면 물어봅니다 | - |

> ⚠️ **④ 의 상한은 취향이 아니라 결함 수리입니다.** 2026-09-07 실측: stdin 이 리다이렉트돼 있고
> **파이프가 열린 채 비어 있으면**(아무도 안 씀) `[Console]::In.ReadLine()` 이 영원히 돌아오지 않아
> `restore-taskmgr.ps1 -WhatIf` 가 5분이 지나도 끝나지 않았습니다(바깥에서 25초 상한으로 강제 종료,
> 코드 `124`). `< NUL`(즉시 EOF)에서는 멀쩡했으므로 **대화형·수동 실행에서는 절대 드러나지 않습니다.**
> 드러나는 곳은 작업 스케줄러, CI, 다른 스크립트 안, 즉 이 스크립트가 실제로 돌아야 할 자리입니다.
> 무인 실행에서 **실패는 알람이 되지만 무한 대기는 아무 신호도 내지 않습니다**(백업 계정에 `SELECT` 만
> 줬을 때 `mysqldump` 가 조용히 `exit 0` 으로 끝나던 것과 같은 침묵). 무인 호출자는 ①②③ 중 하나를
> 쓰세요. `tests/restore-guards.test.mjs` 가 상한과 이 순서를 계약으로 잠급니다.

```
:: 무인 실행 — 셋 중 하나
restore-taskmgr.cmd -WhatIf -CnfPath "%ProgramData%\taskmgr\restore-taskmgr.cnf"
set TASKMGR_ADMIN_PW=<관리계정 비밀번호> && restore-taskmgr.cmd -WhatIf
echo <관리계정 비밀번호>| restore-taskmgr.cmd -WhatIf
```

측정(개발 PC, `-WhatIf`):

| 상황 | 종료코드 | 걸린 시간 |
|---|---|---|
| `echo <비번> \|` (파이프에 값이 있음) | `0` | 1.7초 |
| 파이프가 **열린 채 비어 있음** | `2` | 11.1초 (상한 10초 + 기동) |
| `< NUL` (즉시 EOF) | `2` | 1.1초 |
| `-CnfPath` / 기본 `.cnf` / `TASKMGR_ADMIN_PW` (빈 파이프를 물려도) | `0` | 1.6초 |

- 대상 DB 가 이미 있으면 **먼저 통째로 떠서** `<BackupDir>\pre-restore-<db>-<타임스탬프>.sql` 로 남기고,
  **그 덤프가 성공한 뒤에야** 대상을 비우고 다시 만듭니다. 못 남기면 진행하지 않습니다(코드 `2`).
- `-Grants` 는 `create-app-user.sql` + `grants-calendar.sql` 을 **둘 다** 적용합니다(아래 ★ 절).

### ★ 왜 `-Grants` 가 있어야 하는가: 덤프에는 계정도 권한도 없습니다

`복구방법.txt` 4번이 말하는 그 단계입니다. 백업은 `taskmgr` **한 DB** 만 뜨고 계정 정보는 `mysql`
스키마에 있어 대상이 아닙니다. 그래서 이 단계를 건너뛰면 **표도 데이터도 전부 제자리에 있는데**
위젯이 첫 조회에서 죽습니다. 2026-09-07 리허설에서 세 가지 오류 번호를 전부 실측했습니다:

| 상황 | 앱 계정이 받는 오류 | 왜 |
|---|---|---|
| 두 SQL 을 **둘 다** 건너뜀 (그 DB 권한이 0줄) | **`ERROR 1044`** Access denied ... to database | DB 단위에서 막힘 |
| `create-app-user.sql` 만 적용, `grants-calendar.sql` 건너뜀 | **`ERROR 1142`** SELECT command denied ... for table `cal_schema_meta` | DB 에는 붙지만 `cal_*` 표 권한이 없음 |
| 계정이 없거나 비번이 배포본과 다름 | **`ERROR 1045`** | `create-app-user.sql` 의 `CHANGE_ME_ON_DEPLOY` 를 안 바꿨을 때 |

`복구방법.txt` 는 `1142` 만 적었지만 **실제로는 1044 가 더 흔합니다**(복구 DB 이름이 배포 GRANT 와 다를 때).
어느 쪽이든 원인은 하나입니다. 덤프에 계정과 권한이 없다.

> ⚠️ **두 SQL 은 DB 이름을 글자로 박아 두었습니다**(`ON taskmgr.<표>`. `grants-calendar.sql` 머리말이
> 그렇게 못박고, 배포 스크립트가 한 줄로 치환하도록 계정 표기까지 통일해 두었습니다).
> 그래서 대상이 `taskmgr` 가 아니면 원본을 그대로 돌릴 수 없습니다. 돌리면 **리허설이 라이브 계정
> 권한을 건드립니다.** 스크립트는 `init-calendar.ps1` 과 같은 결론을 따릅니다: 임시 사본에서 스키마
> 이름만 바꿔 실행하고(원본 불변) 되돌리는 `REVOKE` 문을 찍습니다.
> **`DROP DATABASE` 는 표 단위 권한(`mysql.tables_priv`)을 지우지 않습니다.** 남겨 두면 나중에 같은
> 이름의 DB 가 생겼을 때 되살아납니다. `-DropTarget` 이 그 회수까지 하고 0행을 확인합니다.

### 종료코드: 복구

`restore-taskmgr.cmd` 는 `.ps1` 의 종료코드를 그대로 돌려줍니다. **`0` 만 성공으로 세세요.**

| 코드 | 뜻 | 그다음에 할 일 |
|---|---|---|
| `0` | 성공. 복구했고 **검증을 전부 통과** (`-WhatIf`/`-DropTarget` 성공도 0) | 없음 |
| `1` | 복구 실행 실패 또는 **검증 불일치**. 대상 DB 는 원인 확인용으로 남는다 | 화면의 불일치 표를 읽고 원인을 고친 뒤 재실행 |
| `2` | 설정 문제. 덤프가 없거나 못 읽음 / **복구 전 안전 덤프 실패** / `.cnf` 문제 | 되돌릴 수단 없이는 덮어쓰지 않는다. 안전 덤프부터 되게 할 것 |
| `3` | 접속·권한 문제. DB 에 못 붙거나 관리 계정에 `CREATE`·`GRANT` 가 없음 | 관리 계정 확인. `1146` 이면 아래 ★ 참조 |
| `4` | 도구 없음. `mysql.exe` / `mysqldump.exe` 를 못 찾음 | `-BaseDir` 로 위치 지정 |
| `5` | (결번) 관리자 권한 필요. `backup-taskmgr` 와 뜻만 맞춰 비워 둠 | - |
| `6` | **거부**. 라이브 덮어쓰기 가드에 걸림. 아무것도 바꾸지 않음 | 별도 DB 로 복구한 뒤 필요한 행만 옮기세요 |
| `7` | **검증 못 함**. 라이브 DB 에 못 붙어 대조 기준이 없음. **통과가 아닙니다** | 라이브가 죽은 진짜 재해 상황이면 이 코드가 정상입니다. 0 으로 읽지 마세요 |

`6` 과 `7` 은 이 스크립트에만 있습니다. 기존 값의 뜻을 바꾸지 않고 새 값을 준 이유는
`init-calendar.ps1` 이 `3`·`5` 를 결번으로 남긴 것과 같습니다. **종료코드는 호출자와의 계약**입니다.
`7` 이 `0` 이 아닌 이유는 이 저장소의 원칙 그대로입니다: **판정 불가 ≠ 통과**
(`tests/harness.mjs` 가 skip 을 `exit 2` 로 따로 세는 것과 같은 뜻).

### ★ 옛 덤프를 복구할 때 걸리는 두 가지 (2026-09-07 실측)

1. **`ERROR 3734`: 비우지 않고 부으면 죽습니다.**
   `Failed to add the foreign key constraint. Missing column 'org_id' for constraint 'fk_user_org_id' in the referenced table 'org_unit'`
   덤프는 표마다 `DROP`→`CREATE` 를 하지만 **표 순서대로** 합니다. 대상에 다른 세대의 스키마가 남아 있으면
   아직 안 지워진 옛 표를 참조하는 FK 에서 죽습니다. 덤프 머리의 `FOREIGN_KEY_CHECKS=0` 은
   *'없는 표 참조'* 만 봐주고 *'있는 표에 컬럼이 없다'* 는 못 봐줍니다.
   그래서 스크립트는 안전 덤프 성공 후 대상을 **통째로 다시 만듭니다**(`-KeepExisting` 으로 끌 수 있습니다).
2. **`ERROR 1146`: 옛 덤프 + 지금 `grants-calendar.sql` 은 맞지 않습니다.**
   `Table 'taskmgr_restore_drill.cal_report_daily' doesn't exist` 가 납니다. GRANT 목록은 **지금** 스키마를 전제로 하고,
   없는 표에 GRANT 하면 그 줄에서 배치가 멈춥니다(그 파일이 일부러 그렇게 만들어져 있습니다).
   그러니 복구본에 `migrate-*.sql` 을 순서대로 적용해 스키마를 현재로 올린 뒤 다시 `-Grants`.

### 부분 복구, 시점 복구

```
# 1) 기준 스냅샷 되돌리기 — 반드시 별도 DB 로 (restore-taskmgr 가 이것을 대신합니다)
restore-taskmgr.cmd -TargetDb taskmgr_restore -DumpPath "D:\taskmgr-backup\taskmgr-<날짜>.sql" -Grants
# 2) 그 이후 변경 재생 (binlog. 덤프 시점 이후 구간만)
mysqlbinlog --start-datetime="<덤프 시각>" <binlog 파일들> | mysql -u root -p
```

- **순서를 바꾸지 마세요.** 2 를 먼저 하면 적용할 대상이 없습니다.
- 일부만 되살리려면 **운영 DB 에 직접 붓지 말고** 임시 DB 로 복원한 뒤 필요한 행만 옮기세요.
  덤프 전체를 그대로 부으면 덤프 이후의 정상 변경까지 되돌아갑니다.
- **`cal_migration_log` 를 함께 되돌린다는 점에 주의**하세요. 그 표는 이관 재실행 방지 마커라,
  복원 시점이 이관 이전이면 이관 도구가 다시 돌 수 있는 상태가 됩니다(설계 §8).

### 회귀 계약: `tests/restore-guards.test.mjs`, `tests/backup-guards.test.mjs`

백업·복구는 1년에 한 번 쓸까 말까 한 경로(백업은 아예 무인)라 **조용히 썩습니다.** 그래서 계약을
소스 텍스트로 잠갔고, 계약마다 **변이 시험**(가드를 지우면 정말 우는가)을 붙였습니다.
DB 도 jsdom 도 필요 없고 `mysqldump` 를 돌리지도 않습니다.

| 파일 | 잠근 계약 |
|---|---|
| `restore-guards.test.mjs` (40건) | ① 라이브 덮어쓰기 거부 가드(+타이핑 확인), ② `-p<비번>` 자리 없음, ③ 검증이 **개수가 아니라 이름 집합**, ④ `-Grants` 가 두 SQL 을 다 씀, ⑤ `.ps1`↔`.cmd` 종료코드 표 일치, ⑥ *"검증 못 함"* 분기 존재, ⑦ `.cmd` 순수 ASCII, **⑧ stdin 읽기에 상한이 있다**, **⑨ 자격 획득 순서에서 `.cnf`·환경변수가 stdin 보다 앞선다**, ⑩ 환경변수 이름이 스크립트, 머리말, README 셋에 같은 글자 |
| `backup-guards.test.mjs` (30건) | ① `-p<비번>`/`--password=` 자리 없음, ② `.ps1`↔`.cmd` 종료코드 표 일치, ③ 표의 숫자 = **실제로 내는** `exit`/`Die` 값, ④ `.cmd` 순수 ASCII, ⑤ `mysqldump` 인자 넷(`--no-tablespaces`, `--single-transaction`, `--routines`, `--triggers`) 생존, ⑥ 덤프 검증이 **이름 집합** 대조, ⑦ 덤프 **전에** `SHOW GRANTS` 로 `TRIGGER` 보유 선검사 |

공용 기계(PowerShell 주석 마스커, 종료코드 표 파서, 변이 주입기)는 `tests/ps-guard-lib.mjs` 에
한 벌만 둡니다. 두 시험 파일이 서로를 `import` 하면 러너의 '파일별 등록 건수' 인구조사가 무너집니다
(ES 모듈은 한 번만 평가되므로 먼저 부른 쪽이 상대의 등록까지 삼키고, 뒤쪽은 0건이 되어 러너② 가 웁니다).

> ★ `backup-taskmgr.cmd` 의 종료코드 표는 원래 `0 ok | 1 backup failed …` 처럼 **한 줄에 두 코드**를
> `|` 로 나눠 적었습니다. 사람은 그것을 표 테두리로 오해하고(실제로 "불일치" 오판이 한 번 났습니다)
> 기계는 파싱이 번거로워집니다. **계약을 그 형식에 맞추는 대신 형식을 고쳤습니다.**
> `restore-taskmgr` 와 같은 ASCII `EXITCODES` 블록을 `.ps1` 머리말과 `.cmd` 양쪽에 한 벌씩 두고,
> **한 줄에 코드 하나**로 적습니다. 한글 표는 사람용으로 그대로 남습니다(`.cmd` 는 비ASCII 금지라
> 한글 표를 복사할 수 없습니다. 그래서 기계용 사본이 따로 필요합니다).

`TC_TEST_STRICT=1 node tests/run-tests.mjs` 로 함께 돕니다.

### 리허설 기록 ①: 2026-09-02 (손으로, 개발 PC)

**왜 남기는가**: 설계 §11 은 이관·앱 전환보다 **먼저** 백업을 설치하고 첫 회차를 내용까지
대조하라고 못박았는데, 앱 전환(`XmlRetired = true`)이 먼저 나갔습니다. 즉 **지금 백업은 0회**이고,
`taskmgr_app` 은 전 사용자 행 `DELETE` 권한을 가진 채 80여 대에 배포돼 있는데 되돌릴 스냅샷이
없습니다. 서버 날 처음 해 보다 막히지 않도록, 아래 절차를 개발 PC에서 **끝까지 한 번 돌려 봤습니다.**
서버에서 달라지는 것은 맨 끝에 따로 적었습니다.

**돌린 것과 결과** (MySQL 8.4.9):

| 단계 | 명령 | 결과 |
|---|---|---|
| ① 계정 | `create-backup-user.sql` (비번만 교체) | `SHOW GRANTS` = `USAGE ON *.*` + `SELECT, TRIGGER ON taskmgr.*`. 파일 주석의 기대값과 일치 |
| ② `.cnf` 없이 실행 | `backup-taskmgr.ps1 -BackupDir … -CnfPath …` | **코드 `2`**, 화면에 `.cnf` 3줄 형식과 `icacls` 한 줄을 그대로 찍음. 그 안내만 따라 하면 됩니다 |
| ③ `.cnf` 생성 + 권한 좁힘 | 안내대로 `icacls … /inheritance:r /grant *S-1-5-18:R /grant *S-1-5-32-544:F` | 스크립트의 ACL 점검이 조용함(경고 없음) |
| ④ 수동 1회 백업 | `backup-taskmgr.ps1` | **코드 `0`**, `taskmgr-20260902-135532.sql`, **130,792 바이트**, 자체검증 **표 23/23, 트리거 0/0, 루틴 0/0**, 0.2초 |
| ⑤ 복구 리허설 | 덤프 → `taskmgr_restore` | **원본과 내용 일치**(아래 표) |

**④ 의 자체검증에 대해**: 트리거 `0/0` 은 결손이 아닙니다. 이 DB 는 트리거가 원래 0개입니다
(2026-08-11 감사 트리거 폐지). 그래도 `TRIGGER` 권한은 반드시 있어야 합니다:
없으면 **DB 쪽 개수까지 0으로 보여** `0 == 0` 으로 대조를 통과해 버립니다(위 '왜 이 스크립트가
필요한가' 절). 이번 실행은 3단계 `SHOW GRANTS` 선검사를 통과했으므로 그 함정이 아닙니다.

**⑤ 복원 대조: `exit 0` 은 증거가 아니라서 내용을 맞춰 봤습니다**(설계 §9):

| 대조 항목 | 원본 `taskmgr` | 복원본 `taskmgr_restore` | 판정 |
|---|---|---|---|
| 표 목록 | 23표 (`cal_*` **16** + 나머지 7) | 23표, 이름까지 동일 | 일치 |
| 표별 행 수 | 23표 전수, 합 460행 | 23표 전수, 합 460행 | **전 표 일치** |
| `schema_version` | `8` | `8` | 일치 |
| `SHOW CREATE TABLE` | `cal_entry`, `cal_user_rev`, `app_user`, `cal_report_hours` | 4표 모두 바이트 동일 | 일치 |
| FK / CHECK | 24 / 33 | 24 / 33 | 일치 |
| 트리거 / 루틴 | 0 / 0 | 0 / 0 | 일치 |
| **덤프 재생성 대조** | 원본 덤프 | 복원본을 다시 덤프 | **sha256 동일**(DB 이름이 박힌 주석 한 줄만 정규화) |

마지막 줄이 가장 센 증거입니다. 복원본을 다시 떠서 원본 덤프와 **바이트까지** 맞췄습니다.
행 수만 세는 대조는 값이 바뀐 것을 못 잡지만 이것은 잡습니다.

> ★ 대조하다 실제로 헛돈 적이 있어 적어 둡니다. 표 이름을 셸 변수로 돌려 표별 `COUNT(*)` 를 셌더니
> 이름 끝의 `\r`(윈도우 줄바꿈) 때문에 **양쪽 다 `ERROR 1103` 으로 실패**했고, 비교 코드는 그
> *"둘 다 빈 값"* 을 **일치로 읽어 23표 전부 `OK`** 를 찍었습니다. 대조 코드 자신이 조용히
> 성공하는 이 모양이 §9 가 경고하는 바로 그것입니다. **대조는 '값이 실제로 있었는지'까지 보세요**
> (위 표의 '합 460행' 이 그 자리입니다. 합이 0이면 대조가 아니라 헛것을 비교한 것입니다).

**남긴 것 / 지운 것**: `taskmgr_backup@localhost` 계정과 `.cnf` 는 **남겼습니다**(설계된 계정이고
`localhost` 한정·최소권한이라 무해하며 앞으로 이 스크립트가 씁니다). 리허설용 `taskmgr_restore`
와 `taskmgr_v16chk` 는 **DROP** 했고, `mysql.tables_priv`·`mysql.db` 에 그 DB 들의 잔여 권한이
0행임을 확인했습니다(`DROP DATABASE` 는 표 단위 권한을 지우지 않습니다).

### 리허설 기록 ②: 2026-09-07 (`restore-taskmgr.ps1` 로, 개발 PC)

**①과 무엇이 다른가**: ①은 사람이 손으로 한 번 해 본 기록이고, ②는 **스크립트가 한 것**입니다.
손으로 한 절차는 다음 사람이 다시 손으로 해야 하고, 그 사이에 절차가 바뀌면 아무도 모릅니다.
그래서 실행체(`restore-taskmgr.ps1` / `.cmd`)와 회귀 계약(`tests/restore-guards.test.mjs`)을 만들고,
**그 실행체로** 처음부터 끝까지 다시 돌렸습니다.

**대상 DB 는 `taskmgr_restore_drill` 고정. `taskmgr` 에는 SELECT·`mysqldump` 만 했습니다.**

**덤프 머리 확인** (`taskmgr-20260824-102609.sql`, 47,665 B):
`CREATE DATABASE` **0건** / `USE` **0건**. 단일 DB 덤프라 **대상 DB 인자로만** 들어갑니다.
그래서 인자를 빼면 *"No database selected"* 로 끝나지 조용히 엉뚱한 DB 에 들어가지는 않습니다.
(스크립트는 매 실행마다 이 두 문장의 유무를 세어 화면에 찍습니다. 언젠가 `--databases` 로 뜬
파일이 섞이면 그때는 **파일에 적힌 DB 로** 들어가기 때문입니다.)

#### ㉮ 옛 스냅샷(8-24) 복구: 스키마는 **틀렸고**, 행 수는 시점 차입니다

| 대조 항목 | 라이브 `taskmgr` | 복구본(8-24 스냅샷) | 판정 |
|---|---|---|---|
| base table **이름 집합** | 23 | **20**. `cal_report_daily`, `cal_report_hours`, `cal_report_weekly` 없음 | **불일치(진짜 문제)** |
| 뷰 / 트리거 / 루틴 이름 집합 | 0 / 0 / 0 | 0 / 0 / 0 | 일치 |
| 표별 행 수 | 합 **18,749** | 합 **231** (16표 차이) | 시점 차(예상됨) |
| 덤프 마감 표시 | - | `-- Dump completed` 있음 | 일치 |

**스키마 차이의 정체**: 빠진 3표는 8-24 **이후** 마이그레이션이 만든 것입니다.
`migrate-2026-08-31-report-daily.sql`(`schema_version` 5→6, `cal_report_daily`·`cal_report_hours`),
`migrate-2026-08-31-report-weekly.sql`(6→7, `cal_report_weekly`),
`migrate-2026-08-31-sent-only.sql`(7→8, `cal_report_weekly` 재작성).
즉 *"덤프가 낡았다"* 이지 *"백업이 반쪽이다"* 가 아닙니다. **스키마 이름 집합은 같아야 하고,
행 수는 시점 차로 다를 수 있다.** 스크립트는 이 둘을 나눠 판정합니다(`-AllowRowDiff` 는
행 수 차이만 경고로 낮추고 **스키마는 그대로 엄격**합니다).

**표별 행 수 차이(16표)**: 나머지 7표(`app_user` 89, `cal_schema_meta` 1, `cal_user_rev` 89,
`org_unit` 12, `project` 14, `status_code` 4, `title_code` 11)는 양쪽이 같았습니다:

| 표 | 라이브 | 복구본 | 차이 |
|---|---:|---:|---:|
| `cal_task_hours` | 6,561 | 0 | −6,561 |
| `cal_attendance` | 5,837 | 0 | −5,837 |
| `cal_entry` | 3,625 | 0 | −3,625 |
| `cal_category` | 711 | 0 | −711 |
| `cal_entry_commit` | 708 | 0 | −708 |
| `cal_todo` | 558 | 0 | −558 |
| `cal_entry_except` | 326 | 0 | −326 |
| `cal_todo_day_note` | 169 | 0 | −169 |
| `customer` | 19 | 8 | −11 |
| `section_code` | 10 | 3 | −7 |
| `cal_room` | 3 | 0 | −3 |
| `cal_migration_log` | 1 | 0 | −1 |
| `cal_user_pref` | 1 | 0 | −1 |
| `cal_report_daily` / `cal_report_hours` / `cal_report_weekly` | 0 / 0 / 0 | (표 없음) | - |

`cal_*` 가 전부 0 인 것은 결손이 아닙니다. **XML→DB 이관이 9-01 에 있었습니다**
(`dist/backup/taskmgr-before-xml-migration-20260901-104618.sql`). 8-24 시점에는 캘린더가 비어 있었습니다.

#### ㉯ `-Grants` 없이 복구하면 정말 죽는가: 실측했습니다

`복구방법.txt` 4번의 근거를 우리 스크립트로 재현한 자리입니다. 스모크는 `widget/CalendarDb.cs`
부팅 경로의 실제 SQL 6건입니다(순서대로 프리앰블 §3.6, `cal_schema_meta` §5.5, `app_user` 공개API1,
`cal_user_rev` §3.5, `cal_category` 부팅조회 1/10, `cal_entry` LEFT JOIN 부팅조회 2/10).

```
· 프리앰블        → ERROR 1044 (42000): Access denied for user 'taskmgr_app'@'%' to database 'taskmgr_restore_drill'
· cal_schema_meta → ERROR 1044   · app_user → ERROR 1044   · cal_user_rev → ERROR 1044
· cal_category    → ERROR 1044   · cal_entry → ERROR 1044          (6/6 실패, 종료코드 1)
```

**`1142` 가 아니라 `1044` 였습니다.** 권한이 **한 줄도** 없으면 MySQL 은 DB 단위에서 먼저 막습니다.
`복구방법.txt` 가 적은 `1142` 는 *"DB 에는 붙는데 그 표만 권한이 없는"* 경우입니다. 그 쪽도 따로 냈습니다:

```
GRANT SELECT ON taskmgr_restore_drill.project TO 'taskmgr_app'@'%';   -- create-app-user.sql 만 돈 상태를 흉내
SELECT v FROM cal_schema_meta WHERE k='schema_version';
→ ERROR 1142 (42000): SELECT command denied to user 'taskmgr_app'@'localhost' for table 'cal_schema_meta'
```

즉 **`create-app-user.sql` 만 돌리고 `grants-calendar.sql` 을 건너뛰면 정확히 `1142`** 입니다.
둘 다 건너뛰면 `1044`. 표와 데이터는 양쪽 모두 멀쩡합니다. 그래서 행 수 대조만으로는 안 잡힙니다.

#### ㉰ `-Grants` 로 재적용 후 스모크 성공: 여기서 "복구되었다"고 말할 수 있습니다

옛 스냅샷은 `grants-calendar.sql` 과 세대가 맞지 않아(`ERROR 1146`, 위 ★ 절) 여기서 멈춥니다.
그래서 **같은 날 뜬 덤프**(`dist/backup/taskmgr-pre-restore-drill-20260907-131414.sql`, 1,743,789 B)로
전 과정을 다시 돌렸습니다. 검증이 **초록불도 낼 수 있다**는 증거이기도 합니다(늘 빨간 검사는 검사가 아닙니다):

| 대조 항목 | 결과 |
|---|---|
| base table / 뷰 / 트리거 / 루틴 **이름 집합** | 23 / 0 / 0 / 0, 전부 동일 |
| 표별 행 수 | **23표 전수 일치, 합 18,749행** |
| 덤프 마감 표시 | 있음 |
| `-Grants` (`create-app-user.sql` + `grants-calendar.sql`, 임시 사본에서 DB 이름 치환) | 22표에 권한 부여 |
| **앱 스모크 6건** (`taskmgr_app`, 비번은 `widget/DeployConfig.cs` 에서 읽음) | **6/6 성공** (`login_id='arbaek'`) |
| 종료코드 | **`0`** |

#### ㉱ 뒷정리와 `taskmgr` 불변 증명

- `-DropTarget` 으로 `DROP DATABASE taskmgr_restore_drill` + **남은 표 단위 권한 22건 회수**, 그 뒤
  `mysql.tables_priv` 와 `mysql.db` **0행 확인**.
  (`DROP DATABASE` 는 표 단위 권한을 지우지 않습니다. 회수를 빠뜨리면 같은 이름의 DB 가 생길 때 되살아납니다.)
- `SHOW DATABASES` 결과: `information_schema` / `mysql` / `performance_schema` / `sys` / `taskmgr`. **원래대로**.
- `taskmgr_app` 의 표 단위 권한이 붙은 DB 는 `taskmgr` **하나뿐**.
- **`taskmgr` 불변 증명**: 리허설 전후 표별 행 수 23표 전수 동일(합 18,749). 그리고 더 센 증거로,
  리허설 **전**에 뜬 덤프와 **후**에 뜬 덤프의 `sha256` 이 같았습니다
  (`-- Dump completed on <시각>` 한 줄만 제외, `ba59be30…95e3`, 둘 다 1,743,789 B).
  행 수 대조는 값이 바뀐 것을 못 잡지만 이것은 잡습니다.

#### ㉲ 게이트

`TC_TEST_STRICT=1 node tests/run-tests.mjs` 결과 **`1160 pass / 0 fail / 0 skip`, exit `0`**
(그중 `restore-guards.test.mjs` 40건, `backup-guards.test.mjs` 30건. 위 '회귀 계약' 절 참조).

#### 서버(배포 PC)에서 달라지는 것: 여기만 바꿔서 그대로 하세요

| 항목 | 이번 리허설(개발 PC) | 서버에서 |
|---|---|---|
| 계정 비밀번호 | 리허설용 임의 값 | **실제 강한 비밀번호.** `create-backup-user.sql` 의 `CHANGE_ME_ON_DEPLOY` 를 먼저 바꾸고 실행. 그 값을 파일에 커밋하지 말 것 |
| `.cnf` 위치 | `%LOCALAPPDATA%\taskmgr\backup-taskmgr.cnf` (`-CnfPath` 로 지정) | 기본값 **`%ProgramData%\taskmgr\backup-taskmgr.cnf`** (`-CnfPath` 를 주지 않으면 여기). 스케줄 작업은 SYSTEM 으로 도니 사용자 프로필 밑에 두지 말 것 |
| `.cnf` 권한 | SYSTEM `R`, Administrators `F`, **실행한 사용자 `R`**(대화형 실행이라) | **SYSTEM `R`, Administrators `F` 만.** 화면에 찍히는 `icacls` 한 줄 그대로. 사용자 ACE 를 넣지 말 것 |
| `-BackupDir` | 임시 폴더(C: 드라이브라 **같은 볼륨 경고가 떴습니다**) | **원본과 다른 물리 볼륨**(예: `D:\taskmgr-backup`). 같은 디스크면 백업이 아닙니다 |
| 스케줄 등록 | **하지 않음** | `backup-taskmgr.cmd -Install` 을 **관리자 콘솔에서** 1회 (주 1회 등록). `-Status` 로 확인 |
| 첫 회차 검증 | 위 ⑤ 를 그대로 | **똑같이 하세요.** 첫 회차는 반드시 임시 DB 로 복원해 내용까지 대조. 설계 §11 이 요구하는 것이 이것입니다 |

## 데이터 채우기: 내부망 LLM

실 데이터는 폐쇄망 밖으로 못 주므로, **내부망 LLM**이 `schema-structure.sql`(구조) + `load-template.sql`(형식·규칙)을 보고 실제 과제의 INSERT SQL을 생성하고 실행:
```
mysql -u root -p --default-character-set=utf8mb4 taskcalendar < 내부망LLM이_만든_INSERT.sql
```
규칙(코드값+발주처 먼저, section/status는 코드테이블에 있는 이름, 선진행 NULL 등)은 `load-template.sql` 상단 참고. 2026-10-15 부터 과제는 이름으로 적어 임시 표에 넣고 템플릿 끝에서 이름으로 번호를 찾아 옮깁니다(못 찾는 이름이 있으면 멈춥니다. `--force` 금지).

## 나중: 서버 이관

구조는 다시 설계하지 않습니다. 서버에서 **같은 스크립트 실행**(구조·계정 재현) + 로컬 데이터는 dump/restore:
```
# 로컬(현 서버)에서 원본 과제 DB 추출
mysqldump -u root -p taskmgr > taskmgr-data.sql
# 새 서버에서: 원본을 먼저 붓고(setup 이 같은 서버의 taskmgr 을 읽어 과제를 복사한다)
mysql -u root -p -h <새서버> taskmgr < taskmgr-data.sql
# 이 한 줄이 taskcalendar 의 구조, 회사 시드, 과제 복사(코드표 이름을 번호로), 권한, 검증을 다 한다
setup-taskcalendar.cmd -DbHost <새서버>
# 위젯: DeployConfig.DbHost 를 새 서버로 바꿔 재빌드
```
- 2026-10-15 전의 이 블록은 `setup` 을 먼저 돌리고 덤프를 나중에 부었습니다. `setup-taskcalendar` 는 **같은 서버의 원본(`-SourceDb`, 기본 `taskmgr`)에서** 과제를 복사하므로 원본이 먼저 있어야 합니다. 원본의 과제 표는 0.16 모양(이름 키)이어도 됩니다. 복사하면서 번호로 바꿉니다.
- 사용자 표(`app_user` 등)는 원본에서 옮기지 않습니다. `setup` 이 비공개 저장소 `taskmgr-company-data` 의 시드로 `user_id`, `org_id`, `title_id` 구조를 처음부터 만듭니다. 그래서 옛 덤프가 옛 `app_user`(PK=`login_id`)를 되살려 놓아도 새 DB 에는 영향이 없습니다(옛 키를 옮기던 `migrate-2026-08-24-user-id.sql` 은 2026-10-15 에 지웠습니다).
- 이미 쓰던 `taskcalendar`(캘린더 기록 포함)를 그대로 옮겨야 하는 경우는 `setup` 이 아니라 덤프 복원입니다(DEPLOY.md §0-6, 아래 '복구' 절의 `restore-taskmgr`). `setup` 을 다시 돌리면 대상의 캘린더 기록이 지워집니다.
- **이관 직후 새 서버에서 `backup-taskmgr.cmd -Install` 을 돌리세요.** 백업은 구조에 딸려 오지 않습니다(별도 도구·스케줄러 등록). 아래 '백업' 절.
- 사용자 PC 에 남아 있는 옛 캘린더 파일(`%APPDATA%\TaskCalendar\data.xml`)은 이 dump/restore 경로가 아니라 **1회성 이관**으로 옮깁니다(설계 §8. `cal_migration_log` 가 재실행을 막습니다). 두 갈래가 있습니다. 배포자가 일괄로 돌리는 **`xml-to-db`** 도구, 그리고 사용자가 앱에서 직접 올리는 **XML 가져오기**(자동 이관은 폐기했습니다. 설계 §3b). 어느 쪽이든 **한 번**입니다.

## 검증
setup-taskcalendar 후(그 스크립트가 검증 보고서를 남깁니다) 또는:
```
mysql -u root -p -e "USE taskcalendar; SHOW TABLES; SELECT COUNT(*) FROM project;"
```
캘린더 쪽은 `init-calendar` 의 게이트 + `grants-calendar.sql` 끝의 확인 목록입니다(위 '검증' 절 참조).
백업은 이 게이트에 안 들어옵니다. `backup-taskmgr.cmd -Status` 와 첫 회차 로그를 따로 보세요(위 '백업' 절).

> ⚠️ `setup-taskcalendar`/`schema-structure.sql`은 멱등 재구축이라 **기존 테이블을 DROP**합니다. 데이터가 있는 DB에 재실행하면 지워집니다(최초 구축용).

## 편집 권한 (앱 내 공식 과제 편집 게이트)

> **~~관리자 비밀번호~~: 2026-08-03 v0.17.0에서 폐지됐습니다.** 이 자리에는 *베이크 디폴트로 먼저 인증하고, 설정에서 비밀번호를 바꾸고, 분실 시 `db-config.json` 삭제로 복구하는* 절차가 적혀 있었습니다. **그 체계는 없습니다.** `db-config.json`은 앱이 읽지도 쓰지도 않고, 설정창의 관리자 인증칸도 사라졌습니다. 배포자가 챙길 것이 **하나도 없어졌으므로** 그 절차를 따라 하지 마세요.

지금은 **회사 계정 로그인 + `app_user`** 로 정해집니다. 배포자 관점에서 챙길 것:

- **선행조건**: `app_user`, `org_unit`, `title_code` 가 서 있고, 앱 계정(`taskmgr_app`)에 그 표들의 `SELECT` 권한이 있어야 합니다. 없으면 사용자가 **로그인 게이트를 넘지 못합니다**(과제 편집만이 아니라 앱 전체가 막힙니다). 그 표들의 DDL·실데이터는 이 저장소가 아니라 별도 비공개 저장소(`taskmgr-company-data`)에 있습니다.
- **누가 편집할 수 있나**: `app_user.edit_role` 과 `is_active` 가 정합니다. 판정은 앱이 **쓰기를 요청하는 시점**에 호스트 한 곳(`ProjectDb.OpenWriteAsync`)에서 합니다. 화면이 캐시한 역할로 미리 막지 않으므로, 관리자가 값을 바꾸면 **재로그인 없이 바로** 반영됩니다.
- **권한을 주고 뺏는 법**: DB 에서 그 사람의 `edit_role` 을 바꾸면 끝입니다. 앱 배포·재빌드가 필요 없습니다.
- 근거, 화면, 실패 경로의 정본은 [`../../docs/USER-LOGIN.md`](../../docs/USER-LOGIN.md) 입니다.

> 배포 직전에 **정말로** 챙겨야 하는 자격은 이것이 아니라 **앱 DB 계정 비번**입니다. `create-app-user.sql` 과 `widget/DeployConfig.cs` 의 `DbPassword` 가 **같은 강한 값**이어야 합니다. 저장소의 기본값은 서로 어긋나 있습니다(SQL `CHANGE_ME_ON_DEPLOY` / config `taskmgr1234`). 주입 기계는 만들지 않기로 했으므로(2026-09-02 결정 3) **배포 체크리스트로** 지킵니다.
