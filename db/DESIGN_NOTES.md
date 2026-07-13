# 설계 노트 — 과제관리 DB (근거·ETL·엣지케이스·적대검증)

> 출처: DB 설계 워크플로 산출물(초기 설계 + 3렌즈 적대검증)을 세션 소실 전 추출. **초기 설계의 명명은 최종 `schema.sql`과 다르다**(적대검증 major 지적을 반영해 개정됨). 아래 §0 명명 매핑·§1 반영표로 대조할 것.

## §0 명명 매핑 (초기 설계 → 최종 schema.sql)
| 초기 설계 | 최종본 | 비고 |
|---|---|---|
| `project_id`(auto) | `id`(내부) + **`uid`**(SHA2 앵커) | 캘린더 categoryId = uid |
| `'srv:'+project_id`(콜론) | `uid='prj_'+SHA2(...)`, REGEXP CHECK | **콜론 폐기**(import 검증기 통과) |
| (없음) | **`source_key` UNIQUE** = 발주처+US(0x1F)+사업명 | 멱등 upsert 키 |
| `v_selectable_project` | `v_calendar_category` | 피커(is_active=1) |
| (없음) | **`v_project_label`** | 과거 categoryId 라벨해석(필터 없음) |
| `task_status`/`status_id` | `project_status`/`status_code`(code PK) | |
| `is_selectable`/`is_preliminary`(위치) | `is_active`+`is_terminal` / **`lifecycle_stage` ENUM**(값기반+CHECK) | |
| `common_name NOT NULL` | `common_name NULL` | 폴백 COALESCE |

## §1 적대검증 major → 최종본 반영 현황
초기 설계에 3렌즈(MySQL 프로덕션 / 캘린더 연동 / 정규화)가 낸 **major 4건이 모두 최종 schema.sql에서 해소**됨:
| 적대검증 MAJOR | 최종본 반영 |
|---|---|
| project에 멱등 upsert용 자연키 없음 → 재적재 중복 | **`source_key VARCHAR(255) UNIQUE`** + `uid` UNIQUE + `ON DUPLICATE KEY UPDATE`(uid/source_key는 assign-once) ✅ |
| `'srv:'+id` 콜론이 캘린더 import 검증기(`^[A-Za-z0-9_-]{1,80}$`)와 충돌 → 왕복 시 브리지 끊김 | **uid=`prj_`+SHA2, `chk_project_uid` REGEXP** 동일 규칙 이중방어(콜론 원천차단) ✅ |
| 선택뷰만으로 종료/삭제 과제 라벨 해석 불가 | **`v_project_label`**(필터 없이 전량, is_active 무관 앵커 영구해석) 추가 ✅ |
| `common_name NOT NULL`이 초기단계(선진행) 적재 파손 | **`common_name NULL`** + 뷰 `COALESCE(common_name, project_name)` 폴백 ✅ |

minor/nit(뷰 ORDER BY 의존, is_active 죽은 플래그, CHECK 8.0.16 의존, 콜레이션 등)은 13건 규모에서 비차단. 서버 이관 시 **8.0.16+ 전제**만 명문화(§4).

## §2 캘린더 매핑 (어댑터 계약)
- 캘린더 로컬 category 모델 `{id, name, color, desc, gitRepo, vcs, createdAt}`. 이벤트/할일은 `categoryId`로 참조.
- **id ← `uid`**(결정론 앵커) · **name ← 통상명칭(COALESCE 사업명)** · color ← calendar_color(폴백 유형색).
- `gitRepo/vcs/color`는 **로컬 전용**(DB 미보유) — 어댑터가 uid별 로컬 보존. 서버 스키마 불변 유지.
- **2계약**: 피커 = `v_calendar_category`(활성만) / 과거 categoryId 라벨복원 = `v_project_label`(전량). 위젯은 뷰만 읽어 스키마 변화에서 격리.
- 로컬→서버 무중단: 동일 DDL, 어댑터는 커넥션만 스왑. 서버 authoritative + 로컬 미러(uid 결정론이라 id 충돌 없음).

## §3 실데이터 ETL 절차 (엑셀 2시트 → schema)
1. **발주처**: View_Customer 8건 → `customer` upsert(`ON DUPLICATE KEY UPDATE`, uq_customer_name). No 컬럼 무시.
2. **상태**: `project_status` 시드 이미 존재. 확장 상태 발견 시 행 INSERT(예: DELIVERED_2)만으로 무중단.
3. **과제**: View_Projects 위→아래 순회
   - `source_key = 발주처 + CHAR(31) + 사업명`, `uid = 'prj_'+LEFT(SHA2(source_key,256),16)` — **ETL(파이썬)과 SQL이 같은 바이트열 해시 → 동일 uid 수렴**.
   - 발주처명으로 customer_id 조회. 상태문자열→status_code 매핑('종료/진행중/1차 납품완료/미정').
   - 계약시작/종료: '미정'/공백 → NULL, 아니면 `STR_TO_DATE(v,'%Y-%m-%d')`.
   - **선진행 판정은 위치가 아니라 값으로**(계약시작/종료='미정' AND 상태 공백) → `lifecycle_stage='pre_contract'`, type/날짜/status NULL. 구분행('선진행 사업'만 있는 경계행)은 스킵.
   - `INSERT ... ON DUPLICATE KEY UPDATE`(source_key/uid 제외) = 멱등.
4. **검증**: COUNT(project)=실건수(구분행 제외), 발주처 FK 전건 매칭, contract_end>=start, uid=SHA2 재계산 일치.

## §4 엣지케이스 (ETL 규칙)
- **미정 날짜**: 정상문자열 DATE 파싱, '미정'/공백 → NULL(캘린더 '기간 미정' 렌더).
- **구분행**('선진행 사업'만, No/발주처 공백): 데이터 아님 → 스킵. 선진행 여부는 각 행 값으로 결정론 판정(위치 의존 금지).
- **선진행 과제(No 9,10)**: 발주처 있음+날짜 '미정'+상태 공백 → pre_contract, 날짜/상태/유형 NULL.
- **상태 공백 vs '미정'**: 최종본은 **선진행=lifecycle_stage로 구분**(status='미정'(TBD)와 혼동 안 함). '미정'(TBD)은 계약체결+상태미정.
- **상태 확장**('2차 납품완료'): `project_status` INSERT만, 스키마 변경 불필요.
- **종료 과제**: 하드삭제 금지. is_terminal 상태는 `v_calendar_category`에서 `WHERE is_terminal=0`로 숨김 선택. 과거 참조는 `v_project_label`로 항상 해석.
- **발주처 미정 과제**가 미래 생기면: NULL 허용보다 '미정' 발주처 마스터 1행 두기 권장(조인 단순).
- **통상명칭 없음**: common_name NULL 허용 → 뷰 COALESCE(common_name, project_name) 폴백. 빈문자열 적재 금지.

## §5 남은 열린 결정 (대부분 최종본 해소, 잔여만)
- ✅ 자연키 → `source_key`(발주처+사업명) 확정 · ✅ 채번 → 결정론 uid(로컬/서버 수렴) 확정 · ✅ 선진행 표현 → lifecycle_stage 확정 · ✅ 위젯전용 속성(color/git) → 로컬소유 확정 · ✅ 사업:계약 → 현재 1:1 인라인(향후 1:N이면 계약 분리 테이블).
- ⬜ **종료 과제 피커 노출 정책**(조회 시점 `is_terminal` 필터 여부) — 미확정.
- ⬜ **납품 단계 이력화**: 현재 status 스칼라. 1차+2차 병존/이력 필요해지면 `delivery_phase` 자식테이블로 승격(지금은 불필요).
- ⬜ **DB 목적 범위**: 좁게(과제 소스) vs 넓게(종합 과제관리). 넓게면 계약/담당자/공수/이력 엔티티 추가 설계 필요.
- ⬜ **실데이터 재검**: 확정은 더미(2시트·13행) 기준. 실제 엑셀에 없던 컬럼/케이스면 스키마 조정.
