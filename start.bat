@echo off
title ParliWatch

echo.
echo =====================================
echo   ParliWatch - Starting services
echo =====================================
echo.

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

:: Start frontend in a new terminal window
echo [3/3] Starting frontend...
start "ParliWatch - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo =====================================
echo   All services launching...
echo =====================================
echo.
echo   Backend:   http://localhost:8000
echo   API docs:  http://localhost:8000/docs
echo   Frontend:  http://localhost:3000
echo.
echo   Close the Backend and Frontend windows to stop.
echo.
pause
