# 재배포 런타임 파일

Inno Setup 설치 파일에는 WebView2 Runtime을 필수로 포함합니다. Microsoft 공식 Evergreen Standalone x64 설치 파일을 아래 이름으로 준비합니다. 작은 온라인 Bootstrapper는 폐쇄망에서 사용할 수 없습니다.

```powershell
New-Item -ItemType Directory -Force redist\winget-webview2 | Out-Null
winget download --id Microsoft.EdgeWebView2Runtime --exact `
  --download-directory redist\winget-webview2 `
  --accept-source-agreements --accept-package-agreements

Get-ChildItem redist\winget-webview2 -Filter *.exe |
  Select-Object -First 1 |
  Copy-Item -Destination redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe -Force
```

`redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe`는 대용량 바이너리라 저장소에는 커밋하지 않습니다. 폐쇄망 빌드 PC에는 이 파일을 반입해야 합니다. 파일이 없으면 PowerShell 빌드와 Inno 직접 컴파일 모두 실패합니다. 빌드 시 자동 다운로드는 하지 않습니다.
