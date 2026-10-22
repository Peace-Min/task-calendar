# 인계: 다음 세션이 처음 읽는 문서 (HANDOFF)

> 기준 **2026-10-01**, HEAD `2ee3956`(푸쉬 완료, `feat/db-app`). 이 문서는 **세션이 바뀔 때마다 이 자리에서 갱신**한다.
> 상세 설계와 이력은 각 문서의 §11 이 정본이다. 여기는 "지금 어디에 있고, 무엇부터 하며, 무엇을 밟으면 안 되는가"만 적는다.
> **환경 구분(2026-10-21):** 이 저장소를 여는 PC 는 **외부망 개발 PC** 다. 실제 사용자, 사내 서버 DB, 설치 파일 공유 폴더는 모두 **폐쇄망**에 있다. 개발 PC 의 MySQL 은 개발과 QA 전용이고, 산출물(인스톨러, 이관 SQL)은 여기서 만들어 폐쇄망으로 옮긴다. 폐쇄망 값(서버 주소, 비밀번호, 공유 폴더)은 저장소에 넣지 않는다. 자세한 표는 [DB-RELEASE-OPS.md](DB-RELEASE-OPS.md) "환경 구분".
> [ROADMAP.md](ROADMAP.md) §0 은 2026-09-02 기준이라 이 문서보다 낡았다. 충돌하면 이 문서가 맞다.

---

## 1. 지금 어디에 있나

| 항목 | 값 |
|---|---|
| 작업 트리 | `C:\Users\CEO\Desktop\console\task-calendar-db` (git worktree, 브랜치 `feat/db-app`). 메인 체크아웃은 `..\task-calendar`(만지지 않는다) |
| 비공개 저장소 | `C:\Users\CEO\Desktop\console\taskmgr-company-data` (`master`). 사용자 스키마, 시드, 권한이 들어 있다. **형제 폴더여야** 상시 게이트가 돈다(tests/README) |
| 원격 | `github.com/Peace-Min/task-calendar`, `github.com/Peace-Min/taskmgr-company-data` |
| **미푸쉬** | 없음(2026-10-01 `2ee3956` 까지 본 저장소 푸쉬, 비공개 저장소는 2026-09-18 이후 변경 없음). **"푸쉬"라고 지시할 때만** 푸쉬한다 |
| 버전 | **v0.19.1 소스 갱신(빌드와 게이트는 이어서)**(2026-10-01, 과제 순서, 기간 칩 클릭, 타인 일정 전체 보기, 창 버튼/보고서 전송 정리, 스키마 변경 없음). 직전 **v0.19.0 은 빌드 완료, 미배포**. `dist/installer/TaskCalendarWidget-Setup-v0.19.0.exe` sha256 `0ad02b32…3df8` 가 `latest.json` 과 같다. 버전 파일 여덟 자리 정합(`tests/version-sync.test.mjs`). 위젯 기본 `DbName` 은 **`taskcalendar`**(0.16, 0.17.1 은 `taskmgr`). **미배포 판이라 같은 번호로 여러 번 다시 빌드했다**(사용자 결정). 마지막 빌드가 위 해시다 |
| 위젯 스키마 계약 | `CalendarDb.ExpectedSchemaVersion = "12"`. 배포돼 있는 것은 0.16(사용자 대부분)과 0.17.1(사용자 본인 PC)이고 둘 다 `taskmgr` 를 쓴다 |
| 개발 DB | 이 PC MySQL 8.4.9 에 **`taskmgr`(v12, 원본)** 와 **`taskcalendar`(v12, 개발용 사본)**. `taskcalendar` 는 `run-loops` 가 매번 `setup-taskcalendar` 로 다시 만들고 `taskmgr` 의 `cal_*` 를 복사해 채운다(개발 전용). root 비밀번호는 사용자가 채팅으로 준다. 파일이나 메모리에 적지 않는다 |
| **2026-10-21 사내 서버 운용 방안** | 2026-10-20 개발 PC 의 `taskcalendar`(v13)를 사내 개발 서버에 부었다(사내 배포는 보류, 사용자 없음). 스키마 변경, 앱 배포, 버전 차단, 장애 대응의 기준은 **[DB-RELEASE-OPS.md](DB-RELEASE-OPS.md)** 다(설계 확정, 첫 사내 배포판에서 구현). DB 변경은 Workbench 에서 돌리는 `.sql` 로만 낸다 |
| 2026-10-15 코드표 번호 키 | 브랜치 `feat/code-ids`, 결정 [CODE-TABLE-IDS.md](CODE-TABLE-IDS.md). 발주처, 구분, 상태, 직급의 기본키를 번호(`customer_id`, `section_id`, `status_id`, `title_id`)로, `schema_version` **13**. A(DB 층, `0cd0b43`), B(앱, `4de2d7f`), C(문서, `3a80a8a`) 세 단계가 모두 커밋됐고 리뷰 수정 라운드가 이어졌다. 위 두 줄의 `12` 는 이 브랜치에서 `13` 이다(`CalendarDb.ExpectedSchemaVersion = "13"`). **로컬 `taskcalendar` 는 2026-10-15 에 v13 으로 이관했다**(`db/deploy/migrate-2026-10-15-code-ids.sql`, 백업 먼저). 리허설: 복제한 DB 를 이관한 결과와 `setup-taskcalendar` 로 새로 만든 DB 의 information_schema 가 같았고, 실 이관의 관문 값은 전부 0 이었다(구분 3, 상태 4, 직급 11행, AUTO_INCREMENT 4/5/12). 실 위젯 실 위젯 루프는 리뷰 수정본(bff7355)으로 33/33 통과, strict 2508/0/0. 리뷰 수정 뒤 바뀐 이관 SQL 과 setup 도 v12 백업 사본에서 다시 리허설했고, 이관본, setup 새 DB, 로컬 실 DB 셋의 information_schema 가 같다. 0.20.0 인스톨러는 544ce1d 로 다시 빌드했다(합치기, 푸시, 배포는 하지 않음). 회사 서버는 `setup-taskcalendar` 로 새로 만든다. 옛 진입점(`init-db`, `migrate.cmd`, `db/schema.sql`)과 지난 `migrate-2026-*.sql` 은 지웠다 |
| 2026-10-22 과제 캘린더 P1 | 브랜치 `feat/project-calendar`(워크트리 `.claude/worktrees/project-calendar`). DB 와 호스트만(화면 없음): 구조 번호 **16**(`cal_project_` 표 둘, 이관 조각 `v16-project-calendar.sql`), `widget/ProjectCalendarDb.cs`, 명령 여섯(메인 창 전용), 휴지통 과제 영구 삭제 거부. 공용 개발 DB `taskcalendar` 는 아직 15 다(병합 때 배포 SQL 로 16, 앱 계정 GRANT). DB 계약 시험은 `tests/db-project-calendar.mjs`(복사본 DB 에서). 메모는 [PROJECT-CALENDAR-PLAN.md](PROJECT-CALENDAR-PLAN.md) "구현 메모(P1)" |
| 게이트 | 엄격 `TC_TEST_STRICT=1 node tests/run-tests.mjs` 결과 **1894 pass / 0 fail / 0 skip**, CS 경고 0, **실 DB 루프 27/27 통과**(2026-10-01 15:27, `dist/rehearsal/loops-20261001-152731.txt`: 새 기능 실화면, 루프 14종 1회, 관리자 3종×5). 두 DB schema_version 은 시작과 끝 모두 12 |
| 폐쇄망 개인 PC | `taskcalendar` 구축 완료(2026-09-30, 회사 데이터 레포 pull 뒤 `setup-taskcalendar.cmd`). 위젯은 아직 0.17.1 이라 **v0.19.0 설치와 XML 이관 전**이다 |
| GitHub 위키 | 게시됨(2026-10-01): Home, 사이드바, '서버 연결이 끊겼을 때'(사용자), '서버 장애 시 동작과 진단'(운영). **원본은 `docs/wiki/`**. 고친 뒤 위키 저장소(`task-calendar.wiki.git`)에 복사하고 푸쉬한다 |

## 2. 9월 2일(ROADMAP §0) 이후 끝낸 것 (전부 커밋됨)

1. **스키마 정합 6종**(v9, `migrate-2026-09-09-integrity.sql`. 그 파일은 2026-10-15 에 지웠고 내용은 스키마 파일에 있다)과 v0.18.1 릴리스 빌드(실배포는 안 함).
2. **과제 개발종료일** `project.dev_end_date`(v10), 관리자 편집, Excel 열.
3. **사용자 관리**(v11, v12): `app_user.sort_order INT UNSIGNED`, 관리자 전용 '구성원 편집'(등록, 수정, 퇴사, 복구, ▲▼ 서열, 전사 단일 순서). '구성원 보기'와 완전히 독립이다. 설계와 이력은 [USER-ADMIN.md](USER-ADMIN.md).
4. **편집 폼 UX**: 퇴사/복구를 폼 하단으로, 등록 버튼을 창 하단 주 버튼으로, 서열 번호는 읽기전용 칸, 라디오를 드롭다운으로, 모달 폼 세로 리듬 전역 정정.
5. **휴지통**(`#trashModal`, 관리자 전용): 숨긴 과제, 퇴사자, 발주처, 구분, 상태의 복구와 **영구 삭제**. 인력은 기록 0건만 지울 수 있고 이름 입력으로 확인한다. 앱 계정 DELETE 권한은 세 파일(+부속 2표). 설계와 이력은 [TRASH-DELETE.md](TRASH-DELETE.md).
6. **전면 재검토와 적대 리뷰 6회차**: 결함 60여 건 수정, 계약 대폭 추가(1277 → 1575). 복구 스크립트 사전 검증, UNC 경로, 백업 절 등 DEPLOY.md 갱신.
7. **슬롭 제거 2단계와 사후 리뷰**(`bf0a75e`, `479fceb`, `5d4940b`, `d5258ab`): 다섯 관리자 쓰기를 기존 `hostRequest ↔ ReplyOnUi` 배관으로 옮기고, 갱신 데이터는 회신에 실어 푸시를 없앴다. 목록은 데이터가 바뀔 때만 다시 그리고 잠금은 속성 토글, ▲▼는 행 노드 이동. 웹 모듈 상태 변수 29 → **16**(리뷰 전 18).

8. **2026-09-18 하루 작업(전부 커밋됨)**:
   - 리사이즈 상단 가장자리 핸들(e22cdfb)
   - 휴지통 진입점을 도메인 화면으로(공식 과제 하단 줄 `#offTrash`, 구성원 편집 `#uaTrash`, f7fe8e8)
   - '구성원 편집' 정적 공개 문(3398c7a)
   - **직급·소속 관리**(`docs/ORG-TITLE-ADMIN.md`, ddeafdf)와 개발 DB GRANT 적용(f567bc1)
   - 기준 정보 관리 문을 편집 폼 밖 하단 줄로(dc7c38f)
   - 팝업 목록 상자 높이 고정(f86ed35)
   - 보고서 '내용 없는 항목 제외' 재정의(d20ffd2)
   - 글꼴은 기간 취합 전용(c2ced7c)
   - ⚙옵션 패널 격자(111ca04)
   - 근태 슬롯과 서식 컨트롤 동기화를 가드 앞으로(7cc8916, 91a2998)
   - **코드 품질 전면 조사 1차 15건 구현, 커밋**(`docs/QUALITY-SWEEP-2026-09-18.md` §1)

9. **2026-09-23, 코드 품질 전면 조사 §3.4-A(레이아웃 튐과 하드코딩 색 8건) 구현, 커밋**: 과제 모달 푸터 한 줄 유지(≤440 아이콘만, ≤360 컴팩트), 미리알림 '직접' 320px 한 줄, 빠른등록 `#qaRecurHint`/할 일 설명칸/보고서 `#raHint` 높이 불변, `.pv-frame` 하한 비례, `.s-date`/`mark` 토큰화(hex 래칫 49→45), 보고서 ≥900px 격자 flex-basis(넓고 낮은 창 잘림 해소). 게이트는 CDP 실측 전후 8건, `loop-ui-visual` 0건, 새 계약 `tests/layout-stability.test.mjs` 10건. 진행 방식: 페이블이 스카우트, 측정, 설계, 게이트를 맡고 오퍼스가 구현했다(dev-delegate).

10. **2026-09-23, 코드 품질 전면 조사 §3.4-B(경합과 상태 3건) 구현, 커밋**: `confirmTyped` 가 확인 순간의 값을 `{ ok, typed }` 로 돌려주고 `trDelete` 는 그것만 보낸다(닫힌 `#ctInput` 되읽기 제거). `reloadCodeList/reloadCustomerList` 목록 상자에 `dataset.gen` 세대 표식을 달아 늦은 옛 회신을 버린다. 공용 `guardInlineEdit`(DOM 판정)로 발주처, 구분/상태, 직급/소속의 탭 전환과 '숨김 표시'가 저장 안 한 인라인 편집을 말없이 버리지 않는다(바뀌었을 때만 '버리고 계속' / '계속 편집'을 묻는다). 모듈 상태는 늘지 않았다. 게이트는 CDP 실화면 시나리오, loop-trash와 loop-org-title 실 DB, 새 계약 `tests/inline-edit-guard.test.mjs` 9건, trash-web ⑦ 갱신.

11. **2026-09-23, 코드 품질 전면 조사 §3.4-C 1차(사용자가 "바로 진행"으로 승인한 6건) 구현, 커밋**: C-4 중복 제목 강등 때 커밋 본문과 날짜별 설명 보존(버그였다. 전송 본문에 본문이 다시 실린다), C-2 일간 payload `hours` 를 본문 헤더와 같은 `reportDailyHours(rows)` 에서, C-10 죽은 공수 합계(`sumMin·grandMin·uninput·minutes`) 제거, C-9 내보내기 md 에 커밋 본문, C-11 `load()` reportSource 항상 cal, C-7 보고서 푸터 dry/real 배지(`#rptSendMode`). 남은 C 5건(1, 8, 3, 6, 5)은 같은 날 **사용자 결정으로 보류**했고 조사는 끝났다.

12. **2026-09-23, 두 DB 운영 결정과 `setup-taskcalendar` 원큐 스크립트**: 마지막 배포판은 0.16(캘린더 XML, DB 는 과제 표 4개만)이다. 폐쇄망 개인 PC 의 `taskmgr` 는 과제와 사용자 표만 있다(v10~ 미적용, `cal_*` 없음). 결정: `taskmgr` 는 0.16 전용으로 두고, 같은 서버에 새 주 DB **`taskcalendar`** 를 세워 신버전이 붙는다(DEPLOY §0-6). `db/deploy/setup-taskcalendar.cmd`(+.ps1, 시험 `tests/setup-taskcalendar.test.mjs` 17건)의 순서는 다음과 같다.
    1. 정본 DDL 3개로 v12 구조를 만든다.
    2. 7표 데이터를 id/uid 를 보존해 복사한다(과제 트랙 시각 KST→UTC).
    3. 권한 3파일을 적용한다.
    4. 검증한다.

    개발 PC 리허설(`taskmgr_legacy_sim` → `taskcalendar_test`) 통과: 시각 복귀 일치, 구조 시그니처(175컬럼, 인덱스, FK) 차이 0, 가드/-Force 확인, 위젯 접속 확인. 실행은 사용자가 폐쇄망 PC 에서 한다. `DeployConfig.DbName` 은 v0.19.0 에서 `taskcalendar` 로 바꿨다(2026-09-30).

13. **2026-09-29~30, `setup-taskcalendar` 개정**: 폐쇄망 1차 실행이 "org_unit 에 정체성 컬럼 org_id 없음"(사용자 표가 08-24 이전 모양)으로 멈췄다. 그래서 사용자 결정으로 **사용자 3표는 회사 시드(02, 03, 04)로 채우고 과제 4표만 원본에서 복사**한다(원본 login_id 대조는 경고만, mysql 세션 UTC). 그 밖에 바꾼 것: 보고서는 사전 점검 실패와 취소도 남긴다. **회사 데이터 폴더 옛 판을 감지**한다(2차 실행이 옛 01 로 반쯤 서다 멈춘 사례). **실행할 때마다 기존 대상을 백업한 뒤 지우고 재구축**한다(-Force 불필요). 옛 판 작업장 `taskcalendar_legacy_stage` 는 자동으로 지운다. 폐쇄망 3차 실행 성공.
14. **2026-09-30, v0.19.0 릴리스 빌드**: 버전, 패치노트, iss, `DbName=taskcalendar`. 이전 기록 감지 팝업(빈 캘린더이고 데이터 폴더에 `*.xml` 이 있으면 묻는다. `legacyXmlProbe`/`readLegacyXml`, `widget/LegacyXmlProbe.cs`). 상단 DB 배지는 문제 있을 때만 보인다(정상 정보는 '사용자 정보' `#usDbLine`). 상단 상자 넷을 제목줄 아래로(`insertBelowTitleBar`). 공식 과제 도구줄 320px 접힘 정정.
15. **2026-10-01, 서버(DB) 연결 장애 대응**(기획 [OFFLINE-RESILIENCE.md](OFFLINE-RESILIENCE.md), 개발, QA, 위키 4단계):
    - 원인 분류(`DbErrors.Classify`: network, auth, schema, unregistered, unknown)
    - 편집 잠금(`guardEdit` 30여 곳과 `save()` 방어)
    - '저장되지 않은 변경' 막대와 재연결 때 자동 저장
    - 재연결은 15/30/60초 뒤 300초 꼬리(정상일 땐 폴링 0)
    - 응답만 끊긴 저장의 가짜 충돌 해소(S9)
    - 보고 기록 재시도, 닫기 경고
    - QA 전용 장애 주입 `__dbFault`(TC_DEBUG_PORT 실행만)
    - 실 위젯 루프 `tests/loop-offline.mjs`(DB 비번 불필요)

    QA 가 결함 1건(부팅 재시도 중 미저장 편집 유실)을 찾아 고쳤다.
16. **2026-10-01, 팝업 '가져오기'는 바로 교체**: 미리보기(병합/교체) 없이 이 사용자의 캘린더 행을 지우고 파일을 넣는다(한 트랜잭션, 실패하면 그대로). 누르는 순간 캘린더가 비어 있지 않으면 기존 미리보기로 넘긴다. ⋯ 메뉴 'XML 가져오기'는 미리보기를 유지한다. 교체에 성공하면 원본은 `<이름>.migrated-<날짜>` 로 이름을 바꾼다(병합은 바꾸지 않는다).
17. **2026-10-01, 루프 정비**: 루프 4종(import-ui, schema-gate, peer-frame, peer-view)의 DB 이름 하드코딩 제거(`TC_TEST_DB_NAME`). C# 러너 4종(calendar-write, peer-view, report-wiring, dryrun-xml-to-db)에 `DbErrors.cs`/`DbFault.cs` 링크. loop-offline 이 앞 루프가 남긴 접근 거부 상태를 시작 전에 푼다. 실 DB 루프 실행기 `dist/rehearsal/run-loops.ps1`(gitignore)은 **메인이 직접 돌린다**(사용자 지시).

## 3. 다음 할 일 (우선순위순)

1. **폐쇄망 개인 PC 에 v0.19.0 설치**(사용자). Setup sha256 `0ad02b32…3df8`. 순서:
    1. 0.17.1 에서 'XML 내보내기'로 안전 사본을 만든다.
    2. 설치하고 로그인한다.
    3. "이전 버전 기록을 찾았습니다"가 뜨면 '가져오기'(바로 교체)를 누른다.
    4. 공식 과제 4개의 상세, 일정, 할 일, 공수, 근태를 확인한다.

    **이관 뒤에는 `setup-taskcalendar.cmd` 를 다시 돌리지 않는다**(돌릴 때마다 대상을 지우므로 캘린더 기록이 백업 파일에만 남는다). 과제가 어제 기준이라 최신화하려면 **가져오기 전에** 한 번 더 돌린다.
2. **닫기 확인 창(A7) 사람 확인 1회**. 미저장 막대가 뜬 상태에서 위젯을 닫으면 "저장되지 않은 변경이 있습니다 …" 확인 창이 떠야 한다(Windows 기본 창이라 자동화 불가).
3. **다른 사용자 배포 전**: `widget/DeployConfig.cs` 의 `DbHost` 를 서버 PC 고정 IP 로 바꿔(지금 `localhost` 는 서버 PC 자신만) 다시 빌드한다. `latest.json` 과 Setup 을 `UpdateSourceUrl` 폴더에 올리는 것이 실배포다(빌드는 배포가 아니다). 파일럿 3~5명 뒤 확대(ROADMAP).
4. 남은 위험과 여지: 부팅 재시도의 `reloadState` 가 이미 날아간 직후 편집하면 덮일 수 있는 좁은 창(OFFLINE-RESILIENCE §10), 루프들이 DB 비밀번호를 `-p` 명령줄로 넘김(레포 규칙과 어긋나니 따로 정리), 서열 숫자 직접 입력, **코드 품질 조사 §3.4-C 보류 5건**(사용자가 필요할 때 요청).
5. **푸쉬**는 지시할 때만.

## 4. 이어서 작업하는 법

```bash
# 위젯(Debug) 빌드·기동 — 루프 시험은 CDP 9222 가 필요하다. exe 가 잠겨 있으면 먼저 프로세스를 끈다
$env:TC_DEBUG_PORT='9222'; Start-Process widget\bin\Debug\net9.0-windows\TaskCalendarWidget.exe   # PowerShell
# 엄격 게이트
TC_TEST_STRICT=1 node tests/run-tests.mjs
# 실 위젯+실 DB 루프(비밀번호는 환경변수로만 · 명령줄 -p 금지)
read -rs TC_TEST_DB_ADMIN_PW; export TC_TEST_DB_ADMIN_PW; node tests/loop-user-admin.mjs --seed=N ; node tests/loop-trash.mjs --seed=N
```

- **실 DB 회귀는 `dist/rehearsal/run-loops.ps1`**(gitignore, 메인이 직접 돌린다). 비밀번호는 stdin 첫 줄로만 넘긴다: `printf '%s\n' "$PW" | powershell -NoProfile -ExecutionPolicy Bypass -File dist/rehearsal/run-loops.ps1` (백그라운드 약 20분). 하는 일은 순서대로 개발 PC `taskcalendar` 재구축, Debug 위젯 재기동(9222), 새 기능 실화면(`cdp-check.mjs`), `taskmgr` 의 `cal_*` 복사, 루프 14종 1회와 관리자 3종×5, 두 DB schema_version 확인이다. 결과는 `dist/rehearsal/loops-<시각>.txt`. 파일이 없으면 이 줄과 git 기록(2026-10-01)으로 다시 만든다.
- **오프라인 루프** `node tests/loop-offline.mjs --seed=N`. DB 비밀번호 없이 디버그 위젯만 있으면 된다(`__dbFault` 로 장애 주입, 영속은 앱의 reloadState 로 확인).
- **배포 게이트 규약**: loop-user-admin, loop-trash 는 **무작위 시드 5회 연속 통과**. 한 번이라도 실패하면 1부터 다시. HTML 은 csproj EmbeddedResource 라 **HTML 을 바꾸면 Debug 재빌드** 후 재기동한다.
- **루프가 위젯을 재기동하는 경우**(loop-conflict-ui 등) 뒤에는 위젯이 CDP 없이 떠 있을 수 있다. 접속 실패는 결함이 아니라 재기동 신호다.
- 적대 리뷰는 `/code-review high HEAD~N` 로 diff 범위를 한정한다. 수렴 기준: 코드로 확인되는 P0, P1 0건. **결함 수정이 모듈 상태 변수를 늘리면 멈추고** 기존 배관(`hostRequest`)과 구조로 풀 수 있는지 먼저 본다. 6회차 동안 그 반대로 해서 18 → 29 가 됐고 되돌리는 데 3커밋이 들었다(USER-ADMIN §11-34~35).
- 구현 위임은 CLAUDE.md 의 dev-delegate(페이블은 설계, 게이트, 커밋. 오퍼스는 코드). 에이전트에게 파일 소유권을 나눠 주고, 위젯, 루프, 실 DB 는 메인만 만진다.

## 5. 밟으면 안 되는 것 (실제로 밟았던 것)

- **줄끝**: `widget/MainWindow.xaml.cs` 는 `\r\r\n` 다수와 **정확히 24 CRLF**, LF 0. Edit 툴이 통째로 정규화한 사례가 있으니 바이트 스크립트로 고치고 전후 카운트를 확인한다. ProjectDb.cs, prototype.html, 대부분의 tests 는 LF, `tests/harness*.mjs`, `tests/user-info.test.mjs`, `tests/README.md`, `DEPLOY.md` 는 CRLF. `git stash` 금지(워크트리 공유).
- **prototype.html 전역 치환 금지**. 임베드 base64 이미지 16블록이 깨진 적이 있다. Edit 는 고유 앵커로만 하고, 끝나면 HEAD 와 base64 동일성을 확인한다.
- **CDP 측정 스크립트가 페이지에 `window.__vt` 를 남기면 `loop-ui-visual` 이 자기 헬퍼를 안 심고 전 상태를 스킵한다**(2026-09-23 실제로 144/144 스킵). 측정 뒤 `delete window.__vt` 를 하거나 위젯을 재기동한 뒤 루프를 돌린다.
- **루프의 `el.click()` 은 포커스를 옮기지 않는다**. 포커스 보존을 재려면 `focus()` 를 먼저 부른다(C21).
- **node 인라인 문자열의 백슬래시**가 깨진다. 코드 블록은 `<<'EOF'` 히어독 파일로.
- **bash 에서 `node -e "…"` 안의 백틱과 $ 는 셸이 먹는다**(2026-09-18 실제로 깨짐). 편집 스크립트는 반드시 `<<'EOF'` 히어독 파일로 쓰고 `node file.mjs` 로 돌린다. `python3` 는 이 PC 에서 스토어 별칭이라 "Python" 만 찍고 아무것도 안 한다. 쓰지 말 것.
- **`git checkout -- <file>` / `git restore` 는 core.autocrlf=true 라 워킹트리에 CRLF 로 되살린다**(리포 blob 은 LF). 되돌린 파일은 줄끝을 바이트로 재확인하고 LF 로 되돌린다.
- **모달 CSS 의 `.hidden` 은 `!important`**. 자리를 남기고 숨기려면 `#id.hidden{display:block !important;visibility:hidden;min-height:…}` 처럼 같은 강도로 이긴다(#mbSoon).
- **mysql.exe 부하 시 stdout 소실**(문장은 실행됨). idempotent 재시도로 막는다.
- 실 DB 마이그레이션과 GRANT 는 백업(복원 검증) 후, 지시가 있을 때만.
- **Claude 데스크톱(패키지 앱)에서 띄운 프로세스는 `%APPDATA%` 가 사본 폴더**(`%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming`)다. Windows 시작 때 뜬 위젯의 진짜 로그는 `\\localhost\C$\Users\CEO\AppData\Roaming\TaskCalendar\widget.log` 로 읽어야 보인다(2026-10-01 "로그가 없다" 오진).
- **위젯 기본 DbName 을 바꾼 Debug 빌드가 자동 시작에 등록돼 있다**. 그 DB 가 이 PC 에 없으면 부팅 때 '접근 거부'(1044)가 뜬다(2026-10-01 실제). `run-loops` 가 `taskcalendar` 를 세운다.
- **C# 러너를 직접 링크하는 루프와 도구**(loop-calendar-write, loop-peer-view, loop-report-wiring, dryrun-xml-to-db)는 위젯 .cs 를 **목록으로** 묶는다. 호스트에 새 파일이나 새 의존을 넣으면 그 목록도 고친다(아니면 '러너 빌드 실패', 즉 판정 없음).
- **PowerShell 5.1 에서 `Get-Content latest.json` 은 ANSI 로 읽어** JSON 이 깨진다. `[IO.File]::ReadAllText(p, UTF8)` 를 쓴다. 깨진 채 `$null -eq $null` 로 "MATCH=True" 가 찍힌 적이 있으니 해시 대조는 64자 확인까지 한다.
- **bash 히어독 안에 백슬래시가 있는 JS 를 쓰면 깨진다**(정규식 `\s`, `\b` 가 사라지거나 백스페이스 바이트가 들어감, 2026-09-29 두 번). 편집 스크립트는 Write 툴로 파일을 만들고 `String.raw` 를 쓴다.
- 루프 순서 의존: loop-ui-integrity 의 오프라인 시나리오가 앱 계정을 잠갔다 풀면 위젯이 `conn='denied'` 로 남는다(접근 거부는 자동 재시도 안 함. 설계다). 뒤 루프는 시작 전에 [다시 시도]로 시작 조건을 맞춘다.

## 6. 문서 지도

| 무엇 | 어디 |
|---|---|
| 사용자 관리 설계, 계약, 정정 이력 §11-1~37 | docs/USER-ADMIN.md |
| 휴지통 설계, 계약, 정정 이력 §11-1~33 | docs/TRASH-DELETE.md |
| 직급·소속 관리 설계, 정정 이력 §11-1~5 | docs/ORG-TITLE-ADMIN.md |
| 코드 품질 전면 조사(규칙, 확정 목록, 남은 일) | docs/QUALITY-SWEEP-2026-09-18.md |
| 로그인과 쓰기 관문 | docs/USER-LOGIN.md |
| 배포 절차, GRANT 재적용, 백업/복구 | DEPLOY.md (§0-5, §3 체크리스트, §9) |
| 마이그레이션 순서표 | db/deploy/README.md |
| 시험 하네스, 루프 규약, 형제 폴더 전제 | tests/README.md |
| 표 설계 정본 | db/CALENDAR-TABLE-DESIGN.md, db/deploy/schema-calendar.sql |
| 검토자 보고용 스키마 | docs/DB-SCHEMA.html, db/table-design-report.html (v12) |
| 서버(DB) 연결 장애 대응 기획, 수용 기준, 결과 | docs/OFFLINE-RESILIENCE.md |
| 위키 원본(사용자 안내, 운영 진단) | docs/wiki/ (GitHub 위키로 복사) |
| 새 주 DB 구축 스크립트 | db/deploy/setup-taskcalendar.cmd/.ps1, DEPLOY.md §0-6 |
