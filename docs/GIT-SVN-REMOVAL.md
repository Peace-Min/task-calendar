# Git, SVN 기능 전량 삭제 기획

정한 날: 2026-10-26(사용자). 상태: 기획(개발 전).
사용자 결정: Git, SVN 기능은 거의 쓰지 않으므로 전부 지운다. 이미 저장된 커밋 기록은 일반 기록으로 바꾸지 않고 **전량 삭제**한다(가장 깔끔하고 공수가 적다). 과제 데이터 내보내기도 함께 고친다.

## 1. 지우는 기능 (사용자에게 보이는 것)

| 자리 | 지금 | 바뀐 뒤 |
|---|---|---|
| 하루 패널 | '커밋 내역' 탭, 커밋 불러오기(그날, 여러 날), 커밋 메시지 고치기와 지우기 | 탭 없음 |
| 달력 칩 | 커밋 기록 칩(렌치 표시) | 없음 |
| 내 과제 창 | Git 저장소, SVN 작업복사본 경로, 작성자, 자동 감지 카드 | 카드 없음(이름, 색, 설명만) |
| 보고서 | 출처 '커밋 내역' 체크, 커밋 제목이 작업 항목으로 들어감, 커밋 본문 옵션 | 커밋 없음. 일정과 할 일만 |
| 월간 보고 | 커밋을 실적에 포함(git 출처 고정) | 커밋 없음 |
| 다른 사람 일정 보기 | 상대의 커밋 내역 탭 | 없음 |
| 과제 데이터 내보내기 | 캘린더.md + 저장소에서 바로 뽑은 Git, SVN patch 파일 | 캘린더.md 만(커밋 부분 없음). 이름과 안내 문구를 고친다 |
| XML 내보내기 | 저장소 경로, 작성자, 커밋 기록, 커밋 목록 | 쓰지 않는다 |
| XML 가져오기 | 위를 읽음 | 옛 파일의 커밋 기록(source="git")과 커밋 목록, 경로, 작성자는 **읽지 않고 버린다** |
| 도움말, 사용설명서 | 커밋 내역, Git 경로 절, 설명서 'Git' 장과 그림 3장 | 지운다. 패치노트의 지난 이력은 그대로 둔다 |

같이 없어지는 죽은 코드: 일정 상세 창 `#entryModal` 은 지금 커밋 기록에서만 열린다(일반 기록은 한 화면 입력 폼). 그래서 창째 지운다. 저장소 경로는 DB 모드에서 이미 저장되지 않아(RepoPaths 쓰기 호출 없음) 반쯤 깨진 상태였다.

## 2. DB: 구조 17 에서 18 (배포 SQL 이관 조각 `v18-remove-git.sql`)

앱만 숨기면 사람마다 다음 저장 때 조금씩 지워져 끝을 알 수 없다. 그래서 구조 번호를 올리면서 한 번에 지운다. 버전 관문이 17 앱을 막으므로 지운 뒤 옛 앱이 커밋을 다시 쓰는 일은 없다.

1. `DELETE FROM cal_entry WHERE source = 'git'`: 커밋 기록 전량. 예외일과 커밋 목록은 FK CASCADE 로 함께 지워진다. 그 기록에 적은 메모, 장소, 공수도 함께 사라진다(사용자 결정).
2. `DROP TABLE cal_entry_commit`: 일반 일정에 붙어 있던 커밋 목록까지 표째 지운다.
3. `cal_entry.source` 칸과 CHECK(`'' | 'git'`)를 지운다. 1 뒤에는 모두 빈 값이다.
4. `cal_category.uses_repo` 칸과 CHECK 를 지운다.
5. `cal_user_pref` 의 `git_author`, `svn_author`, `git_commit_body` 칸과 CHECK 를 지운다.
6. 검증(information_schema) 뒤 구조 번호 18.

조각 규칙은 v15(표 지우기)를 본뜬다. 다시 돌려도 안전해야 한다(있을 때만 지움). 검증이 틀리면 닫힌 채 멈춘다. 주석에도 release-sql.ps1 이 막는 낱말(TRIGGER 등)을 쓰지 않는다.
정본 스키마(schema-calendar.sql), 권한 파일(grants-calendar.sql, server-app-account.sql 의 cal_entry_commit GRANT 줄), 시드와 데모(seed-dummy.mjs, db/demo), init-calendar.ps1 표 목록을 18 에 맞춘다. 지난 이관 스크립트(code-ids 등)는 기록이므로 손대지 않는다.

## 3. 호스트(C#)

- 파일째 삭제: `widget/Svn.cs`, `widget/RepoPaths.cs`.
- MainWindow: 명령 `gitlog`, `gitauthor`, `gitcheck`, `pickfolder`, 그리고 git 실행 함수들(GitLog, GitAuthor, GitListCommits, GitPatchOne, SvnDiff, IsGitRepo, RunGitConfig, GitResult, GitCommit)을 지운다. `exportResearch` 는 남기되 git, svn 부분을 빼고 캘린더.md 만 쓴다.
- 남기는 공용 함수: `GitReply`(모든 명령의 회신 함수. 2026-10-26 `HostReply` 로 이름을 바꿨다), `SanitizeName`, `OpenFolderSafe`, `ReplyOnUi`.
- CalendarDb, CalendarWriteDb: cal_entry_commit 읽기와 쓰기, source, uses_repo, 작성자 설정, repoPaths 인자를 지운다. 같은 배포에서 표가 없어지므로 쓰기 경로가 그 표를 건드리면 안 된다.
- `DbGate.AppStructureVersion = 18`. OfflineHost 의 RepoPaths.Load 줄 삭제.
- 사용자 PC 의 `repo-paths.json` 은 그냥 둔다(읽는 곳이 없어진다).

## 4. 웹(task-calendar-prototype.html)

- 통째로 지우는 곳: git, svn 핵심 구역(커밋 불러오기, 작성자, 저장소 카드), 커밋 탭과 그 이벤트, 일괄과 그날 커밋 창, `#entryModal`, normCommits, migrateGitMemo, mergeCommitsPreserveEdits, 커밋 전용 CSS.
- 일부만 고치는 곳: state 기본값과 load, buildStateFrom, toXML, fromXML(옛 파일은 버린다), 보고서 데이터 모음(collectReportData), 보고서 출처 저장(`tc_rptSources` 의 git 키는 무시), 월간 보고, 검색, 과제 창, 재연결, 다른 사람 일정 겹쳐 보기, 내보내기 창.
- 지우면 안 되는 것(이름만 git 처럼 보임): `.git-hint`, `.git-opt`, `.git-note`(설정, 관리, 보고서 곳곳의 안내 글), `badge-git`(퇴사, 휴지통 배지), `ICON.wrench`(날짜 메모 편집), `gitaTaskId`(기타), `#patchModal`(변경사항 창), DB 트랜잭션 commit 류.

## 5. 시험

- 삭제: `tests/vcs-branching.test.mjs`, `tests/commit-merge.test.mjs`.
- 크게 고침: app-context, global-toggles-removal, calendar-adapter, peer-view-full, loop-calendar-write, loop-peer-view, loop-import-ui, migrate-tool, dryrun-xml-to-db, code-ids-db, admin-window, 보고서 시험들의 git 픽스처.
- 시험 하네스가 `RepoPaths.cs` 를 이름으로 컴파일하는 목록(dryrun-xml-to-db, loop-calendar-write, loop-peer-view, db-project-calendar, db-schedule-image)을 고친다.
- 새 시험: v18 조각(release-sql 시뮬레이터, 정본 스키마와 같은 모양, 다시 돌리기), 남은 git 흔적 0 검사(웹, 호스트, 정본 스키마에 git/svn 기능 낱말이 다시 생기면 실패. 위 '지우면 안 되는 것'은 예외 목록), 옛 XML 가져오기에서 커밋 기록이 버려지는지.

## 6. 문서

README, USAGE, SPEC, ARCHITECTURE, DECISIONS, CALENDAR-TABLE-DESIGN, db 문서, 위키 6쪽(다른 사람 일정 보기, 일정 입력 창, 보고서 글 편집, XML 가져오기 등)에서 Git, SVN 기능 설명을 지우고, 위키에 '지운 기능' 결정 한 줄을 남긴다. CHANGELOG 와 RELEASE_NOTES 는 지난 이력을 두고 새 판에 적는다.

## 7. 순서와 배포

개발(호스트와 DB, 웹, 시험) 다음 QA(전체 strict, 실제 앱에서 하루 패널, 과제 창, 보고서, 내보내기, 다른 사람 일정 보기 확인, 구조 16과 17 복제 DB 에 v18 실행) 다음 위키.
배포는 버전 갱신 지시 때 한다(기능 삭제라 0.24.0 예정). 배포 SQL 하나에 v18 이 들어가고, 실행 전 Workbench 백업은 필수다(커밋 기록 삭제는 되돌릴 수 없다).
