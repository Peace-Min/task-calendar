# 과제관리 DB (taskmgr) — 로컬 구축 메모

수행과제 캘린더의 **과제(category) 소스** DB. 로컬 MySQL에서 구축·검증 → 동일 DDL을 사내 서버 MySQL에 올린다.

## 환경 (이 PC, 2026-07-13 구축)
- **MySQL 8.4.9 Community** — winget `Oracle.MySQL`로 설치
- Windows 서비스 **`MySQL84`** (자동 시작), 포트 **3306**
- 접속: `root` / `taskmgr123`, 기본 DB `taskmgr` (charset utf8mb4 / collation utf8mb4_0900_ai_ci)
- 바이너리: `C:\Program Files\MySQL\MySQL Server 8.4\bin`
- 데이터: `C:\ProgramData\MySQL\MySQL Server 8.4\Data`, 설정 `...\my.ini`

## 스키마 적용 / 재적용 (멱등)
```bat
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -uroot -ptaskmgr123 --get-server-public-key taskmgr < schema.sql
```
- `schema.sql`은 테이블 4(customer·project_type·project_status·project) + 뷰 3(v_calendar_category·v_project_label·v_project_full) + 시드 13건(더미).
- 시드는 `ON DUPLICATE KEY UPDATE`라 **재적재해도 안전**. `uid`/`source_key`는 갱신 제외(assign-once) → categoryId 앵커·id 불변.
- 완전 초기화: `DROP DATABASE taskmgr; CREATE DATABASE taskmgr CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;` 후 재적용.

## 설계 핵심 (2축 직교)
- **유형**(`type_code`): `GENERAL`(일반 계약) / `DIVISION`(사업부 관리). 선진행은 유형 미확정=NULL.
- **단계**(`lifecycle_stage`): `pre_contract`(선진행=계약前) / `contracted`(계약체결).
- 계약 사실(시작/종료/상태)은 project 인라인 nullable + `chk_project_stage` CHECK로 **단계 불변식 강제**(플래그 아님).
- **`uid = CONCAT('prj_', LEFT(SHA2(발주처||0x1F||사업명, 256), 16))`** — 결정론적. 로컬/서버가 같은 바이트열을 해시하면 **같은 categoryId로 자동 수렴**(동기화 안전).
- 룩업 PK = code(문자) → auto_increment id의 로컬/서버 상이 문제 원천 차단.

## 검증됨 (2026-07-13, MySQL 8.4.9)
- 행수 customer 8 / type 2 / status 5 / project 13
- `v_project_full` 13행 = 원본 시트 3섹션(일반8 + 선진행2 + 사업부3) 왕복 복원, 선진행 status='선진행'·날짜 NULL
- `uid = SHA2(...)` 재계산과 **완전 일치**(sha_match=1)
- CHECK 제약 동작(선진행+날짜 삽입 → `chk_project_stage` 거부)
- 한글 무결성(utf8mb4, 데마시아 4자=12바이트)

## 남은 작업 (상세는 README.md·DESIGN_NOTES.md)
- **실데이터 ETL**: 실제 사업부 엑셀(2시트) → `source_key=발주처+US+사업명` 기준 멱등 UPSERT 스크립트 작성(아직 없음 — 현재 시드는 schema.sql 내 더미). 절차·엣지케이스는 `DESIGN_NOTES.md` §3·§4.
- **캘린더 연동**: 위젯이 `v_calendar_category`(피커)·`v_project_label`(과거 라벨해석) 2계약 소비. 어댑터 설계는 `DESIGN_NOTES.md` §2.
- **서버 배포**: 동일 `schema.sql`을 사내 MySQL(8.0.16+)에 적용. 결정론 uid로 로컬↔서버 category 수렴.
