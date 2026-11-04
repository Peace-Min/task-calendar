# 개인별 알림함 1단계: 알림함과 과제 일정 멘션 (0.27.0 후보, 구조 21)

상태: 보류(2026-11-04 사용자: 전체 배포 전이라 과제 멘션 알림은 미룬다. 먼저 다른 과제 보기, docs/PC-WATCH.md). 설계 초안과 DB 전문가 검토 결과는 다시 열 때 쓴다. 관련 이슈 #18. 시안 dist/proto/notify-v2.html.

## 0. 범위

- 1단계 = **알림함**(그릇) + 알림을 만드는 것 하나(**과제 일정 멘션**, 알림만).
- 2단계 = 멘션에 "완료 체크 받기"(수행 요청), 사람별 완료, 등록자 현황. 이 문서 9절에 자리만 잡아 둔다.
- 3단계 = 공식 과제 추가 요청과 관리자 승인, 반려(요청 기능 기획부터 따로).
- 하지 않는 것(2026-11-04 사용자): **중요 일정 알림은 만들지 않는다**. 전원 알림은 멘션으로 사람을 고르는 것으로 대신한다.
- 기존 **미리알림**(일정 시작 전, 이 PC 안의 시간 알림)과 섞지 않는다. 알림함은 다른 사람이 만든 사건만 담는다.

## 1. 용어

| 말 | 뜻 |
| --- | --- |
| 알림(사건) | 한 번 일어난 일. 누가, 무엇을, 어디에. 받는 사람이 여럿이어도 한 건 |
| 받음 | 사건 하나를 사람 한 명이 받은 것. 읽음은 여기에 사람별로 남는다 |
| 멘션 | 과제 일정의 "알릴 사람"에 고른 사람. 일정에 붙어 남는다(편집 때 다시 보임) |

## 2. DB (구조 21)

### 2.1 cal_notice: 알림 사건

```sql
CREATE TABLE cal_notice (
  notice_id      BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  kind           VARCHAR(20)       NOT NULL,              -- 'pe_mention' (1단계는 이것 하나)
  actor_user_id  SMALLINT UNSIGNED NOT NULL,              -- 일으킨 사람(app_user.user_id)
  target_type    VARCHAR(20)       NOT NULL,              -- 'pevent' (과제 일정)
  target_id      INT UNSIGNED      NOT NULL,              -- cal_project_event.event_id
  project_id     INT UNSIGNED      NULL,                  -- 목록에 과제명을 보이고 이동할 때 쓴다(project.id)
  title_snap     VARCHAR(200)      NOT NULL DEFAULT '',   -- 그때의 제목(대상이 지워져도 목록에 보일 글)
  created_at     DATETIME(3)       NOT NULL,              -- UTC
  PRIMARY KEY (notice_id),
  KEY ix_cal_notice_target (target_type, target_id),
  CONSTRAINT fk_cal_notice_actor FOREIGN KEY (actor_user_id) REFERENCES app_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
```

- 대상(target)에 FK 를 걸지 않는다. 종류마다 대상 표가 다르고(2, 3단계), 대상이 지워져도 알림은 남아야 한다. 화면은 대상을 다시 읽어 지워졌으면 "삭제된 일정"으로 흐리게 보인다.
- kind, target_type 은 글자 열이다. ENUM 으로 두면 종류를 더할 때마다 구조가 바뀐다. 허용 값은 호스트 상수 한 곳에서 거른다.
- 사건 행은 더하기만 한다(수정, 삭제 없음).

### 2.2 cal_notice_recv: 사람별 받음과 읽음

```sql
CREATE TABLE cal_notice_recv (
  user_id     SMALLINT UNSIGNED NOT NULL,                 -- 받는 사람
  notice_id   BIGINT UNSIGNED   NOT NULL,
  read_at     DATETIME(3)       NULL DEFAULT NULL,        -- NULL = 안 읽음
  created_at  DATETIME(3)       NOT NULL,                 -- 받은 시각(= 사건 시각). 목록 정렬과 90일 판정에 쓴다
  PRIMARY KEY (user_id, notice_id),
  KEY ix_cal_notice_recv_unread (user_id, read_at, created_at),
  CONSTRAINT fk_cal_notice_recv_notice FOREIGN KEY (notice_id) REFERENCES cal_notice (notice_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_cal_notice_recv_user   FOREIGN KEY (user_id)   REFERENCES app_user (user_id)    ON DELETE RESTRICT ON UPDATE RESTRICT
);
```

- PK (user_id, notice_id) 가 곧 **같은 사건이 같은 사람에게 두 번 생기지 않게** 막는 키다(이슈의 멱등성).
- 목록: `WHERE user_id = ? AND created_at >= now - 90일 ORDER BY created_at DESC, notice_id DESC LIMIT 30` (PK 와 ix 로 읽는다).
- 안 읽은 수: `SELECT COUNT(*) FROM (SELECT 1 FROM cal_notice_recv WHERE user_id = ? AND read_at IS NULL AND created_at >= ? LIMIT 100) t`. 100 에서 멈추고 화면은 99+ 로 보인다. ix_cal_notice_recv_unread 하나로 끝난다.
- 읽음은 `UPDATE ... SET read_at = now WHERE user_id = ? AND notice_id = ? AND read_at IS NULL`. 모두 읽음은 같은 조건에서 notice_id 를 뺀다. 늘 **자기 user_id** 조건이 붙는다(남의 읽음을 바꿀 수 없다).

### 2.3 cal_project_event_mention: 일정의 알릴 사람

```sql
CREATE TABLE cal_project_event_mention (
  event_id    INT UNSIGNED      NOT NULL,                 -- cal_project_event.event_id
  user_id     SMALLINT UNSIGNED NOT NULL,                 -- 고른 사람
  added_by    SMALLINT UNSIGNED NOT NULL,                 -- 고른 사람(편집자)
  added_at    DATETIME(3)       NOT NULL,
  PRIMARY KEY (event_id, user_id),
  KEY ix_cal_pem_user (user_id),
  CONSTRAINT fk_cal_pem_event FOREIGN KEY (event_id) REFERENCES cal_project_event (event_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_cal_pem_user  FOREIGN KEY (user_id)  REFERENCES app_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cal_pem_by    FOREIGN KEY (added_by) REFERENCES app_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
```

- 일정을 다시 열면 알릴 사람이 칩으로 보이고, 저장 때 **새로 더한 사람에게만** 알림이 간다(같은 사람에게 저장할 때마다 가지 않는다).
- 2단계에서 이 표에 `done_at`, `done_note` 열을 더해 수행 요청을 얹는다(9절).
- 일정은 소프트 삭제라 CASCADE 가 실제로 돌 일은 없다. 행을 진짜 지우는 관리 작업이 생겨도 멘션이 고아로 남지 않게 둔다.

### 2.4 저장 규칙(호스트 ProjectCalendarDb, 한 트랜잭션)

1. 일정 저장(지금 그대로, row_version 낙관적 잠금).
2. 받은 멘션 목록과 지금 표를 비교한다.
   - 빠진 사람: 행 삭제(이미 간 알림은 남는다).
   - 더한 사람: 행 추가.
3. 더한 사람 중 **나와 비활성 사용자를 뺀** 사람이 있으면, `cal_notice` 한 건 + 사람마다 `cal_notice_recv` 한 건.
4. 하나라도 실패하면 전부 되돌린다(일정은 저장됐는데 알림만 빠지는 일이 없다).

- 상한: 한 일정에 알릴 사람 50명. 넘으면 저장을 막고 이유를 보인다.
- 반복 일정에도 멘션은 된다(알림만이라 회차가 상관없다). 수행 요청(2단계)은 반복 일정에서 막는다.

### 2.5 권한(grants-calendar.sql)

| 표 | 권한 | 이유 |
| --- | --- | --- |
| cal_notice | SELECT, INSERT | 사건은 더하기만 |
| cal_notice_recv | SELECT, INSERT, UPDATE | 읽음 기록. 지우지 않는다 |
| cal_project_event_mention | SELECT, INSERT, DELETE | 알릴 사람 빼기 |

### 2.6 보관

- 1단계는 **지우지 않는다**. 화면은 최근 90일만 읽는다. 사람당 하루 몇 건 수준이라 몇 년 쌓여도 작다.
- 지우는 정리가 필요해지면 관리자 화면 작업으로 따로 둔다(앱 계정에 DELETE 를 주지 않기 위해서).

### 2.7 배포

- 구조 20 → 21. 이관 조각 `db/deploy/migrations/v21-notice.sql`(CREATE TABLE IF NOT EXISTS 세 개, 권한), schema-calendar.sql 과 글자까지 같게(release-sql 시험).
- 조각 안의 DELETE, UPDATE 는 없다(새 표만). 버전 관문 규칙 그대로(Setup 먼저, SQL 은 db_updating 닫고 열기).
- 데모 SQL(db/demo/build-demo-sql.mjs) 구조 21 대응.

## 3. 호스트 명령(웹 → C#)

| 명령 | 인자 | 회신 |
| --- | --- | --- |
| noticeCount | 없음 | { ok, unread } (최대 100) |
| noticeList | { before?: notice_id } | { ok, rows: [{ id, kind, actor, targetType, targetId, projectId, projectName, title, targetGone, createdAt, readAt }], more } |
| noticeRead | { id } | { ok } |
| noticeReadAll | 없음 | { ok, n } |
| (기존) pcEventSave | + mentions: [user_id] | 지금 회신 + { notified: n } |

- 열람 창(PEER), 관리 창, 근태 창은 알림 명령을 쓰지 않는다(메인 창만).
- 오프라인(서버 장애)이면 종은 회색, 숫자 없음, 누르면 "서버에 닿지 않아 알림을 읽지 못했습니다" 한 줄.

## 4. 조회 주기

- 메인 창이 보일 때 **60초마다 noticeCount 하나**. 숨김(트레이)이면 5분마다. 목록은 종을 열 때만 읽는다(30건씩, 아래로 내리면 더).
- 앱 시작과 로그인 직후 한 번 바로 센다(꺼져 있던 동안 온 알림).
- 수가 늘었으면(이전보다 큼) 새 알림이 온 것으로 본다(5절 Windows 알림).

## 5. UI/UX

### 5.1 종
- 자리: 상단 호스트바, [내 과제] 왼쪽. 선 아이콘 종 하나(장식 아이콘 금지 규칙의 예외가 아니라 기능 단추다. title "알림").
- 안 읽음이 있으면 빨간 배지에 수(99 넘으면 99+). 없으면 배지 없음. 자리 폭은 늘 같다(배지는 단추 모서리에 겹친다, 출렁임 없음).

### 5.2 알림 목록(팝오버)
- 종 아래 380px 팝오버. 좁은 창(480 미만)에서는 좌우 8px 남긴 시트.
- 머리: "알림", "안 읽음 n", 오른쪽 [모두 읽음](안 읽음 0 이면 흐림).
- [전체 | 안 읽음] 한 줄 고르기.
- 한 줄: 아이콘(@), "**김하늘**님이 일정에서 나를 언급했습니다", 둘째 줄 "[과제명] 제목, 11/12 14:00", 오른쪽 "20분 전". 안 읽은 줄은 왼쪽 파란 점과 연한 배경.
- 누르면: 읽음 → 팝오버 닫힘 → [과제] 탭, 그 과제 캘린더, 그 날짜로 이동 → 그 일정 강조(지금 날짜 칩 강조와 같은 깜박임).
- 대상이 지워졌으면: 흐린 글 "(삭제된 일정)", 눌러도 읽음만 하고 이동하지 않는다.
- 내 과제가 아닌 과제의 일정이면(멘션은 누구나 받을 수 있다): 과제 캘린더를 그 과제로 연다(공용 캘린더는 열람 범위 규칙을 따른다. 볼 수 없으면 "이 과제 일정을 볼 수 없습니다").
- 맨 아래 흐린 글 "최근 90일 알림만 보입니다."
- 비면 "알림이 없습니다." / "안 읽은 알림이 없습니다."

### 5.3 과제 일정 입력 창
- 메모 아래 한 줄 **"알릴 사람"**: 칩 + [+ 고르기]. 고르기는 기존 사람 고르기 팝오버(#peerPicker, 검색, 즐겨찾기, 최근)를 다중 선택으로 쓴다. 나는 목록에 없다.
- 칩의 ×로 빼기.
- 칩 아래 흐린 안내 없음(설명 문구 금지). title 에만 "고른 사람에게 알림이 갑니다. 이미 알린 사람에게는 다시 가지 않습니다".
- 저장 뒤 토스트 "저장했습니다. 2명에게 알렸습니다."(새로 알린 사람이 있을 때만 뒤 문장).

### 5.4 과제 일정 상세(그날 목록, 팝오버)
- 알릴 사람이 있으면 한 줄 "알림: 김하늘, 박서준".

### 5.5 Windows 알림 (결정 필요)
- 안 A(권장): 수가 늘었을 때 트레이 풍선 하나("새 알림 2개"), 누르면 메인 창을 띄우고 목록을 연다. 설정에 끄기 하나. 처음엔 켬.
- 안 B: 종 배지만.

## 6. 시험 계획

- 계약(jsdom): 종 배지(0, n, 99+), 목록 줄 모양, 읽음 처리와 이동, 지워진 대상, 모두 읽음, 오프라인, 멘션 칩과 고르기, 저장 회신 토스트, 열람 창에 종 없음.
- 호스트(C#): 멘션 비교(더함, 뺌, 그대로), 나와 비활성 제외, 트랜잭션 되돌림, 같은 사람 두 번 안 감, 50명 상한, 남의 읽음 못 바꿈.
- 배포 SQL: 구조 21 조각과 schema 글자 일치, WHERE 규칙(새 표만이라 해당 없음 확인).
- 실제 위젯 루프: 두 계정으로 A가 B를 멘션 → B 의 수 1 → 열면 이동과 강조 → 읽음이 다른 PC(같은 계정 두 번 로그인 흉내)에도 반영.

## 7. 결정할 것

1. Windows 알림: 안 A(트레이 풍선, 끄기 가능) / 안 B(배지만).
2. 멘션 대상: 활성 사용자 누구나(권장) / 그 과제 참여자만.
3. 보관: 90일 보기, 지우지 않음(권장).

## 8. 하지 않는 것(1단계)

중요 일정, 수행 요청과 완료, 관리자 요청, 알림 설정 세분화(종류별 끄기), 메일 발송, 개인 일정(cal_entry) 멘션.

## 9. 2단계 자리(수행 요청)

- cal_project_event_mention 에 `want_done TINYINT(1)`, `done_at DATETIME(3) NULL` 를 더한다(구조 22).
- 입력 창 "알릴 사람" 옆 [완료 체크 받기]. 반복 일정에서는 막는다.
- 받은 사람: 알림과 일정 상세에 [완료]. 본인만 되돌리기.
- 등록자: 상세에 "3명 중 1명 완료, 1명 읽음, 1명 안 읽음"(읽음은 cal_notice_recv.read_at).
- 새 kind: 'pe_done'(완료 알림, 등록자에게), 'pe_changed'(미완료자에게 변경 알림).
