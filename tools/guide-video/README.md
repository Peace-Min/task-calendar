# 사용 가이드 영상 녹화 도구 (이슈 #13 v3)

실제 설치형 앱과 로컬 데모 DB 로 사용 가이드 영상을 만든다. 1920x1080, 30fps, H.264(yuv420p), 무음 MP4 와 SRT 자막이 나온다.
브라우저나 가짜 호스트 응답을 쓰지 않는다. 앱 소스는 바꾸지 않는다.

## 파일

| 파일 | 역할 |
|---|---|
| `record.mjs` | 녹화기. 대본대로 앱을 CDP 로 조작하고 화면을 받아 MP4 와 SRT 를 만든다 |
| `lib/cdp.mjs` | 아주 작은 CDP 클라이언트(Node 내장 WebSocket, 추가 의존성 없음) |
| `lib/overlay.mjs` | 녹화 중에만 페이지에 넣는 겹침 층: 자막 막대, 커서, 누름 물결, 강조 테두리, 안내 카드, 굵은 짧은 문구(punch), 전면 제목 카드, 화면 확대(zoom) |
| `lib/win.ps1` | 창 도우미: 다른 사람 일정 창의 위치, PrintWindow 로 창 틀 찍기, 최대화, 이전 크기로, 닫기, 커서 PNG |
| `scripts/overview.mjs` | 홍보 영상(약 30초). 제목 카드, 빠른 장면 전환, 확대와 이동, 굵은 짧은 문구, 제품 카드 |
| `scripts/schedule-todo.mjs` | 일정과 할 일 관리(과제 유형과 과제 준비부터, 약 80초) |
| `scripts/peer-schedules.mjs` | 다른 사람 일정 보기(독립 창, 약 75초) |
| `scripts/report.mjs` | 보고서 작성(일간 작성, 글 편집, 시간, ×, 보고서 묶음, 복사, 주간 작성 폼과 차주계획, 약 100초). 전송하지 않는다 |
| `FLOWS.md` | 실제 앱에서 확인한 화면 이름, 순서, 선택자. 이슈의 가정과 다른 점 |

## 다시 만드는 법

1. 이 PC 에서 다른 세션이 위젯 루프를 돌리지 않는지 확인하고, 위젯을 모두 닫는다.
2. 데모 데이터 넣기: `db\demo\demo-db.cmd -Load` (관리자 비밀번호는 물어볼 때 입력, 자세한 것은 `db/demo/README.md`).
3. 앱을 디버그 포트로 띄운다(단일 인스턴스라 먼저 떠 있는 것은 닫는다).
   ```powershell
   $env:TC_DEBUG_PORT = '9222'
   Start-Process "$env:LOCALAPPDATA\Programs\TaskCalendar\수행과제캘린더.exe"
   ```
4. 녹화(저장소 루트에서, 하나씩, **이 순서대로**). 앞 영상이 만든 데이터를 뒤 영상이 쓰거나 보여 주므로 순서를 바꾸지 않는다.
   ```powershell
   node tools/guide-video/record.mjs tools/guide-video/scripts/overview.mjs        # 1. 홍보(만든 일정은 끝에서 지움)
   node tools/guide-video/record.mjs tools/guide-video/scripts/schedule-todo.mjs   # 2. '사내 스터디', 품질 관리 과제 연결, 일정, 할 일을 만든다
   node tools/guide-video/record.mjs tools/guide-video/scripts/peer-schedules.mjs  # 3.
   node tools/guide-video/record.mjs tools/guide-video/scripts/report.mjs          # 4. 10월 14일 시간과 보고서 임시 저장을 남긴다
   ```
   - 홍보 영상은 다른 영상이 만든 과제가 보이지 않게 데모 데이터를 넣은 직후에 맨 먼저 찍는다.
   - 보고서 영상은 클립보드를 덮어쓴다(복사 단추). 필요하면 녹화 전후에 클립보드를 따로 보관하고 되돌린다.
   - 결과: `dist/guide-video/<이름>.mp4`, `<이름>.srt`. 작업 파일과 `timeline.json`(구간, 자막 시각, 단계, 경고 토스트)은 `dist/guide-video/work/<이름>/`.
   - `--dry` 는 조작만 하고 굽지 않는다. `--keep` 은 받은 프레임(JPEG)을 지우지 않는다.
   - 녹화가 시작되면 메인 창을 최대화하고(0.22.0 창 버튼), 대본의 `prepare` 로 지난 시도의 흔적을 걷는다(일정과 할 일 대본은 '사내 스터디' 과제와 품질 관리 과제 연결을 지우고 다시 만든다).
   - 처음 녹화할 때 브라우저 저장소(localStorage)를 `dist/guide-video/work/localStorage.backup.json` 에 백업하고, 실제 이름이 남는 '최근 본 사람', 즐겨찾기를 비운다.
5. 끝나면 되돌린다.
   ```powershell
   node tools/guide-video/record.mjs --restore-local     # 브라우저 저장소를 백업대로(일치를 확인하면 백업 파일 삭제)
   ```
   메인 창 최대화를 풀고(창 오른쪽 위 단추) 앱을 닫는다. 다른 사람 일정 창의 크기 기억(`%APPDATA%\TaskCalendar\widget.settings.json` 의 `Peer`)은 녹화 때 바뀌므로 필요하면 앱을 닫은 뒤 되돌린다.
6. DB 되돌리기: 위젯을 닫고 `db\demo\demo-db.cmd -Restore`.

## 어떻게 찍나

- 화면: CDP `Page.startScreencast`(JPEG 92) 로 받은 프레임을 받은 시각대로 이어 붙이고 ffmpeg 로 30fps 고정으로 바꾼다. 메인 창 웹 영역(최대화 1920x1032, 배율 1)은 위아래 24px 띠를 붙여 1920x1080.
- 다른 사람 일정 창(PeerWindow, CDP 대상 url `peerwin=1`)이 앞에 있는 동안은 그 대상의 화면을 받는다. Windows 창 틀과 제목줄은 웹 밖이라 PrintWindow 로 찍어, 그 순간의 메인 창 화면 위 실제 자리에 합친다.
  최대화, 이전 크기로, 닫기는 Win32(ShowWindow, WM_CLOSE)로 실행하고, 그 단추를 가리키는 커서와 파란 테두리는 굽기 때 그린다. 창 상태가 바뀌는 순간과 창이 뜨는 동안(약 1초)은 잘라 낸다.
- 겹침 층은 `Runtime.evaluate` 로 넣고 끝나면 걷는다. 모두 `pointer-events:none` 이라 실제 클릭(CDP `Input.dispatchMouseEvent`)을 막지 않는다. 녹화 중에는 앱 토스트를 자막 위로 올려 보이게 한다.
- 네이티브 `<select>`(과제, 시간)는 목록 창이 따로 떠서 화면 받기에 안 잡힌다. 커서와 물결로 가리킨 뒤 값을 바꾸고 change 이벤트를 보낸다.
- 회사 사이트 전송 방지(두 겹)
  - 대본 검사: 조작 필드(sel, js, text, if, value, to, select 의 label)에 `#btnRptSend`, `netcus`, `주간보고 작성`, `일간보고 전송`, netcus 출처 단추(`data-rsrc=net|week`), 로그아웃이 있으면 시작하지 않는다. 자막, 카드 글, 강조(highlight)와 커서 이동(move)의 선택자는 누르지 않으므로 검사하지 않는다(단추를 가리키며 설명할 수 있다).
  - 누르기 직전 검사: 클릭, 끌기, 글 칸 누르기 전에 그 자리의 요소(`elementFromPoint`)를 다시 보고 `#btnRptSend`, 글자가 '주간보고 작성', '일간보고 전송', '로그아웃' 인 단추, netcus 출처 단추면 멈춘다. Enter 와 Space 는 초점이 그 단추에 있으면 보내지 않는다.
- 열람 창은 닫을 때의 최대화 여부를 기억한다. 대본에 `resetPeer: '<login>'` 을 주면 녹화 전후에 녹화 밖에서 그 사람 창을 한 번 열어 최대화를 풀고 닫는다(다음 영상이 처음 크기로 열리게).
- 단계 뒤마다 오류, 경고 토스트를 확인해 `timeline.json` 의 `warnings` 에 남긴다.

## 대본 형식

`export default (env) => ({ name, title, prepare, cleanup, closePeerAfter, steps })`. `env.today`, `env.day`(오늘에서 3일쯤 뒤의 평일, 새 일정용).

단계 `act`: `click`, `type`(`text`, `replace`, `commit`: 끝나고 change 보내기, `noClick`, 줄바꿈은 `\n`), `select`(`label`), `move`, `wheel`(`dy`, `times`), `scrollTo`, `highlight`(`label`, `all`, `ms`), `unhighlight`, `card`(`html`, `ms`),
`caption`, `wait`, `waitFor`(`js`), `js`, `toPeer`(열람 창으로 넘어감), `os`(`op`: maximize, restore, close), `cut`(`do`: 녹화 없이 실행할 단계 목록, 장면 전환).
v3 에서 더한 것: `zoom`(`sel` 이나 `rect`, `scale`, `ms`, `reset`, `pad`. body 에 transform 을 걸어 다시 그리므로 글자가 선명하다), `punch`(`text`, `sub`, `where`. `*글자*` 는 강조색),
`title`(전면 제목 카드 `html`, `ms`, `keep`), `setValue`(날짜 칸처럼 펼침 창이 따로 뜨는 입력), `caret`(글 칸에서 `after` 글자가 있는 줄 끝을 눌러 글자 커서를 둠), `drag`(`sel` 에서 `to` 까지 포인터로 끌기, `ms`, `steps`).
공통: `cap`(자막, 한 줄), `punch`(굵은 문구), `n`(단계 번호), `pre`, `post`, `if`.
대본의 `pace` 로 속도를 정한다(없으면 v2 값). v3 대본: 커서 350~500ms ease-out, 입력 글자당 약 30~40ms, 자막 최소 1.6초(`capMin`), 짧은 대기.
선택자: CSS, 끝에 `::text(글자)` 로 글자 거르기, `A >> B` 로 그 안의 B, 앞에 `frame:` 이면 열람 창 안 달력(iframe).

## 제작 안내 서식

`dist/guide-video/제작안내.md` 를 만들 때 아래 항목을 채운다.

```
# 수행과제 캘린더 사용 가이드 영상 v3 제작 안내
## 결과물        파일, 길이, 해상도와 프레임, 자막 파일
## 촬영 환경      앱 버전과 설치 경로, DB(판번호, 데모 데이터 넣은 날과 기준 날짜), 녹화 계정 권한, 화면 크기
## 가상 데이터    무엇이 가상인지(사람, 발주처, 공식 과제, 장소, 일정과 할 일), 녹화 중 새로 만든 것
## 보여 주지 않은 것  회사 보고 전송, 관리자 전용 기능, 그 밖
## 실제 앱과 다른 점  편집으로 생긴 차이(잘라 낸 구간, 합성한 창 틀, 네이티브 목록)
## 검증 목록      ffprobe, 전체 디코딩, 프레임 확인, 경고 토스트, 이름 확인, 정리 상태
```
