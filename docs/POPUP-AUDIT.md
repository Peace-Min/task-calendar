# 팝업 공용 리소스 조사 (2026-11-02)

상태: 기록만. 공용화 작업은 하지 않기로 했다(2026-11-02 사용자: 사용자 이득이 없다). 모든 팝업에 최대화를 넣게 되면 그때 이 조사로 공용화부터 한다. 팝업을 새로 만들거나 고칠 때는 그 팝업만 공용 골격으로 맞춘다.

## 공용인 것

- 모달 37개 모두 `.overlay > .modal` 바탕. 열기 `openModal`, 닫기 `closeOverlay`, Esc(전역 처리), 바깥 클릭과 `[data-close]` 위임, 포커스 가두기와 복귀, 배경 inert(`setupModalA11y`, `_modalStack`).
- 확인 창 `confirmBox`(#confirmModal), `confirmTyped`(#confirmTypedModal), 토스트 `toast`(#toastWrap). 브라우저 기본 confirm, alert 는 쓰지 않는다.
- 좁은 화면(440px 이하) 아래 시트 전환, 열고 닫힐 때 움직임.

## 따로 만든 것

- 머리 골격이 다른 곳: `quickAdd`, `pcFormModal`(`.qa-head`), `categoryModal`(닫기 `.cat-x`), `rptGroupModal`(× 없음). `pcChangesModal` 은 본문이 `.pcc-body`.
- 크기를 세 방식으로 따로 정함:
  - 인라인 style: catMoveModal, catEditModal, rptGroupModal, updNotesModal, legacyModal, gvAskModal, confirmModal, confirmTypedModal.
  - ID 선택자: #catAddModal, #officialModal, #reportModal, #gvModal, #guideModal(사용자가 끌어 바꾸는 크기), #adminHub.
  - 전용 클래스: .qa-modal, .pcf-modal, .pcc-modal, .pcm-modal, .ah-modal.
- 닫을 때 처리를 공용 함수에 이름으로 박아 둔 곳: `closeOverlay` 안의 reportModal, orgTitleModal, gvModal, adminHub, docked 분기, 전역 Esc 의 메뉴 목록(#moreMenu, #themeMenu, #jumpMonth), `isGuardedModal` 의 id 4개.
- `.overlay` 밖 겹침: shotViewer, loginGate, vgGate, peerWin(창 껍데기).
- 팝오버 14종은 공용 함수 없이 각자(위치 계산, 바깥 클릭, Esc): ⋯ 메뉴와 테마 메뉴, 연월 점프, 과제 필터, 다른 사람 고르기, 과제 날짜 목록, 좁은 창 과제 목록, 시각 고르기, 장소 목록, 내 과제 ⋯, 공식 과제 순서 ⋯, 보고서 묶음 ⋯, 근태 과제 추가, 주간 과제 추가, 주간보고 주 고르기, 근태 칸 툴팁.

## 최대화를 넣게 되면

- 단추 자리: `setupModalA11y`(모든 .overlay 를 한 번 돈다) 에서 머리의 닫기 앞.
- CSS 한 규칙(`.overlay.max > .modal` 100%)은 인라인과 ID 크기를 못 이긴다. 크기를 공용 등급(작음, 보통, 넓음, 아주 넓음)으로 먼저 옮긴다.
- 위젯에서는 제목줄(#hostbar 32px) 아래만 채운다(`body.host .overlay.max{top:32px}`, 선례 vgGate).
- 빼는 곳: 확인 창 2종, 도킹된 창, 관리 창의 허브(이미 100%), 440px 이하 시트.
- 크기 기억: 넓은 작업 화면끼리만 마지막 상태 공유, 작은 입력 팝업은 늘 원래 크기(UX 검토, 2026-11-02).
