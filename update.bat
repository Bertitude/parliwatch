@echo off
title ParliWatch Updater
setlocal EnableDelayedExpansion

echo.
echo =====================================
echo   ParliWatch - Update from GitHub
echo =====================================
echo.

cd /d "%~dp0"

:: ── Stash any local changes ───────────────────────────────────────────────────
echo [1/5] Checking for local changes...
git diff --quiet 2>nul
if errorlevel 1 (
    echo       Stashing local changes...
    git stash push -m "auto-stash before update"
    set STASHED=1
) else (
    set STASHED=0
    echo       No local changes.
)

:: ── Pull latest ───────────────────────────────────────────────────────────────
echo [2/5] Pulling latest from GitHub...
git pull origin develop
if errorlevel 1 (
    echo.
    echo   ERROR: git pull failed. Check your connection and try again.
    if "!STASHED!"=="1" (
        echo   Restoring your stashed changes...
        git stash pop
    )
    pause
    exit /b 1
)
echo       Done.

:: ── Backend dependencies ──────────────────────────────────────────────────────
echo [3/5] Checking Python dependencies...

:: Check if requirements.txt changed in the last pull
git diff HEAD@{1} HEAD -- backend/requirements.txt 2>nul | findstr /r "." >nul
if not errorlevel 1 (
    echo       requirements.txt changed - installing updates...
    call backend\venv\Scripts\pip.exe install -r backend\requirements.txt --quiet
    if errorlevel 1 (
        echo   WARNING: pip install had errors - check output above.
    ) else (
        echo       Python packages updated.
    )
) else (
    echo       No changes to Python packages.
)

:: ── Frontend dependencies ─────────────────────────────────────────────────────
echo [4/5] Checking npm dependencies...

git diff HEAD@{1} HEAD -- frontend/package.json 2>nul | findstr /r "." >nul
if not errorlevel 1 (
    echo       package.json changed - installing updates...
    cd frontend
    call npm install --silent
    cd ..
    if errorlevel 1 (
        echo   WARNING: npm install had errors - check output above.
    ) else (
        echo       npm packages updated.
    )
) else (
    echo       No changes to npm packages.
)

:: ── Restore stash ─────────────────────────────────────────────────────────────
echo [5/5] Finishing up...
if "!STASHED!"=="1" (
    echo       Restoring your local changes...
    git stash pop
    if errorlevel 1 (
        echo   WARNING: Could not restore stashed changes automatically.
        echo   Run: git stash pop
    )
)

:: ── Summary ───────────────────────────────────────────────────────────────────
echo.
echo =====================================
echo   Update complete!
echo =====================================
echo.
git log -1 --format="  Latest commit: %%h %%s" --date=short
git log -1 --format="  Date:          %%cd" --date=short
echo.
echo   Restart the app to apply changes:
echo     start.bat
echo.
pause
