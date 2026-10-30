@echo off
chcp 65001 >nul
rem 레토르트 수집 프로그램을 Windows 로그인할 때마다 창 없이 자동 실행되게 등록
rem collector.py 와 같은 폴더(예: C:\ssb2mes\retort)에서 더블클릭

set "PYW=pyw"
where pyw >nul 2>nul || set "PYW=pythonw"
where %PYW% >nul 2>nul || (echo 파이썬을 찾을 수 없습니다. 파이썬 설치를 확인해 주세요. & pause & exit /b 1)

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\ssb2mes_retort.bat" (
  echo @start "" %PYW% "%~dp0collector.py"
)

rem 지금 바로 한 번 실행 (이미 돌고 있으면 새 것은 알아서 끝남)
start "" %PYW% "%~dp0collector.py"

echo.
echo 등록 완료: 이제 로그인할 때마다 수집 프로그램이 창 없이 자동으로 켜집니다.
echo 지금도 실행했습니다. 기록은 %~dp0collector.log 에서 볼 수 있습니다.
echo (열려 있던 검은 수집 창이 있으면 닫아도 됩니다)
pause
