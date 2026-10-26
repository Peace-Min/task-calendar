# 설치기 WebView2 오프라인 런타임 필수 포함

상태: 구현 중(2026-10-26)

## 배경과 승인

설치 후 WebView2 미설치 오류가 보고됐다. 기존 설치기는 `redist`에 런타임 설치 파일이 없으면 해당 파일을 말없이 제외했다. 사용자는 오프라인 런타임 패키징 추가와 `feat/db-app` 반영을 승인했다(2026-10-26).

## 바꾸는 것

- 공식 Evergreen Standalone x64 설치기를 `redist/MicrosoftEdgeWebView2RuntimeInstallerX64.exe`에 준비한다. 바이너리는 기존 정책대로 커밋하지 않는다.
- PowerShell 빌드는 publish 전에 파일 존재를 검사한다. 없으면 빌드를 실패시킨다.
- Inno 직접 컴파일도 파일이 없으면 명시적인 오류로 실패한다. 파일과 실행 항목은 항상 설치기에 포함한다.
- 기존 런타임 감지와 `/silent /install`, 종료 대기, 런타임이 있는 PC의 설치 생략은 유지한다.

## 하지 않는 것

버전, DB, 사용자 데이터, 앱 기능은 바꾸지 않는다. 빌드 시 자동 다운로드를 추가하지 않는다. 폐쇄망 빌드 PC에는 공식 설치 파일을 반입한다. 배포 서버나 DB에 발행하지 않는다.

## 검증 순서

공식 파일 다운로드와 서명 확인, 관련 시험과 누락 실패 시험, 자체 포함 publish 및 Inno 컴파일, 로컬 배포 메타데이터 해시 갱신, 전체 strict와 Debug 빌드, 문서와 인계 보고 순으로 확인한다.

## 근거

Microsoft의 [오프라인 배포 안내](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#offline-deployment)는 Standalone Installer를 앱 설치기에 포함하고 런타임이 없을 때 실행하도록 안내한다.
