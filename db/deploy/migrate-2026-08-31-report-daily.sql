-- =====================================================================
--  migrate-2026-08-31-report-daily.sql
--  일간보고 사본 2표 신설 — cal_report_daily · cal_report_hours
--  schema_version 5 → 6
-- =====================================================================
--
--  【무엇을 저장하는가 — "보낸 것"이 아니라 "사이트에 있는 것"】
--    사용자는 캘린더로 초안을 만든 뒤 netcus 사이트에서 상세를 직접 고친다(2026-08-31 사용자 확인).
--    그러므로 위젯이 보낸 값은 최종본이 아니다. 이 두 표는 **사이트의 사본**이다.
--    content_from 이 그 출처를 밝힌다 — 0=우리가 보냄(초안) · 1=사이트에서 읽음(확인본).
--
--  【왜 일간만인가】
--    · 일간은 주소가 (사번, 날짜)로 결정된다 — pjm_work_view.jsp?y&m&d&id (NetcusService.cs:737).
--      검색이 아니라 직접 주소라 "그 날의 최종본"에 확답이 된다. 레거시도 하루 한 행이다.
--    · 주간은 게시판이라 글을 뒤져서 추측한다(작성일 창 ±7일 · 기간 겹침 · 상한 60건).
--      한 주에 글이 2개면 어느 게 최종인지 코드가 정하지 못한다. 그래서 주간은
--      netcusWeeklyRangeRead 회신에 view_no 를 실은 뒤 (user_id, view_no) 키로 따로 만든다.
--
--  【공수의 원천은 여기다 — cal_task_hours 가 아니다】
--    cal_task_hours = 캘린더에 입력한 시간 = **초안**(사용자가 언제든 고친다).
--    cal_report_hours = 실제로 보고된 시간 = **확정**.
--    둘을 나누는 이유: 보고 후 캘린더를 고치면 과거 집계가 소급해서 바뀐다.
--    회사에 낸 숫자와 계산기 숫자가 어긋나면 계산기를 믿을 수 없다.
--
--    ★ 시간과 상세 내용이 content **한 칸**에 같이 들어 있다(레거시 workpaper_tbl.content).
--      사용자가 "상세를 고친다" = 시간 줄이 든 그 칸을 고친다는 뜻이다.
--      그래서 hours 는 **되읽은 content 를 파싱해서** 채운다. 보낸 값을 그대로 넣으면 안 된다.
--      파서는 이미 있다 — task-calendar-prototype.html:7949 (reHours, '[과제] : n' 계약).
--
--  【적용】
--    mysql -u root -p --default-character-set=utf8mb4 taskmgr < migrate-2026-08-31-report-daily.sql
--    · 실행 전 백업 — db/deploy/backup-taskmgr.ps1
--    · 재실행 안전(멱등). 이미 있으면 조용히 통과한다.
-- =====================================================================

SET NAMES utf8mb4;
SET SESSION lock_wait_timeout = 10;

-- ── 선행 조건: 이 표들이 매달릴 곳이 있어야 한다 ─────────────────────
SET @has_user := (SELECT COUNT(*) FROM information_schema.TABLES
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user');
SET @g := IF(@has_user = 1, 'DO 0',
             'SELECT 1 FROM `중단: app_user 가 없다 - schema-calendar.sql 을 먼저 적용할 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ── 1단계: cal_report_daily ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cal_report_daily (
  user_id      SMALLINT UNSIGNED NOT NULL,                                  -- 소유자(app_user.user_id)
  work_date    DATE              NOT NULL,                                  -- 보고 대상 날짜. 하루 한 행 — 사이트가 그렇다
  status       VARCHAR(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
                                                                            -- 근태 코드. cal_attendance.status 와 같은 타입이라 대조 가능
  overtime     TINYINT           NOT NULL DEFAULT 0,                        -- 초과시간(정수). cal_attendance 와 같음
  content      MEDIUMTEXT        NOT NULL,                                  -- 본문 전체. 레거시 workpaper_tbl.content 와 같은 크기
  content_at   DATETIME(3)       NOT NULL,                                  -- 이 내용의 시각(보낸 시각 또는 읽은 시각)
  content_from TINYINT           NOT NULL DEFAULT 0,                        -- 0=우리가 보냄(초안) · 1=사이트에서 읽음(확인본)
  created_at   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, work_date),
  KEY idx_crd_from (user_id, content_from),                                 -- "아직 초안인 날" 조회
  CONSTRAINT fk_crd_user FOREIGN KEY (user_id) REFERENCES app_user (user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_crd_from01 CHECK (content_from IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='netcus 일간보고 사본. 원본은 사이트 — content_from 이 초안/확인본을 구분한다';

-- ── 2단계: cal_report_hours ──────────────────────────────────────────
--   ★ cat_no 에 FK 를 걸지 않는다. 과제를 지워도 **과거 보고 기록은 남아야 하기 때문**이다.
--     진실은 task_name(사이트 원문)이고 cat_no 는 매칭 결과일 뿐이다.
--     복합 FK 로는 ON DELETE SET NULL 도 못 쓴다(user_id 가 NOT NULL 이라 MySQL 이 거부한다).
CREATE TABLE IF NOT EXISTS cal_report_hours (
  user_id    SMALLINT UNSIGNED NOT NULL,
  work_date  DATE              NOT NULL,
  line_no    SMALLINT UNSIGNED NOT NULL,                                    -- content 안에서의 줄 순서(0부터). 순서 보존 + 좁은 키
  task_name  VARCHAR(200)      NOT NULL,                                    -- 사이트 원문 그대로. 과제명이 바뀌어도 과거는 안 흔들린다
  cat_no     INT UNSIGNED      NULL,                                        -- 매칭되면 채움 · NULL = 미분류(FK 없음 — 위 ★)
  hours      DECIMAL(5,2)      NOT NULL,                                    -- 파서가 Math.round(x*100)/100 로 만드는 값과 정확히 같은 정밀도
  PRIMARY KEY (user_id, work_date, line_no),
  KEY idx_crh_cat (user_id, cat_no, work_date),                             -- 계산기: 과제별 기간 합계
  CONSTRAINT fk_crh_daily FOREIGN KEY (user_id, work_date)
    REFERENCES cal_report_daily (user_id, work_date) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_crh_hours CHECK (hours >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='보고된 과제별 시간 — 공수계산기의 원천. 되읽은 content 를 파싱해 채운다(보낸 값 아님)';

-- ── 3단계: schema_version 5 → 6 ──────────────────────────────────────
UPDATE cal_schema_meta SET v = '6', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'schema_version' AND v = '5';

-- ── (E) 사후 검증 — 사람이 읽는 출력 ─────────────────────────────────
SELECT CONCAT('  ', TABLE_NAME, ' : 컬럼 ', COUNT(*), '개') AS `E1`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('cal_report_daily','cal_report_hours')
 GROUP BY TABLE_NAME;
SELECT CONCAT('  schema_version = ', v) AS `E2` FROM cal_schema_meta WHERE k = 'schema_version';

-- ── (E9) 차단형 사후 검증 ────────────────────────────────────────────
SET @bad := (SELECT
    (SELECT COUNT(*) <> 2 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('cal_report_daily','cal_report_hours'))
  + (SELECT COUNT(*) <> 2 FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'
        AND TABLE_NAME IN ('cal_report_daily','cal_report_hours'))
  + (SELECT COUNT(*) = 0 FROM cal_schema_meta WHERE k = 'schema_version' AND v = '6'));
SET @g := IF(@bad = 0, 'DO 0',
             'SELECT 1 FROM `중단: 사후 검증 실패 - 위 E1/E2 를 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT '완료 — cal_report_daily · cal_report_hours · schema_version 6' AS `결과`;
