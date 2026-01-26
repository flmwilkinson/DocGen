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

# 2. Install Python packages (for chart generation)
pip install pandas numpy matplotlib seaborn

# 3. Setup environment
cp apps/web/.env.local.example apps/web/.env.local
# Edit .env.local - add your API keys and database URL

# 4. Setup database
pnpm db:push

# 5. Run
pnpm dev
```

Open http://localhost:3000

---

## Prerequisites

| Requirement | Version | How to Get |
|-------------|---------|------------|
| Node.js | 20+ | https://nodejs.org |
| pnpm | 9+ | `npm install -g pnpm` |
| Python | 3.8+ | Usually pre-installed |
| OpenAI API Key | - | https://platform.openai.com/api-keys |
| GitHub OAuth | - | https://github.com/settings/developers |
| PostgreSQL | - | **FREE cloud** - see below |

**No local database installation required!** Use a free cloud PostgreSQL:
- [Supabase](https://supabase.com) (recommended) - Free tier available
- [Neon](https://neon.tech) - Free tier available

---

## Setup Guide

### 1. Install Node Dependencies

```bash
git clone https://github.com/flmwilkinson/DocGen.git
cd DocGen
pnpm install
```

### 2. Install Python Packages

```bash
pip install pandas numpy matplotlib seaborn
```

### 3. Get a Free Cloud Database

**Option A: Supabase (Recommended)**
1. Go to https://supabase.com and sign up (free)
2. Create a new project
3. Go to Settings → Database → Connection string
4. Copy the connection string (use "Transaction" mode)

**Option B: Neon**
1. Go to https://neon.tech and sign up (free)
2. Create a new project
3. Copy the connection string from the dashboard

### 4. Configure Environment

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

Edit `apps/web/.env.local`:

```env
# Required: OpenAI
OPENAI_API_KEY="sk-your-key-here"
MODEL_FAST="gpt-4o-mini"
MODEL_DEFAULT="gpt-4o"

# Required: Database (from Supabase or Neon)
DATABASE_URL="postgresql://user:password@host:5432/database"

# Required: GitHub OAuth
GITHUB_CLIENT_ID="your-client-id"
GITHUB_CLIENT_SECRET="your-client-secret"

# Required: Auth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-a-random-32-char-string"

# Local mode (no Docker)
STORAGE_TYPE="local"
PYTHON_EXECUTOR="local"
QUEUE_MODE="inline"
```

### 5. Setup GitHub OAuth

1. Go to https://github.com/settings/developers
2. Click **New OAuth App**
3. Fill in:
   - **Application name**: DocGen.AI
   - **Homepage URL**: http://localhost:3000
   - **Callback URL**: http://localhost:3000/api/auth/callback/github
4. Copy Client ID and Client Secret to `.env.local`

### 6. Initialize Database

```bash
pnpm db:push
```

### 7. Run the Application

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

For Azure OpenAI or other OpenAI-compatible APIs, add to `.env.local`:

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
│   └── worker/       # Background jobs (optional)
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

- Double-check your `DATABASE_URL` connection string
- For Supabase: Use "Transaction" pooler mode connection string
- For Neon: Ensure SSL is enabled (usually automatic)
- Try running `pnpm db:push` again

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
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux
lsof -i :3000
kill -9 <PID>
```

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `DATABASE_URL` | PostgreSQL connection string (Supabase/Neon) |
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
| `OPENAI_BASE_URL` | Custom API endpoint (Azure, proxy, etc.) |

---

## License

Private - All rights reserved

## Contributing

Contact the development team for contribution guidelines.
