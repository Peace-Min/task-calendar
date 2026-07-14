# 과제관리 DB (taskmgr) — 로컬 구축 메모

**DB가 원본(source of truth)**인 과제관리 DB. Admin이 캘린더 앱으로 과제를 등록/수정하고, Excel은 DB에서 추출하는 리포트(양방향 동기화 없음). 로컬 MySQL에서 구축·검증 → 동일 DDL을 사내 서버 MySQL에 올린다. 캘린더 앱이 이 DB를 원본으로 소비한다.

## 환경 (이 PC)
- **MySQL 8.4.9 Community** — winget `Oracle.MySQL`로 설치
- Windows 서비스 **`MySQL84`** (자동 시작, 현재 Running), 포트 **3306**
- 접속: `root` / `taskmgr123`, 기본 DB `taskmgr` (charset utf8mb4 / collation utf8mb4_0900_ai_ci)
- 바이너리: `C:\Program Files\MySQL\MySQL Server 8.4\bin`
- 데이터: `C:\ProgramData\MySQL\MySQL Server 8.4\Data`, 설정 `...\my.ini`

## 스키마 적용 / 재적용
```bat
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -uroot -ptaskmgr123 --get-server-public-key taskmgr < schema.sql
```
- `schema.sql`은 **테이블 2**(`customer`·`project`) + **뷰 0** + 로컬 검증용 더미 시드 13건. 룩업 테이블·캘린더 뷰 없음.
- **DROP = 클린 재구축**: `schema.sql` 앞부분에 `DROP`(옛 미러/캘린더 결합 잔재 + 현재 테이블)이 있어 **통째 실행하면 깨끗한 재구축**이다 → `id`가 1..13으로 리셋된다(재구축 자체는 몇 번 돌려도 같은 결과라 멱등). 로컬 리셋 전용.
- **⚠️ 운영 DB에는 DROP 재구축을 돌리지 않는다** — DB가 원본이므로 데이터가 날아간다. 운영 변경은 앱의 CRUD(또는 DB 직접 편집)로 한다.
- **서버 초기 배포**: 더미 시드 대신 **실제 사업부 Excel을 최초 1회 이관**해 채운다(이후 DB가 마스터, 재임포트 없음). 상세는 `DESIGN_NOTES.md` §4.
- 완전 초기화(로컬): `DROP DATABASE taskmgr; CREATE DATABASE taskmgr CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;` 후 재적용.

## 설계 모델 (DB 원본)
- **DB가 원본** — 앱 Admin이 id 기준 CRUD로 과제를 관리. Excel은 DB에서 추출하는 단방향 리포트.
- **`customer`** = 발주처 마스터. `name VARCHAR(100)` = **자연키 PK**(FK 타겟). `is_active` 소프트삭제 + 감사(`created_at`/`updated_at`). ※ Excel 흔적 `no` 컬럼 제거됨.
- **`project`** = 과제 마스터. `id`(앱 편집 식별자, AUTO_INCREMENT PK) + `section`/`status`(**ENUM** 드롭다운 소스) + `customer`(FK) + `project_name`/`contract_name`/`common_name` + `start_date`/`end_date` + `is_active` + 감사. ※ Excel 흔적 `source_no` 제거됨.
- **`section`/`status` = ENUM**: 드롭다운으로 오타·공백 변종 차단(DB가 목록 강제). 값 추가는 `ALTER`(드묾).
- **`is_active` 소프트삭제**: 앱 "삭제" = `is_active=0`(숨김·복구가능·이력보존). 영구삭제는 DB에서 직접 `DELETE`. 조회는 보통 `WHERE is_active=1`.
- **감사 컬럼**: `created_at`/`updated_at`(DATETIME(3)), `updated_at`은 `ON UPDATE` 자동 갱신.
- **FK `project.customer → customer.name` `ON UPDATE CASCADE`**: 발주처 개명 자동 전파, 삭제는 RESTRICT. 그래서 `customer`를 먼저 적재.
- **`UNIQUE(customer, project_name)`**: 같은 발주처 내 동일 사업명 금지(업무 규칙).
- 선진행(계약 前)은 `start_date`/`end_date`/`status` 모두 NULL.

## 검증됨 (MySQL 8.4.9, 초기 시드 적용 후)
- 행수 **project 13 / 활성(is_active=1) 13**. 섹션 분포: **일반계약 8 · 선진행 2 · 사업부관리 3**.
- 선진행 2건: `start_date`/`end_date`/`status` 모두 **NULL**.
- **ENUM 강제**: 잘못된 `status`('보류')·`section`('기타') 삽입 시도 → `ERROR 1265 (01000) Data truncated`로 거부.
- **소프트삭제**: 한 행 `is_active=0` 처리 시 활성 12 / 전체 13 (DB엔 남아있음, 복구 가능).
- **FK ON UPDATE CASCADE**: 발주처 `데마시아`→`데마시아_개명` 시 참조하던 project **5건 자동 전파**.
- **updated_at 자동 갱신**: UPDATE된 행만 `updated_at` 갱신(`created_at`≠`updated_at`), 나머지 행은 유지.
- 한글 무결성(utf8mb4).

## 남은 작업 (상세는 README.md · DESIGN_NOTES.md)
- **실 Excel 1회 이관**: 실제 사업부 엑셀(2시트) → `customer` 먼저 → `project`. 이관 스크립트의 1회성 정리(발주처 표기 정규화, '미정'/공백→NULL, 선진행 상태 공백→NULL, 섹션 헤더행→`section` 승격)는 `DESIGN_NOTES.md` §4. ⚠️ 실데이터가 더미에 없던 컬럼/케이스면 스키마 재검(현 확정은 샘플 구조 기준).
- **서버 이관**: 동일 `schema.sql`(DDL)을 사내 MySQL(**8.0.16+**)에 적용 후, 더미 대신 실 Excel 1회 이관. ⚠️ **서버 배포 전 MySQL 8.0+ 콜레이션(`utf8mb4_0900_ai_ci`) 지원 확인** — 8.0 미만 서버면 콜레이션이 없어 DDL이 실패한다.
- **캘린더 앱 Admin CRUD 연동**: 앱이 이 DB를 원본으로 등록/수정/소프트삭제(by id).
