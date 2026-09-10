# DEPLOY.md — 수행과제 캘린더 배포 매뉴얼 (사내 관리자용)

> 대상 독자: **폐쇄망에서 저장소를 받아 새 버전을 빌드하고, 공유폴더(FTP)로 배포하는 사람**
> 기준 버전: **`<버전>`** — 버전 단일 소스는 `widget/TaskCalendarWidget.csproj`의 `<Version>` 한 곳이다(이 문서엔 버전을 박지 않는다).

---

## 1. 한 줄 요약 + 준비물

**한 줄 요약**: `installer\배포-빌드.cmd` **더블클릭** → 결과물 2개(`TaskCalendarWidget-Setup-v<버전>.exe` + `latest.json`)가 `dist\installer\`에 생성됨 → **그 2개를 공유폴더(FTP)에 함께 업로드**하면 배포 끝.

> **단, 그 앞에 §0(서버 DB 선행 작업)이 있다.** 캘린더 데이터가 서버 MySQL에 있으므로 **빌드보다 서버가 먼저**다 — 접속값을 채워 빌드하고, 스키마가 바뀌는 버전이면 서버에 먼저 적용한다.

### 준비물

| 구분 | 항목 | 비고 |
|---|---|---|
| **빌드 PC (관리자)** | .NET 9 SDK | `dotnet publish` 실행에 필요 |
| **빌드 PC (관리자)** | Inno Setup 6 (`ISCC.exe`) | 설치기(.exe) 컴파일. 스크립트가 경로 자동 탐색 |
| **빌드 PC (관리자)** | 저장소(`task-calendar/`) 사본 | 클론 또는 폐쇄망 반입본 |
| **공유폴더** | FTP 루트(예: `ftp://192.168.1.175/`) 또는 UNC(`\\서버\TaskCalendar`) | 쓰기 권한은 **관리자 전용 권장**(§8) |
| **동료(테스트) PC** | **설치 전제 없음** | 자체포함 단일 exe라 .NET 런타임 불필요 |
| **동료(테스트) PC** | **사내망에서 서버 MySQL 도달 + `app_user` 등록** | 캘린더 데이터가 서버에 있다. 망이 안 닿거나 그 계정이 `app_user`에 없으면 위젯이 캘린더를 못 읽는다(로컬 캐시 없음) |

> **핵심**: 빌드 도구(.NET 9 SDK + Inno Setup 6)는 **빌드 PC에만** 필요. 동료 PC엔 아무것도 미리 깔 필요 없다.
> 참고: `csproj`는 프레임워크 종속(`<SelfContained>false</SelfContained>`)으로 설정돼 있지만, 실제 배포 빌드는 `build-installer.ps1`이 `dotnet publish … --self-contained true -p:PublishSingleFile=true`로 **강제 자체포함 단일 exe**를 만든다. 따라서 배포되는 설치기는 자체포함이며 동료 PC에 .NET 런타임이 필요 없다. (WebView2 런타임은 별개 — Win11은 내장이라 대개 불필요.)

---

## 0. 서버 DB 선행 작업 (§2~§3보다 **먼저**)

캘린더 데이터는 서버 MySQL(`taskmgr`)에 있다(v0.18.0~). 그래서 **빌드보다 서버가 먼저**다 — 아래 다섯을 끝내지 않으면 잘 만들어진 인스톨러를 배포해도 동료 PC에서 캘린더가 열리지 않는다.

### 0-1. 배포 구성 채우기 — `widget/DeployConfig.cs` (빌드 **전**)

배포값은 이 파일 한 곳에만 있다. 빌드하기 전에 실서버 값으로 바꾼다.

| 상수 | 저장소 값 | 배포 시 채울 값 |
|---|---|---|
| `DbHost` | `localhost` | **서버 PC의 고정 IP** |
| `DbPassword` | 저장소용 값 | `init-db` 실행 시 정한 **앱 계정(`taskmgr_app`) 비밀번호** — 어긋나면 접속이 안 된다 |
| `UpdateSourceUrl` | `""`(비움) | 공유폴더/FTP 경로(§5 방법 B). 비워 두면 각 PC 설정에서 넣어야 켜진다 |

> ⚠️ **`localhost`인 채로 빌드하면 안 된다** — 배포된 PC들이 각자 *자기 PC*의 MySQL을 찾아 아무도 서버에 붙지 않는다. [CHANGELOG.md](CHANGELOG.md)의 v0.18.0 항목 끝이 같은 경고를 한다(로컬 빌드는 게이트용이지 배포 산출물이 아니다).

### 0-2. 백업 — 손대기 전에 받는다

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File db\deploy\backup-taskmgr.ps1   # =backup-taskmgr.cmd
```

마이그레이션 중에는 구조만이 아니라 **기존 행의 값을 바꾸는 것**도 있다(그건 되돌릴 수 없다). 백업은 선택이 아니다.

### 0-3. 미적용 `migrate-*.sql` 적용

[`db/deploy/README.md`](db/deploy/README.md)의 **「캘린더 표 마이그레이션 — `cal_*` · `schema_version`」** 절이 정본이다. 그 절의 표 순서대로 **번호 오름차순으로, 건너뛰지 말고** 적용한다. 왜 필요한지·무엇을 깨뜨리는지·되돌릴 수 있는지는 각 파일의 머리말에 적혀 있다.

> **판번호를 이 문서에 적지 않는다.** 값의 정본은 `db/deploy/schema-calendar.sql` 끝의 `INSERT INTO cal_schema_meta … VALUES ('schema_version', …)` 한 줄이고, 지금 서버 값은 아래로 읽는다:
>
> ```sql
> SELECT v FROM cal_schema_meta WHERE k = 'schema_version';
> ```

### 0-4. 대조 — `latest.json`을 올리기 **전에**

위 쿼리로 읽은 **서버 `schema_version`** 과 배포할 위젯의 **`widget/CalendarDb.cs`의 `ExpectedSchemaVersion` 상수**가 같은지 맞춰 본다.

- 다르면 **올리지 않는다.** 어느 한쪽만 앞서면 위젯 배지가 경고로 바뀌고 **전량 교체(가져오기·전체 초기화)가 거부**된다(조회·통상 저장은 계속된다).
- 즉 **서버 적용과 위젯 배포는 같은 창에서** 한다. 순서는 서버가 먼저다.

### 0-5. GRANT 재적용 — 휴지통(v0.19.0~)

휴지통의 **영구 삭제**는 앱 계정(`taskmgr_app`)에 **일곱 표** `DELETE` 가 있어야 동작한다(다섯 표 + 계정 삭제에 딸려 지우는 `cal_user_pref`·`cal_user_rev`)(없으면 ERROR 1142). GRANT 문은 멱등이라 **다시 실행하기만** 하면 된다.

- `db/deploy/create-app-user.sql` — `project` · `customer` · `section_code` · `status_code`
- `db/deploy/grants-calendar.sql` — `cal_user_pref` · `cal_user_rev`(계정 영구 삭제가 먼저 지우는 부속 2표) + 머리말 서술
- `taskmgr-company-data/05-grants.sql` — `app_user`

확인(일곱 표에 DELETE 가 보여야 한다 — 2026-09-10 개발 DB 에서 부속 2표가 빠져 계정 삭제가 ERROR 1142 로 죽는 것을 루프 시험이 잡았다):

```sql
SHOW GRANTS FOR 'taskmgr_app'@'%';
```

> 이 권한은 '가능하게'만 한다. 무엇을 지울 수 있는지는 호스트 관문이 정한다 — 숨긴 항목만, 관리자만, 이름을 그대로 입력해야 지워진다(docs/TRASH-DELETE.md §3.3).

---

## 2. 처음 한 번만 (클론 · 전제 점검)

### 2-1. 저장소 확보
폐쇄망이면 반입한 `task-calendar/` 폴더를 그대로 사용한다. (git 사용 시 `git clone …`)
아래 경로가 이 매뉴얼의 기준이다.

```
task-calendar\                       ← 저장소 루트
├─ widget\TaskCalendarWidget.csproj  ← 버전 단일 소스(<Version>)
├─ installer\
│   ├─ 배포-빌드.cmd                  ← ★ 원클릭 배포 빌드(더블클릭)
│   ├─ publish-update.ps1            ← 발행 CLI(-Build/-Notes/-CopyTo)
│   ├─ build-installer.ps1          ← publish + ISCC 컴파일(설치기만)
│   └─ task-calendar.iss             ← Inno Setup 스크립트
└─ dist\installer\                   ← 빌드 결과물이 여기에 생성됨
```

### 2-2. 전제 점검 (빌드 PC 1회)

```powershell
dotnet --version        # 9.x 가 나와야 함
# Inno Setup 6 설치 여부: 아래 중 하나에 ISCC.exe 가 있으면 OK (스크립트가 자동 탐색)
#   %LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe   (winget per-user 설치)
#   %ProgramFiles(x86)%\Inno Setup 6\ISCC.exe
#   %ProgramFiles%\Inno Setup 6\ISCC.exe
# (그 외 Inno Setup 5 경로와 PATH 상의 iscc 도 폴백으로 탐색한다.)
```

- ISCC 자동 탐색 실패 시: `installer\build-installer.ps1 -Iscc "D:\경로\ISCC.exe"` 로 직접 지정 가능.
  - **주의**: `-Iscc` 옵션은 `build-installer.ps1`에만 있다. `배포-빌드.cmd`/`publish-update.ps1`에는 `-Iscc`가 없고, `-Build` 시 `build-installer.ps1`을 경로 인자 없이 호출하므로 **`배포-빌드.cmd -Iscc …`로는 전달되지 않는다.** 자동 탐색이 실패하면 §7-3의 우회 절차(먼저 `build-installer.ps1 -Iscc`로 설치기 빌드 → 이어서 `publish-update.ps1`을 `-Build` 없이 실행)를 따른다.

### 2-3. 폐쇄망 오프라인 빌드 준비 (중요)

빌드 PC가 인터넷이 안 되는 폐쇄망이면, `배포-빌드.cmd`가 성공하려면 아래를 미리 갖춰야 한다:

- **.NET 9 SDK** — 인터넷 PC에서 오프라인 설치 파일(`dotnet.microsoft.com/download/dotnet/9.0`, x64)을 받아 USB로 반입·설치. (`dotnet --version` → 9.x)
- **Inno Setup 6** — 설치 파일을 반입·설치(`ISCC.exe`).
- **WebView2 NuGet** — 저장소에 **동봉**됨(`widget\nuget-packages\microsoft.web.webview2.*.nupkg`) → 인터넷 없이 복원된다.
- ⚠️ **win-x64 런타임 팩(자체포함용)** — `배포-빌드.cmd`는 `--self-contained true`로 단일 exe를 만든다. 이 런타임 팩은 **한 번은 인터넷(또는 캐시)에서 받아야** 한다.
  - **이미 이 기능으로 배포해온 빌드 PC(현재 dev PC)엔 캐시돼 있어 오프라인 빌드가 된다.** 하지만 런타임 팩이 없는 **완전 새 폐쇄망 PC의 첫 빌드는 실패**할 수 있다.
  - 대안: ① 런타임 팩이 캐시된 PC(현재 dev PC)에서 빌드, 또는 ② `%USERPROFILE%\.nuget\packages\`의 `microsoft.netcore.app.host.win-x64`·`microsoft.netcore.app.runtime.win-x64` 캐시 폴더를 새 PC로 반입.
  - 로컬 실행/테스트만 필요하면 `dotnet publish widget\TaskCalendarWidget.csproj -c Release -o dist\app`(프레임워크 종속 exe, .NET 설치 PC 전용)로 자체포함 없이 빌드 가능 — 단 이건 **배포용 인스톨러가 아니다.**

---

## 3. 배포 절차 (매 배포의 표준 흐름)

### 3-1. 원클릭 빌드 — 파일 하나 더블클릭

파일 탐색기에서 아래 파일을 **더블클릭**한다.

```
task-calendar\installer\배포-빌드.cmd
```

이 래퍼는 내부적으로 `publish-update.ps1 -Build`를 실행한다(뒤에 붙인 인자는 그대로 전달됨). 순서:

1. 위젯을 **자체포함 단일 exe**로 publish
2. ISCC로 인스톨러 컴파일 → `dist\installer\TaskCalendarWidget-Setup-v<버전>.exe`
3. 그 exe의 **SHA256** 계산 → `dist\installer\latest.json` 생성

> 버전은 **자동**으로 `csproj <Version>`에서 읽는다. 어디에도 버전을 손으로 입력하지 않는다.

명령줄로 하고 싶으면(동일 결과):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "task-calendar\installer\publish-update.ps1" -Build
```

배너 안내문을 넣으려면 `-Notes`:

```powershell
# 콘솔의 상단 배너 [변경내역]에 표시될 짧은 요약
"…\installer\배포-빌드.cmd" -Notes "리마인더 개선 및 버그 수정"
```

> **`-Notes`를 안 주면 비는 게 아니라 자동 추출한다.** `publish-update.ps1`이 `RELEASE_NOTES.md`에서 `## v<버전>` 절의 **첫 비-불릿 문단**을 요약으로 읽어 쓴다. 그래서 인자 없는 원클릭도 배너 안내가 채워진다. **단, 그 버전 절이 없으면 notes가 빈 채로 나간다** — 콘솔에 `! RELEASE_NOTES.md에서 v<버전> 요약을 못 찾음` 경고가 뜨니, 그때는 `-Notes`로 직접 준다.

### 3-2. 결과물 확인

빌드가 끝나면 `dist\installer\`에 **정확히 이 2개**가 있어야 한다(`<버전>` = `csproj <Version>`):

| 파일 | 내용 |
|---|---|
| `TaskCalendarWidget-Setup-v<버전>.exe` | 무인 설치 가능한 인스톨러(자체포함) |
| `latest.json` | 업데이트 매니페스트 `{ version, file, notes, sha256 }` |

`latest.json` 예시(형식 확인용):

```json
{
  "version": "<버전>",
  "file": "TaskCalendarWidget-Setup-v<버전>.exe",
  "notes": "리마인더 개선 및 버그 수정",
  "sha256": "<소문자 hex 64자>"
}
```

> **주의**: `latest.json`의 `file`/`sha256`은 **실제 exe와 1:1로 매칭**되어 있다. 위젯이 이 값으로 다운로드 대상과 무결성을 검증하므로 **exe 파일명을 절대 바꾸지 말 것**. 이름을 바꾸면 `latest.json`이 가리키는 파일을 못 찾거나 해시 불일치로 설치가 거부된다.

### 3-3. 공유폴더(FTP)에 업로드

`dist\installer\`의 **두 파일을 함께** 공유폴더(각 위젯의 '업데이트 소스 URL'이 가리키는 위치)에 올린다.

```
ftp://192.168.1.175/            ← FTP 루트에 올린 예(소스 URL도 이 주소)
├─ latest.json
└─ TaskCalendarWidget-Setup-v<버전>.exe
```

지원 위치 형태(위젯이 모두 파싱 가능): `ftp://<서버IP>/…/` · `http(s)://…/` · UNC `\\서버\공유\…`

**옵션 — 빌드 직후 공유폴더로 자동 복사** (UNC/로컬 경로일 때):

```powershell
"task-calendar\installer\배포-빌드.cmd" -CopyTo "\\서버\TaskCalendar"
```

- `-CopyTo`는 `latest.json` + Setup exe를 지정 경로로 복사해 준다.
- 대상 경로가 없으면 경고만 뜨고 빌드는 성공한다(수동 업로드 필요).
- **FTP(`ftp://…`)는 `-CopyTo` 대상이 아니다** — `-CopyTo`는 `Test-Path`로 접근 가능한 UNC/로컬 경로만 복사한다. FTP는 별도 FTP 클라이언트로 위 2개 파일을 업로드한다.

### 배포 체크리스트

- [ ] `배포-빌드.cmd` 더블클릭 → 오류 없이 완료
- [ ] `dist\installer\`에 `TaskCalendarWidget-Setup-v<버전>.exe` + `latest.json` 2개 존재
- [ ] `latest.json`의 `version`/`file`이 실제 exe와 일치 (파일명 변경 금지)
- [ ] 공유폴더(FTP)에 **두 파일 모두** 업로드
- [ ] 배너 안내문 — `-Notes`를 줬거나, `RELEASE_NOTES.md`에 이번 버전 절이 있어 자동 추출됐는지(콘솔의 `* Notes(자동 …)` 줄로 확인. 둘 다 아니면 빈 채로 나간다)
- [ ] **§0-5 GRANT 재적용 + `SHOW GRANTS` 로 일곱 표 DELETE 확인** — 스키마가 안 바뀐 판도 해당한다(§6-1 ★)
- [ ] `TC_TEST_STRICT=1 node tests/run-tests.mjs` **exit 0** — skip 이 있으면 2(판정 없음)라 통과가 아니다. strict 는 skip 을 fail 로 올린다
- [ ] `latest.json` 의 `sha256` = 실제 Setup exe 해시 (`Get-FileHash <exe> -Algorithm SHA256` 과 눈으로 대조)
- [ ] 루프 5회 연속 규약 — `node tests/loop-user-admin.mjs` · `node tests/loop-trash.mjs` 를 **무작위 시드로 5회 연속 통과**(한 번이라도 실패하면 1부터 다시 센다. `tests/README.md` 의 두 절)

---

## 4. 동료 최초 설치 (부트스트랩 — 딱 한 번은 수동)

자동 업데이트는 **그 기능이 이미 든 버전(v0.8.0+)이 깔려 있어야** 신호를 받을 수 있다. 따라서 **최초 1회는 수동 설치**가 필요하다.

1. 공유폴더의 `TaskCalendarWidget-Setup-v<버전>.exe`를 동료가 **1회 실행**해 설치한다.
2. 설치 후 위젯이 바탕화면에 상주하기 시작한다.
3. 이후 **새 버전은 자동 업데이트로 전파**된다 — 단, **아래 §5에서 소스 URL이 설정돼 있을 때만.**

> 자체포함 exe라 동료 PC에 .NET 런타임을 따로 깔 필요가 없다.

---

## 5. 자동 업데이트 소스 (기본값은 비어 있다 — 채워야 켜진다)

**저장소의 `widget/DeployConfig.cs`는 `UpdateSourceUrl = ""`(비움)으로 나간다.** 설정에 저장된 소스 URL이 비어 있을 때 이 값으로 시드되므로(`widget/MainWindow.xaml.cs:95`), **비운 채 빌드하면 업데이트 확인 기능은 휴면**이다.

켜는 길은 둘이다 — 각 PC 설정에서 넣거나(방법 A), 배포 빌드 전에 `DeployConfig.UpdateSourceUrl`을 채우거나(방법 B).

### 방법 A) 각 PC에서 설정으로 지정 (재빌드 불필요, 지금 바로)

각 동료 PC의 위젯에서:

1. **⋯ 더보기 → 설정** 열기
2. **자동 업데이트 → '업데이트 소스 URL'** 칸에 공유폴더 주소 입력
   - 예: `ftp://192.168.1.175/TaskCalendar/` (끝에 `/` 권장) · `http(s)://…/` · `\\서버\TaskCalendar\`
   - 힌트: *비우면 업데이트 확인 안 함*
3. **'지금 확인'** 버튼으로 즉시 연결 테스트

> 설정 로직: 저장된 URL이 비어 있으면 배포 구성 기본값(`DeployConfig.UpdateSourceUrl`)으로 시드된다(`widget/MainWindow.xaml.cs:95`). 저장소 기본값이 비어 있으므로 **설정에서 직접 넣어야** 켜진다.

### 방법 B) 배포 구성에 채우고 재빌드 (전 PC 공통 자동 적용)

최종 공유폴더 주소가 확정됐다면, 앞으로 배포되는 빌드가 **설치 즉시** 자동 업데이트를 켜도록 배포 구성에 채운다 — §0-1에서 `DbHost`·`DbPassword`를 채우는 그 파일이다.

```csharp
// widget/DeployConfig.cs
public const string UpdateSourceUrl = "ftp://<서버IP>/TaskCalendar/";   // 또는 "\\\\서버\\TaskCalendar\\"
```

수정 후 §3의 배포 절차를 다시 돌린다. 이렇게 나간 빌드는 동료가 설치만 하면 소스 URL이 이미 채워져 있어 별도 설정이 필요 없다.

### 자동 확인 주기

소스 URL이 설정되면, 위젯이 **시작 직후(약 9초 뒤) 1회 + 이후 30분마다** 백그라운드로 `latest.json`을 조용히 확인한다. `latest.json.version`이 현재 설치본보다 높으면 상단에 배너를 띄운다:

```
🆕 새 버전 X 있습니다   [변경내역]   [업데이트]
   └ [업데이트] → 인스톨러 임시복사 → sha256 검증 → 무인(/SILENT) 설치 → 재시작
      (설정·로컬 파일은 건드리지 않음, exe만 교체 — 캘린더 데이터는 서버 DB에 있다)
```

> 30분 주기는 새 버전 발견뿐 아니라 '서버 오프 → 이미 열린 배너 자동 종료'의 반응성도 겸한다(폐쇄망 로컬 소스라 부담 없음). 코드 근거: `widget/Update.cs:31`(시작 지연 9초), `:35`(주기 `TimeSpan.FromMinutes(30)`).

---

## 6. 다음 버전 낼 때

1. **스키마 변경 또는 권한(GRANT) 변경이 딸린 버전이면 서버 적용을 먼저** — 새 `migrate-*.sql`이 있는 릴리스는 §0(백업 → 적용 → `ExpectedSchemaVersion` 대조)을, **새 GRANT 가 필요한 릴리스는 §0-5**(일곱 표 DELETE 재적용)를 끝낸 뒤에 아래로 간다. 위젯만 먼저 나가면 전량 교체가 막힌다.
   > ★ **스키마가 안 바뀌어도 §0 을 건너뛰면 안 되는 판이 있다.** v0.19.0(휴지통)이 그렇다 — `migrate-*.sql` 은 한 개도 없지만 §0-5 의 GRANT 를 다시 주지 않으면 **영구 삭제가 전부 ERROR 1142 로 죽는다**(2026-09-10 개발 DB 에서 실제로 났고 `loop-trash` 가 잡았다: [docs/TRASH-DELETE.md](docs/TRASH-DELETE.md) §11-2). 옛 문장은 "스키마 변경이 딸린 버전이면" 이라 **권한만 바뀐 판은 §0 을 통째로 건너뛰는 것으로 읽혔다** — 그게 그 사고의 원인이다.
2. **버전 올림** — `widget/TaskCalendarWidget.csproj`의 `<Version>`을 올린다.
   - `<AssemblyVersion>`/`<FileVersion>`도 함께 맞춰 두면 깔끔하다(선택).
3. **원클릭 빌드** — `installer\배포-빌드.cmd` 더블클릭 (필요 시 `-Notes "이번 버전 요약"`).
4. **FTP 덮어쓰기** — 새 `TaskCalendarWidget-Setup-v<새버전>.exe` + `latest.json`을 공유폴더에 올린다.
   - 이전 버전 Setup exe는 두어도 되고 지워도 된다. `latest.json`은 **항상 최신 것으로 덮어쓴다.**
5. **자동 전파** — 소스 URL이 설정된 각 위젯이 다음 확인 주기(최대 30분 이내, 또는 '지금 확인')에 배너로 안내한다.

```powershell
# 예: csproj <Version>을 새 버전으로 바꾼 뒤
"task-calendar\installer\배포-빌드.cmd" -Notes "이번 버전 변경 요약" -CopyTo "\\서버\TaskCalendar"
```

> **버전만 올리고 exe를 안 바꾸면 안 된다**: `latest.json.file`이 가리키는 인스톨러가 그 폴더에 실제로 있어야 설치까지 완료된다. 버전만 올리고 file이 옛 설치본이면, 같은 버전이 다시 깔려 배너가 계속 뜬다.

---

## 7. 동작 확인 / 문제 해결

### 7-1. 즉시 확인 방법

| 위치 | 동작 |
|---|---|
| **⋯ 더보기 → 업데이트 확인** | 주기(30분)를 기다리지 않고 즉시 최신 여부 조회 |
| **설정 → 자동 업데이트 → 지금 확인** | 위와 동일 경로. 소스 접근 성공/실패까지 확인 |

- 최신이면 "최신" 알림, 새 버전이면 배너, 실패면 사유가 뜬다(사용자가 눌렀을 때만 사유 표시. 백그라운드 주기 확인은 무음).

### 7-2. 로그 파일

```
%APPDATA%\TaskCalendar\widget.log
```

업데이트 관련 로그 문자열(코드 기준):

| 상황 | 로그 예시 |
|---|---|
| 새 버전 있음 | `업데이트 발견: <소스 버전> > 내 <설치 버전>` |
| 최신 (변화 없음) | `업데이트 없음: 최신 <소스 버전> ≤ 내 <설치 버전>` |
| 소스 접근 실패 | `업데이트 확인 실패(무음): <사유>` |
| 소스 URL 저장 | `업데이트 소스 URL 저장: ftp://…` 또는 `(비움 — 휴면)` |

### 7-3. 자주 겪는 문제

| 증상 | 원인 / 해결 |
|---|---|
| 배너가 안 뜬다 | 소스 URL이 비어 있음(=휴면). §5로 설정 → '지금 확인'. `widget.log`에 소스 URL 저장 로그 확인 |
| "확인 실패 — 소스에 접근할 수 없습니다" | FTP/공유 경로 오타, 서버 다운, 권한 문제. URL 끝 `/` 포함해 재확인 |
| 배너는 뜨는데 설치 실패 | `latest.json.file`이 가리키는 exe가 폴더에 없거나 파일명이 바뀜 / **sha256 불일치**(exe만 교체하고 latest.json 안 올림). §3-2 파일명 규칙 준수 |
| 버전 올렸는데 계속 배너 | file이 옛 설치본을 가리킴(§6 주의 참조). 새 exe도 함께 업로드 |
| ISCC 못 찾음(빌드 실패) | Inno Setup 6 설치. 여전히 자동 탐색 실패면 **`배포-빌드.cmd`로는 경로를 넘길 수 없으므로** 다음 우회: ① `powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 -Iscc "<ISCC.exe 경로>"`로 설치기를 먼저 빌드 → ② `powershell -ExecutionPolicy Bypass -File installer\publish-update.ps1`(‑Build 없이)로 `latest.json` 생성 |
| `dotnet publish` 실패 | 빌드 PC에 .NET 9 SDK 설치 확인(`dotnet --version`) |

---

## 8. 보안 주의 (반드시 읽기)

자동 업데이트는 **다운로드한 exe를 자동 실행**한다. 적대적 검증에서 확인된 통제 사항:

- **sha256은 무결성(변조·손상 감지)만 보장**하고, **인증성(누가 올렸나)은 보장하지 않는다.** 공유 위치에 **쓰기 가능한 사람은 exe와 해시를 함께 위조**할 수 있고, 그러면 배너를 누른 전원이 그 exe를 실행한다(공급망 위험).
- **근본 통제(권장·필수급)**:
  1. **공유 위치(FTP)의 쓰기 권한을 관리자 전용으로 제한**한다(읽기=전체 허용 OK). 현재 FTP가 "누구나 쓰기"라면 **이것부터** 닫는다.
  2. 여건이 되면 **exe 코드 서명(Authenticode)** — 인증성의 정석.
- 현재는 **소규모 신뢰 내부망** 전제. 규모가 커지거나 신뢰 경계가 넓어지면 위 통제를 먼저 적용한다.
- 설정·로컬 파일(`%APPDATA%\TaskCalendar\`)은 업데이트가 건드리지 않는다(exe만 교체). **캘린더 데이터는 서버 DB**라 업데이트와 무관하다.

---

## 9. 정기 백업·복구 리허설 — 휴지통(영구 삭제) 도입 이후 필수

**영구 삭제에는 되돌리기가 없다**([docs/TRASH-DELETE.md](docs/TRASH-DELETE.md) §7). 관리자가 이름을 그대로 입력해 지우면 그 행은 DB 에서 사라지고, 앱 어디에도 복원 경로가 없다. 그래서 v0.19.0 이후 **마지막 안전망은 백업 하나뿐**이다 — 그리고 백업은 **돌려 본 적이 있을 때만** 안전망이다.

### 9-1. 정기 백업 등록 — `backup-taskmgr.ps1 -Install` (관리자 콘솔, 1회)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File db\deploy\backup-taskmgr.ps1 -Install     # 매주 일요일 03:00 · SYSTEM 계정
powershell -NoProfile -ExecutionPolicy Bypass -File db\deploy\backup-taskmgr.ps1 -Status      # 등록 상태만 조회
powershell -NoProfile -ExecutionPolicy Bypass -File db\deploy\backup-taskmgr.ps1 -Uninstall   # 등록 해제(백업 파일은 남긴다)
```

- 기본값은 `-BackupDir "D:\taskmgr-backup"`(★ C: 와 **다른 물리 볼륨**을 권장한다) · `-Keep 8`(주 1회 → 약 2개월) · `-DbName taskmgr`. `-Install` 은 **그 실행에 준 값 그대로** 등록하므로, 바꿀 값이 있으면 `-Install` 과 함께 준다.
- 자격은 명령줄이 아니라 `%ProgramData%\taskmgr\backup-taskmgr.cnf` 에서 읽는다(`-CnfPath` 로 바꾼다). 파일이 없으면 만드는 법을 찍고 **코드 2** 로 끝난다 — 등록만 해 두고 `.cnf` 를 안 만들면 일요일마다 실패만 쌓인다.
- **0 만 성공이다**(1=검증에 실패한 반쪽 백업 `.partial` · 2=설정 · 3=접속·권한 · 4=도구 없음 · 5=관리자 권한 필요). 종료코드 표의 정본은 스크립트 머리말이다.

### 9-2. 복구 리허설 — `restore-taskmgr.ps1 -Grants`

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File db\deploy\restore-taskmgr.ps1 -Grants                 # 기본 대상은 라이브가 아닌 taskmgr_restore
powershell -NoProfile -ExecutionPolicy Bypass -File db\deploy\restore-taskmgr.ps1 -Grants -DropTarget     # 리허설 뒷정리(표 단위 권한까지 회수)
```

- 검증(표·뷰·트리거·루틴 **이름 집합** + 표별 `COUNT(*)` + 앱 계정 스모크 조회)까지 통과해야 '복구되었다' 고 말할 수 있다. '명령이 안 죽었다' 와는 다른 말이다.
- ★ **`-Grants` 가 스크립트 폴더에서 적용하는 것은 `db/deploy` 의 두 파일이다.** 세 번째 정본인 **비공개 `taskmgr-company-data\05-grants.sql`(`app_user` 의 SELECT·INSERT·UPDATE·DELETE)** 은 이 저장소에 없다 — 형제 폴더(`..\taskmgr-company-data`)에 있으면 스크립트가 찾아 적용하고, **없으면 경고를 찍고 넘어간다**(`-UserGrantsPath` 로 직접 지정할 수 있다). 빠뜨리면 표와 데이터는 다 있는데 **직원 등록·수정·퇴사와 휴지통의 인력 영구 삭제가 전부 ERROR 1142** 로 죽는다. §0-5 의 세 파일이 같은 목록이다.
- 리허설이 끝나면 `SHOW GRANTS FOR 'taskmgr_app'@'%';` 로 **일곱 표 DELETE** 를 다시 확인한다(§0-5).

---

### 부록 — 파일/명령 빠른 참조

| 용도 | 파일 / 명령 |
|---|---|
| 원클릭 배포 빌드 | `installer\배포-빌드.cmd` (더블클릭) |
| 빌드 + 발행(CLI) | `powershell -ExecutionPolicy Bypass -File installer\publish-update.ps1 -Build` |
| 배너 안내문 | `-Notes "요약"` |
| 공유폴더 자동 복사(UNC/로컬) | `-CopyTo "\\서버\TaskCalendar"` |
| 설치기만 빌드 | `powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1` (내부: publish + ISCC) |
| ISCC 경로 지정 | `build-installer.ps1 -Iscc "<ISCC.exe 경로>"` (배포-빌드.cmd에는 없음) |
| 버전 단일 소스 | `widget\TaskCalendarWidget.csproj` `<Version>` |
| 배포 구성(DB 접속 · 업데이트 소스) | `widget\DeployConfig.cs` (§0-1) |
| 소스 URL 상수 | `widget\DeployConfig.cs`의 `UpdateSourceUrl` (시드 지점: `widget\MainWindow.xaml.cs:95`) |
| 결과물 폴더 | `dist\installer\` (Setup exe + latest.json) |
| 로그 | `%APPDATA%\TaskCalendar\widget.log` |
