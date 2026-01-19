/**
 * GitHub Repository Caching
 * 
 * Caches repository data and knowledge graphs to avoid repeated API calls
 * and rate limiting issues.
 */

import type { CodeKnowledgeBase } from './openai';
import type { CodeIntelligenceResult } from './code-intelligence';
import { semanticSearch } from './code-intelligence';
import { buildCodeKnowledgeBase } from './openai';
import { buildCodeIntelligence } from './code-intelligence';
import OpenAI from 'openai';
import {
  compressCodeIntelligence,
  decompressKnowledgeBase,
  wouldExceedQuota,
} from './cache-compression';
import { idbGet, idbSet } from './indexeddb-cache';

/**
 * Get the latest commit SHA from GitHub
 * Returns null if unable to fetch (doesn't throw - allows fallback)
 */
export async function getLatestCommitHash(repoUrl: string, githubToken?: string | null): Promise<string | null> {
  // If no token provided, try to get one from various sources
  if (!githubToken) {
    // In client context, skip getGitHubToken (which uses getServerSession) and go straight to env vars
    if (typeof window !== 'undefined') {
      // Client-side: only use public env vars
      githubToken = process.env.NEXT_PUBLIC_GITHUB_TOKEN || null;
    } else {
      // Server-side: try getGitHubToken (which includes session check)
      try {
        const { getGitHubToken } = await import('@/lib/github-auth');
        githubToken = await getGitHubToken();
      } catch (error) {
        // Fallback to env vars
        githubToken = process.env.GITHUB_TOKEN || process.env.NEXT_PUBLIC_GITHUB_TOKEN || null;
      }
    }
  }
  try {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      console.warn('[GitHub Cache] Invalid GitHub URL format:', repoUrl);
      return null;
    }
    
    const [, owner, repo] = match;
    const repoName = `${owner}/${repo.replace(/\.git$/, '')}`;
    
    console.log(`[GitHub Cache] Fetching latest commit for: ${repoName}`);
    
    const headers: HeadersInit = { 'Accept': 'application/vnd.github.v3+json' };
    const token = githubToken || process.env.NEXT_PUBLIC_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }
    
    const response = await fetch(
      `https://api.github.com/repos/${repoName}/commits?per_page=1`,
      { headers }
    );
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.warn(`[GitHub Cache] Failed to get latest commit: ${response.status} ${response.statusText}`, errorText);
      
      // Don't throw - allow fallback to fetching knowledge base directly
      // The knowledge base fetch might work even if commits endpoint doesn't
      return null;
    }
    
    const commits = await response.json();
    if (Array.isArray(commits) && commits.length > 0) {
      const commitHash = commits[0].sha;
      console.log(`[GitHub Cache] Latest commit: ${commitHash.substring(0, 7)}`);
      return commitHash;
    }
    
    console.warn('[GitHub Cache] No commits found in response');
    return null;
  } catch (error) {
    console.error('[GitHub Cache] Error getting latest commit:', error);
    // Don't throw - allow fallback
    return null;
  }
}

/**
 * Check if repository has been updated since last cache
 */
export async function isRepoUpdated(
  repoUrl: string,
  lastCommitHash?: string,
  githubToken?: string | null
): Promise<{ updated: boolean; latestCommitHash: string | null }> {
  const latestCommitHash = await getLatestCommitHash(repoUrl, githubToken);
  
  if (!latestCommitHash) {
    // Can't determine, assume not updated to avoid unnecessary fetches
    return { updated: false, latestCommitHash: null };
  }
  
  if (!lastCommitHash) {
    // No previous hash, so it's "updated" (needs initial fetch)
    return { updated: true, latestCommitHash };
  }
  
  return {
    updated: latestCommitHash !== lastCommitHash,
    latestCommitHash,
  };
}

/**
 * Serialize CodeIntelligenceResult for storage (removes functions and compresses)
 */
export function serializeCodeIntelligence(
  codeIntel: CodeIntelligenceResult
): any {
  const compressed = compressCodeIntelligence(codeIntel);
  
  // Check if still too large and warn
  if (wouldExceedQuota(compressed, 4)) {
    console.warn('[Cache] Compressed code intelligence is still large, may cause storage issues');
  }
  
  return {
    ...compressed,
    hasEmbeddings: codeIntel.chunks.some((chunk) => !!chunk.embedding),
  };
}

/**
 * Deserialize CodeIntelligenceResult from storage
 * Recreates the function methods
 */
export function deserializeCodeIntelligence(
  data: any,
  openaiClient: OpenAI
): CodeIntelligenceResult {
  const chunks = data.chunks || [];
  const relationships = data.relationships || [];
  const hasEmbeddings = data.hasEmbeddings || chunks.some((c: any) => !!c.embedding);

  // Recreate the search and analyze functions
  return {
    chunks,
    relationships,
    search: async (query: string, topK: number = 10) => {
      // Hybrid RAG: semantic + keyword (fallback)
      const keywordResults = (() => {
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const scored = chunks.map((chunk: any) => {
          let score = 0;
          const searchText = `${chunk.filePath} ${chunk.name} ${chunk.content} ${chunk.docstring || ''}`.toLowerCase();
          for (const word of queryWords) {
            if (searchText.includes(word)) {
              score += 1;
              if (chunk.name.toLowerCase().includes(word)) score += 2;
              if (chunk.filePath.toLowerCase().includes(word)) score += 1;
            }
          }
          return { chunk, score, reason: `Keyword match: ${score} points` };
        });
        return scored
          .filter((s: any) => s.score > 0)
          .sort((a: any, b: any) => b.score - a.score)
          .slice(0, topK);
      })();

      if (!hasEmbeddings) {
        return keywordResults;
      }

      const semanticResults = await semanticSearch(query, chunks, openaiClient, topK);

      // Merge semantic + keyword (dedupe by chunk id)
      const merged = new Map<string, any>();
      for (const result of semanticResults) {
        merged.set(result.chunk.id, result);
      }
      for (const result of keywordResults) {
        if (!merged.has(result.chunk.id)) {
          merged.set(result.chunk.id, result);
        }
      }

      return Array.from(merged.values()).slice(0, topK);
    },
    analyze: async (question: string) => {
      // Simple analysis using hybrid search
      const results = await deserializeCodeIntelligence(data, openaiClient).search(question, 5);
      return {
        answer: `Based on the codebase analysis, ${question} relates to: ${results.map(r => r.chunk.name).join(', ')}`,
        relevantChunks: results.map(r => r.chunk),
        citations: [...new Set(results.map(r => r.chunk.filePath))],
      };
    },
    getChunksForTopic: (topic: string) => {
      const topicLower = topic.toLowerCase();
      return chunks.filter((chunk: any) => 
        chunk.name.toLowerCase().includes(topicLower) ||
        chunk.filePath.toLowerCase().includes(topicLower) ||
        (chunk.docstring && chunk.docstring.toLowerCase().includes(topicLower))
      );
    },
  };
}

/**
 * Persist full knowledge base in IndexedDB (no truncation)
 */
async function storeKnowledgeBaseInIndexedDB(
  repoUrl: string,
  commitHash: string | null,
  knowledgeBase: CodeKnowledgeBase
): Promise<void> {
  try {
    await idbSet(repoUrl, commitHash, 'knowledge-base', knowledgeBase);
  } catch (error) {
    console.warn('[GitHub Cache] Failed to store knowledge base in IndexedDB:', error);
  }
}

/**
 * Persist full code intelligence in IndexedDB (no truncation)
 */
async function storeCodeIntelligenceInIndexedDB(
  repoUrl: string,
  commitHash: string | null,
  codeIntelligence: CodeIntelligenceResult,
  useEmbeddings: boolean
): Promise<void> {
  try {
    await idbSet(
      repoUrl,
      commitHash,
      'code-intelligence',
      {
        chunks: codeIntelligence.chunks,
        relationships: codeIntelligence.relationships,
        hasEmbeddings: useEmbeddings && codeIntelligence.chunks.some((c) => !!c.embedding),
      },
      { embeddings: useEmbeddings }
    );
  } catch (error) {
    console.warn('[GitHub Cache] Failed to store code intelligence in IndexedDB:', error);
  }
}

/**
 * Get cached schema audits from IndexedDB
 */
export async function getCachedSchemaAudits(
  repoUrl: string,
  commitHash: string | null
): Promise<Record<string, any> | null> {
  if (!repoUrl || !commitHash) {
    return null;
  }
  try {
    const cached = await idbGet<Record<string, any>>(
      repoUrl,
      commitHash,
      'schema-audits'
    );
    return cached || null;
  } catch (error) {
    console.warn('[GitHub Cache] Failed to get cached schema audits:', error);
    return null;
  }
}

/**
 * Store schema audits in IndexedDB
 */
export async function storeSchemaAuditsInIndexedDB(
  repoUrl: string,
  commitHash: string | null,
  schemaAudits: Record<string, any>
): Promise<void> {
  if (!repoUrl || !commitHash) {
    return;
  }
  try {
    await idbSet(repoUrl, commitHash, 'schema-audits', schemaAudits);
    console.log(`[GitHub Cache] Stored ${Object.keys(schemaAudits).length} schema audits in IndexedDB`);
  } catch (error) {
    console.warn('[GitHub Cache] Failed to store schema audits in IndexedDB:', error);
  }
}

/**
 * Build or retrieve cached knowledge base
 * @param forceRefresh - If true, bypasses cache and fetches fresh data
 */
export async function getCachedKnowledgeBase(
  repoUrl: string,
  lastCommitHash: string | undefined,
  cachedKnowledgeBase: any,
  onProgress?: (msg: string) => void,
  forceRefresh: boolean = false,
  githubToken?: string | null
): Promise<{ knowledgeBase: CodeKnowledgeBase; wasCached: boolean; commitHash: string | null }> {
  // If forcing refresh, skip cache check
  if (forceRefresh) {
    console.log('[GitHub Cache] Force refresh requested, fetching fresh data');
    onProgress?.('Fetching fresh repository data...');
    const knowledgeBase = await buildCodeKnowledgeBase(repoUrl, onProgress, githubToken);
    const latestCommitHash = await getLatestCommitHash(repoUrl, githubToken);
    return {
      knowledgeBase,
      wasCached: false,
      commitHash: latestCommitHash,
    };
  }
  
  // Check if repo has been updated (this might fail, but that's OK)
  console.log('[GitHub Cache] Checking if repository has been updated...');
  onProgress?.('Checking repository status...');
  const { updated, latestCommitHash } = await isRepoUpdated(repoUrl, lastCommitHash, githubToken);
  const commitForCache = latestCommitHash || lastCommitHash || null;

  // Prefer IndexedDB cache for full content when repo unchanged
  if (!updated && commitForCache) {
    const idbKnowledgeBase = await idbGet<CodeKnowledgeBase>(
      repoUrl,
      commitForCache,
      'knowledge-base'
    );
    if (idbKnowledgeBase) {
      console.log('[GitHub Cache] Using IndexedDB knowledge base cache');
      onProgress?.('Using cached repository data (IndexedDB)');
      return {
        knowledgeBase: idbKnowledgeBase,
        wasCached: true,
        commitHash: commitForCache,
      };
    }
  }
  
  // If we have cached data and repo hasn't been updated, use cache
  if (cachedKnowledgeBase && !updated && latestCommitHash === lastCommitHash && latestCommitHash) {
    console.log('[GitHub Cache] Using cached knowledge base (repo unchanged)');
    onProgress?.('Using cached repository data');
    // Decompress if needed (for backward compatibility, check if it's already decompressed)
    const knowledgeBase = decompressKnowledgeBase(cachedKnowledgeBase);
    return {
      knowledgeBase,
      wasCached: true,
      commitHash: latestCommitHash || lastCommitHash || null,
    };
  }
  
  // Repo has been updated or no cache, fetch fresh data
  console.log('[GitHub Cache] Repository updated or no cache, fetching fresh data');
  if (updated && latestCommitHash) {
    onProgress?.(`Repository has been updated (commit: ${latestCommitHash.substring(0, 7)}), fetching latest changes...`);
  } else if (!cachedKnowledgeBase) {
    onProgress?.('No cache found, building knowledge base from repository...');
  } else {
    onProgress?.('Unable to verify repository status, fetching fresh data...');
  }
  
    try {
      const knowledgeBase = await buildCodeKnowledgeBase(repoUrl, onProgress, githubToken);
      
      // Try to get commit hash after successful fetch (in case it failed before)
      const finalCommitHash = latestCommitHash || await getLatestCommitHash(repoUrl, githubToken);
    
    const result = {
      knowledgeBase,
      wasCached: false,
      commitHash: finalCommitHash,
    };
    
    // Persist full KB in IndexedDB (no truncation)
    if (finalCommitHash) {
      await storeKnowledgeBaseInIndexedDB(repoUrl, finalCommitHash, knowledgeBase);
    }
    
    return result;
  } catch (error) {
    // If fetch fails but we have cached data, use it as fallback
    if (cachedKnowledgeBase) {
      console.warn('[GitHub Cache] Fetch failed, falling back to cached data:', error);
      onProgress?.('Fetch failed, using cached data as fallback');
      const knowledgeBase = decompressKnowledgeBase(cachedKnowledgeBase);
      return {
        knowledgeBase,
        wasCached: true,
        commitHash: lastCommitHash || null,
      };
    }
    // No cache to fall back to, re-throw
    throw error;
  }
}

/**
 * Build or retrieve cached code intelligence
 */
export async function getCachedCodeIntelligence(
  knowledgeBase: CodeKnowledgeBase,
  cachedCodeIntelligence: any,
  openaiClient: OpenAI,
  wasKnowledgeBaseCached: boolean,
  onProgress?: (msg: string) => void,
  options?: { repoUrl?: string; commitHash?: string | null; useEmbeddings?: boolean }
): Promise<{ codeIntelligence: CodeIntelligenceResult; wasCached: boolean }> {
  const useEmbeddings = options?.useEmbeddings ?? false;
  const repoUrl = options?.repoUrl;
  const commitHash = options?.commitHash || null;

  // Prefer IndexedDB cache when available
  if (repoUrl && commitHash) {
    const idbCodeIntel = await idbGet<any>(
      repoUrl,
      commitHash,
      'code-intelligence',
      { embeddings: useEmbeddings }
    );
    if (idbCodeIntel && (!useEmbeddings || idbCodeIntel.hasEmbeddings)) {
      console.log('[GitHub Cache] Using IndexedDB code intelligence cache');
      onProgress?.('Using cached knowledge graph (IndexedDB)');
      return {
        codeIntelligence: deserializeCodeIntelligence(idbCodeIntel, openaiClient),
        wasCached: true,
      };
    }
  }

  // If knowledge base was cached and we have cached code intelligence, use cache
  if (wasKnowledgeBaseCached && cachedCodeIntelligence) {
    const hasEmbeddings = cachedCodeIntelligence?.hasEmbeddings;
    if (!useEmbeddings || hasEmbeddings) {
      console.log('[GitHub Cache] Using cached code intelligence');
      onProgress?.('Using cached knowledge graph');
      return {
        codeIntelligence: deserializeCodeIntelligence(cachedCodeIntelligence, openaiClient),
        wasCached: true,
      };
    }
  }
  
  // Build fresh code intelligence
  console.log('[GitHub Cache] Building fresh code intelligence');
  onProgress?.('Building knowledge graph from code...');
  
  const codeIntelligence = await buildCodeIntelligence(
    knowledgeBase.files.map(f => ({ path: f.path, content: f.content, language: f.language })),
    openaiClient,
    onProgress,
    useEmbeddings
  );
  
  const result = {
    codeIntelligence,
    wasCached: false,
  };

  // Persist full code intelligence in IndexedDB
  if (repoUrl && commitHash) {
    await storeCodeIntelligenceInIndexedDB(repoUrl, commitHash, codeIntelligence, useEmbeddings);
  }

  return result;
}

