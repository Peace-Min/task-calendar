# 재배포 런타임 파일

Inno Setup 설치 파일에 WebView2 Runtime까지 포함하려면 Microsoft 공식 Standalone x64 설치 파일을 아래 이름으로 준비합니다.

```powershell
New-Item -ItemType Directory -Force redist\winget-webview2 | Out-Null
winget download --id Microsoft.EdgeWebView2Runtime --exact `
  --download-directory redist\winget-webview2 `
  --accept-source-agreements --accept-package-agreements

Get-ChildItem redist\winget-webview2 -Filter *.exe |
  Select-Object -First 1 |
  Copy-Item -Destination redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe -Force
```

`redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe`는 약 190MB라 저장소에는 커밋하지 않습니다.
