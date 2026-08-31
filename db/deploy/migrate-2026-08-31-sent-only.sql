-- =====================================================================
--  migrate-2026-08-31-sent-only.sql
--  보고 표를 「캘린더가 만든 것만」으로 좁힌다
--  schema_version 7 → 8
-- =====================================================================
--
--  【왜 좁히는가 — 2026-08-31 사용자 결정】
--    "캘린더에서는 캘린더에서 작성한 일간,주간만 관리하면 된다.
--     사실상 홈페이지 가서 수정하거나 다른 작업한 걸 여기서 어떻게 알아차려서 수정해.
--     그건 맞지 않다."
--
--    구조적으로 맞는 판단이다. 사이트는 **우리에게 무효화 신호를 주지 않는다**.
--    그래서 "지금 사이트에 뭐가 있나"는 우리가 물어보기 전엔 알 수 없고,
--    물어본 뒤에도 그 순간의 사진일 뿐이다.
--
--    ★ 검증된 사실 옆에 검증 못 하는 추측을 두면, 표 전체의 신뢰도가 추측 수준으로 떨어진다.
--      그래서 이 표들은 **우리가 아는 사실만** 담는다 — "우리가 무엇을 보냈는가".
--
--  【이 표가 답하는 질문 / 답하지 않는 질문】
--    답한다:      "캘린더가 8/29 에 무엇을 보고했나"            \u2192 항상 참. 과거는 안 바뀐다
--    답하지 않는다: "지금 사이트의 8/29 보고는 무엇인가"          \u2192 물어봐야 안다. 이 표의 일이 아니다
--
--    화면도 그렇게 써야 한다 — "캘린더 기준" 이지 "회사 기록" 이 아니다.
--    회사 기록 그대로가 필요해지면 답은 크롤링이 아니라 **레거시 DB 읽기 권한**이다.
--    그때는 이 표들을 그대로 두고 채우는 경로만 바꾼다.
--
--  【무엇이 바뀌나】
--    1. cal_report_daily.content_from 제거   — 전부 '보냄'이라 죽은 컬럼
--       cal_report_daily.content_at \u2192 sent_at — 「이 내용의 시각」이 아니라 「보낸 시각」
--    2. cal_report_weekly 재작성            — view_no 는 크롤링해야 얻는 값이라 쓸 수 없다.
--       캘린더는 기간을 스스로 정하므로 키는 (user_id, period_start) 로 충분하다.
--       재작성하면 덮어쓴다(사용자 결정 #3).
--
--    ※ 되읽기(netcusWeekMerge / netcusWeeklyRangeRead)에는 DB 쓰기를 얹지 않는다.
--      그 기능들은 원래 목적(주간 초안 만들기 · 기간 취합 미리보기)으로만 남는다.
--
--  【부수 효과 — 파서가 필요 없어졌다】
--    JS 는 본문을 만들 때 taskHours 를 이미 손에 들고 있다. reHours 로 되파싱할 이유가 없다.
--    그래서 파싱 실패 \u00b7 표기 흔들림 \u00b7 미분류 문제가 통째로 사라진다.
--    cal_report_hours.cat_no 도 이름 매칭이 아니라 **원래 알던 값**이 들어간다.
--
--  【적용】 mysql -u root -p --default-character-set=utf8mb4 taskmgr < migrate-2026-08-31-sent-only.sql
--    · 두 표 모두 0행일 때만 안전하게 재작성한다(아래 가드). 데이터가 있으면 중단한다.
-- =====================================================================

SET NAMES utf8mb4;
SET SESSION lock_wait_timeout = 10;

-- ── 가드: 데이터가 있으면 중단 ───────────────────────────────────────
SET @n_d := (SELECT COUNT(*) FROM cal_report_daily);
SET @n_w := (SELECT COUNT(*) FROM cal_report_weekly);
SET @g := IF(@n_d = 0 AND @n_w = 0, 'DO 0',
             'SELECT 1 FROM `중단: 보고 표에 데이터가 있다 - 이 파일은 재작성한다`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

-- ── 1단계: cal_report_daily 정리 ─────────────────────────────────────
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_daily' AND INDEX_NAME = 'idx_crd_from');
SET @s := IF(@has = 0, 'DO 0', 'ALTER TABLE cal_report_daily DROP INDEX idx_crd_from');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_daily' AND CONSTRAINT_NAME = 'chk_crd_from01');
SET @s := IF(@has = 0, 'DO 0', 'ALTER TABLE cal_report_daily DROP CHECK chk_crd_from01');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_daily' AND COLUMN_NAME = 'content_from');
SET @s := IF(@has = 0, 'DO 0', 'ALTER TABLE cal_report_daily DROP COLUMN content_from');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_daily' AND COLUMN_NAME = 'content_at');
SET @s := IF(@has = 0, 'DO 0',
             'ALTER TABLE cal_report_daily CHANGE COLUMN content_at sent_at DATETIME(3) NOT NULL');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ── 1-b: 표 주석도 갱신 — DB 안의 설명이 낡은 채 남지 않게 한다
ALTER TABLE cal_report_daily COMMENT='캘린더가 보낸 일간보고. 사이트의 현재 상태가 아니다';
ALTER TABLE cal_report_hours COMMENT='보낸 과제별 시간 — 공수계산기의 원천. 캘린더가 본문을 만들 때 이미 아는 값이다(파싱 아님)';

-- ── 2단계: cal_report_weekly 재작성 ──────────────────────────────────
DROP TABLE IF EXISTS cal_report_weekly;
CREATE TABLE cal_report_weekly (
  user_id      SMALLINT UNSIGNED NOT NULL,                                  -- 소유자(app_user.user_id)
  period_start DATE              NOT NULL,                                  -- 캘린더가 정한 기간 시작(WeekFill 의 sdate)
  period_end   DATE              NOT NULL,                                  -- 기간 끝(edate)
  subject      VARCHAR(200)      NOT NULL DEFAULT '',                       -- 캘린더가 만든 제목('8월 셋째주')
  content      MEDIUMTEXT        NOT NULL,                                  -- 과제투입시간. 집계는 일간 원자로 한다(이중 계산 방지)
  endwork      MEDIUMTEXT        NOT NULL,                                  -- 진행사항
  plan         MEDIUMTEXT        NOT NULL,                                  -- 차주계획(캘린더가 만든 머리표)
  composed_at  DATETIME(3)       NOT NULL,                                  -- 캘린더가 이 주간보고를 작성한 시각
  created_at   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, period_start),
  CONSTRAINT fk_crw_user FOREIGN KEY (user_id) REFERENCES app_user (user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_crw_period CHECK (period_start <= period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='캘린더가 작성한 주간보고. 사이트의 현재 상태가 아니다 - 사용자가 폼에서 보완한 내용은 담기지 않는다';
--  ★ composed_at 이지 sent_at 이 아닌 이유: 위젯은 주간을 **전송하지 않는다**(NetcusService.cs:666
--    "폼을 채웠습니다 - 보완 후 열린 창에서 직접 '제출'하세요"). 우리가 아는 사실은 '작성했다'까지다.

UPDATE cal_schema_meta SET v = '8', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'schema_version' AND v = '7';

SELECT CONCAT('  ', TABLE_NAME, ' : 컬럼 ', COUNT(*), '개') AS `E1`
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'cal_report%' GROUP BY TABLE_NAME;
SELECT CONCAT('  schema_version = ', v) AS `E2` FROM cal_schema_meta WHERE k = 'schema_version';

SET @bad := (SELECT
    (SELECT COUNT(*) <> 0 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_daily' AND COLUMN_NAME IN ('content_from','content_at'))
  + (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_daily' AND COLUMN_NAME = 'sent_at')
  + (SELECT COUNT(*) <> 0 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly' AND COLUMN_NAME IN ('view_no','fetched_at','period_raw','regdate'))
  + (SELECT COUNT(*) = 0 FROM cal_schema_meta WHERE k = 'schema_version' AND v = '8'));
SET @g := IF(@bad = 0, 'DO 0', 'SELECT 1 FROM `중단: 사후 검증 실패 - 위 E1/E2 를 볼 것`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;

SELECT '완료 — 캘린더가 만든 것만 · schema_version 8' AS `결과`;
