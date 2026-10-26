-- @migration from=19 to=20
-- 기존 일간 및 주간 보고에 회사 성공 후 저장하는 구조화 내용을 추가한다.
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @m_upd := (SELECT v FROM cal_schema_meta WHERE k = 'db_updating');
SET @go := (@m_cur <=> '19');
SET @skip := (@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 20);
SET @g := IF(@go OR @skip, 'DO 0', 'SELECT 1 FROM `중단: v20 구조 번호 불일치`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @g := IF(NOT @go OR @m_upd <=> '1', 'DO 0', 'SELECT 1 FROM `중단: v20 닫기 상태 불일치`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
SET @m_has := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_daily' AND COLUMN_NAME = 'report_json');
SET @s := IF(@go AND @m_has = 0, 'ALTER TABLE cal_report_daily ADD COLUMN report_json JSON NULL', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @m_c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_daily' AND COLUMN_NAME = 'report_json' AND DATA_TYPE = 'json' AND IS_NULLABLE = 'YES');
SET @m_has := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly' AND COLUMN_NAME = 'report_json');
SET @s := IF(@go AND @m_has = 0, 'ALTER TABLE cal_report_weekly ADD COLUMN report_json JSON NULL', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @m_c2 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly' AND COLUMN_NAME = 'report_json' AND DATA_TYPE = 'json' AND IS_NULLABLE = 'YES');
SET @m_has := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly' AND COLUMN_NAME = 'submitted_at');
SET @s := IF(@go AND @m_has = 0, 'ALTER TABLE cal_report_weekly ADD COLUMN submitted_at DATETIME(3) NULL', 'DO 0');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
SET @m_c3 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cal_report_weekly' AND COLUMN_NAME = 'submitted_at' AND DATA_TYPE = 'datetime' AND IS_NULLABLE = 'YES');
SET @g := IF(NOT @go OR (@m_c1 = 1 AND @m_c2 = 1 AND @m_c3 = 1), 'DO 0', 'SELECT 1 FROM `중단: v20 보고 열 검증 실패`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
UPDATE cal_schema_meta SET v = '20', updated_at = UTC_TIMESTAMP(3)
 WHERE k = 'db_structure_version' AND v = '19';
SET @m_cur := (SELECT v FROM cal_schema_meta WHERE k = 'db_structure_version');
SET @g := IF(@m_cur REGEXP '^[0-9]{1,6}$' AND CAST(@m_cur AS UNSIGNED) >= 20, 'DO 0', 'SELECT 1 FROM `중단: v20 끝 확인 실패`');
PREPARE _g FROM @g; EXECUTE _g; DEALLOCATE PREPARE _g;
