# 주간보고 같은 주 중복 방지: 기존 글 수정으로 열기 (WEEKLY-UPSERT)

> 작성 2026-10-08. 호스트(C#, `widget/NetcusService.cs`) 변경. 웹은 문구 정도. 스키마 변경 없음(판번호 12).
> 짝 문서: [WEEKLY-EDIT.md](WEEKLY-EDIT.md)(주간 글 편집). 같은 브랜치(feat/weekly-edit) 위에서 작업한다.
> 이 문서는 구현 전 설계다. 구현하며 달라지는 곳은 맨 아래 정정 이력에 적는다. 본문과 정정 이력이 다르면 정정 이력이 맞다.

## 1. 문제와 요구 (2026-10-08 사용자)

- "주간보고 작성"은 매번 회사의 새 글 작성 화면(`pjm_write.jsp`)을 열어 채운다. 같은 주에 두 번 누르고 저장하면 같은 기간 글이 두 개 생긴다(예: 10/8 과 10/9 에 각각 올리면 그 주 글이 둘).
- 요구: 같은 기간의 주간보고 글이 이미 있으면 **새 글이 아니라 그 글의 수정 화면**을 열어 채운다.
- 사용자 확인: 제출된 글도 수정 버튼이 있다(수정 가능).

## 2. 회사 사이트 사실 (사용자가 붙여 준 HTML, 2026-10-08)

- 보기 화면 `pjm_view.jsp`: `go_modify(n)` 는 `document.form.action='pjm_modify.jsp?list=go&start=1&view_no='+n; submit()`. 숨은 칸 `word_code, n_code, s_code, c_code, table_code=report_tbl, id` 가 빈 `<form>` 밖에 형제로 있다(기존 `go_view` 재현과 같은 사정).
- 수정 화면 `pjm_modify.jsp`:
  - 칸 이름은 새 글 화면과 같다: `ndate, iscompletion, sdate, edate, subject, html(체크), endwork, content, notendwork, planwork, problem, resultwork`. **추가로 `wdate`(작성일, 예 `2026/10/02 17:50`) 숨은 칸이 있다.**
  - 기존 값이 미리 채워져 나온다(미처리사항, 문제점, 회의내용 포함).
  - 저장 함수 `Bmodify(iscompletion)`: 기간과 제목 검사, `y` 이면 "제출하시겠습니까?" 확인, `document.form.action='pjm_modify.jsp?go=write&table=report_tbl&view_no=<n>&id=<id>'; submit()`. 버튼은 임시저장(`n`), 재입력, 취소, 제출(`y`).
  - `<form name="form" enctype="multipart/form-data" method="post"></form>` 이 비어 있고 칸이 밖에 있다. 새 글 화면의 `Bwrite` 처럼 빈 폼을 보낼 위험이 있어 같은 방식의 안전한 대체가 필요하다.

## 3. 흐름

`NetcusWeekFill`(주간보고 작성) 안에서, 로그인과 목록 열기 다음에:

1. **기존 글 찾기**: 내 주간보고 목록에서 기간이 요청 기간(`sdate ~ edate`)과 **정확히 같은** 글을 찾는다.
   - 지금 `NetcusWeeklyRangeRead` 가 하는 목록 순회(`RowExtractJs`, `GoListJs`, `GoViewJs`, `CellExtractJs`, `NcPeriod`)를 공용 함수로 떼어 쓴다. `NetcusWeeklyRangeRead` 의 동작과 회신은 바꾸지 않는다.
   - 후보는 작성일이 `sdate-7 ~ edate+14` 인 글(기존 사전 필터와 같은 성격, 같은 주를 며칠 뒤 다시 올리는 경우를 위해 뒤쪽을 조금 넓힘). 최신순 목록이므로 페이지 전체가 창보다 오래되면 멈춘다. 열람 상한을 둔다(예 20).
   - 기간 문자열은 보기 화면의 기간 칸에서 읽어 `NcPeriod` 로 파싱한다. 시작과 끝이 둘 다 같아야 같은 글이다.
2. **찾았으면**(하나 이상): 글 번호가 가장 큰(가장 최근) 글의 수정 화면을 연다. `pjm_modify.jsp?list=go&start=1&view_no=<n>` 로 숨은 칸(`table_code=report_tbl, word_code, n_code, s_code, c_code, id`)을 실은 동적 POST(기존 `goWrite` 와 같은 방식).
   - 진행사항(`endwork`), 과제투입시간(`content`), 차주계획(`planwork`) **셋만** 채운다. 기간, 제목, 작성일, 미처리사항, 문제점, 회의내용, HTML 체크는 건드리지 않는다.
   - `Bmodify` 를 안전한 버전으로 바꿔 끼운다: 원본과 같은 검사와 확인창, euc-kr multipart 동적 폼, 칸 `iscompletion, ndate, wdate, sdate, edate, subject, endwork, content, notendwork, planwork, problem, resultwork`(+ 체크된 `html`), action `pjm_modify.jsp?go=write&table=report_tbl&view_no=<n>&id=<id>`. 페이지의 원래 `Bmodify` 소스에 `pjm_modify.jsp?go=write` 가 있는지 로그로 남긴다(구조 변화 감지).
   - 결과 문구(성공): `"주간보고 이번 주 기존 글을 고치는 화면으로 열었습니다. 진행사항, 과제투입시간, 차주계획을 채웠으니 확인 뒤 열린 창에서 임시저장이나 제출을 누르세요."` 같은 기간 글이 2개 이상이면 뒤에 `" 같은 기간 글이 n개 있어 가장 최근 글을 열었습니다. 나머지는 회사 화면에서 지워 주세요."` 를 붙인다. **성공 문구는 반드시 `"주간보고 "` 로 시작한다**(웹의 `RPT_WEEKFILL_OK_RE` 가 이걸로 주간 회신을 가른다). 새 문구에는 엠 대시를 쓰지 않는다.
3. **없으면**: 지금처럼 새 글 작성 화면을 열고 채운다(기존 코드와 문구 그대로).
4. **찾는 중 실패**(목록이나 보기 화면을 못 읽음, 세션 만료, 예외): 새 글을 열지 않고 `NetcusResult(false, "기존 주간보고를 확인하지 못했습니다. 다시 시도하세요.")` 로 멈춘다(확인 없이 새 글을 열면 다시 중복이 생긴다). 창은 기존 실패 경로처럼 정리한다.
5. 두 경우 모두 성공 뒤 `_host.SaveWeeklyReport(...)` 를 지금처럼 부른다(DB 에는 앱이 채운 내용).

## 4. 지켜야 할 것

- **대화상자 자동 수락**(`AttachDialogAutoAccept`)은 사용자에게 넘기는 문서(수정 화면 또는 새 글 화면)를 불러오기 **전에** 반드시 끈다(기존 주석: 로드 시점 스냅샷, 떼면 제출 confirm 이 죽는 문제). 목록과 보기 화면을 읽는 동안에는 켜 둬도 된다.
- 찾는 동안은 창이 보이므로 진행 문구를 띄운다(`NetcusProgress("기존 주간보고 확인 중…")`, `NetcusStatus("weekfill", "checking")` 등). 웹이 모르는 상태 값이면 웹 쪽 표시도 맞춘다.
- `_ncBusy` 가드, 자격증명 검사, 로그인 실패 경로, 창이 닫혔을 때의 중단 처리는 기존과 같게.
- 기존 시험이 찾는 글자(report-wiring ④ 와 변이④ 의 `_host.SaveWeeklyReport(req.Sdate, …req.Planwork);` 줄, 성공 문구 `"주간보고 작성 폼을 채웠습니다 …"` 의 앞부분, report-edit S4 와 SM12 가 보는 문구 머리)는 유지한다.
- 실제 회사 사이트에 저장하는 시험은 하지 않는다.

## 5. 시험

- 회사 사이트를 쓰지 않는 범위에서 최대한:
  - **jsdom 행동 시험**: 수정 화면과 같은 구조의 가짜 HTML(빈 form, 형제 칸, 같은 이름, `wdate`, 미리 채운 미처리사항 등. 실제 사람 이름이나 회사 데이터는 넣지 않는다)을 만들고, 호스트가 실행하는 채우기 JS 와 `Bmodify` 대체 JS 를 그대로 돌린다. 세 칸만 바뀌고 나머지(특히 `wdate`, 미처리사항, 문제점, 회의내용, 기간, 제목)가 그대로인지, 대체 `Bmodify('n')` 가 만든 폼의 action 과 칸 목록과 값이 맞는지(`form.submit` 은 가로챔), `Bmodify('y')` 가 확인창을 거치는지 본다. 이를 위해 C# 안의 JS 조각을 시험이 꺼낼 수 있는 꼴(상수나 생성 함수, 표지 주석)로 둔다.
  - **선택 규칙 시험**: 같은 기간 판정(시작과 끝 모두 일치), 여러 개면 가장 큰 글 번호, 기간 파싱 실패는 같은 글로 보지 않음. 가능하면 순수 함수로 떼어 시험한다(C# 은 기존 시험들이 C# 을 컴파일해 돌리는 방식이 있으면 그것을, 없으면 정적 시험).
  - **정적 계약 시험**: 찾는 중 실패면 새 글 화면을 열지 않음, 성공 문구가 `"주간보고 "` 로 시작, 사용자 문서 로드 전 자동 수락 해제, 수정 경로에서 기간/제목/작성일/세 칸을 채우지 않음, `SaveWeeklyReport` 가 성공 뒤에 있음, `NetcusWeeklyRangeRead` 회신 계약 그대로. 변이 시험 포함.
- 실 위젯 루프는 회사 사이트를 쓰지 않는 기존 루프만 돈다(전체 회귀).
- **사용자 확인(수동)**: 이번 주 글이 이미 있는 상태에서 "주간보고 작성" 을 눌러 수정 화면이 열리고 세 칸만 바뀌며 나머지가 남는지, 임시저장으로 같은 글이 고쳐지는지(새 글이 생기지 않는지) 한 번 확인.

## 6. 위키

- "보고서 회사 전송" 주간 절과 "보고서 글 편집" 주간 절에 한 줄: 같은 기간 글이 있으면 그 글의 수정 화면이 열린다, 중복이 있으면 가장 최근 글, 확인 실패면 멈춘다.

## 정정 이력

(구현 중 달라진 점을 여기에 적는다.)

### 2026-10-08 구현(호스트)

- **자리**: 순수 부분(고르기 `NcPickSameWeek`, 성공 문구 `WeekModifyOkMsg`, 실패 문구 `WeekLookupFailMsg`, JS 생성 `GoModifyJs`, `WeekModifyProbeJs`, `WeekModifyFillJs`, `WeekModifyOverrideJs`, `ListPageMarkJs`)은 `widget/NetcusText.cs` 에 두었다. 시험이 이 파일을 그대로 컴파일해 돌린다. 목록 순회는 공용 `NcCrawlWeekly`, 같은 기간 글 찾기는 `NcFindSameWeek`, 수정 경로는 `NetcusWeekFill` 안의 로컬 함수 `OpenModify` 다(자동수락 detach 는 그 메서드의 지역 변수라 수정 화면 로드 직전에 같은 자리에서 끊어야 한다).
- **`NetcusWeeklyRangeRead`**: 순회만 `NcCrawlWeekly` 로 옮겼다. 창(from-7 ~ to+7), 상한(40 페이지, 60 건), 오류 코드, 회신 모양, 포함 규칙, 진행 상태, 상한 로그 문장은 그대로다.
- **성공 문구**: "이번 주" 대신 "같은 기간에 이미 있는 글" 로 썼다. 지난주 보고를 채울 때도 맞는 말이 되게. 머리 `"주간보고 "` 와 중복 안내는 설계 그대로다.
- **확인 실패로 보는 경우를 넓혔다**(모두 새 글을 열지 않고 `WeekLookupFailMsg` 로 멈춘다): 요청 기간을 못 읽음, 보기 화면의 기간 칸이 비어 있음(못 읽은 글은 같은 기간일 수 있어 건너뛰지 않는다), 목록 행이 0 인데 목록 표지(`go_view`, `go_list` 함수 또는 `table_code` 칸)도 없음, 열람 상한(20)이나 페이지 상한(40)에 닿았는데 같은 글을 못 찾음. 상한에 닿았어도 같은 글을 찾았으면 그 글로 간다. 기간을 읽었는데 형식이 다른 글은 설계대로 같은 글로 보지 않는다. 글 번호를 못 읽은 글도 고르지 않는다.
- **확인 실패 때 창**: 로그인 실패 경로처럼 닫는다(읽던 목록이나 보기 화면을 남기지 않는다).
- **수정 화면 여는 순서**: 실제 흐름(보기 화면, 수정 버튼)대로 고른 글의 보기 화면을 먼저 열고, 자동수락을 끈 뒤 `pjm_modify.jsp?list=go&start=1&view_no=<n>` 으로 POST 한다. 찾기 중 보기 화면을 열었는데 같은 글이 없으면 목록으로 다시 이동한 뒤 새 글 경로를 그대로 탄다(예전처럼 목록에서 출발).
- **수정 화면 확인**: 칸 7개(`sdate, edate, wdate, subject, endwork, content, planwork`)가 다 있어야 수정 화면으로 본다(`wdate` 로 새 글 화면과 가른다). 열린 글의 기간이 요청과 확실히 다르면 창을 닫고 멈춘다(형식을 못 읽으면 로그만 남기고 진행).
- **안전판 순서**: `Bmodify` 대체를 채우기보다 먼저 끼운다. 못 끼우면 창을 닫고 멈춘다. 원래 `Bmodify` 는 빈 폼을 보내 기존 글을 빈 값으로 덮을 수 있어서다. 원래 소스의 `pjm_modify.jsp?go=write` 표지는 `ok sig=1` 또는 `ok sig=0` 으로 로그에 남긴다.
- **새 실패 문구**: "주간보고 수정 화면을 찾지 못했습니다. 로그인 또는 페이지 접근을 확인하세요.", "열린 수정 화면의 기간이 요청한 기간과 달라 채우지 않았습니다. 다시 시도하세요.", "주간보고 수정 화면을 준비하지 못했습니다. 페이지 구조가 바뀌었을 수 있습니다.", "주간보고 수정 화면 채우기 실패. 페이지 구조가 바뀌었을 수 있습니다." 진행 문구: "기존 주간보고 확인 중…", "기존 주간보고 여는 중…".
- **웹은 고치지 않았다**: 웹의 `__netcusStatus` 는 원래 `weekfill` 상태를 모두 무시하고(진행바는 merge, weekly 만) 진행은 `NetcusProgress` 문구로 보인다. 새 상태 `checking` 도 같은 길로 문구만 보인다.
- **시험**: 새 `tests/weekly-upsert.test.mjs`(C# 컴파일 실행, jsdom 가짜 수정 화면, 정적 계약과 변이). 기존 시험 둘을 고쳤다. `report-wiring` ④ 는 고정 창(앞 12000자) 대신 멤버 본문에서 `OpenModify` 앞(새 글 경로)만 본다(수정 경로의 저장 호출을 새 글 경로의 것으로 잘못 집지 않게). `netcus-dialog` 의 인계 목록(`HANDOFF_LOADS.week`)에 수정 화면 로드를 더하고 변이 ⑨b, ⑨c 를 넣었다.

### 2026-10-08 검토 뒤 보완

1. **안전판이 보내는 칸**: 고정 목록(11칸)을 버렸다. 파서가 칸을 빈 `form` 에 묶었으면(`form.elements` 가 비어 있지 않으면) `form.elements` 에서, 아니면 문서의 이름 있는 `input, textarea, select` 전부에서 모은다. 원래 `Bmodify` 가 보냈을 모르는 숨은 칸도 빠지지 않게 하려는 것이다. 빼는 것은 disabled, file, button, submit, reset, image, 체크 안 된 checkbox, radio, 앞서 만든 우리 폼 안의 칸이다. `iscompletion` 은 인자로 바꿔 싣고 없으면 덧붙인다. textarea 는 textarea 로 옮긴다. action, 검사, 확인창은 그대로다. 안전판 반환에 `form=1|0` 과 모은 칸 이름(값은 빼고)을 실어 로그에 남긴다(일간의 form-assoc 진단과 같은 목적).
2. **내 글만 고른다**: 보기 화면에 수정 단추(onclick 이나 href 에 `go_modify`, 또는 `input[name=mo]`)가 있어야 고를 수 있는 글이다. `CellExtractJs` 가 `mod` 표지를 함께 돌려주고(주간범위 읽기 회신은 그대로), `NcPickSameWeek` 는 표지 없는 글을 기간이 같아도 고르지 않는다. 그런 글 수는 로그에 따로 남긴다.
3. **덮어쓰기 안내와 근거**: 성공 문구에 "진행사항, 과제투입시간, 차주계획 세 칸은 캘린더 내용으로 바뀌었습니다." 와 "저장하지 않고 창을 닫으면 회사 글은 그대로입니다." 를 넣었다(머리 `"주간보고 "` 그대로). 채우기 전에 세 칸의 원래 글자 수만 로그로 남긴다(내용은 남기지 않는다).
4. **수정 화면 확인 실패**: 다른 실패 경로처럼 창을 닫는다. 확인 JS 는 일곱 칸이 각각 정확히 하나씩 있어야 수정 화면으로 본다.
5. **시험 보강**: 페이지 상한에 닿았는데 못 찾은 것을 "없음" 으로 읽게 바꾸는 변이(`finished` 를 늘 참으로)를 잡는 시험을 더했다.

## 결함 수정: 목록 순번을 글 번호로 쓴 문제 (2026-11-05)

> 브랜치 fix/weekly-modify-viewno. 호스트(C#)와 시험만 바꾼다. 웹, DB 구조, 새 글 경로(`Bwrite`), 주간범위 읽기(`NetcusWeeklyRangeRead`) 회신은 그대로다.
> 범위 밖: 앱 DB 저장 시점(`SaveWeeklyReport` 를 회사 제출 성공 뒤로 옮길지)은 사용자가 아직 정하지 않았다. 이번에 손대지 않는다.

### 1. 원인 (2026-11-05 실제 회사 화면과 widget.log 로 확인)

- 회사 주간보고 목록의 링크 `go_view(n)` 의 `n` 은 **목록 순번**이다. 보기 화면에 "현재 1 / 총 163 건" 이 보이고, 이전과 다음 링크도 `go_view("2")` 같은 순번이다. 글 고유 번호가 아니다.
- 진짜 글 번호는 보기 화면 `pjm_view.jsp` 의 버튼 줄에만 있다. 수정 버튼은 `<input type="button" name="mo" value="수정" onclick="javascript:go_modify('39438')">` 꼴이고, 답장(`go_reply('39438','39431','0','0')`), 출력(`go_print('39438')`), 제출(`name=report`, `go_end('39438')`) 버튼도 같은 번호를 쓴다. 보기 화면의 `go_modify(loc)` 는 `pjm_modify.jsp?list=go&start=1&view_no='+loc` 로 빈 `<form name="form">` 을 보낸다(숨은 칸 `word_code, n_code, s_code, c_code, table_code=report_tbl, id` 는 폼 밖 형제). 삭제 버튼은 화면에 없다(`go_delete` 함수만 남아 있고 쓰지 않는다). 제출된 글은 제출 버튼이 없을 수 있다. 수정 버튼(`name=mo`)이 내 글 표지다.
- 위젯은 `RowExtractJs` 가 뽑은 목록 순번(`viewNo`)을 그대로 글 번호로 썼다. `OpenModify` 가 `GoModifyJs(hit.ViewNo, id)` 와 `WeekModifyOverrideJs(hit.ViewNo, id)`(대체 `Bmodify` 의 action `view_no`)에 순번을 넣어 `pjm_modify.jsp?view_no=1` 로 엉뚱한(없는) 글을 열었다. 기간, 작성일, 네 칸이 모두 빈 수정 화면이 나왔고, 사용자가 제출하자 회사 서버가 "수정하는데 실패하였습니다" 를 냈다.
- 로그 근거: `netcus(week) 수정 화면: view_no=1, 기간  ~ , 작성일 ` 와 원래 길이 `{endwork:0,content:0,planwork:0,resultwork:0}`.
- 둘째 결함: `OpenModify` 는 수정 화면의 기간을 못 읽으면(`NcDate` 실패) 로그만 남기고 채우기로 넘어갔다. 기존 글의 수정 화면이면 기간이 반드시 있으므로, 빈 기간은 잘못 열린 화면이다.
- 덤으로 드러난 것: `NcPickSameWeek` 는 "글 번호가 가장 큰 글" 을 골랐는데 실제로는 순번이 가장 큰 글, 곧 **가장 오래된** 같은 기간 글을 골랐다(목록은 최신이 1).
- 기존 시험이 못 잡은 까닭: 가짜 화면과 고르기 시험이 목록의 `go_view(n)` 과 보기 화면의 `go_modify(n)` 을 같은 번호로 두었다(B11 은 `go_modify(101)`, 고르기 표는 번호 하나). 2026-10-08 에 받은 회사 HTML 은 수정 화면뿐이라 순번과 글 번호가 다르다는 사실을 시험이 몰랐다.

### 2. 결정

1. **번호를 둘로 나눈다.** 같은 주 글 후보마다 목록 순번(보기 화면을 여는 `GoViewJs` 용)과 진짜 글 번호(수정 화면 `GoModifyJs` 와 대체 `Bmodify` 의 action 용)를 따로 담는다. 순회(`NcCrawlWeekly`)와 그 중복 막기(`seenViews`), 주간범위 읽기는 지금처럼 순번으로 돈다.
2. **진짜 번호는 보기 화면의 수정 버튼에서 읽는다.** `CellExtractJs` 가 `mod` 대신 `modNo` 를 돌려준다. 찾는 곳은 `input[name=mo]` 의 `onclick` 이 먼저, 없으면 `[onclick*=go_modify]`, `a[href*=go_modify]` 의 `onclick` 이나 `href`. 그 문자열에서 `go_modify\(\s*['"]?(\d+)['"]?\s*\)` 의 숫자를 뽑는다. 문서 안 `onclick`, `href` 의 `go_modify(` 숫자가 서로 다르면 모호하므로 `""` 로 둔다. 숫자를 못 뽑으면 `""`.
3. **진짜 번호를 못 읽은 글은 고칠 수 없는 글로 센다.** 지금의 `mod` 표지(수정 단추 유무)를 `modNo` 하나로 합친다. onclick 이 없는 `input[name=mo]` 만 있는 글도 고칠 수 없는 글이다. 이런 글은 지금처럼 `locked` 로 세고 고르지 않는다. 기간이 같은 내 글인데 번호만 못 읽은 경우도 locked 로 빠져 새 글 경로로 간다. 이때는 로그(`locked`)로 남는다. 구조가 바뀌면 중복 글이 생길 수 있는 위험을 받아들이고, 남의 번호나 없는 번호로 덮어쓰는 사고를 막는 쪽을 고른다.
4. **"가장 최근 글" 은 진짜 글 번호가 가장 큰 글이다.** 글 번호는 글을 만들 때 매겨져 늘어난다(예: 답장 버튼의 부모 번호 39431 < 39438). 순번은 최신이 작아서 큰 순번을 고르면 가장 오래된 글이 된다. 같은 진짜 번호가 두 번 나오면(순회 중 목록이 밀린 경우) 한 글로 센다(`matches` 는 서로 다른 글 번호 수).
5. **고른 글을 다시 연 보기 화면에서 번호를 맞춰 본다.** `OpenModify` 가 `GoViewJs(hit.ViewNo, id)` 로 보기 화면을 연 뒤 `CellExtractJs` 를 다시 돌려 `NcModifyNo(cell.modNo)` 가 `hit.ModifyNo` 와 같은지 본다. 순회와 여는 사이에 새 글이 올라오면 순번이 밀리기 때문이다. 다르거나 못 읽으면(자동수락을 끄기 전, 읽기 문서) 창을 닫고 아래 문구 ㄱ 으로 멈춘다. 같으면 지금처럼 자동수락을 끈 뒤 `GoModifyJs(hit.ModifyNo, id)` 로 수정 화면을 연다.
6. **수정 화면 기간이 비었거나 못 읽으면 채우지 않는다.** `NcParseModifyProbe` 다음, `msd` 나 `med` 가 `NcDate` 로 안 읽히면 창을 닫고 아래 문구 ㄴ 으로 멈춘다(안전판, 채우기 모두 하지 않는다). 요청 기간은 `NcFindSameWeek` 가 이미 확인했으므로 비교는 엄격하게 한다. 기간을 읽었는데 요청과 다를 때의 기존 멈춤과 문구("열린 수정 화면의 기간이 요청한 기간과 달라 채우지 않았습니다. 다시 시도하세요.")는 그대로다.
7. **새 실패 문구.** `"주간보고 "` 로 시작하지 않는다(성공 회신 머리 규칙. 근태 창은 지금 `ok` 값으로 가르지만 시험 A10, C3 의 규칙을 지킨다). 금지 기호 없음. 둘 다 `NetcusText.cs` 의 상수로 둔다(시험이 컴파일해 본다).
   - ㄱ `WeekViewMismatchMsg`(보기 화면 번호 불일치): "고를 기존 글이 목록에서 바뀌어 채우지 않았습니다. 다시 시도하세요."
   - ㄴ `WeekModifyBlankMsg`(수정 화면 기간 빔): "기존 글의 수정 화면이 비어 있어 채우지 않았습니다. 회사 화면에서 글을 확인한 뒤 다시 시도하세요."
8. **로그.** 찾기 끝 로그의 `고를 글 view_no=` 를 `고를 글 순번=1, 글 번호=39438` 꼴로 바꾼다. 수정 화면 로그는 `netcus(week) 수정 화면: 글 번호=39438(순번 1), 기간 ... ~ ..., 작성일 ...`. 보기 화면 맞춰 보기가 틀리면 `netcus(week) 보기 화면 글 번호 불일치: 기대 39438, 읽음 <x>(순번 1)`.

### 3. 바꿀 것 (파일과 함수)

- `widget/NetcusText.cs`
  - `NcCell`: `mod` 를 `modNo` 로 바꾼다(주간범위 읽기는 이 칸을 쓰지 않는다). `NetcusService.cs` 의 `NcParseCell` 도 `modNo = G("modNo")` 로.
  - `CellExtractJs`: `mod:` 를 `modNo:` 로. 결정 2 의 규칙대로 숫자 문자열이나 `""`.
  - 새 순수 함수 `internal static string NcModifyNo(string? raw)`: 숫자만으로 된 1 ~ 18 자리이고 0 보다 크면 앞 0 을 뗀 숫자 문자열, 아니면 `""`(공백, 기호, 글자가 섞이면 `""`). JS 가 이미 숫자만 주지만 C# 에서 한 번 더 막는다.
  - `NcPickSameWeek`: 입력을 `(string seq, string period, string modNo)` 로, 반환을 `(string seq, string no)` 튜플로. 순번은 지금처럼 숫자이고 0 보다 커야 한다(보기 화면을 열어야 한다). `NcModifyNo(modNo)` 가 `""` 면 locked. 고르기는 글 번호(long)가 가장 큰 것. `matches` 는 서로 다른 글 번호 수.
  - 상수 `WeekViewMismatchMsg`, `WeekModifyBlankMsg`(결정 7 원문).
  - `GoModifyJs`, `WeekModifyOverrideJs` 는 동작 그대로(인자 이름만 `postNo` 로 바꿔 뜻을 드러낸다).
- `widget/NetcusService.cs`
  - `NcSameWeek`: `ViewNo`(순번, 이름 유지) 옆에 `ModifyNo`(진짜 글 번호)를 더한다. `Ok` 기본값 false 그대로.
  - `NcFindSameWeek`: `found.Add((viewNo, cell.period, cell.modNo));`, 고르기 결과를 `res.ViewNo`, `res.ModifyNo` 에 둘 다 넣는다(하나라도 비면 둘 다 비운다). 실패면 둘 다 비운다. 로그는 결정 8.
  - `OpenModify`: 결정 5(보기 화면 번호 맞춰 보기), `GoModifyJs(hit.ModifyNo, id)`, `WeekModifyOverrideJs(hit.ModifyNo, id)`, 결정 6(빈 기간 멈춤), 결정 8 로그. 자동수락 끊는 자리와 `await wv.ExecuteScriptAsync(goModify);` 줄은 그대로(인계 계약 `HANDOFF_LOADS.week`).
  - `NcCrawlWeekly`, `NetcusWeeklyRangeRead`, 새 글 경로는 고치지 않는다.

### 4. 시험 계획 (`tests/weekly-upsert.test.mjs`)

- **C# 실행(프로브)**: 프로브 입력을 `(seq, period, modNo)` 세 문자열로, 출력은 `{seq, no, matches, locked}`. 고르기 표를 다시 쓴다.
  - 순번과 글 번호가 다르다: `[['1', P, '39438']]` 이면 `seq='1', no='39438'`.
  - 여러 개면 글 번호가 가장 큰 글(순번은 가장 작은 글): `[['3', P, '39100'], ['1', P, '39438'], ['2', P, '39300']]` 이면 `seq='1', no='39438', matches=3`. 옛 규칙(순번 최대)이면 `seq='3'` 이라 갈린다.
  - 글 번호를 못 읽은 글(`''`, `'abc'`, `'0'`)은 locked, 기간이 같아도 고르지 않는다(번호가 더 큰 순번이어도).
  - 같은 글 번호가 두 번(순번 1 과 2) 나오면 `matches=1`.
  - 기존 규칙 그대로: 시작만 같음, 끝만 같음, 기간 못 읽음, 요청 기간 못 읽음, 순번 못 읽음, 후보 없음.
  - `NcModifyNo`: `'39438'` 이면 `'39438'`, `'039438'` 이면 `'39438'`, `''`, `'0'`, `'12a'`, `' 1 '`, 19자리 이상이면 `''`.
  - 새 문구 둘이 원문 그대로이고, `"주간보고 "` 로 시작하지 않고, 금지 기호가 없다.
- **jsdom(가짜 보기 화면)**: 실제 구조대로 만든다. 빈 `<form name="form" method="post"></form>`, 그 밖 형제 숨은 칸(`word_code, n_code, s_code, c_code, table_code=report_tbl, id`), 라벨 표(기간, 제목, 작성일, 진행사항, 과제투입시간, 차주계획), "현재 1 / 총 9 건" 줄과 `go_view("2")` 이전/다음 링크, 버튼 줄 `mo`(`javascript:go_modify('70001')`), `re`(`javascript:go_javascript:go_reply('70001','70000','0','0')`), `pr`(`go_print('70001')`), `report`(`go_end('70001')`), 그리고 `go_delete` 함수만. 이름과 내용은 지어낸 값만 쓴다.
  - 번호 읽기: `CellExtractJs` 의 `modNo` 가 `'70001'`(이전/다음의 순번 `2` 나 답장의 `70000` 이 섞이지 않는다).
  - 제출 버튼(`name=report`)이 없는 화면(제출된 글): 여전히 `'70001'`.
  - 수정 버튼이 없는 화면(남의 글): `''`. 링크형 `<a href="javascript:go_modify('70001')">` 만 있는 화면: `'70001'`. onclick 없는 `input[name=mo]` 만 있는 화면: `''`. 서로 다른 `go_modify` 번호가 둘인 화면: `''`.
  - 기존 B11 은 `mod` 를 `modNo` 로 바꿔 위 항목으로 옮긴다.
  - B8 보강: `GoModifyJs('70001', ...)` 의 action 이 `view_no=70001`, 대체 `Bmodify('n')` 의 action 도 `view_no=70001`.
- **정적 계약과 변이**
  - 새 C12: `OpenModify` 안에 `GoModifyJs(hit.ModifyNo, id)` 와 `WeekModifyOverrideJs(hit.ModifyNo, id)` 가 있고 `GoModifyJs(hit.ViewNo` 와 `WeekModifyOverrideJs(hit.ViewNo` 는 없다. `GoViewJs(hit.ViewNo, id)` 는 남는다. 변이 CM19: 둘 중 하나를 `hit.ViewNo` 로 되돌리면 C12 가 잡는다.
  - 새 C13: 수정 화면 확인 뒤, 안전판(`WeekModifyOverrideJs`)과 채우기(`WeekModifyFillJs`)보다 앞에 `!NcDate(msd, ...) || !NcDate(med, ...)` 검사 블록이 있고 그 안에 창 닫기, `NetcusResult(false, WeekModifyBlankMsg);`, `return;` 이 있다. 변이 CM20: 그 블록의 `return` 을 빼거나 검사를 옛 조건(둘 다 읽혔을 때만 비교)으로 되돌리면 C13 이 잡는다.
  - 새 C14: `GoViewJs(hit.ViewNo, id)` 뒤, `detach?.Invoke(); detach = null;` 앞에 `CellExtractJs` 다시 읽기와 `hit.ModifyNo` 비교가 있고, 다르면 창을 닫고 `NetcusResult(false, WeekViewMismatchMsg);` 뒤 `return;`. 변이 CM21: 비교를 지우면 C14 가 잡는다.
  - C2 고칠 곳: `found.Add((viewNo, cell.period, cell.modNo));` 를 보고, `res.ModifyNo` 를 채우는지 본다. CM16 은 `cell.modNo` 를 고정 숫자 문자열로 바꾸는 변이로 고친다.
  - A13, A14(C# 변이): "가장 큰 글 번호" 를 "가장 큰 순번" 으로 바꾸면 여러 개 사례가 갈린다(A13 에 더함). 번호 검사를 빼면 locked 사례가 갈린다(A14 를 `modNo` 기준으로).
  - C9(금지 기호)의 문구 목록에 새 상수 두 개를 넣는다.
  - `tests/netcus-dialog.test.mjs` 의 `HANDOFF_LOADS.week` 는 고치지 않고 그대로 통과해야 한다(`await wv.ExecuteScriptAsync(goModify);` 줄 유지, 새 보기 화면 읽기는 detach 앞).
- 개발 중에는 한 파일 시험만 돌린다(`weekly-upsert`, `netcus-dialog`, `report-wiring`). 전체 strict 는 메인이 마지막에 한 번 돌린다.
- **사용자 확인(수동, 폐쇄망)**: 이번 주 글이 있는 상태에서 근태 주간보고를 보내면 widget.log 에 `고를 글 순번=1, 글 번호=<5자리>` 와 `수정 화면: 글 번호=<같은 번호>(순번 1), 기간 <요청 기간>` 이 남고, 수정 화면에 기존 기간과 작성일이 보이며, 임시저장이 성공하는지 본다.

## 임시저장까지 하고 [인트라넷에서 확인] (2026-11-06 사용자 확정)

지금은 앱이 회사 글(새 글 화면 또는 기존 글 수정 화면)을 채운 뒤 창을 사용자에게 넘기고, 사용자가 직접 임시저장이나 제출을 누른다. 사용자 결정: **임시저장까지 앱이 누르고, 일간보고처럼 창은 닫고, 주간 편집 화면 아래에 [인트라넷에서 확인] 링크만 둔다.** 제출(`y`)은 지금처럼 사용자가 인트라넷에서 한다.

### 흐름(일간 전송 `NetcusSubmit` 과 같은 모양)
1. 지금처럼 로그인, 같은 기간 글 찾기, 새 글 화면 또는 수정 화면 열기, 채우기, 안전한 `Bwrite`/`Bmodify` 끼우기.
2. **임시저장**: 끼운 함수를 `n` 으로 부른다(`Bwrite('n')`, `Bmodify('n')`). 확인창은 `y` 일 때만 뜨므로 `n` 은 묻지 않는다. 이 문서는 이제 사용자에게 넘기는 문서가 아니므로, 저장이 끝날 때까지 대화상자 자동 수락을 켜 둔다(회사 서버가 저장 뒤 알림 창을 띄워도 멈추지 않게).
3. **되읽기 확인**: 저장 뒤 자동 수락을 끄고(detach), 같은 기간 글 찾기(`NcFindSameWeek`)로 그 글을 다시 찾아 보기 화면의 진행사항에 보낸 한글 토큰(`NetcusHangulNeedle`)이 있는지 대조한다. 일간의 되읽기와 같은 규칙(로그인 화면이면 세션 만료, 못 찾으면 실패, 한글 불일치면 깨짐 의심).
4. **성공**: `_host.SaveWeeklyReport(...)` 를 부르고(지금처럼 앱이 채운 내용, composed_at), 결과 문구 `"주간보고 임시저장을 마쳤습니다. 제출은 인트라넷에서 하세요."`(같은 기간 글이 여럿이었으면 지금처럼 덧붙임). 성공 문구는 반드시 `"주간보고 "` 로 시작(웹 `RPT_WEEKFILL_OK_RE`). 확인용 창을 닫는다.
5. **실패**: 창을 남겨(되읽기 문서, 자동 수락은 이미 꺼짐) 사용자가 눈으로 확인하게 하고, 실패 문구를 돌려준다. DB 에는 쓰지 않는다. 임시 저장(이 PC)은 웹이 지우지 않는다.

### [인트라넷에서 확인] (주간 편집 화면)
- 일간 근태 창 하단의 [인트라넷에서 확인](`#atIntra`, `netcusViewMonth`)과 같은 모양, 같은 자리(주간 편집 화면 하단 왼쪽). 새로 그리지 않고 그 단추 모양과 상태 문구("인트라넷 여는 중…")를 재사용한다.
- 보이는 때: 위젯이고, 그 주를 이 앱으로 쓴 기록이 있을 때(주간 목록의 작성 표시와 같은 조건).
- 새 호스트 명령 `netcusViewWeek {sdate, edate}`(근태 창 허용 목록에 더함): 로그인, 같은 기간 글 찾기, 찾으면 그 글의 **보기 화면**을 열어 창을 사용자에게 보인다(읽기만: 저장, 제출, 값 넣기 없음). 못 찾으면 주간보고 목록을 연다(`marked:false`). 다른 회사 작업 중이면 `busy`. 회신 모양은 `netcusViewMonth` 와 같게(`ok`, `error`, `marked`).
- 이 창은 사용자에게 넘기는 문서이므로 로드 전에 자동 수락을 끈다(인계 계약, `tests/netcus-dialog.test.mjs` 의 `HANDOFF_LOADS` 에 새 지점).

### 바뀌는 계약과 시험
- `HANDOFF_LOADS.week`: 새 글 화면과 수정 화면은 더 이상 인계 문서가 아니다. 인계 지점은 되읽기 문서(실패 때만 남음)와 `netcusViewWeek` 의 보기 화면이다. 시험을 새 계약으로 고친다(지우지 않는다).
- `report-wiring`, `report-edit`, `weekly-upsert` 가 보는 성공 문구 머리, `SaveWeeklyReport` 줄은 새 문구와 위치에 맞춘다.
- 웹: 주간 편집 화면 성공 처리(문구, 창을 닫는 것은 호스트), [인트라넷에서 확인] 보이기 조건과 누름(`netcusViewWeek`), 허용 목록.
- C# 순수 함수 시험(가짜 화면): 저장 호출이 `n`, 되읽기 대조 세 경우, 실패 때 DB 미기록.
- **실제 회사 사이트에 저장하는 시험은 하지 않는다.** 폐쇄망 사용자 확인: 이번 주 글이 없을 때와 있을 때 각각 주간보고를 보내면 창이 닫히고 성공 문구가 뜨며, 인트라넷 목록에 임시저장 글이 하나만 있고, [인트라넷에서 확인]이 그 글의 보기 화면을 연다. widget.log 에 저장 뒤 되읽기 결과가 남는다.
- 위키: 근태 주간 보고(보내기 설명, [인트라넷에서 확인]).

### 2026-11-06 구현 기록

**정한 것**
- **흐름**: `NetcusWeekFill` 의 새 글 경로와 `OpenModify`(수정 경로)가 둘 다 공용 로컬 함수 `SaveAndVerify(wv, modify, expectNo, matches)` 로 끝난다. 저장(`WeekTempSaveJs(modify)` = 끼운 `Bwrite('n')` 또는 `Bmodify('n')`) → 저장 뒤 2초 더 기다림(알림 뒤 다른 화면으로 옮겨 가는 경우) → 목록 → `NcFindSameWeek(..., upToToday: true)` → 그 글의 보기 화면 → `CellExtractJs` 로 진행사항과 수정 단추 글 번호를 읽어 `NcWeekVerify` 로 판정 → `vr == 1` 이면 `NetcusResult(true, WeekSavedOkMsg(matches))`, `SaveWeeklyReport`, 창 닫기. 아니면 `NetcusResult(false, WeekVerifyMsg(vr))` 와 창 남김(기록 없음).
- **대화상자 자동 수락**: `AttachDialogAutoAccept(cw, "week")` 는 로그인 전에 붙이고, 새 글 화면(`goWrite`)과 수정 화면(`goModify`) 로드 앞의 detach 두 곳을 없앴다. 끄는 곳은 `SaveAndVerify` 안, 되읽기 찾기가 끝난 뒤 사용자에게 남을 수 있는 문서(그 글의 보기 화면 `GoViewJs(again.ViewNo, id)`, 못 찾으면 목록 `GoListJs(1, id)`)를 로드하기 직전 한 곳이다. 끄는 순간의 문서(마지막으로 읽은 목록이나 보기 화면)는 곧바로 떠난다. 그래서 켜진 채 로드된 문서에서 끄고 그 문서를 사용자에게 넘기는 일(붙였다 떼기)이 없다.
- **켜진 채 로드된 문서는 넘기지 않는다**: 저장 전 실패(작성 폼 못 찾음, 채우기 실패, `Bwrite` 대체 실패, 수정 화면 쪽 실패들, 임시저장 JS 가 `SUBMITTED` 가 아님)는 모두 창을 닫는다. 예전에는 새 글 화면의 채우기 실패 등에서 창을 남겼다. 예외 경로도 아직 붙어 있으면(`detach != null`) 창을 닫는다. finally 는 예전처럼 detach 만 한다(실패 때 되읽기 문서를 남겨야 하므로 창은 닫지 않는다).
- **되읽기 판정 `NcWeekVerify`**(NetcusText.cs, 순수 함수): -1 로그인 화면, -2 다시 못 찾음이나 보기 화면 번호가 고른 번호와 다름이나 수정 경로인데 다른 글, 0 진행사항 빔, 1 정상, 2 한글 토큰 불일치, -3 저장 중 회사 알림에 "실패"(`NcSaveAlertFailed`). 보낸 진행사항이 비었으면 빈 칸을 정상으로 본다. 토큰은 일간과 같은 `NetcusHangulNeedle(req.Endwork)`.
- **수정 경로 대조 토막(보강)**: 수정 화면에서 채우기 전에 기존 진행사항을 읽어 두고(`WeekModifyOldEndworkJs`, 로그에는 남기지 않음), 대조 토막을 `NcWeekNeedle(새 글, 기존 글)` = 새 진행사항에는 있고 기존 진행사항에는 없는 한글 토막(2 ~ 4자)으로 고른다. 그런 토막이 없으면(같은 글을 다시 보냄, 새 글이 옛 글의 일부) 변경 없음으로 보고 회사 실패 알림(-3)만 본다. 새 글 경로는 예전처럼 첫 한글 토막. 시험 A22(토막 표), A17 수정 경우 넷, A23(변이), B16.
- **회사 실패 알림 모으기**: 수정 경로는 예전 글에도 같은 한글 토큰이 있을 수 있어(같은 내용을 다시 보냄) 되읽기만으로는 저장 실패를 못 가린다. 그래서 자동 수락 핸들러가 저장 구간에만 알림 문구를 `_dlgSeen` 에 모으고, "실패" 가 있으면 -3 으로 본다(2026-11-05 사고의 "수정하는데 실패하였습니다" 같은 경우).
- **새 글 `Bwrite` 대체**: 보낼 때 만드는 폼에 `data-tc-week="1"` 을 단다(수정 화면 `Bmodify` 대체와 같다). 임시저장 JS 는 이 표지 폼이 생겼는지로 실제로 보냈는지 본다(`NOFN` 함수 없음, `NOFORM` 기간이나 제목 검사에서 멈춤). 대체를 못 끼우면 이제 멈춘다(예전에는 로그만 남겼다).
- **새 호스트 명령 `netcusViewWeek {sdate, edate}`**(`NetcusViewWeek`, 자동 수락 tag `viewweek`): busy, 자격, 로그인 실패 회신은 `netcusViewMonth` 와 같다. 로그인 뒤 목록, `NcFindSameWeek`(창은 보내기 전 찾기와 같은 sdate-7 ~ edate+14), 찾으면 그 글의 보기 화면, 못 찾으면(없음, 확인 실패, 세션 만료 모두) 목록 1쪽. `marked` 는 열린 보기 화면의 수정 단추 글 번호가 찾을 때 번호와 같을 때 true. 마지막 로드 직전마다 detach 한다(두 갈래라 detach 도 두 곳). 창 보이기는 `ShowW2ForUser(title)` 로 떼어 `NetcusViewMonth` 와 같이 쓴다.
- **문구**(NetcusText.cs): `WeekSavedOkMsg(matches)` 성공, `WeekSaveFailMsg` 임시저장 못 누름, `WeekVerifyMsg(vr)` 되읽기 실패 넷. 실패 문구는 "주간보고 " 로 시작하지 않는다. `WeekModifyOkMsg` 는 쓰는 곳이 없어 지웠다.
- **웹**: 주간 편집 하단 왼쪽(`#awMsg` 다음)에 `#awIntra`(클래스 `at-lnk`, `#atIntra` 와 같은 단추). 일간 처리를 공용 `intraBtnRender(b, show, opening, locked)` 와 `intraOpen(cmd, payload, st, render, say)` 로 떼어 두 단추가 같이 쓴다. 보이는 조건은 `HOST && AWE.p && AWE.p.saved`(그 주 DB 기록, 목록의 완료 표시와 같은 원천. `__reportWeeklySaved` 가 오면 `awSentRender` 가 다시 그린다). 보내는 중과 가져오는 중에는 잠근다. 허용 목록(웹 `ATTENDWIN_CMD`, 호스트 `AttendWinCommands`)에 `netcusViewWeek` 를 더해 열이 됐다.

**기획과 다르게 정한 것**
- **detach 시점**: 기획은 "저장 뒤 자동 수락을 끄고 같은 기간 글 찾기" 였다. 구현은 되읽기 찾기(목록과 보기 화면 읽기)까지 켜 두고, 사용자에게 남을 문서를 로드하기 직전에 끈다. 찾기 도중 회사 화면의 알림이 기본 대화상자로 떠서(보이는 창) 되읽기가 사람 손을 기다리며 멈추지 않게 하려는 것이고, 끄는 순간의 문서는 곧바로 떠나므로 계약(넘길 문서는 로드 전에 끈다)은 그대로다.
- **되읽기 찾기 창**: 방금 쓴 글의 작성일은 오늘이라, 지난 주를 2주 넘게 늦게 보내면 설계 창(edate+14)에 들지 않는다. 되읽기만 창 끝을 오늘까지 늘렸다(`upToToday`). 보내기 전 찾기와 `netcusViewWeek` 는 그대로다.
- **회사 실패 알림(-3)**: 기획에 없던 판정이다(위 "회사 실패 알림 모으기").
- **웹 `RPT_WEEKFILL_OK_RE`**: 지금 웹에는 이 정규식이 없다(보고서 창과 함께 사라졌다). 주간 회신은 근태 창이 보낸 요청(`AWE.armed`)인지로 가르고, `awOnNetcusResult` 는 받은 문구를 그대로 안내 줄에 쓴다. 성공 문구 머리 규칙("주간보고 ")은 호스트 시험(weekly-upsert A10, C3)으로 계속 지킨다. 웹은 기본 문구와 주석, `#awSend` 툴팁만 고쳤다.

**시험**: `weekly-upsert`(A10 새 성공 문구, A17 되읽기 판정 표 12건, A18 실패 문구, A19 알림 판정, A20 임시저장 JS 는 `n` 만, A21 C# 변이 셋, B13 ~ B15 jsdom 임시저장, C3, C5, C8, C9, C14 새 계약, C15 저장과 되읽기 계약, 변이 CM10, CM22 ~ CM25), `netcus-dialog`(`HANDOFF_LOADS.week` 를 되읽기 두 문서로, `viewweek` 지점 추가, 저장 구간 자동 수락 유지 검사, 켜진 채 로드된 문서를 넘기지 않음 검사, viewweek 읽기만, 변이 ⑨ ~ ⑨e), `report-wiring` ④(기록은 되읽기 성공 뒤 한 곳), `attendance-host`(허용 목록 열, 기록 한 곳, `netcusViewWeek` 배선과 읽기만), `attendance-web`(허용 목록), `attendance-weekly-web`(새 성공 문구, `#awIntra` 보이기와 누름, 변이 W6), `user-login` D1, E7(공유 로그인 호출부가 주간보고 보기까지 여덟). 실제 회사 사이트에 저장하거나 여는 시험은 하지 않았다.

**폐쇄망 사용자 확인 목록**
1. 이번 주 글이 **없을 때** 주간 [보고]: 확인용 창이 떴다가 닫히고 "주간보고 임시저장을 마쳤습니다. 제출은 인트라넷에서 하세요." 가 뜬다. 인트라넷 목록에 그 주 글이 하나, 상태가 임시저장이다.
2. 이번 주 글이 **있을 때** 다시 [보고]: 같은 결과이고 목록의 그 주 글이 여전히 하나다(새 글이 생기지 않는다). 진행사항이 새 내용으로 바뀌었다.
3. widget.log 에 `netcus(week) 임시저장 fire: SUBMITTED`, `임시저장 nav: True`, `netcus(week) 되읽기: 1 (글 번호 <번호>, 읽음 <같은 번호>, ...)` 이 남는다. 저장 뒤 회사 알림이 있었다면 `netcus(week) alert: <문구>` 와 `알림 n건` 이 함께 남는다(그 문구를 알려 주면 실패 판정 규칙을 맞춘다).
4. 편집 화면 아래 **인트라넷에서 확인** 이 그 주 글의 보기 화면을 연다(읽기만). log 에 `netcus 주간보고 보기: 글 번호 <번호>(순번 n), 읽음 <같은 번호>`.
5. 인트라넷에서 제출(`y`)을 직접 눌러 확인창이 정상으로 뜨고 제출되는지 본다(보기 화면은 자동 수락을 끈 뒤 로드한 문서다).
6. (가능하면) 2주 넘게 지난 주를 보내 되읽기가 성공하는지.
