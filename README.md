# DocGen.AI

**AI-Powered Documentation Generator from GitHub Repositories**

DocGen.AI analyzes GitHub repositories and automatically generates professional documentation with charts, tables, and evidence-backed content using LLM technology.

---

## Quick Start (No Docker Required)

```bash
# 1. Clone and install
git clone https://github.com/flmwilkinson/DocGen.git
cd DocGen
pnpm install

# 2. Setup environment
cp apps/web/.env.local.example apps/web/.env.local
# Edit .env.local - add your OpenAI and GitHub OAuth keys

# 3. Setup database (PostgreSQL required)
pnpm db:push

# 4. Run
pnpm dev
```

Open http://localhost:3000

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ | https://nodejs.org |
| pnpm | 9+ | `npm install -g pnpm` |
| PostgreSQL | 14+ | Local install or cloud (Supabase, Neon) |
| Python | 3.8+ | For chart generation |
| OpenAI API Key | - | https://platform.openai.com/api-keys |
| GitHub OAuth | - | https://github.com/settings/developers |

**Docker is NOT required** for local development.

---

## Setup Guide

### 1. Install Dependencies

```bash
# Clone the repository
git clone https://github.com/flmwilkinson/DocGen.git
cd DocGen

# Install Node.js dependencies
pnpm install

# Install Python packages (for chart generation)
pip install pandas numpy matplotlib seaborn
```

### 2. Configure Environment

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

Edit `apps/web/.env.local`:

```env
# Required: OpenAI
OPENAI_API_KEY="sk-your-key-here"
MODEL_FAST="gpt-4o-mini"
MODEL_DEFAULT="gpt-4o"

# Required: GitHub OAuth (create at github.com/settings/developers)
GITHUB_CLIENT_ID="your-client-id"
GITHUB_CLIENT_SECRET="your-client-secret"

# Required: Auth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-a-random-32-char-string"

# Required: Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/docgen"

# Local mode (no Docker)
STORAGE_TYPE="local"
PYTHON_EXECUTOR="local"
QUEUE_MODE="inline"
```

### 3. Setup Database

**Option A: Local PostgreSQL**

```bash
# Create database
createdb docgen

# Or via psql
psql -U postgres -c "CREATE DATABASE docgen;"

# Push schema
pnpm db:push
```

**Option B: Cloud PostgreSQL (Supabase/Neon)**

1. Create a free database at [Supabase](https://supabase.com) or [Neon](https://neon.tech)
2. Copy the connection string to `DATABASE_URL` in `.env.local`
3. Run `pnpm db:push`

### 4. Setup GitHub OAuth

1. Go to https://github.com/settings/developers
2. Click **New OAuth App**
3. Fill in:
   - **Application name**: DocGen.AI
   - **Homepage URL**: http://localhost:3000
   - **Callback URL**: http://localhost:3000/api/auth/callback/github
4. Copy Client ID and Client Secret to `.env.local`

### 5. Run the Application

```bash
pnpm dev
```

Open http://localhost:3000

---

## Features

- **Repository Analysis**: Connect GitHub repos and analyze code structure
- **Smart Templates**: Create or auto-generate documentation templates
- **AI Generation**: LLM-powered content grounded in your codebase
- **Chart Generation**: Python-powered data visualization
- **Rich Editor**: WYSIWYG editing with citations
- **Export**: Markdown, DOCX, or PDF

---

## Azure OpenAI Support

For Azure OpenAI, add to `.env.local`:

```env
OPENAI_API_KEY="your-azure-api-key"
OPENAI_BASE_URL="https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT"
MODEL_FAST="your-deployment-name"
MODEL_DEFAULT="your-deployment-name"
```

---

## Project Structure

```
DocGen/
├── apps/
│   ├── web/          # Next.js frontend (port 3000)
│   └── api/          # Fastify API (port 4000)
├── packages/
│   ├── shared/       # Shared types
│   ├── prompts/      # LLM prompts
│   └── tools/        # Tool definitions
├── services/
│   ├── worker/       # Background jobs (optional)
│   └── sandbox-*/    # Docker sandboxes (optional)
└── data/             # Local storage (auto-created)
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm db:push` | Push database schema |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm lint` | Run linter |
| `pnpm typecheck` | Type check |

---

## Troubleshooting

### Database connection fails

```bash
# Check PostgreSQL is running
pg_isready

# Create database if it doesn't exist
createdb docgen

# Re-run schema push
pnpm db:push
```

### Python charts not generating

```bash
# Check Python is available
python --version  # or python3 --version

# Install required packages
pip install pandas numpy matplotlib seaborn
```

### OAuth callback error

- Verify callback URL matches exactly: `http://localhost:3000/api/auth/callback/github`
- Check `NEXTAUTH_URL` is set to `http://localhost:3000`
- Clear browser cookies and retry

### Port already in use

```bash
# Find and kill process on port 3000
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux
lsof -i :3000
kill -9 <PID>
```

---

## Advanced: Docker Mode

For production or isolated environments, you can use Docker:

```bash
# Start all services
docker-compose up -d

# Update .env.local for Docker mode
STORAGE_TYPE="s3"
PYTHON_EXECUTOR="sandbox"
QUEUE_MODE="redis"
REDIS_URL="redis://localhost:6379"
S3_ENDPOINT="http://localhost:9000"
```

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `DATABASE_URL` | PostgreSQL connection string |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret |
| `NEXTAUTH_URL` | App URL (http://localhost:3000) |
| `NEXTAUTH_SECRET` | Random 32+ char secret |

### Local Mode (Default)

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_TYPE` | `local` | Use local filesystem |
| `PYTHON_EXECUTOR` | `local` | Use local Python |
| `QUEUE_MODE` | `inline` | Process jobs inline |

### Models

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_FAST` | `gpt-4o-mini` | Fast/cheap model |
| `MODEL_DEFAULT` | `gpt-4o` | Default model |
| `MODEL_EMBEDDING` | `text-embedding-3-small` | Embedding model |

### Azure/Custom Endpoint

| Variable | Description |
|----------|-------------|
| `OPENAI_BASE_URL` | Custom API endpoint |

---

## License

Private - All rights reserved

## Contributing

Contact the development team for contribution guidelines.
