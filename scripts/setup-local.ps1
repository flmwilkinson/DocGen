# DocGen.AI - Local Setup Script (PowerShell)
# Run this script to set up the application without Docker
# Usage: .\scripts\setup-local.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " DocGen.AI Local Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "[1/6] Checking Node.js..." -ForegroundColor Yellow
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error "Node.js not found. Please install Node.js 20+ from https://nodejs.org/"
    exit 1
}
$nodeVersion = node --version
Write-Host "  Found Node.js $nodeVersion" -ForegroundColor Green

# Check pnpm
Write-Host "[2/6] Checking pnpm..." -ForegroundColor Yellow
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
    Write-Host "  pnpm not found, installing..." -ForegroundColor Yellow
    npm install -g pnpm
}
$pnpmVersion = pnpm --version
Write-Host "  Found pnpm $pnpmVersion" -ForegroundColor Green

# Check Python
Write-Host "[3/6] Checking Python..." -ForegroundColor Yellow
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Error "Python not found. Please install Python 3.10+ from https://python.org/"
    exit 1
}
$pythonVersion = python --version
Write-Host "  Found $pythonVersion" -ForegroundColor Green

# Install Python packages
Write-Host "[4/6] Installing Python packages..." -ForegroundColor Yellow
if (Test-Path ".\.venv") {
    Write-Host "  Virtual environment exists, activating..." -ForegroundColor Gray
} else {
    Write-Host "  Creating virtual environment..." -ForegroundColor Gray
    python -m venv .venv
}

# Activate and install
& .\.venv\Scripts\Activate.ps1
pip install -r requirements-local.txt --quiet
Write-Host "  Python packages installed" -ForegroundColor Green

# Install Node dependencies
Write-Host "[5/6] Installing Node.js dependencies..." -ForegroundColor Yellow
pnpm install
Write-Host "  Node.js packages installed" -ForegroundColor Green

# Setup environment file
Write-Host "[6/6] Setting up environment..." -ForegroundColor Yellow
if (-not (Test-Path ".\.env.local")) {
    if (Test-Path ".\.env.local.example") {
        Copy-Item ".\.env.local.example" ".\.env.local"
        Write-Host "  Created .env.local from template" -ForegroundColor Green
        Write-Host "  IMPORTANT: Edit .env.local and add your API keys!" -ForegroundColor Yellow
    } else {
        Write-Host "  No .env.local.example found, please create .env.local manually" -ForegroundColor Yellow
    }
} else {
    Write-Host "  .env.local already exists" -ForegroundColor Green
}

# Initialize database
Write-Host ""
Write-Host "Initializing SQLite database..." -ForegroundColor Yellow
Push-Location apps\api
npx prisma generate
npx prisma db push
Pop-Location
Write-Host "  Database initialized" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Edit .env.local with your OpenAI/Azure API keys" -ForegroundColor Gray
Write-Host "  2. Run 'pnpm dev' to start the development server" -ForegroundColor Gray
Write-Host "  3. Open http://localhost:3000 in your browser" -ForegroundColor Gray
Write-Host ""
