@echo off
chcp 65001 >nul
rem 자동 실행 등록을 지우고, 지금 돌고 있는 수집 프로그램도 끔
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ssb2mes_retort.bat" 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'pythonw*' -and $_.CommandLine -like '*collector.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>nul
echo 자동 실행을 껐습니다.
pause
