# 타인 일정 고르기 개선 기획: 조직도 본인 표시와 최근 본 사람 삭제

정한 날: 2026-10-29(사용자). 상태: 구현 완료(2026-10-29, a19cbed).
앞 단계: [`PEER-PICKER.md`](PEER-PICKER.md), [`PEER-PICKER-ORG.md`](PEER-PICKER-ORG.md).

## 1. 배경

1. 예전 '구성원 보기' 입구를 없애고 상단 툴바 '👥 다른 사람 일정'의 **조직도** 탭이 조직도 역할을 겸하게 되었다. 그런데 조직도 색인(`pkOrgIndex`)과 내 부서 묶음(`pkModel`)이 본인을 빼고 계산해서, 조직도와 내 부서를 열어 봐도 **내 이름이 보이지 않고 부서 인원수도 나 자신이 빠진 숫자**로 나온다.
2. '사람' 탭의 **최근 본 사람** 목록은 명부에서 사라진 사람(퇴사 등)에게만 `✕` 지우기 단추가 나오고, 재직 중인 사람에게는 `☆`(즐겨찾기) 단추만 있어 한 번 열어 본 사람을 목록에서 지울 수 없다.

## 2. 바꾸는 것

### 2.1 조직도와 내 부서에서 본인 표시 (비활성)
- **조직도 탭(`pkOrgIndex`, `pkDirRow`, `pkUnitListEl`)**:
  - 조직별 직속 명단(`direct`)과 인원수(`count`, 왼쪽 트리 노드와 오른쪽 하위 조직 줄의 `N명`)에 **본인을 포함**한다.
- **사람 탭의 '내 부서' 묶음(`pkModel`, `pkMineSection`)**:
  - `mine` 명단과 머리말 인원수(`mineCount`, `내 부서: <조직명> N명`)에 **본인을 포함**한다.
- **본인 행 모양(`pkRowEl`)**:
  - 본인 행(`r.isMe === true`)은 예전 '구성원 보기'(`renderMembers`)와 같은 규칙으로 그린다:
    - 이름과 직급 뒤에 ` (나)` 꼬리표(`.pk-tag`)를 붙인다.
    - 누를 수 없게 비활성(`aria-disabled="true"`, 툴팁 `나 자신입니다`)으로 둔다.
    - 오른쪽 `☆`(즐겨찾기)나 `✕`(지우기) 단추는 그리지 않는다.
- **즐겨찾기, 최근 본 사람, 검색 결과**:
  - 즐겨찾기와 최근 본 사람(`pkParse`, `pkNoteRecent`, `pkToggleFav`), 검색 결과(`pkModel`의 `results`)에는 지금처럼 본인이 들어가지 않는다.

### 2.2 최근 본 사람 개별 삭제(`✕`)와 전체 지우기
- **최근 본 사람 각 행(`pkRowEl`, `kind === 'Recent'`)**:
  - 명부에 있는 사람(`!r.gone`)의 행 오른쪽에 기존 `☆`(즐겨찾기 추가) 단추와 함께 **`✕`(목록에서 지우기) 단추**(`.pk-del`, `data-act="forget"`, `data-kind="Recent"`, `data-login="<id>"`)를 나란히 둔다.
  - `✕` 단추의 `title`은 `목록에서 지우기`, `aria-label`은 `목록에서 지우기: <이름>`으로 한다(명부에 없는 사람의 지우기 단추와 동일).
  - 누르면 기존 `pkForget('Recent', loginId)`가 `localStorage`의 `tc_peerRecent:<내 login_id>`에서 해당 사람을 빼고 팝오버를 다시 그리며, 포커스는 검색 칸(`#pkSearch`)으로 돌려준다.
- **최근 본 사람 머리말 전체 지우기(`pkSection`, `pkForget`)**:
  - '최근 본 사람' 묶음 머리말(`.pk-sec-h.pk-sec-x`) 오른쪽에 **`전체 지우기` 단추**(`.pk-more`, `data-act="clear-recent"`)를 둔다.
  - 누르면 `pkForget('Recent', '')`이 `tc_peerRecent:<내 login_id>`를 비우고 팝오버를 다시 그리며, 포커스는 검색 칸(`#pkSearch`)으로 돌려준다.

## 3. 하지 않는 것

- 호스트(`widget/*.cs`)나 DB 스키마 변경 없음(`membersGet`은 이미 본인 행을 포함해 내려보낸다).
- 내 행을 눌러 내 일정을 새 열람 창으로 여는 동작(내 일정은 메인 화면에서 본다).
- 최근 본 사람 서버 동기화.

## 4. 결정

- 사용자가 정한 것(2026-10-29):
  1. 본인 표시 범위(시안 B): '조직도' 탭뿐 아니라 '사람' 탭의 '내 부서' 묶음에도 본인(`(나)`, 비활성, 인원수 포함)을 표시한다.
  2. 최근 본 사람 삭제(시안 B): 최근 본 사람 각 행 오른쪽에 `[☆] [✕]` 단추를 나란히 두고, '최근 본 사람' 머리말 오른쪽에 `전체 지우기` 단추도 둔다.

## 5. 순서

1. 기획 확정(이 문서).
2. 개발: `task-calendar-prototype.html`의 `pkModel`, `pkOrgIndex`, `pkDirRow`, `pkRowEl`, `pkSection`, `pkForget`, `pkOnClick` 수정.
3. QA: `tests/peer-picker.test.mjs`, `tests/peer-picker-org.test.mjs` 갱신 및 변이 시험 추가, 전체 strict(`TC_TEST_STRICT=1 node tests/run-tests.mjs`), 위젯 빌드 확인.
4. 위키 및 문서: `docs/wiki/다른-사람-일정-보기.md`, `docs/PEER-PICKER.md`, `docs/PEER-PICKER-ORG.md`, `CHANGELOG.md`, 인계 보고(`docs/handoff/2026-10-29-peer-org-recent.md`) 작성.
