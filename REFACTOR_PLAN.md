# DocGen.AI - Docker-Free Local Refactoring Plan

## Executive Summary

This plan removes all Docker/container dependencies to enable the application to run on a work laptop where Docker, external downloads (exe), and WSL are blocked.

**Constraints:**
- No Docker or containers
- No external exe downloads
- No WSL
- Can install: Node.js, Python 3.x, pip packages, SQLite

**Goal:** Full functionality running locally without Docker.

---

## Current Architecture vs. Target Architecture

| Component | Current (Docker) | Target (Local) |
|-----------|------------------|----------------|
| Database | PostgreSQL + pgvector | SQLite + better-sqlite3 |
| Vector Search | pgvector extension | In-memory cosine similarity |
| Queue System | Redis + BullMQ | Synchronous execution (optional: better-queue with SQLite) |
| File Storage | MinIO (S3-compatible) | Local filesystem |
| Python Sandbox | Docker container (FastAPI) | Local Python execution (already exists) |
| Repo Sandbox | Docker container (Node.js) | Direct Node.js execution |

---

## Phase 1: Database Migration (PostgreSQL → SQLite)

### 1.1 Replace Prisma PostgreSQL with SQLite

**Files to modify:**
- `apps/api/prisma/schema.prisma` - Change provider and remove pgvector extension
- `apps/api/package.json` - Add better-sqlite3 dependency

**Changes:**
```prisma
// Before
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgvector(map: "vector")]
}

// After
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")  // e.g., "file:./dev.db"
}
```

### 1.2 Handle Vector Embeddings

The `VectorChunk.embedding` field uses `Unsupported("vector(1536)")`. For SQLite:

**Option A (Recommended):** Store embeddings as JSON blob, compute cosine similarity in JavaScript
- Change `embedding` from pgvector to `String` (JSON-serialized array)
- Implement cosine similarity function in TypeScript
- Load relevant chunks into memory for search (works well for small-medium repos)

**Option B:** Use sqlite-vss extension (requires compilation, may not work without admin)

**Implementation:**
```typescript
// New file: apps/api/src/lib/vector-search.ts
export function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

export async function semanticSearch(
  query: string,
  chunks: { id: string; content: string; embedding: number[] }[],
  openai: OpenAI,
  topK: number = 10
): Promise<{ id: string; score: number }[]> {
  // Get query embedding
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });
  const queryEmbedding = response.data[0].embedding;

  // Compute similarities and return top K
  const results = chunks
    .map(chunk => ({
      id: chunk.id,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return results;
}
```

### 1.3 Schema Changes

```prisma
model VectorChunk {
  id           String  @id @default(uuid())
  sourceType   String
  sourcePath   String
  chunkIndex   Int
  content      String
  startLine    Int?
  endLine      Int?
  metadata     String  @default("{}")  // JSON string
  embedding    String?  // JSON array of floats, e.g., "[0.1, 0.2, ...]"

  repoSnapshot   RepoSnapshot? @relation(fields: [repoSnapshotId], references: [id], onDelete: Cascade)
  repoSnapshotId String?
  artifact       Artifact?     @relation(fields: [artifactId], references: [id], onDelete: Cascade)
  artifactId     String?

  createdAt DateTime @default(now())

  @@index([repoSnapshotId])
  @@index([artifactId])
  @@map("vector_chunks")
}
```

---

## Phase 2: Queue System (Redis → Synchronous/SQLite)

### 2.1 Current State

Redis is already optional! The code checks `REDIS_ENABLED` and `isRedisAvailable()`.

**Files affected:**
- `apps/api/src/lib/redis.ts` - Already handles Redis being unavailable
- `apps/api/src/routes/generation.ts` - Already has fallback for no queue

### 2.2 Required Changes

Create a synchronous job executor for when Redis is unavailable:

```typescript
// New file: apps/api/src/lib/sync-job-executor.ts
export async function executeGenerationJob(
  prisma: PrismaClient,
  jobData: { runId: string; templateId: string; ... }
): Promise<void> {
  // Update status to RUNNING
  await prisma.generationRun.update({
    where: { id: jobData.runId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  // Execute the generation logic directly
  // (Import from worker service)
  try {
    await processDocumentGeneration(prisma, jobData);
    await prisma.generationRun.update({
      where: { id: jobData.runId },
      data: { status: 'COMPLETED', finishedAt: new Date() },
    });
  } catch (error) {
    await prisma.generationRun.update({
      where: { id: jobData.runId },
      data: { status: 'FAILED', errorMessage: error.message, finishedAt: new Date() },
    });
  }
}
```

**Modify `apps/api/src/routes/generation.ts`:**
```typescript
if (generationQueue) {
  await generationQueue.add('generate-document', jobData, options);
} else {
  // Execute synchronously (blocks the request but works without Redis)
  // For better UX, could use setImmediate to not block response
  setImmediate(() => executeGenerationJob(app.prisma, jobData));
}
```

---

## Phase 3: File Storage (MinIO → Local Filesystem)

### 3.1 Create Local Storage Adapter

**Replace `apps/api/src/lib/storage.ts`:**

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';

const STORAGE_MODE = process.env.STORAGE_MODE || 'local'; // 'local' or 's3'
const LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH || './storage';

// Ensure storage directory exists
async function ensureStorageDir(): Promise<void> {
  await fs.mkdir(LOCAL_STORAGE_PATH, { recursive: true });
}

export async function uploadFile(
  key: string,
  body: Buffer | Readable,
  contentType: string
): Promise<string> {
  if (STORAGE_MODE === 's3') {
    // ... existing S3 code
  }

  await ensureStorageDir();
  const filePath = path.join(LOCAL_STORAGE_PATH, key);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  if (Buffer.isBuffer(body)) {
    await fs.writeFile(filePath, body);
  } else {
    // Handle Readable stream
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }
    await fs.writeFile(filePath, Buffer.concat(chunks));
  }

  return key;
}

export async function getFile(key: string): Promise<{
  body: Readable;
  contentType: string;
  contentLength: number;
}> {
  if (STORAGE_MODE === 's3') {
    // ... existing S3 code
  }

  const filePath = path.join(LOCAL_STORAGE_PATH, key);
  const stat = await fs.stat(filePath);
  const buffer = await fs.readFile(filePath);

  // Determine content type from extension
  const ext = path.extname(key).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.json': 'application/json',
    '.csv': 'text/csv',
  };

  return {
    body: Readable.from(buffer),
    contentType: mimeTypes[ext] || 'application/octet-stream',
    contentLength: stat.size,
  };
}

export async function deleteFile(key: string): Promise<void> {
  if (STORAGE_MODE === 's3') {
    // ... existing S3 code
  }

  const filePath = path.join(LOCAL_STORAGE_PATH, key);
  await fs.unlink(filePath).catch(() => {}); // Ignore if doesn't exist
}
```

---

## Phase 4: Python Sandbox (Docker → Local Python)

### 4.1 Current State

A local Python execution route already exists at `apps/web/src/app/api/python/route.ts`!

### 4.2 Required Changes

**Unify the sandbox client to prefer local execution:**

Modify `apps/web/src/lib/sandbox-client.ts`:

```typescript
const USE_LOCAL_PYTHON = process.env.NEXT_PUBLIC_USE_LOCAL_PYTHON === 'true' || true;
const SANDBOX_URL = process.env.NEXT_PUBLIC_SANDBOX_PYTHON_URL || 'http://localhost:8001';

export async function isSandboxAvailable(): Promise<boolean> {
  if (USE_LOCAL_PYTHON) {
    // Check local Python availability
    const response = await fetch('/api/python', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check' }),
    });
    const result = await response.json();
    return result.available;
  }
  // ... existing Docker sandbox check
}

export async function generateChart(code: string, context?: {...}): Promise<ChartResult> {
  if (USE_LOCAL_PYTHON) {
    const response = await fetch('/api/python', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'execute',
        code,
        context,
      }),
    });
    return await response.json();
  }
  // ... existing Docker sandbox code
}
```

### 4.3 Required Python Packages

Create `requirements-local.txt` for users to install:

```
matplotlib>=3.7.0
numpy>=1.24.0
pandas>=2.0.0
seaborn>=0.12.0
plotly>=5.14.0
scipy>=1.10.0
openpyxl>=3.1.0
xlrd>=2.0.0
python-docx>=0.8.0
```

User runs: `pip install -r requirements-local.txt`

---

## Phase 5: Repo Sandbox (Docker → Local Node.js)

### 5.1 Current Usage

The repo sandbox is used for:
- Cloning Git repositories
- Running repository commands
- File system operations on cloned repos

### 5.2 Direct Implementation

Since Node.js has native git support via `simple-git` and filesystem access, replace Docker sandbox with direct operations:

```typescript
// apps/api/src/lib/repo-operations.ts
import simpleGit from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';

const REPO_STORAGE_PATH = process.env.REPO_STORAGE_PATH || './repos';

export async function cloneRepository(
  url: string,
  branch: string = 'main'
): Promise<{ localPath: string; commitHash: string }> {
  const repoName = url.split('/').pop()?.replace('.git', '') || 'repo';
  const timestamp = Date.now();
  const localPath = path.join(REPO_STORAGE_PATH, `${repoName}-${timestamp}`);

  await fs.mkdir(localPath, { recursive: true });

  const git = simpleGit();
  await git.clone(url, localPath, ['--branch', branch, '--depth', '1']);

  const repoGit = simpleGit(localPath);
  const log = await repoGit.log({ maxCount: 1 });

  return {
    localPath,
    commitHash: log.latest?.hash || '',
  };
}

export async function getFileManifest(localPath: string): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(localPath, fullPath);

      // Skip .git and node_modules
      if (entry.name === '.git' || entry.name === 'node_modules') continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const stat = await fs.stat(fullPath);
        files.push({
          path: relativePath.replace(/\\/g, '/'),
          size: stat.size,
          language: detectLanguage(entry.name),
        });
      }
    }
  }

  await walk(localPath);
  return files;
}
```

---

## Phase 6: Environment Configuration

### 6.1 New `.env.local` Template

```env
# Database (SQLite)
DATABASE_URL="file:./docgen.db"

# Storage (Local filesystem)
STORAGE_MODE=local
LOCAL_STORAGE_PATH=./storage

# Redis (Disabled - using synchronous execution)
REDIS_ENABLED=false

# Python (Local execution)
NEXT_PUBLIC_USE_LOCAL_PYTHON=true
PYTHON_CMD=python

# Repository storage
REPO_STORAGE_PATH=./repos

# OpenAI / Azure OpenAI (keep existing)
OPENAI_API_KEY=your-key-here
OPENAI_BASE_URL=https://your-azure-endpoint.openai.azure.com/
OPENAI_API_VERSION=2024-02-15-preview

# Auth
NEXTAUTH_SECRET=generate-a-secret-here
NEXTAUTH_URL=http://localhost:3000

# GitHub (optional - for repo cloning)
GITHUB_TOKEN=your-github-token
```

---

## Implementation Order

1. **Phase 1.1-1.3** - Database migration (highest impact, most changes)
2. **Phase 3** - Local filesystem storage (straightforward)
3. **Phase 4** - Python sandbox unification (already partially done)
4. **Phase 5** - Repo operations (moderate complexity)
5. **Phase 2** - Queue system (lowest priority, already has fallback)

---

## Files to Create

| File | Purpose |
|------|---------|
| `apps/api/src/lib/vector-search.ts` | Cosine similarity search |
| `apps/api/src/lib/sync-job-executor.ts` | Synchronous job execution |
| `apps/api/src/lib/repo-operations.ts` | Direct git/fs operations |
| `requirements-local.txt` | Python dependencies |
| `.env.local.example` | Environment template |

---

## Files to Modify

| File | Changes |
|------|---------|
| `apps/api/prisma/schema.prisma` | SQLite provider, JSON embedding |
| `apps/api/src/lib/storage.ts` | Add local filesystem mode |
| `apps/web/src/lib/sandbox-client.ts` | Prefer local Python |
| `apps/api/src/routes/generation.ts` | Sync job execution fallback |
| Various route files | Handle embedding as JSON |

---

## Testing Strategy

1. Run `npx prisma migrate dev` to create SQLite database
2. Test artifact upload/download with local storage
3. Test Python chart generation via `/api/python`
4. Test repo cloning with `simple-git`
5. Test semantic search with in-memory cosine similarity
6. Run full document generation flow

---

## Rollback Strategy

All changes are additive with feature flags:
- `STORAGE_MODE=s3` reverts to MinIO
- `REDIS_ENABLED=true` reverts to Redis
- `NEXT_PUBLIC_USE_LOCAL_PYTHON=false` reverts to Docker sandbox
- Change `DATABASE_URL` back to PostgreSQL connection string

---

## Estimated Complexity

| Phase | Complexity | Risk |
|-------|------------|------|
| 1. Database | High | Medium (data migration) |
| 2. Queue | Low | Low (already has fallback) |
| 3. Storage | Medium | Low |
| 4. Python | Low | Low (already exists) |
| 5. Repo | Medium | Low |

---

---

## CRITIQUE & IMPROVEMENTS

### Critical Issues Identified

#### 1. Worker Service is Tightly Coupled to Redis

**Problem:** The `services/worker` package is a separate process that polls BullMQ queues. Without Redis, jobs simply won't run.

**Original Plan Gap:** The plan only mentions modifying route handlers but doesn't address the worker service architecture.

**Improved Solution:**
Create a unified job executor that can run either:
- **Mode A (with Redis):** Use BullMQ workers as before
- **Mode B (without Redis):** Execute jobs inline in the API request or via `setImmediate`

```typescript
// New: apps/api/src/lib/job-executor.ts
import { isRedisAvailable } from './redis';

// Import job processors directly
import { processDocumentGeneration } from '../../../services/worker/src/jobs/document-generation';
import { processRepoClone } from '../../../services/worker/src/jobs/repo-clone';
// ... etc

export async function executeJob(
  queueName: string,
  jobName: string,
  data: Record<string, unknown>,
  prisma: PrismaClient,
  logger: Logger
): Promise<void> {
  if (isRedisAvailable()) {
    // Queue it for background processing
    const queue = getQueue(queueName);
    await queue.add(jobName, data);
    return;
  }

  // Execute synchronously (blocking but functional)
  const ctx = { prisma, logger, redis: null };

  switch (`${queueName}:${jobName}`) {
    case 'document-generation:generate-document':
      await processDocumentGeneration(data, ctx);
      break;
    case 'repo-processing:clone-repo':
      await processRepoClone(data, ctx);
      break;
    // ... etc
  }
}
```

#### 2. SQLite Limitations with Prisma

**Problem:** Prisma has SQLite-specific limitations:
- `BigInt` fields need special handling (totalSize in schema)
- No native JSON validation (just TEXT)
- No concurrent write transactions
- Enum arrays not supported

**Improved Solution:**
```prisma
model Artifact {
  // Change BigInt to Int for SQLite compatibility
  // (files > 2GB are rare in documentation)
  size Int  // Was: BigInt

  // JSON stored as String
  metadata String @default("{}")
}

model RepoSnapshot {
  totalSize Int @default(0)  // Was: BigInt
}
```

#### 3. Vector Search Performance

**Problem:** In-memory cosine similarity is O(n) for every query. For repos with 10,000+ chunks, this could take seconds.

**Improved Solution - Hybrid Approach:**
1. **First-pass keyword filter:** Use SQLite FTS5 for fast keyword matching
2. **Second-pass semantic:** Only compute embeddings for top ~100 keyword matches
3. **Caching:** Cache recently computed embeddings

```typescript
// Hybrid search implementation
export async function hybridSearch(
  query: string,
  repoSnapshotId: string,
  prisma: PrismaClient,
  openai: OpenAI,
  topK: number = 10
): Promise<SearchResult[]> {
  // 1. Keyword search (fast, SQLite FTS5)
  const keywordMatches = await prisma.$queryRaw`
    SELECT id, content, embedding
    FROM vector_chunks
    WHERE repoSnapshotId = ${repoSnapshotId}
      AND content LIKE ${'%' + query + '%'}
    LIMIT 100
  `;

  // 2. If enough keyword matches, use them; otherwise do full semantic search
  if (keywordMatches.length >= topK) {
    // Semantic re-rank the keyword matches
    return await semanticRerank(query, keywordMatches, openai, topK);
  }

  // 3. Fallback to full semantic search for obscure queries
  const allChunks = await prisma.vectorChunk.findMany({
    where: { repoSnapshotId },
    select: { id: true, content: true, embedding: true },
  });
  return await semanticSearch(query, allChunks, openai, topK);
}
```

#### 4. Authentication on Restricted Network

**Problem:** GitHub OAuth requires external network access, which may be blocked on work laptop.

**Improved Solution:** Add simple local auth mode:

```typescript
// apps/web/src/app/api/auth/[...nextauth]/route.ts
const providers = [];

if (process.env.AUTH_MODE === 'local') {
  providers.push(
    CredentialsProvider({
      name: 'Local',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        // Simple local user lookup
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (user && await bcrypt.compare(credentials.password, user.password)) {
          return user;
        }
        return null;
      },
    })
  );
} else {
  providers.push(GitHubProvider({...}));
}
```

Add environment variable:
```env
AUTH_MODE=local  # or 'github'
```

#### 5. Job Processor Redis Dependency

**Problem:** Job processors in `services/worker/src/jobs/*.ts` receive a `redis` context object and may use it for pub/sub or caching.

Looking at `document-generation.ts`:
```typescript
interface JobContext {
  prisma: PrismaClient;
  logger: Logger;
  redis: Redis;  // <-- Required!
}
```

**Improved Solution:** Make Redis optional in job context:

```typescript
interface JobContext {
  prisma: PrismaClient;
  logger: Logger;
  redis?: Redis | null;  // Optional
}

// In job processors, check before using
function emitProgress(ctx: JobContext, runId: string, progress: number) {
  if (ctx.redis) {
    ctx.redis.publish(`generation:${runId}`, JSON.stringify({ progress }));
  }
  // Always update database (works without Redis)
  ctx.prisma.generationRun.update({
    where: { id: runId },
    data: { progress },
  });
}
```

#### 6. Missing: Local Python Package Installation

**Problem:** Users need to install Python packages. The plan mentions `requirements-local.txt` but doesn't provide setup instructions.

**Improved Solution:** Add setup script:

```powershell
# scripts/setup-local.ps1
Write-Host "Setting up DocGen.AI for local development..."

# Check Python
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Error "Python not found. Please install Python 3.10+"
    exit 1
}

# Create virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install Python packages
pip install -r requirements-local.txt

# Install Node dependencies
pnpm install

# Initialize SQLite database
cd apps/api
npx prisma migrate dev --name init
cd ../..

Write-Host "Setup complete! Run 'pnpm dev' to start."
```

---

## REVISED Implementation Order

Based on criticisms, here's the improved order:

1. **Phase 0: Setup Infrastructure** (NEW)
   - Create setup scripts
   - Add requirements-local.txt
   - Document local auth setup

2. **Phase 1: Database Migration**
   - Modify schema for SQLite compatibility
   - Handle BigInt → Int conversions
   - Test migrations

3. **Phase 2: Worker Service Refactoring** (EXPANDED)
   - Make Redis optional in job contexts
   - Create inline job executor
   - Modify API routes to use executor

4. **Phase 3: Storage Migration**
   - Add local filesystem mode
   - Test artifact upload/download

5. **Phase 4: Python Sandbox Unification**
   - Make local Python the default
   - Ensure Windows path handling

6. **Phase 5: Authentication**
   - Add local credentials provider
   - Test login flow

7. **Phase 6: Vector Search**
   - Implement in-memory cosine similarity
   - Add keyword pre-filter optimization
   - Test with sample repositories

---

## Risk Assessment (Revised)

| Phase | Complexity | Risk | Mitigation |
|-------|------------|------|------------|
| 0. Setup | Low | Low | Provide clear docs |
| 1. Database | High | Medium | Keep PostgreSQL option, test thoroughly |
| 2. Worker | High | Medium | Feature flag for Redis mode |
| 3. Storage | Medium | Low | Storage adapter pattern |
| 4. Python | Low | Low | Already exists |
| 5. Auth | Medium | Low | Simple credentials auth |
| 6. Vector | Medium | Medium | Hybrid keyword+semantic approach |

---

## Questions for User

1. Do you need to migrate existing data from PostgreSQL, or is a fresh start acceptable?
2. For semantic search, is in-memory acceptable (works for repos < 50MB), or do you need disk-based index?
3. Do you need GitHub OAuth login, or is local user/password auth sufficient?
4. **NEW:** Do you want a setup script (PowerShell) to automate the local environment setup?
5. **NEW:** What's the typical size of repositories you'll be documenting? (affects vector search strategy)
