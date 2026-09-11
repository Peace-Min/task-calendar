# 휴지통 · 영구 삭제 — 확정 설계 (TRASH-DELETE)

> 작성 2026-09-10 · 대상 판번호 **12 → 12**(스키마 변경 없음 — GRANT 만 바뀐다) · 위젯 **v0.19.0**(기능 추가 = 마이너, 판번호 12 와 같은 창)
> 짝 문서: [USER-ADMIN.md](USER-ADMIN.md)(관리자 편집·관문) · [USER-LOGIN.md](USER-LOGIN.md)(쓰기 관문) · [../db/CALENDAR-TABLE-DESIGN.md](../db/CALENDAR-TABLE-DESIGN.md)(표 설계 정본)
> 이 문서는 **구현 전 설계**다. 구현하며 달라지는 곳은 [§11 정정 이력](#11-정정-이력)에 적는다. **본문과 §11 이 다르면 §11 이 맞다.**

---

## 1. 확정 요구 (검토자 지적 + 사용자 결정 — 이것이 판정 기준)

- 검토자: "과제는 지금 **숨기기만** 되어 있지 실질적으로 DB 에서 데이터 삭제 기능이 별도로 없다. 숨겨진 과제들만 **별도 목록화**하고 거기서 **실제 DB 에서 데이터 삭제**하는 메커니즘이 필요하다."
- 사용자: "이건 과제랑 인력이랑 **포괄적인** 건데."
- 사용자 결정(2026-09-10): "**기록 0건만 삭제**, **다섯 표 한 번에**, 설계 문서부터."

요구를 한 줄로: **숨긴(퇴사·숨김) 항목만 모아 보여 주는 관리자 전용 「휴지통」에서, 복구하거나 DB 행을 실제로 지운다. 인력은 기록이 한 건도 없는 계정만 지운다. 다섯 표(과제·인력·발주처·구분·상태)를 같은 틀로 한 번에 한다.**

### 1.1 지적이 맞는 이유 — 지금 상태 (2026-09-10 실측)

| 표 | 숨김 | 숨긴 항목 보기 | 복구 | 삭제 | 앱 계정 권한 |
|---|---|---|---|---|---|
| `project` | 있음(`setProjectActive`) | **없음** — 호스트가 `is_active=1` 만 읽는다 | **없음** | 없음 | SELECT·INSERT·UPDATE |
| `app_user` | 있음(퇴사 처리) | 있음(「퇴사자 보기」) | 있음 | 없음 — 시험 계약 ⑤가 DELETE 부재를 잠가 둠 | SELECT·INSERT·UPDATE |
| `customer` | 있음 | 있음(관리 화면에 흐리게) | 있음 | 없음 | SELECT·INSERT·UPDATE |
| `section_code` · `status_code` | 있음 | 있음 | 있음 | 없음 | SELECT·INSERT·UPDATE |

과제는 지적보다 한 단계 더 비어 있다 — **숨기면 앱에서 다시는 볼 수 없다.** 실수로 숨긴 과제, 오타로 두 번 등록한 과제가 DB 를 직접 만지지 않으면 영원히 남는다. "앱에서만 관리한다"(USER-ADMIN §1)는 요구가 여기서 깨진다.

---

## 2. 결정 요약

| 항목 | 결정 | 근거 |
|---|---|---|
| 화면 | 관리자 전용 **「휴지통」** 한 화면(`#trashModal`), 탭 다섯(과제·인력·발주처·구분·상태). 각 탭은 **숨긴 항목만** 나열하고 행마다 [복구] [영구 삭제] | 검토자가 요구한 "별도 목록화". 다섯 표가 같은 틀이라 한 화면이 싸다(사용자 결정) |
| 진입 | 「사용자 정보」의 버튼 `#usTrash` — `edit_role='admin'` 회신일 때만 DOM 에 만든다(`#usUserAdmin` 과 같은 규칙: 숨김이 아니라 부재) | USER-ADMIN §5.0·§8-7(c) 를 그대로 잇는다. 새 규칙을 만들지 않는다 |
| 삭제 주체 | `admin` 만. 발주처·코드의 **숨김**은 지금처럼 `editor` 도 되지만 **삭제**는 `OpenAdminAsync` 를 지난다 | 되돌릴 수 없는 조작은 가장 좁은 권한으로. 과제 편집이 `editor` 인 것과 별개다 |
| 삭제 전제 | **숨긴 항목만** 지울 수 있다(`is_active=0`). 활성 항목은 호스트가 거부한다 | 두 단계(숨김 → 삭제)가 실수 방지의 전부다. 한 번에 지우는 길을 두지 않는다 |
| 과제 삭제 조건 | 참조가 있어도 지울 수 있다 — 대신 확인창에 **몇 명이 편입 중인지** 보여 준다 | `project` 를 가리키는 FK 가 없다. 개인 카테고리의 `project_uid` 는 문자열 참조고, 과제가 없어지면 조회 시 **`db_gone`** 으로 파생돼 라벨·일정·보고가 그대로 남는다(§3.1). 데이터 모델이 이미 "과제가 사라진 세계"를 견딘다 |
| 인력 삭제 조건 | **기록 0건**인 계정만(§3.2 의 9개 표 합계 0). 기록이 있으면 거부하고 퇴사 상태로 둔다 | 사용자 결정. 11개 표가 `app_user` 를 FK 로 붙들고 있어 기록이 있으면 DB 도 거부한다(1451). 기록까지 지우는 연쇄 삭제는 보고 이력·감사 기록을 통째로 없애므로 하지 않는다 |
| 코드 3종 삭제 조건 | 그 값을 쓰는 과제가 **숨긴 과제까지 포함해** 0건일 때만 | `project.customer / section / status` 가 FK(RESTRICT). 앱이 미리 세어 안내하고, 최종 보증은 FK |
| 확인 | 확인창 한 번 + **이름을 그대로 입력**해야 [영구 삭제]가 켜진다. 호스트도 입력값을 대조한다 | 되돌릴 수 없는 조작의 관례(GitHub 저장소 삭제와 같다). 폐쇄망이라 되돌리기는 백업뿐이다(§7) |
| 기록 | 삭제 직전 행 전체를 JSON 한 줄로 위젯 로그에 남긴다 | 표를 새로 두지 않는다 — 감사 표가 있어도 폐쇄망에서 되살릴 수단은 백업뿐이라 로그로 충분하다 |
| 권한 | 앱 계정에 다섯 표 **DELETE** 를 준다(세 파일, §3.3) | 관문이 호스트에 있으므로 DB 권한은 '가능하게'만 한다 |
| 판번호 | **12 그대로** | 컬럼·제약이 바뀌지 않는다. GRANT 는 `schema_version` 의 대상이 아니다(`loop-schema-gate` 가 보는 것은 표 구조다) |

---

## 3. 데이터

### 3.1 참조 지도 — 무엇이 무엇을 붙들고 있나 (정본 `db/deploy/schema-calendar.sql`·`db/schema.sql` 2026-09-10)

| 지울 표 | 붙드는 쪽 | 종류 | 지웠을 때 |
|---|---|---|---|
| `project` | `cal_category.project_uid` | **문자열 참조, FK 없음**(설계 §5.2) | 조회 시 `LEFT JOIN project` 가 `db_gone` 을 파생. 카테고리·일정·할일·공수·보고 기록은 **전부 남는다.** 화면은 `dbGone` 카테고리를 새 선택 대상에서만 빼고 라벨은 유지한다(`isPickableCat`) |
| `app_user` | `cal_category` `cal_entry` `cal_todo` `cal_room` `cal_task_hours` `cal_attendance` `cal_report_daily` `cal_report_weekly` `cal_migration_log` (기록 9) + `cal_user_pref` `cal_user_rev` (부속 2) | FK 11개, 전부 RESTRICT(기본 또는 명시) | 하나라도 남아 있으면 DB 가 거부(1451). 부속 2는 로그인만 해도 생기므로 **같은 트랜잭션에서 먼저 지운다** |
| `customer` | `project.customer` (`fk_project_customer`) | FK RESTRICT | 숨긴 과제가 쓰고 있어도 거부 |
| `section_code` | `project.section` (`fk_project_section`) | FK RESTRICT | 위와 같다 |
| `status_code` | `project.status` (`fk_project_status`) | FK RESTRICT | 위와 같다 |

`cal_entry_except`·`cal_entry_commit`·`cal_todo_day_note`·`cal_report_hours` 는 사용자를 직접 붙들지 않고 부모 행(`cal_entry`·`cal_todo`·`cal_report_daily`)에 딸린다 — 부모가 0 이면 이들도 0 이다.

### 3.2 "기록 0건" 의 정의 (인력)

아래 9개 표의 `user_id = @uid` 행 수 합계가 **0**. 목록은 정본의 `REFERENCES app_user` 에서 `cal_user_pref`·`cal_user_rev` 를 뺀 것과 **글자까지 같아야** 한다(시험 계약 ③ 이 정본을 파싱해 대조한다 — 숫자·표 이름 박제 금지).

```
cal_category · cal_entry · cal_todo · cal_room · cal_task_hours · cal_attendance ·
cal_report_daily · cal_report_weekly · cal_migration_log
```

- `cal_migration_log` 를 기록에 넣는 이유: XML 이관을 한 번이라도 한 계정은 일정이 있었던 계정이다(감사 흔적). 지우지 않는다.
- `cal_user_pref`·`cal_user_rev` 를 뺀 이유: 로그인 한 번이면 생기는 부속 행이라 "기록"이 아니다. 삭제 트랜잭션이 이 둘을 먼저 지우고 `app_user` 를 지운다.
- 이 정의로 실제 지워지는 계정은 **오등록(ID 오타·중복)·한 번도 안 쓴 계정** 뿐이다. 퇴사자는 거의 전부 기록이 있으므로 퇴사 상태로 남는다 — 그것이 사용자 결정의 뜻이다.

### 3.3 권한 — 세 파일에 DELETE 를 더한다 (스키마 변경 아님)

| 파일 | 지금 | 뒤 |
|---|---|---|
| `db/deploy/create-app-user.sql` | `GRANT SELECT, INSERT, UPDATE ON taskmgr.project` (+customer·section_code·status_code) | `SELECT, INSERT, UPDATE, DELETE` 넷 |
| `db/deploy/grants-calendar.sql` | `GRANT SELECT, INSERT, UPDATE ON taskmgr.cal_user_pref` · `… cal_user_rev` + 머리말 "app_user 의 DELETE 는 어디에도 없다" | **부속 2표(`cal_user_pref`·`cal_user_rev`)에 DELETE 를 더한다** — 계정 삭제 트랜잭션이 이 둘을 먼저 지운다(§3.4). 빠지면 첫 문장에서 ERROR 1142(§11-2). `app_user`·`project` 의 부여는 그대로(이 파일은 캘린더 표 담당) 두고 머리말 문장을 "**DELETE 는 휴지통 관문(`ProjectDb.DeleteTrashAsync`) 한 곳뿐이다**" 로 고친다 |
| `taskmgr-company-data/05-grants.sql` (비공개) | `GRANT SELECT, INSERT, UPDATE ON app_user` | `SELECT, INSERT, UPDATE, DELETE` |

- 재적용은 GRANT 문 재실행(멱등). `DEPLOY.md §0` 에 "휴지통 배포 전 GRANT 재적용" 한 줄과 검증 SQL(`SHOW GRANTS FOR 'taskmgr_app'@'%'` 에 다섯 표 DELETE 가 보여야 한다)을 넣는다.
- 이관 경로·신규 구축 경로 동치(덤프 diff = 0)는 표 구조 이야기라 영향 없다. GRANT 정합은 시험 계약 ① 이 세 파일을 직접 읽어 대조한다.

### 3.4 삭제 트랜잭션 (호스트 — 표별로 한 문장씩, 전부 같은 뼈대)

```
BEGIN
  SELECT … FROM <표> WHERE <키>=@k FOR UPDATE          -- 없으면 "이미 삭제됐거나 없는 항목"
  is_active = 0 인지                                   -- 아니면 "숨긴(퇴사) 항목만 지울 수 있습니다"
  참조 수 재계산(§3.1 의 쿼리)                          -- 인력·코드: 0 아니면 거부. 과제: 수만 로그에 남긴다
  이름 대조(@confirm = 저장된 이름, 대소문자·앞뒤 공백 그대로)  -- 다르면 "입력한 이름이 다릅니다"
  (인력) DELETE cal_user_pref · cal_user_rev
  DELETE <표>                                          -- 1451 이 나면 롤백하고 "다른 기록이 붙어 있어 지울 수 없습니다"
  로그: 삭제 직전 행 JSON 한 줄
COMMIT
```

- 인력 삭제에 **자기 자신 금지**를 그대로 건다(퇴사 규칙 §4.4-1 과 같다). 기록 0 이면 로그인한 적도 없어 실제로는 걸릴 일이 없지만, 규칙은 두 벌이 아니라 한 벌이어야 한다.
- 마지막 관리자 규칙은 필요 없다 — 삭제 대상은 `is_active=0` 이라 "활성 관리자" 수에 이미 들어 있지 않다(퇴사 시점에 §4.4-3 이 걸렀다).

---

## 4. 호스트 (`widget/ProjectDb.cs` · `widget/MainWindow.xaml.cs`)

### 4.1 관문

다섯 표 삭제·휴지통 조회·복구 전부 **`OpenAdminAsync`**(USER-ADMIN §4.1). 발주처·코드의 기존 숨김/복구(`setCustomerActive`·`codeSetActive`, `OpenWriteAsync`)는 손대지 않는다 — 휴지통의 [복구] 는 **같은 호스트 함수**를 부르되 휴지통 경로는 관리자만 닿는다(진입 버튼이 관리자에게만 있다).

### 4.2 메시지 계약 (호스트 ↔ 웹) — 사용자 관리와 같은 모양

| 메시지 | 방향 | 내용 |
|---|---|---|
| `trashGet` | 웹 → 호스트 | 인자 없음(`reqId` 왕복). **회신은 `{ ok, data, msg }` 로 감싼다**(`membersGet` 과 같은 요청/회신 배관) — 페이로드는 `data` 안이다. 호스트 **푸시**는 감싸지 않은 채 `__applyTrash(json)` 로 온다. 화면은 `r.data || r` 로 읽어 두 길을 한 함수로 그린다. 페이로드: `{ found, admin, projects[], users[], customers[], sections[], statuses[] }`. 관리자가 아니면 `{ found:true, admin:false }` 만(목록 없음). 각 항목: `key`(과제 `uid` · 인력 `userId` · 나머지 `name`) · `name` · `sub`(부제: 발주처·구분 / 소속·직급·ID / 없음) · `refs`(참조 수, §3.1) · `deletable`(bool) · `why`(불가 사유 문장, 없으면 '') |
| `trashRestore` | 웹 → 호스트 | `{ kind, key }`. `kind ∈ project / user / customer / section / status`. **`RestoreTrashAsync` 가 `OpenAdminAsync` 로 열고 `UPDATE … SET is_active=1` 을 직접 한다** — 기존 `Set*ActiveAsync` 를 재사용하지 않는다(그 길은 `OpenWriteAsync` 라 editor 가 통과해 "휴지통 세 함수는 관리자만" 계약이 깨진다). 구분·상태는 복구 시 `sort_order = MAX+10` 을 다시 매기고, **인력은 `sort_order = NULL` 로 비운다**(둘 다 활성 순번 충돌 방지 · §11-27). 회신 `__trashDone(ok, msg)` |
| `trashDelete` | 웹 → 호스트 | `{ kind, key, confirm }`. `confirm` = 사용자가 입력한 이름. 회신 `__trashDone(ok, msg)` |

- 성공하면 호스트가 곧바로 `trashGet` 을 다시 돌려 휴지통을 다시 칠하고, **관련 목록도 다시 민다**: 과제·코드·발주처면 `LoadProjectsToWebAsync`(카탈로그 + 개인 카테고리의 `dbGone` 재판정), 인력이면 `LoadMembersToWebAsync`. 웹은 회신을 기다리지 않고 푸시로 그린다.
- `deletable`·`why` 는 **화면용 힌트**다. 최종 판정은 `trashDelete` 시점에 호스트가 같은 트랜잭션 안에서 다시 한다(§3.4). 힌트와 판정이 갈리면 판정이 이긴다.
- ★ 위 표의 `trashGet` 회신 모양과 `trashRestore` 구현은 **설계와 다르게 간 곳**이다. 왜 그렇게 됐는지는 [§11-4](#11-정정-이력)(회신을 감싼 이유)와 [§11-1](#11-정정-이력)(복구를 재사용하지 않은 이유)에 남아 있다 — 표는 **지금의 사실**을 적고, 이력은 그 자리에 그대로 둔다.

### 4.3 거부 문구 (호스트가 사용자 문장으로)

| 상황 | 문구 |
|---|---|
| 활성 항목 | "숨긴(퇴사) 항목만 지울 수 있습니다. 먼저 숨기세요." |
| 인력에 기록 | "기록 {n}건이 있어 지울 수 없습니다. 퇴사 상태로 유지됩니다." |
| 코드가 사용 중 | "이 값을 쓰는 과제가 {n}건(숨긴 과제 포함) 있어 지울 수 없습니다." |
| 이름 불일치 | "입력한 이름이 다릅니다." |
| 자기 계정 | "자기 계정은 지울 수 없습니다." |
| 이미 없음 | "이미 삭제됐거나 없는 항목입니다 — 목록을 새로고침합니다." |
| **이미 복구됨**(복구, 2026-09-10) | "이미 복구된 항목입니다 — 목록을 새로고침합니다." (§11-15 — 실패가 아니라 목록이 낡은 것이다) |
| FK 1451 | "다른 기록이 붙어 있어 지울 수 없습니다." (힌트가 틀렸을 때의 최후 방어 — 로그에 FK 이름을 남긴다) |
| **잠금 경합 1205·1213**(2026-09-10) | "다른 관리자가 같은 항목을 편집 중입니다 — 잠시 후 다시 시도하세요." (§11-16) |
| **그 밖의 실패**(2026-09-10) | 조회 "휴지통을 불러오지 못했습니다." · 복구 "복구하지 못했습니다." · 삭제 "지우지 못했습니다." — **예외 원문을 문장에 잇지 않는다.** SQL·컬럼·스택은 위젯 로그에만 남긴다(§11-16) |
| 권한 | `NotAuthorizedException` 문장 그대로(USER-LOGIN §3.3). **비관리자만** 문장 없이 `{admin:false}` 고, 미로그인·미등록·비활성은 그 문장을 `msg` 로 함께 싣는다(§11-17) |
| 알 수 없는 대상(`kind` 가 다섯 중 하나가 아님) | "알 수 없는 대상입니다." (`TrashKindMsg`) |
| 대상 미지정(`key` 가 비었거나 인력의 `userId` 가 정수가 아님) | "대상이 지정되지 않았습니다." (`TrashNoTarget`) |
| **성공**(거부가 아니다 — 완료 문장) | "영구 삭제했습니다." (`TrashDoneMsg`) |

> **"…목록을 새로고침합니다"는 약속이다(2026-09-11 · §11-23).** 그 두 문장(`TrashGoneMsg`·`TrashAlreadyActiveMsg`)은 정확히 **실패**할 때 나오므로, 호스트는 복구·삭제의 결과와 **무관하게** 휴지통 목록을 다시 민다(`LoadTrashToWebAsync`). 관련 목록(과제·명부·발주처·구분·상태)은 그대로 성공에만 민다 — 실패했으면 그쪽은 바뀌지 않았다.

> 이 표의 문장은 `ProjectDb.cs` 의 상수 한 벌(`Trash*Msg`)이 정본이다 — 같은 말을 두 곳에 적으면 한쪽만 고쳐진다. 시험도 그 상수를 계약으로 붙잡는다(§8).

### 4.4 로그 한 줄

`_log("영구 삭제 " + kind + " " + key + " by " + loginId + " " + JSON(행))`. 행 JSON 은 삭제 직전 `SELECT *` 결과 그대로(컬럼명 = DB 컬럼명). 인력이면 `sort_order` 까지 들어간다. 위젯 로그 파일 위치는 `DEPLOY.md` 의 로그 절과 같다.

---

## 5. 화면 (`task-calendar-prototype.html`)

### 5.0 진입 — 「사용자 정보」의 세 번째 버튼

`#usMemberBtns` 에 `#usTrash`「휴지통」. `usAdminBtnSync(editRole)` 가 `#usUserAdmin` 을 만들 때 **같은 자리에서 함께** 만들고 함께 없앤다(한 함수, 한 판정 문자열). 마크업에는 없다.

### 5.1 휴지통 `#trashModal` — 관리자 전용, 순수 관리 화면

- 머리: 「휴지통」. 부제 `#trScope`: "숨긴 항목 {n}건 · 되돌릴 수 없는 삭제는 이름을 입력해야 합니다".
- 탭 다섯(`#trTabs`, 세그먼트 버튼): 과제 · 인력 · 발주처 · 구분 · 상태. 탭마다 건수 배지. 마크업의 탭 컨테이너와 목록 `#trList` 는 **빈 자리**고, `admin:true` 회신이 와야 채운다(USER-ADMIN §8-7(b) 와 같은 '부재' 계약). `admin:false` 면 "관리자만 사용할 수 있습니다." 한 줄.
- 행(`.mba-line` 재사용 — 「구성원 편집」과 같은 골격): 이름(굵게) · 부제 · 참조 요약(`refs`가 0 이 아니면 "편입 {n}명" / "과제 {n}건" / "기록 {n}건"). 오른쪽 `[복구]` `[영구 삭제]`(danger). `deletable:false` 면 [영구 삭제] 를 `disabled` 하고 `title` 에 `why`. 행은 눌리지 않는다.
- 검색칸 없음(숨긴 항목은 적다). 빈 탭: "숨긴 {탭이름}이(가) 없습니다."
- 하단: `[닫기]` 만. 휴지통에 '주 동작'은 없다 — 등록 버튼 같은 primary 를 두지 않는다.

### 5.2 확인창 — 이름 입력형 `confirmTyped`

기존 `confirmBox(title, msg, okLabel, altLabel, tone)` 옆에 **입력칸이 하나 더 있는** 변형을 둔다. 입력값이 대상 이름과 글자까지 같아야 [영구 삭제] 가 켜진다. 문구:

| 종류 | 본문 |
|---|---|
| 과제 | "'{이름}' 과제를 DB 에서 **영구 삭제**합니다. 편입 중인 {n}명의 화면에는 '삭제된 과제'로 남고 일정·보고 기록은 지워지지 않습니다. 되돌릴 수 없습니다(백업으로만 복구). 과제명을 그대로 입력하세요." |
| 인력 | "'{이름}' 계정을 DB 에서 **영구 삭제**합니다. 기록이 없는 계정입니다. 되돌릴 수 없습니다. 이름을 그대로 입력하세요." |
| 발주처·구분·상태 | "'{이름}' 을(를) DB 에서 **영구 삭제**합니다. 쓰는 과제가 없습니다. 되돌릴 수 없습니다. 이름을 그대로 입력하세요." |

`confirm` 값은 입력칸의 값을 **가공 없이** 보낸다(TRIM 도 호스트가 하지 않는다 — 이름에 공백이 있으면 공백까지 같아야 한다).

### 5.3 삭제·복구 뒤

- 과제: 호스트 푸시 `__applyProjects` 가 오면 기존 `dbGone` 재판정 로직이 개인 카테고리를 "삭제된 과제"로 바꾼다 — **새 코드 없음.** 복구하면 다시 살아난다.
- 인력: `__applyMembers` 푸시(구성원 편집 화면이 열려 있으면 그것도 갱신).
- 발주처·코드: 카탈로그 드롭다운 소스가 다시 온다(`LoadProjectsToWebAsync` 가 셋을 함께 싣는다 — 실제 페이로드 구성은 구현 때 확인, §11 에 적는다).
- 휴지통은 `__applyTrash` 로 다시 칠한다. 탭 위치는 유지.

### 5.4 과제 숨김 뒤 갈 곳

지금은 숨기면 사라진다. 카탈로그의 숨김 확인창 문구 끝에 "숨긴 과제는 **휴지통**에서 복구하거나 삭제할 수 있습니다." 한 문장을 더한다. 카탈로그 자체에 숨긴 과제를 섞어 보여 주지 않는다 — 그 목록은 휴지통이다(한 곳).

---

## 6. 하지 않는 것

- **연쇄 삭제.** 기록이 있는 인력을 기록째 지우지 않는다. 과제도 개인 카테고리·일정을 따라 지우지 않는다.
- **활성 항목 직접 삭제.** 숨김 → 휴지통 → 삭제 두 단계가 실수 방지의 전부다.
- **보존 기간·자동 비우기.** 휴지통은 시간이 지나도 스스로 지우지 않는다.
- **되돌리기(undo).** 삭제 뒤 복구 수단은 DB 백업뿐이다. 확인창에 그 사실을 적는다.
- **감사 표 신설.** 위젯 로그 한 줄로 갈음(§4.4).
- **비관리자 열람.** 휴지통은 보기 화면이 아니다.
- **일괄 삭제·전체 비우기.** 한 번에 하나. 이름을 입력하는 확인이 일괄과 양립하지 않는다.

---

## 7. 정직한 한계

- **되돌리기는 백업뿐이다.** 폐쇄망 서버의 백업 주기는 `DEPLOY.md` 의 몫이고 이 앱이 정하지 않는다.
- **과제를 지우면 개인 카테고리의 라벨은 각자 정리해야 한다.** `dbGone` 카테고리는 새 선택에서만 빠지고 목록에는 남는다(설계된 동작 — 일정의 태그를 지키기 위해). 사람마다 "삭제된 과제" 카테고리를 언제 정리할지는 그 사람의 일이다.
- **기록 0 정의 때문에 실제로 지워지는 인력은 오등록 계정뿐이다.** 검토자가 "퇴사자를 DB 에서 지우고 싶다"는 뜻이었다면 이 설계는 그것을 **일부러** 하지 않는다 — 보고 이력이 그 사람 이름으로 남아야 하기 때문이다. 이 문장을 검토자 답변에 그대로 쓴다.
- **참조 수 힌트는 조회 시점 값이다.** 두 관리자가 동시에 만지면 힌트가 낡을 수 있다. 최종 판정은 트랜잭션 안(§3.4)이라 결과는 안전하다.

---

## 8. 시험 계약 (구현과 함께 — 각 계약에 변이 시험을 짝으로)

1. **권한 세 파일 정합** — `create-app-user.sql` 다섯 표 DELETE · `05-grants.sql` app_user DELETE · `grants-calendar.sql` 머리말 문장. USER-ADMIN 계약 ⑤("DELETE 없음")를 **"DELETE 는 `DeleteTrashAsync` 한 곳뿐"** 으로 개정 — `DELETE FROM app_user` 가 그 함수 밖에 나타나면 실패. 변이: 다른 함수에 DELETE 한 줄 → 실패.
2. **관문** — `trashGet`·`trashRestore`·`trashDelete` 가 여는 연결은 전부 `OpenAdminAsync`. `OpenWriteAsync` 로 열고 다섯 표를 DELETE 하는 경로 0. `tests/admin-auth.test.mjs` 확장.
3. **기록 0 목록 = 정본** — 호스트의 9개 표 목록이 `schema-calendar.sql` 의 `REFERENCES app_user` 집합에서 `cal_user_pref`·`cal_user_rev` 를 뺀 것과 글자까지 같다(`tests/canon-schema.mjs` 로 파싱, 박제 금지). 변이: 표 하나 빼기 → 실패.
4. **활성 항목 거부** — `is_active=1` 이면 DELETE 문에 닿지 않는다(순수 로직 + 실 DB 루프).
5. **이름 대조는 호스트도 한다** — `confirm` 이 다르면 DELETE 에 닿지 않는다. 변이: 대조 지우기 → 실패.
6. **화면 부재 계약** — `#usTrash` 는 `admin` 회신에만 DOM 에 있고 내려가면 사라진다(`usAdminBtnSync` 한 함수). `#trashModal` 마크업에 탭 버튼·[영구 삭제] 문자열이 없다. jsdom 으로 그려서 센다(USER-ADMIN ⑦-DOM 과 같은 하네스).
7. **확인창 입력형** — `confirmTyped` 는 입력이 이름과 같을 때만 ok 버튼이 켜진다. `TRIM` 하지 않는다.
8. **루프 `tests/loop-trash.mjs`** — 실 위젯(CDP 9222, admin 로그인) + 실 DB. 시험 데이터는 접두 규약(`zzP`·`zzU`·`zzC`·`zzT`), 정리 세 겹(sweep·finally·exit). 한 라운드:
   - 과제 `zzP` 등록 → 숨김 → 휴지통에 보임 → 복구 → 카탈로그 복귀 → 숨김 → **이름 오타로 삭제 거부** → 이름 일치로 삭제 → DB 0행 · 카탈로그 0 · 그 과제를 편입한 개인 카테고리가 `dbGone` 으로 표시됨(편입은 시험이 미리 만든다).
   - 인력 `zzU` 등록 → 퇴사 → 휴지통 → 삭제 ok(기록 0) → DB 0행. 두 번째 `zzU` 에 일정 1건을 넣고 → 퇴사 → 휴지통에 `deletable:false`·`why` → 삭제 시도 → 거부 문구 그대로 → 행 유지.
   - 발주처·구분·상태 `zzC`/`zzT` 등록 → 숨김 → 휴지통 → **숨긴 과제가 쓰는 값은 거부** → 미사용 값은 삭제 ok.
   - 활성 항목에 `trashDelete` 를 직접 보내면 거부(호스트 계약, 화면 우회).
   - 비관리자(로그인 계정을 잠시 `editor` 로 내렸다 **반드시 복원**): 진입 버튼 부재 · `trashGet` 이 `admin:false` · `trashDelete` 거부.
   - 케이스마다 불변식: 실직원·실과제 행 수 불변 · `schema_version` 불변 · zz 잔재 0.
   - 배포 게이트 규약: **무작위 시드 5회 연속 통과, 실패 시 1부터.**
9. **판번호 게이트** — 손댈 것 없음(구조 불변). `loop-schema-gate` 그대로.

---

## 9. 문서·배포에 같이 갈 것

- `USER-ADMIN.md` §2 표 '삭제' 행·§3.3·§8-5 를 "휴지통 관문을 지난 영구 삭제만" 으로 개정하고 §11 에 정정 항목을 남긴다.
- `db/CALENDAR-TABLE-DESIGN.md` §5.2(project_uid 문자열 참조)에 "과제 영구 삭제 시 `db_gone` 으로 파생" 한 줄.
- 권한 세 파일(§3.3) + `DEPLOY.md §0` GRANT 재적용·검증 SQL.
- `RELEASE_NOTES.md`·`CHANGELOG.md`·`#patchModal` v0.19.0 항목("휴지통 — 숨긴 과제·퇴사자·발주처·코드 복구/영구 삭제(관리자)").
- `tests/README.md` 에 `loop-trash.mjs` 절.
- 검토자 보고용 `docs/DB-SCHEMA.html` 은 구조 불변이라 재생성 불필요(권한 절이 있다면 그 문장만).

---

## 10. 구현 순서 (오퍼스 브리프의 뼈대)

1. 권한 세 파일 + 시험 계약 ①(파일 대조) — 먼저 잠근다.
2. 호스트: `LoadTrashJsonAsync`(§4.2 회신) · `DeleteTrashAsync(kind, key, confirm, loginId)`(§3.4) · 브리지 case 셋 · 성공 뒤 푸시. 계약 ②③④⑤ + 변이.
3. 화면: `#usTrash` 생성/제거(`usAdminBtnSync` 확장) · `#trashModal` 탭·목록 · `confirmTyped` · 숨김 확인창 문구 한 줄. 계약 ⑥⑦ + jsdom.
4. `loop-trash.mjs` + 5회 연속.
5. 문서(§9) · 엄격 게이트 · 줄끝 확인 · 커밋.

---

## 11. 정정 이력

구현 2026-09-10. 설계와 다르게 처리한 곳.

**1. 복구는 기존 `Set*ActiveAsync` 를 재사용하지 않고 `RestoreTrashAsync` 가 `UPDATE … SET is_active=1` 을 직접 한다.** §4.1 은 재사용을 적었지만, 그러면 복구 경로가 `OpenWriteAsync`(editor 통과)를 지나 "휴지통 세 함수는 `OpenAdminAsync` 뿐"(계약 ②)이 깨진다. 구분·상태 코드의 복구는 `SetCodeActiveAsync` 와 같은 이유로 `sort_order = MAX+10` 을 다시 매긴다(옛 순번이 활성 목록 사이에 끼어드는 충돌 방지). 기존 숨김/복구 경로는 손대지 않았다.

**2. 권한은 다섯 표가 아니라 일곱 표다 — `cal_user_pref`·`cal_user_rev` DELETE 가 빠져 있었다.** §3.3 표가 "grants-calendar.sql 부여는 그대로" 라고 적었는데, §3.4 의 계정 삭제 트랜잭션은 그 두 표를 먼저 지운다. 개발 DB 에 옛 권한이 그대로 있어 `loop-trash` C02/C08 이 첫 실행에서 `DELETE command denied … cal_user_pref` 로 잡았다(설계 문서의 두 절이 서로 어긋난 것을 루프가 잡은 사례). `grants-calendar.sql` 두 GRANT 에 DELETE 를 더하고 그 표의 "DELETE 금지" 주석에 예외를 적었으며, 계약 ① 이 그 두 줄도 대조한다(변이 ①-c). `DEPLOY.md §0-5` 는 "일곱 표". 개발 DB 에는 2026-09-10 에 적용했다(적용 전 `SHOW GRANTS` 스냅샷 보관).

**3. 쓰기 성공 뒤 푸시가 §4.2 보다 많다.** 발주처 → `LoadCustomersToWebAsync`, 구분·상태 → `LoadCodesToWebAsync` 도 함께 민다(복구하면 드롭다운 소스가 바뀐다). 과제·코드·발주처 공통의 `LoadProjectsToWebAsync`(dbGone 재판정)와 인력의 `LoadMembersToWebAsync` 는 설계대로.

**4. `trashGet` 회신은 `{ ok, data, msg }` 로 감싼다**(`membersGet` 과 같은 요청/회신 배관). `data` 가 §4.2 의 페이로드다. 화면은 `r.data || r` 로 읽어 푸시(`__applyTrash`, 감싸지 않음)와 같은 함수로 그린다. `LoadTrashJsonAsync` 는 null 을 돌려주지 않는다 — 미로그인·미등록·비활성·비관리자 전부 `{found:true, admin:false}`, 연결·조회 실패는 `{found:false, msg}`.

**5. 목록의 `refs` 는 종류별 한 문장(GROUP BY 롤업, 인력은 9표 `UNION ALL`)으로 센다.** 행마다 세면 숨긴 항목 수만큼 왕복이다. `DeleteTrashAsync` 는 트랜잭션 안에서 §3.1 의 행 단위 쿼리로 다시 센다(힌트 ≠ 판정).

**6. 로그 한 줄 끝에 참조 수를 붙인다** — `영구 삭제 {kind} {key} by {me} {행 JSON} 참조 {n}건`. 행 JSON 은 한글이 읽히게 relaxed escaping. `is_active` 를 읽지 못하면 활성으로 간주해 거부한다(닫힌 쪽으로 실패). DELETE 가 0행이면 롤백하고 '이미 없음' 문구.

**7. 코드 배치** — 휴지통 블록은 `ProjectDb.cs` 끝에 둔다. 중간에 넣으니 소스를 문자열 위치로 자르는 옛 시험 5건(code-tables·project-dev-end·xlsx-export)이 순서만으로 깨졌다. `xlsx-export.test.mjs` 의 "`DELETE FROM customer` 가 파일 어디에도 없다" 는 "`DeleteTrashAsync` 안에만 있다" 로 고쳤다.

**8. 진입 버튼 핸들러는 `() => openTrash()`** — `user-admin.test` 의 진입 하네스가 `usAdminBtnSync` 만 떼어 내 `openUserAdmin` 만 스텁하므로 직접 참조면 `ReferenceError` 다. 같은 함수 안에서 `#usUserAdmin` 뒤에 만들고 함께 없앤다.

**9. 탭은 검색 모달의 `.tabs/.tab` 컨트롤을 재사용**한다. `#trTabs` 는 마크업에서 빈 `<div>` 이고 `trRender` 가 관리자일 때만 `className='tabs'` 를 준다(`uaAdminBar` 와 같은 방식). 새 CSS 는 배지 간격·목록 스크롤 상한 두 줄뿐.

**10. 과제 행의 참조 문구는 "편입 {n}건"**(§5.1 은 "명"). 카테고리 행 수라 '건'이 정확하다. 확인창 본문은 §5.2 대로 "편입 {n}명".

**11. `#confirmTypedModal` 은 `#confirmModal` 옆에 둔다**(휴지통 마크업 조각을 깨끗이 유지 + 변형의 원본 옆). `confirmBox`·`#cfOk` 는 손대지 않았다(루프 시험이 그 손잡이를 쓴다). 삭제 확인창 제목은 "{탭 이름} 영구 삭제". Enter 는 버튼이 켜져 있을 때만, IME 조합 중(keyCode 229)은 무시.

**12. 숨김 확인창의 안내 문장은 "계속할까요?" 뒤에 붙는다.** 발주처·코드 쪽은 editor 도 숨길 수 있으므로 "(관리자)" 를 덧붙였다 — 휴지통은 관리자만 본다.

**13. 루프(`loop-trash.mjs`) 실측 2026-09-10** — 케이스 C00~C08, 판정 182, 무작위 시드 5회 연속 통과(권한 적용 뒤). 실패 경로에서는 푸시를 기다리지 않는다(성공에만 오는 푸시를 기다리면 12초씩 태운다). 정리 3겹, 실행 후 zz 잔재 0·실직원/실과제 행 수·`schema_version`·로그인 계정 권한 불변 확인.

**14. 배포·복구 경로의 문서 결함 셋을 고쳤다 — 2026-09-10 전면 검토(D1·D2·D7).**
① **`DEPLOY.md §6-1` 이 이 기능을 배포 절차에서 지워 버릴 뻔했다.** 그 줄은 *"스키마 변경이 딸린 버전이면 §0 을 먼저"* 였는데,
v0.19.0 은 `migrate-*.sql` 이 한 개도 없고 **권한(GRANT)만 바뀐다** — 그래서 §0 을 통째로 건너뛰는 것으로 읽혔고, 그러면 §0-5 의 GRANT 가
재적용되지 않아 **영구 삭제가 전부 `ERROR 1142`** 다(§11-2 가 개발 DB 에서 겪은 그 사고). "스키마 변경 **또는 권한(GRANT) 변경**" 으로
고치고 그 자리에 이 판을 실례로 적었다. §3 배포 체크리스트에는 게이트 네 줄(§0-5 재적용 + `SHOW GRANTS` · `TC_TEST_STRICT=1` exit 0 ·
sha256 대조 · 루프 5회 연속)을 더했다.
② **복구 경로에도 같은 구멍이 있었다.** `restore-taskmgr.ps1 -Grants` 가 `db/deploy` 의 두 파일만 적용해, 복구본에서는 §3.3 의 일곱 표 중
`app_user` 가 비어 인력 영구 삭제가 1142 로 죽었다. 비공개 `taskmgr-company-data/05-grants.sql` 을 형제 폴더에서 찾아 함께 적용하고,
못 찾으면 화면과 `복구방법.txt` 두 곳에 같은 경고를 남긴다(복구 가드 ④-b). **백업·복구 리허설은 이제 이 기능의 전제다** — §7 대로
영구 삭제에는 되돌리기가 없어서, 마지막 안전망이 백업 하나뿐이다(`DEPLOY.md §9`).
③ **§4.2 표가 §11-1·§11-4 와 어긋난 채였다.** 표는 `trashGet` 회신을 감싸지 않은 것으로, 복구를 `Set*ActiveAsync` 재사용으로 적고 있었다.
둘 다 **표를 지금의 사실로** 고치고(회신은 `{ok,data,msg}` · 복구는 `RestoreTrashAsync` 가 직접 `UPDATE`), 이력은 §11 에 그대로 뒀다.
§4.3 에는 `TrashKindMsg`·`TrashNoTarget` 과 완료 문장 `"영구 삭제했습니다."` 가 빠져 있어 채웠다 — 문서에 없는 문장은 시험도 사람도
계약으로 붙잡지 못한다.

전면 검토 2026-09-10(구현 뒤 두 번째 판). 지적 여덟 건을 호스트에서 닫았다.

**15. 복구가 `is_active` 를 보지 않았다 — 이미 복구된 항목을 또 복구했다.** 잠근 SELECT 가 이름만 읽었으므로 두 관리자가 같은 항목을 복구하면 뒤에 온 쪽이 이미 활성인 행에 UPDATE 를 걸었고, 구분·상태는 그 자리에서 `sort_order` 를 MAX+10 으로 **다시** 매겨 멀쩡히 쓰이던 값이 목록 맨 뒤로 튀었다. 이제 `is_active` 를 같은 SELECT 에서 잠근 채 읽고, 1 이면 UPDATE 전에 롤백하고 `TrashAlreadyActiveMsg`(§4.3)를 돌려준다. 시험 계약 ⑧(판정이 첫 UPDATE 보다 앞)과 ⑦(재매김은 구분·상태에만) + 변이 넷.

**16. 사용자 문장에 예외 원문이 실려 나갔다.** 조회·복구·삭제 셋이 `"…: " + Short(ex)` 였다 — SQL·컬럼명이 화면으로 새고 정작 사용자는 무엇을 할지 몰랐다. 셋 다 고정 문장으로 바꾸고 원문은 `_log` 로만 보낸다. 대신 **잠금 경합(1205·1213)** 은 따로 말해 준다(§4.3) — 그건 '다시 하면 되는' 사건이다. 같은 이유로 `MySqlUserMsg` 의 `default` 도 "처리하지 못했습니다(DB 오류)." 로 고정했다(USER-ADMIN §4.3).

**17. `LoadTrashJsonAsync` 가 거부 사유 넷을 하나로 뭉갰다.** 미로그인·미등록·비활성·비관리자가 모두 `{found:true, admin:false}` 였고 화면은 "관리자만 사용할 수 있습니다." 만 보여 줬다 — 퇴사 처리된 사람은 원인을 영영 못 찾는다. `NotAuthorizedException` 에 `RoleOnly` 를 두어 '권한이 모자란 것'과 '신원이 서지 않는 것'을 가르고, 뒤쪽만 관문의 문장을 `msg` 로 함께 싣는다(화면이 `d.msg` 를 그린다). `RunTrashGetAsync` 는 `data` 를 통째로 전달하므로 배관은 그대로다.

**18. 종류 switch 의 `default:` 가 status_code 였다(복구·삭제 둘 다).** 종류가 하나 늘고 한쪽만 안 고치면 **엉뚱한 표가 복구·삭제된다** — 되돌릴 수 없는 조작에 '기본값으로 아무거나'는 남겨 둘 수 없다. 다섯을 전부 이름으로 적고 `default:` 는 `TrashKindMsg` 로 거부한다. SQL 자체를 `ResolveTrashKind` 로 끌어올리지는 **않았다**: `admin-auth` 의 "쓰기 SQL 을 가진 메서드는 대상 표에 맞는 관문으로 연다" 와 "다섯 표의 DELETE 는 `DeleteTrashAsync` 안에만" (계약 ⑥·xlsx-export) 이 그 이동을 막는다. 계약 ⑨ + 변이 둘.

**19. 참조 롤업이 대소문자를 갈랐다.** 코드 3종의 참조 수를 `StringComparer.Ordinal` 로 묶었는데, 삭제 시점의 판정(`WHERE customer=@n`)은 FK 컬럼의 콜레이션(`utf8mb4_0900_ai_ci`)이라 대소문자를 무시한다. 표기가 한 글자 다른 자식이 있으면 힌트가 0건이라 화면이 [영구 삭제] 를 켜고 DB 가 1451 로 막았다. `OrdinalIgnoreCase` 로 바꾸고, 두 표기가 한 칸으로 합쳐지면 수를 **더한다**(덮어쓰면 한쪽이 사라진다).

**20. 퇴사자 목록을 그리려고 9개 표를 전원분 훑었다.** `UserRefCountAllSql` 에 사용자 조건이 없어 일정·할일·공수를 재직자 전 기간까지 세고 있었다 — 쓰는 값은 퇴사자 몇 명분이다. 각 하위 조회에 `WHERE user_id IN (SELECT user_id FROM app_user WHERE is_active=0)` 을 걸고, 퇴사자가 0명이면 그 조회를 **아예 돌리지 않는다**(명부를 먼저 읽는 순서로 바꿨다). 기준 표 9개는 여전히 정본에서 파생된 배열 한 곳에서만 온다(계약 ③ 무변경).

**21. 예외 경로의 롤백이 원래 예외를 덮었다.** `catch { await tx.RollbackAsync(cts.Token); throw; }` 는 cts 가 이미 타임아웃된 자리에서 롤백 자체를 `OperationCanceled` 로 죽였고, 그 예외가 1205·1213·1451 을 덮어 사용자 문장 매퍼에 닿지 못하게 했다. `SafeRollbackAsync`(취소되지 않은 토큰 + 롤백 실패 삼킴)로 여섯 자리를 함께 고쳤다.

**22. `TrashSelfMsg`(자기 계정)는 실동작으로 닿지 않는다 — 정적 계약으로 남긴다(2026-09-10 루프 시험 C07).** 자기 계정은 애초에 퇴사 처리할 수 없어서(USER-ADMIN §4.4-1) 휴지통에 자기 자신이 실릴 수 없고, §3.4 의 관문 순서가 ② 숨긴 항목만 → ③ 자기 계정이라 로그인 계정을 대상으로 보낸 `trashDelete` 는 **언제나** `TrashActiveMsg` 로 먼저 막힌다. `tests/loop-trash.mjs` C07 은 그래서 "둘 중 하나" 를 버리고 `TrashActiveMsg` **하나로** 판정한다(둘 중 하나로 두면 관문 순서가 뒤바뀌어도 통과한다). 규칙은 퇴사 규칙과 한 벌이므로 지우지 않는다 — 두 벌이 되는 순간 한쪽이 낡는다.

**23. 거부 문구가 약속한 새로고침을 실제로 하지 않았다(2026-09-11 적대 검토 R2).** `TrashRestoreAsync`/`TrashDeleteAsync` 가 `if (ok)` 일 때만 목록을 다시 밀었는데, "…목록을 새로고침합니다"라고 말하는 두 문장(`TrashGoneMsg`·`TrashAlreadyActiveMsg`)은 정확히 **실패**할 때 나온다 — 사용자는 그 문장을 읽으면서 사라진 항목이 그대로 있는 목록을 봤다. 이제 결과와 무관하게 휴지통을 밀고(`LoadTrashToWebAsync`), 관련 목록만 성공에 건다(`TrashRefreshRelatedAsync` 로 개명). 계약⑩ + 변이 셋.

**24. 복구·삭제 회신에 `reqId` 가 실린다(2026-09-11 R3).** `__trashDone` 은 왕복이 아니라 푸시라, 늦게 온 회신이 이미 다른 일을 하고 있는 화면을 건드릴 수 있었다. `trashRestore`·`trashDelete` 가 `reqId` 를 보내고 호스트가 `window.__trashDone(ok, msg, reqId)` 로 되돌려 준다 — 없으면 `""`(옛 웹과 호환). 직원 쪽 `__userSaved` 와 같은 모양이다(USER-ADMIN §11-26).

**25. 코드 3종의 참조 수를 DB 에서 센다(2026-09-11 R4).** 힌트 롤업이 과제를 걷어 와 C# 사전(`OrdinalIgnoreCase`)으로 코드 이름과 맞췄는데, FK 컬럼의 콜레이션 `utf8mb4_0900_ai_ci` 는 대소문자뿐 아니라 **악센트·전각/반각까지** 무시한다 — 'Ａ' 와 'A' 가 DB 에서는 같은 값이고 C# 에서는 다른 값이라, 힌트가 0 건이라 화면이 [영구 삭제] 를 켜고 같은 콜레이션으로 다시 세는 삭제 시점 판정이 1451 로 막았다(힌트 ≠ 판정이 되는 자리). 이제 `LEFT JOIN project p ON p.<컬럼> = c.name … GROUP BY c.name` 한 문장으로 세므로 힌트와 판정이 **같은 비교**를 쓴다.

**26. 잠금 경합 판정과 종류 switch 의 `default:` 를 정리했다(2026-09-11 R5).** 1205·1213 이 세 곳에 번호로 적혀 있어 `IsLockContention(ex)` 한 줄로 모았다(§4.3 문구는 그대로). 복구·삭제의 `default:` 는 거부 문장을 한 벌 더 적는 대신 `InvalidOperationException` 을 던진다 — `ResolveTrashKind` 가 이미 걸러 여기 닿을 수 없고, 닿았다면 종류가 늘고 이 switch 만 안 고쳤다는 뜻이라 조용히 덮을 일이 아니다(계약⑨ 는 "거부든 예외든, 기본값으로 아무 표나는 안 된다"로 읽는다).

**27. 인력 복구가 `sort_order` 를 비운다(2026-09-11 적대 검토 R3).** 옛 판은 `UPDATE app_user SET is_active=1 …` 하나였다 — 퇴사자가 **옛 순번을 들고** 돌아와 활성 서열(10·20·30…) 사이에 끼어들었다(USER-ADMIN §7-1a). 뜻은 구분·상태의 `MAX+10`(§11-1)과 같고 셈만 다르다: 명부 `ORDER BY` 가 NULL 을 맨 뒤로 보내므로(USER-ADMIN §5.3) 최댓값을 셀 것 없이 `sort_order=NULL` 이면 된다 — 값이 없다는 사실 자체가 '아직 자리를 안 정했다' 다. 그래서 계약⑦ 은 이제 셋을 함께 본다: 구분·상태는 `MAX+10` · **인력은 `NULL`** · 나머지(과제·발주처)는 손대지 않는다. 복구 경로는 둘이므로(휴지통 · 편집 폼의 [복구]) 편집 폼 쪽 `SetUserActiveAsync` 도 같은 규칙이고, 그 축은 USER-ADMIN 게이트 계약⑥-f 가 진다([USER-ADMIN §11-29](USER-ADMIN.md)). 변이 둘(인력의 `NULL` 삭제 · 인력을 `MAX+10` 으로 바꾸기).
