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
| 개발 DB | `taskmgr`(MySQL 8.4.9, root/taskmgr123, 앱 계정 taskmgr_app/taskmgr1234). 마이그레이션 **9→10→11→12 적용됨**, 앱 계정 **DELETE 일곱 표 적용됨**(project·customer·section_code·status_code·app_user·cal_user_pref·cal_user_rev). 운영에 준함 — 실험은 별도 DB, 시험 데이터는 zzU/zzP/zzC/zzT 접두만 |
| 게이트 | 엄격 `TC_TEST_STRICT=1 node tests/run-tests.mjs` → **1579 pass / 0 fail / 0 skip** · CS 경고 0 · 루프 12종 통과 |

## 2. 9월 2일(ROADMAP §0) 이후 끝낸 것 — 전부 커밋됨

1. **스키마 정합 6종**(v9, `migrate-2026-09-09-integrity.sql`) → v0.18.1 릴리스 빌드(실배포는 안 함).
2. **과제 개발종료일** `project.dev_end_date`(v10) + 관리자 편집 + Excel 열.
3. **사용자 관리**(v11·v12): `app_user.sort_order INT UNSIGNED`, 관리자 전용 「구성원 편집」(등록·수정·퇴사·복구·▲▼ 서열, 전사 단일 순서), 「구성원 보기」와 완전 독립. 설계·이력 [USER-ADMIN.md](USER-ADMIN.md).
4. **편집 폼 UX**: 퇴사/복구를 폼 하단으로, 등록 버튼을 창 하단 주 버튼으로, 서열 번호 읽기전용 칸, 라디오→드롭다운, 모달 폼 세로 리듬 전역 정정.
5. **휴지통**(`#trashModal`, 관리자 전용): 숨긴 과제·퇴사자·발주처·구분·상태의 복구/**영구 삭제**. 인력은 기록 0건만, 이름 입력 확인, 앱 계정 DELETE 권한 세 파일(+부속 2표). 설계·이력 [TRASH-DELETE.md](TRASH-DELETE.md).
6. **전면 재검토 + 적대 리뷰 6회차**: 결함 60여 건 수정, 계약 대폭 추가(1277 → 1575). 복구 스크립트 사전 검증·UNC 경로·백업 절 등 DEPLOY.md 갱신.
7. **슬롭 제거 2단계 + 사후 리뷰**(`bf0a75e`·`479fceb`·`5d4940b`·`d5258ab`): 다섯 관리자 쓰기를 기존 `hostRequest ↔ ReplyOnUi` 배관으로, 갱신 데이터는 회신에 싣고 푸시 삭제. 목록은 데이터가 바뀔 때만 다시 그리고 잠금은 속성 토글, ▲▼는 행 노드 이동. 웹 모듈 상태 변수 29 → **16**(리뷰 전 18).

## 3. 다음 할 일 (우선순위순)

1. **v0.19.0 릴리스** — CLAUDE.md 의 "버전 갱신 = 전체 릴리스" 체크리스트 전부: csproj 3곳·APP_VERSION+변경이력 줄·#patchModal(0.18.1 `pv-tag old` 강등)·RELEASE_NOTES·CHANGELOG·iss → `installer\publish-update.ps1 -Build` → 엄격 게이트 exit 0 · latest.json sha256 대조 · 루프 5회 연속(loop-user-admin·loop-trash). 패치노트에 사용자 관리·휴지통·개발종료일·정합 6종. **스키마 12 + GRANT 7표와 같은 창에 배포**(DEPLOY.md §0-5, §6-1 "권한 변경도 §0").
2. **푸쉬** — 지시 시에만. 본·비공개 둘 다.
3. 릴리스 뒤 여지: 서열을 숫자로 직접 입력해 옮기는 방식(호스트 계약 변경 필요).
4. 2026-09-18 에 끝낸 잔여: 「관리자」 구획 분리(#usAdminBtns) · 시험 헬퍼 사본 5파일 → harness(listCsMembers 추가) · 안 읽히는 불리언 반환 제거 · §11 12·13 순서 · 세피아 --muted #75664f(4.75:1). loop-ui-visual 의 남은 V8 경고는 전부 `--accent-soft` 배경 위 기준선 근처(warn, rc 0)로 이전부터 있던 것.

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
| 사용자 관리 설계·계약·정정 이력 §11-1~35 | docs/USER-ADMIN.md |
| 휴지통 설계·계약·정정 이력 §11-1~31 | docs/TRASH-DELETE.md |
| 로그인·쓰기 관문 | docs/USER-LOGIN.md |
| 배포 절차·GRANT 재적용·백업/복구 | DEPLOY.md (§0-5·§3 체크리스트·§9) |
| 마이그레이션 순서표 | db/deploy/README.md |
| 시험 하네스·루프 규약·형제 폴더 전제 | tests/README.md |
| 표 설계 정본 | db/CALENDAR-TABLE-DESIGN.md · db/deploy/schema-calendar.sql |
| 검토자 보고용 스키마 | docs/DB-SCHEMA.html · db/table-design-report.html (v12) |
