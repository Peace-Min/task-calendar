# DB 프로비저닝 키트 (taskmgr)

MySQL 서버에 **DB 구조(테이블) + 앱 계정**을 만드는 도구. **지금(개인 PC 임시)·나중(서버 이관) 모두 같은 스크립트**로 실행 → 동일 구조가 재현됩니다. 데이터는 이 키트가 만들지 않습니다(구조/권한만).

**이 폴더에는 서로 독립적인 트랙 둘**이 들어 있습니다. 같은 `taskmgr` DB 를 대상으로 하지만 다루는 테이블도, 앱 계정에 주는 권한도 다릅니다. **한쪽 문서를 다른 쪽 근거로 쓰지 마세요.**

- **과제 트랙** — `project`·`customer` 등. 진입점 `init-db.cmd`. 설계는 [`../TABLE-DESIGN.md`](../TABLE-DESIGN.md)
- **캘린더 트랙** — `cal_*`(개인 일정·할 일·공수). 진입점 `init-calendar.cmd`. 설계는 [`../CALENDAR-TABLE-DESIGN.md`](../CALENDAR-TABLE-DESIGN.md)

## 구성 — 과제 트랙

| 파일 | 역할 |
|---|---|
| `init-db.cmd` / `init-db.ps1` | **원큐**: `CREATE DATABASE` + 테이블 구조 + 앱 계정(최소권한) |
| `schema-structure.sql` | 구조 전용 DDL(customer/project). 시드 없음 |
| `create-app-user.sql` | 앱 계정 수동 생성용(참고). init-db가 자동으로도 함 |
| `load-template.sql` | **내부망 LLM용** 데이터 INSERT 템플릿 + 규칙 |
| `migrate.cmd` / `migrate.ps1` | **기존 데이터 DB 마이그레이션(재실행 안전·무손실)**: 단계1 이름 유니크 제거+`NOT NULL DEFAULT ''`(ADR-21), 단계2 구분/상태 ENUM→코드테이블+FK·note 추가(ADR-22). 더블클릭 → root 비번만. 각 단계 멱등(반영됐으면 스킵) |
| `migrate-2026-07-24-uniqueness.sql` | (단계1 단독 SQL — 참고용. 실사용은 위 migrate.cmd 권장) |

## 구성 — 캘린더 트랙 (`cal_*`)

| 파일 | 역할 |
|---|---|
| `init-calendar.cmd` / `init-calendar.ps1` | **원큐**: 아래 세 `.sql` 을 정해진 순서로 적용하고 **배포 게이트**까지 돌린다. 보통은 `.cmd` 더블클릭 |
| `schema-calendar.sql` | `cal_*` 테이블 DDL **단일 소스**. 컬럼·CHECK·FK 의 정본은 설계 문서가 아니라 이 파일이다. 스키마 버전 행 시딩 + `cal_user_rev` 전원 시딩도 여기서 한다 |
| `triggers-calendar.sql` | 감사 트리거(`trg_cal_*`). **앱 계정에 `DELETE` 를 준 것을 상쇄하는 유일한 근거** — 아래 '왜 DELETE 를 주는가' 참조 |
| `grants-calendar.sql` | 앱 계정(`taskmgr_app`) 권한 **단일 소스**. 표마다 '왜 그 동사를 주는지 / 왜 안 주는지'가 주석으로 붙어 있다 |

> 세 `.sql` 은 `init-calendar` 없이 `mysql` 로 직접 돌려도 되지만, **순서와 게이트를 사람이 대신 지켜야 한다.** 아래 두 절이 그 내용이다.

## 지금 — 과제 구조 만들기

로컬(개인 PC)에서 **`init-db.cmd` 더블클릭** → root 비번 + 앱 계정 비번 입력.
서버를 대상으로 하려면:
```
init-db.cmd -DbHost 192.168.0.50 -Port 3306
```
- **앱 계정 비번**은 위젯 빌드의 `DeployConfig.DbPassword` 와 **똑같이** 넣어야 앱이 붙습니다.
- 앱 계정은 **과제 테이블에 대해** `SELECT`/`INSERT`/`UPDATE` 만(DDL·DROP 없음).
  근거는 `create-app-user.sql` 이 적어 둔 *"삭제는 `is_active=0` 이라 UPDATE"* 이고, **어느 표에 무엇을 주는지는 그 파일이 단일 소스**입니다(여기 목록을 두면 표가 늘 때마다 뒤처집니다 — 예전 이 줄은 "두 테이블"이라고 적혀 있었지만 실제로는 그보다 많습니다).
  > ⚠️ **이 문장을 캘린더에 적용하지 마세요.** `cal_*` 에는 소프트삭제가 없어 삭제가 곧 `DELETE` 이고,
  > `grants-calendar.sql` 은 **의도적으로 `DELETE` 를 줍니다**. 이 README 를 근거로 "앱 계정에 DELETE 가
  > 있으면 잘못"이라고 판단하면 반대로 결론이 납니다. 캘린더 쪽 근거는 아래 절과 `grants-calendar.sql` 입니다.

## 지금 — 캘린더(`cal_*`) 구조 만들기

로컬(개인 PC)에서 **`init-calendar.cmd` 더블클릭** → 관리(root) 비번만. 서버를 대상으로 하려면:
```
init-calendar.cmd -DbHost 192.168.0.50 -Port 3306
```
- **선행 조건**: `app_user` 가 이미 있어야 합니다(모든 `cal_*` 가 `login_id` FK 로 그 표를 가리킵니다). `init-calendar` 는 이것을 선행 조건 단계에서 확인하고 **아예 시작하지 않습니다**(코드 `1`). `mysql` 로 `schema-calendar.sql` 을 직접 돌리면 그 대신 FK 생성이 errno 1824 로 터집니다.
- 앱 계정 비번은 묻지 않습니다 — 이 키트는 **계정을 만들지 않고 권한만 줍니다**(비번이 두 파일에 흩어지는 것을 피하려고 `create-app-user.sql` 과 역할을 갈랐습니다).

### 배포 순서 — `schema` → `triggers` → `grants` (바꾸지 마세요)

`init-calendar` 가 이 순서로 돌립니다. 손으로 돌릴 때도 같은 순서여야 하고, **이유는 세 번째가 중요합니다**:

1. **`schema-calendar.sql`** — 표가 없으면 트리거도 GRANT 도 걸 대상이 없습니다(없는 표에 GRANT 는 `ERROR 1146`).
2. **`triggers-calendar.sql`** — **반드시 grants 보다 먼저.** 3의 `DELETE` 부여를 상쇄하는 근거가 이 트리거이기 때문입니다. 순서를 뒤집으면 그 사이 동안 *"흔적을 남기지 않고 지울 수 있는 계정"* 이 실재합니다. `GRANT` 문은 트리거가 있는지 알 방법이 없어 **이 순서를 스스로 강제하지 못합니다** — 사람이 지켜야 합니다.
3. **`grants-calendar.sql`** — 계정이 없으면 `ERROR 1410` 으로 시끄럽게 멈춥니다(의도. 조용히 건너뛰면 앱이 배포 후 첫 조회에서 `ERROR 1142` 로 죽습니다).

> ⚠️ **`schema-calendar.sql` 을 다시 돌리면 `DROP TABLE` 이 트리거까지 함께 지웁니다.** 구조를 재구축했다면 `triggers-calendar.sql` 도 반드시 다시 돌리세요. `init-calendar` 는 마지막 게이트에서 트리거 실재를 확인해 이 사고를 잡습니다.

### 왜 앱 계정에 `DELETE` 를 주는가 — 과제 트랙과 갈리는 지점

- `cal_*` 에는 **소프트삭제가 없습니다.** 일정·할 일·과제·회의실·예외일·커밋·공수는 행을 지우는 것이 정상 동작이고, 공수에 0 을 넣는 것도 0 저장이 아니라 **행 삭제**입니다.
- 그래서 과제 트랙의 관례(`SELECT`/`INSERT`/`UPDATE` 만)를 글자대로 옮기면 **앱의 모든 삭제 UI 가 `ERROR 1142` 로 실패**합니다. 그것도 사용자가 저장에 실패한 뒤에야 드러납니다.
- **상쇄**: 접속 자격은 배포본에 담겨 전 사용자 PC 에 퍼집니다(노출 전제). 그래서 DEFINER 감사 트리거가 삭제·수정 **전 이미지**를 `cal_audit_trash` 에 적재하고, 앱 계정에는 그 표 권한을 **한 줄도 주지 않습니다**. 우회 접속자는 지울 수는 있어도 **지운 흔적은 지우지 못합니다**.
- 표별로 어떤 동사를 주고 무엇을 안 주는지, 그 근거가 무엇인지는 **`grants-calendar.sql` 주석이 단일 소스**입니다. 여기 목록을 복사해 두지 않습니다 — 복사본은 반드시 원본보다 뒤처집니다.

### 종료코드 — `0` 이 아니면 배포가 끝난 것이 아닙니다

`init-calendar.cmd` 는 `init-calendar.ps1` 의 종료코드를 그대로 돌려줍니다. 무인 실행에서 **`0` 만 성공으로 세세요.**

| 코드 | 뜻 | 그다음에 할 일 |
|---|---|---|
| `0` | 게이트 전 항목 통과 — 구축 완료 | 이관 도구(설계 §8) → 앱 DB 모드 전환 |
| `1` | 실패. 무엇이 왜 틀렸는지 화면에 찍고 멈춘다 | 메시지대로 고치고 재실행 |
| `2` | **사용자가 취소** — 아무것도 바꾸지 않음 | `0` 과 같이 취급하면 '취소된 실행'을 구축 완료로 세게 된다 |
| `3` | **미완**: 구조는 됐지만 **감사 트리거가 없음** | `triggers-calendar.sql` 을 같은 폴더에 두고 재실행. 그 전에는 앱 계정의 `DELETE` 가 **흔적 없이 열려 있다** |
| `4` | **미완**: 구조는 됐지만 **앱 계정이 없어 GRANT 미부여** | `create-app-user.sql` 로 계정을 만든 뒤 재실행. 그 전에는 앱이 `cal_*` 를 한 줄도 못 읽는다 |
| `5` | **미완**: 3 과 4 가 동시에 | 둘 다 |

`3`·`4` 를 한 값으로 합치지 않은 이유는 **남은 단계가 서로 다르기 때문**입니다(파일을 가져오는 일 vs 계정을 만드는 일). 합치면 호출자가 종료코드만으로는 무엇을 해야 하는지 알 수 없습니다.

### 검증 — 게이트를 통과했다고 끝이 아닙니다

`init-calendar` 의 게이트는 **구조**(표 명부·FK·CHECK 강제·rev 전원 시딩·스키마 버전 행·트리거 실재·GRANT 대조)를 봅니다. 그 밖에 **사람이 눈으로 볼 것**은 `grants-calendar.sql` 파일 끝의 확인 1)~7) 입니다 — 특히 앱 계정으로 직접 접속해 `cal_audit_trash` 조회·삭제와 `DROP TRIGGER` 가 전부 `ERROR 1142` 로 거부되는지.

> ⚠️ `init-calendar`/`schema-calendar.sql` 도 **멱등 재구축이라 기존 `cal_*` 를 DROP** 합니다(최초 1회 구축용). 데이터가 든 DB 에 다시 돌리면 캘린더 데이터가 사라집니다. 운영 중 구조 변경은 별도 `migrate-*.sql` 로 하세요.

## 데이터 채우기 — 내부망 LLM

실 데이터는 폐쇄망 밖으로 못 주므로, **내부망 LLM**이 `schema-structure.sql`(구조) + `load-template.sql`(형식·규칙)을 보고 실제 과제의 INSERT SQL을 생성 → 실행:
```
mysql -u root -p taskmgr < 내부망LLM이_만든_INSERT.sql
```
규칙(코드값+발주처 먼저·section/status는 코드테이블 존재값·선진행 NULL 등)은 `load-template.sql` 상단 참고.

## 나중 — 서버 이관

구조는 다시 설계하지 않습니다. 서버에서 **같은 스크립트 실행**(구조·계정 재현) + 로컬 데이터는 dump/restore:
```
# 로컬(현 서버)에서 데이터 추출
mysqldump -u root -p taskmgr > taskmgr-data.sql
# 새 서버에서
init-db.cmd       -DbHost <새서버>    # 과제 구조 + 계정
init-calendar.cmd -DbHost <새서버>    # 캘린더 구조 + 트리거 + 권한 (app_user 가 생긴 뒤에)
mysql -u root -p -h <새서버> taskmgr < taskmgr-data.sql   # 데이터
# 위젯: DeployConfig.DbHost 를 새 서버로 바꿔 재빌드
```
- 두 스크립트의 **순서가 있습니다** — `cal_*` 가 `app_user` 를 FK 로 가리키므로 그 표가 먼저 있어야 합니다.
- 캘린더 데이터(`data.xml`)는 이 dump/restore 경로가 아니라 **1회성 이관 도구**로 옮깁니다(설계 §8. `cal_migration_log` 가 재실행을 막습니다).

## 검증
init-db 후 서버 루트의 `check.cmd`(mysql-offline 저장소) 또는:
```
mysql -u root -p -e "USE taskmgr; SHOW TABLES; SELECT COUNT(*) FROM project;"
```
캘린더 쪽은 `init-calendar` 의 게이트 + `grants-calendar.sql` 끝의 확인 1)~7) 입니다(위 '검증' 절 참조).

> ⚠️ `init-db`/`schema-structure.sql`은 멱등 재구축이라 **기존 테이블을 DROP**합니다. 데이터가 있는 DB에 재실행하면 지워집니다(최초 구축용).

## 관리자 비밀번호 (앱 내 공식 과제 편집 게이트)

- **최초 설정**: 배포 구성(`widget/DeployConfig.cs`)의 베이크 디폴트로 **먼저 인증**한 뒤,
  설정 → 관리자 → **관리자 비밀번호 변경**에서 새 비밀번호를 정합니다.
- **변경은 인증된 상태에서만** 가능합니다. 미인증 상태의 변경 요청은 호스트(`ProjectDb.SaveAdminCred`)가 거부합니다
  — 클라이언트 UI만으로는 브리지 메시지를 직접 던져 우회할 수 있기 때문입니다(ARCHITECTURE ADR #19).
- **비밀번호 분실 복구**: 사용자 PC의 `db-config.json`을 **삭제**하면 베이크 디폴트로 되돌아갑니다.
  그 값으로 다시 인증한 뒤 새 비밀번호를 정하세요.
  (경로: 앱 데이터 폴더 — 위젯이 `db-config.json`을 쓰는 곳. 파일엔 관리자 자격과 잠금해제 상태만 들어 있고 DB 접속정보는 없습니다.)

> 이 자격은 P6.5에서 회사 사이트(netcus) 인증 위임 + `app_user` 역할로 대체될 **스텁**입니다.
