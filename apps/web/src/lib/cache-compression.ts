/**
 * Cache Compression Utilities
 * 
 * Compresses knowledge base and code intelligence data before storing in localStorage
 * to avoid quota exceeded errors. Stores only essential metadata and truncated content.
 */

import type { CodeKnowledgeBase } from './openai';
import type { CodeIntelligenceResult } from './code-intelligence';

const MAX_FILE_CONTENT_SIZE = 100 * 1024; // 100KB per file
const MAX_FILE_LINES = 2000; // Max lines per file

/**
 * Compress knowledge base for storage
 * Truncates large files and removes unnecessary data
 */
export function compressKnowledgeBase(kb: CodeKnowledgeBase): any {
  return {
    ...kb,
    files: kb.files.map(file => {
      const ext = file.path.split('.').pop()?.toLowerCase() || '';
      const isDataFile = ['csv', 'tsv', 'parquet', 'xlsx', 'xls', 'feather', 'arrow'].includes(ext);
      
      // For data files, store only headers/metadata
      if (isDataFile) {
        const lines = file.content.split('\n');
        const headerLines = Math.min(10, lines.length);
        return {
          ...file,
          content: lines.slice(0, headerLines).join('\n') + 
            (lines.length > headerLines ? `\n\n[TRUNCATED: ${lines.length} total rows - use code execution for full analysis]` : ''),
          size: file.content.length, // Keep original size for reference
          _truncated: true,
          _originalLineCount: lines.length,
        };
      }
      
      // For code files, truncate if too large
      if (file.content.length > MAX_FILE_CONTENT_SIZE) {
        const lines = file.content.split('\n');
        const truncatedLines = lines.slice(0, MAX_FILE_LINES);
        return {
          ...file,
          content: truncatedLines.join('\n') + `\n\n[TRUNCATED: ${lines.length - MAX_FILE_LINES} more lines]`,
          size: file.content.length, // Keep original size
          _truncated: true,
          _originalLineCount: lines.length,
        };
      }
      
      return file;
    }),
  };
}

/**
 * Decompress knowledge base from storage
 * Note: Content is truncated, so full files won't be available
 * This is OK - we'll fetch on-demand or use code execution
 */
export function decompressKnowledgeBase(compressed: any): CodeKnowledgeBase {
  return compressed as CodeKnowledgeBase; // Structure is the same, just content is truncated
}

/**
 * Compress code intelligence for storage
 * Removes embeddings (can be regenerated) and truncates chunk content
 */
export function compressCodeIntelligence(ci: CodeIntelligenceResult): any {
  return {
    chunks: ci.chunks.map(chunk => {
      // Remove embeddings (large and can be regenerated)
      const { embedding, ...chunkWithoutEmbedding } = chunk;
      
      // Truncate content if too large
      if (chunk.content.length > MAX_FILE_CONTENT_SIZE) {
        const lines = chunk.content.split('\n');
        const truncatedLines = lines.slice(0, MAX_FILE_LINES);
        return {
          ...chunkWithoutEmbedding,
          content: truncatedLines.join('\n') + `\n\n[TRUNCATED: ${lines.length - MAX_FILE_LINES} more lines]`,
          _truncated: true,
        };
      }
      
      return chunkWithoutEmbedding;
    }),
    relationships: ci.relationships,
    // Don't store functions - they'll be recreated on deserialize
  };
}

/**
 * Decompress code intelligence from storage
 * Note: Embeddings are missing and will need to be regenerated if needed
 */
export function decompressCodeIntelligence(compressed: any): any {
  return compressed; // Structure is the same, just embeddings removed
}

/**
 * Estimate storage size of an object in bytes
 */
export function estimateStorageSize(obj: any): number {
  try {
    return new Blob([JSON.stringify(obj)]).size;
  } catch {
    return 0;
  }
}

/**
 * Check if data would exceed localStorage quota (typically 5-10MB)
 */
export function wouldExceedQuota(data: any, thresholdMB: number = 4): boolean {
  const size = estimateStorageSize(data);
  const thresholdBytes = thresholdMB * 1024 * 1024;
  return size > thresholdBytes;
}

