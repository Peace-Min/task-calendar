# 과제관리 DB (taskmgr) — 트랙 이어서 작업 (핸드오프)

> **다른 세션에서 이 트랙을 이어받는 법**: 이 폴더(`db/`)를 열고 이 README → `SETUP.md`(환경·연결) → `DESIGN_NOTES.md`(설계 근거·적대검증·남은 결정) 순서로 읽으면 복구됩니다. 메모리 `project-taskmgr-db`도 매 세션 자동 로드됩니다.

수행과제 캘린더의 **과제(category) 소스** DB. 사업부 관리 엑셀(2시트) 기반. **로컬 MySQL에서 구축·검증 → 사내 서버 MySQL로 이관**(로컬 먼저, 네이티브 = 서버와 동일 환경).

## ✅ 현재 상태 (2026-07-13)
- **설계 확정 + 실 DB 왕복 검증 완료** (더미데이터 13건 기준)
- MySQL **8.4.9** 네이티브 설치, Windows 서비스 **`MySQL84`**(자동시작), 포트 3306, `root`/`taskmgr123`, DB `taskmgr`
- 초기 설계의 3렌즈 **적대검증 major 지적이 최종 `schema.sql`에 이미 반영됨**(자연키·콜론없는 uid·라벨해석 뷰·common_name NULL·lifecycle_stage) — `DESIGN_NOTES.md` 반영표 참조

## ⚡ 빠른 복구 (새 세션에서 DB 살아있는지 확인)
```bash
MYSQL="/c/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe"
# 서비스 확인(PowerShell): Get-Service MySQL84   # Running이어야
"$MYSQL" -uroot -ptaskmgr123 --get-server-public-key taskmgr -e "SELECT COUNT(*) FROM project;"   # 13
# 스키마 재적용(멱등):
"$MYSQL" -uroot -ptaskmgr123 --get-server-public-key taskmgr < db/schema.sql
```
서비스가 멈춰있으면(PowerShell 관리자): `Start-Service MySQL84`.

## 📁 파일 지도
| 파일 | 내용 |
|---|---|
| `schema.sql` | **확정 DDL + 시드(더미13)** — 테이블4·뷰3. 멱등(ON DUPLICATE), uid/source_key assign-once |
| `SETUP.md` | 환경·연결·적용/재적용·설계 요약·검증 결과 |
| `DESIGN_NOTES.md` | 설계 워크플로 산출물: 캘린더 매핑·ETL 절차·엣지케이스·open question + **3렌즈 적대검증 & 최종본 반영표** |
| `README.md` | (이 파일) 트랙 이어받기 진입점 |

## 🔜 다음 작업 (우선순위)
1. **실데이터 ETL** — 현재 시드는 더미(롤 지명). 실제 사업부 엑셀(2시트) → `source_key=발주처+US+사업명` 기준 **멱등 UPSERT** 스크립트 작성(Python 권장). 절차·엣지케이스는 `DESIGN_NOTES.md`에 상세. ⚠️ **실데이터가 더미에 없던 컬럼/케이스면 스키마 재검**(지금 확정은 샘플 구조 기준).
2. **캘린더 연동** — 위젯이 `v_calendar_category`(피커)·`v_project_label`(과거 categoryId 라벨해석) 2계약을 읽는 **어댑터** 설계. 오프라인 WPF라 읽기 경로(호스트 경유/캐시) 결정. → **task-calendar `feat/db-integration` 브랜치** 권장(main의 피드백 작업과 분리).
3. **서버 이관** — 동일 `schema.sql`을 사내 MySQL(**8.0.16+ 필수**, CHECK 강제)에 적용. 결정론 uid로 로컬↔서버 category 수렴. 서버 authoritative, 로컬 미러 권장.

## ⚠️ 아직 열린 결정 (착수 전 확인)
- **DB 목적 범위**: 좁게(캘린더 과제 소스, 지금 수준 충분) vs 넓게(사업부 종합 과제관리 = 계약·담당자·공수·이력 추가 설계). → 현재 스키마는 **좁은 범위 확정본**.
- **종료(CLOSED) 과제 피커 노출**: `v_calendar_category`는 is_active=1 전량 노출, 숨기려면 `WHERE is_terminal=0`. 정책 미확정(조회 시점 선택).
- 그 외 open question은 대부분 최종본에서 해소됨 — `DESIGN_NOTES.md` 참조.
