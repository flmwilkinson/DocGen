/**
 * Code Intelligence Module
 * 
 * Implements industry best practices for code understanding:
 * 1. AST-aware semantic chunking (functions, classes, modules)
 * 2. Vector embeddings for semantic search
 * 3. Lightweight knowledge graph (imports, exports, calls)
 * 4. Agentic exploration for complex queries
 * 
 * This is what Cursor, Copilot, Sourcegraph Cody use under the hood.
 */

import OpenAI from 'openai';

// =============================================================================
// TYPES
// =============================================================================

export interface CodeChunk {
  id: string;
  filePath: string;
  type: 'function' | 'class' | 'module' | 'config' | 'interface' | 'constant' | 'import_block';
  name: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  
  // Extracted metadata
  signature?: string;         // Function signature or class definition
  docstring?: string;         // Extracted docstring/JSDoc
  dependencies?: string[];    // What this chunk imports/uses
  exports?: string[];         // What this chunk exports
  
  // Embedding (populated later)
  embedding?: number[];
}

export interface CodeRelationship {
  from: string;  // chunk id or file path
  to: string;    // chunk id or file path
  type: 'imports' | 'calls' | 'extends' | 'implements' | 'uses' | 'exports';
}

export interface CodeKnowledgeGraph {
  chunks: CodeChunk[];
  relationships: CodeRelationship[];
  fileIndex: Map<string, CodeChunk[]>;    // file -> chunks
  symbolIndex: Map<string, CodeChunk>;    // symbol name -> chunk
}

export interface SearchResult {
  chunk: CodeChunk;
  score: number;
  reason: string;
}

// =============================================================================
// PARSING - AST-AWARE CHUNKING
// =============================================================================

/**
 * Language-specific patterns for extracting semantic chunks
 */
const CHUNK_PATTERNS: Record<string, RegExp[]> = {
  python: [
    // Class definitions
    /^class\s+(\w+)(?:\([^)]*\))?:\s*\n((?:[ \t]+.+\n?)*)/gm,
    // Function definitions (including async)
    /^(?:async\s+)?def\s+(\w+)\s*\([^)]*\)(?:\s*->\s*[^:]+)?:\s*\n((?:[ \t]+.+\n?)*)/gm,
    // Decorated functions/classes
    /^@\w+(?:\([^)]*\))?\s*\n(?:@\w+(?:\([^)]*\))?\s*\n)*(?:class|(?:async\s+)?def)\s+(\w+)/gm,
  ],
  typescript: [
    // Class definitions
    /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{[^}]*\}/gms,
    // Function declarations
    /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)(?:\s*:\s*[^{]+)?\s*\{[^}]*\}/gms,
    // Arrow function exports
    /^(?:export\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>\s*(?:\{[^}]*\}|[^;]+)/gms,
    // Interface definitions
    /^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s]+)?\s*\{[^}]*\}/gms,
    // Type definitions
    /^(?:export\s+)?type\s+(\w+)\s*(?:<[^>]+>)?\s*=\s*[^;]+/gms,
  ],
  javascript: [
    // Function declarations
    /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*\}/gms,
    // Arrow function exports
    /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*(?:\{[^}]*\}|[^;]+)/gms,
    // Class definitions
    /^(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?\s*\{[^}]*\}/gms,
  ],
};

/**
 * Extract imports from code
 */
function extractImports(content: string, language: string): string[] {
  const imports: string[] = [];
  
  if (language === 'python') {
    // from X import Y / import X
    const matches = content.matchAll(/^(?:from\s+([\w.]+)\s+)?import\s+(.+)$/gm);
    for (const match of matches) {
      imports.push(match[1] || match[2].split(',')[0].trim());
    }
  } else if (['typescript', 'javascript', 'tsx', 'jsx'].includes(language)) {
    // import X from 'Y' / import { X } from 'Y'
    const matches = content.matchAll(/import\s+(?:\{[^}]+\}|[\w*]+(?:\s+as\s+\w+)?)\s+from\s+['"]([^'"]+)['"]/g);
    for (const match of matches) {
      imports.push(match[1]);
    }
  }
  
  return imports;
}

/**
 * Extract exports from code
 */
function extractExports(content: string, language: string): string[] {
  const exports: string[] = [];
  
  if (language === 'python') {
    // Look for __all__ = [...]
    const allMatch = content.match(/__all__\s*=\s*\[([^\]]+)\]/);
    if (allMatch) {
      const items = allMatch[1].match(/['"](\w+)['"]/g);
      if (items) exports.push(...items.map(i => i.replace(/['"]/g, '')));
    }
    // Also class/function definitions at module level
    const defs = content.matchAll(/^(?:class|def)\s+(\w+)/gm);
    for (const match of defs) {
      if (!match[1].startsWith('_')) exports.push(match[1]);
    }
  } else if (['typescript', 'javascript'].includes(language)) {
    // export const/function/class X
    const matches = content.matchAll(/export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type)\s+(\w+)/g);
    for (const match of matches) {
      exports.push(match[1]);
    }
  }
  
  return exports;
}

/**
 * Extract docstring/JSDoc from code chunk
 */
function extractDocstring(content: string, language: string): string | undefined {
  if (language === 'python') {
    // Triple-quoted docstring
    const match = content.match(/^(?:class|def)\s+\w+[^:]+:\s*\n\s*['"""]{3}([^'"]+)['"""]{3}/m);
    if (match) return match[1].trim();
  } else if (['typescript', 'javascript'].includes(language)) {
    // JSDoc comment
    const match = content.match(/\/\*\*\s*([\s\S]*?)\s*\*\/\s*(?:export|const|function|class)/);
    if (match) return match[1].replace(/\s*\*\s*/g, ' ').trim();
  }
  return undefined;
}

/**
 * Parse a code file into semantic chunks
 * This is a simplified version - production would use tree-sitter
 */
export function parseCodeFile(
  filePath: string,
  content: string,
  language: string
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split('\n');
  
  // Always create a module-level chunk for imports and top-level code
  const imports = extractImports(content, language);
  const moduleExports = extractExports(content, language);
  
  // Try to extract semantic chunks using patterns
  const patterns = CHUNK_PATTERNS[language] || [];
  const processedRanges: [number, number][] = [];
  
  for (const pattern of patterns) {
    pattern.lastIndex = 0; // Reset regex
    let match;
    
    while ((match = pattern.exec(content)) !== null) {
      const startIndex = match.index;
      const endIndex = startIndex + match[0].length;
      
      // Find line numbers
      const beforeContent = content.slice(0, startIndex);
      const startLine = (beforeContent.match(/\n/g) || []).length + 1;
      const chunkLines = (match[0].match(/\n/g) || []).length;
      const endLine = startLine + chunkLines;
      
      // Skip if overlaps with already processed chunk
      const overlaps = processedRanges.some(([s, e]) => 
        (startLine >= s && startLine <= e) || (endLine >= s && endLine <= e)
      );
      if (overlaps) continue;
      
      processedRanges.push([startLine, endLine]);
      
      // Determine chunk type
      const chunkContent = match[0];
      let type: CodeChunk['type'] = 'function';
      if (chunkContent.includes('class ')) type = 'class';
      else if (chunkContent.includes('interface ')) type = 'interface';
      else if (chunkContent.includes('type ')) type = 'interface';
      
      // Extract name
      const nameMatch = chunkContent.match(/(?:class|def|function|const|interface|type)\s+(\w+)/);
      const name = nameMatch ? nameMatch[1] : 'anonymous';
      
      // Extract signature (first line)
      const signature = chunkContent.split('\n')[0].trim();
      
      chunks.push({
        id: `${filePath}:${name}:${startLine}`,
        filePath,
        type,
        name,
        content: chunkContent,
        startLine,
        endLine,
        language,
        signature,
        docstring: extractDocstring(chunkContent, language),
        dependencies: [], // Will be filled by relationship extraction
        exports: [],
      });
    }
  }
  
  // If no chunks extracted, create a single file-level chunk
  if (chunks.length === 0) {
    chunks.push({
      id: `${filePath}:module:1`,
      filePath,
      type: 'module',
      name: filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'module',
      content: content.slice(0, 3000), // Limit size
      startLine: 1,
      endLine: lines.length,
      language,
      dependencies: imports,
      exports: moduleExports,
    });
  } else {
    // Add dependencies/exports to first chunk as module-level info
    if (chunks.length > 0) {
      chunks[0].dependencies = imports;
      chunks[0].exports = moduleExports;
    }
  }
  
  return chunks;
}

// =============================================================================
// EMBEDDINGS - SEMANTIC SEARCH
// =============================================================================

/**
 * Generate embeddings for code chunks using OpenAI
 */
export async function generateEmbeddings(
  chunks: CodeChunk[],
  openaiClient: OpenAI,
  onProgress?: (msg: string) => void
): Promise<CodeChunk[]> {
  console.log(`[Embeddings] Generating embeddings for ${chunks.length} chunks`);
  
  // Prepare text for embedding - combine signature + docstring + snippet
  const textsToEmbed = chunks.map(chunk => {
    const parts = [
      `File: ${chunk.filePath}`,
      `Type: ${chunk.type}`,
      `Name: ${chunk.name}`,
    ];
    if (chunk.signature) parts.push(`Signature: ${chunk.signature}`);
    if (chunk.docstring) parts.push(`Documentation: ${chunk.docstring}`);
    parts.push(`Code:\n${chunk.content.slice(0, 1000)}`);
    return parts.join('\n');
  });
  
  // Batch embeddings (max 100 per request)
  const batchSize = 50;
  const embeddedChunks: CodeChunk[] = [];
  
  for (let i = 0; i < textsToEmbed.length; i += batchSize) {
    const batch = textsToEmbed.slice(i, i + batchSize);
    const batchChunks = chunks.slice(i, i + batchSize);
    
    onProgress?.(`Embedding chunks ${i + 1}-${Math.min(i + batchSize, chunks.length)} of ${chunks.length}...`);
    
    try {
      const response = await openaiClient.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch,
      });
      
      response.data.forEach((embedding, idx) => {
        embeddedChunks.push({
          ...batchChunks[idx],
          embedding: embedding.embedding,
        });
      });
    } catch (error) {
      console.error('[Embeddings] Error generating embeddings:', error);
      // Add chunks without embeddings
      embeddedChunks.push(...batchChunks);
    }
    
    // Rate limiting
    if (i + batchSize < textsToEmbed.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log(`[Embeddings] Generated ${embeddedChunks.filter(c => c.embedding).length} embeddings`);
  return embeddedChunks;
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Semantic search over code chunks
 */
export async function semanticSearch(
  query: string,
  chunks: CodeChunk[],
  openaiClient: OpenAI,
  topK: number = 10
): Promise<SearchResult[]> {
  console.log(`[Search] Searching for: "${query.slice(0, 50)}..."`);
  
  // Generate query embedding
  const queryResponse = await openaiClient.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });
  const queryEmbedding = queryResponse.data[0].embedding;
  
  // Find similar chunks
  const results: SearchResult[] = [];
  
  for (const chunk of chunks) {
    if (!chunk.embedding) continue;
    
    const score = cosineSimilarity(queryEmbedding, chunk.embedding);
    results.push({
      chunk,
      score,
      reason: `Similarity: ${(score * 100).toFixed(1)}%`,
    });
  }
  
  // Sort by score and return top K
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

// =============================================================================
// KNOWLEDGE GRAPH - RELATIONSHIPS
// =============================================================================

/**
 * Build relationships between code chunks
 */
export function buildRelationships(chunks: CodeChunk[]): CodeRelationship[] {
  const relationships: CodeRelationship[] = [];
  const chunksByFile = new Map<string, CodeChunk[]>();
  const chunksByName = new Map<string, CodeChunk>();
  
  // Index chunks
  for (const chunk of chunks) {
    // By file
    const fileChunks = chunksByFile.get(chunk.filePath) || [];
    fileChunks.push(chunk);
    chunksByFile.set(chunk.filePath, fileChunks);
    
    // By name
    chunksByName.set(chunk.name, chunk);
  }
  
  // Build import relationships
  for (const chunk of chunks) {
    if (!chunk.dependencies) continue;
    
    for (const dep of chunk.dependencies) {
      // Try to find the imported module
      const depName = dep.split('/').pop()?.split('.')[0] || dep;
      const targetChunk = chunksByName.get(depName);
      
      if (targetChunk) {
        relationships.push({
          from: chunk.id,
          to: targetChunk.id,
          type: 'imports',
        });
      } else {
        // External import - still track it
        relationships.push({
          from: chunk.id,
          to: dep,
          type: 'imports',
        });
      }
    }
  }
  
  // Build inheritance/implementation relationships (for classes)
  for (const chunk of chunks) {
    if (chunk.type !== 'class') continue;
    
    // Look for extends/implements in signature
    const extendsMatch = chunk.signature?.match(/extends\s+(\w+)/);
    if (extendsMatch) {
      const parentChunk = chunksByName.get(extendsMatch[1]);
      if (parentChunk) {
        relationships.push({
          from: chunk.id,
          to: parentChunk.id,
          type: 'extends',
        });
      }
    }
    
    const implementsMatch = chunk.signature?.match(/implements\s+([\w,\s]+)/);
    if (implementsMatch) {
      const interfaces = implementsMatch[1].split(',').map(i => i.trim());
      for (const iface of interfaces) {
        const ifaceChunk = chunksByName.get(iface);
        if (ifaceChunk) {
          relationships.push({
            from: chunk.id,
            to: ifaceChunk.id,
            type: 'implements',
          });
        }
      }
    }
  }
  
  // Build call relationships (simplified - look for function name usage)
  for (const chunk of chunks) {
    for (const other of chunks) {
      if (chunk.id === other.id) continue;
      if (chunk.filePath === other.filePath) continue; // Skip same-file for now
      
      // Check if chunk's content references other's name
      if (other.type === 'function' || other.type === 'class') {
        const nameRegex = new RegExp(`\\b${other.name}\\s*\\(`);
        if (nameRegex.test(chunk.content)) {
          relationships.push({
            from: chunk.id,
            to: other.id,
            type: 'calls',
          });
        }
      }
    }
  }
  
  console.log(`[KnowledgeGraph] Built ${relationships.length} relationships`);
  return relationships;
}

// =============================================================================
// AGENTIC ANALYSIS - INTELLIGENT EXPLORATION
// =============================================================================

interface AnalysisContext {
  chunks: CodeChunk[];
  relationships: CodeRelationship[];
  openaiClient: OpenAI;
  exploredPaths: Set<string>;
}

/**
 * Agentic analysis - explores codebase to answer specific questions
 * Similar to how Cursor's AI explores code to understand it
 */
export async function agenticAnalysis(
  question: string,
  context: AnalysisContext,
  maxIterations: number = 3
): Promise<{
  answer: string;
  relevantChunks: CodeChunk[];
  citations: string[];
}> {
  console.log(`[Agent] Starting analysis for: "${question.slice(0, 50)}..."`);
  
  const relevantChunks: CodeChunk[] = [];
  const citations: string[] = [];
  
  // Initial semantic search
  const initialResults = await semanticSearch(question, context.chunks, context.openaiClient, 5);
  relevantChunks.push(...initialResults.map(r => r.chunk));
  
  // Build context from initial results
  let analysisContext = initialResults.map(r => 
    `### ${r.chunk.filePath} (${r.chunk.type}: ${r.chunk.name})\n\`\`\`${r.chunk.language}\n${r.chunk.content.slice(0, 800)}\n\`\`\``
  ).join('\n\n');
  
  // Agentic exploration - ask LLM what else to look for
  for (let i = 0; i < maxIterations; i++) {
    const exploreResponse = await context.openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a code analysis agent. Given a question and some code context, determine if you have enough information to answer, or if you need to explore more.

If you need more information, respond with JSON:
{"needsMore": true, "searchQueries": ["query1", "query2"]}

If you have enough, respond with JSON:
{"needsMore": false, "answer": "Your detailed answer here"}`,
        },
        {
          role: 'user',
          content: `Question: ${question}\n\nCode Context:\n${analysisContext}`,
        },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });
    
    try {
      const result = JSON.parse(exploreResponse.choices[0]?.message?.content || '{}');
      
      if (!result.needsMore) {
        // We have enough - return answer
        return {
          answer: result.answer || 'Unable to determine',
          relevantChunks,
          citations: relevantChunks.map(c => c.filePath),
        };
      }
      
      // Need more - do additional searches
      for (const query of (result.searchQueries || []).slice(0, 2)) {
        const moreResults = await semanticSearch(query, context.chunks, context.openaiClient, 3);
        for (const r of moreResults) {
          if (!relevantChunks.find(c => c.id === r.chunk.id)) {
            relevantChunks.push(r.chunk);
            analysisContext += `\n\n### ${r.chunk.filePath} (${r.chunk.type}: ${r.chunk.name})\n\`\`\`${r.chunk.language}\n${r.chunk.content.slice(0, 800)}\n\`\`\``;
          }
        }
      }
    } catch {
      break;
    }
  }
  
  // Final answer after exploration
  const finalResponse = await context.openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a technical documentation expert. Based on the code provided, answer the question thoroughly. Cite specific files using [filepath] notation.',
      },
      {
        role: 'user',
        content: `Question: ${question}\n\nCode Context:\n${analysisContext}`,
      },
    ],
    temperature: 0.4,
  });
  
  return {
    answer: finalResponse.choices[0]?.message?.content || 'Unable to analyze',
    relevantChunks,
    citations: [...new Set(relevantChunks.map(c => c.filePath))],
  };
}

// =============================================================================
// MAIN INTERFACE - BUILD KNOWLEDGE GRAPH
// =============================================================================

export interface CodeIntelligenceResult {
  chunks: CodeChunk[];
  relationships: CodeRelationship[];
  search: (query: string, topK?: number) => Promise<SearchResult[]>;
  analyze: (question: string) => Promise<{ answer: string; relevantChunks: CodeChunk[]; citations: string[] }>;
  getChunksForTopic: (topic: string) => CodeChunk[];
}

/**
 * Fast keyword-based search (no embeddings required)
 * Much faster than semantic search - good for real-time generation
 */
function keywordSearch(query: string, chunks: CodeChunk[], topK: number = 10): SearchResult[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  const scored = chunks.map(chunk => {
    let score = 0;
    const searchText = `${chunk.filePath} ${chunk.name} ${chunk.content} ${chunk.docstring || ''}`.toLowerCase();
    
    for (const word of queryWords) {
      if (searchText.includes(word)) {
        score += 1;
        // Bonus for matches in name or path
        if (chunk.name.toLowerCase().includes(word)) score += 2;
        if (chunk.filePath.toLowerCase().includes(word)) score += 1;
      }
    }
    
    return { chunk, score, reason: `Keyword match: ${score} points` };
  });
  
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Build a complete code intelligence index from files
 * FAST MODE: Skips embeddings for real-time performance
 */
export async function buildCodeIntelligence(
  files: { path: string; content: string; language: string }[],
  openaiClient: OpenAI,
  onProgress?: (msg: string) => void,
  useEmbeddings: boolean = false // Default to fast mode
): Promise<CodeIntelligenceResult> {
  console.log(`[CodeIntel] Building intelligence from ${files.length} files (embeddings: ${useEmbeddings})`);
  onProgress?.('Parsing code into semantic chunks...');
  
  // 1. Parse all files into chunks
  let allChunks: CodeChunk[] = [];
  for (const file of files) {
    const chunks = parseCodeFile(file.path, file.content, file.language);
    allChunks.push(...chunks);
  }
  console.log(`[CodeIntel] Parsed ${allChunks.length} chunks from ${files.length} files`);
  
  // 2. Generate embeddings ONLY if explicitly requested (slow)
  if (useEmbeddings) {
    onProgress?.('Generating semantic embeddings (this may take a minute)...');
    allChunks = await generateEmbeddings(allChunks, openaiClient, onProgress);
  }
  
  // 3. Build relationships (fast)
  onProgress?.('Building knowledge graph...');
  const relationships = buildRelationships(allChunks);
  
  // 4. Create index structures
  const fileIndex = new Map<string, CodeChunk[]>();
  const symbolIndex = new Map<string, CodeChunk>();
  
  for (const chunk of allChunks) {
    const fileChunks = fileIndex.get(chunk.filePath) || [];
    fileChunks.push(chunk);
    fileIndex.set(chunk.filePath, fileChunks);
    symbolIndex.set(chunk.name, chunk);
  }
  
  onProgress?.(`Code intelligence ready: ${allChunks.length} chunks, ${relationships.length} relationships`);
  
  // Check if embeddings are available
  const hasEmbeddings = allChunks.some(c => c.embedding);
  
  // Return interface
  return {
    chunks: allChunks,
    relationships,
    
    // Use keyword search (fast) or semantic search (if embeddings available)
    search: async (query: string, topK: number = 10) => {
      if (hasEmbeddings) {
        return semanticSearch(query, allChunks, openaiClient, topK);
      }
      // Fast keyword-based search
      return keywordSearch(query, allChunks, topK);
    },
    
    analyze: async (question: string) => 
      agenticAnalysis(question, {
        chunks: allChunks,
        relationships,
        openaiClient,
        exploredPaths: new Set(),
      }),
    
    getChunksForTopic: (topic: string) => {
      const topicLower = topic.toLowerCase();
      return allChunks.filter(chunk => 
        chunk.name.toLowerCase().includes(topicLower) ||
        chunk.filePath.toLowerCase().includes(topicLower) ||
        (chunk.docstring && chunk.docstring.toLowerCase().includes(topicLower))
      );
    },
  };
}

