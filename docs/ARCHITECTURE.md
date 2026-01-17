# DocGen.AI Architecture

## Overview

DocGen.AI is an AI-powered documentation platform that generates professional technical documentation from codebases. It uses a modular, agent-based architecture with strict type safety and separation of concerns.

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                    │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │  Web Browser (Next.js App)                                      │  │
│   │  - Project management                                           │  │
│   │  - Template builder UI                                          │  │
│   │  - Document editor (TipTap)                                     │  │
│   │  - Knowledge graph visualization (React Flow)                   │  │
│   └─────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ HTTP/WebSocket
┌──────────────────────────────▼─────────────────────────────────────────┐
│                          API LAYER                                      │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │  Fastify Server                                                 │  │
│   │  - REST endpoints (/api/*)                                      │  │
│   │  - WebSocket events (generation progress)                       │  │
│   │  - File uploads (multipart)                                     │  │
│   │  - Rate limiting, auth, validation                              │  │
│   └─────────────────────────────────────────────────────────────────┘  │
└──────────────┬────────────────────────────────────┬────────────────────┘
               │                                    │
    ┌──────────▼──────────┐              ┌─────────▼─────────┐
    │  PostgreSQL + pgvector            │   Redis + BullMQ  │
    │  - Entities                        │   - Job queues    │
    │  - Vector embeddings               │   - Pub/sub       │
    │  - Knowledge graphs                │   - Caching       │
    └─────────────────────┘              └─────────┬─────────┘
                                                   │
┌──────────────────────────────────────────────────▼─────────────────────┐
│                         WORKER LAYER                                    │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │  BullMQ Workers                                                 │  │
│   │                                                                 │  │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │  │
│   │  │ Repo Clone  │  │  KG Build   │  │  Vector     │             │  │
│   │  │    Job      │  │    Job      │  │  Index Job  │             │  │
│   │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │  │
│   │         │                │                │                     │  │
│   │  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐             │  │
│   │  │ Doc Generate│  │Block Regen  │  │   Export    │             │  │
│   │  │    Job      │  │    Job      │  │    Job      │             │  │
│   │  └─────────────┘  └─────────────┘  └─────────────┘             │  │
│   └─────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────────┐
│                         AGENT LAYER                                     │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │  DocGenOrchestrator                                             │  │
│   │  - Coordinates agent execution                                  │  │
│   │  - Manages dependencies between blocks                          │  │
│   │  - Handles gap detection and user input                         │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│   │  Template    │ │  Block       │ │  Table       │ │  Chart       │ │
│   │  Builder     │ │  Writer      │ │  Builder     │ │  Builder     │ │
│   │  Agent       │ │  Agent       │ │  Agent       │ │  Agent       │ │
│   └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ │
│                                                                         │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│   │  Block       │ │  Gap         │ │  KG          │ │  Retrieval   │ │
│   │  Planner     │ │  Detector    │ │  Builder     │ │  Agent       │ │
│   │  Agent       │ │  Agent       │ │  Agent       │ │              │ │
│   └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────────┐
│                         TOOLS LAYER                                     │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│   │ repo_clone   │ │semantic_search│ │python_sandbox│ │ repo_runner  │ │
│   └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│   │ build_kg     │ │vector_index  │ │ export_doc   │ │doc_render    │ │
│   └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────────┐
│                      EXTERNAL SERVICES                                  │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│   │   OpenAI     │ │    MinIO     │ │Python Sandbox│ │ Repo Sandbox │ │
│   │     API      │ │    (S3)      │ │   Service    │ │   Service    │ │
│   └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Document Generation Flow

```
1. User selects template + connects repo/artifacts
                    │
                    ▼
2. API creates GenerationRun (status: PENDING)
                    │
                    ▼
3. Job queued to 'document-generation' queue
                    │
                    ▼
4. Worker picks up job, starts orchestration
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
5a. Load KG    5b. Load        5c. Load
    from DB        Templates       Artifacts
    │               │               │
    └───────────────┼───────────────┘
                    │
                    ▼
6. For each block in template:
    │
    ├─► Run BlockPlannerAgent
    │   - Determine strategy (RETRIEVE/PYTHON/etc)
    │   - Generate retrieval queries
    │
    ├─► Execute semantic_search tool
    │   - Get relevant code chunks
    │
    ├─► Run BlockWriterAgent (or Table/Chart agent)
    │   - Generate content with citations
    │   - Output structured JSON
    │
    └─► Store BlockOutput in DB
                    │
                    ▼
7. Build TipTap document JSON
                    │
                    ▼
8. Run GapDetectorAgent
    - Identify missing information
    - Create GapQuestion records
                    │
                    ▼
9. Update GenerationRun (status: COMPLETED)
                    │
                    ▼
10. Publish completion event via Redis
                    │
                    ▼
11. WebSocket notifies web client
```

### Knowledge Graph Building Flow

```
1. RepoSnapshot created (status: PENDING)
                    │
                    ▼
2. Clone job processes:
    - Clone repo to local path
    - Build file manifest
    - Detect languages
                    │
                    ▼
3. KG job processes:
    - Parse TS/JS with ts-morph
    - Parse Python with regex/AST
    - Extract symbols (classes, functions)
    - Build import graph
    - Create nodes and edges
                    │
                    ▼
4. Store KG JSON in database
                    │
                    ▼
5. Vector index job:
    - Chunk all text files
    - Generate embeddings via OpenAI
    - Store vectors in pgvector
                    │
                    ▼
6. RepoSnapshot (status: READY)
```

## Data Model

### Core Entities

```
User
  └── owns many → Project
                    ├── has many → RepoSnapshot
                    │                └── has one → KnowledgeGraph
                    │                └── has many → VectorChunk
                    ├── has many → Artifact
                    ├── has many → Template
                    └── has many → GenerationRun
                                    ├── has many → DocumentVersion
                                    │                └── has many → BlockOutput
                                    ├── has many → GapQuestion
                                    └── has many → AgentTrace
```

### Template Schema

```typescript
Template {
  templateId: UUID
  name: string
  version: string
  sections: Section[]
}

Section {
  id: UUID
  title: string
  level: 1-6
  childrenSections: Section[]
  blocks: Block[]
}

Block {
  id: UUID
  type: STATIC_TEXT | LLM_TEXT | LLM_TABLE | LLM_CHART | USER_INPUT
  title: string
  instructions: string
  inputs: InputRef[]
  outputContract: OutputContract
  regenerationPolicy: RegenerationPolicy
  citationPolicy: CitationPolicy
}
```

## Agent Architecture

### Agent Interface

Each agent follows a consistent interface:

```typescript
interface Agent {
  name: string;
  prompts: {
    system: string;
    task: string;
    examples?: string;
  };
  inputSchema: ZodSchema;
  outputSchema: ZodSchema;
  execute(input: Input, context: Context): Promise<Output>;
}
```

### Agent Execution

```typescript
async function executeAgent(agent: Agent, input: Input, context: Context) {
  // 1. Validate input
  const validatedInput = agent.inputSchema.parse(input);
  
  // 2. Build messages
  const messages = buildMessages(agent.prompts, validatedInput, context);
  
  // 3. Call LLM with structured output
  const response = await openai.chat.completions.create({
    model: MODEL_DEFAULT,
    messages,
    response_format: { type: 'json_object' },
    tools: context.availableTools,
  });
  
  // 4. Handle tool calls if any
  if (response.choices[0].message.tool_calls) {
    // Execute tools and loop
  }
  
  // 5. Validate and return output
  return agent.outputSchema.parse(JSON.parse(response.content));
}
```

## Tool System

### Tool Definition

```typescript
interface Tool {
  name: string;
  description: string;
  inputSchema: ZodSchema;
  outputSchema: ZodSchema;
  execute(input: Input): Promise<Output>;
}
```

### Available Tools

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `repo_clone_or_upload` | Clone GitHub repo or process ZIP | URL or artifact ID | Local path, file list |
| `repo_manifest` | Get file manifest | Snapshot ID | Files, languages, stats |
| `build_knowledge_graph` | Build KG from repo | Snapshot ID | KG ID, stats |
| `vector_index_build` | Create embeddings | Snapshot ID, artifacts | Store ID, chunk count |
| `semantic_search` | Search over vectors | Query, filters | Ranked chunks |
| `python_sandbox_run` | Execute Python code | Code, files | Output, generated files |
| `repo_runner_run` | Run repo commands | Command, args | Output, exit code |
| `export_doc` | Export document | Doc ID, format | Artifact ID |

## Security Model

### Sandboxing

```
┌─────────────────────────────────────────┐
│           Python Sandbox                │
│  ┌───────────────────────────────────┐  │
│  │  - No network access              │  │
│  │  - Read-only mounts               │  │
│  │  - 512MB memory limit             │  │
│  │  - 60s timeout                    │  │
│  │  - Non-root user                  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│           Repo Sandbox                  │
│  ┌───────────────────────────────────┐  │
│  │  - Optional Docker isolation      │  │
│  │  - No secrets mounted             │  │
│  │  - Resource limits                │  │
│  │  - Command whitelist (TODO)       │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Authentication Flow

```
User → Login → NextAuth → JWT → API Request
                            │
                            ▼
                     Validate JWT
                            │
                            ▼
                     Extract user ID
                            │
                            ▼
                     Authorize action
```

## Observability

### Logging

All services use structured logging with Pino:

```typescript
logger.info({
  requestId: 'xxx',
  userId: 'yyy',
  action: 'generate_block',
  blockId: 'zzz',
  duration: 1234,
}, 'Block generated successfully');
```

### Tracing

Agent execution is traced via `AgentTrace` records:

```typescript
AgentTrace {
  id: UUID
  generationRunId: UUID
  blockId?: UUID
  events: [
    { type: 'prompt_sent', timestamp, data },
    { type: 'response_received', timestamp, data, tokens },
    { type: 'tool_call', timestamp, data },
    { type: 'completion', timestamp, data },
  ]
  totalTokens: number
  totalDurationMs: number
}
```

## Scaling Considerations

### Horizontal Scaling

- **API**: Stateless, can run multiple instances behind load balancer
- **Workers**: Can scale independently, BullMQ handles distribution
- **Sandboxes**: Stateless, scale based on demand

### Database

- pgvector indexes for efficient similarity search
- Connection pooling via Prisma
- Read replicas for query scaling (future)

### Caching

- Redis for session data
- Block output caching by input hash
- KG summary caching

## Future Enhancements

1. **Streaming Generation**: Stream block content to UI as it's generated
2. **Collaborative Editing**: Multiple users editing same document
3. **Version Control**: Git-like versioning for templates and documents
4. **Custom Models**: Support for self-hosted LLMs
5. **RAG Improvements**: Better chunking, re-ranking, hybrid search

