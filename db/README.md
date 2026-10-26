# `taskmgr` DB: 트랙 이어서 작업 (핸드오프)

> **⚠️ 이 README는 '과제 트랙'의 진입점입니다.** 같은 DB 안에 **두 트랙**이 있고 규칙이 다릅니다.
> 지금 앱이 쓰는 DB 는 **`taskcalendar`** 입니다(v0.19.0 부터). 이 문서가 `taskmgr` 이라 적은 곳은 옛 DB(0.16 과 0.17.1 이 쓰는 원본) 이야기입니다.
>
> | 트랙 | 표 | 진입점 문서 | 구축 |
> |---|---|---|---|
> | **과제**(사업부 공식 과제 마스터) | `project`, `customer`, `section_code`, `status_code` | **이 문서** → [`ARCHITECTURE.md`](ARCHITECTURE.md) → [`DESIGN_NOTES.md`](DESIGN_NOTES.md)/[`TABLE-DESIGN.md`](TABLE-DESIGN.md) | `deploy/setup-taskcalendar.cmd`(세 묶음을 한 번에) |
> | **캘린더**(개인 일정, 할 일, 공수, 근태, 보고 기록) | `cal_*` | [`CALENDAR-TABLE-DESIGN.md`](CALENDAR-TABLE-DESIGN.md) | 위와 같음. 캘린더만 다시 세울 때는 `deploy/init-calendar.cmd` |
> | (밖) 사용자·조직 | `app_user`, `org_unit`, `title_code` | [`../docs/USER-LOGIN.md`](../docs/USER-LOGIN.md) | DDL 과 명단은 **별도 비공개 저장소**. `setup-taskcalendar` 가 그 파일을 읽어 만든다 |
>
> **2026-10-15**: 새 DB 진입점은 **`deploy/setup-taskcalendar.cmd` 하나**입니다. 옛 진입점 `deploy/init-db.cmd`, `deploy/migrate.cmd`, `schema.sql`, 지난 `deploy/migrate-2026-*.sql` 과 되돌리기 파일은 지웠습니다(git 이력에 있습니다). 같은 날 코드표(발주처, 구분, 상태, 직급)의 기본키가 번호가 됐습니다(`schema_version` 13, [`TABLE-DESIGN.md`](TABLE-DESIGN.md) §9 ADR-23).
>
> **한쪽 문서를 다른 쪽 근거로 쓰지 마세요.** 특히 앱 계정 권한 정책이 반대입니다(아래 ⚠️).
>
> **읽는 순서(과제 트랙)**: 이 README → [`ARCHITECTURE.md`](ARCHITECTURE.md)(배포·운영 결정 + **2026-09-02 갱신 노트를 먼저**) → [`DESIGN_NOTES.md`](DESIGN_NOTES.md)/[`TABLE-DESIGN.md`](TABLE-DESIGN.md)(스키마 설계 근거) → [`deploy/README.md`](deploy/README.md)(구축, 배포, 백업 절차).
> **지금 무엇을 해야 하는지**는 [`ROADMAP.md`](ROADMAP.md)(축 A, 축 B 백로그)와 [`../docs/ROADMAP.md`](../docs/ROADMAP.md)(배포 조건)가 정본입니다. 메모리 `project-taskmgr-db`도 매 세션 자동 로드됩니다.
> *(2026-09-02: 옛 `SETUP.md`는 이 문서의 '환경과 스키마 적용' 절로 흡수하고 폐기했습니다. 환경, 접속, 설계 모델이 세 문서에 흩어져 서로 어긋나 있었습니다.)*

**DB가 원본(source of truth)**인 과제관리 DB. Admin이 **캘린더 앱**으로 과제를 등록/수정(대상 행 `uid` 기준 CRUD)하고, **Excel은 DB에서 추출하는 리포트**다(양방향 동기화 없음). **로컬 MySQL에서 구축·검증한 뒤 사내 서버 MySQL로 이관**(로컬 먼저, 네이티브 = 서버와 동일 환경). 캘린더 앱이 이 DB를 원본으로 소비한다.

> **모델 전환**: 이전 설계는 DB를 "사업부 Excel 장표의 컴팩트 미러"(Excel 원본 → DB 미러 → 멱등 재임포트)로 봤으나, 지금은 **DB가 원본, Excel은 추출 리포트**로 뒤집었다(모델 B). Excel 흔적 필드(`source_no`·`customer.no`)는 제거되고, 앱 편집용 필드(소프트삭제 `is_active`, 감사 `created_at`/`updated_at`)가 추가됐다.

> **캘린더 트랙(2026-08~09).** 설계 근거는 [`CALENDAR-TABLE-DESIGN.md`](CALENDAR-TABLE-DESIGN.md), 구축 절차, 배포 순서, 종료코드는 [`deploy/README.md`](deploy/README.md) 에 있습니다.
> **2026-09-01부터 위젯의 캘린더 본체가 이 DB에 저장됩니다**(`DeployConfig.XmlRetired = true`, 로컬 `data.xml` 폐기, 온라인 전용). 그래서 **이 DB가 꺼지면 캘린더 앱이 통째로 멈춥니다.** 백업 설치(`deploy/backup-taskmgr.cmd -Install`)와 서버 가용성이 선택이 아니라 조건입니다.
> ⚠️ **두 트랙은 앱 계정 권한 정책이 다릅니다.** 과제 표는 소프트삭제(`is_active`)라 `DELETE` 를 주지 않지만, `cal_*` 는 **소프트삭제가 없어 삭제가 곧 정상 동작이라** 의도적으로 `DELETE` 를 줍니다(안 주면 앱의 삭제 UI 가 전부 `ERROR 1142`). 한쪽 문서를 다른 쪽 근거로 쓰지 마세요.
> - **2026-08-11 정정**: 이 줄은 그 부여를 *"(감사 트리거로 상쇄)"* 라고 적고 있었습니다. **감사 트리거는 폐기됐습니다**(`CALENDAR-TABLE-DESIGN.md` §7.5. 휴지통이 감사 대상과 같은 DB 안이라 서버 장애에 무력했고, 표준 복구 경로는 덤프 + binlog 입니다). 위험을 실제로 상쇄하는 것은 **주간 mysqldump + binlog 30일** 이고, 그 실행체가 `deploy/backup-taskmgr` 입니다(설계 §9).
> - **백업은 DB 전체가 대상입니다.** 캘린더 트랙에서 만들었지만 과제 표도 함께 받습니다. 기본 DB 는 `taskcalendar` 이고(2026-10-15 부터. 파일 이름 `backup-taskmgr` 은 그대로), 옛 DB 는 `-DbName taskmgr` 로 이름을 적습니다. 서버 이관이나 신규 구축 뒤에는 `deploy/backup-taskmgr.cmd -Install` 을 잊지 마세요(구조 스크립트에 딸려 오지 않습니다).

## ✅ 현재 상태 (2026-09-02)
- **모델 B(DB 원본) 재설계 완료 + 실 DB 검증 완료.** 시드는 아직 **더미**(롤 지명)이고, 실 사업부 Excel 1회 이관이 남아 있습니다.
- **P3 앱↔DB 연동 완료(localhost)**: 위젯이 이 DB를 **온라인 전용**으로 소비합니다. 조회도 편집도 서버가 필요하고 **로컬 캐시는 없습니다**(ADR-18). 공식 과제 카탈로그 화면, 재연결 도구, 단일 카테고리 스토어 구현. 상세 `ARCHITECTURE.md` §4.7.
- **P4 Excel 추출·P6.5 권한 완료**: 의존성 0 xlsx 추출기(v0.13.0), 회사 계정 로그인 + `app_user.edit_role` **요청 시점** 판정(v0.17.0). **공용 관리자 비밀번호와 `db-config.json`은 폐지**됐습니다.
- **과제 트랙 표 4개**: `customer`·`project` + 코드테이블 `section_code`·`status_code`, **뷰 0개**. `section`/`status`는 **ENUM이 아니라 코드테이블 + FK**입니다(2026-07-24 ADR-22. ENUM은 값 추가, 개명, 순서, 숨김에 `ALTER TABLE`이 필요해 런타임 관리가 불가능했습니다).
  ※ **표 개수를 문서에 박지 않습니다.** 세는 기준은 실 DB가 아니라 스키마 파일입니다: 과제 = [`deploy/schema-structure.sql`](deploy/schema-structure.sql)의 `CREATE TABLE`(옛 `schema.sql` 은 2026-10-15 에 지웠습니다), 캘린더 = [`deploy/schema-calendar.sql`](deploy/schema-calendar.sql)의 `CREATE TABLE`(그 목록 자신이 정본이고 `deploy/init-calendar.ps1`의 `$DESIGN_TABLES` 명부가 그것과 대조됩니다), 사용자·조직 = 비공개 저장소. *(개수를 박아 둔 판이 실제로 사고를 냈습니다. 명부가 13에 멈춰 있어 2026-09-02까지 원큐 구축 진입점이 `Die`로 막혀 있었습니다.)*
  > **2026-08-24 키 전환(캘린더 트랙만 해당).** `cal_*` 의 소유자 컬럼이 `app_user.login_id` 에서 **`app_user.user_id`(신설 대리키)** 로 바뀌었습니다. 그래서 **`app_user` 에 컬럼이 하나 늘고(`user_id`) `login_id` 는 UNIQUE 로 강등**됩니다. 그 DDL 은 이 저장소가 아니라 비공개 저장소(`taskmgr-company-data/01-schema-users.sql`)에 있습니다.
  > ⚠️ **과제 트랙은 그 전환(2026-08-24)의 대상이 아니었습니다.** 그날은 `project`, `customer`, `section_code`, `status_code` 의 이름 PK 를 남겼습니다.
  > **2026-10-15 코드표 번호 키 전환.** 그 판정을 뒤집어 `customer`, `section_code`, `status_code`(와 비공개 저장소의 `title_code`)의 기본키를 번호(`customer_id`, `section_id`, `status_id`, `title_id`)로 바꿨고, 이름은 `UNIQUE` 라벨로 남았습니다. `project` 는 `customer_id`, `section_id`, `status_id` 로 번호를 가리키고 FK 는 `ON UPDATE RESTRICT ON DELETE RESTRICT` 입니다. 개명은 라벨 한 행이고 화면은 조인으로 따라옵니다. 구분 2(선진행)와 상태 2(종료)는 앱이 번호로 판정하므로 숨김과 삭제가 막힙니다. 근거는 [`TABLE-DESIGN.md`](TABLE-DESIGN.md) §9 ADR-23, [`CALENDAR-TABLE-DESIGN.md`](CALENDAR-TABLE-DESIGN.md) **§5.6**, 결정 문서 [`../docs/CODE-TABLE-IDS.md`](../docs/CODE-TABLE-IDS.md). 옛 설계의 색상, 결정론적 uid 앵커(캘린더 결합), 2축(유형×단계)은 없습니다. ※ 단, P3에서 **외부 안정 참조키 `project.uid`(UUID assign-once)**를 추가했습니다(옛 캘린더 결합 앵커와 다른, 일정이 `db-<uid>`로 참조하는 순수 참조키).
- 앱 편집 지원: `id`(편집 식별자), `is_active`(소프트삭제), `created_at`/`updated_at`(감사), 코드표 번호 참조(개명은 라벨 한 행).
- 이전의 미러/캘린더 결합 설계는 **모델 B로 대체됨.** `deploy/schema-structure.sql` 앞부분이 옛 객체를 DROP하고 재구축.

## 🖥️ 환경 (개발 PC 기준)과 스키마 적용

*(2026-09-02 기준 실측값. 서버는 여기가 아니라 [`deploy/README.md`](deploy/README.md)를 따릅니다.)*

- MySQL **8.4.9 Community**: winget `Oracle.MySQL`로 설치. Windows 서비스 **`MySQL84`**(자동시작), 포트 **3306**
- 접속 `root` / (관리자 비밀번호는 문서에 적지 않는다. 명령은 `-p` 로 물어보게 한다), DB `taskcalendar`(앱이 쓰는 DB)와 `taskmgr`(옛 원본) (charset `utf8mb4` / collation `utf8mb4_0900_ai_ci`)
- 바이너리 `C:\Program Files\MySQL\MySQL Server 8.4\bin`, 데이터 `C:\ProgramData\MySQL\MySQL Server 8.4\Data`, 설정 `...\my.ini`
- 멈춰 있으면(관리자 PowerShell): `Start-Service MySQL84`
- **서버 요건: MySQL 8.0.16+.** 그 미만은 `CHECK` 제약을 파싱만 하고 **조용히 무시**합니다(캘린더 스키마가 CHECK로 무결성을 지키므로 사용 불가). `init-calendar`가 이것을 게이트로 막습니다. 콜레이션 `utf8mb4_0900_ai_ci`도 8.0+에만 있습니다.

**구조 만들기는 손으로 SQL을 돌리지 말고 `deploy/` 원큐 스크립트를 쓰세요.** 순서와 게이트를 사람이 대신 지켜야 하기 때문입니다([`deploy/README.md`](deploy/README.md)):

```
deploy\setup-taskcalendar.cmd        # 새 DB 원큐: 구조 + 회사 시드 + 원본 taskmgr 의 과제 복사(코드표 이름을 번호로) + 앱 권한 + 검증 보고서
deploy\backup-taskmgr.cmd -Install   # 주간 백업(구축에 딸려 오지 않습니다. 별도 설치. 기본 DB 는 taskcalendar)
```

캘린더 트랙만 다시 세울 일이 있으면 `deploy\init-calendar.cmd`(cal_* 구조 + 권한 + 배포 게이트)가 그대로 있습니다. 옛 `deploy\init-db.cmd` 는 2026-10-15 에 지웠습니다.

**데이터가 있는 v12 DB 를 v13 으로 옮길 때**(개발자 로컬 `taskcalendar` 처럼 이미 서 있고 지우면 안 되는 DB 만): `deploy\migrate-2026-10-15-code-ids.sql` 한 번입니다. 먼저 `deploy\backup-taskmgr.cmd -DbName taskcalendar` 로 백업하고, 위젯을 모두 닫고, `--force` 없이 돌립니다. 절차와 멈추는 조건은 [`deploy/README.md`](deploy/README.md) 와 그 파일 머리말에 있습니다.

> ⛔ **`setup-taskcalendar`, `schema-structure.sql`, `schema-calendar.sql` 재실행은 파괴적입니다. 초기 구축 전용이며, 운영 중 DB엔 절대 금지.**
> 앞부분이 테이블을 **`DROP` 해 전 데이터를 삭제**합니다(`setup-taskcalendar` 는 지우기 전에 대상 DB 를 한 벌 덤프하지만, 그 뒤에 쓰인 데이터는 되살릴 곳이 그 덤프뿐입니다). 운영 중 구조 변경은 **`deploy/migrate-*.sql`** 로 하세요(지금 남은 것은 `migrate-2026-10-15-code-ids.sql` 하나).
> ```bash
> # 판번호 확인(읽기만 함. 비밀번호는 묻는 창에 넣는다):
> MYSQL="/c/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe"
> "$MYSQL" -uroot -p --get-server-public-key --default-character-set=utf8mb4 taskcalendar -e "SELECT v FROM cal_schema_meta;"
> ```
> 운영 DB의 데이터 변경은 **앱의 CRUD(또는 DB 직접 편집)**로만 합니다.

## ⚡ 빠른 복구 (새 세션에서 DB 살아있는지 확인)
DB는 앱 CRUD로 계속 변하는 **살아있는 데이터**다. 아래 건수는 고정값이 아니라 **현황 조회**다(더미 초기 시드 기준 예시: project 13 / 활성 13 / customer 8).
```bash
MYSQL="/c/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe"
# 서비스 확인(PowerShell): Get-Service MySQL84   # Running이어야
"$MYSQL" -uroot -p --get-server-public-key taskcalendar -e "SELECT COUNT(*) AS projects FROM project;"                    # 현황(예시 13)
"$MYSQL" -uroot -p --get-server-public-key taskcalendar -e "SELECT COUNT(*) AS active FROM project WHERE is_active=1;"     # 현황(예시 13)
"$MYSQL" -uroot -p --get-server-public-key taskcalendar -e "SELECT COUNT(*) AS customers FROM customer;"                  # 현황(예시 8)
# 발주처 이름까지 보려면 조인한다(2026-10-15 부터 project 는 번호만 들고 있다):
"$MYSQL" -uroot -p --get-server-public-key taskcalendar -e "SELECT p.id, c.name AS customer, s.name AS section, t.name AS status, p.project_name FROM project p JOIN customer c ON c.customer_id=p.customer_id JOIN section_code s ON s.section_id=p.section_id LEFT JOIN status_code t ON t.status_id=p.status_id LIMIT 5;"
```
서비스가 멈춰있으면(PowerShell 관리자): `Start-Service MySQL84`.

**캘린더 트랙까지 확인하려면** 개수를 눈으로 세지 말고 게이트를 돌리세요. `deploy\init-calendar.cmd`가 표 명부, FK, 권한, 스키마 버전 행을 한 번에 대조하고 어긋나면 `exit 1`로 멈춥니다(파괴적이므로 **빈 DB나 격리 DB에서만**). 살아 있는 DB에 대해서는 [`deploy/README.md`](deploy/README.md) '검증' 절의 읽기 전용 쿼리를 쓰세요.

## 📁 파일 지도
| 파일 | 내용 |
|---|---|
| `deploy/schema-structure.sql` | **과제 트랙 DDL 정본**(옛 `schema.sql` 을 2026-10-15 에 지우고 이것 하나로 모았다. 더미 시드 없음): `customer`, `project`, `section_code`, `status_code`, 뷰 0. 코드표는 **번호 PK + `name` UNIQUE 라벨**(ADR-23), 기본 코드 행은 고정 번호로 시드(구분 2=선진행, 상태 2=종료). `is_active`=소프트삭제, 감사 컬럼. 유니크는 과제 쪽 **`uid` 하나**(이름 유니크는 ADR-21로 제거하고 소프트 경고로 대체). FK `project.customer_id→customer.customer_id` 등 `RESTRICT/RESTRICT`. |
| `deploy/migrate-2026-10-15-code-ids.sql` | **데이터가 있는 v12 DB 전용 1회 이관**(12 → 13, 코드표 번호 키). 새 DB 에는 쓰지 않는다. [`deploy/README.md`](deploy/README.md) |
| `ARCHITECTURE.md` | **배포·운영 아키텍처 결정**: 클라이언트-서버, 엔진선택(MySQL/SQLite기각), 조회캐시/편집온라인(ADR-18), **접속정보 배포 베이크**, 단일 카테고리 스토어(§4.7.4), 권한, 네트워크(고정IP), 개발→배포 흐름, ADR, 용어집. **머리말의 2026-09-02 갱신 노트를 먼저 읽을 것** |
| `ROADMAP.md` | **작업 로드맵**: 축 A(과제) P0~P8, 축 B(캘린더) C1~C5, 의존성, 게이트, 규모, 선행조건 |
| `TABLE-DESIGN.md` | 과제 표의 컬럼별 설계 판정(에이전트 기준). ADR-21, ADR-22, ADR-23(코드표 번호 키)의 근거 |
| `DESIGN_NOTES.md` | 모델 B 근거, 필드별 설계결정, Excel 추출 방향, 초기이관/재구축 전략, 향후 |
| ~~`schema-overview.html`~~ | **2026-09-02 삭제**: 스스로 "대체됨"이라 적어 둔 07-21 ENUM 시절 스냅샷. 현행 구조는 아래 `DB-SCHEMA.html`과 정본 MD |
| [`../docs/DB-SCHEMA.html`](../docs/DB-SCHEMA.html) | **현행 테이블 구조 레퍼런스**: 과제 4표 + 사용자·조직 3표(2026-08-11 추가)의 컬럼과 제약, DB가 강제하는 것 vs 앱이 지키는 것, 바꾸려면 어디를 여는가 |
| `table-design-report.html` | **현재 DB 구조 한 장 보고서이며 생성물이다.** `information_schema` 실측에서 만든다(23표 전부의 컬럼, 타입, 제약, CHECK, 권한 + 관계도 + '지킨다/하지 않는다' + 변경 이력). **손으로 고치지 마세요.** 재생성은 `TC_TEST_DB_ADMIN_PW=<root 비번> node tools/schema-report/dump-schema.mjs tools/schema-report/schema.json` 뒤에 `node tools/schema-report/build-schema-html.mjs tools/schema-report/schema.json db/table-design-report.html`. 숫자뿐 아니라 **결론 문장까지 실측에서 뽑으므로** 구조를 바꾼 라운드마다 다시 만듭니다(안 만들면 문서가 혼자 옛말을 합니다. 2026-09-09 에 실제로 그랬습니다) |
| `README.md` | (이 파일) 트랙 이어받기 진입점 |
| `CALENDAR-TABLE-DESIGN.md` | **별도 트랙인 캘린더(`cal_*`) 설계 근거와 정본.** 온라인 전용 정책(§2), 동시성 규약, 어댑터 계약 G, 권한, 로그/백업, `data.xml` 1회 이관(§8·3b) + **키 설계(§5.2 대리키 전환, §5.6 어느 표를 번호 키로 두고 어느 표를 자연키로 두는가. 2026-10-15 코드표 전환 포함)**. 컬럼 수준 DDL 의 정본은 이 문서가 아니라 `deploy/schema-calendar.sql` |
| `../docs/USER-LOGIN.md` | **로그인·권한 관문 확정 설계**: netcus 인증 위임, `app_user.edit_role` 요청 시점 판정, 세션 4필드, `view_scope`. 공용 관리자 비밀번호 폐지의 정본 |
| `deploy/README.md` | **프로비저닝 키트 사용법**: 진입점 `setup-taskcalendar`, 캘린더만 다시 세우는 `init-calendar`, 로컬 v12 DB 이관(`migrate-2026-10-15-code-ids.sql`), 배포 순서, 종료코드 + **백업(`backup-taskmgr`) 설치, 확인, 복구** |
| `sample/Dummy_Data.xlsx` | **원본 더미 엑셀**: 초기 1회 이관 픽스처. 사내 AI로 변환한 더미(롤 지명), 실 국방데이터 아님 |

## 🔜 다음 작업 (우선순위)

> 이 목록은 요약입니다. **상세, 게이트, 의존성은 [`ROADMAP.md`](ROADMAP.md), 배포까지의 조건(P1 7건)은 [`../docs/ROADMAP.md`](../docs/ROADMAP.md) §2가 정본**입니다.

1. ✅ **앱↔DB 연동(P3), Excel 추출기(P4), 권한(P6.5) 완료.** 앱이 이 DB를 원본으로 과제 등록/수정/소프트삭제(대상 행은 `uid` 기준), 구분/상태는 **코드테이블 드롭다운**, "삭제"=`is_active=0`. (상세 `ARCHITECTURE.md` §4.7)
2. **실 Excel 1회 이관**: 현재 시드는 더미(롤 지명). 실제 사업부 엑셀(2시트)에서 `customer`를 먼저(발주처 FK 타겟), 그다음 `project`를 옮긴다. **최초 1회성 마이그레이션**(이후 DB가 마스터, 재임포트 없음). 이관기 정리(발주처 표기 정규화, '미정'/공백→NULL, 선진행 상태 NULL, 섹션 헤더행→`section` 승격)는 `DESIGN_NOTES.md` §4. ⚠️ 실데이터가 더미에 없던 컬럼/케이스면 스키마 재검.
3. **서버 배포(P5·P6)**: 순서는 다음과 같다. 사내 MySQL(**8.0.16+**)에 `deploy/` 원큐로 구조 적용, **백업 설치(`backup-taskmgr.cmd -Install`)**, 실 Excel 1회 이관, `DeployConfig.cs`의 `DbHost`·`DbPassword`를 실값으로 교체해 재빌드·배포. ⚠️ 배포 전 콜레이션과 CHECK 지원 확인(게이트가 봅니다).
4. **낡은 클라이언트 쓰기 차단**: 설계 §5.5가 확정한 `schema_version` 비교가 아직 앱 코드에 없습니다. 다음 `ALTER` 순간 낡은 위젯이 그대로 씁니다.
5. **타인 일정 열람(C4)**: 데이터도 `view_scope` 판정도 이미 있습니다. 남은 것은 화면입니다.

## 🔕 이 DB 범위 밖 (참고)
- **위젯(캘린더) 표시 로직**: 위젯이 이 DB를 읽어 렌더하는 어댑터/뷰는 위젯 트랙의 관심사다. 재설계로 색상, uid 앵커, 캘린더 전용 뷰를 모두 걷어냈다(DB는 순수 데이터). 어댑터의 계약과 게이트는 [`CALENDAR-TABLE-DESIGN.md`](CALENDAR-TABLE-DESIGN.md) 계약 G와 `tests/calendar-adapter.mjs`에 있다.
- ✅ **Excel 추출기 구현됨**(v0.13.0, `widget/XlsxWriter.cs`). DB→Excel 리포트(No=`ROW_NUMBER`, 섹션 헤더=`section` 렌더, 발주처 시트 포함). 정책 방향은 `DESIGN_NOTES.md` §3.
- **사용자·조직 실데이터**: `app_user`, `org_unit`, `title_code`의 DDL과 89명 실명은 **별도 비공개 저장소**(`taskmgr-company-data`)에 있다. 이 저장소에는 **이미 서 있는 DB를 옮기는 1회용 SQL**만 둔다. 지금은 `deploy/migrate-2026-10-15-code-ids.sql`(직급 `title_code` 와 `app_user.title_id` 도 함께 옮긴다) 하나이고, 옛 `deploy/migrate-2026-08-24-*.sql` 은 2026-10-15 에 지웠다.
