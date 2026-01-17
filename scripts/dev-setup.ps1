# DocGen.AI Development Setup Script (Windows PowerShell)

Write-Host "🚀 Setting up DocGen.AI development environment..." -ForegroundColor Cyan

# Check prerequisites
Write-Host "`n📋 Checking prerequisites..." -ForegroundColor Yellow

$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "❌ Node.js not found. Please install Node.js 20+" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Node.js: $nodeVersion" -ForegroundColor Green

$pnpmVersion = pnpm --version 2>$null
if (-not $pnpmVersion) {
    Write-Host "⚠️ pnpm not found. Installing..." -ForegroundColor Yellow
    npm install -g pnpm
}
Write-Host "✓ pnpm: $(pnpm --version)" -ForegroundColor Green

$dockerVersion = docker --version 2>$null
if (-not $dockerVersion) {
    Write-Host "❌ Docker not found. Please install Docker Desktop" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Docker: $dockerVersion" -ForegroundColor Green

# Copy environment file
Write-Host "`n📝 Setting up environment..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Copy-Item "infra/env.example" ".env"
    Write-Host "✓ Created .env file - please add your OPENAI_API_KEY" -ForegroundColor Green
} else {
    Write-Host "✓ .env file already exists" -ForegroundColor Green
}

# Install dependencies
Write-Host "`n📦 Installing dependencies..." -ForegroundColor Yellow
pnpm install

# Start infrastructure
Write-Host "`n🐳 Starting infrastructure services..." -ForegroundColor Yellow
docker-compose up -d postgres redis minio minio-init

Write-Host "`n⏳ Waiting for services to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Setup database
Write-Host "`n🗄️ Setting up database..." -ForegroundColor Yellow
Set-Location apps/api
pnpm db:generate
pnpm db:push
Set-Location ../..

Write-Host "`n✅ Setup complete!" -ForegroundColor Green
Write-Host "`n📌 Next steps:" -ForegroundColor Cyan
Write-Host "   1. Add your OPENAI_API_KEY to .env"
Write-Host "   2. Run 'pnpm dev' to start all services"
Write-Host "   3. Open http://localhost:3000"
Write-Host "`n   Demo credentials: demo@docgen.ai / demo123"

