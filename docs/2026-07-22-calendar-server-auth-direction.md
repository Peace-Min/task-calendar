# 2026-07-22 캘린더 서버 전환 및 인증/데이터 관리 방향

## 목적

수행과제 캘린더를 현재 WPF WebView2 위젯 중심 구조에서 향후 브라우저 배포와 서버 DB 기반 운영까지 확장할 때의 큰 방향을 정리한다.

이 문서는 즉시 구현 명세가 아니라 아키텍처 판단 기록이다. 실제 작업은 별도 이슈/PR로 분리한다.

## 현재 전제

- 현재 앱은 WPF 위젯이 WebView2로 `task-calendar-prototype.html`을 띄우는 구조다.
- HTML/CSS/JavaScript가 캘린더 화면, 일정 렌더링, 보고서 미리보기, 글꼴/들여쓰기 같은 표현 로직을 담당한다.
- WPF/.NET 쪽은 파일 저장, Git/SVN 실행, Windows 알림, WebView2 기반 netcus 자동 작성 같은 로컬/OS 의존 기능을 담당한다.
- 현재 개인 일정 데이터는 로컬 XML 중심으로 동작하지만, 향후 브라우저 배포와 여러 사용자의 데이터 관리를 고려하면 서버 DB가 필요하다.
- 브라우저 배포 후보 경로는 `https://www.netcus.com/calendar/`이고, 기존 주간/일간보고 시스템은 `https://www.netcus.com/pjm/...` 아래에 있다.

## 핵심 결정

### 1. 서버 전환의 기본 방향은 ASP.NET Core API + DB

향후 브라우저에서 캘린더를 사용하려면 HTML 전체를 서버가 다시 그려 내려주는 구조가 아니라, 현재 HTML/JS 화면은 유지하고 서버는 사용자별 데이터와 인증을 제공하는 API 역할을 맡는 방향이 적절하다.

권장 흐름:

```text
Browser or WPF WebView2
  -> static calendar HTML/JS
  -> ASP.NET Core API
  -> internal DB
```

ASP.NET Core는 다음 책임을 가진다.

- 로그인된 사용자의 신원 확인
- 직원 정보 조회
- 캘린더 일정/할 일/보고서 관련 데이터 read/write
- 장애 상태, 권한 오류, 인증 만료 같은 서버 응답 표준화
- 추후 운영 로그, 헬스 체크, 배포/확장 대응

HTML/JS는 계속 다음 책임을 가진다.

- 캘린더 그리드와 사용자 인터랙션
- 보고서 작성 UI
- 보고서 미리보기 표현
- 글꼴, 글자 크기, 들여쓰기, 하이픈 등 출력 서식 처리
- 서버에서 받은 JSON 데이터를 화면에 반영

### 2. 브라우저와 위젯은 같은 API를 사용한다

브라우저와 위젯의 차이는 인증 진입 방식과 로컬 OS 기능 지원 여부에 둔다. 일정/할 일/보고서 데이터 API는 동일하게 사용하는 것이 유지보수에 유리하다.

권장 구조:

```text
Browser
  -> netcus session validation
  -> ASP.NET Core auth cookie
  -> ClaimsPrincipal(EmployeeId)
  -> common calendar APIs

WPF Widget
  -> persistent WebView2 auth cookie after first login
  -> ClaimsPrincipal(EmployeeId)
  -> common calendar APIs
```

API 내부에서 `browser`와 `widget` 분기를 흩뿌리지 않는다. 인증이 끝난 뒤에는 두 클라이언트 모두 같은 사용자 컨텍스트로 처리한다.

### 3. netcus ID가 안정적인 사용자 식별자다

현재 로그인 후 페이지에서 확인 가능한 값은 다음과 같다.

- netcus ID: 예시 `phmin`
- 사용자명: 예시 `민평화`
- 별도 사번은 확인되지 않음

netcus ID는 회사에서 규칙적으로 생성/배포하며 동명이인을 구분하는 값으로 볼 수 있으므로, DB에서는 `NetcusId`를 unique key로 둔다. 사용자명은 표시와 검증 보조값으로 사용한다.

권장 직원 테이블 개념:

```text
Employee
  EmployeeId   internal primary key
  NetcusId     unique, required
  Name         required
  IsActive     required
  CreatedAt
  UpdatedAt
```

DB는 회사 직원 매핑 정보만 관리한다. netcus 비밀번호는 저장하지 않는다.

### 4. 클라이언트가 제출한 id/name은 신뢰하지 않는다

브라우저나 위젯에서 전달하는 `id`, `name` 값은 조작 가능하므로 인증 근거로 사용하면 안 된다. ASP.NET Core가 신뢰할 수 있는 방식으로 기존 netcus 로그인 세션을 확인해야 한다.

권장 방식:

```text
User logs in to /pjm
  -> existing netcus session is created
  -> /calendar calls ASP.NET Core auth endpoint
  -> ASP.NET Core validates the netcus session through a server-side bridge
  -> ASP.NET Core checks Employee.NetcusId and Employee.Name
  -> ASP.NET Core issues its own calendar auth cookie
```

구현 후보:

- JSP 쪽에 세션 기반 사용자 정보를 반환하는 내부 endpoint 추가
- 또는 `netcus.com` 내 경로 라우팅/reverse proxy로 ASP.NET Core가 기존 세션을 서버 대 서버로 확인

중요한 점:

- `JSESSIONID`는 ASP.NET Core가 직접 해석할 수 없다.
- ASP.NET Core는 기존 JSP 세션을 검증해주는 신뢰 가능한 서버 측 통로가 필요하다.
- 사용자명 불일치, 비활성 직원, ID 미등록은 로그인 거부로 처리한다.
- DB 장애는 "계정 오류"가 아니라 서비스 장애로 처리한다.

### 5. 위젯은 매번 로그인하지 않도록 persistent auth cookie를 사용한다

위젯은 개인 사내망 PC에서 상시 사용하는 성격이 강하므로 매 실행마다 netcus 로그인을 요구하면 사용성이 떨어진다.

권장 정책:

- 최초 1회 netcus 로그인으로 ASP.NET Core 인증 쿠키를 발급한다.
- WebView2 persistent user data folder에 인증 쿠키를 유지한다.
- 다음 실행부터는 쿠키가 유효하면 자동 로그인한다.
- 쿠키 만료, 직원 비활성화, 서버 정책 변경 시에만 재인증한다.

예시 정책:

- 30일 inactivity 만료
- sliding renewal 적용
- 서버의 Data Protection key를 안정적으로 보관
- 필요 시 나중에 강제 로그아웃/장치 세션 관리 추가

현재 단계에서는 별도 device token 테이블까지는 필수로 보지 않는다. 장치별 강제 해제, 감사 로그, 분실 PC 대응 요구가 명확해질 때 추가한다.

### 6. 서버 DB를 단일 원천으로 둔다

브라우저/위젯 공통 운영으로 전환하면 일정/할 일/보고서 데이터의 source of truth는 서버 DB로 두는 것이 가장 단순하고 안전하다.

권장 정책:

- 데이터 추가/수정/삭제는 API와 DB 성공 후 UI에 확정 반영한다.
- DB 또는 API 장애 시 쓰기 작업은 실패 처리한다.
- 이미 화면에 로드된 데이터는 메모리 상태로 볼 수는 있으나, 쓰기 작업은 막는다.
- 서버 장애 중 로컬 XML을 먼저 수정하고 나중에 전체 diff로 DB에 밀어 넣는 방식은 채택하지 않는다.

XML-first 후 동기화 방식의 위험:

- 오래된 XML이 최신 DB 데이터를 덮어쓸 수 있다.
- 삭제/수정/중복 재시도 구분이 어렵다.
- 브라우저와 위젯을 동시에 쓰는 경우 충돌 처리가 복잡해진다.
- 일부 동기화 성공 후 실패한 상태를 복구하기 어렵다.
- 보고서/시간/상세설명 같은 필드가 늘어날수록 유실 위험이 커진다.

정말 오프라인 쓰기가 필요해지는 경우에는 XML snapshot이 아니라 SQLite + transactional outbox + idempotency key + row version/ETag + tombstone + conflict policy가 필요하다. 현재 요구에는 과하다.

### 7. XML 캐시는 기본적으로 제거 또는 제한한다

서버 DB가 공식 원천이 되면 XML은 기본 데이터 저장소로 유지할 이유가 약하다.

XML read-only 캐시가 의미 있는 경우는 제한적이다.

- 위젯 시작 시 netcus 인증은 살아있지만 캘린더 DB/API만 일시 장애인 경우
- 사용자에게 마지막 동기화 시점의 읽기 전용 일정 표시가 꼭 필요한 경우

이 요구가 명확하지 않다면 XML 캐시는 제거하는 방향이 낫다. 서버 장애 시 브라우저와 위젯 모두 일정 추가/삭제/수정은 불가로 처리한다.

XML에 로그인 검증용 ID/PW를 저장하는 방식은 채택하지 않는다. netcus 비밀번호 저장은 장기적으로 제거해야 할 대상이다.

### 8. DPAPI의 역할은 축소된다

현재 위젯은 로컬 netcus 자격증명 저장을 위해 DPAPI를 사용한다. 향후 netcus 비밀번호 저장을 제거하고 ASP.NET Core 인증 쿠키 기반으로 이동하면 DPAPI의 필요성은 줄어든다.

DPAPI가 남을 수 있는 경우:

- 장치별 refresh token을 도입할 때 로컬 토큰 보호
- 로컬 전용 민감 설정이 남을 때 보호

하지만 단순 persistent HttpOnly auth cookie 방식이면 별도의 XML 비밀번호 저장이나 DPAPI 기반 로그인 정보 저장이 필요 없다.

### 9. 브라우저와 위젯의 기능 차이는 명확히 분리한다

브라우저에서 수행하기 어려운 기능은 서버 또는 위젯 전용 기능으로 분리한다.

브라우저에서 직접 수행하기 어려운 기능:

- 로컬 Git/SVN 실행
- Windows 알림/트레이
- 로컬 파일 시스템 자동 저장
- 별도 브라우저 자동 제어를 통한 보고서 작성

서버 또는 위젯 전용으로 둘 기능:

- Windows 알림/트레이: 위젯 전용
- 로컬 Git/SVN 실행: 위젯 전용 또는 별도 로컬 agent 필요
- 보고서 자동 작성: same-origin 배포 이후 브라우저에서 가능한 범위 재검토, 아니면 위젯/서버 연계 기능으로 분리

## 장애 정책

### 브라우저

- 서버/API/DB 장애 시 로그인과 데이터 작업을 실패 처리한다.
- 로컬 XML fallback은 제공하지 않는다.
- 이미 로드된 화면은 보여줄 수 있으나 데이터 변경은 막는다.

### 위젯

- 기본적으로 브라우저와 동일한 서버 우선 정책을 따른다.
- persistent auth cookie로 매번 로그인하지 않게 한다.
- 서버 장애 중 XML에 먼저 쓰고 나중에 DB와 병합하는 정책은 사용하지 않는다.
- read-only last snapshot은 별도 요구가 있을 때만 검토한다.

## 보안 원칙

- netcus 비밀번호는 캘린더 DB에 저장하지 않는다.
- 클라이언트가 전달한 ID/이름은 인증 근거가 아니다.
- ASP.NET Core 인증은 신뢰 가능한 서버 측 netcus 세션 검증 이후에만 발급한다.
- 쿠키는 `HttpOnly`, `Secure`, 적절한 `SameSite` 정책을 적용한다.
- cookie 기반 write API에는 CSRF/antiforgery 대책을 둔다.
- 동일 origin(`/pjm`, `/calendar`) 배포는 편리하지만 XSS 영향 범위가 커지므로 CSP, 출력 인코딩, 불필요한 third-party script 제거가 필요하다.
- 다중 서버 배포 가능성을 고려해 ASP.NET Core Data Protection key를 안정적으로 보관한다.

## 추후 이슈로 분리할 작업

이 문서는 큰 방향만 고정한다. 실제 구현은 아래처럼 쪼개서 진행한다.

1. ASP.NET Core API 서버 골격 설계
2. netcus 세션 검증 bridge 설계
3. 직원 테이블과 `NetcusId` 기반 식별 모델 정의
4. 캘린더 일정/할 일/보고서 데이터 DB 스키마 설계
5. 기존 XML 저장소에서 서버 API 저장소로 이전하는 단계 계획
6. WebView2 persistent auth cookie 정책 구현
7. 브라우저/위젯 공통 API adapter 정리
8. 서버 장애 시 UI 정책 정리
9. 기존 DPAPI credential 저장 제거 계획
10. same-origin 배포 시 보고서 자동 작성 가능 범위 검증

## 현재 판단 요약

가장 유지보수하기 좋은 방향은 다음과 같다.

```text
Static HTML/JS UI
  + ASP.NET Core API
  + DB as source of truth
  + netcus session bridge
  + persistent auth cookie for widget
  + no local password storage
  + no XML-first offline write sync
```

이 구조는 위젯 사용자에게 매번 로그인을 요구하지 않으면서도, 브라우저와 위젯의 데이터 처리 코드를 하나의 서버 API로 모을 수 있다. 복잡도는 인증 경계에 집중시키고, 일정/보고서 비즈니스 로직에는 클라이언트 종류별 분기를 퍼뜨리지 않는 것이 핵심이다.
