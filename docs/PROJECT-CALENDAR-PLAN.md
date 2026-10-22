# 과제 공용 캘린더와 개인 캘린더 UX 개선 적용 기획 (PROJECT-CALENDAR-PLAN)

- 상태: **기획 초안(2026-10-22), 사용자 검토 대기.** 구현, DB 변경, 위젯 실행은 하지 않았다.
- 출처: GitHub 이슈 [Peace-Min/task-calendar#14](https://github.com/Peace-Min/task-calendar/issues/14) 와 전달 묶음(Gist `111fd188…`의 `IMPLEMENTATION.md`, `final.html`, `previews.html`, `RESEARCH.md`). 이슈 본문과 `IMPLEMENTATION.md` 는 같은 내용이다(끝 빈 줄 하나만 다름).
- 이 문서의 역할: 이슈는 HEAD `f461182`(앱 0.22.0, 구조 번호 13)를 보고 썼다. 그 뒤 버전 관문(14), 회의실 공용화(15), 배포 SQL 하나 방식, 관리 화면 별도 창 기획이 들어왔다. 이 문서는 이슈를 **지금 코드와 운용 규칙에 맞게 고친 적용 계획**이다. 이슈의 화면 계약(§3)과 수용 기준(§10)은 그대로 쓰고, 어긋나는 곳만 바꾼다.
- 기준 HEAD: `e19d073`(feat/db-app). 운용 기준: [DB-RELEASE-OPS.md](DB-RELEASE-OPS.md). 이 문서의 DB 이야기는 모두 **외부망 개발 PC 의 개발과 QA** 이야기다. 폐쇄망 서버에는 배포 SQL 로만 간다.

---

## 1. 이슈가 요구하는 것 (요약)

1. **공식 과제마다 공용 캘린더.** 사용자가 공식 과제를 직접 골라 참여하고 탈퇴한다(관리자 지정이나 승인 없음). 참여자는 작성자와 관계없이 공용 일정을 등록, 수정, 삭제한다.
2. **공용과 개인은 별도 데이터.** 자동 합치기와 자동 공유가 없다. 공용 일정을 내 개인 일정으로 **명시적으로 1회 복사**할 수 있다(출처 보존, 중복 방지, 원본과 독립).
3. **화면:** 상단 **개인 / 과제** 탭. 과제 탭은 왼쪽 참여 과제 목록(전체 선택, 전체 해제, 개별 체크는 표시와 숨김, 이름 클릭은 단독 보기), **월간**(연속 기간 막대)과 **주간**(과제별 행), 간결한 등록 폼(날짜가 기본, 시간 지정은 스위치, 메모와 장소는 펼침), "메모 첫 줄 표시" 켜기와 끄기 하나, 클릭 미리보기와 상세, **최근 변경**(과제별, 날짜순, 일정별, 변경 전후 값).
4. **동시성과 이력:** 행 단위 낙관적 잠금(`row_version`), 응답 유실 뒤 재시도에도 중복 없음(`mutation_uid`), 변경 이력은 지울 수 없는 기록. 다른 참여자의 변경은 과제 탭이 보일 때 30초마다 rev 로 확인.
5. **개인 캘린더 개선:** 월간 가시성(연속 막대, 시각 일정 위계, 메모 첫 줄과 미리보기 재사용), 입력 간소화(추가 옵션 접기, 기존 기능은 보존), 오른쪽 패널 접기. 개인 주간 보기와 개인 변경 이력은 범위 밖.
6. **제외:** 기간 축 보기, 별도 일정 목록, 시간 유무 필터, "기간 작업 / 시간 일정" 종류 선택, 메모 표시 3종, 모든 참여자에게 같은 색 강제, 상시 상세 패널, 공용 반복, 공용 할 일과 커밋과 보고, 공용 알림, 복구 UI, 공용 XML.

이슈의 화면 계약(§3.1~3.8), 개인 개선 범위(§4), 색과 이름(§6), 수용 기준(§10)은 **이 문서가 따로 고치지 않는 한 그대로** 구현 기준이다.

---

## 2. 이슈의 가정 중 지금 HEAD 와 어긋나는 것, 그리고 고친 방향

| # | 이슈의 가정 | 지금 HEAD 의 사실 | 고친 방향 |
|---|---|---|---|
| 1 | 앱 0.22.0, 스키마 13. "새 마이그레이션" 과 정본 DDL, GRANT 를 함께 갱신(§10) | 구조 번호 **15**(14 버전 관문, 15 회의실 공용화). 둘 다 아직 배포 전이다. 구조 변경은 **이관 조각** `db/deploy/migrations/v<도착>-<이름>.sql` 하나로만 내고, 배포 스크립트가 `release-v<버전>.sql` 하나로 감싼다(DB-RELEASE-OPS §4, §5) | **`v16-project-calendar.sql` 조각 하나**(15 에서 16). `DbGate.AppStructureVersion = 16`, 정본 시드 16 을 같은 커밋에서. 조각 규칙은 4.6 절 |
| 2 | "신규 마이그레이션과 GRANT 동시 갱신"(§5, §10) | 배포 SQL 은 **GRANT 를 못 한다**(DB-RELEASE-OPS §5.1, §5.3). 폐쇄망 서버 앱 계정은 `taskcalendar.*` 전체 권한이라 새 표를 바로 쓴다. 개발 PC 의 최소 권한 앱 계정은 표마다 GRANT 가 필요하다 | 정본 권한 파일(`grants-calendar.sql`)에는 새 표 줄을 더한다(새 구축과 개발 PC 용). 조각에는 GRANT 를 넣지 않는다. 개발 PC 는 root 로 따로 GRANT(4.7 절) |
| 3 | 새 표의 키를 `project.uid CHAR(36)`, `cal_project_event.uid CHAR(36)` 기본키와 외래키로(§7) | 2026-10-15 결정: **외래키가 가리키는 기본키는 번호로 둔다**([CODE-TABLE-IDS.md](CODE-TABLE-IDS.md), CALENDAR-TABLE-DESIGN §5.6.2). `project` 의 기본키는 `id INT UNSIGNED`, `uid` 는 외부 참조키(UNIQUE) | DB 안의 외래키는 **번호**(`project_id` → `project.id`, `event_id` → `cal_project_event.event_id`). 웹과 호스트 사이는 지금처럼 **`projectUid`**(웹의 과제 정체성 `db-<uid>`)와 **`eventUid`**(클라이언트가 만든 안정 id)로 주고받고 호스트가 번호로 바꾼다(4.2 절) |
| 4 | 공용 쓰기 권한은 활성 멤버십만, `edit_role` 로 제한하지 않음(§8) | 기존 쓰기 관문 `ProjectDb.OpenWriteAsync` 는 **editor/admin 만 통과**한다. 그대로 쓰면 viewer 가 공용 일정을 못 쓴다 | 새 관문 `ProjectCalendarDb.OpenMemberWriteAsync`(세션 신원, 활성 사용자, 역할 무관). 멤버십 판정은 트랜잭션 안에서(5.2 절) |
| 5 | 직원 삭제 뒤에도 이력 이름 보존, actor FK `SET NULL`(§7) | 직원은 보통 **퇴사(is_active=0)** 로 남고, 휴지통 영구 삭제는 **기록 0건일 때만** 된다(`UserRecordTables` 8표, 시험 계약 ③). 소유자 FK 는 2026-09-09 에 RESTRICT 로 통일했다 | 사용자 참조는 **RESTRICT**. 공용 일정, 변경 이력, 복사 대응표는 "기록" 으로 세어 영구 삭제를 막고, 멤버십은 로그인 부속 행처럼 삭제 트랜잭션이 먼저 지운다. 이름 스냅샷은 그대로 둔다(개명 대비). 열린 질문 Q5 |
| 6 | 과제 영구 삭제 시 공용 기록이 있으면 안내하고 막음(§7) | 휴지통의 과제 영구 삭제는 지금 **참조가 있어도 지운다**(개인 분류는 문자열 참조라 `db_gone` 으로 남음. `ProjectDb.cs` 영구 삭제 ③ 분기) | 같은 분기에 "공용 일정 수" 를 세어 1건 이상이면 고정 문구로 거부(최종 방어는 FK RESTRICT 1451). 공용 일정이 없으면 공용 달력 행과 멤버십은 CASCADE 로 함께 지워진다 |
| 7 | 공용 탭이 보이면 30초 폴링(§8) | [OFFLINE-RESILIENCE.md](OFFLINE-RESILIENCE.md) **A11: 정상 상태 주기 DB 접속 0**. 예외는 버전 관문의 30분 배포 정보 확인 하나뿐이다(VERSION-GATE §2.5) | 30초 폴링을 **두 번째 예외로 문서화**한다. 조건: 위젯 창이 보이고(최소화, 트레이 아님) 과제 탭이 활성이고 연결이 정상일 때만. 개인 탭에서는 0 을 유지해 루프 O6 판정이 그대로 선다. 열린 질문 Q4 |
| 8 | 모든 연결은 각자 연다는 전제(§5 의 `ProjectDb`/`UserSession` 재사용) | 데이터 연결은 **관문 `DbGate.OpenAsync` 하나**로만 연다. `new MySqlConnection(` 은 `DbGate.cs` 와 핑에만 있어야 한다(시험 강제) | 새 `ProjectCalendarDb` 도 `DbGate.OpenAsync` 만 쓴다. 관문 오류는 kind `gate` 로 회신하고 `__versionGate` 푸시 경로를 탄다 |
| 9 | 장소는 자유 입력(§3.6) | 장소 칸은 회의실 공용 목록 추천이 붙은 **콤보 A안**(`#fLoc`, `#qaLoc`, 2026-10-21 확정) | 공용 폼의 장소도 **같은 콤보 A안 함수**를 재사용한다. 개인용 폼 개편 때 콤보 동작을 잃지 않게 회귀 시험에 넣는다 |
| 10 | 관리 화면은 메인 창 안 | 관리 허브가 **별도 OS 창**으로 옮겨 가는 중이다(다른 세션, [ADMIN-WINDOW.md](ADMIN-WINDOW.md)). 메인 창 허브는 더 열지 않는다 | 이 기능은 관리 허브를 건드리지 않는다. "참여 과제 관리" 는 관리 기능이 아니라 **본인 기능**이라 과제 탭 안에 둔다. 새 명령은 메인 창 전용(관리 창, 열람 창 허용 목록 밖) |
| 11 | 개인 복사는 개인 분류 편입까지 한 트랜잭션(§3.8, §8) | 분류 편입 규칙(`subscribeDbCat()`: 색, 이름, `db-<uid>`, 순서)은 **웹에 있다.** 호스트에서 같은 행을 만들면 규칙이 두 벌이 된다 | 편입이 필요하면 **웹이 먼저 평소 저장으로 편입**하고(사용자가 누른 명시적 동작 안에서), 그다음 호스트 복사 트랜잭션은 일정과 대응표만 만든다. 편입 뒤 복사가 실패해도 남는 것은 사용자가 원한 과제 편입뿐이다. 열린 질문 Q6 |
| 12 | 메모 상한 20,000자, 제목 200자를 JS 와 호스트에서 맞춤(§3.6) | 개인 `cal_entry` 의 제목과 메모는 MEDIUMTEXT 이고 **앱에 상한이 없다**(커밋 제목 유입 때문). 장소는 200자 | 공용 일정에만 상한을 둔다(제목 200, 메모 20,000, 장소 200). 개인 복사 때는 공용 값이 이미 상한 안이라 문제없다. 개인 폼의 상한은 바꾸지 않는다 |
| 13 | 서버 사용자가 있는 운영 DB 를 전제한 표현("운영 DB 실행은 별도 지시") | 폐쇄망 서버는 아직 13 이고 사내 배포는 보류 중이다. 개발 PC 의 `taskcalendar` 는 15 이고 **여러 세션이 같이 쓴다** | 개발 중에는 **복사본 DB** 에서만 16 을 만든다. 공용 개발 DB 는 병합 때 올린다(8 절) |
| 14 | 기간 칩 클릭이 시작 달로 튀는 버그 재발 금지(§3.4) | 이미 고쳐져 있고 루프 `loop-range-chip` 이 있다([BUG-RANGE-CHIP-CLICK.md](BUG-RANGE-CHIP-CLICK.md)) | 개인 월간을 연속 막대로 바꿀 때 이 루프를 그대로 통과해야 한다. 공용 월간에도 같은 규칙(누른 날짜 선택) |

### 2.1 Q6 결정(2026-10-22): 참여 = 내 과제에 넣은 공식 과제

이 절이 아래 본문(4.2 ②, 5.3, 5.4, 5.5, 6.4, 8.2)의 참여 관련 내용보다 우선한다.

- **과제 탭에 보이는 과제 = 내 과제(`cal_category`, `source='db'`)에 넣은 공식 과제.** 별도 참여 표, 참여 관리 창, 참여와 탈퇴 명령을 만들지 않는다. 참여하려면 기존 "공식 과제 찾아보기" 로 내 과제에 넣는다.
- 이슈 명세(B: 참여와 편입은 별개, 처음 참여자 0명)와 다른 방향이다. 지금 내 과제에 공식 과제를 넣어 둔 사람은 배포 순간 그 과제의 참여자다(서버에 아직 사용자가 없어 실제 영향은 작다).
- **판정은 서버 함수 하나에서만 한다**(`ProjectCalendarDb` 의 "내 참여 과제 목록", "이 과제의 참여자인가"). 지금은 그 함수가 `cal_category` 를 본다. 읽기, 쓰기, 이력, 복사 명령은 모두 이 함수만 부른다.
- **화면은 참여 과제를 스스로 계산하지 않는다.** 과제 탭 목록은 서버의 부트스트랩 회신을 쓴다(`state.categories` 에서 걸러 만들지 않는다).
- **공용 표는 `cal_category` 를 가리키지 않는다.** 과제 번호와 사람 번호만 가리킨다.
- 개인 일정에 등록(복사): 과제 탭에 보인다는 것이 이미 내 과제에 있다는 뜻이라 편입 단계가 없다. 복사 트랜잭션은 그 사람의 해당 `cal_category` 를 찾아 일정의 분류로 쓴다.
- 나가기: 과제 탭에서 그 과제를 그만 보려면 체크 해제(표시와 숨김)를 쓴다. 내 과제에서 빼면 지금 동작대로 그 과제의 개인 일정, 할 일, 공수가 함께 지워지므로 나가기 수단으로 안내하지 않는다.
- 숨긴(비활성) 공식 과제: 과제 탭에서 읽기 전용. 영구 삭제는 공용 일정이 있으면 막는다(2 절 6번).
- 참여자 수(시안의 "6명")는 그 과제를 내 과제에 넣은 사람 수를 센다.

**나중 작업(이번 범위 밖): 관리자 배정.** 검토자 의견(관리자나 PM 이 과제별 참여인력을 지정)은 따로 진행한다. 그때의 원칙:

- 참여인력은 `project` 의 열이 아니라 별도 표(과제 번호와 사람 번호의 짝)로 둔다.
- **관리자는 남의 내 과제에 쓰지 않는다.** 개인 데이터는 본인 앱만 쓴다는 전제(저장 충돌 감지, 번호 발급, 색과 순서 규칙)를 지키고, 배정 해제가 남의 개인 기록 삭제로 이어지지 않게 한다.
- 공식 과제 찾아보기는 나에게 배정된 과제만 보이고, 내 과제에 넣는 것은 본인이 한다.
- 과제 탭 판정은 "내 과제에 있고 + 지금 배정되어 있음" 으로 바꾼다(위 판정 함수만 고친다). 배정이 풀리면 과제 탭에서만 사라지고 내 과제와 개인 기록은 남는다.
- 처음 명단은 그 시점의 내 과제 편입으로 채우는 것을 권한다. 배정 화면은 관리 창 안의 새 항목이다. PM 에게도 맡기려면 과제별 PM 정책이 먼저 필요하다.

---

## 3. 범위와 제외 (이 문서에서 확정 제안)

- 범위: 이슈 §1 A, B 전부. 단 위 2 절의 고친 방향을 따른다.
- 제외(이슈 §12 그대로): 기간 축, 별도 일정 목록, 시간 유무 필터, 종류 선택, 메모 3종, 같은 색 강제, 상시 상세 패널, 공용 반복, 공용 할 일, 공용 커밋, 공용 보고, 공용 알림, 공용 XML 가져오기와 초기화, 복구 UI, 알림함과 읽음과 댓글, 회의 시간 충돌 계산, 개인 주간 보기, 개인 변경 이력, 과제 약칭 DB, 공용 `project.color`.
- 추가 제외(이 문서): 관리 창에서 다른 사람의 멤버십을 보거나 고치는 기능(이슈도 "다른 사용자의 멤버십을 쓰는 포트는 제공하지 않음"). 필요해지면 관리 창 쪽 후속 과제로 따로 기획한다.
- 브라우저 단독 모드(위젯 없이 `.html`): 과제 탭은 "서버에 연결된 위젯에서만 쓸 수 있습니다" 안내만 보인다. localStorage 로 흉내 내지 않는다(이슈 §3.1).

---

## 4. DB 설계 (구조 번호 16)

### 4.1 원칙

- 공용 트랙은 **새 표 다섯 개**다. 개인 `cal_entry`, `cal_category` 에 가짜 소유자나 `user_id=0` 을 넣지 않는다(이슈 §7).
- **외래키가 가리키는 기본키는 번호**(CODE-TABLE-IDS). 외부에 나가는 정체성은 `uid`(UNIQUE) 로 따로 둔다. 이것은 `project(id, uid)` 와 같은 모양이다.
- 시각은 모두 UTC `DATETIME(3)`, 연결 프리앰블의 `time_zone='+00:00'` 을 따른다.
- 표 기본 문자셋 `utf8mb4`, `utf8mb4_0900_ai_ci`. 정확 비교하는 값 집합 열(`action`)과 클라이언트 id(`uid`, `mutation_uid`)는 `_bin`(기존 `cal_*` 의 `source`, `uid` 선례).
- 이름: 개인 트랙의 `cal_user_rev` 와 짝이 맞게 과제별 감시점 표를 `cal_project_rev` 로 한다(이슈의 `cal_project_calendar`). 나머지는 이슈 이름을 쓴다.

### 4.2 표

**① `cal_project_rev`: 과제별 동시성 감시점(이슈의 `cal_project_calendar`)**

| 열 | 형 | 뜻 |
|---|---|---|
| `project_id` | `INT UNSIGNED` PK | `project.id` FK, `ON DELETE CASCADE`(공용 일정이 없을 때만 과제가 지워질 수 있으므로 안전) |
| `rev` | `BIGINT UNSIGNED NOT NULL DEFAULT 0` | 공용 쓰기와 멤버십 변경마다 +1. 폴링이 이 값만 읽는다 |
| `updated_at` | `DATETIME(3) NOT NULL` | UTC |

- 첫 참여 때 `INSERT … ON DUPLICATE KEY UPDATE rev = rev + 1` 로 멱등하게 생긴다. 쓰기 트랜잭션의 **첫 문장**이 이 ODKU 다(`cal_user_rev` 규칙과 같다).
- DELETE 권한을 주지 않는다(과제 삭제 CASCADE 만).

**② `cal_project_member`: 본인 참여** (2026-10-22 Q6 결정으로 **만들지 않는다.** 참여는 `cal_category` 로 판정한다, 2.1 절. 아래는 검토 기록이다. 그에 따라 4.3, 4.6, 5.3, 5.4 의 멤버십 관련 줄도 적용하지 않는다)

| 열 | 형 | 뜻 |
|---|---|---|
| `project_id` | `INT UNSIGNED` | `cal_project_rev.project_id` FK, CASCADE |
| `user_id` | `SMALLINT UNSIGNED` | `app_user.user_id` FK, **RESTRICT**(2 절 5번) |
| `is_active` | `TINYINT(1) NOT NULL DEFAULT 1` | CHECK `IN (0,1)`. 탈퇴는 0, 재참여는 같은 행을 1 로 |
| `joined_at`, `left_at` | `DATETIME(3)`, `left_at NULL` | 마지막 참여, 마지막 탈퇴 |
| `updated_at` | `DATETIME(3) NOT NULL` | |

- PK `(project_id, user_id)`, 인덱스 `ix_cal_project_member_user (user_id, is_active, project_id)`.
- 행은 본인만 쓴다. 호스트가 세션의 `user_id` 로만 쓴다(웹이 보낸 사용자 값은 받지 않는다).

**③ `cal_project_event`: 공용 일정**

| 열 | 형 | 뜻 |
|---|---|---|
| `event_id` | `INT UNSIGNED AUTO_INCREMENT` PK | 내부 번호. 이력과 복사 대응표가 가리킨다 |
| `uid` | `CHAR(36) _bin NOT NULL` UNIQUE | 클라이언트가 만든 안정 id(UUID). 생성 재시도의 멱등 키, 웹과의 정체성 |
| `project_id` | `INT UNSIGNED NOT NULL` | `project.id` FK, **RESTRICT**(공용 기록이 있는 과제는 영구 삭제 불가) |
| `title` | `VARCHAR(200) NOT NULL` | CHECK `title <> ''`. 이슈의 MEDIUMTEXT 대신 실제 상한(200)을 형으로 둔다(공용은 커밋 제목 유입이 없다) |
| `start_date` | `DATE NOT NULL` | |
| `end_date` | `DATE NULL` | 단일일 NULL, 종료 포함. CHECK `end_date IS NULL OR end_date > start_date` (개인 `cal_entry` 와 같은 규칙) |
| `start_time`, `end_time` | `TIME NULL` | CHECK: 둘 다 NULL, 또는 `end_date IS NULL` 이고 둘 다 있고 `end_time > start_time` |
| `location` | `VARCHAR(200) NOT NULL DEFAULT ''` | 개인과 같은 폭 |
| `memo` | `MEDIUMTEXT NOT NULL` | 앱 상한 20,000자(호스트와 웹이 같은 상수) |
| `row_version` | `BIGINT UNSIGNED NOT NULL DEFAULT 1` | 낙관적 잠금 |
| `is_deleted` | `TINYINT(1) NOT NULL DEFAULT 0` | 소프트 삭제. 행을 지우지 않는다 |
| `created_by`, `updated_by` | `SMALLINT UNSIGNED NULL` | `app_user` FK RESTRICT. NULL 은 쓰지 않지만 열은 NULL 허용(이관 대비) |
| `created_by_name` | `VARCHAR(50) NOT NULL` | 작성자 이름 스냅샷 |
| `created_at`, `updated_at`, `deleted_at` | `DATETIME(3)` | UTC, `deleted_at NULL` |

- 인덱스: `ix_cal_project_event_range (project_id, is_deleted, start_date, end_date)`, `ix_cal_project_event_upd (project_id, updated_at, event_id)`.
- 범위 조회 조건: `start_date <= @to AND COALESCE(end_date, start_date) >= @from`.

**④ `cal_project_change`: 변경 이력(지우지 않는 기록)**

| 열 | 형 | 뜻 |
|---|---|---|
| `change_no` | `BIGINT UNSIGNED AUTO_INCREMENT` PK | 안정 정렬과 커서 |
| `project_id` | `INT UNSIGNED NOT NULL` | `project.id` FK RESTRICT. 이벤트에서 다시 찾지 않고 바로 거른다 |
| `event_id` | `INT UNSIGNED NOT NULL` | `cal_project_event` FK RESTRICT |
| `mutation_uid` | `CHAR(36) _bin NOT NULL` | 재시도 멱등 키. UNIQUE `(project_id, mutation_uid)` |
| `action` | `VARCHAR(8) _bin NOT NULL` | CHECK `IN ('create','update','delete')` |
| `actor_user_id` | `SMALLINT UNSIGNED NULL` | `app_user` FK RESTRICT |
| `actor_login_snapshot`, `actor_name_snapshot` | `VARCHAR(50) NOT NULL` | 개명과 퇴사 뒤에도 읽히게 |
| `title_snapshot` | `VARCHAR(200) NOT NULL` | 삭제 뒤에도 당시 제목 |
| `before_json`, `after_json` | `JSON NULL` | 바뀐 필드만(create 는 after 만, delete 는 before 만) |
| `changed_at` | `DATETIME(3) NOT NULL` | UTC |

- 인덱스: `ix_cal_project_change_proj (project_id, changed_at, change_no)`, `ix_cal_project_change_event (event_id, changed_at, change_no)`.
- 앱 계정 권한은 **SELECT, INSERT 만**(UPDATE, DELETE 없음).
- 한 저장의 여러 필드 변경은 한 행이다(이슈 §3.7 "한 변경 단위"). no-op 저장은 행을 만들지 않는다.

**⑤ `cal_project_copy`: 개인 복사 대응표**

| 열 | 형 | 뜻 |
|---|---|---|
| `user_id` | `SMALLINT UNSIGNED` | 복사한 사람 |
| `event_id` | `INT UNSIGNED` | 원본. `cal_project_event` FK RESTRICT |
| `entry_no` | `INT UNSIGNED NOT NULL` | `(user_id, entry_no)` → `cal_entry` FK **ON DELETE CASCADE** |
| `project_name_snapshot` | `VARCHAR(200) NOT NULL` | 출처 표시 |
| `source_row_version` | `BIGINT UNSIGNED NOT NULL` | 복사한 판 |
| `copied_at` | `DATETIME(3) NOT NULL` | UTC |

- PK `(user_id, event_id)`(같은 원본은 한 번만), UNIQUE `(user_id, entry_no)`.
- 개인 복사본을 지우거나 XML 전량 교체로 `cal_entry` 가 지워지면 대응표 행이 CASCADE 로 사라져 **다시 복사할 수 있다.** 원본과 이력은 그대로다.
- 사용자 FK 는 `cal_entry` 를 거쳐 간접으로 묶인다(`cal_entry.user_id` 가 RESTRICT).
- `cal_entry` 의 `entry_no` 는 삭제 뒤 재사용된다(계약 H-1). CASCADE 로 대응표가 먼저 사라지므로 재사용된 번호가 옛 대응을 물려받지 않는다.

### 4.3 기존 표와의 관계

- `cal_category.project_uid` 는 그대로(FK 없음, 외부 식별자). 공용 트랙과 연결하지 않는다. 같은 사용자의 공식 과제 분류색은 웹에서 `project_uid` 로 찾아 공용 표시에 쓴다(이슈 §6).
- 휴지통(관리 창으로 옮겨 가는 중): 과제 영구 삭제 판정에 공용 일정 수를 더한다(2 절 6번). 인력 영구 삭제의 `UserRecordTables` 에 `cal_project_event`(작성자), `cal_project_change`(행위자), `cal_project_copy` 를 더하고, `cal_project_member` 는 `cal_user_pref`, `cal_user_rev` 처럼 삭제 트랜잭션이 먼저 지운다. 시험 계약 ③(정본의 `REFERENCES app_user` 집합 대조)도 함께 고친다. 단 `cal_project_event.created_by` 처럼 한 표에 사용자 열이 둘 이상이면 세는 SQL 이 `user_id` 열 하나를 가정하지 않도록 바꿔야 한다(구현 때 확인).
- 개인 저장(`CalendarWriteDb.SaveAsync`)은 공용 표를 읽거나 쓰지 않는다. `cal_entry` 삭제가 대응표를 CASCADE 로 지우는 것만 새로 생긴다(앱 계정의 대응표 DELETE 권한은 필요 없다. FK 동작은 권한 검사를 받지 않는다).

### 4.4 정본 DDL

- 새 표 다섯 개는 `db/deploy/schema-calendar.sql`(cal_* 정본)에 넣는다. DROP 목록과 CREATE 목록(정본 자신이 목록이다), 표 수 주석, `cal_schema_meta` 시드 16, 표 주석을 함께 고친다.
- `project` FK 가 있으므로 `schema-structure.sql` 다음에 만들어진다(지금 순서 그대로).
- `setup-taskcalendar.ps1` 의 기대 표 수와 구조 시그니처, `tools/schema-report`, `docs/DB-SCHEMA.html`, `db/table-design-report.html`, `db/CALENDAR-TABLE-DESIGN.md`(새 절: 공용 트랙), `db/TABLE-DESIGN.md` 를 같은 라운드에 맞춘다.

### 4.5 이관 조각 `db/deploy/migrations/v16-project-calendar.sql`

DB-RELEASE-OPS §5 규칙 그대로:

1. 첫 줄 `-- @migration from=15 to=16`.
2. 자기 확인: `db_structure_version` 이 `'15'` 면 `@go`, 16 이상이면 `@skip`, 그 밖은 `중단: v16 조각 - …` 1146. `@go` 일 때 `db_updating = '1'` 아니면 멈춤. 변수는 `@go`, `@skip`, `@g`, `@s`, `@m_` 만.
3. 바꾸기: 다섯 표를 `CREATE TABLE IF NOT EXISTS …` 로, 정본과 **글자까지 같은 정의**로, 모두 `PREPARE` 로 `@go` 일 때만. 만드는 순서는 FK 순서(rev, member, event, change, copy). 데이터 옮기기는 없다(최초 멤버십은 비어 있다, 이슈 §3.2).
4. 검증: 다섯 표가 있고 각 표의 열 수와 FK 수가 기대와 같음(information_schema). 틀리면 `db_updating = 1` 인 채로 멈춤.
5. 끝 한 줄: `UPDATE cal_schema_meta SET v = '16', updated_at = UTC_TIMESTAMP(3)` 다음 줄 `WHERE k = 'db_structure_version' AND v = '15';`.
6. 쓰지 않는 것: `db_updating`, `@r_`, GRANT, 저장 프로그램, DELIMITER, `lock_wait_timeout`.
7. 다시 돌리기: 앞선 실행이 표 셋까지 만들고 멈췄어도 IF NOT EXISTS 로 이어서 끝난다. 반쯤 만든 표(정의가 다른 표)가 남을 일은 없다(CREATE 는 한 문장).

앱 쪽 짝(같은 커밋): `DbGate.AppStructureVersion = 16`, 정본 시드 16, `tests/schema-guards`, `tests/release-sql.test.mjs` 의 사슬 기대(13 에서 16), 흉내 실행 시나리오(13, 14, 15 사본에서 16).

### 4.6 권한

- 정본 `db/deploy/grants-calendar.sql` 에 새 표 줄을 더한다. 이 파일의 규칙("cal_* 전부에 GRANT 한 줄", 확인 2b)을 따른다.

| 표 | 앱 계정 권한 | 이유 |
|---|---|---|
| `cal_project_rev` | SELECT, INSERT, UPDATE | ODKU. DELETE 없음 |
| `cal_project_member` | SELECT, INSERT, UPDATE | 탈퇴는 `is_active=0`. 인력 영구 삭제의 부속 정리에는 DELETE 가 필요하다(Q5 결정에 따라) |
| `cal_project_event` | SELECT, INSERT, UPDATE | 소프트 삭제라 DELETE 없음 |
| `cal_project_change` | SELECT, INSERT | 지우지 않는 기록 |
| `cal_project_copy` | SELECT, INSERT | 정리는 CASCADE |

- **배포 SQL 은 GRANT 하지 않는다.** 폐쇄망 서버 앱 계정(`taskmgr_app`, `taskcalendar.*` 전체 권한)은 새 표를 바로 쓴다(DB-RELEASE-OPS §5.3). 운영자에게 따로 할 일이 없다.
- **개발 PC** 는 최소 권한 앱 계정이라 표마다 root 로 GRANT 해야 한다(안 하면 1142). 복사본 DB 에서 시험할 때도 그 DB 에 같은 권한을 따로 준다. root 비밀번호는 사용자가 채팅으로 주고, 파일이나 명령줄에 남기지 않는다.
- 휴지통 과제 영구 삭제의 FK 방어(1451)는 권한과 무관하다.

---

## 5. 호스트 설계 (C#)

### 5.1 클래스

| 클래스 | 새로/고침 | 하는 일 |
|---|---|---|
| `widget/ProjectCalendarDb.cs` | **새로** | 공용 캘린더 전부: 부트스트랩, 참여와 탈퇴, 범위 조회, 저장, 삭제, 변경 이력 조회, 개인 복사, rev 확인. SQL 규칙은 여기에만 있다 |
| `widget/CalendarWriteDb.cs` | 고침(작게) | 개인 일정 한 건을 **이미 열린 트랜잭션 안에서** 넣는 내부 함수(발번 MAX+1, 행 투영 재사용)를 꺼낸다. 복사가 이것을 부른다. `SaveAsync` 의 동작은 바꾸지 않는다 |
| `widget/ProjectDb.cs` | 고침(작게) | 휴지통 과제 영구 삭제의 공용 일정 거부, 인력 기록 표 목록. 관리 창 작업과 겹치는 파일이라 이 두 곳만 만진다 |
| `widget/MainWindow.xaml.cs` | 고침 | `OnWebMessage` 스위치에 새 명령 9개(아래 5.4). 회신은 기존 `ReplyOnUi`/`__hostReply` |
| `widget/DbGate.cs` | 고침 | `AppStructureVersion = 16` 한 줄 |
| `widget/DbErrors.cs` | 고침(필요하면) | 새 kind 가 필요 없도록 회신의 `error.kind` 를 `forbidden`, `conflict`, `invalid` 로 호스트에서 직접 채운다. 연결 오류는 기존 분류(network, auth, gate 등) |

C# 러너를 직접 링크하는 루프와 도구(loop-calendar-write, loop-peer-view, loop-report-wiring, dryrun-xml-to-db)의 .cs 목록에 새 파일이 필요한지 확인한다(HANDOFF §5).

### 5.2 연결과 권한

- **모든 연결은 `DbGate.OpenAsync`.** 그다음 프리앰블: 읽기는 `REPEATABLE-READ`(여러 과제를 한 스냅샷으로), 쓰기는 `READ-COMMITTED`, 둘 다 `time_zone='+00:00'`, `innodb_lock_wait_timeout=5`(기존 `ProjectDb`, `CalendarWriteDb` 와 같은 상수 재사용).
- 신원: `UserSession.Load` 의 `login_id` → `app_user` 에서 `user_id`, `is_active`, 이름. 세션이 없거나 비활성이면 `forbidden`. **`edit_role` 은 보지 않는다**(viewer 도 공동 편집, 이슈 §8). 웹이 보낸 사용자 값은 받지 않는다.
- 읽기 권한: 그 과제의 **활성 멤버십**. 쓰기 권한: 활성 멤버십 + 과제 `is_active = 1` + 사용자 활성. 비활성(숨김) 과제는 멤버에게 읽기 전용, 새 참여 불가, 탈퇴 가능.
- 판정은 모든 명령에서 다시 한다(버튼 상태와 무관, 탈퇴 직전 연 폼, 위조 요청).
- 이것은 보안 경계가 아니다. 공유 앱 계정이 직접 DB 에 붙는 지금 구조와 같은 수준의 난간이다(이슈 §8, DB-RELEASE-OPS §0). 문서에 그렇게 적는다.

### 5.3 쓰기 순서 (공용 저장, 삭제, 참여, 탈퇴)

1. `DbGate.OpenAsync`, 쓰기 프리앰블, 트랜잭션 시작.
2. **첫 문장:** `INSERT INTO cal_project_rev(project_id, rev, updated_at) VALUES(@p, 1, @now) ON DUPLICATE KEY UPDATE rev = rev + 1, updated_at = @now`. 과제 단위 직렬화.
3. 신원, 멤버십, 과제 상태 확인(이 연결, 이 트랜잭션). 거부면 롤백.
4. 멱등: `cal_project_change` 에 같은 `(project_id, mutation_uid)` 가 있으면 그 결과를 그대로 돌려주고 롤백(응답 유실 뒤 재시도).
5. 생성: `uid` 가 이미 있으면 위 4번과 같은 처리. 수정과 삭제: `UPDATE … WHERE event_id=@e AND row_version=@expected AND is_deleted=0`. 0행이면 `conflict`(최신 행을 함께 회신), 자동 덮어쓰기 없음.
6. 바뀐 필드 계산. 없으면(no-op) 이력 없이 커밋하고 그대로 회신.
7. `cal_project_change` INSERT(같은 트랜잭션). 실패하면 전체 롤백.
8. **커밋 직전 관문 재확인:** `cal_schema_meta` 를 잠금 없이 한 번 더 읽어 `Ok` 가 아니면 롤백(`CalendarWriteDb` 의 2026-10-21 규칙과 같다. 여러 사람이 쓰는 표라 이 틈을 닫는다).
9. 커밋, 새 `rowVersion`, 새 `projectRev` 회신.

- 여러 과제 참여와 탈퇴를 한 번에 저장할 때는 과제마다 따로 트랜잭션을 돌리고 과제별 결과를 회신한다(이슈 §8 의 두 안 중 단순한 쪽). 화면은 실패한 과제만 표시한다.
- 참여: 행 없으면 INSERT, 있으면 `is_active=1, joined_at=@now`. 탈퇴: `is_active=0, left_at=@now`. 둘 다 rev 를 올린다(다른 참여자의 참여자 수 표시 갱신).

### 5.4 명령 (메인 창 전용)

이슈 §9 의 일곱 개에 참여 후보 목록과 폴링용 두 개를 더한다. 이름은 이슈 그대로 `projectCalendar*`. 응답은 `{ ok, data?, error?: { kind, message } }`.

| 명령 | 요청 | 회신 |
|---|---|---|
| `projectCalendarBootstrap` | 없음 | 내 참여 과제(활성과 읽기 전용), 과제별 rev, 표시 메타(`common_name || project_name`, 발주처, 구분 번호), 과제별 참여자 수, 내 복사 대응(`eventUid` → 개인 `entryUid`) |
| `projectCalendarCandidates` | 없음 | 참여 관리 창의 후보: 활성 공식 과제 전체와 내 참여 상태. 기존 과제 목록 읽기(`loadProjects`) 결과를 재사용할 수 있으면 이 명령은 빼고 bootstrap 과 합친다(구현 때 결정) |
| `projectCalendarParticipation` | `{ changes: [{ projectUid, join }], mutationUid }` | 과제별 결과와 새 bootstrap |
| `projectCalendarLoad` | `{ projectUids, from, to }` | 권한 있는 과제의 범위 일정과 rev. 권한을 잃은 과제는 빼고 그 사실을 알림 |
| `projectCalendarSave` | `{ projectUid, eventUid, expectedVersion?, mutationUid, event }` | 저장된 일정, 새 rowVersion, projectRev |
| `projectCalendarDelete` | `{ projectUid, eventUid, expectedVersion, mutationUid }` | 소프트 삭제, projectRev |
| `projectCalendarChanges` | `{ projectUids, changedFrom, changedTo, fieldFilter, cursor, limit }` | 이력 행(기본 50), 다음 커서 `(changedAt, changeNo)`, 더 있음 여부. 묶기(과제별, 날짜순, 일정별)는 웹이 한다 |
| `projectCalendarRevs` | `{ projectUids }` | 멤버십 해시와 과제별 rev 만(폴링용 가벼운 읽기) |
| `projectCalendarCopy` | `{ projectUid, eventUid, expectedVersion, mutationUid }` | 새 개인 일정 uid 또는 기존 복사본, 그리고 개인 스냅샷 재적재 결과 |

- 관리 창(`?win=admin`)과 열람 창(`?peerwin=1`)의 명령 허용 목록에는 넣지 않는다. 관리 창 허용 목록은 그 세션이 만드는 중이므로, 병합 때 "허용 목록 밖 명령 거절" 시험이 새 명령을 거르는지 확인한다.
- 날짜 DTO: `YYYY-MM-DD`, 시각 `HH:mm` 또는 null, UI 종료일은 포함(단일일 DB `end_date=NULL` 은 시작일과 같은 종료로 회신), `rowVersion` 정수(이슈 §9 그대로).

### 5.5 개인 복사

1. 웹: 개인 화면에 저장 안 된 변경이 있으면 먼저 저장을 끝낸다(저장 큐가 빌 때까지 기다림, 실패면 복사하지 않음).
2. 웹: 그 공식 과제가 내 분류에 없으면 `subscribeDbCat()` 으로 편입하고 평소 저장을 끝낸다(2 절 11번).
3. 호스트 `projectCalendarCopy` 한 트랜잭션: **잠금 순서 `cal_project_rev` → `cal_user_rev`**(개인 저장은 `cal_user_rev` 만 잡으므로 순환이 없다). 멤버십과 원본 `row_version` 확인, 기존 대응이 있고 그 개인 일정이 살아 있으면 그것을 회신, 없으면 `cal_entry` 한 건(제목, 날짜, 시각, 장소, 메모, 분류 = 그 공식 과제, `remind = 0`, 반복 없음, 커밋 없음)과 대응표 INSERT. 개인 행 투영은 `CalendarWriteDb` 의 같은 함수를 쓴다. 커밋 직전 관문 재확인.
4. 커밋 뒤 호스트가 개인 스냅샷을 다시 읽어(`reloadState` 와 같은 경로) 웹에 적용한다. 1번에서 미저장 변경이 없음을 보장했으므로 덮을 것이 없다. 토큰, `*NoByUid`, rev 가 새 값이 된다.
5. 공용 이력에는 남기지 않는다(개인 행동 비노출, 이슈 §3.8).

- 시각만 있는 개인 일정의 `all_day` 는 0, 시각이 없으면 `all_day = 0` 에 시각 NULL(시각 없는 하루 일정. "하루 종일 바쁨" 을 자동으로 붙이지 않는다, 이슈 §3.6).
- 원본 과제명이 바뀌거나 접근을 잃어도 복사본은 그대로다. 출처 표시는 대응표의 `project_name_snapshot`.

### 5.6 다른 참여자의 변경 받기

- 웹이 타이머를 갖고 `projectCalendarRevs` 를 부른다. 조건: 과제 탭 활성, `document.visibilityState === 'visible'`, 위젯 창이 트레이나 최소화가 아님(호스트가 이미 `__setTray` 등으로 알려 주는 상태 재사용), 연결 정상, 관문 정상. 하나라도 아니면 멈춘다.
- 주기 30초(Q4). rev 가 바뀐 과제만 현재 범위를 다시 읽는다. 멤버십이 바뀌었으면 bootstrap 을 다시 읽는다.
- 탭 진입, 창 활성 복귀, 내 저장 직후에는 바로 확인한다.
- 연결 실패는 기존 장애 분류와 재연결 꼬리(15/30/60초 뒤 300초)를 그대로 쓴다. 공용 쪽 실패로 개인 화면을 비우지 않는다.
- 세대 번호(사용자, 탭, 선택 범위)로 늦게 온 옛 회신을 버린다(기존 `dataset.gen` 방식과 같은 생각).
- OFFLINE-RESILIENCE A11 에 "과제 탭이 보일 때의 rev 확인" 을 두 번째 예외로 적고, 루프 O6 는 개인 탭에서 그대로 0 을 확인한다.

---

## 6. 웹 설계 (`task-calendar-prototype.html`)

(아래 7 절의 코드 위치는 2026-10-22 HEAD `e19d073` 기준이다.)

### 6.1 지금 화면에서 확인한 사실

- 월간은 `renderGrid()`(10491) → `renderMonthGrid()`(10510~10669). 여러 날 일정은 **한 개의 막대 요소가 아니라 날마다 칩**이고 `seg` start/mid/end 와 음수 여백으로 이어 보인다(CSS 339~344). 주마다 탐욕 차선 배치(10563~10582), `fitChips()`(10691)가 "+N" 으로 접는다. **주간 보기는 없다.**
- 메모는 달력 칸에 나오지 않고 오른쪽 패널 카드에만 나온다(`cardHtml` 10781).
- 칩 클릭은 오른쪽 패널에서 그 일정을 보여 준다(그리드 클릭 18226). **클릭 미리보기 팝오버는 없다.** 기준이 될 만한 위치 보정 팝업은 열람 상대 고르기(`pkPlace` 7679)다.
- 오른쪽 패널 `aside#dayPanel`(2558) 은 상세, 할 일, 커밋 탭(`renderPanel` 10873). **접기 기능은 없다.** 760px 이하에서만 아래 시트가 된다. 폭은 `taskCalendar.panelW`(전역 키).
- 빠른 추가 `#quickAdd`(2664~2713, `openQuickAdd` 17287, 추가 칸은 `qaRenderDetail` 17357 이 장소 콤보, 반복, 종료일, 메모를 넣는다). 일정 입력 창 `#entryModal`(2574~2661, `openEntryModal` 11616, `saveEntryFromForm` 11679).
- 장소 콤보 A안(11964~12092)은 접두사로 재사용된다: 마크업 `.loc-combo[data-pfx]` + `#{pfx}Loc` + `#{pfx}LocPop` 뒤 `locBind(pfx)`. 목록은 `__applyCodes` 셋째 인자로 채워지는 `sharedRooms`.
- UI 설정은 모두 localStorage 다. 대부분 전역 키이고, 사람별 키는 `tc_peer<kind>:<loginId>` 같은 몇 개뿐이다. 보던 날짜와 보기는 저장하지 않는다(부팅 때 오늘).
- 전역 Esc 처리(18986~19020)는 닫을 팝업 목록을 **글자로 박아 둔다**(`['#moreMenu','#themeMenu','#jumpMonth']`, 19005). 새 팝오버는 여기에 넣어야 한다.
- `__applyProjects`(6421) 와 `mapDbRows`(6398) 가 공식 과제를 `db-<uid>` 로 바꾼다. 색은 `DB_SECTION_COLORS`(번호 기준)와 `sectionColor`.

### 6.2 상태와 설정

- 공용 상태는 새 모듈 객체 하나(`pc` 같은 이름)에 담는다: 참여 과제, 표시 선택, 보기(월간, 주간), 기준 날짜, 범위의 일정, rev, 세대 번호. **`state.entries` 에 섞지 않는다.** 개인 저장, XML, 전량 교체 경로는 공용 상태를 모른다.
- 모듈 상태 변수를 늘리지 않는다는 기존 규칙(HANDOFF §4, 늘어나면 멈추고 배관으로 풀 수 있는지 본다)을 지킨다. 공용 쪽은 객체 하나로 묶는다.
- 사람별 PC 설정(localStorage, 키에 loginId): 마지막 탭, 탭별 보기와 기준 날짜, 과제 표시 선택(**키 없음**과 **빈 배열**을 구분), 메모 첫 줄 표시(개인과 공용 공통, 기본 끄기), 오른쪽 패널 접힘(기본 펼침). 기존 전역 키(밀도, 패널 폭, 테마)는 그대로 둔다.
- 개인 탭의 "보던 날짜 기억" 은 지금 없는 동작이다. 이슈 §3.1 은 탭별 기억을 요구하므로 **개인 탭도 기억하게** 바꾸는 것이 기본안이다(Q7).

### 6.3 탭과 배치

- 상단 `header.topbar` 와 `#filterbar` 사이에 **개인 / 과제** 탭 줄. `insertBelowTitleBar()`(5449) 가 같은 자리 뒤에 장애 띠를 끼우므로, 띠가 탭 줄 아래에 오도록 그 함수의 삽입 기준을 탭 줄로 바꾼다(한 곳).
- 과제 탭에서는 `#filterbar`, `section.cal`, `#dayPanel` 대신 과제 화면 컨테이너 하나를 보인다. 개인 화면 DOM 은 지우지 않고 숨긴다(개인 미저장 상태, 저장 큐, 막대 상태가 그대로 산다).
- 상단 버튼 중 과제 탭에서 뜻이 없는 것(검색, 열람, 보고서, 새 일정)은 숨기거나 끈다. "새 일정" 자리는 과제 탭의 "일정 등록" 이 맡는다.
- 열람 창(`?peerwin=1`)과 관리 창(`?win=admin`)에는 탭이 없다.
- 브라우저 단독 모드: 과제 탭을 누르면 안내 한 장(3 절).

### 6.4 과제 탭 화면

- 왼쪽: "참여 과제 n / m", 전체 선택, 전체 해제(이슈 §3.3 의 켜짐과 꺼짐 규칙), 과제 줄(체크 = 표시와 숨김, 이름 = 단독 보기, 비활성 과제는 "종료/숨김, 읽기 전용" 표시), 제목 옆 **참여 과제 관리**.
- **참여 과제 관리 창:** 검색 칸, 활성 공식 과제 목록(이름 `common_name || project_name`, 동명이면 발주처와 구분을 덧붙임), 체크, 저장과 취소. 탈퇴가 섞이면 이슈 §3.2 의 확인 문구. 공식 과제 목록은 기존 `__applyProjects` 데이터(전원이 읽는 목록)를 쓴다. 이 창은 관리 허브가 아니라 메인 창의 일반 모달이다.
- 상단: 과제 제목(전체 또는 단독), 최근 변경, 일정 등록, 날짜 이동, 오늘, **월간 / 주간** 전환, 메모 첫 줄 표시 체크.
- **월간:** 공용 일정은 반복이 없으므로 **진짜 연속 막대**(주 단위로 잘린 한 요소)로 그린다. 배치는 순수 함수(입력: 일정, 주 범위 → 출력: 차선과 조각)로 만들어 시험한다. 정렬은 이슈 §3.4(시작일, 종료일 내림차순, 과제 표시 순서, uid). 시각 있는 하루 일정은 과제색 점 + 시각 + 제목. 칸 클릭은 그 날짜 선택, 막대 클릭은 **누른 날짜** 선택 + 미리보기.
- **주간:** 월요일~일요일 7열, 과제마다 고정 행(과제명 열 고정), 행 안에서 막대 차선과 시각 일정. 좁은 창은 날짜 영역만 가로 스크롤.
- **미리보기 팝오버:** 앵커 근처, 화면 밖이면 위치 보정(`pkPlace` 방식), 바깥 클릭, Esc, 닫기. 내용은 제목, 과제, 기간과 시각, 메모 3줄, "상세와 전체 메모 보기". 키보드(Enter)와 터치로도 열린다. 전역 Esc 목록에 등록.
- **상세 창:** 전체 메모, 과제명, 날짜, 시간, 장소, 작성자, 수정, 삭제, **개인 일정에 등록**(이미 했으면 "개인 일정에 등록됨" 으로 끔).
- **등록과 수정 폼:** 저장할 과제(전체 보기에서는 "과제를 선택하세요" 로 시작, 단독 보기는 그 과제), 제목, 시작일, 종료일, 시간 지정 스위치(켜면 같은 날짜의 시작과 종료 시각), 접힌 "메모와 장소" (값이 있으면 펼쳐서 엶). 장소는 **콤보 A안**(`locBind('pc')` 같은 새 접두사). 검증과 상한은 이슈 §3.6. 저장 중 중복 제출 막기, 실패와 충돌이면 입력 유지, 충돌이면 "최신 내용 확인 / 입력 유지".
  - 시안(final.html)은 전체 보기에서도 첫 과제가 미리 골라져 있다. **이슈 문장(§3.6, "과제를 선택하세요")을 따른다.**
- **최근 변경 창:** 넓은 모달. 묶기(과제별 기본, 날짜순, 일정별), 과제 필터(현재 표시 선택 안으로만), 기간(7일 기본, 30일, 전체, 기준은 수정 시각, KST 날짜), 항목(모두, 날짜와 시간, 메모, 삭제), 변경 전후 값, 50건씩 "더 보기", 불러온 수와 더 있음 표시.
- 0개 표시 상태: 목록과 버튼은 남고 달력에 "표시할 과제를 선택하세요".
- 모든 사용자 입력은 `textContent` 또는 기존 이스케이프 함수로만 그린다.
- 색: 같은 사용자의 공식 과제 분류(`db-<uid>`)가 있으면 그 색, 없으면 `sectionColor(sectionId)`. 이름도 함께 보여 색만으로 구분하지 않는다.
- 편집 잠금: 연결 끊김과 관문 차단 때 기존 `guardEdit()`, `body.db-locked` 를 과제 탭 쓰기 버튼에도 건다. 공용 쓰기는 개인 저장 큐와 따로 돈다(공용은 단건 즉시 저장).

### 6.5 개인 캘린더 개선 (P3)

- **월간:** 개인 일정은 반복 전개, 예외, 할 일 칩, 커밋, 열람 겹침 차선이 얽혀 있어 **렌더 방식을 통째로 바꾸지 않는다.** 지금의 이어 보이는 칩을 유지하면서 (a) 시각 있는 하루 일정은 점 + 시각 + 제목으로 막대와 위계를 나누고, (b) 이어짐 표시와 제목 반복을 공용 월간과 같은 모양으로 맞추고, (c) 메모 첫 줄 표시와 클릭 미리보기를 공용과 같은 함수로 붙인다. 칩 클릭의 "누른 날짜 선택" 은 그대로(18234~18235).
  - 공용 월간처럼 한 요소짜리 연속 막대로 바꾸는 것은 기본안이 아니다(Q3). 회귀 위험이 크고 이슈의 개인 쪽 요구(가시성)는 위 셋으로 충족된다고 본다.
- **입력:** 빠른 추가와 입력 창에서 "시간 지정" 을 스위치로(끄면 시각 숨김), 장소, 반복, 알림, 메모, 저장소는 "추가 옵션" 으로 접는다. 값이 있는 옵션은 펼쳐서 연다. 접기는 값을 버리지 않는다. 종일 플래그, 시작 시각만 있는 기록, 반복, 알림, Git/SVN, 할 일 모드는 그대로 동작해야 한다.
- **오른쪽 패널 접기:** 패널 머리에 접기 단추, 접히면 가는 띠에 상세, 할 일, 커밋 진입 단추만 남는다(이슈 §4 "진입 버튼은 항상 남김"). 접힌 상태에서 칩 클릭은 미리보기, 상세는 미리보기에서. 기본 펼침, 사람별 기억. 760px 이하의 아래 시트 동작은 그대로. `setupSplitter()`(19046) 는 접힘 동안 끈다.

### 6.6 이 기능이 하지 않는 것 (화면)

이슈 §12 의 제외에 더해: 관리 허브(`#adminHub` 2798~2846, JS 10964~11373)와 그 안 화면(공식 과제 편집, 휴지통 화면 등)은 손대지 않는다. 휴지통의 새 거부 문구는 호스트가 고정 문구로 돌려주므로 화면 수정이 필요 없다.

---

## 7. 다른 진행 작업과의 관계와 병합 충돌 지점

### 7.1 관계

| 진행 작업 | 상태 | 이 기능과의 관계 |
|---|---|---|
| 버전 관문과 배포 SQL 하나(구조 14) | 구현과 QA 완료, 배포 전 | 새 조각은 이 방식을 그대로 따른다. 16 이 들어가면 다음 `release-v<버전>.sql` 이 13 에서 16 까지 한 파일로 올린다 |
| 회의실 공용화(구조 15) | 구현과 QA 완료, 배포 전 | 장소 콤보 A안을 재사용한다. 구조 번호는 그 다음 16 |
| 관리 화면 별도 창 | 기획 확정, 다른 세션에서 개발 예정(`.claude/worktrees/admin-window`) | 관리 허브 영역은 손대지 않는다. 겹치는 곳은 `MainWindow.xaml.cs` 의 명령 스위치와 창 종류별 허용 목록, `ProjectDb.cs`(휴지통), 공유 모달 함수(`openModal`, `closeOverlay`, Esc) |
| 시험 파일 줄끝 정리 | 다른 세션이 부모 체크아웃에서 진행 중 | 시험 파일을 고치는 단계(P1 부터)는 그 작업이 `feat/db-app` 에 들어간 뒤 그 위에서 시작한다. 그 전에는 시험 파일을 만지지 않는다 |

- **구조 번호 순서:** 이 기능의 16 보다 먼저 다른 구조 변경이 `feat/db-app` 에 들어가면, 이 조각의 번호를 그 다음으로 바꾼다(머리, 확인값, 끝 줄, `AppStructureVersion`, 정본 시드, release-sql 시험). 조각 규칙이 한 칸씩이라 바꾸는 곳은 기계적이다.
- **배포 묶음:** 서버는 아직 13 이고 사용자가 없다. 첫 사내 배포(0.23.0) 전에 이 기능이 끝나면 같은 배포에 실어도 사용자 부담이 늘지 않는다(구조 변경 배포는 어차피 한 번). 늦어지면 다음 판으로 따로 낸다. 첫 배포를 이 기능 때문에 미루지는 않는 것이 기본안이다(Q1).

### 7.2 예상 병합 충돌 지점

`task-calendar-prototype.html`(줄 번호는 `e19d073`):

| 영역 | 위치 | 누가 같이 만지나 |
|---|---|---|
| 상단 막대와 탭 줄 자리 | `header.topbar` 2441~2529, `#moreMenu` 2484~2522, `insertBelowTitleBar` 5449 | 관리 창(⋯ 메뉴의 ⚙ 관리 동작 변경) |
| 월간 렌더 | `chipHtml` 10414, `renderMonthGrid` 10510~10669, `fitChips` 10691 | P3 자신, 열람 겹침 작업이 있으면 그것 |
| 그리드 클릭과 키보드 | 18226~18319 | 기간 칩 클릭 수정 이력, P3 |
| 오른쪽 패널 | `renderPanel` 10873, `setPanelTab` 16959, `setupSplitter` 19046 | P3 |
| 빠른 추가와 입력 창 | `#quickAdd` 2664~2713, `openQuickAdd` 17287~17390, `#entryModal` 2574~2661, `openEntryModal`/`saveEntryFromForm` 11616~11733 | 회의실 공용화 후속, P3 |
| 장소 콤보 | 11964~12092 | 재사용만(고치지 않는 것이 목표) |
| 공식 과제 데이터 | `__applyProjects` 6421~6450, `subscribeDbCat` 9526 | 관리 창(목록 갱신 알림을 두 창으로) |
| 모달 공통과 Esc | `openModal`/`closeOverlay` 11384~11421, `setupModalA11y` 11504, 전역 Esc 18986~19020 | 관리 창(허브 닫기를 창 닫기로) |
| 호스트 다리 | `hostRequest` 19486, `__hostReply` 19497 | 관리 창(회신 접두사 라우팅) |

호스트와 시험:

- `widget/MainWindow.xaml.cs`: `OnWebMessage` 스위치 532~982(약 90개 case), 열람 창 허용 목록 `PeerWinCommands` 453~457. 관리 창 작업이 창 종류별 허용 목록과 접두사 라우팅을 넣는 곳이다. 새 case 는 스위치 끝 쪽 한 덩어리로 모아 넣어 충돌 면적을 줄인다. **이 파일은 줄끝이 섞여 있다(`\r\r\n` 다수, 정확히 24 CRLF, LF 0).** 편집은 바이트 스크립트로 하고 전후 개수를 확인한다(HANDOFF §5).
- `widget/ProjectDb.cs`: 휴지통 영구 삭제(2560~2640), `UserRecordTables`(2145). 관리 창 작업은 주로 창 배관이라 이 두 곳과는 덜 겹치지만 같은 파일이다.
- `widget/DbGate.cs` 의 구조 번호 한 줄, `db/deploy/schema-calendar.sql`, `grants-calendar.sql`: 다른 구조 변경과 겹치면 번호 조정.
- 시험: `tests/release-sql.test.mjs`(사슬 기대), `schema-guards`, `canon-schema`, `schema-integrity`, `setup-taskcalendar`, `version-gate-host`(`new MySqlConnection` 위치), `trash-host`(영구 삭제 판정과 계약 ③), `admin-hub` 계열(관리 창 작업이 바꾸는 중), 장소 콤보와 빠른 추가를 박아 둔 시험(app-context, pure-logic, offline-web, layout-stability), `loop-range-chip`, `loop-ui-visual`, `loop-calendar-write`(러너 .cs 목록).
- `prototype.html` 은 전역 치환 금지(임베드 base64 16블록). 고유 앵커로만 고치고 끝나면 base64 동일성을 확인한다.

---

## 8. 단계 나누기와 단계별 QA

### 8.1 이 PC 에서 QA 할 때의 규칙 (모든 단계 공통)

- **DB 실험은 복사본에서만.** 개발 PC 의 공용 개발 DB `taskcalendar`(지금 15)를 이 기능 개발 중에 16 으로 올리지 않는다. 구조 번호가 정확히 같아야 동작하는 관문 때문에, 올리는 순간 **다른 세션의 디버그 위젯(구조 15)이 전부 "업데이트 필요" 로 막힌다.** 16 은 이 기능을 `feat/db-app` 에 병합할 때 백업 뒤 배포 SQL 로 올린다.
- 복사본 만들기: `taskcalendar` 를 덤프해 `taskcalendar_pc`(이름은 제안) 로 붓고, 개발 PC 앱 계정에 그 DB 의 표 권한(정본 권한 파일과 같은 내용)을 root 로 준다. 그다음 그 사본에 `release-v<시험버전>.sql` 을 돌려 15 에서 16 으로 올린다(같은 권한의 시험 계정으로, DB-RELEASE-OPS §5.3 의 리허설 그대로).
- 디버그 위젯을 사본에 붙이는 방법: 지금 DB 이름은 빌드 상수(`DeployConfig.DbName`)다. **Debug 빌드에서만 읽는 환경변수 재정의**(예: `TC_DB_NAME`, `#if DEBUG`)를 P1 에서 넣고, Release 빌드가 그것을 무시함을 시험으로 고정한다(열린 질문 Q8). 이게 없으면 사본 QA 를 할 수 없다.
- **위젯 실동작 QA 는 조율한다.** 위젯은 한 PC 에 하나만 뜨고(단일 인스턴스), 루프는 CDP 포트 9222 를 쓴다. 다른 세션이 위젯이나 루프를 돌리는 중이면 기다린다. 시작 전에 실행 중인 위젯과 9222 사용 여부를 확인하고, 끝나면 원래 빌드(또는 꺼진 상태)로 돌려 둔다.
- 두 사용자 시나리오(공동 편집, 충돌)는 위젯 하나로는 못 한다. **C# 러너 기반 DB 계약 시험**(기존 `loop-calendar-write` 방식: 같은 호스트 클래스를 두 세션 값으로 두 번 부름)으로 본다. 화면 쪽은 위젯 하나와 러너가 만든 "다른 사람의 변경" 을 받아 폴링 반영을 본다.
- 루프와 실 DB 회귀(`dist/rehearsal/run-loops.ps1`)는 메인 세션이 직접 돌린다. DB 비밀번호는 stdin 으로만.
- 시험이 끝나면 사본의 시험 데이터만 지우거나 사본째 지운다. 공용 개발 DB 는 건드리지 않았음을 행 수와 구조 번호로 확인한다.
- 게이트: `TC_TEST_STRICT=1 node tests/run-tests.mjs` exit 0(0 fail, 0 skip), Debug 빌드 경고 0. HTML 은 EmbeddedResource 라 HTML 을 바꾸면 Debug 재빌드 뒤 재기동.

### 8.2 단계

**P1: DB 와 호스트 (화면 없음)**
- 내용: 정본 DDL, `v16-project-calendar.sql`, 권한 파일, `AppStructureVersion 16`, `ProjectCalendarDb`, 명령 9개, 휴지통 판정 두 곳, 개인 복사 트랜잭션, Debug 전용 DB 이름 재정의.
- 정적 시험: 새 표 정의가 정본과 조각에서 글자까지 같음, 조각 규칙(release-sql 조립기 검사), `new MySqlConnection` 0곳, 쓰기 첫 문장이 rev ODKU, 관문 재확인이 커밋 바로 앞, 명령이 관리 창과 열람 창 허용 목록 밖, 웹이 보낸 사용자 값을 쓰지 않음.
- DB 계약 시험(사본, 두 사용자): 참여와 탈퇴와 재참여, 비참여자 거부, viewer 쓰기 허용, 같은 판 동시 수정 하나만 성공, 응답 유실 뒤 재시도 중복 없음, no-op 이력 없음, 삭제 뒤 제목 스냅샷, 과제 숨김 뒤 읽기 전용, 공용 일정이 있는 과제 영구 삭제 거부, 없는 과제는 CASCADE, 개인 복사의 중복 방지와 대응표 CASCADE, 복사 실패 시 개인 행 0.
- 배포 SQL 리허설(사본): 13, 14, 15 사본에서 16 까지 한 번에, 다시 실행, 중간 실패 뒤 재실행.
- 완료 기준: 위 전부 통과, 공용 개발 DB 무변경.

**P2: 과제 탭 (월간, 주간, 등록, 미리보기, 최근 변경, 참여 관리, 복사)**
- 내용: 6 절의 과제 탭 전부.
- 정적 시험: 순수 계산(막대 행 배치, 주와 달 경계 자르기, 정렬 고정 규칙, 윤년과 같은 날짜와 366일, 주간 행 높이), 선택 집합 저장(설정 없음과 빈 집합 구분), 메모 첫 줄 추출, 텍스트로만 렌더(HTML 같은 글자), DTO 왕복.
- 실동작(사본, 위젯 하나 + 러너): 참여 관리, 과제 0/1/3/6개 선택, 월간과 주간 전환, 단독 보기, 등록과 수정과 삭제, 충돌 안내(러너가 먼저 수정), 폴링 반영과 숨김 중 멈춤, 최근 변경 세 묶음과 더 보기, 개인 복사 뒤 개인 탭에 출처와 함께 보임, 320/760/1024/1440px 와 짧은 높이, 모든 테마, 키보드.
- 완료 기준: 이슈 §10 수용 기준 중 과제 탭 항목 전부.

**P3: 개인 캘린더 개선** (2026-10-22 사용자 결정 Q3: 이번 작업 범위에서 뺀다. 아래는 나중을 위한 기록이다)
- 내용: 개인 월간 연속 막대와 시각 일정 위계, 메모 첫 줄과 미리보기 재사용, 개인 입력 폼과 빠른 추가의 추가 옵션 접기, 오른쪽 패널 접기.
- 회귀가 이 단계의 핵심이다: 반복 전개와 예외, 여러 날, 오늘, 공휴일, 검색, 밀도, 할 일 칩, 커밋 라벨, 기간 칩 클릭(`loop-range-chip`), 종일과 시각 없는 하루와 시작 시각만 있는 기록, 알림, 반복, Git/SVN, 회의실 콤보, 보고서, 공수, 근태, XML, 열람 창. 기존 실동작 시험 전체(`run-loops`)와 `loop-ui-visual`.
- 완료 기준: 이슈 §10 의 개인 항목과 회귀 항목 전부.

**P4: 문서와 배포 준비**
- `docs/wiki/`(사용자: 과제 탭, 참여, 복사), DB-RELEASE-OPS 의 A11 예외, CALENDAR-TABLE-DESIGN 공용 트랙 절, SPEC.md(공용은 XML 에 없음), ARCHITECTURE §4 명령 표, HANDOFF.
- 병합 때: 공용 개발 DB 백업, 배포 SQL 로 16, 개발 PC 앱 계정 GRANT, 기존 루프 전체.
- 버전 올리기와 인스톨러는 사용자가 "버전 갱신" 을 지시할 때 릴리스 체크리스트로(이 기능 범위 밖).

단계마다 PR(또는 커밋 묶음)을 나눌 수 있다. P2 와 P3 는 같은 HTML 의 다른 영역이지만 월간 렌더 공통 부분(막대 배치, 미리보기)을 P2 에서 만들고 P3 가 재사용하므로 **순서대로** 한다. P1 이 끝나기 전에는 P2 의 실동작 QA 를 할 수 없다.

---

## 9. 열린 질문 (사용자 결정 필요, 각 기본안 포함)

| # | 질문 | 기본안(제안) | 다른 안 |
|---|---|---|---|
| Q1 | 이 기능을 첫 사내 배포(0.23.0, 구조 13 에서 15)에 함께 실을까 | **첫 배포를 미루지 않는다.** 그 전에 P1~P3 가 끝나면 함께 싣고(13 에서 16 한 파일), 아니면 다음 판(0.24.0)으로 | 첫 배포를 이 기능 완료까지 미룸 |
| Q2 | DB 외래키를 번호(`project.id`, `event_id`)로 할까, 이슈처럼 uid 로 할까 | **번호.** CODE-TABLE-IDS 규칙. 웹과 호스트 사이는 uid 그대로 | 이슈대로 `project_uid CHAR(36)` FK |
| Q3 | 개인 월간을 공용처럼 한 요소짜리 연속 막대로 다시 짤까 | **아니다.** 지금 칩 구조를 두고 시각 일정 위계, 이어짐 모양, 메모 첫 줄, 미리보기만 맞춘다(회귀 위험 때문) | 공용과 같은 렌더러로 통일(P3 가 크게 늘어남) |
| Q4 | 과제 탭의 다른 참여자 변경 확인 주기 | **30초**, 과제 탭이 보이고 창이 보일 때만. A11 의 두 번째 예외로 문서화 | 60초, 또는 폴링 없이 탭 진입과 창 활성 복귀 때만 |
| Q5 | 공용 일정을 쓴 사람의 휴지통 영구 삭제 | **막는다**(공용 일정, 이력, 복사를 "기록" 으로 셈, 사용자 FK RESTRICT). 멤버십만 부속 행처럼 함께 지운다. 퇴사 처리는 지금처럼 가능 | 이슈대로 FK SET NULL 로 두고 기록이 있어도 삭제 허용 |
| Q6 | 개인 복사 때 분류 편입을 같은 호스트 트랜잭션에 넣을까 | **넣지 않는다.** 웹이 `subscribeDbCat()` 로 편입하고 저장한 뒤 호스트가 일정과 대응표만 한 트랜잭션으로 | 편입 규칙을 C# 에도 두고 한 트랜잭션(규칙 두 벌) |
| Q7 | 개인 탭도 보던 날짜와 탭을 기억할까(지금은 부팅 때 오늘) | **기억한다**(사람별, 이슈 §3.1). 단 앱을 새로 켜면 오늘로 갈지는 한 번 더 확인 필요 | 과제 탭만 기억, 개인은 지금처럼 오늘 |
| Q8 | 디버그 위젯을 복사본 DB 에 붙이는 방법 | **Debug 빌드 전용 환경변수 재정의**(`TC_DB_NAME`), Release 는 무시함을 시험으로 고정 | 시험할 때만 `DeployConfig.DbName` 을 손으로 바꿔 빌드(커밋 금지, 실수 위험) |
| Q9 | 공용 일정 제목 열 형 | **`VARCHAR(200)`**(실제 상한을 형으로) | 이슈대로 MEDIUMTEXT + 앱 상한 |
| Q10 | 과제 감시점 표 이름 | **`cal_project_rev`**(`cal_user_rev` 와 짝) | 이슈대로 `cal_project_calendar` |
| Q11 | 다른 사람의 멤버십을 관리자가 보거나 고치는 기능 | **이번에는 없음**(이슈 그대로). 필요하면 관리 창 후속 | 관리 창에 "과제별 참여자" 읽기 화면 추가 |

Q1, Q2, Q3, Q5 는 P1 착수 전에 정해야 한다. 나머지는 해당 단계 전까지 정하면 된다.

---

## 10. 결정 이력

- 2026-10-22: 이슈 14 를 지금 HEAD(`e19d073`, 구조 15)에 맞춘 적용 기획 초안. 사용자 검토 대기.
- 2026-10-22 사용자 답:
  - Q1: **첫 사내 배포에 함께 싣는다.** 사내 서버 DB 로 옮긴 판은 아직 배포 전이고, 개발 PC 의 로컬 서버 DB 에서 계속 구축 중이다.
  - Q2: **번호 키.** DB 외래키는 `project.id`, `event_id` 를 가리킨다.
  - Q3: **이번 작업은 과제 캘린더만.** 개인 캘린더 개선(P3)은 이번 범위에서 빼고 나중에 따로 정한다. 개인 월간을 어떻게 바꿀지도 그때 정한다.
  - Q10: 표 이름은 나중에 정한다. 이 문서의 이름은 가칭이다.
  - Q4: 더 고민한다(열림).
  - Q5, Q6, Q7, Q8, Q9: 설명을 요청함. 답을 받으면 적는다.
- 2026-10-22 논의 중(확정 전):
  - Q5 제안: 공용 일정의 글쓴이는 이름(과 로그인 id)을 글자로만 남기고 `app_user` 외래키를 걸지 않는다. 직원 삭제와 무관해진다. 참여 행만 사람을 가리키고, 영구 삭제 때 함께 지운다.
  - Q6 사용자 제안: **"내 과제"에 편입된 공식 과제가 곧 과제 탭에 보이는 과제(참여)**. 이렇게 하면 별도 참여 관리 창과 참여 표가 필요 없고(서버는 `cal_category` 로 판정), 개인 일정 등록 때 편입 단계가 없어진다. 주의: 지금 내 과제에서 과제를 빼면 그 과제의 개인 일정, 할 일, 공수가 함께 지워진다. 공용 일정만 가리려면 과제 탭 체크 해제를 쓰도록 안내한다. 이슈 명세(참여와 편입은 별개)와 다른 방향이다. 확정되면 3.2 참여 관리, 4.2 참여 표, 5.5 개인 복사를 이 모델로 고친다.
  - Q7: 과제 탭 화면 상태는 localStorage(계정별 키)가 기본안. 위젯과 브라우저 모두 같은 코드로 동작하고(분기 없음) 저장 위치만 다르다(서로, 그리고 PC 끼리 공유되지 않음). PC 를 바꿔도 따라와야 하면 DB(`cal_user_pref`).
  - Q8: 복사본 DB 는 이 PC MySQL 안에 `taskcalendar` 를 복제한 두 번째 DB. 개발 중 16 으로 올려도 다른 세션의 디버그 위젯(15)이 막히지 않게 하려는 것.
  - Q9: 과제 일정 제목 열은 `VARCHAR(200)` 제안(사람이 입력, 화면 상한 200자). 개인 제목이 MEDIUMTEXT 인 이유(커밋 제목 유입)가 공용에는 없다.
  - Q4: 열림. 선택지는 30초 자동 확인, 탭 진입과 창 복귀 때만, 새로고침 버튼만.
- 2026-10-22 Q4 확정: **주기 확인 없음.** 과제 탭 진입, 창 복귀, 내 저장 직후에만 확인하고 새로고침 버튼을 둔다. A11(정상일 때 주기 DB 접속 0)을 그대로 지킨다. 5.6 절의 30초 확인은 적용하지 않는다.
- 2026-10-22 Q5 확정: **글쓴이와 변경자는 직원 이름만 글자로 저장한다.** `app_user` 외래키와 사람 번호 열을 두지 않는다(4.2 의 `created_by`, `updated_by`, `actor_user_id` 와 로그인 스냅샷은 빼고 이름 열만). 직원 삭제, 휴지통과 무관하다. 4.3 의 `UserRecordTables` 변경도 필요 없다.
- 2026-10-22 Q8 정리: 개발 DB 운용(복사본 DB, Debug 전용 DB 이름 재정의)은 개발 때 정할 일이라 기획 결정 항목에서 뺀다. 8.1 의 "공용 개발 DB 는 병합 때 16 으로" 원칙만 남긴다(다른 세션의 디버그 위젯이 막히지 않게).
- 2026-10-22 Q7 확정: 과제 탭 화면 상태는 **localStorage, 로그인 계정별 키**로 기억한다(위젯과 브라우저 모두 같은 코드, 저장 위치만 다름). 기억하는 것: 마지막 탭, 월간과 주간, 체크한 과제(설정 없음과 빈 선택을 구분), 메모 첫 줄 표시. **날짜는 다시 켜면 오늘**로 돌아간다(개인 캘린더와 같게).
- 2026-10-22 Q9 확정: 과제 일정 **제목은 최대 100자**(`VARCHAR(100)`, 화면 입력 칸과 호스트 검사도 100). 달력은 말줄임으로 자르므로 상한이 달력 모양을 바꾸지는 않는다. 개인으로 복사할 때 개인 제목 칸(200자)에 그대로 들어간다. 4.2 의 `title`, `title_snapshot` 과 이슈 §3.6 의 200자는 이 값으로 읽는다. 메모 상한은 따로 정한다.
- 2026-10-22 Q6 확정: **과제 탭 = 내 과제에 넣은 공식 과제.** 참여 표와 참여 관리 창은 만들지 않는다. 판정은 서버 함수 하나. 관리자나 PM 의 과제별 참여인력 배정(검토자 의견)은 별도 작업으로 나누고, 그때도 관리자는 남의 내 과제에 쓰지 않는다(2.1 절).
