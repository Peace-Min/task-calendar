# DB 구조 22: 일간보고 과제별 줄, 안 쓰는 표 정리(셋), 공식 과제 연결 이관

상태: 기획(2026-11-06 사용자 결정 A). 배포 판(0.26.0 에 같이 넣을지, 다음 판)은 미정.

## 배경
- 일간보고는 `cal_report_daily.content`(회사에 보낸 글 한 덩어리)에만 과제별 시간과 내용이 들어 있다(`[과제] : 시간` 머리 줄). 주간보고 [일간 불러오기], 근태 [이전 보고], 공식 과제 이관이 모두 이 문자열을 해석해야 한다. 해석은 지금 캘린더 과제 목록과 이름을 맞춰 보므로, 이름이 바뀌거나 과제가 없어지면 그 블록이 "과제 미정"이 된다.
- `cal_report_hours` 는 일간보고 때 과제별 시간을 줄로 쓰지만 앱 어디에서도 읽지 않는다(쓰기 전용 중복). `cat_no` 는 늘 NULL 이다.
- 전체 28표를 호스트 SQL 로 대조한 결과(2026-11-06) 앱이 쓰지 않는 표가 둘이다: `cal_task_hours`(0.24.0 까지 보고서 창 일간 작성의 "작성 중 시간", 0.25.0 부터 입력 화면 없음), `cal_migration_log`(관리자 도구 `db/deploy/xml-to-db` 전용, 앱 안 XML 가져오기는 파일 이름 바꾸기로 대신함).
- 사용자 요구: 임시로 쓰던 개인 과제를 공식 과제로 연결하면 그 과제로 보고한 공수도 공식 과제로 옮겨져야 한다. 연결 뒤 옛 개인 과제는 지운다. 근태 일간보고에서 내용이 있는 0시간 블록도 보낼 수 있어야 한다.

## 결정(A: 보낸 글 원본과 과제별 줄을 둘 다 둔다)
- `cal_report_daily.content` 는 **회사에 실제로 보낸 글 원본 기록**으로 남는다. 나중에 과제를 공식 과제로 연결해도 바꾸지 않는다.
- `cal_report_hours` 는 **앱이 다시 쓰는 과제별 데이터**(사람, 날짜, 과제마다 한 줄)가 된다. 주간 불러오기, 공수 집계, 공식 과제 이관은 이 표를 쓴다. 주간의 `cal_report_weekly` + `cal_report_weekly_hours` 와 같은 모양.
- 표 이름은 바꾸지 않는다(권한, 휴지통, 시험, 문서에 미치는 범위를 줄인다).

## DB 변경(구조 21 → 22, 이관 조각 `db/deploy/migrations/v22-report-hours.sql`)

### 1. `cal_report_hours` 바꿈
| 바꿀 것 | 지금 | 바뀐 뒤 | 이유 |
|---|---|---|---|
| 칸 추가 `body` | 없음 | `MEDIUMTEXT NULL`. 그 과제의 그날 내용(블록 본문, 보낸 그대로의 줄바꿈과 들여쓰기) | 글 해석 없이 주간 불러오기, 이전 보고 |
| 칸 추가 `project_uid` | 없음 | `CHAR(36) NULL`. 공식 과제 id, 개인 과제는 NULL. FK 없음(`cal_report_weekly_hours.project_uid` 와 같은 방식) | 이름이 바뀌어도 공식 과제로 묶기, 이관 |
| 시간 제약 `chk_crh_hours` | `hours > 0 AND hours <= 24` | `hours >= 0 AND hours <= 24` | 내용이 있는 0시간 블록도 줄로 남긴다 |
| 칸 삭제 `cat_no` | 늘 NULL | 없음 | 쓰는 코드 없음 |
| FK 삭제 `fk_crh_cat`(→ `cal_category` RESTRICT) | 있음 | 없음 | 과제 삭제의 걸림돌 |
| 색인 삭제 `idx_crh_cat` | (user_id, cat_no, work_date) | 없음 | `cat_no` 와 함께 |
- 그대로: 기본 키 (user_id, work_date, line_no), `fk_crh_daily`(→ `cal_report_daily` CASCADE), `task_name`, `hours`.
- **옛 줄**: 이관 조각은 기존 줄을 고치지 않는다(`body` 와 `project_uid` 는 NULL 로 남는다). `body IS NULL` 인 날짜는 옛 형식으로 보고 지금처럼 `content` 를 해석한다(아래 앱 변경).

### 2. 표 삭제
| 표 | 데이터 | 처리 |
|---|---|---|
| `cal_task_hours` | 0.24.0 까지 쌓인 작성 중 시간(운영 DB 행 수는 폐쇄망에서 확인) | `DROP TABLE`. 배포 전 백업(DB-RELEASE-OPS)에는 남는다 |
| `cal_migration_log` | 사용자가 확인한 DB 에서 비어 있음(2026-11-06). 개발 DB 는 시험 1줄 | `DROP TABLE` |
| `cal_user_pref` | 옛 보고서 창 서식(머리기호, 들여쓰기 공통, 일간, 주간 9칸)과 보고 글꼴 2칸. 근태는 서식 칸을 쓰지 않고, 글꼴만 [취합] 미리 보기가 쓴다 | `DROP TABLE`. 글꼴은 계정별 localStorage(`tc_rptFont:<계정>`)로 옮기고 기존 값은 옮기지 않는다(기본 글꼴로 시작) |
- 원칙(2026-11-06 사용자): 옛 보고서 창에서 쓰던 표 가운데 지금 근태가 쓰지 않는 표는 모두 지운다. 대조 결과 `cal_task_hours`, `cal_user_pref` 둘이고, `cal_report_hours` 는 근태용 과제별 줄로 바꿔 쓰며, `cal_attendance`(근태 처음 값과 보낸 뒤 갱신), `cal_report_daily`, `cal_report_weekly`, `cal_report_weekly_hours`, `project_schedule_image`(취합 월간 보고)는 근태가 쓴다. `cal_entry` 의 반복 옵션 칸은 그대로 둔다.
- 권한: `grants-calendar.sql`, `server-app-account.sql`, `create-app-user.sql` 에서 지우는 세 표의 GRANT 줄을 뺀다. 이관 조각에는 GRANT 와 REVOKE 를 넣지 않는다(DB-RELEASE-OPS 규칙). 표를 지우면 그 표의 표 단위 권한 줄은 `mysql.tables_priv` 에 남을 수 있으나 동작에는 영향이 없다(정리는 root 가 따로, 선택).

### 3. 이관 조각 규칙(DB-RELEASE-OPS 4.2, 5.2, 6-1 과 v14~v21 본보기)
- `@go`(구조 번호가 정확히 21 일 때만) 패턴, `information_schema` 로 지금 모양을 보고 한 번만 바꾼다(다시 돌려도 그대로).
- 바꾼 뒤 검증: `cal_report_hours` 칸 7개(`body`, `project_uid` 있음, `cat_no` 없음), FK 하나(`fk_crh_daily`), 시간 제약 `>= 0`, 세 표(`cal_task_hours`, `cal_migration_log`, `cal_user_pref`) 없음. 다르면 없는 표 SELECT 로 멈춘다.
- 구조 번호 갱신은 `WHERE k = 'db_structure_version' AND v = '21'`. DELETE, UPDATE 에는 키 WHERE. INSERT IGNORE 금지.
- 정본 `db/deploy/schema-calendar.sql` 과 조각의 정의는 글자까지 같게. `DbGate.AppStructureVersion` 22.

## 앱 변경(호스트, 웹)
1. **일간보고 저장**(`ReportDb` 일간 저장, `NetcusSubmit` 성공 뒤): 블록마다 `task_name`, `project_uid`(공식 과제면), `hours`(0 포함), `body` 를 한 줄씩. `content` 는 지금처럼 보낸 글 그대로. `HoursInDomain`(> 0) 을 일간은 `>= 0` 으로.
2. **주간보고 [일간 불러오기]**(`awDailyCollect`): 그 주 날짜마다 `cal_report_hours` 에 `body` 가 있는 줄이 있으면 그 줄(과제, 시간, 내용)을 쓰고, 없으면(옛 보고) 지금처럼 `content` 를 해석한다. 호스트 `reportDailyList` 회신에 그날 줄을 싣는다.
3. **근태 일간 [이전 보고]**: 같은 규칙(줄이 있으면 줄, 없으면 해석). 자유 메모는 아래 열린 결정.
4. **근태 일간 0시간 허용**: 웹 `atBlockProblem` 의 "내용이 있는데 0시간" 막기를 걷는다. 회사로는 `[과제] : 0` 아래 내용이 나간다. 주간보고에는 과제별 0시간 막기가 원래 없다(확인).
5. **공식 과제로 연결**(`runRelink`): 일정과 할 일 이동은 지금처럼(합치기의 `moveCategoryData` 를 쓰도록 맞춘다). 성공하면 새 호스트 명령 하나로 한 트랜잭션: 이 사람의 `cal_report_hours` 와 `cal_report_weekly_hours` 에서 `task_name = 옛 이름` 이고 공식 과제 id 가 비었거나 다른 줄의 `task_name` 을 공식 이름으로, `project_uid` 를 공식 과제 id 로. 같은 날(주)에 공식 과제 줄이 이미 있으면 시간을 더해 한 줄로(내용은 이어 붙임). `content` 와 주간 글은 바꾸지 않는다. 그다음 옛 개인 과제를 지운다(확인 창 문구에 "원래 과제는 지웁니다"). 옛 보고(`body` 가 없는 날)는 공수 이관 대상이 아니다(글 해석 쪽은 옛 이름이 "과제 미정" 으로 남는다. 알고 가는 한계).
6. **표 삭제에 따른 정리**: `cal_user_pref` 의 읽기와 저장 동기화(웹 `reportFormatPrefs`, `reportMarker*`, `reportIndent*` 상태와 옛 XML `<prefs>` 서식 읽기 포함, 글꼴은 localStorage 로), 호스트의 `cal_task_hours` 저장 동기화와 읽기, 옛 XML 가져오기의 `taskHours`, 과제 삭제와 휴지통 영구 삭제의 정리 순서, 웹 `state.taskHours`, `getTaskHours`(근태 가져오기 시간 칸 미리 채우기), `dropCatHours`. 관리자 도구 `db/deploy/xml-to-db` 와 그 시험, 문서.

## 열린 결정
1. **자유 메모 칸**: `cal_report_daily` 에 `memo` 칸을 더할지. 더하면 저장된 일간보고를 다시 불러올 때 해석이 완전히 없어진다(해석은 옛 보고에만). 더하지 않으면 메모만 `content` 첫 머리 줄 앞을 읽는다. 추천: 더한다.
2. **배포 판**: 0.26.0 에 같이 넣을지, 다음 판으로 미룰지.

## 시험과 문서
- 이관 조각 시험(release-sql 흉내: 21 에서 22, 다시 돌림, 검증 멈춤, 변이), 정본과 조각 정의 일치, 권한 줄, 휴지통 정리 순서, 일간 저장 줄, 주간 불러오기 두 경로(줄과 옛 해석), 이전 보고, 공식 과제 이관(합치기 포함), 0시간 허용, `cal_task_hours` 흔적 없음.
- 실제 위젯과 개발 DB(이관 조각을 개발 DB 에 적용) 확인, 전체 strict.
- 스키마 HTML 다시 생성, db 문서, 위키(근태 보고, 근태 주간 보고, 내 과제와 과제 추가), CHANGELOG, DB-RELEASE-OPS 배포 할 일(구조 22).
- 실제 과제명, 실제 발주처 이름 금지.
