import { z } from 'zod';
import { TemplateSchema } from './template';

// ===========================================
// User
// ===========================================

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;

// ===========================================
// Project
// ===========================================

export const ProjectSettingsSchema = z.object({
  defaultModel: z.string().default('gpt-4.1'),
  maxTokensPerBlock: z.number().int().positive().default(4096),
  enableDebugMode: z.boolean().default(false),
  autoSaveInterval: z.number().int().positive().default(30), // seconds
});

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  ownerId: z.string().uuid(),
  repoUrl: z.string().url().optional(),
  settings: ProjectSettingsSchema.default({}),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Project = z.infer<typeof ProjectSchema>;

// ===========================================
// RepoSnapshot
// ===========================================

export const FileManifestEntrySchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  language: z.string().optional(),
  lastModified: z.string().datetime().optional(),
  isDirectory: z.boolean().default(false),
});

export const LanguageStatsSchema = z.object({
  language: z.string(),
  files: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
});

export const RepoSnapshotStatusEnum = z.enum([
  'PENDING',
  'CLONING',
  'INDEXING',
  'BUILDING_KG',
  'EMBEDDING',
  'READY',
  'FAILED',
]);

export const RepoSnapshotSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  commitHash: z.string().optional(),
  branch: z.string().default('main'),
  status: RepoSnapshotStatusEnum,
  fileManifest: z.array(FileManifestEntrySchema).default([]),
  languageStats: z.array(LanguageStatsSchema).default([]),
  totalFiles: z.number().int().nonnegative().default(0),
  totalSize: z.number().int().nonnegative().default(0), // bytes
  errorMessage: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type RepoSnapshot = z.infer<typeof RepoSnapshotSchema>;

// ===========================================
// Artifact
// ===========================================

export const ArtifactTypeEnum = z.enum([
  'UPLOADED_FILE',
  'GENERATED_OUTPUT',
  'EXPORT',
  'REPO_ZIP',
]);

export const ArtifactSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: ArtifactTypeEnum,
  filename: z.string(),
  originalFilename: z.string().optional(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  storageKey: z.string(), // S3/MinIO key
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

// ===========================================
// Template (DB entity wrapper)
// ===========================================

export const TemplateEntitySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().optional(), // null = global template
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  createdBy: z.string().uuid(),
  templateJson: TemplateSchema,
  isPublic: z.boolean().default(false),
  version: z.number().int().positive().default(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TemplateEntity = z.infer<typeof TemplateEntitySchema>;

// ===========================================
// GenerationRun
// ===========================================

export const GenerationRunStatusEnum = z.enum([
  'PENDING',
  'RUNNING',
  'PAUSED', // Waiting for user input
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const GenerationRunInputsSchema = z.object({
  repoSnapshotId: z.string().uuid().optional(),
  artifactIds: z.array(z.string().uuid()).default([]),
  userContext: z.record(z.unknown()).optional(),
});

export const GenerationRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  templateId: z.string().uuid(),
  status: GenerationRunStatusEnum,
  inputs: GenerationRunInputsSchema,
  currentBlockId: z.string().uuid().optional(),
  progress: z.number().min(0).max(100).default(0),
  errorMessage: z.string().optional(),
  startedAt: z.date().optional(),
  finishedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type GenerationRun = z.infer<typeof GenerationRunSchema>;

// ===========================================
// DocumentVersion
// ===========================================

export const DocumentVersionSchema = z.object({
  id: z.string().uuid(),
  generationRunId: z.string().uuid(),
  title: z.string(),
  contentJson: z.record(z.unknown()), // TipTap JSON
  version: z.number().int().positive().default(1),
  exportArtifacts: z.object({
    docx: z.string().uuid().optional(),
    pdf: z.string().uuid().optional(),
    markdown: z.string().uuid().optional(),
  }).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

// ===========================================
// BlockOutput
// ===========================================

export const CitationSchema = z.object({
  id: z.string().uuid(),
  sourceType: z.enum(['repo_file', 'artifact', 'chunk', 'web', 'user_provided']),
  sourceRef: z.string(), // file path, artifact id, chunk id, URL
  excerpt: z.string().optional(),
  lineStart: z.number().int().optional(),
  lineEnd: z.number().int().optional(),
  relevanceScore: z.number().min(0).max(1).optional(),
});

export type Citation = z.infer<typeof CitationSchema>;

export const BlockOutputSchema = z.object({
  id: z.string().uuid(),
  documentVersionId: z.string().uuid(),
  blockId: z.string().uuid(),
  outputType: z.enum(['LLM_TEXT', 'LLM_TABLE', 'LLM_CHART', 'LLM_FIGURE', 'USER_INPUT', 'STATIC_TEXT']),
  content: z.record(z.unknown()),
  confidence: z.number().min(0).max(1).default(1),
  citations: z.array(CitationSchema).default([]),
  rawResponse: z.record(z.unknown()).optional(), // Debug: raw LLM response
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type BlockOutput = z.infer<typeof BlockOutputSchema>;

// ===========================================
// Gap / Question
// ===========================================

export const GapStatusEnum = z.enum(['OPEN', 'ANSWERED', 'DISMISSED', 'AUTO_RESOLVED']);
export const GapSeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);

export const GapQuestionSchema = z.object({
  id: z.string().uuid(),
  generationRunId: z.string().uuid(),
  blockId: z.string().uuid().optional(),
  question: z.string(),
  context: z.string().optional(),
  severity: GapSeverityEnum,
  status: GapStatusEnum.default('OPEN'),
  userAnswer: z.string().optional(),
  answeredAt: z.date().optional(),
  suggestedInputType: z.enum(['text', 'file', 'choice']).optional(),
  choices: z.array(z.string()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type GapQuestion = z.infer<typeof GapQuestionSchema>;

// ===========================================
// Vector Chunk (for pgvector)
// ===========================================

export const VectorChunkSchema = z.object({
  id: z.string().uuid(),
  repoSnapshotId: z.string().uuid().optional(),
  artifactId: z.string().uuid().optional(),
  sourceType: z.enum(['repo_file', 'artifact']),
  sourcePath: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  content: z.string(),
  startLine: z.number().int().optional(),
  endLine: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional(),
  // embedding stored as vector type in postgres
  createdAt: z.date(),
});

export type VectorChunk = z.infer<typeof VectorChunkSchema>;

