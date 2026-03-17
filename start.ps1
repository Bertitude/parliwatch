# ParliWatch — hidden server launcher
# Starts backend and frontend with no visible terminal windows.
# All output is written to logs\backend.log and logs\frontend.log.

$root = $PSScriptRoot

# ── Logs directory ────────────────────────────────────────────────────────────
$logsDir = Join-Path $root "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

# Truncate logs on each start so you always see the latest run
"" | Out-File -FilePath (Join-Path $logsDir "backend.log")  -Encoding utf8
"" | Out-File -FilePath (Join-Path $logsDir "frontend.log") -Encoding utf8

# ── Read frontend port from .env.local ────────────────────────────────────────
$frontendPort = "3000"
$envFile = Join-Path $root "frontend\.env.local"
if (Test-Path $envFile) {
    $match = Select-String -Path $envFile -Pattern "^PORT=(.+)" | Select-Object -First 1
    if ($match) { $frontendPort = $match.Matches[0].Groups[1].Value.Trim() }
}

# ── Docker ────────────────────────────────────────────────────────────────────
Write-Host "[1/3] Starting databases (Docker)..."
$docker = Start-Process -FilePath "docker" -ArgumentList "compose up -d" `
    -WorkingDirectory $root -Wait -PassThru -WindowStyle Hidden
if ($docker.ExitCode -ne 0) {
    Write-Host "      WARNING: Docker failed — make sure Docker Desktop is running."
} else {
    Write-Host "      Databases started."
}

# ── Backend ───────────────────────────────────────────────────────────────────
Write-Host "[2/3] Starting backend (logs\backend.log)..."
$backendLog = Join-Path $logsDir "backend.log"
$backendCmd  = "cd /d `"$root\backend`" && `"$root\venv\Scripts\activate`" && uvicorn app.main:app --reload >> `"$backendLog`" 2>&1"
Start-Process -FilePath "cmd" -ArgumentList "/c $backendCmd" -WindowStyle Hidden

Start-Sleep -Seconds 2

# ── Frontend ──────────────────────────────────────────────────────────────────
Write-Host "[3/3] Starting frontend on port $frontendPort (logs\frontend.log)..."
$frontendLog = Join-Path $logsDir "frontend.log"
$frontendCmd = "cd /d `"$root\frontend`" && set PORT=$frontendPort && npm run dev >> `"$frontendLog`" 2>&1"
Start-Process -FilePath "cmd" -ArgumentList "/c $frontendCmd" -WindowStyle Hidden

Write-Host ""
Write-Host "====================================="
Write-Host "  ParliWatch is starting..."
Write-Host "====================================="
Write-Host ""
Write-Host "  Frontend:  http://localhost:$frontendPort"
Write-Host "  Backend:   http://localhost:8000"
Write-Host "  Logs:      http://localhost:$frontendPort/logs"
Write-Host ""
Write-Host "  Run stop.bat to shut everything down."
Write-Host ""
