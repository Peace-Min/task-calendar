-- @data version=0.28.0
-- 0.28.0 판 데이터 단계: 일정과 할 일의 sort_order 를 0.27.0 화면 순서로 한 번 다시 매긴다(docs/ITEM-ORDER.md §4).
--   0.27.0 은 sort_order 를 화면에 쓰지 않고 그릴 때 다시 정렬했다. 0.28.0 은 저장된 순서(ORDER BY sort_order, uid)를
--   그대로 보이므로, 그대로 두면 업데이트 뒤 순서가 바뀌어 보인다. 그래서 배포 때 사람마다 0.27.0 이 보이던 순서로
--   0 부터 빈틈 없이 다시 매긴다.
--   일정(0.27.0 entrySort): 종일 먼저, 시작 시각(없으면 '99:99' 로 시각 있는 것 뒤), 만든 시각, 그다음 배열 순서.
--   할 일(0.27.0 todoZoneCmp): prio = 'high' 먼저, 안 끝낸 것 먼저, 만든 시각, 그다음 배열 순서.
--   배열 순서는 부팅 조회와 같은 sort_order, uid 다(JS sort 는 안정 정렬이라 동률이면 배열 순서가 보인다).
--   시작 시각은 앱이 읽는 모양(DATE_FORMAT '%H:%i')으로 견준다. 만든 시각은 앱의 ISO 글자(고정 24자) 비교가
--   DATETIME(3) 순서와 같다.
--
-- 규칙(DB-RELEASE-OPS §5.4): 감싸개가 정한 @data_go 가 1 일 때만 바꾼다(app_latest_version 이 0.28.0 보다 낮을 때).
--   0.28.0 으로 열린 뒤 같은 파일을 다시 돌리면 아무것도 바꾸지 않는다(그 뒤 사용자가 끌어서 바꾼 순서를 지키기 위해).
--   UPDATE 는 한 표, 키 칸 조건(user_id > 0, 안전 갱신 모드 1175 방지). 창 함수 파생 표는 병합되지 않고 먼저 만들어지므로
--   같은 표를 고치는 UPDATE 안에서 읽어도 1093 이 나지 않는다(MySQL 8.4 리허설로 확인).
--
-- 순서가 실제로 바뀌는 사람은 cal_user_rev 를 1 올린다(바꾸기 전에 센다). 열려 있던 0.27.0 앱은 다음 저장이 충돌해
-- 다시 읽고, 옛 자리 번호를 몇 행에만 써 넣지 않는다. rev 올리기와 다시 매기기는 한 트랜잭션이다(rev 행 잠금이 먼저라
-- 그 사이 그 사람의 저장은 기다린다. 앱도 rev 행을 먼저 잡는다).

START TRANSACTION;

-- 1) 순서가 바뀌는 사람의 rev 를 1 올린다(행이 없으면 1 로 만든다. 앱의 저장 첫 문장과 같은 모양)
INSERT INTO cal_user_rev (user_id, rev)
SELECT d.user_id, 1
  FROM (SELECT x.user_id
          FROM (SELECT user_id, sort_order,
                       ROW_NUMBER() OVER (PARTITION BY user_id
                         ORDER BY (all_day <> 0) DESC, COALESCE(DATE_FORMAT(start_time, '%H:%i'), '99:99'), created_at, sort_order, uid) - 1 AS rn
                  FROM cal_entry) x
         WHERE x.sort_order <> x.rn
        UNION
        SELECT y.user_id
          FROM (SELECT user_id, sort_order,
                       ROW_NUMBER() OVER (PARTITION BY user_id
                         ORDER BY (prio = 'high') DESC, (done <> 0), created_at, sort_order, uid) - 1 AS rn
                  FROM cal_todo) y
         WHERE y.sort_order <> y.rn) d
 WHERE d.user_id > 0 AND @data_go = 1
ON DUPLICATE KEY UPDATE rev = rev + 1;

-- 2) 일정: 사람마다 0.27.0 화면 순서로 0 부터
UPDATE cal_entry e
   SET e.sort_order = (SELECT r.rn
                         FROM (SELECT user_id, entry_no,
                                      ROW_NUMBER() OVER (PARTITION BY user_id
                                        ORDER BY (all_day <> 0) DESC, COALESCE(DATE_FORMAT(start_time, '%H:%i'), '99:99'), created_at, sort_order, uid) - 1 AS rn
                                 FROM cal_entry) r
                        WHERE r.user_id = e.user_id AND r.entry_no = e.entry_no)
 WHERE e.user_id > 0 AND @data_go = 1;

-- 3) 할 일: 사람마다 0.27.0 화면 순서로 0 부터
UPDATE cal_todo t
   SET t.sort_order = (SELECT r.rn
                         FROM (SELECT user_id, todo_no,
                                      ROW_NUMBER() OVER (PARTITION BY user_id
                                        ORDER BY (prio = 'high') DESC, (done <> 0), created_at, sort_order, uid) - 1 AS rn
                                 FROM cal_todo) r
                        WHERE r.user_id = t.user_id AND r.todo_no = t.todo_no)
 WHERE t.user_id > 0 AND @data_go = 1;

COMMIT;
