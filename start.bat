@echo off
title ParliWatch
setlocal EnableDelayedExpansion

echo.
echo =====================================
echo   ParliWatch - Starting services
echo =====================================
echo.

:: ── Read PORT from frontend\.env.local (defaults to 3000) ──────────────────
set FRONTEND_PORT=3000
if exist "%~dp0frontend\.env.local" (
    for /f "usebackq tokens=1,2 delims==" %%a in ("%~dp0frontend\.env.local") do (
        if "%%a"=="PORT" set FRONTEND_PORT=%%b
    )
)

:: Start Docker services (PostgreSQL + Redis)
echo [1/3] Starting databases (Docker)...
docker compose up -d
if errorlevel 1 (
    echo WARNING: Docker failed - make sure Docker Desktop is running.
) else (
    echo       Databases started.
)

:: Start backend in a new terminal window
echo [2/3] Starting backend...
start "ParliWatch - Backend" cmd /k "cd /d "%~dp0backend" && venv\Scripts\activate && uvicorn app.main:app --reload"

:: Give backend a moment to begin starting
timeout /t 2 /nobreak >nul

:: Start frontend in a new terminal window, explicitly passing PORT so Next.js sees it
echo [3/3] Starting frontend (port !FRONTEND_PORT!)...
start "ParliWatch - Frontend" cmd /k "cd /d "%~dp0frontend" && set PORT=!FRONTEND_PORT! && npm run dev"

echo.
echo =====================================
echo   All services launching...
echo =====================================
echo.
echo   Backend:   http://localhost:8000
echo   API docs:  http://localhost:8000/docs
echo   Frontend:  http://localhost:!FRONTEND_PORT!
echo.
echo   To change the frontend port: edit frontend\.env.local
echo   Close the Backend and Frontend windows to stop.
echo.
pause
