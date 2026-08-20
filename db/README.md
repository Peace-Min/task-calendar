# 과제관리 DB (taskmgr) — 트랙 이어서 작업 (핸드오프)

> **다른 세션에서 이 트랙을 이어받는 법**: 이 폴더(`db/`)를 열고 이 README → `ARCHITECTURE.md`(배포·운영 아키텍처 결정) → `SETUP.md`(환경·연결·적용) → `DESIGN_NOTES.md`(스키마 설계 근거·필드결정·추출/이관) 순서로 읽으면 복구됩니다. `schema-overview.html`은 브라우저로 열면 스키마 한눈보기. 메모리 `project-taskmgr-db`도 매 세션 자동 로드됩니다.

**DB가 원본(source of truth)**인 과제관리 DB. Admin이 **캘린더 앱**으로 과제를 등록/수정(대상 행 `uid` 기준 CRUD)하고, **Excel은 DB에서 추출하는 리포트**다(양방향 동기화 없음). **로컬 MySQL에서 구축·검증 → 사내 서버 MySQL로 이관**(로컬 먼저, 네이티브 = 서버와 동일 환경). 캘린더 앱이 이 DB를 원본으로 소비한다.

> **모델 전환**: 이전 설계는 DB를 "사업부 Excel 장표의 컴팩트 미러"(Excel 원본 → DB 미러 → 멱등 재임포트)로 봤으나, 지금은 **DB가 원본, Excel은 추출 리포트**로 뒤집었다(모델 B). Excel 흔적 필드(`source_no`·`customer.no`)는 제거되고, 앱 편집용 필드(소프트삭제 `is_active`·감사 `created_at`/`updated_at`)가 추가됐다.

> **캘린더 트랙이 생겼습니다(2026-08).** 이 README 가 다루는 것은 **과제 데이터**(`project`·`customer`)입니다. 같은 `taskmgr` DB 안에 **개인 일정·할 일**을 담는 `cal_*` 트랙이 별도로 설계·구축됐고, 설계 근거는 [`CALENDAR-TABLE-DESIGN.md`](CALENDAR-TABLE-DESIGN.md), 구축 절차·배포 순서·종료코드는 [`deploy/README.md`](deploy/README.md) 에 있습니다.
> ⚠️ **두 트랙은 앱 계정 권한 정책이 다릅니다** — 과제 표는 소프트삭제(`is_active`)라 `DELETE` 를 주지 않지만, `cal_*` 는 **소프트삭제가 없어 삭제가 곧 정상 동작이라** 의도적으로 `DELETE` 를 줍니다(안 주면 앱의 삭제 UI 가 전부 `ERROR 1142`). 한쪽 문서를 다른 쪽 근거로 쓰지 마세요.
> · **2026-08-11 정정**: 이 줄은 그 부여를 *"(감사 트리거로 상쇄)"* 라고 적고 있었습니다. **감사 트리거는 폐기됐습니다**(`CALENDAR-TABLE-DESIGN.md` §7.5 — 휴지통이 감사 대상과 같은 DB 안이라 서버 장애에 무력했고, 표준 복구 경로는 덤프 + binlog 입니다). 위험을 실제로 상쇄하는 것은 **주간 mysqldump + binlog 30일** 이고, 그 실행체가 `deploy/backup-taskmgr` 입니다(설계 §9).
> · **백업은 `taskmgr` DB 전체가 대상입니다** — 캘린더 트랙에서 만들었지만 과제 표도 함께 받습니다. 서버 이관·신규 구축 뒤에는 `deploy/backup-taskmgr.cmd -Install` 을 잊지 마세요(구조 스크립트에 딸려 오지 않습니다).

## ✅ 현재 상태 (2026-07-21)
- **모델 B(DB 원본) 재설계 완료 + 실 DB 검증 완료** (더미데이터 13건 기준)
- **P3 앱↔DB 연동 완료(localhost)**: 위젯이 이 DB를 읽기·캐시(오프라인)·관리자 CRUD(온라인)로 소비. 공식 과제 카탈로그 화면·재연결 도구·단일 카테고리 스토어 구현. 인증은 JIT 프롬프트 스텁(P6.5에서 netcus 위임으로 교체 예정). 상세 `ARCHITECTURE.md` §4.7.
- **과제 테이블 2개**(`customer`·`project`) + 코드테이블 2개(`section_code`·`status_code`), **뷰 0개**.
  ※ `taskmgr` 전체는 **19개 표**다 — 위 4개 + 사용자·조직 3개(`app_user`·`org_unit`·`title_code`, 별도 비공개 저장소에서 구축) + 개인 일정 12개(`cal_*`, 2026-08-11 구축). 이 README 는 **과제 트랙**만 다룬다. `section`/`status`는 **ENUM**(드롭다운 소스). 옛 설계의 색상·**결정론적 uid 앵커(캘린더 결합)**·룩업 테이블·2축(유형×단계)·CHECK는 없음. ※ 단, P3에서 **외부 안정 참조키 `project.uid`(UUID assign-once)**를 추가했다(옛 캘린더 결합 앵커와 다른, 일정이 `db-<uid>`로 참조하는 순수 참조키) — schema.sql 반영 완료.
- 앱 편집 지원: `id`(편집 식별자) · `is_active`(소프트삭제) · `created_at`/`updated_at`(감사) · FK `ON UPDATE CASCADE`(발주처 개명 전파).
- 이전의 미러/캘린더 결합 설계는 **모델 B로 대체됨** — `schema.sql` 앞부분이 옛 객체를 DROP하고 재구축.
- MySQL **8.4.9** 네이티브 설치, Windows 서비스 **`MySQL84`**(자동시작·Running), 포트 3306, `root`/`taskmgr123`, DB `taskmgr` (utf8mb4 / utf8mb4_0900_ai_ci)

## ⚡ 빠른 복구 (새 세션에서 DB 살아있는지 확인)
DB는 앱 CRUD로 계속 변하는 **살아있는 데이터**다 — 아래 건수는 고정값이 아니라 **현황 조회**다(더미 초기 시드 기준 예시: project 13 / 활성 13 / customer 8).
```bash
MYSQL="/c/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe"
# 서비스 확인(PowerShell): Get-Service MySQL84   # Running이어야
"$MYSQL" -uroot -ptaskmgr123 --get-server-public-key taskmgr -e "SELECT COUNT(*) AS projects FROM project;"                    # 현황(예시 13)
"$MYSQL" -uroot -ptaskmgr123 --get-server-public-key taskmgr -e "SELECT COUNT(*) AS active FROM project WHERE is_active=1;"     # 현황(예시 13)
"$MYSQL" -uroot -ptaskmgr123 --get-server-public-key taskmgr -e "SELECT COUNT(*) AS customers FROM customer;"                  # 현황(예시 8)
```
서비스가 멈춰있으면(PowerShell 관리자): `Start-Service MySQL84`.

> ⛔ **`schema.sql` 통째 재적용은 파괴적이다 — 초기 구축 전용, 운영·사용 중 DB엔 절대 금지.**
> `schema.sql` 앞부분이 테이블을 **`DROP` → 전 데이터 삭제**하고, 재생성 시 `project.uid`(UUID)가 **전부 새로 만들어진다**. 그러면 위젯에 `db-<uid>`로 태그된 일정·할일이 **전부 고아화**(참조가 끊겨 라벨이 `(공식 과제)` 플레이스홀더로 떨어짐)된다. 로컬 클린 리셋(초기 구축·개발)에서만 쓸 것:
> ```bash
> # ⚠️ 로컬 초기 구축/리셋 전용 (모든 데이터·uid 소실):
> "$MYSQL" -uroot -ptaskmgr123 --get-server-public-key taskmgr < db/schema.sql
> ```
> 운영 DB의 데이터 변경은 **앱의 CRUD(또는 DB 직접 편집)**로만 한다.

## 📁 파일 지도
| 파일 | 내용 |
|---|---|
| `schema.sql` | **확정 DDL + 로컬 검증용 더미 시드(13)** — 테이블 2 · 뷰 0. `section`/`status`=ENUM, `is_active`=소프트삭제, 감사 컬럼. `UNIQUE(발주처,사업명)` 업무규칙. FK `project.customer→customer.name` `ON UPDATE CASCADE`. |
| `ARCHITECTURE.md` | **배포·운영 아키텍처 결정** — 클라이언트-서버·엔진선택(MySQL/SQLite기각)·조회캐시/편집온라인·**접속정보 배포 베이크**·단일 카테고리 스토어(§4.7.4)·JIT 인증·권한(app_user)·네트워크(고정IP)·개발→배포 흐름·ADR·용어집 |
| `ROADMAP.md` | **작업 로드맵** — P0~P8 단계·의존성·게이트·규모·선행조건(실Excel/폐쇄망)·권장 진행순서 |
| `SETUP.md` | 환경·연결·적용/재적용(클린 rebuild vs 서버 실이관)·설계 모델·검증 결과 |
| `DESIGN_NOTES.md` | 모델 B 근거·필드별 설계결정·Excel 추출 방향·초기이관/재구축 전략·향후 |
| `schema-overview.html` | ⚠️ **낡음(2026-07-21, ENUM 시절)** — 현행 구조는 [`docs/DB-SCHEMA.html`](../docs/DB-SCHEMA.html) |
| [`../docs/DB-SCHEMA.html`](../docs/DB-SCHEMA.html) | **현행 테이블 구조 레퍼런스** — 과제 4표 + 사용자·조직 3표(2026-08-11 추가)의 컬럼·제약, DB가 강제하는 것 vs 앱이 지키는 것, 바꾸려면 어디를 여는가 |
| `README.md` | (이 파일) 트랙 이어받기 진입점 |
| `CALENDAR-TABLE-DESIGN.md` | **별도 트랙 — 캘린더(`cal_*`) 설계 근거.** 온라인 전용 정책·동시성 규약·권한·로그/백업·`data.xml` 1회 이관. 컬럼 수준 DDL 의 정본은 이 문서가 아니라 `deploy/schema-calendar.sql` |
| `deploy/README.md` | **프로비저닝 키트 사용법** — 과제(`init-db`)·캘린더(`init-calendar`) 두 트랙의 실행법·배포 순서·종료코드 + **백업(`backup-taskmgr`) 설치·확인·복구** |
| `sample/Dummy_Data.xlsx` | **원본 더미 엑셀** — 초기 1회 이관 픽스처. 사내 AI로 변환한 더미(롤 지명), 실 국방데이터 아님 |

## 🔜 다음 작업 (우선순위)
1. ✅ **캘린더 앱 Admin CRUD 연동 — 완료(P3)**. 앱이 이 DB를 원본으로 과제 등록/수정/소프트삭제(대상 행은 `uid` 기준). `section`/`status`는 ENUM 드롭다운, "삭제"=`is_active=0`. (상세 `ARCHITECTURE.md` §4.7)
2. **Excel 추출기(P4) + 보고서 정책** — DB→Excel(No=ROW_NUMBER, section 헤더), 입력 관대/출력 엄격(참조 기준 집계, 비공식=기타). `DESIGN_NOTES.md` §3.
3. **실 Excel 1회 이관** — 현재 시드는 더미(롤 지명). 실제 사업부 엑셀(2시트) → `customer` 먼저(발주처 FK 타겟) → `project`. **최초 1회성 마이그레이션**(이후 DB가 마스터, 재임포트 없음). 이관기 정리(발주처 표기 정규화·'미정'/공백→NULL·선진행 상태 NULL·섹션 헤더행→`section` 승격)는 `DESIGN_NOTES.md` §4. ⚠️ 실데이터가 더미에 없던 컬럼/케이스면 스키마 재검.
4. **권한·보안 확정(P6.5)** — JIT 스텁 → `app_user` + netcus 인증 위임 + 앱용 최소권한 DB 계정. `ProjectDb.cs` 배포 구성의 root 개발값 교체.
5. **서버 배포(P6)** — 동일 `schema.sql`(DDL)을 사내 MySQL(**8.0.16+**)에 적용 후, 더미 대신 실 Excel 1회 이관. ⚠️ 배포 전 MySQL 8.0+ 콜레이션 확인.

## 🔕 이 DB 범위 밖 (참고)
- **위젯(캘린더) 표시 로직** — 위젯이 이 DB를 읽어 렌더하는 어댑터/뷰는 위젯 트랙의 관심사. 재설계로 색상·uid 앵커·캘린더 전용 뷰를 모두 걷어냈다(DB는 순수 데이터). Admin CRUD 연동(위 1번)과 표시 어댑터를 앱 쪽에서 설계한다.
- **Excel 추출기** — DB→Excel 리포트 생성기(No=ROW_NUMBER, 섹션 헤더=section 렌더)는 별도 도구로 만든다. 방향은 `DESIGN_NOTES.md` §3.
