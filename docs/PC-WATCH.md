# 과제 탭 "다른 과제 보기" (보기만 과제, 구조 21)

상태: **구현 완료**(2026-11-04, b634ef7, 개발 브랜치 feat/pc-watch), 다음 판(0.26.0 예정), DB 구조 21. 기획 확정(2026-11-04 사용자), DB 전문가 검토 반영. 시안: 목록과 상세 dist/proto/pc-watch-v3.html, 고르는 창 dist/proto/pc-watch-v8.html(최종).

원칙(2026-11-04 사용자): **이미 있는 화면을 모드로 재사용한다.** 같은 기능이 화면마다 다르게 생기면 쓰는 사람이 피곤하다. 고르는 창 = 과제 추가 창(#catAddModal), 참여자 명단 = 과제 탭 참여자 창(#pcMembersModal), 참여자 고르기 = 사람 고르기 팝오버(#peerPicker).

> 2026-11-05 바뀜: "보기만 과제"는 관심 과제가 됐다(이름, 모양, 과제 탭 목록, 참여자 필터). [PC-WATCH-2.md](PC-WATCH-2.md) 참고.

## 1. 결정(2026-11-04 사용자)

- 활성 사용자 누구나 **모든 공식 과제의 과제 캘린더를 읽기 전용으로** 본다(공식 과제 목록과 참여자 명단이 이미 전 직원 공개인 것과 같은 결). 쓰기(등록, 수정, 삭제)는 지금처럼 참여자(그 공식 과제를 내 과제에 둔 사람)만.
- 개인 일정 보기(열람 창)와 엮지 않는다.
- 고르는 창은 **과제 추가 창(#catAddModal)을 "다른 과제 보기" 모드로 재사용**한다(5.2절).
- **보기만 과제에서는 개인 일정에 등록할 수 없다**(원본을 따라가지 않는 복사본, 남의 일이 내 일간보고 재료에 섞임). 필요하다는 요청이 오면 그때 미분류 복사를 더한다.
- 보는 목록은 **계정에 저장**한다(DB). 다른 PC 에서 로그인해도 이어진다.
- 보기만 과제는 내 과제(cal_category)가 아니다. 근태 보고, 취합, 개인 달력 필터, 일정 입력 창의 과제 목록에 들어가지 않는다.

## 2. DB: cal_project_watch (구조 21)

```sql
CREATE TABLE cal_project_watch (
  user_id     SMALLINT UNSIGNED NOT NULL COMMENT '보는 사람(app_user.user_id)',
  project_id  INT UNSIGNED      NOT NULL COMMENT '보는 공식 과제(project.id)',
  added_at    DATETIME(3)       NOT NULL COMMENT '넣은 시각(UTC)',
  PRIMARY KEY (user_id, project_id),
  KEY ix_cal_project_watch_project (project_id),
  CONSTRAINT fk_cal_project_watch_user    FOREIGN KEY (user_id)    REFERENCES app_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cal_project_watch_project FOREIGN KEY (project_id) REFERENCES project (id)       ON DELETE CASCADE  ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='과제 탭 보기만 목록. 내 과제(cal_category)가 아니다. 근태, 보고, 필터 과제 목록에 들어가지 않는다';
```

- PK 는 숫자 id 둘(docs/CODE-TABLE-IDS.md: 외래키로 쓰이는 기본키는 번호). 자기 번호(watch_no)는 두지 않는다: 이 표를 가리키는 표가 없고, 두면 (user_id, project_id) UNIQUE 가 따로 필요하다.
- 넣기는 **평범한 INSERT**(IGNORE 금지: FK 위반 1452 까지 경고로 삼켜 "넣었다"고 거짓 회신한다. schema-calendar.sql 323행 규칙. ON DUPLICATE KEY UPDATE 도 UPDATE 권한이 필요해 쓰지 않는다).
  ```sql
  INSERT INTO cal_project_watch (user_id, project_id, added_at)
  SELECT @me, p.id, @now FROM project p WHERE p.uid = @pu AND p.is_active = 1;
  ```
  영향 0행 = "과제가 없거나 숨겨졌습니다", 1062 = 이미 보는 중(멱등 성공), 1452 = 과제가 사라짐(MsgProjectGone).
- 빼기 `DELETE FROM cal_project_watch WHERE user_id = @me AND project_id = @pid`. 고칠 칸이 없다.
- 과제 FK CASCADE: 공식 과제 영구 삭제(휴지통)를 보는 줄이 막지 않는다.
- 사람 FK RESTRICT(기존 통일 규칙). 퇴사자 영구 삭제 때 휴지통이 이 사람의 보는 줄을 먼저 지운다(기록이 아니라 화면 설정이라 삭제를 막는 이유가 아니다). 그래서 UserRecordTables(기록 수 세기)에는 **넣지 않고**, cal_user_pref, cal_user_rev 와 같은 **부속 표**로 둔다(부속 2표 → 3표).
- 권한 SELECT, INSERT, DELETE (grants-calendar.sql 에만. 이관 조각에는 GRANT 없음).
- 상한: 한 사람 50개. 넣을 때만 센다(두 PC 동시 넣기로 51개가 되는 경합은 받아들인다. 읽을 때 자르지 않는다).
- PK 판단(검토 확인): (user_id, project_id) 숫자 복합 키가 맞다. 자기 번호(watch_no)를 두면 MAX()+1 발번 잠금과 UNIQUE 가 더 필요하고 얻는 것이 없다. 선례 cal_project_event_except, cal_user_pref.

## 3. 호스트

- **EligibleProjectsAsync, EligibleSql 은 손대지 않는다.** 쓰기 판정(BeginSharedWriteAsync → RequireProjectAsync(write: true))도 같은 함수를 쓰므로, 이것을 넓히면 참여자가 아닌 사람도 저장, 삭제할 수 있게 된다(검토 꼭 고칠 것 1).
- **읽기 전용 판정 함수를 새로 둔다**(ReadableProjectsAsync). 웹이 보낸 uid 만 해석한다(UidList 상한 200, project 표 전체를 읽지 않는다).
  ```sql
  SELECT p.id, p.uid, p.is_active,
         EXISTS(SELECT 1 FROM cal_category c WHERE c.user_id = @me AND c.source = 'db' AND c.project_uid = p.uid) AS mine
    FROM project p
   WHERE p.uid IN (@u0, @u1, ...)
  HAVING p.is_active = 1 OR mine = 1
  ```
  읽기 규칙 = 숨기지 않은 모든 공식 과제, **또는 숨겨졌어도 내 과제**(지금 동작 유지. 관리자가 숨겨도 참여자의 과제 탭 일정이 사라지지 않는다). writable = mine AND is_active.
- 읽기 판정을 쓰는 명령: LoadAsync(범위 읽기), ChangesAsync(최근 변경), MembersAsync(참여자 명단). 저장, 삭제, **개인 일정 등록(CopyAsync)** 은 지금 판정(내 과제만) 그대로. 읽기 회신의 과제마다 writable, mine 두 값을 싣는다.
- 고르는 창 목록용 읽기 명령 하나(pcWatchCatalog): 숨기지 않은 공식 과제마다 { projectUid, lastActivity(그 과제 일정의 MAX(updated_at), 없으면 null), memberIds(참여자 login_id 목록) }. 과제 일정 표의 ix_cal_project_event_updated(project_id, updated_at, event_id)로 과제별 최신 시각을 읽고, 참여자는 cal_category(source='db') 와 활성 app_user 조인(MembersAsync 와 같은 참여 규칙). 이름, 조직, 직급은 화면이 사람 고르기와 같은 명부(membersGet)로 붙인다.
- pcWatchList 는 project 를 조인해 숨김 여부를 같이 보낸다. 보던 과제가 숨겨지면 줄은 지우지 않고 화면에 "숨겨진 과제"로 흐리게, ×로 뺄 수 있다. 이미 내 과제가 된 과제는 목록에서 거른다(NOT EXISTS cal_category).
- 새 명령: pcWatchList / pcWatchAdd { projectUid } / pcWatchRemove { projectUid }. 웹과 호스트 사이는 uid, DB 는 project.id.
- 휴지통: 퇴사자 영구 삭제 트랜잭션에서 `DELETE FROM cal_project_watch WHERE user_id = @u` 를 app_user 보다 먼저(ProjectDb.cs 2752행 부근). 과제 영구 삭제 로그에 보기 줄 수도 남긴다(2725행 부근 cal_category 수와 같은 자리).

## 4. 배포(구조 20 → 21)

- 이관 조각 db/deploy/migrations/v21-project-watch.sql: CREATE TABLE IF NOT EXISTS 하나와 information_schema 검증. DELETE, UPDATE, GRANT 없음.
- 끝의 구조 번호 갱신은 `WHERE k = 'db_structure_version' AND v = '20'` 꼴(키 칸 WHERE 규칙).
- 같이 바꿀 곳(점검표):
  - schema-calendar.sql: 표 정의(정의 안 `--` 주석 없이 COMMENT 만), 머리말 829행 부근 project 를 가리키는 cal_ 표 목록, 처음 구축 DROP 목록(project_schedule_image 근처)
  - 이관 조각과 schema 글자 일치(release-sql 시험)
  - 권한: grants-calendar.sql, **server-app-account.sql, create-app-user.sql** 에 `GRANT SELECT, INSERT, DELETE ON ...cal_project_watch` (없으면 표마다 권한을 주는 환경에서 모든 사람 영구 삭제가 1142 로 실패)
  - init-calendar.ps1 표 명부와 개수 주석(19 → 20), DB-RELEASE-OPS 5절 사슬 문장
  - DbGate.AppStructureVersion 21, 데모 SQL(db/demo/build-demo-sql.mjs)
  - 시험: tests/trash-host.test.mjs 부속 표 목록(ATTACHED 3표, 계약 ①의 DELETE 권한, 계약 ⑥의 표 목록과 삭제 순서), tests/project-calendar-host.test.mjs 의 판정 계약("판정 둘, 쓰기는 Eligible 하나만", c.source='db' 개수 3 → 4)
  - ProjectDb.cs 2251행 주석 "부속 2표" → "부속 3표"

## 5. 화면

### 5.1 과제 탭
- 왼쪽 목록(pcSideHtml): "내 과제" 묶음 + "보기만" 묶음 + 맨 아래 점선 [＋ 다른 과제 보기].
  - 보기만 줄: 이름 아래 작은 줄(발주처, 상태), 참여자 n명 단추(기존), ×(마우스를 올릴 때만, 목록에서 빼기, 확인 창 없음). 숨겨진 과제는 흐리게 "숨겨진 과제".
  - "보기만" 묶음 머리에 체크 하나: 보기만 과제를 한 번에 끄고 켠다.
- 보기만 일정: 흰 바탕, 점선 테두리, 흐린 글자(과제 색 왼쪽 띠는 그대로). 공용 칸 클래스와 토큰만.
- 상세 창(pcRenderDetail): 단추는 두 값으로 정한다. 수정, 삭제 = writable. 개인 일정에 등록 = mine. 보기만 과제는 [닫기]만, 머리에 "보기만".
- 보기만 과제도 [최근 변경]과 참여자 명단을 본다.
- 일정 등록 창의 과제 고르기에는 내 과제만.

### 5.2 다른 과제 보기 창 = 과제 추가 창(#catAddModal)의 보기 모드
- 제목 "다른 과제 보기", 위 탭(공식/일반) 숨김.
- 그대로 쓰는 것: 검색 칸, 발주처, 구분 고르기, 상태 체크(처음엔 진행, 선진행), 줄 펼치기(D13, 계약명과 계약기간과 사업명, 개발 기간), 긴 이름 줄임(D14), 폭에 따른 열 줄이기(D11).
- 보기 모드에서 다른 것:
  - "일정 있는 과제만" 체크(처음 켬. 과제 캘린더에 일정이 한 건도 없으면 볼 것이 없다).
  - 정렬 [최근 활동순 | 이름순](처음 활동순). 활동순일 때는 구분 묶음을 풀고 한 줄 목록.
  - 열: 통상명칭, 발주처, 상태, 참여자, 최근 활동, 동작. 계약명, 계약기간은 펼침으로.
  - 최근 활동: 오늘, n일 전, n주 전, n달 전. 이틀 안이면 강조, 두 달 넘으면 줄을 흐리게.
  - 참여자 열은 **인원수만**("4명" 밑줄 단추). 누르면 과제 탭의 참여자 명단 창(#pcMembersModal, 조직별 묶음, 이름 찾기)을 그대로 연다(창 위에 창).
  - 찾기 칸이 참여자 이름도 찾는다. 사람으로 걸렸으면 수 옆에 "김하늘 포함"(여럿이면 "김하늘 외 1 포함").
  - [참여자] 단추 = **사람 고르기 팝오버(#peerPicker)의 여러 명 고르기 모드**: 같은 검색 칸, [사람 | 조직도] 탭(★ 즐겨찾기, 최근, 내 부서 / 조직 트리 | 목록 두 칸, 좁으면 한 칸 내려가기). 더하는 것은 줄마다 체크, 목록 머리 "이 조직 전원" 체크(일부면 반쯤), 위쪽 고른 사람 칩과 [모두 해제], [완료]. 고른 사람 중 한 명이라도 참여한 과제가 남는다. 단추 글자 "참여자 전체" / "참여자 김하늘 외 2".
  - 동작 칸: [보기] / "✓ 보는 중"(다시 누르면 뺌) / "✓ 내 과제"(흐림). 창은 닫히지 않고 아래에 "이번에 n개를 보기로 넣었습니다".
- 다른 사람 일정 보기의 사람 고르기(한 명 골라 열기) 동작은 바뀌지 않는다(시험으로 지킨다).

## 5.3 QA
- 계약(jsdom): 보기 모드 창(제목, 탭 숨김, 활동순, 일정 있는 과제만, 열, 참여자 수와 명단 창, 참여자 찾기, 여러 명 고르기, 보기/보는 중/빼기), 과제 탭 두 묶음과 묶음 끄고 켜기, 점선 일정, 상세 단추(writable, mine), 등록 창에 내 과제만, 근태/취합/필터 과제 목록에 보기만 과제 없음, 사람 고르기 한 명 모드 불변.
- 호스트(C#): 읽기 판정 분리(쓰기는 Eligible 하나만), 숨긴 과제 규칙, 넣기(0행, 1062, 1452), 빼기, 50개 상한, 목록의 내 과제 거르기, 휴지통 퇴사자 삭제 순서, catalog 회신.
- 배포: v21 조각과 schema 글자 일치, GRANT 없음, 구조 번호 WHERE, 권한 파일 셋.
- 실제 위젯: 두 계정(참여자 아닌 계정으로 보기, 쓰기 막힘), 다른 PC 흉내(같은 계정 다시 로그인 후 보기 목록 유지), 화면 점검 루프(새 화면: 보기 모드 창, 참여자 고르기 여러 명 모드).
- 위키: 과제 캘린더 쪽(다른 과제 보기), DB 문서(CALENDAR-TABLE-DESIGN 에 표 추가), DB-RELEASE-OPS 사슬.

## 6. 구현 기록(2026-11-04)

- **재사용한 것과 더한 모드**
  - 다른 과제 보기 창 = `#catAddModal` 의 보기 모드. `openCatAdd('watch')`(기존 인자 `'off'`, `'own'` 옆에 `'watch'`)가 같은 창을 열고, `CAW.on` 이 꺼져 있으면 `renderCaList` 는 지금 그대로다(시험으로 지킨다). 제목 `#caHead`, 보기 전용 칸(`.ca-wo`: [참여자], 일정 있는 과제만, 정렬)은 과제 추가 모드에서 CSS 로 숨는다.
  - 참여자 명단 = `#pcMembersModal`. `pcOpenMembers(uid, opt)` 가 과제 탭 목록에 없는 과제(이름, 인원)도 열고, 사람으로 걸렸으면 그 사람 줄을 강조(`.pcm-row.hit`)한다. 창 위에 창.
  - 참여자 고르기 = `#peerPicker`. `pkOpen('multi', 단추, { host, picked, onChange, hint })`. 더한 것은 줄마다 체크(`pkMultiOpenEl`), 조직도 목록 머리 "이 조직 전원"(`pkAllEl`, 하위 조직 포함, 일부면 반쯤), 위쪽 칩과 [모두 해제], 아래 [완료](`pkMultiSync`), 트리 노드의 점. 한 명 모드(top, modal)는 `__pk.multi` 가 null 이라 같은 코드를 지나지 않는다. 열람 창을 여는 `pkPick` 은 그대로다.
  - 과제 탭: `pcSideHtml` 이 두 묶음, `pcRowHtml`(내 과제와 보기만 줄이 한 함수), `pcRenderDetail` 은 단추를 writable 과 mine 두 값으로 정한다.
- **새로 만든 UI 와 까닭**: 새 창은 없다. 새 마크업은 보기 전용 칸 셋, 팝오버 칩 줄과 [완료] 줄(한 명 모드에서는 숨김), 왼쪽 목록의 묶음 머리와 점선 단추뿐이다. 이유는 모두 기존 컴포넌트에 해당 자리가 없었기 때문이다(일정 개수 필터, 정렬, 여러 명 고르기 결과를 보이는 칸).
- **계약과 다르게 된 것**: (1) `c.source='db'` 가 `ProjectCalendarDb.cs` 에 3곳에서 7곳이 됐다(읽기 판정, 보기만 목록 둘, 목록용 읽기). 기획의 "3 → 4" 는 읽기 판정 하나만 센 값이었다. 시험(`project-calendar-host` ⑥)을 7로 고치고 그 자리를 적었다. (2) 보기 모드의 상태 체크는 이 창 안에서만 센다(처음엔 종료만 끔). 관리 화면, 재연결과 함께 쓰는 기억(`tc_projStatusOff`)을 건드리지 않기 위해서다. (3) 보기만 목록 읽기에 실패해도 내 과제 화면은 열고 "보기만 목록을 읽지 못했습니다" 한 줄만 보인다. (4) 보기만 넣기와 빼기도 커밋은 관문 재확인(`CommitWithGateAsync`)으로 끝낸다(구조 갱신 중 쓰기가 닫힌다).
- **시험**: `tests/pc-watch.test.mjs`(호스트 정적, 배포 정적, 웹 정적, jsdom, 변이), `release-sql`(v21 조각, 검증 멈춤, 변이), `project-calendar-host`, `project-calendar-web`, `trash-host`(부속 3표) 갱신. 화면 점검 루프(`tests/loop-ui-visual.mjs`)에 `catAddModal.watch`, `catAddModal.watchWho`, `pcWatchSide` 를 더했다.
- **아직 못 본 것**: 구조 21 이관 전이라 실제 위젯(두 계정, 다른 PC 흉내, 숨겨진 과제, 화면 점검 루프)과 실제 MySQL 에서의 읽기 판정, 넣기, 빼기, 50개 상한은 확인하지 않았다.

## 7. 검토 기록

- 2026-11-04 DB 전문가 검토: 표 설계(복합 숫자 PK, 형과 부호, FK 방향, 색인)는 그대로. 꼭 고칠 것 넷(쓰기 판정이 같이 열림, 복사 실패, 휴지통 시험과 권한 파일 누락, INSERT IGNORE)을 3, 2, 4절에 반영. 복사 실패는 그 뒤 사용자 결정(보기만 과제는 개인 일정 등록 없음)으로 CopyAsync 를 고치지 않는 것으로 정리.

## 7. QA 결과 (2026-11-04 밤, 병합된 feat/db-app 기준)

- 개발 DB(이 PC) 구조 20 → 21: v21 조각을 Workbench 와 같은 안전 갱신 모드(`--safe-updates`)로 실행, 1175 없이 통과. 다시 돌리면 "이미 21 이상, 건너뛴다". 개발 PC 앱 계정(taskmgr_app)에는 표마다 권한을 주는 방식이라 `GRANT SELECT, INSERT, DELETE ON taskcalendar.cal_project_watch` 를 root 로 따로 줬다(폐쇄망 서버는 taskcalendar.* 전체 권한이라 해당 없음).
- QA 데이터: 개발 DB 에 과제 일정이 0건이라 `[QA]` 더미 과제 일정 8건(내 과제 2, 남의 과제 4, 최근 활동 시각을 다르게)을 넣었다. 지우기: `DELETE FROM cal_project_event WHERE event_id > 0 AND title LIKE '[QA]%'` (개발 DB 에서만).
- 실제 위젯 확인(phmin):
  - 다른 과제 보기 창: 제목, 위 탭 숨김, 최근 활동순, 일정 있는 과제만(종료 과제는 처음 꺼짐이라 안 보임, 상태 체크로 켬), [보기] → "✓ 보는 중", "이번에 2개를 보기로 넣었습니다".
  - 참여자 여러 명 고르기(사람 고르기 팝오버): 즐겨찾기, 최근, 내 부서, 조직도 탭, 체크 → "참여자 윤인환", 과제가 그 사람 참여 과제로 줄고 "윤인환 포함".
  - 참여자 수 → 참여자 명단 창(조직별 묶음)이 창 위에 뜸.
  - 왼쪽 목록: 내 과제 4 + 보기만 2(발주처, 상태, ×), 점선 일정 3건.
  - 상세: 보기만 과제는 [닫기]만, 내 과제는 [삭제] [개인 일정에 등록] [수정].
  - 쓰기 막힘: 보기만 과제에 저장 요청과 개인 일정 등록 요청을 호스트에 직접 보내도 "내 과제에 없는 과제입니다"(forbidden).
  - 일정 등록 창의 과제 고르기와 근태용 과제 목록(state.categories)에 보기만 과제 없음.
  - 위젯을 껐다 켜도 보기 목록 유지(DB cal_project_watch 2행).
- 화면 점검 루프에서 잡아 고친 것: 사람 고르기 작은 단추(좁은 폭 32px), 여러 명 팝오버가 과제 추가 창 밖으로 나감(창 안으로 당김), 과제 추가 창 높이 320px 머리 칸 이탈(미뤄 둔 catAddModal 320 결함, 본문 함께 스크롤), 과제 탭 둘째 줄이 900px 에서 7px 모자라 꺾임(1100 이하에서 확인 시각을 새로고침 title 로). 과제 일정 칩 V7 은 개인 칩과 같은 근거로 루프 예외, V8 은 검출기 바탕 판정 오류(칸 바탕으로 읽게 고침).
- 루프 전체(run-loops, 31개): 30 통과 + loop-category-order 1 실패(루프가 지운 함수 rptSources 를 부름, 앱 결함 아님) → 루프 고쳐 52 통과. 화면 점검 전체 위반 0.
- strict 전체: 3373 pass / 0 fail / 0 skip.
- 확인 못 한 것: 실제 다른 사람 계정으로 로그인한 확인(비밀번호가 필요해 하지 않음. 대신 phmin 이 참여하지 않은 과제로 같은 경로를 봤다), 폐쇄망 서버의 v21 실행(배포 때 사용자), 50개 상한의 실제 도달.
