# DB 구조 22: 일간보고 과제별 줄, 안 쓰는 표 정리(셋), 공식 과제 연결 이관

상태: 기획(2026-11-06 사용자 결정 A, 메모 칸 추가, DB 운영 검토(Opus) 반영, 과제 id 로 찾기와 옛 일간 줄 삭제 결정). 개발 전. 배포 판은 0.26.0(2026-11-06 사용자: 배포는 급하지 않다. v21 과 함께 한 번에 올린다. 아래 MySQL 8.4 실제 리허설과 폐쇄망 사전 조회를 통과한 뒤에 배포).

## 배경
- 일간보고는 `cal_report_daily.content`(회사에 보낸 글 한 덩어리)에만 과제별 시간과 내용이 들어 있다(`[과제] : 시간` 머리 줄). 주간보고 [일간 불러오기], 근태 [이전 보고], 공식 과제 이관이 모두 이 문자열을 해석해야 한다. 해석은 지금 캘린더 과제 목록과 이름을 맞춰 보므로, 이름이 바뀌거나 과제가 없어지면 그 블록이 "과제 미정"이 된다.
- `cal_report_hours` 는 일간보고 때 과제별 시간을 줄로 쓰지만 앱 어디에서도 읽지 않는다(쓰기 전용 중복, 과제 이름과 시간뿐). `cat_no` 는 늘 NULL 이다.
- 전체 28표를 호스트 SQL 로 대조한 결과(2026-11-06) 앱이 쓰지 않는 표가 둘이다: `cal_task_hours`(0.24.0 까지 보고서 창 일간 작성의 "작성 중 시간", 0.25.0 부터 입력 화면 없음), `cal_migration_log`(관리자 도구 `db/deploy/xml-to-db` 전용, 앱 안 XML 가져오기는 파일 이름 바꾸기로 대신함).
- 사용자 요구: 임시로 쓰던 개인 과제를 공식 과제로 연결하면 그 과제로 보고한 공수도 공식 과제로 옮겨져야 한다. 연결 뒤 옛 개인 과제는 지운다. 근태 일간보고에서 내용이 있는 0시간 블록도 보낼 수 있어야 한다.

## 결정(A: 보낸 글 원본과 과제별 줄을 둘 다 둔다)
- `cal_report_daily.content` 는 **회사에 실제로 보낸 글 원본 기록**으로 남는다. 나중에 과제를 공식 과제로 연결해도 바꾸지 않는다.
- `cal_report_hours` 는 **앱이 다시 쓰는 과제별 데이터**(사람, 날짜, 과제마다 한 줄)가 된다. 주간 불러오기, 공수 집계, 공식 과제 이관은 이 표를 쓴다. 주간의 `cal_report_weekly` + `cal_report_weekly_hours` 와 같은 모양.
- **과제는 id 로 찾는다**(2026-11-06 사용자). 일간 줄과 주간 줄 모두 앱의 과제 id 원문(`cal_category.uid`, 개인 `c-<uuid>`, 공식 `db-<project.uid>`)을 `cat_uid` 칸에 남긴다. 이관과 불러오기는 과제 이름을 비교하지 않는다. 이름 비교는 같은 이름의 다른 공식 과제 줄을 끌고 오고, 지금 콜레이션에서 대소문자를 구분하지 않으며, 개인 과제 이름을 바꾸면 지난 줄을 놓친다(검토 지적).
- `task_name` 은 보낸 이름 그대로의 기록(화면 표시)이다. 찾는 열쇠가 아니다.
- 표 이름은 바꾸지 않는다(권한, 휴지통, 시험, 문서에 미치는 범위를 줄인다).

## DB 변경(구조 21 → 22, 이관 조각 `db/deploy/migrations/v22-report-hours.sql`)

### 1. `cal_report_hours` 바꿈
| 바꿀 것 | 지금 | 바뀐 뒤 | 이유 |
|---|---|---|---|
| 옛 줄 | 0.25.x 일간보고마다 쌓인 이름과 시간 줄 | **모두 지운다**(`DELETE FROM cal_report_hours WHERE user_id > 0`) | 앱이 읽은 적 없고 같은 내용이 `content` 에 다 있다(사용자 결정). 옛 날짜는 `content` 해석으로 읽는다 |
| 칸 추가 `cat_uid` | 없음 | `VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL`, `task_name` 뒤. 그 블록의 앱 과제 id 원문(`cal_category.uid` 와 같은 정의). NULL 은 캘린더 과제와 이어지지 않은 블록. FK 없음(과제를 지워도 보고 줄은 남는다) | 이관, 불러오기의 열쇠 |
| 칸 추가 `project_uid` | 없음 | `CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL`(`project.uid`, `cal_category.project_uid` 와 같음), `cat_uid` 뒤. 공식 과제 id, 개인 과제는 NULL. FK 없음. 앱은 저장 전에 `ProjectUidOk` 로 모양을 본다 | 89명 공수를 공식 과제별로 합치기 |
| 칸 추가 `body` | 없음 | `MEDIUMTEXT NULL`, `hours` 뒤. 그 과제의 그날 내용(보낸 그대로의 줄바꿈과 들여쓰기). 새 앱은 NULL 을 쓰지 않는다(없으면 `''`) | 글 해석 없이 주간 불러오기, 이전 보고 |
| 시간 제약 `chk_crh_hours` | `hours > 0 AND hours <= 24` | `hours >= 0 AND hours <= 24` | 내용이 있는 0시간 블록도 줄로 남긴다 |
| 칸 삭제 `cat_no` | 늘 NULL | 없음 | `cat_uid` 로 대신 |
| FK 삭제 `fk_crh_cat`(→ `cal_category` RESTRICT) | 있음 | 없음 | 과제 삭제의 걸림돌 |
| 색인 삭제 `idx_crh_cat` | (user_id, cat_no, work_date) | 없음 | `cat_no` 와 함께 |
| 색인 추가 `ix_crh_project` | 없음 | (project_uid, work_date) | 공식 과제별 집계(주간 `ix_crwh_project` 와 같은 모양) |
| 색인 추가 `ix_crh_cat` | 없음 | (user_id, cat_uid) | 공식 과제 이관 때 그 사람의 옛 과제 줄 찾기 |
- 그대로: 기본 키 (user_id, work_date, line_no), `fk_crh_daily`(→ `cal_report_daily` CASCADE), `task_name`, `hours`. UNIQUE 는 두지 않는다(같은 날 같은 과제 블록은 저장할 때 앱이 한 줄로 합친다).
- 표 설명(COMMENT)을 "근태 일간보고 과제별 줄. 주간 불러오기, 이전 보고, 공수 집계, 공식 과제 이관의 원천" 으로 고친다.

### 1-2. `cal_report_daily` 칸 추가
| 바꿀 것 | 지금 | 바뀐 뒤 | 이유 |
|---|---|---|---|
| 칸 추가 `memo` | 없음 | `MEDIUMTEXT NULL`, `content` 뒤. 근태 일간 작성 맨 위 "자유 메모" 칸의 글(과제와 상관없는 그날 내용, 예: 출장, 교육). 새 앱은 메모가 없어도 `''` 로 쓴다 | 저장된 일간보고를 다시 불러올 때 글 해석을 없앤다 |
- 회사로 보내는 글(`content`)에는 지금처럼 메모가 첫 과제 머리 줄 앞에 들어간다. `content` 는 보낸 원본 기록 그대로.
- **옛 보고와 새 보고 가르기는 날짜 단위로 `memo IS NULL`**(검토 지적). NULL 이면 옛 보고라 `content` 를 해석한다(첫 머리 줄 앞 = 메모). NULL 이 아니면 새 보고라 메모는 `memo`, 블록은 그날 `cal_report_hours` 줄(0개일 수 있다. 메모만 쓰고 과제가 없는 날). 줄의 `body` 가 비었는지로 가르면 줄이 0개인 새 보고를 옛 보고로 잘못 본다.

### 1-3. `cal_report_weekly_hours` 칸 추가
| 바꿀 것 | 지금 | 바뀐 뒤 | 이유 |
|---|---|---|---|
| 칸 추가 `cat_uid` | 없음 | 일간과 같은 정의, `task_name` 뒤. NULL 은 캘린더 과제와 이어지지 않은 줄 | 주간 줄도 id 로 이관 |
| 색인 추가 `ix_crwh_cat` | 없음 | (user_id, cat_uid) | 이관 때 찾기 |
- **기존 주간 줄 채우기**(이관 조각 안, 한 번): `project_uid` 가 있는 줄은 `cat_uid = CONCAT('db-', project_uid)`. `project_uid` 가 NULL 인 줄은 그 사람의 개인 과제 가운데 이름이 글자까지 같은(`_bin`) 과제가 **하나뿐일 때만** 그 `uid`. 둘 이상이거나 없으면 NULL 로 둔다(그 줄은 이관 대상이 아니다. 알고 가는 한계). UPDATE 에는 키 WHERE(`user_id > 0`).
- 시간 제약 `chk_crwh_hours`(0 초과 168 이하)는 그대로. 주간은 0시간 줄을 쓰지 않는다.

### 2. 표 삭제
| 표 | 데이터 | 처리 |
|---|---|---|
| `cal_task_hours` | 0.24.0 까지 쌓인 작성 중 시간(운영 DB 행 수는 폐쇄망에서 확인) | `DROP TABLE`. 배포 전 백업(DB-RELEASE-OPS)에는 남는다 |
| `cal_migration_log` | 사용자가 확인한 DB 에서 비어 있음(2026-11-06). 개발 DB 는 시험 1줄 | `DROP TABLE` |
| `cal_user_pref` | 옛 보고서 창 서식(머리기호, 들여쓰기 공통, 일간, 주간 9칸)과 보고 글꼴 2칸. 근태는 서식 칸을 쓰지 않고, 글꼴만 [취합] 미리 보기가 쓴다 | `DROP TABLE`. 글꼴은 계정별 localStorage(`tc_rptFont:<계정>`)로 옮기고 기존 값은 옮기지 않는다(기본 글꼴로 시작) |
- 원칙(2026-11-06 사용자): 옛 보고서 창에서 쓰던 표 가운데 지금 근태가 쓰지 않는 표는 모두 지운다. `cal_report_hours` 는 근태용 과제별 줄로 바꿔 쓰며, `cal_attendance`, `cal_report_daily`, `cal_report_weekly`, `cal_report_weekly_hours`, `project_schedule_image`(취합 월간 보고)는 근태가 쓴다. `cal_entry` 의 반복 옵션 칸은 그대로 둔다.
- 권한: `grants-calendar.sql`, `server-app-account.sql`, `create-app-user.sql` 에서 지우는 세 표의 GRANT 줄을 뺀다. 이관 조각에는 GRANT 와 REVOKE 를 넣지 않는다(DB-RELEASE-OPS 규칙). 지운 표의 표 단위 권한 줄은 `mysql.tables_priv` 에 남을 수 있으나 동작에는 영향이 없다(정리는 root 가 따로, 선택).
- 정본 `schema-calendar.sql` 에서는 세 표의 CREATE 만 뺀다. 앞쪽 `DROP TABLE IF EXISTS` 줄(`cal_migration_log` 870 등 세 줄)은 **남긴다**. 옛 배포 DB 를 새로 깔 때 지우는 몫이다.

### 3. 이관 조각 순서와 규칙(DB-RELEASE-OPS 4.2, 5.2, 6-1 과 v14~v21 본보기)
- `@go`(구조 번호가 정확히 21 일 때만) 패턴, 단계마다 `information_schema` 로 지금 모양을 보고 한 번만 바꾼다(다시 돌려도, 중간에 끊긴 뒤 다시 돌려도 그대로 끝난다).
- **순서가 강제된다**(검토 지적. 틀리면 멈추거나, 오류 없이 색인이 엉뚱한 모양으로 남는다):
  1. `DELETE FROM cal_report_hours WHERE user_id > 0`(옛 줄. 그래서 `cat_no` 가 찬 줄도 0이 된다).
  2. `DROP FOREIGN KEY fk_crh_cat` → `DROP INDEX idx_crh_cat` → `DROP COLUMN cat_no`. FK 를 먼저 끊지 않으면 색인을 못 지우고, 칸을 먼저 지우면 색인이 남은 칸만으로 줄어 남는다.
  3. 시간 제약은 `DROP CHECK chk_crh_hours` 와 `ADD CONSTRAINT chk_crh_hours CHECK (hours >= 0 AND hours <= 24)` 를 **두 문장으로** 나눈다(한 문장에 같은 이름을 지우고 만들면 실패).
  4. 칸 추가는 정본 자리대로(`cat_uid`, `project_uid` 는 `task_name` 뒤, `body` 는 `hours` 뒤, `memo` 는 `content` 뒤, 주간 `cat_uid` 는 `task_name` 뒤), 색인 추가, 표 설명 갱신.
  5. 기존 주간 줄 `cat_uid` 채우기(1-3).
  6. 검증(아래). 다르면 없는 표 SELECT 로 멈춘다.
  7. **세 표 DROP 은 맨 끝**(검증을 통과한 뒤).
  8. 구조 번호 갱신 `WHERE k = 'db_structure_version' AND v = '21'`.
- 검증: `cal_report_daily.memo` 있음, `cal_report_hours` 칸 8개(user_id, work_date, line_no, task_name, cat_uid, project_uid, hours, body. `cat_no` 없음)와 칸 순서, 콜레이션(`cat_uid` 가 `utf8mb4_bin`, `project_uid` 가 `project.uid` 와 같음), FK 하나(`fk_crh_daily`, CASCADE), 색인(STATISTICS 로 `ix_crh_project`, `ix_crh_cat` 의 칸과 순서, `idx_crh_cat` 없음), 시간 제약 글(CHECK_CLAUSE 가 `>= 0`), `cal_report_hours` 행 0, 주간 `cat_uid` 와 `ix_crwh_cat` 있음, 주간 행 수가 바뀌기 전과 같음. 세 표 DROP 뒤에는 세 표 없음.
- DELETE, UPDATE 에는 키 WHERE. INSERT IGNORE 금지. GRANT 금지.
- 정본 `db/deploy/schema-calendar.sql` 과 조각의 정의는 같게. 글자 대조 시험에 더해 **새로 깐 DB 와 21 에서 올린 DB 를 `information_schema` 로 견준다**(칸, 순서, 타입, 콜레이션, 색인, FK, CHECK). `DbGate.AppStructureVersion` 22.
- **개발 PC MySQL 8.4 실제 리허설 필수**: release-sql 흉내 시험은 FK, 색인, CHECK 순서 오류를 잡지 못한다. 구조 21 복사본에 (a) 처음 돌리기, (b) 다시 돌리기, (c) 단계마다 중간에 끊고 다시 돌리기. 셋 다 같은 결과와 검증 통과.

## 앱 변경(호스트, 웹)
1. **일간보고 저장**(`ReportDb` 일간 저장, `NetcusSubmit` 성공 뒤): `memo` 는 메모 글(없으면 `''`), 블록마다 `task_name`, `cat_uid`, `project_uid`(공식 과제면), `hours`, `body`(없으면 `''`) 를 한 줄씩. 0시간 블록은 `body` 가 비어 있지 않을 때만 줄로 남긴다. 같은 날 같은 `cat_uid` 블록은 한 줄로 합친다. `content` 는 지금처럼 보낸 글 그대로. 저장 뒤 줄로 다시 만든 글과 `content` 가 다르면 로그만 남긴다. `HoursInDomain`(> 0) 은 일간에만 `>= 0`.
   - **블록에 과제 id 싣기**(2026-11-06 점검에서 찾은 빈칸): 지금 근태 일간 블록(`ATE.blocks`, 임시 저장 `tc_attDraft`)은 `name` 만 있고 과제 id 가 없다. 블록에 `catId` 를 더한다. 과제 고르기, 캘린더에서 가져오기, 과제 추가로 만든 블록은 고른 과제의 id 를 그대로 싣는다. id 가 없는 블록(옛 임시 저장, 옛 보고 다시 열기, 글 해석)은 불러올 때 내 과제 가운데 이름이 글자까지 같은 과제가 하나뿐이면 그 id, 둘 이상이거나 없으면 NULL(과제 미정과 같다). 블록을 연 채로 과제 이름이 바뀌어도 id 로 이어진다. 회사로 보내는 머리 줄 이름은 보낼 때의 과제 이름.
2. **주간보고 [일간 불러오기]**(`awDailyCollect`): 그 주 날짜마다 `memo` 가 NULL 이 아니면 그날 줄(과제 id, 시간, 내용)을 쓰고 과제는 `cat_uid` 로 지금 과제를 찾는다. NULL 이면(옛 보고) 지금처럼 `content` 를 해석한다. 호스트 `reportDailyList` 회신은 한 번의 읽기(같은 스냅숏)로 그 주 부모와 줄을 함께 싣고, `body` 는 불러오기와 이전 보고 요청에만 싣는다.
3. **근태 일간 [이전 보고]**, 보고한 날 다시 열기: 같은 규칙(`memo` NULL 여부).
4. **근태 일간 0시간 허용**: 웹 `atBlockProblem` 의 "내용이 있는데 0시간" 막기를 걷는다. 회사로는 `[과제] : 0` 아래 내용이 나간다. 0시간 판정을 쓰는 다른 곳(`MainWindow.xaml.cs` `ParseHoursJson`/`HoursInDomain`, `ReportDb.cs` 의 시간 검사)도 일간만 맞춘다. 주간보고에는 과제별 0시간 막기가 원래 없다(확인).
5. **주간보고 저장**: `cal_report_weekly_hours` 줄에 `cat_uid` 도 쓴다.
6. **공식 과제로 연결**(`runRelink`, 새 호스트 명령 하나):
   - 순서: 일정과 할 일 이동(합치기의 `moveCategoryData` 를 쓰도록 맞춘다) → 공수 이관 트랜잭션 커밋 확인 → 그다음에만 옛 개인 과제 삭제. 공수 이관이 실패하면 옛 과제를 남기고 문구로 알린다. 확인 창 문구에 "원래 과제는 지웁니다".
   - 대상: 이 사람의 `cal_report_hours` 와 `cal_report_weekly_hours` 에서 **`cat_uid` = 옛 개인 과제 id 인 줄만**. 그 줄의 `cat_uid` 를 `db-<공식 uid>`, `project_uid` 를 공식 uid, `task_name` 을 공식 이름으로 바꾼다. 공식 이름은 호스트가 `project` 에서 uid 로 읽는다(웹이 보낸 이름을 믿지 않는다).
   - 같은 날(주)에 그 공식 과제 줄(`cat_uid` 가 같은 줄)이 이미 있으면 시간을 더해 가장 작은 `line_no` 한 줄로 남기고 나머지는 지운다. 내용은 `CONCAT_WS` 와 `COALESCE` 로 이어 붙인다(NULL 이 섞여 통째로 NULL 이 되지 않게).
   - 합친 시간이 하루 24, 한 주 168 을 넘으면 DB 제약에 걸려 전체가 실패하므로, 미리 검사해 문구로 거절한다.
   - 잠금 순서는 일간 저장과 같게: 일간 부모 `FOR UPDATE` → 일간 줄 → 주간 부모 → 주간 줄(다르면 교착). 이관 중에는 그 사람의 보고 보내기를 막는다. 같은 명령을 다시 보내도 결과가 같다(옮길 줄이 없으면 그냥 성공).
   - `DbGate.OpenAsync` 로 열고 커밋 전에 구조 번호를 다시 본다.
   - `content` 와 주간 글은 바꾸지 않는다. 옛 보고(`memo` 가 NULL 인 날)는 줄이 없으므로 공수 이관 대상이 아니다(글 해석 쪽은 옛 이름이 "과제 미정" 으로 남는다. 알고 가는 한계).
7. **표 삭제에 따른 정리**(빠지면 배포 뒤 "표 없음" 오류. 특히 휴지통의 퇴사자 영구 삭제가 모두 실패한다):
   - 호스트: `ProjectDb.cs` 의 `UserRecordTables`(2260 근처, `cal_task_hours`, `cal_migration_log`)와 그 목록을 쓰는 휴지통 영구 삭제(2699 근처), `cal_user_pref` 지우기(2762 근처). `CalendarWriteDb.cs`(176, 343~393, 578 근처)의 `cal_task_hours` 저장 동기화, `CalendarDb.cs`(670~767 근처)의 읽기. 과제 삭제의 정리 순서.
   - 웹: `cal_user_pref` 읽기와 저장 동기화(`reportFormatPrefs`, `reportMarker*`, `reportIndent*` 상태와 옛 XML `<prefs>` 서식 읽기 포함, 글꼴은 localStorage 로), `state.taskHours`, `getTaskHours`(근태 가져오기 시간 칸 미리 채우기), `dropCatHours`, 옛 XML 가져오기의 `taskHours`.
   - 스크립트: `init-calendar.ps1` 표 목록(192~194), `setup-taskcalendar.ps1` `$CAL_DATA_TABLES`(132)와 관련 주석, 안내 문구.
   - 관리자 도구 `db/deploy/xml-to-db` 와 그 시험, 문서.

## 배포와 운영
- **폐쇄망 사전 조회**(배포 전 Workbench, 읽기만): 세 표와 `cal_report_hours` 행 수, `cal_report_hours.cat_no` 가 찬 줄 수(0 이어야 정상, 아니어도 1단계에서 지워진다), `fk_crh_cat` 외에 세 표를 가리키는 FK 가 없는지, 주간 줄 가운데 `project_uid` NULL 이고 같은 이름 개인 과제가 둘 이상인 줄 수(채우기에서 빠질 몫), `SHOW GRANTS FOR` 앱 계정(`server-app-account` 는 표 단위 권한이라 새 칸은 따로 줄 필요 없음 확인).
- 순서는 지금 규칙 그대로: Setup 먼저 올리고 SQL(`db_updating` 닫고 열기). 0.25.1 앱은 DbGate 정확 일치로 구조 22 DB 를 열지 않는다.
- **롤백**: 열기 전에는 배포 전 백업 복원. 연 뒤에는 되돌리지 않고 더 높은 구조 번호로 고쳐 올린다(연 뒤 쌓인 새 보고 줄이 백업에 없다).
- 배포 뒤 관찰: 첫날 일간보고 저장 뒤 `memo` NULL 이 새로 생기지 않는지, `cal_report_hours` 줄 수가 보낸 블록 수와 맞는지, 로그의 `content` 불일치, 공식 과제 연결 뒤 옛 과제가 지워졌는지와 공수 합계.

## 열린 결정
1. ~~자유 메모 칸~~: 2026-11-06 사용자 결정, `cal_report_daily.memo` 를 더한다(위 1-2).
2. ~~과제 찾기~~: 2026-11-06 사용자 결정, 일간과 주간 줄 모두 `cat_uid`(과제 id). 옛 일간 줄은 지운다.
3. ~~배포 판~~: 2026-11-06 사용자 결정, 0.26.0. 공식 과제 연결 뒤 옛 과제 삭제는 v22 와 반드시 같은 판(먼저 내면 주간 줄 채우기가 지운 개인 과제를 못 찾는다).

## 시험과 문서
- 이관 조각 시험(release-sql 흉내: 21 에서 22, 다시 돌림, 검증 멈춤, 변이), 정본과 조각 정의 일치, 새로 깐 DB 와 올린 DB 의 `information_schema` 대조, 권한 줄, 휴지통 정리 순서(퇴사자 영구 삭제 포함), 일간 저장 줄(메모만 있는 날, 0시간 블록, 같은 과제 합치기), 주간 불러오기 두 경로(`memo` 있음과 옛 해석), 이전 보고, 공식 과제 이관(id 로만, 같은 이름 다른 공식 과제 줄은 그대로, 합치기, 24와 168 초과 거절, 실패하면 옛 과제 남음, 다시 보내기), 0시간 허용, `cal_task_hours` 흔적 없음.
- 개발 PC MySQL 8.4 실제 리허설(위 3의 세 가지), 실제 위젯과 개발 DB 확인, 전체 strict.
- 스키마 HTML 다시 생성, db 문서, 위키(근태 보고, 근태 주간 보고, 내 과제와 과제 추가), CHANGELOG, DB-RELEASE-OPS 배포 할 일(구조 22, 사전 조회, 관찰).
- 실제 과제명, 실제 발주처 이름 금지.

## 구현 기록(2026-11-06)
- 상태: 구현 끝, 커밋 전. 배포 판 0.26.0. CHANGELOG 2026-11-06 "DB 구조 22" 항목에 계약 개정을 모았다.
- 이관 조각 `db/deploy/migrations/v22-report-hours.sql` 은 위 3의 순서 그대로(옛 일간 줄 삭제, FK, 색인, 칸, CHECK 두 문장, 칸 추가, 색인, 표 설명, 주간 채우기, 검증, 표 셋 DROP, 구조 번호). 표 28개에서 25개.
- 호스트: `ReportDb.SaveDailyAsync(..., memo)`(메모와 과제별 줄 한 트랜잭션, 같은 `cat_uid` 합치기, 0시간 줄은 `body` 가 있을 때만), `ReportDb.ListDailyAsync(..., withLines)`(detail 요청에만 `memo` 와 `lines`), 새 명령 `reportRelink` 와 `ReportDb.RelinkHoursAsync`(id 로만, 합치기, 24와 168 미리 거절, 잠금 순서, 커밋 직전 관문, 연결과 보내기 서로 막기 `RelinkBusyMsg`). `CalendarDb`, `CalendarWriteDb`, `ProjectDb` 에서 지운 세 표를 걷었다. `DbGate.AppStructureVersion` 22.
- 웹: 블록 `catId`(옛 블록은 같은 이름 과제가 하나뿐일 때만 `atBlocksKnown`), `atSavedParts`(memo 로 새 보고와 옛 보고 가르기), 주간 `awDailyCollect` 두 길, `atBlockProblem` 0시간 막기 삭제, `runRelink`(`catMoveRefs` 와 저장, 과제마다 `reportRelink`, 성공한 과제만 삭제, 확인 문구 "원래 과제는 지웁니다"). `state.taskHours` 와 보고 서식 상태를 걷고 보고 글꼴은 `tc_rptFont:<계정>` localStorage. 근태 캘린더 가져오기의 시간 칸은 0 으로 시작한다(작성 중 시간이 없어졌으므로).
- 지운 도구: `db/deploy/xml-to-db` 와 그 시험(`dryrun-xml-to-db`, `migrate-tool`).
- 실제 리허설(`tools/db-rehearsal/rehearse-v22.mjs`, 개발 PC MySQL 8.4): 처음 돌리기, 다시 돌리기, 중간 끊기 27곳 모두 통과. 새로 깐 DB 와 21 에서 올린 DB 의 `information_schema` 같음. 시드 복사본에서 주간 채우기는 공식 1, 하나뿐인 개인 1을 채우고 같은 이름 둘, 대소문자만 다른 이름, 모르는 과제 줄은 비워 두었다.
- 시험: 새 `report-hours-v22`, `db-v22`, release-sql ③r~③r5 와 변이 R40~R47, 지운 표를 보던 시험 여럿을 새 계약으로. 전체(비 strict) 3612 통과, 0 실패, 0 건너뜀. strict, 루프, 실제 위젯 확인은 메인이 이어서 한다.
- 문서: 위키 근태 보고, 근태 주간 보고, 내 과제와 과제 추가, 기본 과제 휴가와 기타, XML 가져오기, 지운 기능.
