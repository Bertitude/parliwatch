@echo off
echo Stopping ParliWatch...

:: Kill backend (port 8000)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Kill frontend — reads PORT from .env.local, defaults to 3000
set FRONTEND_PORT=3000
if exist "%~dp0frontend\.env.local" (
    for /f "usebackq tokens=1,2 delims==" %%a in ("%~dp0frontend\.env.local") do (
        if "%%a"=="PORT" set FRONTEND_PORT=%%b
    )
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%FRONTEND_PORT% "') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo Done. All ParliWatch services stopped.
pause
