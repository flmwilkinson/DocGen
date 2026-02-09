# DocGen.AI

**AI-Powered Documentation Generator from GitHub Repositories**

DocGen.AI is a comprehensive documentation generation platform that analyzes GitHub repositories and automatically generates professional documentation with charts, tables, and evidence-backed content using LLM technology.

---

## Table of Contents

1. [Features](#features)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Local Mode (No Docker)](#local-mode-no-docker)
5. [Full Setup Guide (Docker)](#full-setup-guide)
   - [Step 1: Clone the Repository](#step-1-clone-the-repository)
   - [Step 2: Install Node.js](#step-2-install-nodejs)
   - [Step 3: Install pnpm](#step-3-install-pnpm)
   - [Step 4: Install Docker Desktop](#step-4-install-docker-desktop)
   - [Step 5: Install Dependencies](#step-5-install-dependencies)
   - [Step 6: Environment Configuration](#step-6-environment-configuration)
   - [Step 7: Start Docker Services](#step-7-start-docker-services)
   - [Step 8: Initialize Database](#step-8-initialize-database)
   - [Step 9: Start Development Server](#step-9-start-development-server)
6. [GitHub OAuth Setup](#github-oauth-setup)
7. [OpenAI API Setup](#openai-api-setup)
8. [Project Structure](#project-structure)
9. [Available Scripts](#available-scripts)
10. [Docker Services](#docker-services)
11. [Usage Guide](#usage-guide)
12. [Troubleshooting](#troubleshooting)
13. [Environment Variables Reference](#environment-variables-reference)
14. [Architecture Overview](#architecture-overview)

---

## Features

- **Repository Understanding**: Connect GitHub repos and build knowledge graphs of code structure
- **Smart Templates**: Create templates manually or auto-generate from existing documents
- **AI Generation**: LLM-powered content with citations grounded in your codebase
- **Python Sandbox**: Run data analysis and generate charts from artifacts
- **Rich Editor**: Edit with WYSIWYG editor, regenerate blocks, view citations
- **Export**: Export to Markdown, DOCX, or PDF

---

## Prerequisites

Before starting, ensure you have the following installed:

| Requirement | Minimum Version | Download Link |
|------------|-----------------|---------------|
| Node.js | >= 20.0.0 | https://nodejs.org/ |
| pnpm | >= 9.0.0 | https://pnpm.io/installation |
| Docker Desktop | Latest | https://www.docker.com/products/docker-desktop |
| Git | Latest | https://git-scm.com/downloads |
| OpenAI API Key | - | https://platform.openai.com/api-keys |
| GitHub Account | - | https://github.com/ |

---

## Quick Start

For experienced developers, here's the quick setup:

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/DocGen.git
cd DocGen

# 2. Install dependencies
pnpm install

# 3. Copy environment file and configure
cp apps/web/.env.local.example apps/web/.env.local
# Edit .env.local with your API keys (see Environment Configuration section)

# 4. Start Docker services
docker-compose up -d

# 5. Initialize database
pnpm db:push

# 6. Start development server
pnpm dev
```

Open http://localhost:3000 in your browser.

---

## Local Mode (No Docker)

If you can't use Docker (e.g., corporate restrictions), you can run DocGen.AI entirely locally using SQLite and local Python execution.

### Prerequisites for Local Mode

| Requirement | Minimum Version | Download Link |
|------------|-----------------|---------------|
| Node.js | >= 20.0.0 | https://nodejs.org/ |
| pnpm | >= 9.0.0 | https://pnpm.io/installation |
| Python | >= 3.11 | https://www.python.org/downloads/ |
| Git | Latest | https://git-scm.com/downloads |
| OpenAI API Key | - | https://platform.openai.com/api-keys |

### Local Mode Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/DocGen.git
cd DocGen

# 2. Install Node.js dependencies
pnpm install

# 3. Install Python (Windows)
winget install Python.Python.3.11

# 4. Install Python dependencies
pip install -r requirements.txt
# Or if pip points to wrong Python version:
py -3.11 -m pip install -r requirements.txt

# 5. Configure environment for local mode
cp apps/web/.env.local.example apps/web/.env.local
# Edit .env.local with the local mode settings below

# 6. Initialize SQLite database
cd apps/api && npx prisma db push && cd ../..

# 7. Start development server
pnpm dev
```

### Local Mode Environment Configuration

Create/update `apps/web/.env.local` with these settings:

```env
# ===========================================
# LOCAL MODE CONFIGURATION (No Docker)
# ===========================================

# Database - SQLite instead of PostgreSQL
DATABASE_URL="file:./docgen.db"

# Disable Redis (uses in-memory queue)
REDIS_ENABLED=false

# Local file storage instead of MinIO/S3
STORAGE_MODE=local
LOCAL_STORAGE_PATH=./storage

# Use local Python for chart generation
NEXT_PUBLIC_USE_LOCAL_PYTHON=true

# Authentication mode: "local" (demo user only), "github", or "both"
AUTH_MODE=local

# OpenAI API (REQUIRED)
OPENAI_API_KEY="sk-your-openai-api-key-here"
NEXT_PUBLIC_OPENAI_API_KEY="sk-your-openai-api-key-here"
MODEL_DEFAULT="gpt-4o"
MODEL_FAST="gpt-4o-mini"
MODEL_EMBEDDING="text-embedding-3-small"

# Browser-side model names
NEXT_PUBLIC_OPENAI_MODEL_DEFAULT="gpt-4o"
NEXT_PUBLIC_OPENAI_MODEL_FAST="gpt-4o-mini"

# Authentication (NextAuth)
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-a-random-32-character-string-here"

# GitHub OAuth (optional for local mode)
# Set AUTH_MODE=both to enable GitHub login alongside local auth
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
```

### Python Setup for Charts

Charts are generated by executing Python code locally. Ensure Python is properly installed:

**Windows:**
```bash
# Install Python
winget install Python.Python.3.11

# Install required packages
py -3.11 -m pip install -r requirements.txt

# Verify installation
py -3.11 -c "import matplotlib; import pandas; print('Ready!')"
```

**macOS/Linux:**
```bash
# Install Python (macOS with Homebrew)
brew install python@3.11

# Install required packages
python3 -m pip install -r requirements.txt

# Verify installation
python3 -c "import matplotlib; import pandas; print('Ready!')"
```

**Custom Python version:** The app defaults to `py -3.11` on Windows and `python3` on Unix. If you have a different Python version, set it in `.env.local`:
```env
# Windows with different Python version:
PYTHON_CMD=py -3.12

# macOS/Linux:
PYTHON_CMD=python3.11

# Or full path:
PYTHON_CMD=C:\Python311\python.exe
```

### Local Mode Limitations

- **No background job processing** - Generation runs inline (may be slower for large documents)
- **No vector search** - Uses basic text search instead of semantic search
- **SQLite** - Single-file database, not suitable for production or multiple users
- **Local storage** - Files stored on disk instead of S3-compatible storage

### Demo Credentials

When using `AUTH_MODE=local`, you can log in with:
- **Email:** `demo@docgen.ai`
- **Password:** `demo123`

---

## Full Setup Guide

### Step 1: Clone the Repository

```bash
# Clone from GitHub
git clone https://github.com/YOUR_USERNAME/DocGen.git

# Navigate to project directory
cd DocGen
```

### Step 2: Install Node.js

**Windows:**
1. Download Node.js LTS (v20+) from https://nodejs.org/
2. Run the installer
3. Accept all defaults
4. Verify installation:
   ```bash
   node --version   # Should show v20.x.x or higher
   npm --version    # Should show 10.x.x or higher
   ```

**macOS:**
```bash
# Using Homebrew
brew install node@20

# Or download from https://nodejs.org/
```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Step 3: Install pnpm

pnpm is the required package manager for this monorepo.

```bash
# Install pnpm globally
npm install -g pnpm@9

# Verify installation
pnpm --version   # Should show 9.x.x
```

### Step 4: Install Docker Desktop

**Windows:**
1. Download Docker Desktop from https://www.docker.com/products/docker-desktop
2. Run the installer
3. **Important:** Enable WSL 2 backend during installation
4. Restart your computer
5. Start Docker Desktop
6. Wait for Docker to fully start (green icon in system tray)
7. Verify installation:
   ```bash
   docker --version
   docker-compose --version
   ```

**macOS:**
1. Download Docker Desktop from https://www.docker.com/products/docker-desktop
2. Drag to Applications folder
3. Launch Docker Desktop
4. Grant necessary permissions when prompted

**Linux:**
```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt-get install docker-compose-plugin

# Log out and back in for group changes to take effect
```

### Step 5: Install Dependencies

```bash
# From the project root directory
pnpm install
```

This installs dependencies for all workspaces:
- `apps/web` - Next.js frontend
- `apps/api` - Fastify backend
- `packages/shared` - Shared types and utilities
- `packages/prompts` - LLM prompt templates
- `packages/tools` - Tool definitions
- `services/sandbox-python` - Python execution sandbox
- `services/sandbox-repo` - Repository analysis sandbox

### Step 6: Environment Configuration

Create and configure the environment file:

```bash
# Create .env.local in apps/web directory
# If an example file exists:
cp apps/web/.env.local.example apps/web/.env.local

# Otherwise create it manually
```

Create `apps/web/.env.local` with this content:

```env
# ===========================================
# DocGen.AI Environment Configuration
# ===========================================

# Database
DATABASE_URL="postgresql://docgen:docgen@localhost:5432/docgen?schema=public"
REDIS_URL="redis://localhost:6379"

# Object Storage (MinIO / S3)
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="minioadmin"
S3_BUCKET="docgen-artifacts"
S3_REGION="us-east-1"

# OpenAI API (REQUIRED - see "OpenAI API Setup" section)
OPENAI_API_KEY="sk-your-openai-api-key-here"
NEXT_PUBLIC_OPENAI_API_KEY="sk-your-openai-api-key-here"
MODEL_DEFAULT="gpt-4o"
MODEL_FAST="gpt-4o-mini"
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"

# Authentication (NextAuth)
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-a-random-32-character-string-here"

# GitHub OAuth (REQUIRED - see "GitHub OAuth Setup" section)
GITHUB_CLIENT_ID="your-github-oauth-client-id"
GITHUB_CLIENT_SECRET="your-github-oauth-client-secret"

# GitHub Personal Access Token (optional - for private repo access)
GITHUB_TOKEN=""
NEXT_PUBLIC_GITHUB_TOKEN=""

# Application
NODE_ENV="development"
LOG_LEVEL="debug"
API_PORT=4000
WEB_PORT=3000
WORKER_CONCURRENCY=5

# Sandbox Configuration
SANDBOX_PYTHON_URL="http://localhost:8001"
NEXT_PUBLIC_SANDBOX_PYTHON_URL="http://localhost:8001"
SANDBOX_REPO_URL="http://localhost:8002"
SANDBOX_TIMEOUT_SEC=60
SANDBOX_MEMORY_LIMIT_MB=512

# Security
MAX_UPLOAD_SIZE_MB=100
ALLOWED_FILE_TYPES="csv,json,xlsx,docx,pdf,md,zip,py,js,ts,txt"
```

**Generate NEXTAUTH_SECRET:**
```bash
# On macOS/Linux:
openssl rand -base64 32

# On Windows PowerShell:
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

### Step 7: Start Docker Services

The application requires several Docker services:

```bash
# Start all infrastructure services
docker-compose up -d

# Verify all services are running
docker-compose ps
```

You should see these services running:

| Service | Port | Purpose |
|---------|------|---------|
| docgen-postgres | 5432 | PostgreSQL database with pgvector |
| docgen-redis | 6379 | Redis for caching and queues |
| docgen-minio | 9000/9001 | Object storage (S3-compatible) |
| docgen-sandbox-python | 8001 | Python code execution sandbox |
| docgen-sandbox-repo | 8002 | Repository analysis sandbox |

**First-time Setup:** The MinIO bucket will be automatically created by the `minio-init` service.

**Check service logs:**
```bash
docker-compose logs -f          # All services
docker-compose logs -f postgres  # Specific service
```

### Step 8: Initialize Database

Push the Prisma schema to the database:

```bash
# Generate Prisma client
pnpm db:generate

# Push schema to database
pnpm db:push
```

This creates all database tables defined in `apps/api/prisma/schema.prisma`.

### Step 9: Start Development Server

```bash
# Start all apps in development mode (from project root)
pnpm dev
```

This starts:
- **Web App:** http://localhost:3000
- **API Server:** http://localhost:4000

Open http://localhost:3000 in your browser.

---

## GitHub OAuth Setup

GitHub OAuth allows users to log in and access their repositories.

### Create GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click **"New OAuth App"**
3. Fill in the form:

   | Field | Value |
   |-------|-------|
   | Application name | `DocGen.AI` (or your preferred name) |
   | Homepage URL | `http://localhost:3000` |
   | Application description | AI-powered documentation generator (optional) |
   | Authorization callback URL | `http://localhost:3000/api/auth/callback/github` |

4. Click **"Register application"**
5. Copy the **Client ID**
6. Click **"Generate a new client secret"**
7. **Copy the Client Secret immediately** (you won't see it again!)

### Add to Environment

Update your `apps/web/.env.local`:

```env
GITHUB_CLIENT_ID="Ov23li..."
GITHUB_CLIENT_SECRET="your-client-secret-here"
```

### For Production Deployment

When deploying to production, you'll need to:
1. Create a new GitHub OAuth App (or update existing)
2. Update Homepage URL: `https://your-domain.com`
3. Update Callback URL: `https://your-domain.com/api/auth/callback/github`
4. Update `NEXTAUTH_URL` in your environment: `https://your-domain.com`

---

## OpenAI API Setup

### Option A: Direct OpenAI Access

1. Go to https://platform.openai.com/api-keys
2. Click **"Create new secret key"**
3. Name it (e.g., "DocGen Development")
4. Copy the key immediately (starts with `sk-`)

Update your `apps/web/.env.local`:

```env
OPENAI_API_KEY="sk-your-key-here"
NEXT_PUBLIC_OPENAI_API_KEY="sk-your-key-here"

# Model configuration (defaults work with standard OpenAI)
MODEL_DEFAULT="gpt-4o"
MODEL_FAST="gpt-4o-mini"
MODEL_EMBEDDING="text-embedding-3-small"

# Browser-side model names (must match server-side)
NEXT_PUBLIC_OPENAI_MODEL_DEFAULT="gpt-4o"
NEXT_PUBLIC_OPENAI_MODEL_FAST="gpt-4o-mini"
```

### Option B: Azure OpenAI

If you're using Azure OpenAI, configure the following:

```env
# Azure OpenAI API key
OPENAI_API_KEY="your-azure-api-key"
NEXT_PUBLIC_OPENAI_API_KEY="your-azure-api-key"

# Azure OpenAI endpoint
OPENAI_BASE_URL="https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT"
NEXT_PUBLIC_OPENAI_BASE_URL="https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT"

# Model names should match your Azure deployment names
MODEL_DEFAULT="azure.gpt-4o"
MODEL_FAST="azure.gpt-4o-mini"
MODEL_EMBEDDING="text-embedding-3-small"

# Browser-side model names
NEXT_PUBLIC_OPENAI_MODEL_DEFAULT="azure.gpt-4o"
NEXT_PUBLIC_OPENAI_MODEL_FAST="azure.gpt-4o-mini"
```

**Azure OpenAI Setup Steps:**
1. Create an Azure OpenAI resource in Azure Portal
2. Deploy your models (e.g., gpt-4o, gpt-4o-mini, text-embedding-3-small)
3. Get your API key from "Keys and Endpoint" in your Azure OpenAI resource
4. Set the base URL to your deployment endpoint
5. Use your deployment names as model names in the configuration

### Option C: Corporate Proxy / Custom Endpoint

For corporate proxies or other OpenAI-compatible APIs:

```env
# Your organization's API key
OPENAI_API_KEY="your-corporate-api-key"
NEXT_PUBLIC_OPENAI_API_KEY="your-corporate-api-key"

# Your organization's API endpoint
OPENAI_BASE_URL="https://your-proxy.company.com/v1"
NEXT_PUBLIC_OPENAI_BASE_URL="https://your-proxy.company.com/v1"

# Model names (adjust to your provider's naming)
MODEL_DEFAULT="gpt-4o"
MODEL_FAST="gpt-4o-mini"
```

**Common base URL formats:**

| Provider | Base URL Format |
|----------|-----------------|
| Direct OpenAI | Not needed (default) |
| Azure OpenAI | `https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT` |
| Corporate Proxy | `https://your-proxy.company.com/v1` |
| Local LLM (Ollama) | `http://localhost:11434/v1` |
| Other Compatible APIs | Check your provider's documentation |

### Models Used

| Variable | Default Model | Purpose |
|----------|---------------|---------|
| `MODEL_DEFAULT` | `gpt-4o` | High-quality content generation |
| `MODEL_FAST` | `gpt-4o-mini` | Fast operations, agent tasks |
| `MODEL_EMBEDDING` | `text-embedding-3-small` | Vector embeddings for semantic search |

**Important:** When using Azure OpenAI or other providers, set the model names to match your deployment names exactly.

### Usage & Billing

- Monitor usage at https://platform.openai.com/usage (or your organization's portal)
- Set billing limits at https://platform.openai.com/account/limits
- Estimated cost: $5-20 per document depending on complexity

---

## Project Structure

```
DocGen/
├── apps/
│   ├── web/                      # Next.js frontend (port 3000)
│   │   ├── src/
│   │   │   ├── app/              # App router pages
│   │   │   ├── components/       # React components
│   │   │   ├── lib/              # Utilities, OpenAI client, sandbox client
│   │   │   └── store/            # Zustand state management
│   │   ├── .env.local            # Environment variables
│   │   └── package.json
│   │
│   └── api/                      # Fastify backend (port 4000)
│       ├── src/
│       ├── prisma/
│       │   └── schema.prisma     # Database schema
│       └── package.json
│
├── packages/
│   ├── shared/                   # Shared types and utilities
│   ├── prompts/                  # LLM prompt templates
│   └── tools/                    # Tool definitions
│
├── services/
│   ├── sandbox-python/           # Python execution sandbox (port 8001)
│   │   ├── Dockerfile
│   │   ├── main.py
│   │   └── requirements.txt
│   │
│   └── sandbox-repo/             # Repository sandbox (port 8002)
│       ├── Dockerfile
│       └── index.js
│
├── docker-compose.yml            # Docker services configuration
├── turbo.json                    # Turborepo configuration
├── pnpm-workspace.yaml           # pnpm workspace configuration
└── package.json                  # Root package.json
```

---

## Available Scripts

From the project root:

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Build all apps for production |
| `pnpm lint` | Run ESLint on all apps |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm test` | Run tests |
| `pnpm format` | Format code with Prettier |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:push` | Push schema to database (development) |
| `docker-compose up -d` | Start Docker services |
| `docker-compose down` | Stop Docker services |
| `docker-compose logs -f` | View Docker logs |

---

## Docker Services

### Service Details

**PostgreSQL with pgvector:**
- Image: `pgvector/pgvector:pg16`
- Port: 5432
- Credentials: docgen/docgen
- Features: Vector similarity search for semantic search

**Redis:**
- Image: `redis:7-alpine`
- Port: 6379
- Used for: Caching, job queues (BullMQ)

**MinIO (S3-compatible storage):**
- Image: `minio/minio:latest`
- Ports: 9000 (API), 9001 (Console)
- Credentials: minioadmin/minioadmin
- Console URL: http://localhost:9001

**Python Sandbox:**
- Custom image from `services/sandbox-python`
- Port: 8001
- Purpose: Secure Python code execution for chart generation
- Libraries: pandas, numpy, matplotlib, seaborn, plotly, scipy

**Repo Sandbox:**
- Custom image from `services/sandbox-repo`
- Port: 8002
- Purpose: Repository cloning and analysis

### Rebuild Sandbox Services

If you modify sandbox services:

```bash
docker-compose build sandbox-python sandbox-repo
docker-compose up -d sandbox-python sandbox-repo
```

---

## Usage Guide

### Creating a Project

1. Log in at http://localhost:3000
2. Click "New Project"
3. Enter project name and connect GitHub repo (or upload ZIP)
4. Wait for indexing to complete

### Creating a Template

1. Go to Templates
2. Click "New Template" or upload existing DOCX/PDF
3. Define sections and blocks
4. Configure block types (LLM_TEXT, LLM_TABLE, LLM_CHART, etc.)

### Generating Documentation

1. Open a project
2. Select a template
3. Upload any additional artifacts (CSV, JSON, XLSX)
4. Click "Generate"
5. Review and edit in the document workspace
6. Answer any gap questions
7. Export to DOCX/PDF/MD

---

## Troubleshooting

### Common Issues

**Port Already in Use:**

```bash
# Find process using port 3000 (Windows PowerShell)
Get-NetTCPConnection -LocalPort 3000 | Select-Object -Property OwningProcess
Stop-Process -Id <PID> -Force

# Find process using port 3000 (macOS/Linux)
lsof -i :3000
kill -9 <PID>
```

**Docker Services Not Starting:**

```bash
# Check Docker is running
docker info

# View service logs
docker-compose logs postgres
docker-compose logs minio

# Restart services
docker-compose down
docker-compose up -d
```

**Database Connection Failed:**

```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Test connection
docker exec -it docgen-postgres psql -U docgen -d docgen -c "SELECT 1"

# Reset database (WARNING: deletes all data)
docker-compose down -v
docker-compose up -d
pnpm db:push
```

**Next.js Build Cache Issues:**

```bash
# Clear Next.js cache
rm -rf apps/web/.next

# On Windows PowerShell:
Remove-Item -Recurse -Force apps/web/.next

# Restart development server
pnpm dev
```

**pnpm Install Fails:**

```bash
# Clear pnpm cache
pnpm store prune

# Remove node_modules
rm -rf node_modules apps/*/node_modules packages/*/node_modules

# On Windows PowerShell:
Remove-Item -Recurse -Force node_modules, apps/*/node_modules, packages/*/node_modules

# Reinstall
pnpm install
```

**Sandbox Not Available (Charts not generating - Docker Mode):**

```bash
# Check sandbox services
docker-compose ps sandbox-python sandbox-repo

# View sandbox logs
docker-compose logs sandbox-python

# Rebuild if needed
docker-compose build sandbox-python
docker-compose up -d sandbox-python
```

**Charts Not Generating (Local Mode):**

```bash
# Check Python is installed
python --version
# Or on Windows:
py -3.11 --version

# Check required packages are installed
python -c "import matplotlib; import pandas; import numpy; import seaborn; print('OK')"

# If packages missing, install them:
pip install -r requirements.txt
# Or with specific Python version:
py -3.11 -m pip install -r requirements.txt

# Check if local Python is enabled in .env.local:
# NEXT_PUBLIC_USE_LOCAL_PYTHON=true

# Restart the dev server after changes
pnpm dev
```

**"pip" Points to Wrong Python Version:**

```bash
# Use python -m pip instead of pip directly:
py -3.11 -m pip install matplotlib pandas numpy seaborn

# Or reinstall Python with "Add to PATH" checked
```

**SQLite Database Issues (Local Mode):**

```bash
# Reset the SQLite database
rm apps/web/docgen.db

# Re-initialize
cd apps/api && npx prisma db push && cd ../..
```

**OAuth Callback Error:**

- Verify `NEXTAUTH_URL` matches your actual URL exactly
- Verify callback URL in GitHub OAuth settings: `http://localhost:3000/api/auth/callback/github`
- Check for trailing slashes (should not have one)
- Clear browser cookies and try again

**"NEXTAUTH_SECRET missing" Error:**

- Ensure `NEXTAUTH_SECRET` is set in `.env.local`
- Generate a new secret: `openssl rand -base64 32`

---

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://docgen:docgen@localhost:5432/docgen` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `OPENAI_API_KEY` | OpenAI API key (server-side) | `sk-...` |
| `NEXT_PUBLIC_OPENAI_API_KEY` | OpenAI API key (client-side) | `sk-...` |
| `NEXTAUTH_URL` | Application base URL | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | NextAuth secret (32+ chars) | Random base64 string |
| `GITHUB_CLIENT_ID` | GitHub OAuth Client ID | `Ov23li...` |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth Client Secret | Secret string |

### OpenAI Configuration Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_BASE_URL` | Custom API endpoint (Azure, proxy) | Not set (uses OpenAI default) |
| `NEXT_PUBLIC_OPENAI_BASE_URL` | Custom API endpoint (client-side) | Not set |
| `MODEL_DEFAULT` | Primary LLM model (server-side) | `gpt-4o` |
| `MODEL_FAST` | Fast LLM model (server-side) | `gpt-4o-mini` |
| `MODEL_EMBEDDING` | Embedding model (server-side) | `text-embedding-3-small` |
| `NEXT_PUBLIC_OPENAI_MODEL_DEFAULT` | Primary LLM model (browser) | `gpt-4o` |
| `NEXT_PUBLIC_OPENAI_MODEL_FAST` | Fast LLM model (browser) | `gpt-4o-mini` |
| `NEXT_PUBLIC_OPENAI_MODEL_EMBEDDING` | Embedding model (browser) | `text-embedding-3-small` |
| `OPENAI_EMBEDDING_MODEL` | Legacy embedding model var | `text-embedding-3-small` |

**Note:** For Azure OpenAI or custom providers, set model names to match your deployment names (e.g., `azure.gpt-4o`).

### Other Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_TOKEN` | Personal access token for private repos | - |
| `NEXT_PUBLIC_GITHUB_TOKEN` | GitHub token (client-side) | - |
| `NODE_ENV` | Environment mode | `development` |
| `LOG_LEVEL` | Logging level | `debug` |
| `WORKER_CONCURRENCY` | Number of concurrent worker jobs | `5` |
| `SECTION_BATCH_SIZE` | Parallel block processing batch size | `3` |
| `SANDBOX_TIMEOUT_SEC` | Sandbox execution timeout | `60` |
| `SANDBOX_MEMORY_LIMIT_MB` | Sandbox memory limit | `512` |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      DocGen.AI                              │
├─────────────────────────────────────────────────────────────┤
│  Web App (Next.js)                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Projects │ │Templates │ │Generator │ │ Editor   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├─────────────────────────────────────────────────────────────┤
│  API Server (Fastify)                   Worker (BullMQ)     │
│  ┌──────────┐ ┌──────────┐             ┌──────────┐        │
│  │  REST    │ │WebSocket │             │  Jobs    │        │
│  │  Routes  │ │  Events  │             │Processing│        │
│  └──────────┘ └──────────┘             └──────────┘        │
├─────────────────────────────────────────────────────────────┤
│  Agents & Tools                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │Template  │ │  Block   │ │Knowledge │ │Retrieval │       │
│  │ Builder  │ │ Writer   │ │  Graph   │ │  Agent   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├─────────────────────────────────────────────────────────────┤
│  Infrastructure                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │PostgreSQL│ │  Redis   │ │  MinIO   │ │ OpenAI   │       │
│  │+pgvector │ │          │ │   (S3)   │ │   API    │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, TipTap editor, React Flow
- **Backend**: Fastify, Prisma ORM, PostgreSQL + pgvector
- **Queue**: BullMQ with Redis
- **Storage**: MinIO (S3-compatible)
- **AI**: OpenAI API (GPT-4o, embeddings)

### Security

- Authentication via NextAuth.js with GitHub OAuth
- Sandboxed Python execution (resource limits, isolated environment)
- Isolated repo command execution
- File validation and size limits
- Rate limiting on API endpoints

---

## License

Private - All rights reserved

## Contributing

Contact the development team for contribution guidelines.

