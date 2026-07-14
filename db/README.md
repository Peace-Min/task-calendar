# 과제관리 DB (taskmgr) — 트랙 이어서 작업 (핸드오프)

> **다른 세션에서 이 트랙을 이어받는 법**: 이 폴더(`db/`)를 열고 이 README → `ARCHITECTURE.md`(배포·운영 아키텍처 결정) → `SETUP.md`(환경·연결·적용) → `DESIGN_NOTES.md`(스키마 설계 근거·필드결정·추출/이관) 순서로 읽으면 복구됩니다. `schema-overview.html`은 브라우저로 열면 스키마 한눈보기. 메모리 `project-taskmgr-db`도 매 세션 자동 로드됩니다.

**DB가 원본(source of truth)**인 과제관리 DB. Admin이 **캘린더 앱**으로 과제를 등록/수정(id 기준 CRUD)하고, **Excel은 DB에서 추출하는 리포트**다(양방향 동기화 없음). **로컬 MySQL에서 구축·검증 → 사내 서버 MySQL로 이관**(로컬 먼저, 네이티브 = 서버와 동일 환경). 캘린더 앱이 이 DB를 원본으로 소비한다.

> **모델 전환**: 이전 설계는 DB를 "사업부 Excel 장표의 컴팩트 미러"(Excel 원본 → DB 미러 → 멱등 재임포트)로 봤으나, 지금은 **DB가 원본, Excel은 추출 리포트**로 뒤집었다(모델 B). Excel 흔적 필드(`source_no`·`customer.no`)는 제거되고, 앱 편집용 필드(소프트삭제 `is_active`·감사 `created_at`/`updated_at`)가 추가됐다.

## ✅ 현재 상태 (2026-07-14)
- **모델 B(DB 원본) 재설계 완료 + 실 DB 검증 완료** (더미데이터 13건 기준)
- **테이블 2개**(`customer`·`project`), **뷰 0개**. `section`/`status`는 **ENUM**(드롭다운 소스). 색상·uid 앵커·룩업 테이블·2축(유형×단계)·CHECK 없음.
- 앱 편집 지원: `id`(편집 식별자) · `is_active`(소프트삭제) · `created_at`/`updated_at`(감사) · FK `ON UPDATE CASCADE`(발주처 개명 전파).
- 이전의 미러/캘린더 결합 설계는 **모델 B로 대체됨** — `schema.sql` 앞부분이 옛 객체를 DROP하고 재구축.
- MySQL **8.4.9** 네이티브 설치, Windows 서비스 **`MySQL84`**(자동시작·Running), 포트 3306, `root`/`taskmgr123`, DB `taskmgr` (utf8mb4 / utf8mb4_0900_ai_ci)

## ⚡ 빠른 복구 (새 세션에서 DB 살아있는지 확인)
```bash
MYSQL="/c/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe"
# 서비스 확인(PowerShell): Get-Service MySQL84   # Running이어야
"$MYSQL" -uroot -ptaskmgr123 --get-server-public-key taskmgr -e "SELECT COUNT(*) FROM project;"                     # 13
"$MYSQL" -uroot -ptaskmgr123 --get-server-public-key taskmgr -e "SELECT COUNT(*) FROM project WHERE is_active=1;"   # 13
"$MYSQL" -uroot -ptaskmgr123 --get-server-public-key taskmgr -e "SELECT COUNT(*) FROM customer;"                    # 8
# 스키마 재적용(= 로컬 클린 rebuild, id 1..13 리셋 — 운영 DB엔 쓰지 말 것):
"$MYSQL" -uroot -ptaskmgr123 --get-server-public-key taskmgr < db/schema.sql
```
서비스가 멈춰있으면(PowerShell 관리자): `Start-Service MySQL84`.

## 📁 파일 지도
| 파일 | 내용 |
|---|---|
| `schema.sql` | **확정 DDL + 로컬 검증용 더미 시드(13)** — 테이블 2 · 뷰 0. `section`/`status`=ENUM, `is_active`=소프트삭제, 감사 컬럼. `UNIQUE(발주처,사업명)` 업무규칙. FK `project.customer→customer.name` `ON UPDATE CASCADE`. |
| `ARCHITECTURE.md` | **배포·운영 아키텍처 결정** — 클라이언트-서버·엔진선택(MySQL/SQLite기각)·조회캐시/편집온라인·접속주소 설정화·권한(app_user)·네트워크(고정IP)·개발→배포 흐름·ADR·용어집 |
| `ROADMAP.md` | **작업 로드맵** — P0~P8 단계·의존성·게이트·규모·선행조건(실Excel/폐쇄망)·권장 진행순서 |
| `SETUP.md` | 환경·연결·적용/재적용(클린 rebuild vs 서버 실이관)·설계 모델·검증 결과 |
| `DESIGN_NOTES.md` | 모델 B 근거·필드별 설계결정·Excel 추출 방향·초기이관/재구축 전략·향후 |
| `schema-overview.html` | 오프라인·라이트/다크 단일 HTML 스키마 개요(테이블/컬럼/시드 요약) |
| `README.md` | (이 파일) 트랙 이어받기 진입점 |
| `sample/Dummy_Data.xlsx` | **원본 더미 엑셀** — 초기 1회 이관 픽스처. 사내 AI로 변환한 더미(롤 지명), 실 국방데이터 아님 |

## 🔜 다음 작업 (우선순위)
1. **캘린더 앱 Admin CRUD 연동** — 앱이 이 DB를 원본으로 과제 등록/수정/소프트삭제(id 기준). `section`/`status`는 앱에서 ENUM 값을 드롭다운으로 노출. "삭제"=`is_active=0`.
2. **실 Excel 1회 이관** — 현재 시드는 더미(롤 지명). 실제 사업부 엑셀(2시트) → `customer` 먼저(발주처 FK 타겟) → `project`. **최초 1회성 마이그레이션**(이후 DB가 마스터, 재임포트 없음). 이관기 정리(발주처 표기 정규화·'미정'/공백→NULL·선진행 상태 NULL·섹션 헤더행→`section` 승격)는 `DESIGN_NOTES.md` §4. ⚠️ 실데이터가 더미에 없던 컬럼/케이스면 스키마 재검.
3. **서버 배포** — 동일 `schema.sql`(DDL)을 사내 MySQL(**8.0.16+**)에 적용 후, 더미 대신 실 Excel 1회 이관. ⚠️ 배포 전 MySQL 8.0+ 콜레이션 확인.

## 🔕 이 DB 범위 밖 (참고)
- **위젯(캘린더) 표시 로직** — 위젯이 이 DB를 읽어 렌더하는 어댑터/뷰는 위젯 트랙의 관심사. 재설계로 색상·uid 앵커·캘린더 전용 뷰를 모두 걷어냈다(DB는 순수 데이터). Admin CRUD 연동(위 1번)과 표시 어댑터를 앱 쪽에서 설계한다.
- **Excel 추출기** — DB→Excel 리포트 생성기(No=ROW_NUMBER, 섹션 헤더=section 렌더)는 별도 도구로 만든다. 방향은 `DESIGN_NOTES.md` §3.
