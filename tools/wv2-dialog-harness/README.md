# WebView2 스크립트 대화상자 하네스

`AreDefaultScriptDialogsEnabled` 와 `ScriptDialogOpening` 의 **실제** 동작을 재현하는 최소 하네스.
netcus 연동 코드의 대화상자 처리를 바꿀 때 **추측 대신 이것으로 확인한다.**

## 왜 있는가

2026-07-30, "detach 에서 설정을 원복하면 안전하다"는 가정으로 자동수락을 켰다가
사용자 인계 흐름(주간 채움 제출·구조 캡처)이 통째로 죽을 뻔했다. 코드 리뷰로는 못 잡았고,
소스 정규식 테스트도 통과했다(원복 '줄의 존재'만 봤기 때문). **이 하네스가 잡았다.**

실측으로 확정된 두 가지 — 문서만 읽어서는 알 수 없다:

1. `AreDefaultScriptDialogsEnabled` 는 **문서 로드 시점에 스냅샷**된다.
   로드한 뒤 원복해도 **이미 로드된 문서에는 적용되지 않는다.**
2. 핸들러를 **붙였다 떼면** 무음 취소가 아니라 **응답 주체 없는 영구 정지**가 된다
   (`suppressed`=처음부터 미부착 과 결과가 다르다).

## 실행

```
dotnet run -- <mode>
WV2HOLD=1 dotnet run -- <mode>     # 스크린샷용으로 창을 열어둔다
```

| mode | 상태 | 기대 |
|---|---|---|
| `control` | 순정 | 다이얼로그 표시 |
| `old` | 설정 없이 핸들러만 부착(= 죽은 코드 시절) | 다이얼로그 표시 |
| `prod` | 설정 끄고 로드 → 로드 뒤 detach | **영구 정지** ← 사고 형태 |
| `prod_pre` | 로드 **전** detach | 다이얼로그 표시 ← 현재 채택 |
| `prod_keephandler` | 설정 끈 채 핸들러 유지 | 무음 ACCEPTED |
| `prod_norestore` | 원복 없음 | `prod` 과 동일(원복이 무의미함을 보임) |
| `prod_afteralert` | 자동화 구간 alert | 핸들러 발동 확인 |

## 판정 방법

`result.txt` 의 `BLOCKED` 는 환경에 따라 무효다 — 하네스가 합성 Enter 로 다이얼로그를 닫는데
다른 앱이 포그라운드를 잡고 있으면 키가 도달하지 않아 모든 모드가 `BLOCKED` 로 끝난다.
**신뢰할 신호는 `WV2HOLD=1` 로 띄운 창의 스크린샷 — 다이얼로그가 렌더되는가** 이다.

## 관련

- `widget/NetcusService.cs` 의 `AttachDialogAutoAccept` 와 7개 op 의 detach 시점
- `tests/netcus-dialog.test.mjs` — "인계 문서 로드 전에 detach 가 끝난다" 계약을 소스 구조로 고정
