import { z } from 'zod';

// ===========================================
// Tool Definitions for OpenAI Function Calling
// ===========================================

// ===========================================
// repo_clone_or_upload
// ===========================================

export const RepoCloneInputSchema = z.object({
  githubUrl: z.string().url().optional(),
  zipArtifactId: z.string().uuid().optional(),
  branch: z.string().default('main'),
}).refine((data) => data.githubUrl || data.zipArtifactId, {
  message: 'Either githubUrl or zipArtifactId must be provided',
});

export const RepoCloneOutputSchema = z.object({
  localPath: z.string(),
  commitHash: z.string().optional(),
  fileList: z.array(z.string()),
  totalFiles: z.number().int(),
  totalSize: z.number().int(),
});

// ===========================================
// repo_manifest
// ===========================================

export const RepoManifestInputSchema = z.object({
  repoSnapshotId: z.string().uuid(),
});

export const RepoManifestOutputSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    size: z.number().int(),
    language: z.string().optional(),
    lastModified: z.string().optional(),
  })),
  languageStats: z.array(z.object({
    language: z.string(),
    files: z.number().int(),
    lines: z.number().int(),
    percentage: z.number(),
  })),
  totalFiles: z.number().int(),
  totalSize: z.number().int(),
});

// ===========================================
// repo_symbol_index
// ===========================================

export const RepoSymbolIndexInputSchema = z.object({
  repoSnapshotId: z.string().uuid(),
  languages: z.array(z.string()).optional(),
  includePrivate: z.boolean().default(false),
});

export const SymbolSchema = z.object({
  name: z.string(),
  type: z.enum(['class', 'function', 'method', 'variable', 'interface', 'type', 'enum', 'component']),
  filePath: z.string(),
  line: z.number().int(),
  signature: z.string().optional(),
  exported: z.boolean().default(false),
});

export const ImportEdgeSchema = z.object({
  from: z.string(), // file path
  to: z.string(), // file path or module name
  symbols: z.array(z.string()).optional(),
  type: z.enum(['default', 'named', 'namespace', 'side-effect']),
});

export const RepoSymbolIndexOutputSchema = z.object({
  symbols: z.array(SymbolSchema),
  imports: z.array(ImportEdgeSchema),
  totalSymbols: z.number().int(),
  totalImports: z.number().int(),
});

// ===========================================
// build_knowledge_graph
// ===========================================

export const BuildKGInputSchema = z.object({
  repoSnapshotId: z.string().uuid(),
  options: z.object({
    maxDepth: z.number().int().positive().default(10),
    includeTests: z.boolean().default(true),
    includeNodeModules: z.boolean().default(false),
  }).optional(),
});

export const BuildKGOutputSchema = z.object({
  knowledgeGraphId: z.string().uuid(),
  stats: z.object({
    totalNodes: z.number().int(),
    totalEdges: z.number().int(),
    processingTimeMs: z.number().int(),
  }),
});

// ===========================================
// vector_index_build
// ===========================================

export const VectorIndexBuildInputSchema = z.object({
  repoSnapshotId: z.string().uuid().optional(),
  artifactIds: z.array(z.string().uuid()).optional(),
  options: z.object({
    chunkSize: z.number().int().positive().default(1000),
    chunkOverlap: z.number().int().nonnegative().default(200),
    embeddingModel: z.string().default('text-embedding-3-small'),
  }).optional(),
});

export const VectorIndexBuildOutputSchema = z.object({
  vectorStoreId: z.string().uuid(),
  stats: z.object({
    totalChunks: z.number().int(),
    totalTokens: z.number().int(),
    processingTimeMs: z.number().int(),
  }),
});

// ===========================================
// semantic_search
// ===========================================

export const SemanticSearchInputSchema = z.object({
  query: z.string().min(1),
  repoSnapshotId: z.string().uuid().optional(),
  artifactIds: z.array(z.string().uuid()).optional(),
  filters: z.object({
    filePatterns: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    symbolTypes: z.array(z.string()).optional(),
  }).optional(),
  topK: z.number().int().positive().default(10),
  minScore: z.number().min(0).max(1).default(0.5),
});

export const SearchResultChunkSchema = z.object({
  id: z.string(),
  text: z.string(),
  sourceRef: z.object({
    type: z.enum(['repo_file', 'artifact']),
    path: z.string(),
    startLine: z.number().int().optional(),
    endLine: z.number().int().optional(),
  }),
  score: z.number().min(0).max(1),
  metadata: z.record(z.unknown()).optional(),
});

export const SemanticSearchOutputSchema = z.object({
  results: z.array(SearchResultChunkSchema),
  totalResults: z.number().int(),
  queryEmbeddingTokens: z.number().int(),
});

// ===========================================
// python_sandbox_run
// ===========================================

export const PythonSandboxInputSchema = z.object({
  code: z.string(),
  attachedArtifacts: z.array(z.object({
    artifactId: z.string().uuid(),
    mountPath: z.string(),
  })).optional(),
  timeoutSec: z.number().int().positive().default(60),
  memoryLimitMB: z.number().int().positive().default(512),
});

export const PythonSandboxOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int(),
  executionTimeMs: z.number().int(),
  generatedFiles: z.array(z.object({
    filename: z.string(),
    artifactId: z.string().uuid(),
    mimeType: z.string(),
    size: z.number().int(),
  })),
  structuredResult: z.record(z.unknown()).optional(),
});

// ===========================================
// repo_runner_run
// ===========================================

export const RepoRunnerInputSchema = z.object({
  repoSnapshotId: z.string().uuid(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  workingDir: z.string().optional(),
  timeoutSec: z.number().int().positive().default(300),
});

export const RepoRunnerOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int(),
  executionTimeMs: z.number().int(),
  producedArtifacts: z.array(z.object({
    filename: z.string(),
    artifactId: z.string().uuid(),
    mimeType: z.string(),
  })),
});

// ===========================================
// doc_render_tiptap
// ===========================================

export const DocRenderInputSchema = z.object({
  templateId: z.string().uuid(),
  blockOutputs: z.array(z.object({
    blockId: z.string().uuid(),
    content: z.record(z.unknown()),
    citations: z.array(z.object({
      id: z.string(),
      sourceRef: z.string(),
      excerpt: z.string().optional(),
    })),
  })),
});

export const DocRenderOutputSchema = z.object({
  tiptapJson: z.record(z.unknown()),
  documentVersionId: z.string().uuid(),
});

// ===========================================
// export_doc
// ===========================================

export const ExportDocInputSchema = z.object({
  documentVersionId: z.string().uuid(),
  format: z.enum(['markdown', 'docx', 'pdf']),
  options: z.object({
    includeTableOfContents: z.boolean().default(true),
    includeCitations: z.boolean().default(true),
    pageSize: z.enum(['letter', 'a4']).default('letter'),
  }).optional(),
});

export const ExportDocOutputSchema = z.object({
  artifactId: z.string().uuid(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
});

// ===========================================
// get_user_answers
// ===========================================

export const GetUserAnswersInputSchema = z.object({
  gapIds: z.array(z.string().uuid()),
});

export const GetUserAnswersOutputSchema = z.object({
  answers: z.array(z.object({
    gapId: z.string().uuid(),
    answer: z.string().optional(),
    status: z.enum(['answered', 'dismissed', 'pending']),
  })),
});

// ===========================================
// Tool Registry
// ===========================================

export const ToolDefinitions = {
  repo_clone_or_upload: {
    name: 'repo_clone_or_upload',
    description: 'Clone a GitHub repository or process an uploaded ZIP file',
    inputSchema: RepoCloneInputSchema,
    outputSchema: RepoCloneOutputSchema,
  },
  repo_manifest: {
    name: 'repo_manifest',
    description: 'Get the file manifest and language statistics for a repository',
    inputSchema: RepoManifestInputSchema,
    outputSchema: RepoManifestOutputSchema,
  },
  repo_symbol_index: {
    name: 'repo_symbol_index',
    description: 'Extract symbols (functions, classes, etc.) and import relationships from the repository',
    inputSchema: RepoSymbolIndexInputSchema,
    outputSchema: RepoSymbolIndexOutputSchema,
  },
  build_knowledge_graph: {
    name: 'build_knowledge_graph',
    description: 'Build a knowledge graph from the repository showing code structure and relationships',
    inputSchema: BuildKGInputSchema,
    outputSchema: BuildKGOutputSchema,
  },
  vector_index_build: {
    name: 'vector_index_build',
    description: 'Create vector embeddings and index for semantic search over repository and artifacts',
    inputSchema: VectorIndexBuildInputSchema,
    outputSchema: VectorIndexBuildOutputSchema,
  },
  semantic_search: {
    name: 'semantic_search',
    description: 'Perform semantic search over indexed repository and artifact content',
    inputSchema: SemanticSearchInputSchema,
    outputSchema: SemanticSearchOutputSchema,
  },
  python_sandbox_run: {
    name: 'python_sandbox_run',
    description: 'Execute Python code in a sandboxed environment for data analysis and computation',
    inputSchema: PythonSandboxInputSchema,
    outputSchema: PythonSandboxOutputSchema,
  },
  repo_runner_run: {
    name: 'repo_runner_run',
    description: 'Run commands in the repository environment (e.g., tests, scripts)',
    inputSchema: RepoRunnerInputSchema,
    outputSchema: RepoRunnerOutputSchema,
  },
  doc_render_tiptap: {
    name: 'doc_render_tiptap',
    description: 'Render block outputs into a TipTap document format',
    inputSchema: DocRenderInputSchema,
    outputSchema: DocRenderOutputSchema,
  },
  export_doc: {
    name: 'export_doc',
    description: 'Export a document to various formats (Markdown, DOCX, PDF)',
    inputSchema: ExportDocInputSchema,
    outputSchema: ExportDocOutputSchema,
  },
  get_user_answers: {
    name: 'get_user_answers',
    description: 'Retrieve user answers to gap questions',
    inputSchema: GetUserAnswersInputSchema,
    outputSchema: GetUserAnswersOutputSchema,
  },
} as const;

export type ToolName = keyof typeof ToolDefinitions;

