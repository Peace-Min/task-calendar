# DB 프로비저닝 키트 (taskmgr)

MySQL 서버에 **과제 DB 구조(테이블) + 앱 계정**을 만드는 도구. **지금(개인 PC 임시)·나중(서버 이관) 모두 같은 스크립트**로 실행 → 동일 구조가 재현됩니다. 데이터는 이 키트가 만들지 않습니다(구조/권한만).

## 구성

| 파일 | 역할 |
|---|---|
| `init-db.cmd` / `init-db.ps1` | **원큐**: `CREATE DATABASE` + 테이블 구조 + 앱 계정(최소권한) |
| `schema-structure.sql` | 구조 전용 DDL(customer/project). 시드 없음 |
| `create-app-user.sql` | 앱 계정 수동 생성용(참고). init-db가 자동으로도 함 |
| `load-template.sql` | **내부망 LLM용** 데이터 INSERT 템플릿 + 규칙 |
| `migrate-2026-07-24-uniqueness.sql` | **기존 데이터가 있는 DB용 1회 마이그레이션**: 이름 유니크 제거 + 계약명/통상명칭 `NOT NULL DEFAULT ''`(ADR-21). 최초 구축은 schema로 하고, 이미 데이터가 든 DB에만 적용. 멱등 아님 |

## 지금 — 구조 만들기

로컬(개인 PC)에서 **`init-db.cmd` 더블클릭** → root 비번 + 앱 계정 비번 입력.
서버를 대상으로 하려면:
```
init-db.cmd -DbHost 192.168.0.50 -Port 3306
```
- **앱 계정 비번**은 위젯 빌드의 `DeployConfig.DbPassword` 와 **똑같이** 넣어야 앱이 붙습니다.
- 앱 계정은 두 테이블에 **SELECT/INSERT/UPDATE만**(DDL·DROP 없음).

## 데이터 채우기 — 내부망 LLM

실 데이터는 폐쇄망 밖으로 못 주므로, **내부망 LLM**이 `schema-structure.sql`(구조) + `load-template.sql`(형식·규칙)을 보고 실제 과제의 INSERT SQL을 생성 → 실행:
```
mysql -u root -p taskmgr < 내부망LLM이_만든_INSERT.sql
```
규칙(발주처 먼저·ENUM 값·선진행 NULL·UNIQUE 등)은 `load-template.sql` 상단 참고.

## 나중 — 서버 이관

구조는 다시 설계하지 않습니다. 서버에서 **같은 init-db 실행**(구조·계정 재현) + 로컬 데이터는 dump/restore:
```
# 로컬(현 서버)에서 데이터 추출
mysqldump -u root -p taskmgr > taskmgr-data.sql
# 새 서버에서
init-db.cmd -DbHost <새서버>          # 구조 + 계정
mysql -u root -p -h <새서버> taskmgr < taskmgr-data.sql   # 데이터
# 위젯: DeployConfig.DbHost 를 새 서버로 바꿔 재빌드
```

## 검증
init-db 후 서버 루트의 `check.cmd`(mysql-offline 저장소) 또는:
```
mysql -u root -p -e "USE taskmgr; SHOW TABLES; SELECT COUNT(*) FROM project;"
```

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
