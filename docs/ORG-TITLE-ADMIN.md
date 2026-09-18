# 직급·소속 관리 — 확정 설계 (ORG-TITLE-ADMIN)

> 작성 2026-09-18 · 대상 판번호 **12 → 12**(스키마 변경 없음 — **GRANT 만 바뀐다**: `org_unit`·`title_code` 에 INSERT·UPDATE) · 위젯 **v0.19.0**(마이너 릴리스에 함께 실린다)
> 짝 문서: [USER-ADMIN.md](USER-ADMIN.md)(구성원 편집·관문) · [TRASH-DELETE.md](TRASH-DELETE.md)(휴지통) · 비공개 `taskmgr-company-data/01-schema-users.sql`(표 정본)
> 이 문서는 **구현 전 설계**다. 구현하며 달라지는 곳은 [§11 정정 이력](#11-정정-이력)에 적는다. **본문과 §11 이 다르면 §11 이 맞다.**

---

## 1. 확정 요구 (사용자 지적 — 이것이 판정 기준)

- 사용자(2026-09-18): *"직급, 소속에 대한 편집 지원이 안 되고 있음."*
- 지금 상태: 직원 편집 폼의 「직급」·「소속」 드롭다운은 DB 마스터(`title_code`·`org_unit`)를 **읽기만** 한다. 마스터 자체를 고치는 화면이 없고, 앱 계정(`taskmgr_app`)은 두 표에 **SELECT 만** 가지고 있다(비공개 `05-grants.sql` 40·44행, `db/deploy/grants-calendar.sql` 238~239행 "이번 범위 밖").
- 같은 날의 다른 결정과 맞물린다: *"구성원 관련은 사용자 정보 → 구성원 편집 이후에서 전부 해결"* — 그래서 이 화면의 문은 **「구성원 편집」 안**이다.

## 2. 결정 요약

| 항목 | 결정 | 근거 |
|---|---|---|
| 화면 | 관리자 전용 **「직급·소속 관리」** 한 화면(`#orgTitleModal`), 탭 둘(직급 · 소속). 「구분·상태 관리」(`#codeModal`)와 **같은 골격**(추가 입력줄 · 「숨긴 값도 표시」 · 행마다 [이름변경][숨김/복구] · 활성끼리 ▲▼) | 관리자가 이미 아는 화면을 한 벌 더 만든다. 새 문법을 만들지 않는다 |
| 진입 | 「구성원 편집」 상단 막대(`#uaAdmin`)의 **「직급·소속 관리」** `#uaOrgTitle` — `uaAdminBar` 가 관리자·비순서편집일 때만 만든다(「퇴사자 휴지통」과 같은 자리·같은 규칙) | "구성원 편집 이후에서 전부 해결". 막대 안 컨트롤은 부재 계약(USER-ADMIN §8-7(b)) |
| 직급 조작 | 추가 · 개명 · 숨김/복구 · 순서(▲▼) | `title_code` 는 PK=name, `sort_order`, `is_active`. 개명은 `app_user.title` 에 **ON UPDATE CASCADE** 로 전파된다(스키마 실측) |
| 소속 조작 | 추가(**상위 조직 필수 선택**) · 개명 · 숨김/복구 · **형제 안 순서**(▲▼). **상위 이동은 없다** | 사용자(2026-09-18): *"상위 조직 개편은 거의 없다 — 기술개발총괄·SW개발본부는 안 바뀌고, SW 5팀·6팀 같은 팀 추가는 가능해야 한다."* 그래서 흔한 일(본부 밑에 팀 추가)만 화면에 둔다. 드문 개편(팀을 다른 본부로)은 새 팀 추가 → 직원 소속 변경 → 옛 팀 숨김으로 된다. 최상위는 하나뿐이어야 한다(`02-seed-org.sql` 가드가 루트 1개를 요구) — 그래서 상위 없는 추가는 받지 않는다 |
| 숨김 조건 | **직급**: 재직자(`is_active=1`)가 그 직급인 사람이 0명일 때만. **소속**: 재직자 0명 **그리고** 활성 하위 조직 0개일 때만 | 숨긴 값은 편집 폼 드롭다운에서 빠진다. 재직자가 아직 달고 있는 값을 숨기면 그 사람을 열 때마다 '고를 수 없는 값'이 된다. 퇴사자의 과거 표기는 그대로 남는다(표는 지우지 않는다) |
| 삭제 | **없다.** 이 판에서는 숨김까지만 | `app_user.title`/`org_id` FK 가 RESTRICT 다. 영구 삭제가 필요해지면 휴지통(TRASH-DELETE)에 종류를 더한다 — 그 문서의 틀(기록 0건만·이름 대조)이 그대로 맞는다 |
| 권한 | 전부 **`OpenAdminAsync`**(관리자만) | 직원 정보와 같은 마스터다. 발주처·코드가 `editor` 에게 열린 것과 달리 사람의 소속·직급은 관리자의 것이다 |
| 회신 | 쓰기 회신에 **갱신 목록**(`orgTitle`)을 싣는다 — 휴지통·명부와 같은 `hostRequest ↔ ReplyOnUi` 한 길. 푸시 없음 | USER-ADMIN §11-34~35 의 교훈: 부탁하지 않은 푸시는 배달을 둘로 가른다 |
| 편집 폼 반영 | 이 화면을 **닫을 때** `uaReload()` 한 번 — 「구성원 편집」의 드롭다운 소스(`__uaTitles`·`__uaUnits`)와 명부의 소속 표기가 새로 온다 | 드롭다운 소스는 `membersGet` 회신이 정본이다. 여기서 따로 앉히면 두 벌이 된다 |
| GRANT | `taskmgr_app` 에 `org_unit`·`title_code` **INSERT, UPDATE** 추가(DELETE 없음). 세 파일(비공개 `05-grants.sql` · `db/deploy/grants-calendar.sql` · `db/deploy/create-app-user.sql`) + DEPLOY.md §0-5 | 개발 DB 적용은 **백업 뒤·지시가 있을 때만**(HANDOFF §5) |

## 3. 데이터 (스키마 변경 없음)

### 3.1 `title_code`
- PK `name VARCHAR(30)` · `sort_order INT` · `is_active TINYINT(1)`. 시드 11개(대표 5 … 사원 100, 10 간격).
- `app_user.title` → `fk_user_title` **ON UPDATE CASCADE ON DELETE RESTRICT**. 개명 = `UPDATE title_code SET name=@new WHERE name=@old` 한 문장으로 사람들의 직급이 따라간다.
- 순서 저장은 코드표(`ReorderCodesAsync`)와 같다: 이름 배열을 받아 10 간격으로 다시 매긴다(트랜잭션).

### 3.2 `org_unit`
- PK `org_id SMALLINT UNSIGNED AUTO_INCREMENT` · `name VARCHAR(50) UNIQUE` · `parent_id`(루트 NULL, 자기 표 FK ON UPDATE CASCADE ON DELETE RESTRICT) · `sort_order` · `is_active`.
- `app_user.org_id` → `fk_user_org_id` (번호 참조). 개명·부모 이동 모두 사람 쪽은 손대지 않는다.
- **상위 이동 없음**(§2): `parent_id` 는 추가할 때 한 번 정해지고 화면에서 바뀌지 않는다. 그래서 순환 검사도 필요 없다. 추가 시 `parentId` 는 **필수**이고 활성 조직이어야 한다(루트는 시드의 「기술개발총괄」 하나).
- 실제 트리(시드): 기술개발총괄 → SW개발본부(SW 1~4팀·디자인팀) · 시스템개발본부(시스템 1·2팀) · 사업부 · 경영지원팀. 예: 「SW 5팀」은 상위 = SW개발본부로 추가하면 SW 4팀·디자인팀 뒤에 붙고, ▲▼로 디자인팀 앞으로 옮긴다.
- **형제 안 순서**: 같은 `parent_id` 를 가진 활성 노드들끼리만 ▲▼. 순서 저장은 그 형제 집합의 org_id 배열을 받아 10 간격으로 다시 매긴다.
- 숨김(`is_active=0`)된 조직은 `membersGet` 의 `units` 에서 빠진다 — 지금 조회가 이미 `WHERE t.is_active=1` 만 읽는다(ProjectDb.cs 「DB 구성원 조회」). 숨김 조건이 "재직자 0·활성 하위 0" 이라 트리에서 빠져도 가리키는 재직자가 없다. 퇴사자의 옛 소속 표기(`org_unit` JOIN)는 행이 남아 있으므로 그대로 나온다.

## 4. 호스트 (`widget/ProjectDb.cs` · `widget/MainWindow.xaml.cs`)

### 4.1 조회 `orgTitleGet` → `{ found, admin, titles:[{name, active, sort, users}], units:[{orgId, name, parentId, sort, active, users, children}] }`
- `OpenAdminAsync` 를 지난다. 관리자가 아니면 `{found:true, admin:false}` 만(휴지통 `trashGet` 과 같은 모양 — 목록을 싣지 않는다).
- `users` = 그 값을 단 **재직자** 수, `children` = 활성 하위 조직 수. 숨김 가능 여부는 화면 힌트이고 최종 판정은 호스트의 쓰기 함수가 같은 트랜잭션에서 다시 센다(TRASH-DELETE 의 `deletable/why` 와 같은 규율).
- 숨김 포함 전체를 싣는다(「숨긴 값도 표시」가 화면에서 거른다).

### 4.2 쓰기 (전부 `OpenAdminAsync` · 회신 `{ ok, msg, orgTitle }` — `orgTitle` 은 성공 시 4.1 과 같은 덩어리)
| 명령 | 인자 | 규칙 |
|---|---|---|
| `titleAdd` | name | TRIM · 1~30자 · 중복(숨김 포함) 거부 · `sort_order` = 현재 최대+10 |
| `titleRename` | oldName, newName | 같은 규칙 · 새 이름 중복 거부 · CASCADE 로 사람 따라감 |
| `titleSetActive` | name, active | 숨김은 재직자 0명일 때만(문장: "이 직급인 재직자가 n명 있습니다 — 먼저 직급을 바꾸세요") · 복구는 늘 됨 · 이미 그 상태면 거부(`AlreadyActiveMsg` 규율) |
| `titleReorder` | names[] | 활성 전부가 와야 한다(빠진 이름이 있으면 낡은 화면 — `StaleRosterMsg` 규율의 판) |
| `unitAdd` | name, parentId(**필수**) | 1~50자 · 중복 거부 · 부모는 실재·활성이어야(없으면 "상위 조직을 고르세요") · `sort_order` = 그 형제 최대+10 |
| `unitRename` | orgId, newName | 중복 거부 |
| `unitSetActive` | orgId, active | 숨김은 재직자 0명·활성 하위 0개일 때만 · 복구 시 부모가 숨김이면 거부("상위 조직을 먼저 복구하세요") |
| `unitReorder` | parentId, orgIds[] | 그 형제의 활성 전부가 와야 한다 |

- 잠금 경합(`IsLockContention`)·롤백(`SafeRollbackAsync`) 규율은 `SaveUserOrderAsync` 그대로.
- MainWindow: `case "orgTitleGet"` … `case "unitReorder"` 여덟 개. 회신은 `ReplyOnUi(reqId, new { ok, msg, orgTitle })`. **줄끝 `\r\r\n`·CRLF 24 규칙 유지**(바이트 스크립트로만 편집).

## 5. 화면 (`task-calendar-prototype.html`)

### 5.0 진입 — 「구성원 편집」 상단 막대의 「직급·소속 관리」
`uaAdminBar` 비순서편집 분기: 「순서 편집」 · 「퇴사자 휴지통」 · **「직급·소속 관리」**(`#uaOrgTitle`) · 「퇴사자 보기」. `uaSyncControls` 잠금 집합에 `uaOrgTitle` 추가.

### 5.1 `#orgTitleModal` — 「구분·상태 관리」의 골격을 그대로
- 머리 「직급·소속 관리」 · 탭 둘(`.code-tabs` 재사용: 직급 / 소속) · 추가 입력줄(소속 탭은 **부모 드롭다운**이 하나 더) · 「숨긴 값도 표시」 · 메시지줄 · 목록.
- 직급 행: 이름 · [숨김] 배지 · ▲▼(활성끼리) · [이름변경] [숨김]/[복구]. `users` 가 0 이 아니면 [숨김] 을 `disabled` 하고 `title` 에 사유(휴지통의 `deletable/why` 와 같은 손). 
- 소속 행: **들여쓰기 트리**(깊이 × 16px, `▸` 없이 들여쓰기만) · 이름 · 재직자 수 배지 · ▲▼(같은 부모의 활성 형제끼리) · [이름변경] [숨김]/[복구]. 추가 입력줄의 상위 드롭다운 후보 = 활성 조직 전부(들여쓰기 표기), 기본값 없음(안 고르면 [추가] 가 꺼진다).
- 이름변경은 코드표와 같이 **행 안에서** 입력칸으로 바뀐다(`codeBeginRename` 골격).
- 잠금: 쓰기 왕복 중 행 버튼 `disabled` 토글(`trSyncControls` 골격, 목록을 다시 그리지 않는다). 회신의 `orgTitle` 을 앉히는 문은 **하나**(`otSeat`).
- 닫을 때(`data-close` 와 ×): `uaReload()` — 「구성원 편집」이 드롭다운 소스와 명부를 새로 받는다. 이 화면은 `__uaTitles/__uaUnits` 를 **만지지 않는다**.
- 모듈 상태는 **다섯**을 넘기지 않는다: `__otData`(회신 덩어리) · `__otTab` · `__otShowHidden` · `__otBusy`(조회 재진입) · `__otSaving`(쓰기 왕복). 요청 표·워치독·보류 큐 금지(USER-ADMIN §11-34 교훈).

### 5.2 문구
- 직급 숨김 거부: 호스트 문장 그대로("이 직급인 재직자가 n명 있습니다 — 먼저 직급을 바꾸세요").
- 소속 숨김 거부: "이 조직에 재직자 n명 · 하위 조직 m개가 있습니다 — 먼저 옮기거나 숨기세요".
- 하단 안내(`.git-note`): "직급은 이름을 바꾸면 그 직급인 사람의 표기도 함께 바뀝니다. 조직은 번호로 연결돼 있어 이름·상위를 바꿔도 소속자는 그대로입니다. 숨긴 값은 드롭다운에서 빠지고, 지우지는 않습니다."

## 6. 권한·배포

- 비공개 `05-grants.sql` 40·44행: `GRANT SELECT` → `GRANT SELECT, INSERT, UPDATE` (두 표). `db/deploy/grants-calendar.sql` 238~239 주석과 250행 근처 GRANT, `db/deploy/create-app-user.sql` 같은 자리. DEPLOY.md §0-5 "권한 변경도 §0" 에 한 줄.
- **개발 DB 적용은 이 문서로 하지 않는다.** 백업(복원 검증) 뒤, 지시가 있을 때 `GRANT` 두 문장을 적용하고 `SHOW GRANTS` 로 대조한다. 그 전까지 실 위젯 루프(`loop-org-title.mjs`)는 **판정 없음**(exit 2)으로 끝나야 한다 — 권한이 없으면 첫 쓰기가 1142 로 거부되는데 그것을 실패로 세면 안 된다.

## 7. 시험

- **계약**(`tests/org-title-web.test.mjs`, jsdom): ① 마크업에 탭·행·버튼이 없다(부재) ② `#uaOrgTitle` 은 `uaAdminBar` 가 관리자·비순서편집일 때만 만든다 ③ 렌더는 회신 순서를 지킨다(정렬 없음) ④ 숨김 불가 행은 [숨김] 이 꺼지고 사유가 `title` 에 ⑤ 소속 트리 들여쓰기 = 깊이 ⑥ 상위를 안 고르면 [추가] 가 꺼진다 · 상위 이동 컨트롤이 없다 ⑦ 쓰기 왕복은 `hostRequest` 한 길·회신 `orgTitle` 을 `otSeat` 한 곳이 앉힌다 ⑧ 닫을 때 `uaReload` 를 부른다 ⑨ 모듈 상태 변수 ≤ 5. 각 계약에 변이 ≥1 + 통제군.
- **호스트 계약**(`tests/org-title-host.test.mjs`, 소스 슬라이스): 여덟 명령이 `OpenAdminAsync` 를 지난다 · 숨김 조건 SELECT 가 쓰기와 같은 트랜잭션 · `unitAdd` 가 상위 없는 추가를 거부 · `parent_id` 를 바꾸는 UPDATE 가 없다 · 회신에 `orgTitle` · GRANT 세 파일이 INSERT, UPDATE 를 말한다 · DELETE 는 없다.
- **루프**(`tests/loop-org-title.mjs`, 실 위젯+실 DB, 접두 `zzJ`(직급)·`zzO`(조직)): 추가→개명→순서→숨김 거부(재직자 있음: zzU 직원을 잠시 그 직급/조직으로)→숨김→복구→상위 없는 추가 거부→정리. 마지막에 두 표에서 zz 행을 **UPDATE 로 숨김이 아니라 DELETE** 해야 하는데 앱 계정에는 DELETE 가 없다 → 루프는 관리자 계정(`TC_TEST_DB_ADMIN_PW`)으로 직접 지운다(휴지통 루프가 대역 관리자를 치우던 방식). 배포 게이트 규약(무작위 시드 5회)에 편입.

## 8. 하지 않는 것

- 영구 삭제(휴지통 종류 추가는 뒤로).
- 조직 상위 이동·드래그 앤 드롭(개편이 드물다 — 새 팀 추가 + 소속 변경 + 옛 팀 숨김으로 된다).
- 직급을 권한 판정에 쓰는 일(표 COMMENT 그대로: 표시·정렬 전용).
- `membersGet` 회신 모양 변경(드롭다운 소스는 그대로 그 회신이 정본).

## 9. 구현 순서

1. 이 문서 확정 — 상위 이동은 빼기로 확정(2026-09-18). 남은 확인: **숨김 조건**·**GRANT 적용 시점**.
2. 호스트(오퍼스 A: ProjectDb + MainWindow, 바이트 편집) ‖ 웹(오퍼스 B: 마크업·CSS·JS) — 파일 소유권 분리.
3. 시험(오퍼스 C: 계약 둘 + 루프) → 엄격 게이트.
4. 페이블 게이트: Debug 빌드·CDP 실화면·(GRANT 적용 후) 루프 5회.
5. 문서 정합: USER-ADMIN §5.0 표 한 줄 · HANDOFF · DEPLOY §0-5 · tests/README(접두 zzJ/zzO).

## 11. 정정 이력

(구현 전 — 비어 있음)
