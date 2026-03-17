# ParliWatch Setup Script (Windows)
# Run with: .\setup.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Write-Step($msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    !!  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "    XX  $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  ParliWatch Setup" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# ── Check prerequisites ────────────────────────────────────────────────────────

Write-Step "Checking prerequisites..."

# Python
try {
    $pyVer = python --version 2>&1
    if ($pyVer -match "Python (\d+)\.(\d+)") {
        $major = [int]$Matches[1]; $minor = [int]$Matches[2]
        if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 11)) {
            Write-Fail "Python 3.11+ required. Found: $pyVer"
        }
        Write-OK $pyVer
    }
} catch { Write-Fail "Python not found. Install from https://python.org/downloads" }

# Node.js
try {
    $nodeVer = node --version 2>&1
    Write-OK "Node.js $nodeVer"
} catch { Write-Fail "Node.js not found. Install from https://nodejs.org" }

# Docker
try {
    $dockerVer = docker --version 2>&1
    Write-OK $dockerVer
} catch { Write-Warn "Docker not found — databases won't start automatically. Install from https://docker.com" }

# ffmpeg
try {
    $null = ffmpeg -version 2>&1
    Write-OK "ffmpeg found"
} catch { Write-Warn "ffmpeg not found — live transcription and enhanced tiers won't work. Install from https://ffmpeg.org" }

# ── Backend ────────────────────────────────────────────────────────────────────

Write-Step "Setting up Python backend..."

$backendDir = Join-Path $root "backend"
Set-Location $backendDir

# Create virtualenv
if (-not (Test-Path "venv")) {
    Write-Host "    Creating virtual environment..."
    python -m venv venv
    Write-OK "Virtual environment created"
} else {
    Write-OK "Virtual environment already exists"
}

# Install dependencies
Write-Host "    Installing Python packages (this may take a minute)..."
& "venv\Scripts\pip.exe" install -r requirements.txt --quiet
Write-OK "Python packages installed"

# Copy .env if missing
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-OK ".env created from template"
} else {
    Write-OK ".env already exists"
}

# ── Frontend ───────────────────────────────────────────────────────────────────

Write-Step "Setting up Next.js frontend..."

$frontendDir = Join-Path $root "frontend"
Set-Location $frontendDir

Write-Host "    Installing npm packages (this may take a minute)..."
npm install --silent
Write-OK "npm packages installed"

# ── Done ───────────────────────────────────────────────────────────────────────

Set-Location $root

Write-Host ""
Write-Host "=====================================" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Add your API keys to backend\.env:" -ForegroundColor White
Write-Host "       OPENAI_API_KEY    — enhanced transcription (optional)" -ForegroundColor Gray
Write-Host "       ANTHROPIC_API_KEY — AI summaries (optional)" -ForegroundColor Gray
Write-Host "       GROQ_API_KEY      — live stream transcription (optional)" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. Start the app:" -ForegroundColor White
Write-Host "       .\start.bat" -ForegroundColor Yellow
Write-Host ""
Write-Host "  3. Open http://localhost:3000" -ForegroundColor White
Write-Host ""
