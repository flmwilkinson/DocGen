# DocGen.AI - Local Setup Guide (No Docker)

This guide explains how to run DocGen.AI locally without Docker, WSL, or external downloads.

## Prerequisites

1. **Node.js 20+** - [Download](https://nodejs.org/)
2. **Python 3.10+** - [Download](https://python.org/)
3. **Git** - [Download](https://git-scm.com/)
4. **Azure OpenAI or OpenAI API access** - For LLM features

## Quick Start

### 1. Clone and Setup

```powershell
# Clone the repository (if not already done)
git clone <your-repo-url>
cd DocGen

# Switch to the local-only branch
git checkout feature/no-docker-local-only

# Run the setup script
.\scripts\setup-local.ps1
```

### 2. Configure Environment

Edit `.env.local` with your settings:

```env
# Database (SQLite - no Docker needed)
DATABASE_URL="file:./docgen.db"

# Storage (local filesystem)
STORAGE_MODE=local
LOCAL_STORAGE_PATH=./storage

# Disable Redis (runs jobs inline)
REDIS_ENABLED=false

# Python (local execution)
NEXT_PUBLIC_USE_LOCAL_PYTHON=true
PYTHON_CMD=python

# Azure OpenAI (required)
OPENAI_API_KEY=your-azure-api-key
OPENAI_BASE_URL=https://your-resource.openai.azure.com/openai/deployments/gpt-4o
MODEL_DEFAULT=gpt-4o
MODEL_FAST=gpt-4o-mini
MODEL_EMBEDDING=text-embedding-3-small

# Auth (local credentials)
AUTH_MODE=local
NEXTAUTH_SECRET=your-secret-here
NEXTAUTH_URL=http://localhost:3000
```

### 3. Initialize Database

```powershell
cd apps\api
npx prisma db push
cd ..\..
```

### 4. Start Development Server

```powershell
pnpm dev
```

Open http://localhost:3000 in your browser.

## Login Credentials

Default demo user:
- **Email:** demo@docgen.ai
- **Password:** demo123

Add more users via environment variable:
```env
LOCAL_USERS=user1@example.com:password1:User One|user2@example.com:password2:User Two
```

## Architecture Changes

### Database: SQLite instead of PostgreSQL

- Data stored in `./docgen.db` file
- No pgvector extension - uses in-memory vector search
- JSON fields stored as strings

### Storage: Local Filesystem instead of MinIO

- Files stored in `./storage/` directory
- Same API, different backend

### Jobs: Inline Execution instead of Redis+BullMQ

- Jobs run synchronously (may block UI briefly for large operations)
- No separate worker process needed

### Python: Local Execution instead of Docker Sandbox

- Uses your local Python installation
- Requires Python packages: `pip install -r requirements-local.txt`
- Less isolated but works without Docker

## Troubleshooting

### "Python not found"

Ensure Python is in your PATH:
```powershell
python --version
# Should show Python 3.10+
```

### "Database is locked"

SQLite only allows one write at a time. If you see this error:
1. Close other database connections
2. Restart the development server

### "Module not found" for Python

Install required packages:
```powershell
pip install -r requirements-local.txt
```

### Chart generation fails

Check that matplotlib and other visualization packages are installed:
```powershell
pip install matplotlib pandas numpy seaborn plotly
```

## Data Migration (from PostgreSQL)

If you have existing data in PostgreSQL:

```powershell
# Set source database URL
$env:SOURCE_DATABASE_URL = "postgresql://user:pass@localhost:5432/docgen"

# Set target SQLite path
$env:DATABASE_URL = "file:./docgen.db"

# Run migration
npx ts-node scripts/migrate-pg-to-sqlite.ts migrate
```

## Performance Notes

- **Large repositories (>50MB)**: Vector search uses hybrid keyword+semantic approach
- **Concurrent users**: SQLite handles single-writer only; for multi-user, consider PostgreSQL
- **Job execution**: Without Redis, jobs block the request; large repos may take longer

## Reverting to Docker

To switch back to Docker-based infrastructure:

1. Change `DATABASE_URL` to PostgreSQL connection string
2. Set `STORAGE_MODE=s3` and configure MinIO credentials
3. Set `REDIS_ENABLED=true` and configure Redis URL
4. Set `NEXT_PUBLIC_USE_LOCAL_PYTHON=false`
5. Run `docker-compose up -d`
