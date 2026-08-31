-- =====================================================================
--  migrate-2026-08-31-report-weekly.sql
--  주간보고 사본 1표 신설 — cal_report_weekly
--  schema_version 6 → 7
-- =====================================================================
--
--  【일간과 무엇이 다른가 — 이 표에 content_from 이 없는 이유】
--    일간은 위젯이 **자동 전송**하고 되읽어 검증까지 한다(NetcusService.cs:570).
--    그래서 "우리가 보낸 초안"과 "사이트에서 읽은 확인본"이 둘 다 존재하고,
--    cal_report_daily 는 content_from 으로 그 둘을 구분한다.
--
--    주간은 다르다. 위젯은 **폼만 채우고 전송하지 않는다** — NetcusService.cs:666
--      "주간보고 작성 폼을 채웠습니다 — 차주계획 내용 등을 보완 후 열린 창에서 직접 '제출'하세요."
--    즉 위젯은 주간의 전송 시점 자체를 모른다. 이 표에 들어오는 값은 **전부 사이트에서 읽은 것**이다.
--    항상 같은 값이 될 컬럼은 죽은 컬럼이므로 두지 않는다. 대신 fetched_at 이 "언제 읽었나"를 남긴다.
--
--  【왜 키가 (user_id, view_no) 인가 — period_start 가 아니다】
--    주간은 게시판 글이라 **한 주에 2건 이상**일 수 있다(고쳐 쓰거나 나눠 쓰거나).
--    (user_id, period_start) 를 키로 잡으면 그때 하나가 **조용히 덮인다** — 무음 손실이다.
--    사이트의 진짜 식별자는 글번호(view_no)다. 2건이면 2행으로 두고 화면이 드러내게 한다.
--
--    ★ view_no 가 무엇인지 — 2026-08-31 코드 근거로 판정
--      NetcusService.cs:822~859 크롤러는 viewNo 로 **페이지를 넘나들며 중복을 제거**한다.
--      viewNo 가 페이지 안 순번이면 2페이지에서 같은 값이 나와 anyNew=false → 1페이지 만에 멈춘다.
--      그런데 MAXPAGES=40 까지 도는 이 크롤러가 실제로 동작해 왔다.
--      → viewNo 는 **전역 유일한 레코드 식별자**다(목록 위치가 아니다).
--      NetcusText.cs:66 도 이를 뒷받침한다 — 페이징(start)이 별도로 있는데 view_no 가 또 있고,
--      hidden 으로 table_code='report_tbl' 을 실어 조회한다. 레거시 report_tbl.number 로 추정된다.
--
--      ※ 설령 '사용자별 일련번호'였더라도 우리 키에는 user_id 가 붙어 있어 **여전히 유일**하다.
--        위험한 해석은 '목록 위치 순번' 하나뿐인데, 그건 위 dedup 논리가 배제한다.
--
--  【주간 공수는 저장하지 않는다】
--    content(과제투입시간)는 **원문 그대로 보관**하되 파싱해서 별도 표에 넣지 않는다.
--    주간은 그 주 일간의 합이라(task-calendar-prototype.html:7887) 둘 다 집계하면 이중 계산이 된다.
--    공수의 원천은 cal_report_hours(일간 원자)다. 주간 content 는 **대조용**이다 —
--    일간 합과 다르면 "주간에 낸 숫자와 일간 합이 다르다"고 알릴 수 있다.
--
--  【사이트에 있으나 저장하지 않는 칸】
--    notendwork(금주 미완료) · problem(문제점) · resultwork — 되읽기 회신에 없다(NetcusService.cs:786).
--    위젯이 채우지도 않는다(:55 는 subject·content·endwork·planwork 4개뿐).
--    필요해지면 NetcusText.cs:76 CellExtractJs 에 라벨을 추가한 뒤 컬럼을 넣는다.
--    iscompletion(제출 여부)도 같은 이유로 미저장.
--
--  【적용】
--    mysql -u root -p --default-character-set=utf8mb4 taskmgr < migrate-2026-08-31-report-weekly.sql
--    · 실행 전 백업 — db/deploy/backup-taskmgr.ps1
--    · 재실행 안전(멱등).
-- =====================================================================

SET NAMES utf8mb4;
SET SESSION lock_wait_timeout = 10;

SET @has_user := (SELECT COUNT(*) FROM information_schema.TABLES
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user');
SET @g := IF(@has_user = 1, 'DO 0',
             'SELECT 1 FROM `중단: app_user 가 없다 - schema-calendar.sql 을 먼저 적용할 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

CREATE TABLE IF NOT EXISTS cal_report_weekly (
  user_id      SMALLINT UNSIGNED NOT NULL,                                  -- 소유자(app_user.user_id)
  view_no      INT UNSIGNED      NOT NULL,                                  -- 사이트 글번호(go_view 인자). 위 ★ 참조
  period_raw   VARCHAR(64)       NOT NULL DEFAULT '',                       -- 사이트 표시 문자열 원문. 파싱 실패해도 사실은 남는다
  period_start DATE              NULL,                                      -- 파싱 성공 시에만. 크롤러는 파싱 실패해도 관대 포함한다(:869)
  period_end   DATE              NULL,
  subject      VARCHAR(200)      NOT NULL DEFAULT '',                       -- 제목('8월 셋째주')
  content      MEDIUMTEXT        NOT NULL,                                  -- 과제투입시간 원문. 집계하지 않는다(위 【주간 공수】)
  endwork      MEDIUMTEXT        NOT NULL,                                  -- 진행사항
  plan         MEDIUMTEXT        NOT NULL,                                  -- 차주계획
  regdate      DATE              NULL,                                      -- 사이트 작성일. 목록/상세 어느 쪽도 없을 수 있다
  fetched_at   DATETIME(3)       NOT NULL,                                  -- 사이트를 읽은 시각. 이 표에 초안은 없다
  created_at   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, view_no),
  KEY idx_crw_period (user_id, period_start),                               -- 기간 조회. 한 주 2건이면 2행이 나온다 - 그게 의도다
  CONSTRAINT fk_crw_user FOREIGN KEY (user_id) REFERENCES app_user (user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_crw_period CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='netcus 주간보고 사본. 전부 사이트에서 읽은 것 - 위젯은 주간을 전송하지 않는다';

UPDATE cal_schema_meta SET v = '7', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'schema_version' AND v = '6';

SELECT CONCAT('  cal_report_weekly : 컬럼 ', COUNT(*), '개') AS `E1`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly';
SELECT CONCAT('  schema_version = ', v) AS `E2` FROM cal_schema_meta WHERE k = 'schema_version';

SET @bad := (SELECT
    (SELECT COUNT(*) = 0 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly')
  + (SELECT COUNT(*) = 0 FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly' AND CONSTRAINT_TYPE = 'FOREIGN KEY')
  + (SELECT COUNT(*) = 0 FROM cal_schema_meta WHERE k = 'schema_version' AND v = '7'));
SET @g := IF(@bad = 0, 'DO 0', 'SELECT 1 FROM `중단: 사후 검증 실패 - 위 E1/E2 를 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT '완료 — cal_report_weekly · schema_version 7' AS `결과`;
