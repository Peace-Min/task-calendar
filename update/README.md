# 자동 업데이트 — 사내 공유 배포 (v0.8.0+)

> **목표**: 관리자가 **공유 위치 한 곳**에 새 인스톨러 + `latest.json`을 올리면, 각 위젯이 알아서 확인·배너 알림·설치. "매번 개별 배포" 제거.
> 코드: `widget/Update.cs`(호스트) · `task-calendar-prototype.html`(배너/설정) · `installer/publish-update.ps1`(발행) · `installer/task-calendar.iss`(무인 설치).

## 흐름
```
[관리자] 공유폴더에 latest.json + TaskCalendarWidget-Setup-vX.exe 갱신(한 곳만)
[각 위젯] 시작(~9s)+30분마다 백그라운드로 latest.json 확인
   · 접근 실패/최신 → 무음(배너 없음)      · json.version > 내 버전 → 상단 배너
     배너: 🆕 새 버전 X 있습니다  [변경내역]  [업데이트]
       └ [업데이트] → 인스톨러 로컬 임시복사 → sha256 검증 → /SILENT 설치 → 재시작 (data.xml 불변)
```

## ⚠ 부트스트랩 — 딱 한 번은 수동
자동 업데이트는 **그 기능이 이미 든 버전(v0.8.0+)** 에만 신호를 밀 수 있다. 지금 배포된 v0.7.x는 자동 업데이트를 모른다.
1. **v0.9.0 인스톨러(현재 배포판)를 동료에게 전달·설치**.
2. 자동 업데이트 소스: v0.9.0은 `DefaultUpdateSourceUrl = "ftp://192.168.1.175/"`가 기본 박혀 있어 **신규 설치 시 그 FTP를 자동 확인(zero-touch)**. 그 FTP 루트에 `latest.json` + Setup exe를 올려두면 됨. 다른 주소로 바꾸려면 각 PC 설정의 '소스 URL' 또는 상수 재빌드. (끄려면 소스 URL 비움.)
3. 이후부터는 공유폴더만 갱신 → 자동 전파.

## 공유 위치 구성
소스 URL은 `ftp://<IP>/TaskCalendar/` · `http(s)://…/` · UNC(`\\server\share\…`) 모두 지원. 그 위치에 **두 파일**:
```
latest.json
TaskCalendarWidget-Setup-v0.8.1.exe
```
`latest.json`:
```json
{ "version": "0.8.1", "file": "TaskCalendarWidget-Setup-v0.8.1.exe", "notes": "요약", "sha256": "<소문자 hex>" }
```

## 발행 절차 (새 버전 낼 때)
```
# 1) 인스톨러 빌드 (버전은 csproj <Version> 단일소스)
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
# 2) latest.json 생성(+ 공유 위치로 복사)
powershell -File installer\publish-update.ps1 -CopyTo "\\server\share\TaskCalendar"   # 또는 -CopyTo 없이 생성만 후 수동 업로드
```
→ `dist\installer\`의 `Setup exe`와 `latest.json`을 공유 위치에 올리면 끝.

## 테스트 팁
- **배너만 테스트**: `latest.json`의 `version`만 설치본보다 높이면 배너가 뜬다(인스톨러 재빌드 불필요).
- **설치까지 테스트**: `file`이 가리키는 인스톨러가 실제로 그 폴더에 있어야 한다. (버전만 올리고 file이 옛 설치본이면 같은 버전이 깔려 배너가 계속 뜸.)
- 설정 → 자동 업데이트 → **지금 확인**으로 즉시 확인.

## 🔒 보안 — 반드시 읽기
자동 업데이트는 **다운로드한 exe를 자동 실행**한다. 적대 검증에서 확인된 사항:
- **sha256 필수**(v0.8.0): 해시 없는/불일치 매니페스트는 설치 거부. → 변조·손상 **감지**.
- 그러나 sha256은 **인증성(누가 올렸나)** 을 보장하지 않는다 — 소스에 **쓰기 가능한 사람은 exe와 해시를 함께 위조**할 수 있다. 그러면 배너를 누른 전원이 그 exe를 실행한다(공급망 위험).
- **근본 통제(권장·필수급)**:
  1. **공유 위치 쓰기 권한을 관리자 전용으로 제한**(읽기=전체 OK). 현재 FTP가 "누구나 쓰기"면 이걸 먼저 닫을 것.
  2. 여건 되면 **exe 코드 서명**(Authenticode) — 인증성의 정석.
- 현재는 **소규모 신뢰 내부망** 전제로 진행. 규모가 커지거나 신뢰경계가 넓어지면 위 통제를 먼저 적용할 것.

## 동작 세부
- 실패(접근 불가·매니페스트 없음·손상·다운로드 실패·해시 없음/불일치·다운그레이드)는 **백그라운드에선 전부 무음**, 사용자 클릭(업데이트/지금 확인) 시에만 사유 표시.
- File/UNC I/O는 백그라운드 스레드+타임아웃 → 죽은 공유여도 위젯 UI 안 멈춤.
- `data.xml`(개인 데이터)·설정은 업데이트가 건드리지 않음(exe만 교체).
