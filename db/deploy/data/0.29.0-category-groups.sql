-- @data version=0.29.0
-- 판 데이터 단계: 내 과제(cal_category)의 sort_order 를 묶음 순서로 한 번 다시 매긴다(docs/CATEGORY-GROUPS.md §2).
--   ★ 판 번호는 배포 때 정한다. 0.29.0 은 계획 번호다. 실제 배포 판이 다르면 이 파일 이름과 첫 줄 머리를 그 판으로 바꾼다
--     (조립기는 머리 판 = 빌드 판일 때만 넣는다. 다르면 이 단계가 release SQL 에 들어가지 않는다).
--   이 판부터 앱은 과제 순서를 묶음 순서로 지킨다: 공식(DB 과제), 일반, 휴가, 기타. 묶음 안은 사용자가 정한 순서다.
--   앱도 부팅 때 같은 규칙으로 고쳐 한 번 저장하지만(catGroupNormalize), 배포 때 미리 맞춰 두면 업데이트 직후
--   다른 사람 일정 보기와 근태, 월간이 처음부터 같은 순서이고 사람마다 부팅 저장이 몰리지 않는다.
--
-- 묶음(앱의 catGroupRank 와 같은 규칙):
--   0 공식 = source = 'db'(앱 isOfficialCat 의 c.source === 'db'. 칸은 _bin 이라 글자 그대로 견준다)
--   2 휴가 = source <> 'db' 이고 TRIM(name) = '휴가'(앱 isDefaultTask 의 이름 판정, 앞뒤 공백을 뺀 이름)
--   3 기타 = source <> 'db' 이고 TRIM(name) = '기타'
--   1 일반 = 그 밖
--   이름이 휴가, 기타인 개인 과제가 둘 이상인 옛 데이터도 이름 묶음(2, 3)에 모인다. 앱도 그렇게 한다. 묶음 안은 지금 순서라
--   앞의 것(앱이 기본 과제로 쓰는 것, 배열 순서 = sort_order, uid)이 계속 앞이다.
--   묶음 안 순서는 지금 sort_order, 그다음 uid(부팅 조회 ORDER BY sort_order, uid 와 같다). 0 부터 빈틈 없이.
--
-- 규칙(DB-RELEASE-OPS §5.4): 감싸개가 정한 @data_go 가 1 일 때만 바꾼다(app_latest_version 이 이 판보다 낮을 때).
--   이 판으로 열린 뒤 다시 돌리면 아무것도 바꾸지 않는다. 같은 규칙이라 다시 돌려도 결과는 같다(이미 맞으면 0행).
--   UPDATE 는 한 표, 키 칸 조건(user_id > 0, 안전 갱신 모드 1175 방지). 창 함수 파생 표는 병합되지 않고 먼저 만들어지므로
--   같은 표를 고치는 UPDATE 안에서 읽어도 1093 이 나지 않는다(0.28.0 과 같은 꼴).
--
-- 순서가 실제로 바뀌는 사람만 cal_user_rev 를 1 올린다(바꾸기 전에 센다). 열려 있던 옛 앱은 다음 저장이 충돌해
-- 다시 읽는다. rev 올리기와 다시 매기기는 한 트랜잭션이다(rev 행 잠금이 먼저라 그 사이 그 사람의 저장은 기다린다).

START TRANSACTION;

-- 1) 순서가 바뀌는 사람의 rev 를 1 올린다(행이 없으면 1 로 만든다. 앱의 저장 첫 문장과 같은 모양)
INSERT INTO cal_user_rev (user_id, rev)
SELECT d.user_id, 1
  FROM (SELECT DISTINCT x.user_id
          FROM (SELECT user_id, sort_order,
                       ROW_NUMBER() OVER (PARTITION BY user_id
                         ORDER BY (CASE WHEN source = 'db' THEN 0
                                        WHEN TRIM(name) = '휴가' THEN 2
                                        WHEN TRIM(name) = '기타' THEN 3
                                        ELSE 1 END), sort_order, uid) - 1 AS rn
                  FROM cal_category) x
         WHERE x.sort_order <> x.rn) d
 WHERE d.user_id > 0 AND @data_go = 1
ON DUPLICATE KEY UPDATE rev = rev + 1;

-- 2) 과제: 사람마다 묶음 순서(공식, 일반, 휴가, 기타)로 0 부터. 묶음 안은 지금 sort_order, uid 순
UPDATE cal_category c
   SET c.sort_order = (SELECT r.rn
                         FROM (SELECT user_id, cat_no,
                                      ROW_NUMBER() OVER (PARTITION BY user_id
                                        ORDER BY (CASE WHEN source = 'db' THEN 0
                                                       WHEN TRIM(name) = '휴가' THEN 2
                                                       WHEN TRIM(name) = '기타' THEN 3
                                                       ELSE 1 END), sort_order, uid) - 1 AS rn
                                 FROM cal_category) r
                        WHERE r.user_id = c.user_id AND r.cat_no = c.cat_no)
 WHERE c.user_id > 0 AND @data_go = 1;

COMMIT;
