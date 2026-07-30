# 사용자 로그인 · DB 접근 관문 — 확정 설계 (USER-LOGIN)

작성 2026-07-28 · 기준 v0.15.0 · 상태 **확정** (구현 착수 전 기준 문서)

> 이 문서는 두 번의 구현 실패 뒤에 쓰였다. 로그인 커밋 8개를 전부 날리고
> `release: v0.15.0` 에서 재시작한다. **§5 폐기된 설계**를 먼저 읽으면
> 이 문서의 모든 "하지 마라"가 왜 있는지 이해된다.
>
> 검증을 통과한 일부 코드는 태그 `backup/login-attempt-20260728` 에서 회수한다(§2.6).

---

## 1. 확정 요구 (사용자 원문 기준 — 이것이 판정 기준)

1. **"처음에 로그인 팝업부터 뜨고 로그인에 성공하면 캘린더로 진입한다.**
   **위젯은 PC에서 한번 로그인하면 사용자가 로그아웃 or 캘린더 자체적인 업데이트로 인한
   일괄 로그아웃 전까지 로그인을 유지한다."**
2. **"로그인 성공하면 로그인된 정보로 보고서에서 별도로 로그인 요청을 하지 않는다."**

핵심 해석 — **"시작 시 로그인" ≠ "시작마다 인증"**:

```
위젯 시작
  └ 저장된 세션이 있고 앱 버전이 같은가?
      예   → 회사 시스템(netcus)에 접속하지 않고 즉시 캘린더 진입   ★ 창·네트워크 0
      아니오 → 로그인 팝업 (최초 1회 / 로그아웃 후 / 업데이트 후)
로그인 성공 → 세션 저장 + netcus 자격 저장(valid:true) → 캘린더 진입
로그아웃    → 세션·자격 둘 다 삭제 → 로그인 팝업
앱 업데이트 → 저장된 앱 버전 ≠ 현재 → 세션 폐기 = 일괄 로그아웃
보고 전송   → 로그인 때 저장한 자격을 그대로 사용. 재인증·재입력 없음
```

인증 = netcus 로그인 성공 여부(회사가 판정) · 인가 = `taskmgr.app_user` 조회(이름·소속·권한).
그래서 이 시스템에는 **비밀번호 저장 외 비밀번호 개념이 없다**(`app_user` 에 비밀번호 컬럼 없음).

---

## 2. 로그인 설계

### 2.1 저장물 — 파일 2개, 그 이상 만들지 마라

| 파일 | 내용 | 형식 |
|---|---|---|
| `<dataDir>/user.session` | `{loginId, name, title, orgUnit, viewScope, editRole, appVersion, savedAt}` | JSON → UTF8 → **DPAPI(CurrentUser)** → Base64 |
| `<dataDir>/netcus.cred` (기존) | `{id, pw:<DPAPI Base64>, valid:true}` | 기존 포맷 그대로 |

- 세션을 DPAPI로 감싸는 이유: 평문이면 `loginId` 한 줄만 고쳐 **남의 신원**이 된다.
- `netcus.cred` 는 보고 전송이 이미 쓰는 파일이다. **같은 계정이므로 두 벌 만들지 않는다.**
  로그인 성공 시 `valid:true` 로 쓰면 보고 전송이 다시 묻지 않는다(요구 2가 이걸로 성립).
- 저장은 **쓴 뒤 되읽어 확인한 경우에만 성공으로 보고**한다. 실사용에서
  "저장 성공 로그 + 파일 그대로"인 거짓 성공이 실제로 관측됐다.

### 2.2 호스트 메시지 계약 — 3개, 실패 코드 없음

```
userSessionGet {reqId}            부팅 시 1회. 세션 파일만 읽는다. ★ netcus 접속 절대 금지
  → {ok:true, user:{loginId,name,title,orgUnit,viewScope,editRole}} | {ok:false}

userLogin {reqId, id, pw}         인증(netcus) → 인가(app_user) → 저장 2개
  → {ok:true, user:{…}} | {ok:false, msg:"…"}

userLogout {reqId}                세션·자격 둘 다 삭제
  → {ok:true}
```

- **실패 `code` 필드를 만들지 마라.** 이전 구현은 code 7종을 만들었지만 JS가 분기하는 곳이
  0곳이었다 — 죽은 복잡도. 화면은 `msg` 를 그대로 보여주면 된다.
- `userLogin` 내부 순서와 msg(모두 이 문구 그대로):
  1. id/pw 비면 → `"ID와 비밀번호를 입력하세요."`
  2. netcus 인증 실패 → `"로그인하지 못했습니다 — ID/비밀번호 또는 사내망 연결을 확인하세요."`
     (자격 불일치와 사이트 접속 불가를 구분할 신호가 없다. 단정하면 오프라인에서 거짓 안내가 된다)
  3. `app_user` 조회: 연결 실패 → `"DB에 연결하지 못했습니다."` /
     행 없음 → `"사용자 정보가 등록되어 있지 않습니다. 관리자에게 문의하세요."` /
     `is_active=0` → `"비활성 처리된 계정입니다."`
  4. 저장 2개(세션 + 자격). **둘 다 성공해야 ok:true.** 하나라도 실패하면 **둘 다 삭제**하고
     `"로그인 정보를 이 PC에 저장하지 못했습니다 — 다시 시도하세요."`
     (반쪽 상태 금지: 세션만 있으면 보고 전송이 깨지고, 자격만 있으면 유령 상태가 된다)
- netcus 작업 진행 중(`_ncBusy`)이면 인증을 시도하지 말고 즉시
  `"다른 회사 시스템 작업이 진행 중입니다 — 잠시 후 다시 시도하세요."`
  (이전 구현은 이를 "ID/비밀번호를 확인하세요"로 오표시했다)
- **비밀번호는 로그·회신·예외 메시지 어디에도 싣지 않는다.**

### 2.3 게이트(로그인 팝업) UI 규칙

- **첫 프레임부터 게이트가 떠 있어야 한다.** 부팅 스크립트에서 HOST 이면 **동기적으로**
  게이트를 "로그인 확인 중…" 상태로 표시하고, `userSessionGet` 이 세션을 복원한 경우에만 내린다.
  복원 실패/세션 없음 → 폼 모드 전환.
  (이전 구현은 비동기 회신 *뒤에* 게이트를 달아서, 캘린더와 실데이터가 먼저 보였다)
- **`.overlay` 클래스를 절대 쓰지 마라.** 공통 오버레이는 배경클릭·ESC·모달스택 닫기 대상이라
  차단이 뚫린다. 전용 클래스(`position:fixed; inset:0`, **불투명** `var(--bg)`, z-index 300).
- 닫기(×)·ESC·바깥클릭 경로를 만들지 않는다. 단 **「위젯 종료」 버튼은 필수** —
  게이트가 호스트바(닫기·트레이)를 덮으므로 이게 없으면 Alt+F4 말고는 나갈 수 없다.
  `hpost({cmd:'close'})` 직접 배선(호스트바의 data-host 위임은 바 안쪽만 듣는다).
- **포커스 격리 필수**: 게이트 표시 중 `#loginGate`·`#toastWrap` 제외 전부에 `inert`+`aria-hidden`.
  전역 단축키 핸들러도 게이트 표시 중 조기 return.
  (이전 구현은 Shift+Tab 몇 번으로 덮개 뒤 버튼이 눌려 로그인 없이 저장까지 됐다)
- **재진입 가드**: 버튼 `disabled` + JS 플래그 둘 다(Enter 키 경로는 disabled 로 안 막힌다).
- **브라우저 단독(HOST=false)은 게이트를 절대 띄우지 않는다.** SOP 로 netcus 로그인이
  원천 불가라, 차단하면 영구히 잠긴다. `if(!HOST) return;` 이 부팅 함수 첫 줄.
- DB·호스트에서 온 값(이름·직급·소속·msg)은 **textContent 또는 esc()** 로만 화면에 넣는다.

### 2.4 설정창

- 「계정」 섹션: 로그인 상태면 이름+직급·소속·로그아웃 버튼. 권한(viewScope/editRole)은
  **표시하지 않는다**(추후 '열람' 기능에서 다룸 — 사용자 결정).
- **netcus 자격증명 입력란(ncId/ncPw/ncSave)은 제거한다.** 자격 출처가 로그인 하나가 되면
  "세션은 나, 보고는 남" 불일치가 **구조적으로 불가능**해져 교차검증 코드가 필요 없다.
  섹션 자체는 상태 표시(어느 ID로 저장돼 있는지)만 남긴다.
- 관리자 섹션(`#adminSection`)은 **그대로 둔다**(2단계에서 edit_role 로 대체하며 통째로 삭제 예정).

### 2.5 하지 않는 것 (전부 이번에 실제로 만들었다가 문제가 된 것들)

| 하지 않는 것 | 이유 |
|---|---|
| 부팅 시 `app_user` 백그라운드 재조회 | 설정창 이름 표시를 갱신하는 30줄이 로그아웃과 경합해 **삭제된 세션을 되살렸다**. 이름 변경은 다음 로그인에 반영되면 충분 |
| 세대 토큰·경합 방어 | 위가 없으면 경합 자체가 없다 |
| 실패 code 분류 | §2.2 — 분기하는 곳이 없다 |
| 퇴사자·비활성 주기 검사 | 사용자 결정(B안). 퇴사자는 재로그인이 원천 불가하고, 차단해도 보호되는 로컬 데이터가 없다. **쓰기 시점 검사로 충분**(§3.3에서 공짜로 해결) |
| 게이트 뒤 앱 렌더 차단 | 불투명 게이트+inert 로 충분. 데이터는 어차피 이 PC 로컬 것 |

### 2.6 회수 가능한 검증 완료 코드

태그 `backup/login-attempt-20260728` 에 적대적 검증(25건 탐지→반증→8건 확정)을 **결함 0으로
통과한** 부품이 있다. 새로 짜지 말고 회수하라:

```bash
git show backup/login-attempt-20260728:widget/UserSession.cs           # 148줄 — 결함 0
git show backup/login-attempt-20260728:widget/ProjectDb.cs             # LoadAppUserJsonAsync 부분만
git show backup/login-attempt-20260728:widget/NetcusService.cs         # LoginVerify/SaveCredsForLogin/ClearCredsForLogout
```

| 부품 | 내용 | 회수 시 주의 |
|---|---|---|
| `UserSession.cs` 통째 | DPAPI 왕복·버전 불일치 폐기·되읽기 검증 | `Save` 가 성공 bool 을 반환하도록만 손볼 것(§2.2-4) |
| `LoadAppUserJsonAsync` | 파라미터 바인딩·3분기 반환(행 JSON / `"{}"` / null) | 그대로 |
| `LoginVerify` | **`EnsureW2(background: true)`** + 기존 `NetcusLoginVerify` 재사용 | 그대로 |
| `SaveCredsForLogin` | `valid:true` 직접 기록(재검증 미트리거) | **(bool ok, string msg) 반환으로 변경**(§2.2-4) |

**결함은 전부 배선(MainWindow 핸들러 163줄 + HTML 159줄)에 있었다. 배선은 회수하지 말고
이 문서 계약대로 새로 써라. 목표: 배선 합계 150줄 안팎** (이전 322줄).

---

## 3. DB 접근 관문 (ProjectDb)

### 3.1 문제와 결정

`ProjectDb` 는 메서드 18개가 **각자** `new MySqlConnection(BuildConnString())` 을 연다(19곳).
쓰기 권한 검사를 "호출부마다 한 줄"로 넣는 설계는 **fail-open** — 새 API 에서 빠뜨리면
조용히 뚫리고, 사람이든 LLM 이든 기억에 의존하는 규칙은 반드시 뚫린다.

**결정: 관문을 연결 획득에 둔다.** SQL 모양은 제각각이어도(단문·트랜잭션·다중쿼리)
연결을 여는 한 줄은 19곳이 동일하다.

```csharp
private async Task<MySqlConnection> OpenReadAsync(CancellationToken ct)   // 지금과 동일
private async Task<MySqlConnection> OpenWriteAsync(CancellationToken ct)  // 관문(§3.3에서 활성화)
```

- 읽기 7개(Load*)는 `OpenReadAsync`, 쓰기 11개(Upsert/Add/Rename/Set*/Reorder/Count 중 쓰기 계열)는
  `OpenWriteAsync` 로 **기계적 치환**. 본문 로직은 손대지 않는다.
- `OpenWriteAsync` 는 지금은 `OpenReadAsync` 와 동일 동작(관문 자리만 확보).

### 3.2 테스트 불변식 — 기억이 아니라 기계가 강제한다

`tests/` 에 소스 구조 검사로 추가(선례: `admin-auth.test.mjs` 가 같은 방식 사용):

```
불변식 ①  ProjectDb 안에서 new MySqlConnection 을 직접 부르는 곳은
          OpenReadAsync·OpenWriteAsync 두 헬퍼 안뿐이다
불변식 ②  반환형 (bool ok, …) 인 공개 메서드는 전부 OpenWriteAsync 를 쓴다
```

이러면 "새 API 를 추가할 때 LLM 이 관문을 기억할까?"라는 질문 자체가 사라진다 —
빠뜨리면 `node tests/run-tests.mjs` 가 빨간불로 잡는다.

### 3.3 2단계 활성화 계획 (지금 구현하지 않음)

`edit_role` 을 편집 게이트에 적용하는 2단계에서 `OpenWriteAsync` 안에 한 쿼리를 넣는다:

```sql
SELECT edit_role, is_active FROM app_user WHERE login_id = ?   -- 세션 사용자
```

- `edit_role` 부적격 → 거부. **`is_active=0`(퇴사·회수) → 거부가 같은 쿼리에서 공짜로 따라온다.**
  주기 검사·루프·타이머가 전혀 필요 없는 이유다(사용자 질문에 대한 답).
- 과제목록 재조회(읽기)는 막지 않는다 — 회수의 목적은 편집 차단이지 조회 차단이 아니다.

### 3.4 정직한 한계

`taskmgr_app` 비밀번호는 배포본에 담겨 모든 PC에 퍼진다. MySQL 에 직접 붙으면 앱 코드를
통째로 우회할 수 있다. 이 관문의 목표는 **"정상 경로에서 실수로 빠뜨리는 일 방지"**이지
악의 방어가 아니다. 진짜 fail-safe 는 서버 API 경유([ROADMAP 2단계](ROADMAP.md)) 이후다.

---

## 4. 구현 순서 (오퍼스 브리프의 뼈대)

```
1. 잎 회수      UserSession.cs · LoadAppUserJsonAsync · LoginVerify ·
                SaveCredsForLogin(반환형 변경) · ClearCredsForLogout  ← 태그에서
2. 호스트 배선   userSessionGet / userLogin / userLogout  (§2.2 계약 그대로)
3. 웹 배선      게이트(§2.3) + 계정 섹션(§2.4) + 부팅 흐름
4. 설정 정리    netcus 자격 입력란 제거(상태 표시만 잔존)
5. DB 관문      OpenRead/OpenWriteAsync 치환 + 불변식 테스트 2개
6. 테스트       아래 불변식 전부 + 기존 432 유지
```

**테스트로 못박을 불변식** (이전 실패의 재발 방지 — 각각 실제 사고였다):

- 부팅 경로(웹 bootUserSession / 호스트 userSessionGet 체인)에 netcus 참조 0
- `LoginVerify` 는 `EnsureW2(background: true)` (기본값이 포그라운드 창이다 — 1차 실패 원인)
- 자격 저장 경로가 `NetcusSaveCreds`/`NetcusValidateCreds` 를 호출하지 않는다(재검증 창 방지)
- 게이트: `.overlay` 클래스 부재 · 닫기 경로 부재 · `#lgQuit` 존재 · HOST=false 미표시
- 게이트 표시 중 배경 inert · 전역 단축키 조기 return
- 저장 2개는 되읽기 확인 후에만 성공 · 실패 시 양쪽 정리
- 세션은 DPAPI 경유(평문 저장 금지) · 앱 버전 불일치 시 폐기
- 비밀번호가 localStorage/로그/회신에 없음
- ProjectDb 불변식 ①② (§3.2)

---

## 5. 폐기된 설계 — 왜 두 번 갈아엎었나 (재발 방지 기록)

### 1차 (커밋 e09e958~68f5566, 삭제됨)
"시작 시 로그인"을 **"시작마다 netcus 재인증"** 으로 해석했다. 그 결과 위젯을 켤 때마다
보조 WebView2 **가시 창**(920×720, 화면 중앙, "회사 일간보고 전송 (확인용)")이 떠서
netcus 로그인 → 주간보고 목록까지 들어갔다 닫혔다. `EnsureW2(background:true)` 가
이미 있었는데 쓰지 않았다. **요구는 재인증이 아니라 세션 유지였다.**

### 2차 (커밋 cc1692b, 삭제됨)
세션 유지는 맞게 만들었지만 적대적 검증(반증 통과 8건)에서:
- 게이트를 비동기 회신 **뒤에** 달아 캘린더·실데이터가 먼저 보였다("팝업부터" 위반)
- 포커스 격리가 없어 Shift+Tab 으로 덮개 뒤 버튼이 눌렸다(로그인 없이 저장 가능)
- 자격 저장 실패를 삼키고 성공 회신(이후 보고서가 조용히 깨짐)
- 로그아웃과 백그라운드 갱신이 경합해 삭제된 세션이 부활
- 실패 code 7종을 만들었지만 분기하는 곳 0(죽은 복잡도)
- 자격 출처 2개(로그인 + 설정 입력란)로 "세션은 나, 보고는 남" 가능

### 교훈
- 시퀀스는 상태 5개인데 코드가 597줄/함수 17개였다 — **결함은 전부 배선에 있었고 잎은 깨끗했다.**
  배선이 계약보다 커지면 멈추고 다시 물을 것.
- "저장했다"는 로그는 **되읽기 확인 없이는 거짓말**일 수 있다(실관측 2회).
- 안전장치는 관례(기억)가 아니라 **구조(초크포인트) + 기계(테스트 불변식)** 로 강제한다.

---

## 관련 문서
- [ROADMAP.md](ROADMAP.md) — 서버 승격 경로(2단계 = 서버 API·edit_role 적용 시점)
- [DECISIONS.md](DECISIONS.md) — 결정1(STOP 라인)·결정4(DB)·결정5(브라우저 SOP)
- `taskmgr-company-data`(Private 저장소) — app_user·org_unit·title_code 실데이터와 구축 보고
