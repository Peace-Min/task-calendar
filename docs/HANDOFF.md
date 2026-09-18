# 인계 — 다음 세션이 처음 읽는 문서 (HANDOFF)

> 기준 2026-09-18 · HEAD = git log 참조(마지막 커밋: 잔여 정리·「관리」 구획 분리) (`feat/db-app`) · 이 문서는 **세션이 바뀔 때마다 이 자리에서 갱신**한다.
> 상세 설계·이력은 각 문서의 §11 이 정본이다. 여기는 "지금 어디에 있고, 무엇부터 하며, 무엇을 밟으면 안 되는가" 만 적는다.
> [ROADMAP.md](ROADMAP.md) §0 은 2026-09-02 기준이라 이 문서보다 낡았다 — 충돌하면 이 문서가 맞다.

---

## 1. 지금 어디에 있나

| 항목 | 값 |
|---|---|
| 작업 트리 | `C:\Users\CEO\Desktop\console\task-calendar-db` (git worktree, 브랜치 `feat/db-app`). 메인 체크아웃은 `..\task-calendar`(만지지 않는다) |
| 비공개 저장소 | `C:\Users\CEO\Desktop\console\taskmgr-company-data` (`master`) — 사용자 스키마·시드·권한. **형제 폴더여야** 상시 게이트가 돈다(tests/README) |
| 원격 | `github.com/Peace-Min/task-calendar` · `github.com/Peace-Min/taskmgr-company-data` |
| **미푸쉬** | 2026-09-18 에 두 저장소 모두 푸쉬함(그 뒤 커밋은 git log origin/feat/db-app..HEAD 로 확인). **"푸쉬" 라고 지시할 때만** 푸쉬한다 |
| 버전 파일 | 전부 **0.18.1** 그대로(csproj·APP_VERSION·iss·RELEASE_NOTES·CHANGELOG·#patchModal). `tests/version-sync.test.mjs` 가 여덟 자리 정합을 잠근다 |
| 위젯 스키마 계약 | `CalendarDb.ExpectedSchemaVersion = "12"` — **배포된 0.18.1 은 v9 짝**이다. 버전 승격 전엔 `배포-빌드.cmd` 를 돌리지 말 것(같은 번호로 계약이 다른 exe 가 나간다) |
| 개발 DB | `taskmgr`(MySQL 8.4.9, root/taskmgr123, 앱 계정 taskmgr_app/taskmgr1234). 마이그레이션 **9→10→11→12 적용됨**, 앱 계정 **DELETE 일곱 표 적용됨**(project·customer·section_code·status_code·app_user·cal_user_pref·cal_user_rev), **2026-09-18 org_unit·title_code INSERT, UPDATE 적용됨**(직급·소속 관리 · 백업 taskmgr-20260918-141726.sql 뒤). 운영에 준함 — 실험은 별도 DB, 시험 데이터는 zzU/zzP/zzC/zzT 접두만 |
| 게이트 | 엄격 `TC_TEST_STRICT=1 node tests/run-tests.mjs` → **1652 pass / 0 fail / 0 skip** · CS 경고 0 · 루프 13종 통과(org-title 포함) |

## 2. 9월 2일(ROADMAP §0) 이후 끝낸 것 — 전부 커밋됨

1. **스키마 정합 6종**(v9, `migrate-2026-09-09-integrity.sql`) → v0.18.1 릴리스 빌드(실배포는 안 함).
2. **과제 개발종료일** `project.dev_end_date`(v10) + 관리자 편집 + Excel 열.
3. **사용자 관리**(v11·v12): `app_user.sort_order INT UNSIGNED`, 관리자 전용 「구성원 편집」(등록·수정·퇴사·복구·▲▼ 서열, 전사 단일 순서), 「구성원 보기」와 완전 독립. 설계·이력 [USER-ADMIN.md](USER-ADMIN.md).
4. **편집 폼 UX**: 퇴사/복구를 폼 하단으로, 등록 버튼을 창 하단 주 버튼으로, 서열 번호 읽기전용 칸, 라디오→드롭다운, 모달 폼 세로 리듬 전역 정정.
5. **휴지통**(`#trashModal`, 관리자 전용): 숨긴 과제·퇴사자·발주처·구분·상태의 복구/**영구 삭제**. 인력은 기록 0건만, 이름 입력 확인, 앱 계정 DELETE 권한 세 파일(+부속 2표). 설계·이력 [TRASH-DELETE.md](TRASH-DELETE.md).
6. **전면 재검토 + 적대 리뷰 6회차**: 결함 60여 건 수정, 계약 대폭 추가(1277 → 1575). 복구 스크립트 사전 검증·UNC 경로·백업 절 등 DEPLOY.md 갱신.
7. **슬롭 제거 2단계 + 사후 리뷰**(`bf0a75e`·`479fceb`·`5d4940b`·`d5258ab`): 다섯 관리자 쓰기를 기존 `hostRequest ↔ ReplyOnUi` 배관으로, 갱신 데이터는 회신에 싣고 푸시 삭제. 목록은 데이터가 바뀔 때만 다시 그리고 잠금은 속성 토글, ▲▼는 행 노드 이동. 웹 모듈 상태 변수 29 → **16**(리뷰 전 18).

## 3. 다음 할 일 (우선순위순)

0. ~~직급·소속 GRANT 개발 DB 적용~~ — **2026-09-18 완료**(ORG-TITLE-ADMIN §11-6 · loop-org-title 5회 연속 159/0). 운영 서버는 v0.19.0 배포 창에서 DEPLOY §0-5(이제 아홉 표).
1. **v0.19.0 릴리스** — CLAUDE.md 의 "버전 갱신 = 전체 릴리스" 체크리스트 전부: csproj 3곳·APP_VERSION+변경이력 줄·#patchModal(0.18.1 `pv-tag old` 강등)·RELEASE_NOTES·CHANGELOG·iss → `installer\publish-update.ps1 -Build` → 엄격 게이트 exit 0 · latest.json sha256 대조 · 루프 5회 연속(loop-user-admin·loop-trash). 패치노트에 사용자 관리·휴지통·개발종료일·정합 6종. **스키마 12 + GRANT 7표와 같은 창에 배포**(DEPLOY.md §0-5, §6-1 "권한 변경도 §0").
2. **푸쉬** — 지시 시에만. 본·비공개 둘 다.
3. 릴리스 뒤 여지: 서열을 숫자로 직접 입력해 옮기는 방식(호스트 계약 변경 필요).
4. 2026-09-18 에 끝낸 잔여: 「관리자」 구획 분리(#usAdminBtns) · 시험 헬퍼 사본 5파일 → harness(listCsMembers 추가) · 안 읽히는 불리언 반환 제거 · §11 12·13 순서 · 세피아 --muted #75664f(4.75:1). loop-ui-visual 의 남은 V8 경고는 전부 `--accent-soft` 배경 위 기준선 근처(warn, rc 0)로 이전부터 있던 것. *(아래 7 로 뒤집혔다 — 그 구획과 함수는 없다.)*
5. **크기 조절 상단 가장자리(2026-09-18)**: "좌상단 대각선이 안 된다" 보고 → 호스트·nw 핸들 자체는 정상(CDP 화면좌표 드래그 Δ 정확). 실제 원인은 `#dsBadge` 위 여백 12px 가 어느 핸들에도 안 걸리는 죽은 띠였던 것 → `.rsz-n` 추가·nw/sw 20px·ne 14px(✕ 보호). 개발기(DPI 100%)에선 재현 안 됐으므로 사용자 기기에서 계속되면 DPI 배율·작업표시줄 위치·커서 모양(↖↘)을 확인.
6. **휴지통 진입점 이동(2026-09-18 사용자 결정)**: 휴지통은 그 도메인의 화면이 연다 — 과제·발주처·구분·상태는 공식 과제 화면의 `#offTrash`, 퇴사자는 「구성원 편집」의 `#uaTrash`(`openTrash(scope)` · `__trScope` 가 보이는 탭·머리말을 정한다). 「사용자 정보」에는 휴지통이 없고 `usAdminBtnSync` 는 「구성원 편집」 하나만 만든다. **호스트 불변**(`trashGet` 은 그대로 다섯 목록). 계약 ⑥-b/⑥-DOM(a)·`loop-trash` C00/C08 은 새 문을 보도록 옮긴다([TRASH-DELETE §11-33](TRASH-DELETE.md) · [USER-ADMIN §11-37](USER-ADMIN.md)). *(아래 7: `usAdminBtnSync` 는 그 뒤 완전히 사라졌다.)*
7. **「구성원 편집」 진입 버튼 = 정적 공개 문(2026-09-18 사용자 결정)**: 「구성원 보기」 옆 같은 줄(`#usMemberBtns`)에 마크업으로 상주하고, 관리자가 아니면 열린 화면이 호스트의 거절 한 줄(「관리자만 사용할 수 있습니다.」)만 보여 준다 — `usAdminBtnSync`·`#usAdminBtns`·진입 jsdom 하네스는 전부 제거, 부재 계약은 창 안의 컨트롤에만 적용된다([USER-ADMIN §11-38](USER-ADMIN.md) · [TRASH-DELETE §11-34](TRASH-DELETE.md)).
8. **기준 정보 관리 문 = 공식 과제 화면 하단 줄(2026-09-18 사용자 결정)**: 발주처·구분·상태 마스터는 「공식 과제 (DB)」 하단 줄의 「발주처 관리」(`#offCustMgr`)·「구분·상태 관리」(`#offCodeMgr`)에서만 관리하고, 편집 폼(`#officialEditModal`)은 고르기만 한다(폼 안의 링크 둘 제거 · 직급·소속과 같은 방식). 둘 다 `offEditGuard` 를 지나므로 **오프라인에서는 관리 모달이 열리지 않는다** — `loop-ui-integrity` A는 '진입 차단 + 열어 둔 모달 안의 추가 차단', B는 '온라인에 열어 두고 끊은 뒤 목록 재왕복이 안내 문구로 폴백'을 본다([TRASH-DELETE §5.0](TRASH-DELETE.md)).

## 4. 이어서 작업하는 법

```bash
# 위젯(Debug) 빌드·기동 — 루프 시험은 CDP 9222 가 필요하다. exe 가 잠겨 있으면 먼저 프로세스를 끈다
$env:TC_DEBUG_PORT='9222'; Start-Process widget\bin\Debug\net9.0-windows\TaskCalendarWidget.exe   # PowerShell
# 엄격 게이트
TC_TEST_STRICT=1 node tests/run-tests.mjs
# 실 위젯+실 DB 루프(비밀번호는 환경변수로만 · 명령줄 -p 금지)
export TC_TEST_DB_ADMIN_PW=taskmgr123; node tests/loop-user-admin.mjs --seed=N ; node tests/loop-trash.mjs --seed=N
```

- **배포 게이트 규약**: loop-user-admin·loop-trash 는 **무작위 시드 5회 연속 통과**, 한 번이라도 실패하면 1부터. HTML 은 csproj EmbeddedResource 라 **HTML 을 바꾸면 Debug 재빌드** 후 재기동.
- **루프가 위젯을 재기동하는 경우**(loop-conflict-ui 등) 뒤에는 CDP 가 없는 채로 떠 있을 수 있다 — 접속 실패는 결함이 아니라 재기동 신호.
- 적대 리뷰는 `/code-review high HEAD~N` 로 diff 범위를 한정. 수렴 기준: 코드로 확인되는 P0·P1 0건. **결함 수정이 모듈 상태 변수를 늘리면 멈추고** 기존 배관(`hostRequest`)·구조로 풀 수 있는지 먼저 본다 — 6회차 동안 그 반대로 해서 18 → 29 가 됐고 되돌리는 데 3커밋이 들었다(USER-ADMIN §11-34~35).
- 구현 위임은 CLAUDE.md 의 dev-delegate(페이블=설계·게이트·커밋, 오퍼스=코드). 에이전트에게 파일 소유권을 나눠 주고, 위젯·루프·실 DB 는 메인만 만진다.

## 5. 밟으면 안 되는 것 (실제로 밟았던 것)

- **줄끝**: `widget/MainWindow.xaml.cs` 는 `\r\r\n` 다수 + **정확히 24 CRLF** + LF 0. Edit 툴이 통째로 정규화한 사례가 있다 → 바이트 스크립트로 고치고 전후 카운트 확인. ProjectDb.cs·prototype.html·대부분 tests = LF, `tests/harness*.mjs`·`tests/user-info.test.mjs`·`tests/README.md`·`DEPLOY.md` = CRLF. `git stash` 금지(워크트리 공유).
- **prototype.html 전역 치환 금지** — 임베드 base64 이미지 16블록이 깨진 적이 있다. Edit 는 고유 앵커로만, 끝나면 HEAD 와 base64 동일성 확인.
- **루프의 `el.click()` 은 포커스를 옮기지 않는다** — 포커스 보존을 재려면 `focus()` 를 먼저 부른다(C21).
- **node 인라인 문자열의 백슬래시**가 깨진다 → 코드 블록은 `<<'EOF'` 히어독 파일로.
- **mysql.exe 부하 시 stdout 소실**(문장은 실행됨) → idempotent 재시도.
- 실 DB 마이그레이션·GRANT 는 백업(복원 검증) 후, 지시가 있을 때만.

## 6. 문서 지도

| 무엇 | 어디 |
|---|---|
| 사용자 관리 설계·계약·정정 이력 §11-1~37 | docs/USER-ADMIN.md |
| 휴지통 설계·계약·정정 이력 §11-1~33 | docs/TRASH-DELETE.md |
| 직급·소속 관리 설계·정정 이력 §11-1~5 | docs/ORG-TITLE-ADMIN.md |
| 로그인·쓰기 관문 | docs/USER-LOGIN.md |
| 배포 절차·GRANT 재적용·백업/복구 | DEPLOY.md (§0-5·§3 체크리스트·§9) |
| 마이그레이션 순서표 | db/deploy/README.md |
| 시험 하네스·루프 규약·형제 폴더 전제 | tests/README.md |
| 표 설계 정본 | db/CALENDAR-TABLE-DESIGN.md · db/deploy/schema-calendar.sql |
| 검토자 보고용 스키마 | docs/DB-SCHEMA.html · db/table-design-report.html (v12) |
