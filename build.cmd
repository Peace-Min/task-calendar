@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo   수행과제 캘린더 위젯 - 빌드
echo ============================================
echo.

where dotnet >nul 2>nul
if errorlevel 1 (
  echo [오류] dotnet 을 찾을 수 없습니다.
  echo        .NET 9 SDK 를 먼저 설치하세요. ^(https://dotnet.microsoft.com/download/dotnet/9.0 의 SDK x64^)
  echo        폐쇄망이면 오프라인 설치 파일을 USB로 반입해 설치하면 됩니다.
  echo.
  pause
  exit /b 1
)

echo 사용 중인 .NET SDK:
dotnet --version
echo.
echo 빌드 중... (WebView2 패키지는 저장소에 동봉되어 인터넷 없이 복원됩니다)
echo.

dotnet publish widget\TaskCalendarWidget.csproj -c Release -o "%~dp0dist\app"
if errorlevel 1 (
  echo.
  echo [실패] 빌드 오류가 발생했습니다.
  echo        - .NET 9 SDK 가 설치되어 있는지 확인 ^(dotnet --version 이 9.x 또는 그 이상^)
  echo        - Visual Studio 로 빌드하려면 VS 2022 17.12 이상이 필요합니다.
  echo.
  pause
  exit /b 1
)

echo.
echo [완료] 실행 파일이 생성되었습니다:
echo        %~dp0dist\app\TaskCalendarWidget.exe
echo.
echo 폴더를 엽니다. TaskCalendarWidget.exe 를 더블클릭하면 위젯이 시작됩니다.
echo (exe 하나만 떼지 말고 dist\app 폴더째 두세요 - 옆의 dll 이 필요합니다)
start "" explorer "%~dp0dist\app"
echo.
pause
