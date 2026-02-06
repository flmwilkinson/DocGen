/**
 * Vector Search Implementation
 *
 * Provides semantic search using in-memory cosine similarity.
 * Optimized for local operation without pgvector.
 *
 * For large repos (>50MB), uses a hybrid approach:
 * 1. Keyword pre-filtering to narrow down candidates
 * 2. Semantic re-ranking of top candidates
 */

import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

// Embedding model configuration
const EMBEDDING_MODEL = process.env.MODEL_EMBEDDING || 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// Search configuration
const MAX_KEYWORD_CANDIDATES = 200; // Max chunks from keyword search
const SEMANTIC_TOP_K = 50; // Max chunks to semantically rank
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Simple in-memory cache for embeddings
const queryEmbeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();

interface VectorChunkData {
  id: string;
  content: string;
  embedding: string | null; // JSON array or null
  sourcePath: string;
  chunkIndex: number;
  startLine: number | null;
  endLine: number | null;
  metadata: string;
}

interface SearchResult {
  id: string;
  content: string;
  sourcePath: string;
  score: number;
  startLine: number | null;
  endLine: number | null;
  metadata: Record<string, unknown>;
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    logger.warn({ aLen: a.length, bLen: b.length }, 'Vector dimension mismatch');
    return 0;
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Get embedding for a query (with caching)
 */
async function getQueryEmbedding(
  query: string,
  openai: OpenAI
): Promise<number[]> {
  const cacheKey = query.toLowerCase().trim();
  const cached = queryEmbeddingCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    logger.debug({ query: query.substring(0, 50) }, 'Using cached query embedding');
    return cached.embedding;
  }

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  });

  const embedding = response.data[0].embedding;

  queryEmbeddingCache.set(cacheKey, {
    embedding,
    timestamp: Date.now(),
  });

  return embedding;
}

/**
 * Parse embedding from JSON string
 */
function parseEmbedding(embeddingJson: string | null): number[] | null {
  if (!embeddingJson) return null;

  try {
    const parsed = JSON.parse(embeddingJson);
    if (Array.isArray(parsed) && parsed.length === EMBEDDING_DIMENSIONS) {
      return parsed;
    }
  } catch {
    // Invalid JSON
  }

  return null;
}

/**
 * Keyword-based pre-filtering
 * Returns chunks that contain any of the query terms
 */
function keywordFilter(
  chunks: VectorChunkData[],
  query: string
): VectorChunkData[] {
  // Extract meaningful terms (ignore common words)
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of',
    'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'between', 'under',
    'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
    'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
    'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while',
    'what', 'which', 'who', 'this', 'that', 'these', 'those', 'am', 'it',
  ]);

  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter(term => term.length > 2 && !stopWords.has(term));

  if (terms.length === 0) {
    // No meaningful terms, return all chunks
    return chunks;
  }

  // Score chunks by keyword matches
  const scored = chunks.map(chunk => {
    const contentLower = chunk.content.toLowerCase();
    const pathLower = chunk.sourcePath.toLowerCase();

    let score = 0;
    for (const term of terms) {
      // Check content
      if (contentLower.includes(term)) {
        score += 1;
        // Bonus for exact word match
        if (new RegExp(`\\b${term}\\b`).test(contentLower)) {
          score += 0.5;
        }
      }
      // Check file path
      if (pathLower.includes(term)) {
        score += 0.5;
      }
    }

    return { chunk, score };
  });

  // Return chunks with any matches, sorted by score
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_KEYWORD_CANDIDATES)
    .map(s => s.chunk);
}

/**
 * Semantic search using embeddings
 */
async function semanticRank(
  chunks: VectorChunkData[],
  queryEmbedding: number[],
  topK: number
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  for (const chunk of chunks) {
    const embedding = parseEmbedding(chunk.embedding);

    if (!embedding) {
      // No embedding available, assign neutral score
      continue;
    }

    const score = cosineSimilarity(queryEmbedding, embedding);

    results.push({
      id: chunk.id,
      content: chunk.content,
      sourcePath: chunk.sourcePath,
      score,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      metadata: JSON.parse(chunk.metadata || '{}'),
    });
  }

  // Sort by score and return top K
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Hybrid search: keyword pre-filtering + semantic ranking
 * Optimized for large repositories
 */
export async function hybridSearch(
  query: string,
  repoSnapshotId: string | null,
  artifactIds: string[] | null,
  prisma: PrismaClient,
  openai: OpenAI,
  options: {
    topK?: number;
    minScore?: number;
  } = {}
): Promise<SearchResult[]> {
  const { topK = 10, minScore = 0.5 } = options;

  logger.info({
    query: query.substring(0, 100),
    repoSnapshotId,
    artifactIds: artifactIds?.length,
  }, 'Starting hybrid search');

  // Build where clause
  const where: Record<string, unknown> = {};
  if (repoSnapshotId) {
    where.repoSnapshotId = repoSnapshotId;
  }
  if (artifactIds && artifactIds.length > 0) {
    where.artifactId = { in: artifactIds };
  }

  // Fetch all chunks (SQLite doesn't support vector operations)
  const chunks = await prisma.vectorChunk.findMany({
    where,
    select: {
      id: true,
      content: true,
      embedding: true,
      sourcePath: true,
      chunkIndex: true,
      startLine: true,
      endLine: true,
      metadata: true,
    },
  }) as VectorChunkData[];

  logger.debug({ totalChunks: chunks.length }, 'Fetched chunks for search');

  if (chunks.length === 0) {
    return [];
  }

  // Step 1: Keyword pre-filtering (fast)
  const keywordCandidates = keywordFilter(chunks, query);
  logger.debug({
    keywordCandidates: keywordCandidates.length,
  }, 'Keyword pre-filtering complete');

  // If we have too few keyword matches, fall back to full semantic search
  const candidatesForSemantic = keywordCandidates.length >= topK * 2
    ? keywordCandidates
    : chunks.slice(0, SEMANTIC_TOP_K);

  // Step 2: Get query embedding
  const queryEmbedding = await getQueryEmbedding(query, openai);

  // Step 3: Semantic ranking
  const results = await semanticRank(
    candidatesForSemantic,
    queryEmbedding,
    Math.min(topK * 2, SEMANTIC_TOP_K)
  );

  // Filter by minimum score and return top K
  const filtered = results
    .filter(r => r.score >= minScore)
    .slice(0, topK);

  logger.info({
    query: query.substring(0, 50),
    results: filtered.length,
    topScore: filtered[0]?.score,
  }, 'Search complete');

  return filtered;
}

/**
 * Generate embedding for a text chunk
 */
export async function generateEmbedding(
  text: string,
  openai: OpenAI
): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000), // Truncate to avoid token limits
  });

  return response.data[0].embedding;
}

/**
 * Batch generate embeddings for multiple texts
 */
export async function generateEmbeddings(
  texts: string[],
  openai: OpenAI,
  batchSize: number = 100
): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map(t => t.slice(0, 8000));

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });

    embeddings.push(...response.data.map(d => d.embedding));

    // Small delay to avoid rate limits
    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return embeddings;
}

/**
 * Clear the embedding cache
 */
export function clearEmbeddingCache(): void {
  queryEmbeddingCache.clear();
}
