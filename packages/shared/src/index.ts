// ===========================================
// DocGen.AI Shared Package
// ===========================================

// Re-export all schemas
export * from './schemas';

// ===========================================
// Common Types
// ===========================================

export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

// ===========================================
// Common Constants
// ===========================================

export const SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'java',
  'go',
  'rust',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'scala',
] as const;

export const SUPPORTED_FILE_TYPES = {
  documents: ['pdf', 'docx', 'md', 'txt'],
  data: ['csv', 'json', 'xlsx', 'xml', 'yaml'],
  code: ['py', 'js', 'ts', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp'],
  archives: ['zip', 'tar', 'gz'],
} as const;

export const MAX_FILE_SIZE_MB = 100;
export const MAX_CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;

// ===========================================
// Utility Functions
// ===========================================

export function generateId(): string {
  return crypto.randomUUID();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

export function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    json: 'application/json',
    md: 'text/markdown',
    txt: 'text/plain',
    zip: 'application/zip',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };
  return mimeTypes[extension] || 'application/octet-stream';
}

// ===========================================
// Error Classes
// ===========================================

export class DocGenError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DocGenError';
  }
}

export class ValidationError extends DocGenError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends DocGenError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', { resource, id });
    this.name = 'NotFoundError';
  }
}

export class ToolExecutionError extends DocGenError {
  constructor(toolName: string, message: string, details?: Record<string, unknown>) {
    super(`Tool execution failed: ${toolName} - ${message}`, 'TOOL_ERROR', {
      toolName,
      ...details,
    });
    this.name = 'ToolExecutionError';
  }
}

export class AgentError extends DocGenError {
  constructor(agentName: string, message: string, details?: Record<string, unknown>) {
    super(`Agent error: ${agentName} - ${message}`, 'AGENT_ERROR', {
      agentName,
      ...details,
    });
    this.name = 'AgentError';
  }
}

