@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo   수행과제 캘린더 - 포터블(자체 포함) 빌드
echo   결과: .NET 설치가 전혀 없는 PC에서도 바로 실행되는 단일 exe
echo ============================================
echo.
echo [필요] .NET 9 SDK. 자체 포함은 런타임 팩 때문에 (최초 1회) 인터넷이 필요합니다.
echo        한 번 성공하면 그 PC는 캐시되어 이후 오프라인 빌드도 됩니다.
echo.

where dotnet >nul 2>nul
if errorlevel 1 ( echo [오류] dotnet 없음. .NET 9 SDK 설치 필요. & pause & exit /b 1 )

dotnet publish widget\TaskCalendarWidget.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "%~dp0dist\portable"
if errorlevel 1 (
  echo.
  echo [실패] 빌드 오류. 인터넷 연결(런타임 팩 다운로드) 또는 .NET 9 SDK 설치를 확인하세요.
  pause & exit /b 1
)

echo.
echo [완료] dist\portable\TaskCalendarWidget.exe
echo  - 이 exe '하나'만 복사하면 .NET 설치 없이 실행됩니다.
echo  - WebView2 런타임은 Windows 10/11 + Edge 에 기본 내장이라 별도 설치 불필요.
start "" explorer "%~dp0dist\portable"
echo.
pause
