-- =====================================================================
--  캘린더(cal_*) 감사 트리거 — §7.5 휴지통 적재 (단일 소스)
--  MySQL 8.0.13+ / InnoDB.  (실측·검증 대상: MySQL 8.4.9)
--  선행 조건: schema-calendar.sql 이 먼저 실행돼 cal_* 13개가 있을 것.
--
--  ⚠️⚠️ 이 파일을 적용하지 않으면 grants-calendar.sql 의 DELETE 부여가 '근거 없는' 상태다.
--     grants-calendar.sql:30-34 는 앱 계정에 DELETE 를 주는 유일한 상쇄 근거로
--     "§7.5 감사 트리거가 삭제/수정 전 이미지를 cal_audit_trash 에 적재한다" 를 들었다.
--     그 트리거가 없으면 배포안은 사실상 '전 사용자 PC 에 퍼진 자격증명 + 전 캘린더 테이블
--     DELETE + 흔적 0' 이다. 앱 계정으로 붙은 누구든 남의 일정을 지우고 아무 기록도 남기지 않는다.
--     → 배포 순서: schema-calendar.sql → **triggers-calendar.sql** → grants-calendar.sql.
--
--  ⚠️ 재적용 규칙 — schema-calendar.sql 을 다시 돌리면 이 파일도 반드시 다시 돌려야 한다.
--     MySQL 은 테이블을 DROP 하면 그 테이블의 트리거를 **함께, 조용히** 지운다(실측).
--     schema-calendar.sql 의 DROP TABLE 13줄이 지나가면 아래 15개 트리거가 전부 사라지는데
--     에러도 경고도 없다. 구조 재구축 후 이 파일을 잊으면 '휴지통 테이블은 있는데 채우는
--     주체가 없는' 상태로 배포된다 — 겉보기로는 정상이다. 아래 릴리스 게이트로 세어 볼 것.
--
--  ⚠️ 이 파일은 cal_* 에만 트리거를 만든다. app_user / org_unit / title_code / project /
--     customer / section_code / status_code 는 읽지도 쓰지도 않는다.
-- ---------------------------------------------------------------------
--  DEFINER 를 무엇으로 두는가 — CURRENT_USER (= 이 파일을 실행한 관리 계정)
--
--  왜 DEFINER 가 필요한가:
--    트리거는 항상 DEFINER 권한으로 실행된다(MySQL 트리거에는 SQL SECURITY 절이 없다).
--    앱 계정에는 cal_audit_trash 권한이 한 줄도 없어야 감사가 성립하는데(grants-calendar.sql:125-130),
--    그 상태에서도 삭제가 휴지통에 적재되는 유일한 방법이 DEFINER 실행이다.
--    DEFINER 계정에 필요한 권한: cal_audit_trash INSERT + cal_entry_except/cal_entry_commit/
--    cal_todo_day_note SELECT(자식 흡수용).
--
--  왜 'root'@'localhost' 로 박지 않는가:
--    호스트까지 정확히 같아야 같은 계정이다. 배포 서버의 관리 계정이 'root'@'%' 이거나
--    이름이 다르면, CREATE TRIGGER 는 **경고만 내고 성공한 뒤** 실제 쓰기에서 ERROR 1449 가 난다.
--    즉 배포 시점이 아니라 사용자가 자기 일정을 저장하려는 순간에 터진다 — 가장 비싼 실패다.
--    CURRENT_USER 는 실행 중인 계정이라 존재가 보장된다.
--
--  그래서 실행 규약(지키지 않으면 감사가 무너진다):
--    · 이 파일은 반드시 **관리 계정(root 등)** 으로 실행한다. 앱 계정으로 실행하면
--      DEFINER=앱계정 이 되어, 앱 계정이 스스로 지운 흔적을 지울 수 있는 상태가 된다.
--      (그리고 앱 계정에는 TRIGGER 권한이 없으므로 애초에 ERROR 1142 로 실패한다)
--    · DEFINER 계정을 나중에 DROP USER 하면 전 캘린더 쓰기가 ERROR 1449 로 죽는다.
--      아래 릴리스 게이트 3)이 이걸 배포 시점에 잡는다.
--
--  더 조이고 싶다면(선택, 이 파일 범위 밖 — 계정을 만드는 파일이 따로 필요하다):
--    감사 전용 최소권한 계정을 만들고 DEFINER 를 그쪽으로 바꾸는 편이 낫다. 그러면 트리거
--    본문이 나중에 잘못 수정돼도 할 수 있는 일이 '휴지통에 넣기'로 제한된다.
--    -- CREATE USER 'taskmgr_audit'@'localhost' IDENTIFIED BY '<강한 비번>' ACCOUNT LOCK;
--    -- GRANT INSERT ON taskmgr.cal_audit_trash TO 'taskmgr_audit'@'localhost';
--    -- GRANT SELECT ON taskmgr.cal_entry_except    TO 'taskmgr_audit'@'localhost';
--    -- GRANT SELECT ON taskmgr.cal_entry_commit    TO 'taskmgr_audit'@'localhost';
--    -- GRANT SELECT ON taskmgr.cal_todo_day_note   TO 'taskmgr_audit'@'localhost';
--    (ACCOUNT LOCK 이어도 DEFINER 로는 동작한다 — 로그인만 막힌다)
-- ---------------------------------------------------------------------
--  ★ FK ON DELETE CASCADE 로 지워지는 자식은 자식 트리거가 발화하지 않는다 (설계 §7.5 실측).
--
--     cal_entry_except · cal_entry_commit · cal_todo_day_note 는 부모 삭제 시 FK CASCADE 로
--     사라지는데, MySQL 은 그때 자식 테이블의 DELETE 트리거를 부르지 않는다.
--     문서 §9 가 'ROW binlog 도 CASCADE 로 지워진 자식의 before-image 를 남기지 않는다'고
--     못박았으므로, 흡수하지 않으면 복구 경로가 0 이다.
--     → 부모 BEFORE DELETE 안에서 JSON_ARRAYAGG 로 자식을 통째로 흡수한다.
--       (BEFORE 라서 자식이 아직 살아 있다. AFTER 로 바꾸면 이미 CASCADE 로 사라진 뒤다)
--
--  ★ 그런데 부모 흡수만으로는 감사가 반쪽이다 — 그래서 자식 4개에도 트리거를 단다(5~8번).
--
--     부모 흡수는 '부모째 지울 때'만 성립한다. 정작 앱이 매일 실행하는 삭제는 대부분
--     **부모는 살아 있고 자식 행만 사라지는** 경로다(각 근거는 5~8번 머리주석에 코드 위치와 함께).
--     grants-calendar.sql 이 자식 4개에 DELETE 를 준 근거로 든 것이 바로 그 경로들인데,
--     트리거가 부모에만 있으면 '가장 자주 일어나는 삭제'가 흔적을 안 남긴다.
--     DELETE 부여를 사후 탐지로 상쇄한다는 §7.5 의 논리가 그 지점에서 성립하지 않는다.
--
--     ★ 부모 흡수와 자식 트리거는 서로 배타적이라 중복 적재가 생기지 않는다.
--       CASCADE 삭제는 자식 트리거를 부르지 않으므로(위 문단) 부모 DELETE 는 부모 1행만,
--       자식 단독 DELETE 는 자식 n행만 남는다. 둘 다 실측으로 확인할 것 — 한쪽만 보면
--       '중복 없음'도 '누락 없음'도 증명되지 않는다(아래 릴리스 게이트 6·7).
--
--  ★ 어느 표에 UPDATE 트리거를 다는가 — '앱이 행을 제자리에서 고치는가'로 판정했다.
--     · cal_entry_commit : 판정 ○. subject/body 인라인 편집이 실재하고(setCommitSubject
--         :8898 / setCommitMessage :8907 — 둘 다 c.subject 를 제자리 대입), 커밋 개별 삭제
--         (deleteCommitRow :8934 의 splice)가 뒤 원소를 당겨 seq(=배열 인덱스, 스키마 :247)를
--         전부 다시 쓴다.
--     · cal_todo_day_note : 판정 ○ (2차 브리프는 DELETE 만 지목했으나 코드는 UPDATE 도 한다).
--         날짜별 설명 편집이 updateTodo(id, {dayNotes:{[date]:값}}) 한 경로로 들어오고(:8979),
--         updateTodo 가 기존 dayNotes 에 그 날짜를 덮어쓴다(:8793 Object.assign) — 같은 PK
--         (login_id, todo_id, note_date) 의 note_text 만 바뀌는 제자리 수정이다.
--         grants-calendar.sql:95 도 이 표에 UPDATE 를 부여해 두었다. 부여된 동사에 트리거가
--         없으면 딱 그 자리에 감사 구멍이 남는다.
--     · cal_room : 판정 ○. 이름이 PK 라 이름 변경은 없지만, deleteRoom(:5872-5877)이 배열
--         중간을 splice 하면 뒤 회의실의 sort_order 가 전부 밀린다(표시 순서의 유일한 근거).
--     · cal_entry_except : 판정 ✗. PK(login_id, entry_id, except_date)가 곧 행의 전부라
--         고칠 컬럼이 없고, grants 도 UPDATE 를 일부러 주지 않는다(grants :74-76).
--         발화할 수 없는 트리거는 게이트 기대값만 늘리므로 달지 않는다.
--     · 감사에서 제외한 표(의도) : cal_user_rev(단조 카운터 — 쓰기 트랜잭션마다 1회 UPDATE 라
--         비용이 전 쓰기의 2배가 되는데 남는 값은 숫자 하나뿐), cal_user_pref(삭제 경로 0건,
--         값이 git/svn 작성자 문자열뿐), cal_migration_log·cal_schema_meta(앱에 파괴 권한 자체가
--         없다), cal_audit_trash(자기 자신).
--
--  ★ row_key 조립 규칙 (전 트리거 공통 — 복원 도구가 이 규칙 하나로 전 표를 판다)
--       row_key = PK 에서 login_id 를 뺀 나머지 컬럼을 PK 선언 순서대로 '|' 로 이어붙인다.
--       · login_id 를 빼는 이유: 별도 컬럼(cal_audit_trash.login_id)에 이미 들어간다.
--       · DATE 는 반드시 DATE_FORMAT(x, '%Y-%m-%d') 로 못박는다. CONCAT 이 DATE 를 문자열로
--         바꿀 때의 표기가 세션 설정에 좌우되면 나중에 row_key 로 찾을 수가 없다.
--       · 남은 컬럼이 하나뿐이면 구분자 없이 그 값이 곧 row_key 다(cal_category/cal_entry/
--         cal_todo 의 id, cal_room 의 name).
--       실제 값:
--         cal_category/cal_entry/cal_todo : id
--         cal_task_hours                  : work_date|category_id
--         cal_entry_except                : entry_id|except_date
--         cal_entry_commit                : entry_id|seq
--         cal_todo_day_note               : todo_id|note_date
--         cal_room                        : name
--       폭 확인: row_key VARCHAR(200)(스키마 :434). 최장 조합이 entry_id(80)+'|'+날짜(10)=91 이라
--       절단 여지가 없다. id 폭을 넓히면 여기도 같이 볼 것.
--
--  ★ before_img 의 모양
--     · 원본 행의 컬럼은 컬럼명 그대로 최상위에 둔다("변경 전 행 전체", 스키마 주석).
--     · 컬럼이 아닌 것은 '_' 접두를 붙여 구분한다. cal_* 어느 테이블에도 '_' 로 시작하는
--       컬럼이 없어 복원 도구가 기계적으로 갈라낼 수 있다.
--         _except / _commits / _day_notes : 흡수한 자식 배열(자식이 없으면 [])
--         _by   : USER()          — 접속한 클라이언트 계정@호스트.
--                 왜 남기는가: 전 사용자가 같은 taskmgr_app 계정으로 붙으므로 계정만으로는
--                 누구인지 알 수 없다. 호스트 부분이 '어느 PC 에서 지웠는지'의 유일한 단서다.
--                 (CURRENT_USER() 는 트리거 안에서 DEFINER 를 돌려주므로 쓸모가 없다)
--         _conn : CONNECTION_ID() — 같은 트랜잭션에서 연쇄로 지워진 행들을 사후에 묶는 키
--     · JSON_ARRAYAGG 는 순서를 보장하지 않는다. 그래서 commit 은 seq 를, except/day_note 는
--       날짜 자신을 배열 원소 안에 넣는다 — 배열 순서가 아니라 값으로 복원한다.
--     · DATE/TIME/DATETIME 은 JSON 안에서 문자열로 직렬화된다(실측: TIME → "09:30:00.000000",
--       DATETIME(3) → "2026-03-01 09:30:00.123000"). 그대로 되넣으면 원값으로 복원된다.
--
--  ★ acted_at 은 UTC_TIMESTAMP(3) 를 명시 대입한다.
--     컬럼 DEFAULT CURRENT_TIMESTAMP(3) 를 쓰지 않는 이유는 schema-calendar.sql 헤더와 같다 —
--     CURRENT_TIMESTAMP 는 세션 time_zone(현 서버 SYSTEM=KST)으로 평가되므로, 프리앰블에서
--     time_zone 을 못 세운 접속이 하나만 있어도 같은 컬럼에 KST 와 UTC 가 섞이고 사후 구분이 불가능하다.
--     감사 기록은 '언제였나'를 다투는 자리라 여기서 흔들리면 기록 전체의 값이 떨어진다.
--
--  ★ UPDATE 트리거는 자식을 흡수하지 않는다.
--     부모 UPDATE 는 자식 행을 건드리지 않으므로(FK ON UPDATE RESTRICT) 자식은 그대로 살아 있다.
--     자식만 바뀌는 경로(예외일 추가/삭제, 커밋 편집)는 부모 updated_at 을 앱이 같은 트랜잭션에서
--     올리게 되어 있어(스키마 :179) 그 UPDATE 가 이 트리거를 발화시킨다.
--
--  ★★ 어댑터 계약 — '바뀐 행만' UPDATE 문에 넣을 것. 값이 그대로여도 감사 행은 남는다.
--     실측(MySQL 8.4.9, 이번 라운드):
--       UPDATE cal_room SET sort_order = sort_order, name = name WHERE login_id=?;
--       → ROW_COUNT() = 0 (바뀐 행 0)  그런데 cal_audit_trash 에는 3행이 적재됐다.
--     BEFORE UPDATE 트리거는 '값이 달라진 행'이 아니라 'WHERE 에 걸린 행'마다 발화한다.
--     그래서 어댑터가 저장 때마다 목록을 통째로 다시 쓰는 방식(회의실 전량 UPDATE,
--     커밋 전량 UPDATE)을 택하면, 사용자가 아무것도 안 고쳐도 저장 한 번에 행 수만큼
--     감사 행이 쌓인다. 커밋 200건짜리 일정이면 저장 1회에 200행이다.
--     → 어댑터는 변경분만 골라 UPDATE 하거나, WHERE 에 값 비교(`AND sort_order <> ?`)를 붙일 것.
--     이건 트리거로는 막을 수 없다(트리거 안에서 IF 로 걸러도 '무엇이 바뀌었나'를
--     컬럼마다 비교해야 하고, 그러면 컬럼 추가 때마다 조용히 새는 자리가 생긴다).
--
--  ★ 비용 — UPDATE 트리거는 편집 한 번마다 행 하나를 남긴다.
--     설계 §7.5 실측은 3,000행 삭제 178ms. 다만 cal_audit_trash 는 자동으로 줄지 않는다.
--     보존 기간·정리 주체는 아직 미결(사내 정책)이며, 앱 계정에는 DELETE 권한이 없으므로
--     정리는 root 또는 별도 스케줄러 계정이 맡아야 한다. 결정되면 회전 스크립트를 별도 파일로 둘 것.
-- =====================================================================
SET NAMES utf8mb4;

-- ---------- 멱등 재적용 ----------
-- 트리거는 CREATE OR REPLACE 가 없다(MySQL 8.4 기준). 먼저 지운다.
DROP TRIGGER IF EXISTS trg_cal_category_bu;
DROP TRIGGER IF EXISTS trg_cal_category_bd;
DROP TRIGGER IF EXISTS trg_cal_entry_bu;
DROP TRIGGER IF EXISTS trg_cal_entry_bd;
DROP TRIGGER IF EXISTS trg_cal_todo_bu;
DROP TRIGGER IF EXISTS trg_cal_todo_bd;
DROP TRIGGER IF EXISTS trg_cal_task_hours_bu;
DROP TRIGGER IF EXISTS trg_cal_task_hours_bd;
DROP TRIGGER IF EXISTS trg_cal_entry_except_bd;
DROP TRIGGER IF EXISTS trg_cal_entry_commit_bu;
DROP TRIGGER IF EXISTS trg_cal_entry_commit_bd;
DROP TRIGGER IF EXISTS trg_cal_todo_day_note_bu;
DROP TRIGGER IF EXISTS trg_cal_todo_day_note_bd;
DROP TRIGGER IF EXISTS trg_cal_room_bu;
DROP TRIGGER IF EXISTS trg_cal_room_bd;

DELIMITER $$

-- =====================================================================
--  1. cal_category — 과제(카테고리)
-- =====================================================================
-- 자식 흡수가 없는 이유: cal_entry·cal_todo 는 fk_*_category 가 ON DELETE RESTRICT 라
--   자식이 남아 있으면 과제 삭제 자체가 ERROR 1451 로 막힌다(CASCADE 로 조용히 지워지지 않는다).
--   cal_task_hours 는 category_id 에 FK 가 없어 앱이 별도 DELETE 로 동반 정리하는데,
--   그 DELETE 는 아래 4번 트리거가 행마다 따로 잡는다.
CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_category_bd
BEFORE DELETE ON cal_category FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_category', 'D', OLD.login_id, OLD.id,
    JSON_OBJECT(
      'login_id',    OLD.login_id,
      'id',          OLD.id,
      'source',      OLD.source,
      'name',        OLD.name,
      'color',       OLD.color,
      'description', OLD.description,
      'project_uid', OLD.project_uid,
      'sort_order',  OLD.sort_order,
      'created_at',  OLD.created_at,
      'updated_at',  OLD.updated_at,
      '_by',         USER(),
      '_conn',       CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_category_bu
BEFORE UPDATE ON cal_category FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_category', 'U', OLD.login_id, OLD.id,
    JSON_OBJECT(
      'login_id',    OLD.login_id,
      'id',          OLD.id,
      'source',      OLD.source,
      'name',        OLD.name,
      'color',       OLD.color,
      'description', OLD.description,
      'project_uid', OLD.project_uid,
      'sort_order',  OLD.sort_order,
      'created_at',  OLD.created_at,
      'updated_at',  OLD.updated_at,
      '_by',         USER(),
      '_conn',       CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

-- =====================================================================
--  2. cal_entry — 일정 (자식 2종 흡수)
-- =====================================================================
CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_entry_bd
BEFORE DELETE ON cal_entry FOR EACH ROW
BEGIN
  DECLARE v_except  JSON;
  DECLARE v_commits JSON;

  -- COALESCE 가 필요한 이유: JSON_ARRAYAGG 는 대상 행이 0건이면 SQL NULL 을 돌려준다.
  -- 그대로 두면 '자식이 없었다'와 '흡수에 실패했다'가 before_img 에서 구분되지 않는다.
  SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('except_date', except_date)), JSON_ARRAY())
    INTO v_except
    FROM cal_entry_except
   WHERE login_id = OLD.login_id AND entry_id = OLD.id;

  SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
           'seq',         seq,
           'hash',        hash,
           'short_hash',  short_hash,
           'commit_time', commit_time,
           'subject',     subject,
           'body',        body)), JSON_ARRAY())
    INTO v_commits
    FROM cal_entry_commit
   WHERE login_id = OLD.login_id AND entry_id = OLD.id;

  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_entry', 'D', OLD.login_id, OLD.id,
    JSON_OBJECT(
      'login_id',       OLD.login_id,
      'id',             OLD.id,
      'category_id',    OLD.category_id,
      'entry_date',     OLD.entry_date,
      'end_date',       OLD.end_date,
      'all_day',        OLD.all_day,
      'start_time',     OLD.start_time,
      'end_time',       OLD.end_time,
      'title',          OLD.title,
      'memo',           OLD.memo,
      'source',         OLD.source,
      'hours_min',      OLD.hours_min,
      'location',       OLD.location,
      'remind',         OLD.remind,
      'recur_freq',     OLD.recur_freq,
      'recur_interval', OLD.recur_interval,
      'recur_until',    OLD.recur_until,
      'recur_count',    OLD.recur_count,
      'created_at',     OLD.created_at,
      'updated_at',     OLD.updated_at,
      '_except',        v_except,
      '_commits',       v_commits,
      '_by',            USER(),
      '_conn',          CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_entry_bu
BEFORE UPDATE ON cal_entry FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_entry', 'U', OLD.login_id, OLD.id,
    JSON_OBJECT(
      'login_id',       OLD.login_id,
      'id',             OLD.id,
      'category_id',    OLD.category_id,
      'entry_date',     OLD.entry_date,
      'end_date',       OLD.end_date,
      'all_day',        OLD.all_day,
      'start_time',     OLD.start_time,
      'end_time',       OLD.end_time,
      'title',          OLD.title,
      'memo',           OLD.memo,
      'source',         OLD.source,
      'hours_min',      OLD.hours_min,
      'location',       OLD.location,
      'remind',         OLD.remind,
      'recur_freq',     OLD.recur_freq,
      'recur_interval', OLD.recur_interval,
      'recur_until',    OLD.recur_until,
      'recur_count',    OLD.recur_count,
      'created_at',     OLD.created_at,
      'updated_at',     OLD.updated_at,
      '_by',            USER(),
      '_conn',          CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

-- =====================================================================
--  3. cal_todo — 할 일 (자식 1종 흡수)
-- =====================================================================
CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_todo_bd
BEFORE DELETE ON cal_todo FOR EACH ROW
BEGIN
  DECLARE v_notes JSON;

  -- note_text 는 보고서 '한 일' 라인의 원천이라 통째로 보존한다(요약·절단하지 않는다).
  SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
           'note_date', note_date,
           'note_text', note_text)), JSON_ARRAY())
    INTO v_notes
    FROM cal_todo_day_note
   WHERE login_id = OLD.login_id AND todo_id = OLD.id;

  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_todo', 'D', OLD.login_id, OLD.id,
    JSON_OBJECT(
      'login_id',     OLD.login_id,
      'id',           OLD.id,
      'category_id',  OLD.category_id,
      'todo_text',    OLD.todo_text,
      'note',         OLD.note,
      'due',          OLD.due,
      'end_date',     OLD.end_date,
      'done',         OLD.done,
      'prio',         OLD.prio,
      'completed_at', OLD.completed_at,
      'created_at',   OLD.created_at,
      'updated_at',   OLD.updated_at,
      '_day_notes',   v_notes,
      '_by',          USER(),
      '_conn',        CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_todo_bu
BEFORE UPDATE ON cal_todo FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_todo', 'U', OLD.login_id, OLD.id,
    JSON_OBJECT(
      'login_id',     OLD.login_id,
      'id',           OLD.id,
      'category_id',  OLD.category_id,
      'todo_text',    OLD.todo_text,
      'note',         OLD.note,
      'due',          OLD.due,
      'end_date',     OLD.end_date,
      'done',         OLD.done,
      'prio',         OLD.prio,
      'completed_at', OLD.completed_at,
      'created_at',   OLD.created_at,
      'updated_at',   OLD.updated_at,
      '_by',          USER(),
      '_conn',        CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

-- =====================================================================
--  4. cal_task_hours — (날짜 × 과제) 투입 시간
-- =====================================================================
-- 이 테이블이 감사에서 가장 중요한 쪽이다: 값이 회사 일간/주간보고 '[과제명] : n' 에 그대로
--   나가는데 updated_at(낙관적 잠금 토큰)이 일부러 없어 마지막 쓰기가 이긴다(스키마 :351-357).
--   즉 두 자리에서 같은 칸을 고쳤을 때 사후 추적 수단이 이 트리거뿐이다.
-- row_key 는 PK 에서 login_id 를 뺀 나머지(work_date|category_id) — login_id 는 별도 컬럼에 있다.
--   DATE_FORMAT 으로 못박는 이유: CONCAT 이 DATE 를 문자열로 바꿀 때의 표기가 세션 설정에
--   좌우되면 나중에 row_key 로 찾을 수가 없다.
CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_task_hours_bd
BEFORE DELETE ON cal_task_hours FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_task_hours', 'D', OLD.login_id,
    CONCAT(DATE_FORMAT(OLD.work_date, '%Y-%m-%d'), '|', OLD.category_id),
    JSON_OBJECT(
      'login_id',    OLD.login_id,
      'work_date',   OLD.work_date,
      'category_id', OLD.category_id,
      'hours',       OLD.hours,
      '_by',         USER(),
      '_conn',       CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_task_hours_bu
BEFORE UPDATE ON cal_task_hours FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_task_hours', 'U', OLD.login_id,
    CONCAT(DATE_FORMAT(OLD.work_date, '%Y-%m-%d'), '|', OLD.category_id),
    JSON_OBJECT(
      'login_id',    OLD.login_id,
      'work_date',   OLD.work_date,
      'category_id', OLD.category_id,
      'hours',       OLD.hours,
      '_by',         USER(),
      '_conn',       CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

-- =====================================================================
--  5. cal_entry_except — 반복 일정의 예외일 (자식)
-- =====================================================================
-- 왜 자식에 다는가: 부모 일정은 그대로 두고 예외일만 전량 비우는 경로가 정상 동작이다.
--   반복 규칙을 저장할 때 freq/interval 중 하나라도 바뀌면 기존 예외가 의미를 잃어
--   recurExcept 를 빈 배열로 갈아끼운다(:5670-5675 — 직접 확인함). 반복을 아예 끄면 조건문이
--   통째로 거짓이 되어 역시 전량 비운다. 화면에는 '기록을 수정했습니다' 토스트 하나만 뜬다.
--   즉 사용자가 되돌리고 싶어 할 삭제인데 부모는 UPDATE 라 살아 있어 부모 흡수가 닿지 않는다.
-- UPDATE 트리거가 없는 이유는 머리주석 참조(고칠 컬럼이 없고 grants 도 UPDATE 를 안 준다).
CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_entry_except_bd
BEFORE DELETE ON cal_entry_except FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_entry_except', 'D', OLD.login_id,
    CONCAT(OLD.entry_id, '|', DATE_FORMAT(OLD.except_date, '%Y-%m-%d')),
    JSON_OBJECT(
      'login_id',    OLD.login_id,
      'entry_id',    OLD.entry_id,
      'except_date', OLD.except_date,
      '_by',         USER(),
      '_conn',       CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

-- =====================================================================
--  6. cal_entry_commit — git/svn 커밋 목록 (자식)
-- =====================================================================
-- 왜 자식에 다는가: 커밋 한 줄만 지우는 UI 가 실재한다(deleteCommitRow :8934,
--   호출부 :9725 커밋내역 탭 · :10486 일간보고서 줄삭제). 부모 일정은 남는다
--   — 단 하나의 예외가 '마지막 커밋이면 deleteEntry 로 일정째 제거'(:8942)인데,
--   그때는 CASCADE 라 자식 트리거가 안 돌고 부모 흡수가 대신 받는다. 겹치지 않는다.
-- 왜 UPDATE 도 다는가: (1) subject/body 인라인 편집(setCommitSubject :8898 /
--   setCommitMessage :8907)이 c.subject·c.body 를 제자리 대입한다. (2) 중간 커밋을 splice
--   하면 뒤 원소의 배열 인덱스가 당겨져 seq(스키마 :247)를 다시 써야 한다.
--   ★ 이 표에는 updated_at 이 없다(잠금 단위는 부모 cal_entry). 즉 행 단위로 '언제 누가
--     고쳤나'를 아는 수단이 이 트리거뿐이다 — cal_task_hours 와 같은 논리다.
-- 비용: seq 재부여는 한 커밋을 지워도 뒤 행 수만큼 U 행을 남긴다(200건짜리 일정의 첫 커밋을
--   지우면 D 1 + U 199). 어댑터가 '전량 DELETE 후 재INSERT' 를 택하면 D n + I 0 으로 줄지만
--   그 경우 before_img 는 그대로 다 남는다. 어느 쪽이든 기록은 잃지 않는다.
CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_entry_commit_bd
BEFORE DELETE ON cal_entry_commit FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_entry_commit', 'D', OLD.login_id,
    CONCAT(OLD.entry_id, '|', OLD.seq),
    JSON_OBJECT(
      'login_id',    OLD.login_id,
      'entry_id',    OLD.entry_id,
      'seq',         OLD.seq,
      'hash',        OLD.hash,
      'short_hash',  OLD.short_hash,
      'commit_time', OLD.commit_time,
      'subject',     OLD.subject,
      'body',        OLD.body,
      '_by',         USER(),
      '_conn',       CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_entry_commit_bu
BEFORE UPDATE ON cal_entry_commit FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_entry_commit', 'U', OLD.login_id,
    CONCAT(OLD.entry_id, '|', OLD.seq),
    JSON_OBJECT(
      'login_id',    OLD.login_id,
      'entry_id',    OLD.entry_id,
      'seq',         OLD.seq,
      'hash',        OLD.hash,
      'short_hash',  OLD.short_hash,
      'commit_time', OLD.commit_time,
      'subject',     OLD.subject,
      'body',        OLD.body,
      '_by',         USER(),
      '_conn',       CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

-- =====================================================================
--  7. cal_todo_day_note — 기간 할일의 날짜별 설명 (자식)
-- =====================================================================
-- 왜 자식에 다는가: '빈 값 저장 = 행 삭제' 가 이 표의 계약이다(스키마 :315-317).
--   normalizeTodoDayNotes(:8757-8766)가 updateTodo 마다 돌면서 빈 값·기한 범위 밖 날짜를
--   탈락시키고(:8804), 기간 할일을 단일 할일로 되돌리면 dn = {} 로 전량이 사라진다(:8802).
--   부모 할일은 살아 있으므로 부모 흡수가 닿지 않는다. grants-calendar.sql:91-95 가 이 표에
--   DELETE 를 준 근거로 든 것이 정확히 이 경로다.
-- 왜 UPDATE 도 다는가(2차 브리프의 지목보다 넓힌 자리 — 근거는 머리주석):
--   날짜별 설명 편집이 updateTodo(id, {dayNotes:{[date]:값}})(:8979) → :8793 의 Object.assign
--   덮어쓰기로 들어온다. PK 는 그대로고 note_text 만 바뀌는 제자리 수정이다.
--   note_text 는 보고서 '한 일' 라인의 원천이라(부모 흡수 주석과 같은 이유) 덮어쓰기 전 값을
--   잃으면 보고서에 무엇이 적혀 있었는지 복원할 길이 없다.
CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_todo_day_note_bd
BEFORE DELETE ON cal_todo_day_note FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_todo_day_note', 'D', OLD.login_id,
    CONCAT(OLD.todo_id, '|', DATE_FORMAT(OLD.note_date, '%Y-%m-%d')),
    JSON_OBJECT(
      'login_id',  OLD.login_id,
      'todo_id',   OLD.todo_id,
      'note_date', OLD.note_date,
      'note_text', OLD.note_text,
      '_by',       USER(),
      '_conn',     CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_todo_day_note_bu
BEFORE UPDATE ON cal_todo_day_note FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_todo_day_note', 'U', OLD.login_id,
    CONCAT(OLD.todo_id, '|', DATE_FORMAT(OLD.note_date, '%Y-%m-%d')),
    JSON_OBJECT(
      'login_id',  OLD.login_id,
      'todo_id',   OLD.todo_id,
      'note_date', OLD.note_date,
      'note_text', OLD.note_text,
      '_by',       USER(),
      '_conn',     CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

-- =====================================================================
--  8. cal_room — 장소(회의실) 빠른선택 목록
-- =====================================================================
-- 자식이 아니라 독립 표지만(부모는 app_user) 여기 함께 두는 이유는 위 셋과 같다 —
--   삭제가 정상 경로이고, 그 삭제를 흡수해 줄 부모 트리거가 없다(app_user 는 이 파일 범위 밖이고
--   fk_cal_room_user 는 ON DELETE RESTRICT 라 애초에 CASCADE 가 일어나지 않는다).
-- 왜 다는가: deleteRoom(:5872-5877)이 목록에서 splice 한다. 실행취소 토스트가 붙어 있지만
--   토스트가 사라지면 끝이고, 다시 추가해도 sort_order 는 맨 뒤로 간다(addRoom :5862-5871 은
--   push 다) — 즉 원래 순서는 복원되지 않는다.
-- 왜 UPDATE 도 다는가: 중간 항목이 빠지면 뒤 회의실의 sort_order 를 다시 써야 한다
--   (grants-calendar.sql:97-102 가 UPDATE 를 준 근거). 이 표는 updated_at 을 일부러 두지 않아
--   (스키마 :328-333) 행이 언제 바뀌었는지 아는 수단이 이 트리거뿐이다.
--   ※ 스키마 :330 의 "UPDATE 경로가 없다"는 '이름을 제자리에서 바꾸는 경로가 없다'는 뜻이지
--     sort_order 재부여까지 없다는 뜻이 아니다. updated_at 을 더하지 않는 결정은 그대로 두고
--     (값 행이라 두 사람이 같은 행을 다르게 고치는 상황이 성립하지 않는다) 추적만 여기서 받는다.
-- row_key 는 PK 에서 login_id 를 뺀 name 하나 — 구분자가 없다.
CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_room_bd
BEFORE DELETE ON cal_room FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_room', 'D', OLD.login_id, OLD.name,
    JSON_OBJECT(
      'login_id',   OLD.login_id,
      'name',       OLD.name,
      'sort_order', OLD.sort_order,
      '_by',        USER(),
      '_conn',      CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

CREATE DEFINER = CURRENT_USER TRIGGER trg_cal_room_bu
BEFORE UPDATE ON cal_room FOR EACH ROW
BEGIN
  INSERT INTO cal_audit_trash (table_name, op, login_id, row_key, before_img, acted_at)
  VALUES ('cal_room', 'U', OLD.login_id, OLD.name,
    JSON_OBJECT(
      'login_id',   OLD.login_id,
      'name',       OLD.name,
      'sort_order', OLD.sort_order,
      '_by',        USER(),
      '_conn',      CONNECTION_ID()),
    UTC_TIMESTAMP(3));
END$$

DELIMITER ;

-- =====================================================================
--  릴리스 게이트 — 배포 후 관리 계정으로 실행해 눈으로 확인할 것
--  (이 파일이 exit 0 이라고 끝난 게 아니다. 특히 1)은 schema-calendar.sql 재실행 뒤 반드시)
-- ---------------------------------------------------------------------
--  1) 트리거 15개가 실재하는지 (기대값 15 — 부모 4표 × 2 + 자식 3표(commit·day_note·room) × 2
--     + cal_entry_except 의 DELETE 1)
--     SELECT COUNT(*) FROM information_schema.TRIGGERS
--      WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE 'trg\_cal\_%';
--     ※ 이 숫자를 '파일에서 세어 채우지 말 것'. init-calendar.ps1 의 $DESIGN_TRIGGERS 상수와
--       설계 §7.5 목록이 기대값의 출처다 — 검증 대상 파일에서 기대값을 뽑으면 게이트가 헛돈다.
--
--  2) 어느 표에 어떤 동사가 걸렸는지 (15행. cal_entry_except 만 D 한 줄인 것이 정상)
--     SELECT EVENT_OBJECT_TABLE, EVENT_MANIPULATION, ACTION_TIMING, DEFINER
--       FROM information_schema.TRIGGERS
--      WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE 'trg\_cal\_%'
--      ORDER BY EVENT_OBJECT_TABLE, EVENT_MANIPULATION;
--
--  3) ★ DEFINER 가 실재하고 앱 계정이 아닌지 (기대값 0 — 0 이 아니면 쓰기가 1449 로 죽거나
--        앱 계정이 자기 흔적을 지울 수 있다)
--     SELECT COUNT(*) FROM information_schema.TRIGGERS t
--      LEFT JOIN mysql.user u
--             ON CONCAT(u.user,'@',u.host) = REPLACE(t.DEFINER,'`','')
--      WHERE t.TRIGGER_SCHEMA = DATABASE() AND t.TRIGGER_NAME LIKE 'trg\_cal\_%'
--        AND (u.user IS NULL OR u.user = 'taskmgr_app');
--
--  4) ★ 앱 계정에서 트리거가 보이지 않고 지울 수도 없는지 (앱 계정으로 접속해 실행)
--     SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='taskmgr';  -- 기대값 0
--     DROP TRIGGER trg_cal_entry_bd;                                                    -- 기대: ERROR 1142
--     SELECT * FROM cal_audit_trash;                                                    -- 기대: ERROR 1142
--
--  5) 실제 삭제가 휴지통에 남는지 — 시험 데이터가 있는 격리 DB 에서만 할 것
--     자식이 달린 cal_entry 를 하나 지운 뒤:
--     SELECT table_name, op, row_key,
--            JSON_LENGTH(before_img->'$._except')  AS except_n,
--            JSON_LENGTH(before_img->'$._commits') AS commit_n
--       FROM cal_audit_trash ORDER BY audit_id DESC LIMIT 1;
--     → except_n / commit_n 이 지우기 전 자식 건수와 같아야 한다. 0 이면 흡수가 실패한 것이다.
--
--  6) ★ 자식만 지웠을 때 자식 트리거가 도는지 (5)와 짝을 이뤄야 '누락 없음'이 증명된다)
--     격리 DB 에서 부모는 그대로 두고 자식 행만:
--       DELETE FROM cal_entry_except  WHERE login_id=? AND entry_id=?;
--       DELETE FROM cal_todo_day_note WHERE login_id=? AND todo_id=?;
--       DELETE FROM cal_entry_commit  WHERE login_id=? AND entry_id=? AND seq=?;
--       DELETE FROM cal_room          WHERE login_id=? AND name=?;
--     SELECT table_name, op, COUNT(*) FROM cal_audit_trash GROUP BY 1,2;
--     → 지운 자식 건수만큼 D 행이 있어야 한다. 0 이면 자식 트리거가 빠진 것이다.
--
--  7) ★ 부모를 지웠을 때 자식 트리거가 돌지 '않는지' (중복 적재 없음의 증명)
--     cal_audit_trash 를 비운 뒤 자식이 달린 cal_entry 를 부모째 하나 지우고:
--     SELECT table_name, op, COUNT(*) FROM cal_audit_trash GROUP BY 1,2;
--     → cal_entry / D 한 행만 나와야 한다. cal_entry_except·cal_entry_commit 행이 함께
--       보이면 CASCADE 가 자식 트리거를 부른 것이고, 그러면 부모 흡수 JSON 과 중복이다.
--       (실측 MySQL 8.4.9: 부르지 않는다. 서버를 올릴 때 이 항목을 다시 볼 것)
-- =====================================================================
