/**
 * OpenAI Client for Document Generation
 * 
 * This module provides real LLM integration for generating documentation.
 * It uses the OpenAI API with structured outputs for reliable generation.
 * 
 * KEY FEATURES:
 * 1. AST-aware semantic chunking (functions, classes, modules)
 * 2. Vector embeddings for semantic search
 * 3. Knowledge graph (imports, exports, call relationships)
 * 4. Agentic exploration for complex analysis
 * 
 * This is industry best practice - similar to Cursor, Copilot, Sourcegraph.
 */

import OpenAI from 'openai';
import { Template, TemplateSection, TemplateBlock, flattenTemplateBlocks, BlockType } from '@/store/templates';
import { 
  buildCodeIntelligence, 
  CodeIntelligenceResult, 
  CodeChunk,
  SearchResult,
  semanticSearch 
} from './code-intelligence';
import {
  generateWithAgent,
  initializeAgentMemory,
  updateAgentMemory,
  AgentMemory,
  AgentContext
} from './react-agent';
import { 
  getCachedKnowledgeBase, 
  getCachedCodeIntelligence, 
  serializeCodeIntelligence,
  isRepoUpdated 
} from './github-cache';
import { generateChart, isSandboxAvailable, ChartResult } from './sandbox-client';
import { 
  AVAILABLE_TOOLS, 
  executeTool, 
  formatToolResultForDocument, 
  getAvailableTools,
  ToolContext,
  ToolResult 
} from './llm-tools';

// Initialize OpenAI client
const getOpenAIClient = () => {
  const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY || 
                 (typeof window !== 'undefined' ? (window as any).__OPENAI_API_KEY__ : null);
  
  if (!apiKey || apiKey === 'sk-...' || apiKey.includes('...')) {
    throw new Error('OpenAI API key not configured. Please add NEXT_PUBLIC_OPENAI_API_KEY to your .env.local file and restart the dev server.');
  }
  
  console.log('[OpenAI] Initializing client with API key:', apiKey.substring(0, 10) + '...');
  
  return new OpenAI({ 
    apiKey,
    dangerouslyAllowBrowser: true,
    timeout: 60000,
    maxRetries: 2,
  });
};

/**
 * Code Knowledge Base - Stores categorized source files from the repository
 */
export interface CodeFile {
  path: string;
  name: string;
  content: string;
  category: 'model' | 'config' | 'api' | 'utils' | 'test' | 'docs' | 'data' | 'core' | 'other';
  language: string;
  size: number;
}

export interface CodeKnowledgeBase {
  files: CodeFile[];
  readme: string;
  repoName: string;
  description: string;
  primaryLanguage: string;
  topics: string[];
  structure: string[];
}

export interface GenerationContext {
  projectName: string;
  projectDescription: string;
  repoUrl?: string;
  repoReadme?: string;
  repoStructure?: string[];
  codebase?: CodeKnowledgeBase;
  codeIntelligence?: CodeIntelligenceResult; // Semantic search + knowledge graph
  codebaseSummary?: string; // LLM-generated understanding of what this codebase is
  agentMemory?: AgentMemory; // Persistent memory for ReAct agent
  template: Template;
  artifacts?: { name: string; type: string; description?: string }[];
}

export interface GeneratedBlock {
  id: string;
  type: 'LLM_TEXT' | 'LLM_TABLE' | 'LLM_CHART';
  title: string;
  content: string;
  confidence: number;
  citations: string[];
  // For LLM_CHART blocks with code execution
  generatedImage?: {
    base64: string;
    mimeType: string;
  };
  executedCode?: string;
}

export interface GeneratedSection {
  id: string;
  title: string;
  blocks: GeneratedBlock[];
  subsections?: GeneratedSection[];
}

export interface DocumentGap {
  id: string;
  sectionId: string;
  sectionTitle: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  suggestion: string;
}

export interface GenerationResult {
  documentTitle: string;
  sections: GeneratedSection[];
  gaps: DocumentGap[];
}

/**
 * Categorize a file by its path and name
 */
function categorizeFile(path: string, name: string): CodeFile['category'] {
  const lowerPath = path.toLowerCase();
  const lowerName = name.toLowerCase();
  
  // Tests
  if (lowerPath.includes('test') || lowerPath.includes('spec') || lowerName.includes('test') || lowerName.includes('spec')) {
    return 'test';
  }
  // Config files
  if (['config', 'settings', 'env', '.env', 'yaml', 'yml', 'json', 'toml', 'ini'].some(k => lowerName.includes(k)) ||
      lowerPath.includes('config')) {
    return 'config';
  }
  // Model/ML files
  if (lowerPath.includes('model') || lowerPath.includes('ml') || lowerPath.includes('train') || 
      lowerName.includes('model') || lowerName.includes('classifier') || lowerName.includes('predictor')) {
    return 'model';
  }
  // API/Routes
  if (lowerPath.includes('api') || lowerPath.includes('route') || lowerPath.includes('endpoint') ||
      lowerPath.includes('handler') || lowerPath.includes('controller')) {
    return 'api';
  }
  // Data handling
  if (lowerPath.includes('data') || lowerPath.includes('loader') || lowerPath.includes('dataset') ||
      lowerPath.includes('schema') || lowerPath.includes('migration')) {
    return 'data';
  }
  // Utils/Helpers
  if (lowerPath.includes('util') || lowerPath.includes('helper') || lowerPath.includes('common') ||
      lowerPath.includes('lib')) {
    return 'utils';
  }
  // Documentation
  if (lowerName.endsWith('.md') || lowerPath.includes('doc')) {
    return 'docs';
  }
  // Core/Main
  if (lowerName === 'main.py' || lowerName === 'index.ts' || lowerName === 'index.js' ||
      lowerName === 'app.py' || lowerName === 'server.ts' || lowerPath.includes('core')) {
    return 'core';
  }
  return 'other';
}

/**
 * Get language from file extension
 */
function getLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    'py': 'python', 'js': 'javascript', 'ts': 'typescript', 'jsx': 'jsx', 'tsx': 'tsx',
    'java': 'java', 'go': 'go', 'rs': 'rust', 'rb': 'ruby', 'php': 'php',
    'cs': 'csharp', 'cpp': 'cpp', 'c': 'c', 'h': 'c', 'hpp': 'cpp',
    'sql': 'sql', 'sh': 'bash', 'yaml': 'yaml', 'yml': 'yaml', 'json': 'json',
    'md': 'markdown', 'txt': 'text', 'html': 'html', 'css': 'css', 'scss': 'scss',
  };
  return langMap[ext] || 'text';
}

/**
 * Priority score for file importance (higher = more important to fetch)
 */
function getFilePriority(path: string, name: string): number {
  const lowerName = name.toLowerCase();
  const lowerPath = path.toLowerCase();
  
  // Highest priority - entry points and main files
  if (['main.py', 'app.py', 'index.ts', 'index.js', 'server.ts', 'server.js'].includes(lowerName)) return 100;
  
  // High priority - core implementation files
  if (lowerPath.includes('model') && !lowerPath.includes('test')) return 90;
  if (lowerPath.includes('core') && !lowerPath.includes('test')) return 85;
  if (lowerPath.includes('/src/') && !lowerPath.includes('test')) return 80;
  
  // Medium-high - config files
  if (['package.json', 'requirements.txt', 'setup.py', 'pyproject.toml', 'cargo.toml', 'go.mod'].includes(lowerName)) return 75;
  if (lowerName.includes('config')) return 70;
  
  // Medium - API and data files
  if (lowerPath.includes('api') || lowerPath.includes('route')) return 65;
  if (lowerPath.includes('data') || lowerPath.includes('schema')) return 60;
  
  // Lower - utils and helpers
  if (lowerPath.includes('util') || lowerPath.includes('helper')) return 40;
  
  // Documentation
  if (lowerName.endsWith('.md') && lowerName !== 'readme.md') return 30;
  
  // Tests (still useful for understanding behavior)
  if (lowerPath.includes('test')) return 20;
  
  return 10;
}

/**
 * Fetch actual file content from GitHub
 */
async function fetchFileContent(
  repoName: string,
  path: string,
  githubToken?: string | null,
  ref?: string | null
): Promise<string | null> {
  try {
    const headers: HeadersInit = { 'Accept': 'application/vnd.github.v3.raw' };
    const token = githubToken || process.env.NEXT_PUBLIC_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }
    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const response = await fetch(
      `https://api.github.com/repos/${repoName}/contents/${path}${refParam}`,
      { headers }
    );
    if (!response.ok) return null;
    const content = await response.text();
    // Limit file size to avoid token limits (first 500 lines or 15KB)
    const lines = content.split('\n');
    if (lines.length > 500) {
      return lines.slice(0, 500).join('\n') + '\n\n... [truncated, ' + (lines.length - 500) + ' more lines]';
    }
    if (content.length > 15000) {
      return content.slice(0, 15000) + '\n\n... [truncated]';
    }
    return content;
  } catch {
    return null;
  }
}

/**
 * Recursively collect all files from a directory
 */
async function collectFiles(
  repoName: string, 
  path: string = '',
  depth: number = 0,
  maxDepth: number = 3,
  githubToken?: string | null,
  ref?: string | null
): Promise<{ path: string; name: string; type: string; size: number }[]> {
  if (depth > maxDepth) return [];
  
  try {
    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const url = `https://api.github.com/repos/${repoName}/contents/${path}${refParam}`;
    console.log(`[GitHub] Fetching: ${url} (depth ${depth})`);
    
    const headers: HeadersInit = { 'Accept': 'application/vnd.github.v3+json' };
    if (githubToken) {
      headers['Authorization'] = `token ${githubToken}`;
    }
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GitHub] API error for ${url}: ${response.status} ${response.statusText}`, errorText);
      
      // If it's a 404 and we're at the root, this is a real problem
      if (response.status === 404 && depth === 0) {
        throw new Error(`GitHub contents error ${response.status} for ${url}. ${errorText}`);
      }
      
      // If it's a 404 on a subdirectory, just return empty (that path doesn't exist, but repo is accessible)
      if (response.status === 404) {
        console.warn(`[GitHub] Path not found (404): ${path}, continuing...`);
        return [];
      }
      
      // If it's a 403, might be rate limiting or private repo
      if (response.status === 403) {
        const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
        const rateLimitReset = response.headers.get('x-ratelimit-reset');
        if (rateLimitRemaining === '0') {
          throw new Error(`GitHub API rate limit exceeded. Reset at: ${new Date(Number(rateLimitReset) * 1000).toLocaleString()}`);
        }
        // If we're not at root and get 403, might be a permissions issue on a subdirectory
        if (depth > 0) {
          console.warn(`[GitHub] Access denied (403) for path: ${path}, skipping...`);
          return [];
        }
        throw new Error(`GitHub API access denied (403). The repository might be private or you may need authentication.`);
      }
      
      // For other errors at root level, throw; for subdirectories, just skip
      if (depth === 0) {
        throw new Error(`GitHub contents error ${response.status} for ${url}. ${errorText}`);
      }
      console.warn(`[GitHub] Error ${response.status} for path ${path}, skipping...`);
      return [];
    }
    
    const items = await response.json();
    
    if (!Array.isArray(items)) {
      console.warn(`[GitHub] Expected array but got:`, typeof items, items);
      return [];
    }
    
    console.log(`[GitHub] Found ${items.length} items in ${path || 'root'}`);
    
    let files: { path: string; name: string; type: string; size: number }[] = [];
    
    for (const item of items) {
      if (item.type === 'file') {
        files.push({ path: item.path, name: item.name, type: item.type, size: item.size || 0 });
      } else if (item.type === 'dir') {
        // Skip node_modules, __pycache__, .git, etc.
        const skipDirs = ['node_modules', '__pycache__', '.git', 'dist', 'build', 'venv', '.venv', 'env', '.env', '.next', 'out', 'coverage', '.nyc_output'];
        if (!skipDirs.includes(item.name.toLowerCase())) {
          const subFiles = await collectFiles(repoName, item.path, depth + 1, maxDepth, githubToken, ref);
          files = files.concat(subFiles);
        }
      }
    }
    
    return files;
  } catch (error) {
    console.error(`[GitHub] Error collecting files from ${path}:`, error);
    // Re-throw to surface the error instead of silently failing
    throw error;
  }
}

/**
 * Build a comprehensive code knowledge base from GitHub repository
 * This fetches ACTUAL SOURCE CODE, not just file names
 */
export async function buildCodeKnowledgeBase(
  repoUrl: string, 
  onProgress?: (msg: string) => void,
  githubToken?: string | null
): Promise<CodeKnowledgeBase> {
  console.log('[GitHub] Building code knowledge base for:', repoUrl);
  onProgress?.('Connecting to GitHub repository...');
  
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new Error('Invalid GitHub URL');
  }
  const [, owner, repo] = match;
  const repoName = `${owner}/${repo.replace(/\.git$/, '')}`;

  // Auto-detect GitHub token from various sources if not provided
  let token = githubToken;
  if (!token) {
    try {
      const { getGitHubToken } = await import('@/lib/github-auth');
      token = await getGitHubToken();
    } catch (error) {
      // Fallback to env vars
      token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || process.env.NEXT_PUBLIC_GITHUB_TOKEN || null;
    }
  }
  
  const headers: HeadersInit = { 'Accept': 'application/vnd.github.v3+json' };
  if (token) {
    headers['Authorization'] = `token ${token}`;
    console.log('[GitHub] Using authentication token');
  } else {
    console.log('[GitHub] No authentication token - will only work for public repos');
  }

  try {
    // First, verify the repository is accessible
    onProgress?.('Verifying repository access...');
    const repoCheckResponse = await fetch(`https://api.github.com/repos/${repoName}`, {
      headers
    });
    
    if (!repoCheckResponse.ok) {
      const errorText = await repoCheckResponse.text().catch(() => '');
      console.error(`[GitHub] Repository check failed: ${repoCheckResponse.status}`, errorText);
      
      if (repoCheckResponse.status === 404) {
        const errorMsg = token
          ? `Repository not found. Please check the repository URL: ${repoUrl}`
          : `Repository not found or is private. ` +
            `Please ensure the repository URL is correct and the repository is public, ` +
            `or sign in with GitHub to access private repositories. URL: ${repoUrl}`;
        throw new Error(errorMsg);
      }
      
      if (repoCheckResponse.status === 403) {
        const rateLimitRemaining = repoCheckResponse.headers.get('x-ratelimit-remaining');
        const rateLimitReset = repoCheckResponse.headers.get('x-ratelimit-reset');
        if (rateLimitRemaining === '0') {
          const resetTime = rateLimitReset 
            ? new Date(Number(rateLimitReset) * 1000).toLocaleString()
            : 'unknown time';
          throw new Error(`GitHub API rate limit exceeded. Reset at: ${resetTime}`);
        }
        throw new Error(
          `GitHub API access denied (403). The repository might be private or you may need authentication. ` +
          `If this is a private repository, you'll need to add a GitHub personal access token.`
        );
      }
      
      throw new Error(`GitHub API error: ${repoCheckResponse.status} ${repoCheckResponse.statusText}`);
    }
    
    const repoInfo = await repoCheckResponse.json();
    console.log('[GitHub] Repository verified:', repoInfo.name, repoInfo.private ? '(private)' : '(public)');
    const defaultBranch = repoInfo?.default_branch || null;
    if (defaultBranch) {
      console.log('[GitHub] Default branch:', defaultBranch);
    }
    
    // Fetch repo metadata
    onProgress?.('Fetching repository metadata...');
    const readmeHeaders: HeadersInit = { 'Accept': 'application/vnd.github.v3.raw' };
    if (token) {
      readmeHeaders['Authorization'] = `token ${token}`;
    }
    const readme = await fetch(`https://api.github.com/repos/${repoName}/readme`, {
      headers: readmeHeaders
    }).then(res => res.ok ? res.text() : '').catch(() => '');

    // Verify contents API access at repository root
    onProgress?.('Checking repository contents...');
    const rootRefParam = defaultBranch ? `?ref=${encodeURIComponent(defaultBranch)}` : '';
    const rootContentsUrl = `https://api.github.com/repos/${repoName}/contents/${rootRefParam}`;
    const rootContentsRes = await fetch(rootContentsUrl, { headers: readmeHeaders });
    if (!rootContentsRes.ok) {
      const rootErr = await rootContentsRes.text().catch(() => '');
      throw new Error(
        `GitHub contents API error ${rootContentsRes.status} for ${rootContentsUrl}. ${rootErr}`
      );
    }

    // Collect all files in the repository (up to 4 levels deep for better coverage)
    onProgress?.('Scanning repository structure...');
    let allFiles: { path: string; name: string; type: string; size: number }[] = [];
    
    try {
      allFiles = await collectFiles(repoName, '', 0, 4, token, defaultBranch); // Increased depth to 4
      console.log(`[GitHub] Found ${allFiles.length} total files in repository`);
    } catch (error) {
      console.error('[GitHub] Failed to collect files:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Provide more helpful error messages
      if (errorMessage.includes('contents error')) {
        throw new Error(
          `GitHub contents API failed. This usually means the repo is accessible, ` +
          `but the contents endpoint could not be read. ` +
          `Error: ${errorMessage}`
        );
      }

      if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        throw new Error(
          `Repository not found or is private. ` +
          `Please ensure the repository URL is correct and the repository is public, ` +
          `or that you have access to it. URL: ${repoUrl}`
        );
      }
      
      if (errorMessage.includes('403') || errorMessage.includes('rate limit')) {
        throw new Error(
          `GitHub API access denied. This could be due to: ` +
          `1) The repository is private (requires authentication), ` +
          `2) GitHub API rate limit exceeded, or ` +
          `3) Missing permissions. ` +
          `Error: ${errorMessage}`
        );
      }
      
      throw new Error(`Failed to scan repository: ${errorMessage}`);
    }

    if (allFiles.length === 0) {
      throw new Error('No files found in repository. The repository might be empty, private, or the path structure is unexpected.');
    }

    // Filter to source code files only
    const codeExtensions = ['py', 'js', 'ts', 'jsx', 'tsx', 'java', 'go', 'rs', 'rb', 'php', 'cs', 'cpp', 'c', 'h', 'sql', 'yaml', 'yml', 'json', 'toml', 'md', 'sh', 'bash', 'zsh', 'fish'];
    const sourceFiles = allFiles.filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      const hasExtension = ext.length > 0;
      const isCodeFile = codeExtensions.includes(ext);
      const isSmallEnough = f.size < 100000; // Skip very large files
      
      // Also include files without extensions if they're in common code directories
      const isInCodeDir = f.path.includes('/src/') || f.path.includes('/lib/') || f.path.includes('/app/');
      const isLikelyCode = !hasExtension && isInCodeDir;
      
      return (isCodeFile || isLikelyCode) && isSmallEnough;
    });

    console.log(`[GitHub] Filtered to ${sourceFiles.length} source code files (from ${allFiles.length} total)`);

    if (sourceFiles.length === 0) {
      // Show what files we found for debugging
      const sampleFiles = allFiles.slice(0, 20).map(f => `${f.name} (${f.size} bytes)`).join(', ');
      throw new Error(
        `No source code files found. Found ${allFiles.length} total files, but none matched code file extensions. ` +
        `Sample files: ${sampleFiles}. ` +
        `Looking for extensions: ${codeExtensions.join(', ')}`
      );
    }

    // Prioritize and select top files (limit to avoid rate limits and token limits)
    const prioritizedFiles = sourceFiles
      .map(f => ({ ...f, priority: getFilePriority(f.path, f.name) }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 15); // Fetch up to 15 most important files (balanced speed/coverage)

    console.log(`[GitHub] Selected ${prioritizedFiles.length} files to analyze (top priority files)`);
    onProgress?.(`Analyzing ${prioritizedFiles.length} source files...`);

    // Fetch actual file contents in parallel (with rate limit consideration)
    const codeFiles: CodeFile[] = [];
    const batchSize = 5;
    
    for (let i = 0; i < prioritizedFiles.length; i += batchSize) {
      const batch = prioritizedFiles.slice(i, i + batchSize);
      onProgress?.(`Reading files ${i + 1}-${Math.min(i + batchSize, prioritizedFiles.length)} of ${prioritizedFiles.length}...`);
      
      const contents = await Promise.all(
        batch.map(f => fetchFileContent(repoName, f.path, token, defaultBranch))
      );
      
      batch.forEach((file, idx) => {
        const content = contents[idx];
        if (content) {
          codeFiles.push({
            path: file.path,
            name: file.name,
            content,
            category: categorizeFile(file.path, file.name),
            language: getLanguage(file.name),
            size: content.length,
          });
        }
      });
      
      // Small delay to avoid rate limiting
      if (i + batchSize < prioritizedFiles.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`[GitHub] Successfully fetched ${codeFiles.length} files`);
    onProgress?.(`Loaded ${codeFiles.length} source files`);

    // Build structure summary
    const structure: string[] = [];
    if (repoInfo?.description) structure.push(`📋 Description: ${repoInfo.description}`);
    if (repoInfo?.language) structure.push(`💻 Primary Language: ${repoInfo.language}`);
    if (repoInfo?.topics?.length > 0) structure.push(`🏷️ Topics: ${repoInfo.topics.join(', ')}`);
    structure.push('');
    structure.push('📂 Key Files Analyzed:');
    
    // Group files by category
    const byCategory = codeFiles.reduce((acc, f) => {
      acc[f.category] = acc[f.category] || [];
      acc[f.category].push(f.path);
      return acc;
    }, {} as Record<string, string[]>);
    
    Object.entries(byCategory).forEach(([cat, paths]) => {
      structure.push(`  ${cat.toUpperCase()}: ${paths.slice(0, 5).join(', ')}${paths.length > 5 ? ` +${paths.length - 5} more` : ''}`);
    });

    return {
      files: codeFiles,
      readme,
      repoName,
      description: repoInfo?.description || '',
      primaryLanguage: repoInfo?.language || 'Unknown',
      topics: repoInfo?.topics || [],
      structure,
    };
  } catch (error) {
    console.error('[GitHub] Error building knowledge base:', error);
    // Re-throw the error so the caller can handle it properly
    throw error;
  }
}

/**
 * Legacy function for backward compatibility
 */
export async function fetchGitHubContext(repoUrl: string): Promise<{
  readme: string;
  structure: string[];
  repoName: string;
}> {
  const kb = await buildCodeKnowledgeBase(repoUrl);
  return {
    readme: kb.readme,
    structure: kb.structure,
    repoName: kb.repoName,
  };
}

/**
 * Get relevant source code files for a specific section/block
 */
function getRelevantCode(
  codebase: CodeKnowledgeBase | undefined,
  blockTitle: string,
  dataSources: string[]
): { files: CodeFile[]; citations: string[] } {
  if (!codebase || codebase.files.length === 0) {
    return { files: [], citations: [] };
  }

  const titleLower = blockTitle.toLowerCase();
  const dataSourcesLower = dataSources.map(d => d.toLowerCase()).join(' ');
  const searchTerms = `${titleLower} ${dataSourcesLower}`;

  // Score files by relevance to this block
  const scored = codebase.files.map(file => {
    let score = 0;
    const pathLower = file.path.toLowerCase();
    const contentLower = file.content.toLowerCase();

    // Category matching
    if (searchTerms.includes('model') && file.category === 'model') score += 50;
    if (searchTerms.includes('config') && file.category === 'config') score += 50;
    if (searchTerms.includes('api') && file.category === 'api') score += 50;
    if (searchTerms.includes('data') && file.category === 'data') score += 50;
    if (searchTerms.includes('test') && file.category === 'test') score += 50;
    if (searchTerms.includes('architecture') && (file.category === 'core' || file.category === 'model')) score += 40;
    
    // Path matching
    if (pathLower.includes('model') && searchTerms.includes('model')) score += 30;
    if (pathLower.includes('train') && searchTerms.includes('train')) score += 30;
    if (pathLower.includes('config') && searchTerms.includes('config')) score += 30;
    if (pathLower.includes('api') && searchTerms.includes('api')) score += 30;
    
    // Content relevance (check for key terms in actual code)
    if (searchTerms.includes('model') && contentLower.includes('class')) score += 20;
    if (searchTerms.includes('model') && contentLower.includes('def train')) score += 25;
    if (searchTerms.includes('api') && (contentLower.includes('route') || contentLower.includes('endpoint'))) score += 25;
    if (searchTerms.includes('data') && (contentLower.includes('dataloader') || contentLower.includes('dataset'))) score += 25;
    
    // Core files always get some score
    if (file.category === 'core') score += 15;
    if (file.category === 'config') score += 10;
    
    return { file, score };
  });

  // Get top relevant files (limit to manage token count)
  const topFiles = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => s.file);

  // If no relevant files found by scoring, fall back to category matching
  if (topFiles.length === 0) {
    const categoryMap: Record<string, CodeFile['category'][]> = {
      'model': ['model', 'core'],
      'architecture': ['model', 'core', 'api'],
      'api': ['api', 'core'],
      'data': ['data', 'utils'],
      'config': ['config'],
      'test': ['test'],
    };
    
    for (const [keyword, categories] of Object.entries(categoryMap)) {
      if (searchTerms.includes(keyword)) {
        const matches = codebase.files.filter(f => categories.includes(f.category)).slice(0, 3);
        if (matches.length > 0) return { files: matches, citations: matches.map(f => f.path) };
      }
    }
    
    // Last resort: return first few core/model files
    const fallback = codebase.files.filter(f => ['core', 'model', 'config'].includes(f.category)).slice(0, 3);
    return { files: fallback, citations: fallback.map(f => f.path) };
  }

  return { files: topFiles, citations: topFiles.map(f => f.path) };
}

/**
 * Build the system prompt for document generation
 * 
 * BALANCED APPROACH - Fallback when semantic search not available
 */
function buildSystemPrompt(context: GenerationContext, relevantCode?: CodeFile[]): string {
  const allowedFiles = relevantCode?.map(f => f.path) || [];
  
  let codeContext = '';
  if (relevantCode && relevantCode.length > 0) {
    codeContext = `
## SOURCE CODE FOR ANALYSIS

${relevantCode.map(file => `
### File: ${file.path}
\`\`\`${file.language}
${file.content.slice(0, 3000)}
\`\`\`
`).join('\n')}
`;
  }

  return `You are a senior software engineer writing technical documentation. Analyze the provided code and write clear, accurate documentation.

## YOUR APPROACH

Read the code like a senior developer:
1. **File structure** → Infer architecture
2. **Class/function names** → Understand purposes  
3. **Imports** → Map dependencies
4. **Configs** → Extract actual values
5. **Comments/docstrings** → Use existing docs

Write substantive documentation explaining what the system does, how components work, and how data flows.

## WHAT TO INFER (DO THIS)

Make reasonable inferences from code patterns:
- Architecture from directory structure
- Component purposes from class/function names
- Data flows from imports and function signatures
- Technologies from dependencies and frameworks

## WHAT NOT TO FABRICATE

Use [TBD] ONLY for unmeasurable values:
- Specific accuracy/precision percentages
- Latency measurements
- Production statistics
- Benchmark comparisons

Format: "Model accuracy: [TBD] (to be measured during validation)"

## CITATION RULES

Available files: ${allowedFiles.length > 0 ? allowedFiles.join(', ') : 'repository code'}
Only cite files from this list.

## PROJECT CONTEXT
- Project: ${context.projectName}
- Description: ${context.projectDescription || 'Software system'}
${context.codebase ? `- Primary Language: ${context.codebase.primaryLanguage}` : ''}

${codeContext}

${context.repoReadme ? `## README\n${context.repoReadme.slice(0, 2000)}` : ''}

${context.codebase?.structure?.length ? `## Repository Structure\n${context.codebase.structure.slice(0, 25).join('\n')}` : ''}
`;
}

/**
 * Build system prompt with semantic search results
 * 
 * BALANCED APPROACH:
 * - ALWAYS write substantive documentation based on code analysis
 * - INFER architecture, purpose, components from code patterns
 * - Use [TBD] ONLY for specific unmeasurable values (metrics, benchmarks)
 * - Never fabricate specific numbers or non-existent file paths
 */
function buildSystemPromptWithSemanticContext(
  context: GenerationContext, 
  semanticContext: string,
  citations: string[]
): string {
  const allowedCitations = citations.slice(0, 15);
  
  // Include the codebase summary if available
  const codebaseSummarySection = context.codebaseSummary 
    ? `## CODEBASE ANALYSIS (READ THIS FIRST)

${context.codebaseSummary}

---

Based on the above analysis, adapt your documentation accordingly. Do NOT describe features that don't exist in this codebase.`
    : '';

  return `You are a senior software engineer writing technical documentation by analyzing actual source code.

${codebaseSummarySection}

## CRITICAL INSTRUCTION

Read the codebase analysis above carefully. It tells you EXACTLY what this system is. 
- If it says "this is NOT an ML model" → Do NOT write about neural networks, training, layers, etc.
- If it says "uses OpenAI API" → Write about API configuration, prompts, not local model training
- Adapt ALL section topics to match what this system actually does

## AVAILABLE FILES FOR CITATION

${allowedCitations.length > 0 ? allowedCitations.join(', ') : 'Files provided in context'}

Only cite files from this list.

## HOW TO ADAPT SECTIONS

For a GenAI app using external APIs (like OpenAI):
- "Training Process" → Model selection, API configuration, prompt engineering
- "Model Architecture" → Which LLM used, how it's called, prompt structure
- "Data Requirements" → Input formats, what data the app processes

For a web application:
- "Training Process" → Build process, deployment workflow
- "Model Architecture" → System architecture, component structure

## CITATIONS

Reference source files: [path/to/file.ext]

## PROJECT
- Name: ${context.projectName}
- Description: ${context.projectDescription || 'Software system'}
${context.codebase ? `- Language: ${context.codebase.primaryLanguage}` : ''}

## SOURCE CODE

${semanticContext || 'Code context provided below.'}

${context.repoReadme ? `## README\n${context.repoReadme.slice(0, 1200)}` : ''}
`;
}

/**
 * Get block-type specific instructions
 */
function getBlockTypeInstructions(blockType: BlockType): string {
  switch (blockType) {
    case 'LLM_TABLE':
      return `
OUTPUT FORMAT: Generate a markdown table. Use proper table syntax:
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |

Make the table comprehensive and include all relevant data.`;
    
    case 'LLM_CHART':
      return `
OUTPUT FORMAT: You have access to a Python sandbox that can execute matplotlib code.
Write a description of the chart AND provide Python code to generate it.

Your response should include:
1. A brief description of what the chart shows
2. Python code block that generates the chart using matplotlib

The code will be executed and the chart will be embedded in the document.
Use this format:

\`\`\`python
import matplotlib.pyplot as plt
import numpy as np

# Your chart generation code here
# The chart will automatically be saved
\`\`\``;
    
    case 'LLM_TEXT':
    default:
      return `
OUTPUT FORMAT: Generate well-structured prose with:
- Clear paragraphs
- Bullet points where appropriate
- Code blocks for technical content
- Bold/italic for emphasis`;
  }
}

/**
 * Extract Python code from LLM response and execute it to generate a chart
 */
async function extractAndExecuteChartCode(
  content: string
): Promise<{ generatedImage?: { base64: string; mimeType: string }; executedCode?: string } | null> {
  // Check if sandbox is available
  const sandboxAvailable = await isSandboxAvailable();
  if (!sandboxAvailable) {
    console.log('[OpenAI] Python sandbox not available, skipping chart execution');
    return null;
  }

  // Extract Python code from the content
  const pythonCodeMatch = content.match(/```python\s*([\s\S]*?)```/);
  if (!pythonCodeMatch) {
    console.log('[OpenAI] No Python code block found in chart response');
    return null;
  }

  const pythonCode = pythonCodeMatch[1].trim();
  console.log('[OpenAI] Executing chart code:', pythonCode.substring(0, 100) + '...');

  try {
    const chartResult = await generateChart(pythonCode);
    
    if (chartResult.success && chartResult.imageBase64) {
      return {
        generatedImage: {
          base64: chartResult.imageBase64,
          mimeType: chartResult.imageMimeType || 'image/png',
        },
        executedCode: pythonCode,
      };
    } else {
      console.warn('[OpenAI] Chart generation failed:', chartResult.error);
      return {
        executedCode: pythonCode,
      };
    }
  } catch (error) {
    console.error('[OpenAI] Chart execution error:', error);
    return null;
  }
}

/**
 * Generate a single block using the template's instructions
 * NOW WITH SEMANTIC SEARCH + KNOWLEDGE GRAPH
 */
async function generateBlock(
  openai: OpenAI,
  context: GenerationContext,
  block: {
    id: string;
    title: string;
    type: BlockType;
    instructions: string;
    dataSources: string[];
    sectionPath: string[];
  }
): Promise<GeneratedBlock> {
  console.log(`[OpenAI] Generating block: ${block.title}`);
  
  // USE REACT AGENT if available (preferred method - prevents hallucination)
  if (context.codeIntelligence && context.agentMemory) {
    console.log(`[OpenAI] Using ReAct agent for: ${block.title}`);
    
    const agentCtx: AgentContext = {
      openai,
      codeIntelligence: context.codeIntelligence,
      memory: context.agentMemory,
      projectName: context.projectName,
      availableFiles: context.codebase?.files.map(f => f.path) || []
    };
    
    try {
      const agentResult = await generateWithAgent(
        agentCtx,
        block.title,
        block.instructions,
        3 // max iterations for think-search-draft-verify loop
      );
      
      // Update agent memory with what was generated
      updateAgentMemory(context.agentMemory, block.title, agentResult.citations);
      
      console.log(`[OpenAI] Agent completed: ${agentResult.searchIterations} iterations, verified: ${agentResult.verificationPassed}`);
      
      return {
        id: block.id,
        type: block.type as 'LLM_TEXT' | 'LLM_TABLE' | 'LLM_CHART',
        title: block.title,
        content: agentResult.content,
        confidence: agentResult.confidence,
        citations: agentResult.citations,
      };
    } catch (error) {
      console.error(`[OpenAI] Agent failed for "${block.title}", falling back to direct generation:`, error);
      // Fall through to legacy generation
    }
  }
  
  // LEGACY GENERATION (fallback when agent not available)
  console.log(`[OpenAI] Using legacy generation for: ${block.title}`);
  
  let relevantFiles: CodeFile[] = [];
  let expectedCitations: string[] = [];
  let semanticContext = '';
  
  // BEST PRACTICE: Use semantic search if available (like Cursor does)
  if (context.codeIntelligence) {
    // Build a search query from block title + instructions
    const searchQuery = `${block.title} ${block.instructions.slice(0, 200)} ${block.dataSources.join(' ')}`;
    
    try {
      const searchResults = await context.codeIntelligence.search(searchQuery, 8);
      console.log(`[OpenAI] Semantic search found ${searchResults.length} relevant chunks for "${block.title}"`);
      
      // Convert search results to context
      semanticContext = searchResults.map((r: SearchResult) => 
        `### ${r.chunk.filePath} (${r.chunk.type}: ${r.chunk.name}) - Relevance: ${(r.score * 100).toFixed(0)}%
${r.chunk.docstring ? `Documentation: ${r.chunk.docstring}\n` : ''}
\`\`\`${r.chunk.language}
${r.chunk.content.slice(0, 1500)}
\`\`\``
      ).join('\n\n');
      
      expectedCitations = [...new Set(searchResults.map((r: SearchResult) => r.chunk.filePath))];
      
      // Also get related chunks via knowledge graph
      if (searchResults.length > 0) {
        const primaryChunk = searchResults[0].chunk;
        const relatedChunks = context.codeIntelligence.chunks.filter((c: CodeChunk) =>
          context.codeIntelligence!.relationships.some(r =>
            (r.from === primaryChunk.id && r.to === c.id) ||
            (r.to === primaryChunk.id && r.from === c.id)
          )
        ).slice(0, 3);
        
        if (relatedChunks.length > 0) {
          semanticContext += '\n\n## Related Code (via Knowledge Graph)\n';
          semanticContext += relatedChunks.map((c: CodeChunk) => 
            `### ${c.filePath} (${c.type}: ${c.name})\n\`\`\`${c.language}\n${c.content.slice(0, 800)}\n\`\`\``
          ).join('\n\n');
          expectedCitations.push(...relatedChunks.map((c: CodeChunk) => c.filePath));
        }
      }
    } catch (error) {
      console.error(`[OpenAI] Semantic search failed for "${block.title}":`, error);
    }
  }
  
  // Fallback to basic file matching if no semantic results
  if (!semanticContext && context.codebase) {
    const { files, citations } = getRelevantCode(
      context.codebase,
      block.title,
      block.dataSources
    );
    relevantFiles = files;
    expectedCitations = citations;
    console.log(`[OpenAI] Fallback: Found ${relevantFiles.length} relevant files for "${block.title}"`);
  }
  
  // ALWAYS ensure we have some citations from the codebase
  if (expectedCitations.length === 0 && context.codebase?.files) {
    expectedCitations = context.codebase.files.slice(0, 5).map(f => f.path);
    console.log(`[OpenAI] Using codebase files as citations for "${block.title}"`);
  }
  
  console.log(`[OpenAI] Citations for "${block.title}":`, expectedCitations.slice(0, 5).join(', '));
  
  // Build system prompt - prefer semantic context over raw files
  const systemPrompt = semanticContext 
    ? buildSystemPromptWithSemanticContext(context, semanticContext, expectedCitations)
    : buildSystemPrompt(context, relevantFiles);
  
  const blockTypeInstructions = getBlockTypeInstructions(block.type);
  
  // Build list of available files for the LLM to reference
  const availableFiles = expectedCitations.length > 0 
    ? `Files analyzed for this section:\n${expectedCitations.slice(0, 10).map(f => `- [${f}]`).join('\n')}`
    : '';
  
  const userPrompt = `Write the "${block.title}" section.

Document Path: ${block.sectionPath.join(' > ')}

## CRITICAL: DO NOT include the section title "${block.title}" in your response.
The title will be rendered separately. Start directly with your content.

## Section Requirements
${block.instructions}

${availableFiles}

${blockTypeInstructions}

## YOUR TASK

You are a senior developer documenting a codebase. Your job is to:

1. **Understand what this codebase actually is** by analyzing the provided files
2. **Adapt the section topic to what's relevant** for this specific system
3. **Write substantive content** about the actual functionality
4. **Cite specific files** when describing functionality

## HOW TO ADAPT SECTIONS

The section topic "${block.title}" may need to be interpreted based on what the codebase actually is:

**Example adaptations:**
- "Training Process" for a GenAI app → Write about model configuration, prompt engineering, API integration
- "Training Process" for a web app → Write about development workflow, build process, or state "This is a web application without ML training components"
- "Data Requirements" for any app → Write about input data, configuration files, API data sources
- "Model Architecture" for a GenAI app → Write about which LLM is used, how it's configured, prompt structure

## WRITING RULES

1. **Always write something substantive** - Never mark an entire section as "NOT APPLICABLE"
   
2. **Describe what IS there** - If asked about "Training" but this is a GenAI app using OpenAI, write about:
   - Which model is used (gpt-4o, gpt-4o-mini, etc.)
   - How it's configured (temperature, max_tokens, etc.)
   - That training is handled by the model provider
   - Any prompt engineering or system prompts

3. **Use [TBD] sparingly** - Only for specific numeric values that need measurement

4. **Use [NEEDS: xxx] for gaps** - When you need specific business context:
   - [NEEDS: target user demographics]
   - [NEEDS: production deployment environment]
   - [NEEDS: compliance requirements]

5. **Cite your sources** - Reference files like [filename.ext]

## WHAT TO AVOID (CRITICAL)

**DO NOT INVENT FILE PATHS.** Only cite files from the "Files analyzed" list above. If you cite [src/config/model_config.py] but it's not in the list, that's a fabrication.

**DO NOT INVENT CODE EXAMPLES.** Don't write fake code snippets pretending they're from the codebase. Only quote actual code you've been shown.

**DO NOT INVENT ARCHITECTURE.** If you weren't shown neural network layers, transformer blocks, or training loops, don't describe them.

**DO NOT WRITE GENERIC ML CONTENT.** If this is a web app that calls OpenAI's API, don't describe "12-layer transformers" or "k-fold cross-validation."

- Use [TBD] for metrics you can't find
- Don't refuse to write - but adapt content to what's actually there

## EXAMPLE OUTPUT

For "Training Process" on a GenAI documentation tool:

"This system leverages OpenAI's foundation models for content generation, eliminating the need for local model training. The model configuration is defined in [src/lib/openai.ts]:

**Model Configuration:**
- Provider: OpenAI API
- Model: gpt-4o-mini (configured via environment variables)
- Temperature: 0.5 for balanced creativity and consistency
- Max tokens: 2000 per generation request

**Prompt Engineering:**
The system uses structured prompts to guide generation, with system prompts defining the documentation style and user prompts providing section-specific requirements..."

## NOW WRITE

Analyze the code, understand what this system is, adapt the section topic appropriately, and write useful documentation.`;

  try {
    // Get available tools (depends on sandbox availability)
    const tools = await getAvailableTools();
    const toolContext: ToolContext = {
      projectName: context.projectName,
      repoUrl: context.repoUrl,
      codebaseFiles: expectedCitations,
      currentSection: block.title,
    };
    
    // Track accumulated content and tool outputs
    let content = '';
    let generatedImage: { base64: string; mimeType: string } | undefined;
    let executedCode: string | undefined;
    
    // Initial API call with tools
    let response = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt + '\n\nYou have access to tools for generating charts, executing Python analysis, and creating tables. Use them when appropriate to enhance the documentation.' },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5,
        max_tokens: 2000,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
      }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('OpenAI API call timed out')), 45000)
      )
    ]);
    
    // Handle tool calls in a loop
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    
    let iterations = 0;
    const maxIterations = 3; // Prevent infinite loops
    
    while (response.choices[0]?.message?.tool_calls && iterations < maxIterations) {
      iterations++;
      const toolCalls = response.choices[0].message.tool_calls;
      console.log(`[OpenAI] Tool calls requested for "${block.title}":`, toolCalls.map(tc => tc.function.name));
      
      // Add assistant message with tool calls
      messages.push(response.choices[0].message);
      
      // Execute each tool call
      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);
        
        const toolResult = await executeTool(toolName, toolArgs, toolContext);
        const formattedResult = formatToolResultForDocument(toolName, toolResult);
        
        // Capture generated images and code
        if (formattedResult.generatedImage) {
          generatedImage = formattedResult.generatedImage;
        }
        if (formattedResult.executedCode) {
          executedCode = formattedResult.executedCode;
        }
        
        // Add tool result to messages
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            success: toolResult.success,
            content: formattedResult.content,
            hasImage: !!formattedResult.generatedImage,
            error: toolResult.error,
          }),
        });
      }
      
      // Continue conversation with tool results
      response = await Promise.race([
        openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages,
          temperature: 0.5,
          max_tokens: 2000,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? 'auto' : undefined,
        }),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('OpenAI API call timed out')), 30000)
        )
      ]);
    }
    
    // Get final content
    content = response.choices[0]?.message?.content || 'Failed to generate content';
    console.log(`[OpenAI] Generated ${block.title}, length: ${content.length} chars, iterations: ${iterations}`);
    
    // POST-PROCESSING: Validate and clean content
    
    // 1. Extract citations from generated content
    const citationRegex = /\[([^\]]+\.[a-zA-Z]+(?::\d+-\d+)?)\]/g;
    const foundCitations: string[] = [];
    let match;
    while ((match = citationRegex.exec(content)) !== null) {
      foundCitations.push(match[1]);
    }
    
    // 2. VALIDATE CITATIONS - only keep ones we actually provided
    const validCitations = foundCitations.filter(citation => {
      const citationPath = citation.split(':')[0]; // Remove line numbers
      return expectedCitations.some(expected => 
        expected.includes(citationPath) || citationPath.includes(expected.split('/').pop() || '')
      );
    });
    
    // 3. REMOVE fabricated citations from content
    const fabricatedCitations = foundCitations.filter(c => !validCitations.includes(c));
    if (fabricatedCitations.length > 0) {
      console.warn(`[OpenAI] Removing ${fabricatedCitations.length} fabricated citations from "${block.title}":`, fabricatedCitations);
      
      // Remove fabricated citations from the content
      for (const fabricated of fabricatedCitations) {
        // Remove [fabricated.py] and surrounding context if it looks like a fake file reference
        const escapedCitation = fabricated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        content = content.replace(new RegExp(`\\[${escapedCitation}\\]`, 'g'), '');
        
        // Also remove code blocks that reference fake files
        const fakeCodeBlockPattern = new RegExp(
          `\`\`\`[\\w]*\\s*(?:#[^\\n]*${escapedCitation}[^\\n]*\\n)?[\\s\\S]*?\`\`\``,
          'g'
        );
        // Only remove if it's a short fabricated example
        const fakeExamples = content.match(fakeCodeBlockPattern);
        if (fakeExamples) {
          for (const example of fakeExamples) {
            // Check if this is a fabricated example (mentions files we don't have)
            if (example.includes(fabricated) || example.includes('model_config') || example.includes('training_pipeline')) {
              content = content.replace(example, '[Code example removed - file not found in codebase]');
            }
          }
        }
      }
    }
    
    // 4. Count [TBD] occurrences for confidence calculation
    const tbdCount = (content.match(/\[TBD\]/gi) || []).length;
    const wordCount = content.split(/\s+/).length;
    const tbdRatio = tbdCount / Math.max(wordCount / 50, 1); // TBDs per ~50 words
    
    // 5. Detect contradictory statements (qualitative + TBD)
    const contradictions = [
      /\b(high|excellent|strong|significant|robust)\s+\w*\s*\[TBD\]/gi,
      /\[TBD\]\s*%?\s*(increase|improvement|accuracy|performance)/gi,
      /achieves?\s+\w*\s*\[TBD\]/gi,
    ];
    const hasContradictions = contradictions.some(regex => regex.test(content));
    if (hasContradictions) {
      console.warn(`[OpenAI] Contradictory statements detected in "${block.title}"`);
    }
    
    // 6. Calculate confidence based on actual quality
    let confidence = 0.9;
    if (tbdCount > 5) confidence -= 0.2;
    else if (tbdCount > 2) confidence -= 0.1;
    if (hasContradictions) confidence -= 0.15;
    if (fabricatedCitations.length > 2) confidence -= 0.1;
    if (validCitations.length > 0) confidence += 0.05;
    confidence = Math.max(0.5, Math.min(0.98, confidence));
    
    // 7. Build final citations: valid extracted ones + files we actually analyzed
    // Always include at least the files we provided as context
    const allCitations = [
      ...validCitations,
      ...expectedCitations.slice(0, 5), // Include files we analyzed
    ];
    const finalCitations = [...new Set(allCitations)].slice(0, 5);

    // 8. For LLM_CHART blocks without tool-generated images, try to extract and execute Python code
    // (This is a fallback if tools weren't used)
    if (block.type === 'LLM_CHART' && !generatedImage) {
      const chartResult = await extractAndExecuteChartCode(content);
      if (chartResult) {
        if (chartResult.generatedImage) {
          generatedImage = chartResult.generatedImage;
        }
        if (chartResult.executedCode) {
          executedCode = chartResult.executedCode;
          console.log(`[OpenAI] Chart generated via fallback for "${block.title}"`);
        }
      }
    }

    return {
      id: block.id,
      type: block.type as 'LLM_TEXT' | 'LLM_TABLE' | 'LLM_CHART',
      title: block.title,
      content,
      confidence,
      citations: finalCitations,
      generatedImage,
      executedCode,
    };
  } catch (error) {
    console.error(`[OpenAI] Error generating block ${block.title}:`, error);
    return {
      id: block.id,
      type: block.type as 'LLM_TEXT' | 'LLM_TABLE' | 'LLM_CHART',
      title: block.title,
      content: `**Generation Error**: Failed to generate this section. ${error instanceof Error ? error.message : 'Unknown error'}`,
      confidence: 0,
      citations: [],
    };
  }
}

/**
 * Process template sections recursively, generating content for each block
 */
async function processSection(
  openai: OpenAI,
  context: GenerationContext,
  section: TemplateSection,
  path: string[],
  onProgress: (message: string) => void
): Promise<GeneratedSection> {
  const currentPath = [...path, section.title];
  onProgress(`Generating: ${section.title}...`);
  
  // Generate all blocks in this section
  const blocks: GeneratedBlock[] = [];
  for (const block of section.blocks) {
    const generatedBlock = await generateBlock(openai, context, {
      id: block.id,
      title: block.title,
      type: block.type,
      instructions: block.instructions,
      dataSources: block.dataSources || [],
      sectionPath: currentPath,
    });
    blocks.push(generatedBlock);
  }
  
  // Process subsections recursively
  let subsections: GeneratedSection[] | undefined;
  if (section.subsections && section.subsections.length > 0) {
    subsections = [];
    for (const subsection of section.subsections) {
      const generatedSubsection = await processSection(
        openai, context, subsection, currentPath, onProgress
      );
      subsections.push(generatedSubsection);
    }
  }
  
  return {
    id: section.id,
    title: section.title,
    blocks,
    subsections,
  };
}

/**
 * Detect gaps in the generated documentation
 * Focus on CONCRETE missing data, not fluffy suggestions
 */
async function detectGaps(
  openai: OpenAI,
  sections: GeneratedSection[],
  context: GenerationContext
): Promise<DocumentGap[]> {
  console.log('[DocGen] Running gap detection...');
  
  // First pass: Find explicit [TBD] markers and empty tables
  const concreteGaps: DocumentGap[] = [];
  
  const scanForGaps = (secs: GeneratedSection[], parentPath: string[] = []) => {
    for (const section of secs) {
      const path = [...parentPath, section.title];
      for (const block of section.blocks) {
        // Check for [NEEDS: xxx] markers - these are specific information requests (medium severity)
        const needsMatches = block.content.match(/\[NEEDS:\s*([^\]]+)\]/gi) || [];
        for (const needsMatch of needsMatches) {
          const infoNeeded = needsMatch.replace(/\[NEEDS:\s*/i, '').replace(/\]$/, '');
          concreteGaps.push({
            id: `gap-needs-${concreteGaps.length}`,
            sectionId: section.id,
            sectionTitle: section.title,
            severity: 'medium',
            description: `Needs additional information: ${infoNeeded}`,
            suggestion: `Please provide: ${infoNeeded}`,
          });
        }
        
        // Check for NOT APPLICABLE - this shouldn't happen with new prompts, but flag if it does
        const notApplicableMatch = block.content.match(/\[NOT APPLICABLE\]/i);
        if (notApplicableMatch) {
          concreteGaps.push({
            id: `gap-na-${concreteGaps.length}`,
            sectionId: section.id,
            sectionTitle: section.title,
            severity: 'medium',
            description: `Section needs adaptation for this codebase type`,
            suggestion: `Review what this codebase does and reframe section content`,
          });
        }
        
        // Check for signs of hallucinated content (fabricated file paths, generic ML content)
        const hallucinationPatterns = [
          /\[src\/(?:config|train|model|utils)\/\w+\.py\]/gi, // Common made-up Python paths
          /\[Code example removed/gi, // Our removal marker
          /num_layers.*:\s*\d+/gi, // Made up layer configs
          /hidden_size.*:\s*\d+/gi,
          /transformer.{0,20}layers/gi, // Transformer layer descriptions without evidence
          /k-fold cross-validation/gi, // Generic ML content
          /70%.{0,10}training.{0,10}15%.{0,10}validation/gi, // Made up splits
        ];
        
        let hasHallucinationSigns = false;
        for (const pattern of hallucinationPatterns) {
          if (pattern.test(block.content)) {
            hasHallucinationSigns = true;
            break;
          }
        }
        
        if (hasHallucinationSigns) {
          concreteGaps.push({
            id: `gap-hallucination-${concreteGaps.length}`,
            sectionId: section.id,
            sectionTitle: section.title,
            severity: 'high',
            description: `Section may contain fabricated content not from actual codebase`,
            suggestion: `Review this section - it may describe features that don't exist`,
          });
        }
        
        // Count [TBD] occurrences - only flag if many (some TBDs are normal)
        const tbdMatches = block.content.match(/\[TBD\]/gi) || [];
        if (tbdMatches.length >= 5) {
          // Many TBDs = high severity (likely a metrics table)
          concreteGaps.push({
            id: `gap-tbd-${concreteGaps.length}`,
            sectionId: section.id,
            sectionTitle: section.title,
            severity: 'high',
            description: `Contains ${tbdMatches.length} placeholder values that need actual measurements`,
            suggestion: `Provide actual values for metrics, or upload evaluation results`,
          });
        } else if (tbdMatches.length >= 2) {
          // Some TBDs = medium severity
          concreteGaps.push({
            id: `gap-tbd-${concreteGaps.length}`,
            sectionId: section.id,
            sectionTitle: section.title,
            severity: 'medium',
            description: `Contains ${tbdMatches.length} values that need actual data`,
            suggestion: `Provide the specific values when available`,
          });
        }
        // 1 TBD is fine - don't flag
        
        // Check for tables that are mostly empty
        const tableRowMatches = block.content.match(/\|[^|]+\|/g) || [];
        const tbdInTable = tableRowMatches.filter(row => row.includes('[TBD]') || row.includes('Not available')).length;
        if (tableRowMatches.length > 4 && tbdInTable > tableRowMatches.length * 0.7) {
          // More than 70% of table rows have TBD = high severity
          if (!concreteGaps.find(g => g.sectionId === section.id && g.severity === 'high')) {
            concreteGaps.push({
              id: `gap-table-${concreteGaps.length}`,
              sectionId: section.id,
              sectionTitle: section.title,
              severity: 'high',
              description: `Metrics table needs actual values from testing/evaluation`,
              suggestion: `Upload evaluation results or provide metrics data`,
            });
          }
        }
      }
      
      if (section.subsections) {
        scanForGaps(section.subsections, path);
      }
    }
  };
  
  scanForGaps(sections);
  
  // Second pass: Only flag truly problematic content (less aggressive)
  const scanForQualityIssues = (secs: GeneratedSection[], parentPath: string[] = []) => {
    for (const section of secs) {
      // Skip if already has a TBD gap
      if (concreteGaps.find(g => g.sectionId === section.id)) continue;
      
      for (const block of section.blocks) {
        const content = block.content;
        const wordCount = content.split(/\s+/).length;
        
        // Only flag truly contradictory statements (strict patterns)
        const strictContradictions = [
          /\b(excellent|outstanding)\s+(accuracy|performance)\s+of\s+\[TBD\]/gi,
          /\b(achieves|delivers)\s+\[TBD\]%\s+(accuracy|improvement)/gi,
        ];
        
        for (const pattern of strictContradictions) {
          if (pattern.test(content)) {
            if (!concreteGaps.find(g => g.sectionId === section.id)) {
              concreteGaps.push({
                id: `gap-contradict-${concreteGaps.length}`,
                sectionId: section.id,
                sectionTitle: section.title,
                severity: 'medium',
                description: `Contains a claim with missing data`,
                suggestion: `Provide the actual metric value`,
              });
            }
            break;
          }
        }
      }
      
      if (section.subsections) {
        scanForQualityIssues(section.subsections, [...parentPath, section.title]);
      }
    }
  };
  
  scanForQualityIssues(sections);
  
  // Third pass: Independent reviewer - check if sections fully answer their prompts
  // This is like having a documentation reviewer identify areas for improvement
  const independentReviewerPass = async () => {
    // Only run if we have few concrete gaps - otherwise we already know there are issues
    if (concreteGaps.length >= 12) return;
    
    // Flatten all sections including subsections for review
    const getAllSections = (secs: GeneratedSection[]): GeneratedSection[] => {
      return secs.flatMap(s => [s, ...(s.subsections ? getAllSections(s.subsections) : [])]);
    };
    
    const allSections = getAllSections(sections);
    console.log(`[DocGen] Reviewing ${allSections.length} sections for gaps...`);
    
    for (const section of allSections) {
      // Limit to 2 gaps per section
      const existingGapsForSection = concreteGaps.filter(g => g.sectionId === section.id).length;
      if (existingGapsForSection >= 2) continue;
      
      const blockContent = section.blocks.map(b => b.content).join('\n\n');
      
      try {
        const reviewResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are an independent documentation reviewer. Your job is to identify gaps where:
1. The section could be enhanced with more specific details
2. Claims are made without supporting evidence
3. Important aspects are mentioned but not fully explained
4. The section seems generic rather than specific to this codebase

Return JSON: { "hasGaps": boolean, "gaps": [{ "description": "...", "suggestion": "..." }] }

Be constructive but critical. Only flag substantive issues, not minor style concerns.`,
            },
            {
              role: 'user',
              content: `Review this documentation section:

## Section: ${section.title}

${blockContent.slice(0, 2000)}

---

Are there gaps where more detail would improve this documentation?`,
            },
          ],
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        });
        
        const review = JSON.parse(reviewResponse.choices[0]?.message?.content || '{}');
        
        if (review.hasGaps && review.gaps?.length > 0) {
          for (const gap of review.gaps.slice(0, 2)) {
            concreteGaps.push({
              id: `gap-review-${concreteGaps.length}`,
              sectionId: section.id,
              sectionTitle: section.title,
              severity: 'medium',
              description: gap.description || 'Could be enhanced with more detail',
              suggestion: gap.suggestion || 'Add more specific information',
            });
          }
        }
      } catch (error) {
        console.error('[DocGen] Reviewer pass failed for section:', section.title, error);
      }
    }
  };
  
  // Run the independent reviewer
  try {
    await independentReviewerPass();
  } catch (error) {
    console.error('[DocGen] Independent reviewer pass failed:', error);
  }
  
  // Return all gaps, prioritized by severity
  const allGaps = concreteGaps.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
  
  if (allGaps.length > 0) {
    console.log('[DocGen] Found', allGaps.length, 'gaps:', 
      allGaps.filter(g => g.severity === 'high').length, 'high,',
      allGaps.filter(g => g.severity === 'medium').length, 'medium,',
      allGaps.filter(g => g.severity === 'low').length, 'low');
    return allGaps.slice(0, 15); // Show more gaps
  }
  
  // Only use LLM if no obvious gaps found - and be strict about what counts
  const flattenSections = (secs: GeneratedSection[], parentPath: string[] = []): string => {
    return secs.map(s => {
      const path = [...parentPath, s.title].join(' > ');
      const blockContent = s.blocks.map(b => `[${b.title}]: ${b.content.slice(0, 300)}...`).join('\n');
      const subsectionContent = s.subsections ? flattenSections(s.subsections, [...parentPath, s.title]) : '';
      return `### ${path}\n${blockContent}\n${subsectionContent}`;
    }).join('\n\n');
  };
  
  const contentSummary = flattenSections(sections);
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a strict documentation auditor. Identify ONLY critical gaps.

Return JSON: { "gaps": [...] }

ONLY flag these as gaps:
- Missing required data (metrics, configurations, specifications)
- Empty or near-empty sections
- Broken references to non-existent files

DO NOT flag:
- Suggestions for "more examples" or "case studies"
- Requests for testimonials or use cases
- Style improvements
- Nice-to-have additions

If the documentation is complete and usable, return {"gaps":[]}.
Return at most 3 gaps.`,
        },
        {
          role: 'user',
          content: `Audit this documentation:\n\n${contentSummary.slice(0, 4000)}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });
    
    const content = response.choices[0]?.message?.content || '{"gaps":[]}';
    const parsed = JSON.parse(content);
    const gaps = parsed.gaps || [];
    
    return gaps.map((gap: any, idx: number) => {
      const section = sections.find(s => s.title === gap.sectionTitle);
      return {
        id: `gap-${idx}`,
        sectionId: section?.id || 'unknown',
        sectionTitle: gap.sectionTitle || 'General',
        severity: gap.severity || 'medium',
        description: gap.description || 'Missing information detected',
        suggestion: gap.suggestion || 'Review and add more details',
      };
    });
  } catch (error) {
    console.error('[DocGen] Gap detection failed:', error);
    return [];
  }
}

/**
 * Generate a comprehensive summary of what the codebase actually is
 * This prevents the LLM from making assumptions about the type of system
 */
async function generateCodebaseSummary(
  openai: OpenAI,
  codebase: CodeKnowledgeBase,
  codeIntelligence?: CodeIntelligenceResult
): Promise<string> {
  console.log('[DocGen] Generating codebase summary...');
  
  // Build a comprehensive view of the codebase
  const fileList = codebase.files.slice(0, 20).map(f => `- ${f.path} (${f.category})`).join('\n');
  
  const keyFiles = codebase.files.slice(0, 10).map(f => 
    `### ${f.path}\n\`\`\`${f.language}\n${f.content.slice(0, 1200)}\n\`\`\``
  ).join('\n\n');
  
  const chunkSummary = codeIntelligence 
    ? `\nSemantic chunks found: ${codeIntelligence.chunks.length}\nRelationships: ${codeIntelligence.relationships.length}\nKey components: ${codeIntelligence.chunks.slice(0, 10).map(c => `${c.type}:${c.name}`).join(', ')}`
    : '';
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a senior developer analyzing a codebase. Your job is to understand EXACTLY what this system is and does.

Be specific and accurate. Look at:
- The package.json/requirements.txt for dependencies
- The main source files for functionality
- The folder structure for architecture
- The README for stated purpose

Output a structured summary that will help documentation writers understand this codebase.`,
        },
        {
          role: 'user',
          content: `Analyze this codebase and tell me exactly what it is:

## Repository Info
- Name: ${codebase.repoName}
- Description: ${codebase.description || 'Not provided'}
- Primary Language: ${codebase.primaryLanguage}
- Topics: ${codebase.topics?.join(', ') || 'None'}

## File Structure
${fileList}
${chunkSummary}

## Key Source Files
${keyFiles}

## README
${codebase.readme?.slice(0, 2000) || 'No README'}

---

Provide a summary with:

1. **System Type**: What kind of system is this? Be VERY specific (e.g., "Next.js web application that calls OpenAI API", "Python ML training pipeline with PyTorch")

2. **Core Purpose**: What does it actually do? Base this on the actual code, not assumptions.

3. **Key Technologies**: List ONLY technologies visible in package.json/requirements.txt/imports

4. **Architecture**: Based on folder structure (e.g., "monorepo with apps/web and apps/api")

5. **CRITICAL - What this system DOES NOT have**:
   - Does it have neural network layer definitions? (nn.Module, tf.keras.layers, etc.)
   - Does it have training loops? (model.fit(), optimizer.step(), etc.)
   - Does it have custom model architectures?
   - Does it have ML evaluation code?
   
   If NO to these, state: "This system does NOT contain ML model code - no neural networks, no training loops, no custom architectures."

6. **How AI is used**: If it uses OpenAI/Anthropic/etc APIs, state: "AI is used via [Provider] API calls, not local model training."

Be brutally honest. If this is a web app that calls APIs, say so. Don't make it sound like an ML system if it's not.`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });
    
    const summary = response.choices[0]?.message?.content || '';
    console.log('[DocGen] Codebase summary generated:', summary.slice(0, 200) + '...');
    return summary;
  } catch (error) {
    console.error('[DocGen] Failed to generate codebase summary:', error);
    return `System Type: ${codebase.primaryLanguage} project. See files for details.`;
  }
}

/**
 * Main function to generate a complete document using the template structure
 */
export async function generateDocument(
  context: GenerationContext,
  onProgress?: (progress: number, message: string) => void,
  projectCache?: {
    lastCommitHash?: string;
    cachedKnowledgeBase?: any;
    cachedCodeIntelligence?: any;
    githubToken?: string | null;
    updateCache?: (updates: { lastCommitHash?: string; cachedKnowledgeBase?: any; cachedCodeIntelligence?: any }) => void;
  }
): Promise<GenerationResult> {
  console.log('[DocGen] Starting document generation for:', context.projectName);
  console.log('[DocGen] Using template:', context.template.name, 'with', context.template.sections.length, 'sections');
  
  try {
    const openai = getOpenAIClient();
    
    onProgress?.(5, 'Preparing generation context...');
    
    // Build comprehensive code knowledge base from GitHub (with caching)
    if (context.repoUrl) {
      onProgress?.(10, 'Checking repository cache...');
      try {
        // Use cached data if available
        // GitHub token will be auto-detected from env vars or GitHub CLI
        const { knowledgeBase, wasCached: kbCached, commitHash } = await getCachedKnowledgeBase(
          context.repoUrl,
          projectCache?.lastCommitHash,
          projectCache?.cachedKnowledgeBase,
          (msg) => onProgress?.(15, msg),
          false, // Don't force refresh
          projectCache?.githubToken || null
        );
        
        // Attach to context
        context.codebase = knowledgeBase;
        context.repoReadme = knowledgeBase.readme;
        context.repoStructure = knowledgeBase.structure;
        
        console.log(`[DocGen] Code knowledge base: ${knowledgeBase.files.length} files (cached: ${kbCached})`);
        onProgress?.(25, kbCached ? `Using cached data (${knowledgeBase.files.length} files)` : `Analyzed ${knowledgeBase.files.length} source files from repository`);
        
        // Build code intelligence (embeddings + knowledge graph) with caching
        if (knowledgeBase.files.length > 0) {
          onProgress?.(30, 'Building semantic search index...');
          try {
            const { codeIntelligence, wasCached: ciCached } = await getCachedCodeIntelligence(
              knowledgeBase,
              projectCache?.cachedCodeIntelligence,
              openai,
              kbCached,
              (msg) => onProgress?.(35, msg)
            );
            
            context.codeIntelligence = codeIntelligence;
            console.log(`[DocGen] Code intelligence: ${codeIntelligence.chunks.length} chunks, ${codeIntelligence.relationships.length} relationships (cached: ${ciCached})`);
            onProgress?.(40, ciCached 
              ? `Using cached knowledge graph (${codeIntelligence.chunks.length} chunks)`
              : `Built knowledge graph: ${codeIntelligence.chunks.length} chunks, ${codeIntelligence.relationships.length} relationships`
            );
            
            // Update cache if we built fresh data
            if (!kbCached || !ciCached) {
              projectCache?.updateCache?.({
                lastCommitHash: commitHash || undefined,
                cachedKnowledgeBase: knowledgeBase,
                cachedCodeIntelligence: serializeCodeIntelligence(codeIntelligence),
              });
              console.log('[DocGen] Updated project cache');
            }
          } catch (error) {
            console.error('[DocGen] Failed to build code intelligence:', error);
            // Continue without it - will fall back to basic approach
          }
        }
        
        // Generate codebase summary to understand what this system actually is
        onProgress?.(42, 'Analyzing codebase to understand system type...');
        try {
          const summary = await generateCodebaseSummary(openai, knowledgeBase, context.codeIntelligence);
          context.codebaseSummary = summary;
          console.log('[DocGen] Codebase summary stored in context');
          onProgress?.(45, 'System analysis complete');
        } catch (error) {
          console.error('[DocGen] Failed to generate codebase summary:', error);
        }
        
        // Initialize ReAct agent memory for persistent understanding
        if (context.codeIntelligence) {
          onProgress?.(46, 'Initializing documentation agent...');
          try {
            const agentMem = await initializeAgentMemory(
              openai,
              context.codeIntelligence,
              knowledgeBase.files.map((f: any) => f.path),
              knowledgeBase.readme
            );
            context.agentMemory = agentMem;
            console.log('[DocGen] ReAct agent memory initialized');
            onProgress?.(48, 'Documentation agent ready');
          } catch (error) {
            console.error('[DocGen] Failed to initialize agent memory:', error);
          }
        }
      } catch (error) {
        console.error('[DocGen] Failed to build code knowledge base:', error);
        onProgress?.(20, 'Repository analysis partially completed');
      }
    }
    
    // Count total blocks for progress
    const allBlocks = flattenTemplateBlocks(context.template);
    const totalBlocks = allBlocks.length;
    let completedBlocks = 0;
    
    onProgress?.(15, `Generating ${totalBlocks} content blocks...`);
    
    // Process each section using the template structure
    const sections: GeneratedSection[] = [];
    for (const templateSection of context.template.sections) {
      const section = await processSection(
        openai,
        context,
        templateSection,
        [],
        (message) => {
          completedBlocks++;
          const progress = 15 + (completedBlocks / totalBlocks) * 70;
          onProgress?.(progress, message);
        }
      );
      sections.push(section);
    }
    
    // Run gap detection
    onProgress?.(88, 'Analyzing for gaps and missing information...');
    const gaps = await detectGaps(openai, sections, context);
    console.log('[DocGen] Found', gaps.length, 'documentation gaps');
    
    onProgress?.(98, 'Finalizing document...');
    
    console.log('[DocGen] Document generation complete:', sections.length, 'sections');
    
    return {
      documentTitle: `${context.projectName} - ${context.template.name}`,
      sections,
      gaps,
    };
  } catch (error) {
    console.error('[DocGen] Fatal error during generation:', error);
    throw error;
  }
}

/**
 * Check if OpenAI is configured
 */
export function isOpenAIConfigured(): boolean {
  const key = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  return !!key && key !== 'sk-...' && !key.includes('...') && key.length > 10;
}

/**
 * Get helpful error message for missing API key
 */
export function getOpenAIErrorMessage(): string {
  const key = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  
  if (!key) {
    return `OpenAI API key not found. Please:
1. Create a file named .env.local in the project root
2. Add: NEXT_PUBLIC_OPENAI_API_KEY="sk-your-key-here"
3. Restart the Next.js dev server`;
  }
  
  if (key === 'sk-...' || key.includes('...')) {
    return `OpenAI API key appears to be a placeholder. Please update .env.local with your actual API key.`;
  }
  
  return 'OpenAI API key is configured but may be invalid.';
}
