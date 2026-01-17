# DocGen.AI

AI-Powered Documentation Platform - Generate professional documentation from your codebase with AI.

## 🚀 Features

- **Repository Understanding**: Connect GitHub repos and build knowledge graphs of code structure
- **Smart Templates**: Create templates manually or auto-generate from existing documents
- **AI Generation**: LLM-powered content with citations grounded in your codebase
- **Python Sandbox**: Run data analysis and generate charts from artifacts
- **Rich Editor**: Edit with WYSIWYG editor, regenerate blocks, view citations
- **Export**: Export to Markdown, DOCX, or PDF

## 📁 Project Structure

```
docgen-ai/
├── apps/
│   ├── web/                 # Next.js frontend (App Router)
│   └── api/                 # Fastify API server
├── services/
│   ├── worker/              # BullMQ background workers
│   ├── sandbox-python/      # Python sandbox service
│   └── sandbox-repo/        # Repo runner sandbox
├── packages/
│   ├── shared/              # Shared types and schemas
│   ├── prompts/             # Agent prompt files
│   └── tools/               # Tool definitions (TODO)
├── infra/                   # Infrastructure configs
├── docker-compose.yml       # Local development stack
└── docs/
    └── ARCHITECTURE.md      # Technical documentation
```

## 🛠️ Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, TipTap editor, React Flow
- **Backend**: Fastify, Prisma ORM, PostgreSQL + pgvector
- **Queue**: BullMQ with Redis
- **Storage**: MinIO (S3-compatible)
- **AI**: OpenAI API (GPT-4.1, embeddings)

## 📋 Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker and Docker Compose
- OpenAI API key

## 🚀 Getting Started

### 1. Clone and Install

```bash
git clone <repo-url>
cd docgen-ai
pnpm install
```

### 2. Environment Setup

```bash
# Copy environment template
cp infra/env.example .env

# Edit .env and add your OpenAI API key
# OPENAI_API_KEY=sk-...
```

### 3. Start Infrastructure

```bash
# Start PostgreSQL, Redis, and MinIO
docker-compose up -d postgres redis minio minio-init

# Wait for services to be healthy
docker-compose ps
```

### 4. Database Setup

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:push
```

### 5. Start Development Servers

```bash
# Terminal 1: API server
cd apps/api && pnpm dev

# Terminal 2: Web app
cd apps/web && pnpm dev

# Terminal 3: Worker
cd services/worker && pnpm dev
```

### 6. Access the Application

- **Web App**: http://localhost:3000
- **API**: http://localhost:4000
- **API Docs**: http://localhost:4000/docs
- **MinIO Console**: http://localhost:9001 (minioadmin/minioadmin)

## 🔑 Demo Credentials

```
Email: demo@docgen.ai
Password: demo123
```

## 📖 Usage

### Creating a Project

1. Log in at http://localhost:3000
2. Click "New Project"
3. Enter project name and connect GitHub repo (or upload ZIP)
4. Wait for indexing to complete

### Creating a Template

1. Go to Templates
2. Click "New Template" or upload existing DOCX/PDF
3. Define sections and blocks
4. Configure block types (LLM_TEXT, LLM_TABLE, etc.)

### Generating Documentation

1. Open a project
2. Select a template
3. Upload any additional artifacts (CSV, JSON, XLSX)
4. Click "Generate"
5. Review and edit in the document workspace
6. Answer any gap questions
7. Export to DOCX/PDF/MD

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection | `postgresql://docgen:docgen@localhost:5432/docgen` |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |
| `OPENAI_API_KEY` | OpenAI API key | Required |
| `MODEL_DEFAULT` | Default LLM model | `gpt-4.1` |
| `MODEL_FAST` | Fast LLM model | `gpt-4.1-mini` |
| `S3_ENDPOINT` | S3/MinIO endpoint | `http://localhost:9000` |

## 🏗️ Development

### Running Tests

```bash
pnpm test
```

### Type Checking

```bash
pnpm typecheck
```

### Linting

```bash
pnpm lint
```

### Building for Production

```bash
pnpm build
```

## 📊 Architecture Overview

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

## 🔐 Security

- Authentication via NextAuth.js
- Sandboxed Python execution (no network, resource limits)
- Isolated repo command execution
- File validation and size limits
- Rate limiting on API endpoints

## 📝 TODO

- [ ] Full vector search implementation with pgvector
- [ ] Template-from-document agent
- [ ] Chart rendering in TipTap
- [ ] DOCX/PDF export via Pandoc
- [ ] E2E tests with Playwright
- [ ] GitHub OAuth integration
- [ ] Private repo support

## 📄 License

Private - All rights reserved

## 🤝 Contributing

Contact the development team for contribution guidelines.

