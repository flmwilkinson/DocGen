/**
 * Evidence-First Documentation Agent
 * 
 * Architecture: Two-Pass Generation (Evidence → Narrative)
 * 
 * PASS 1 (Evidence Collection):
 *   - Retrieve Tier-1 sources (code, config, SQL, tests, datasets) first
 *   - Run data schema audits if datasets exist
 *   - Cache code-driven summaries for each KG node
 *   - Build evidence bundle with citations + line ranges
 * 
 * PASS 2 (Narrative Generation):
 *   - Generate documentation using ONLY evidence from Pass 1
 *   - Require claim→evidence mapping per section
 *   - Flag gaps for any claim without Tier-1 evidence
 * 
 * Tiered Source Hierarchy:
 *   Tier 1 (MUST PREFER): core code, configs, SQL/migrations, notebooks, tests, dataset schemas
 *   Tier 2 (LOW TRUST): README.md, docs/, markdown files
 * 
 * Quality Metrics:
 *   - % citations from Tier-1
 *   - % sections with Tier-1 evidence
 *   - # executed validations (data schema audit, tests)
 *   - uncovered sections count
 */

import { CodeChunk, CodeIntelligenceResult, CodeRelationship } from './code-intelligence';
import { executeCode, isSandboxAvailable } from './sandbox-client';
import OpenAI from 'openai';

// =============================================================================
// TYPES
// =============================================================================

export type SourceTier = 1 | 2;

export interface TieredSource {
  filePath: string;
  tier: SourceTier;
  category: SourceCategory;
  content: string;
  lineRange?: { start: number; end: number };
  chunkId?: string;
  commitSha?: string;
}

export type SourceCategory = 
  | 'code'          // Core source files (.py, .ts, .js, .java, etc.)
  | 'config'        // Configuration files (yaml, json, toml, env)
  | 'sql'           // SQL/migrations
  | 'notebook'      // Jupyter notebooks
  | 'test'          // Test files
  | 'dataset'       // Data files (csv, parquet, json data)
  | 'pipeline'      // Pipeline/workflow definitions (Airflow, dbt, etc.)
  | 'readme'        // README files
  | 'docs'          // Other documentation
  | 'other';

export interface EvidenceItem {
  id: string;
  source: TieredSource;
  claim: string;
  excerpt: string;
  confidence: number;
}

export interface DataSchemaEvidence {
  filePath: string;
  columns: Array<{
    name: string;
    dtype: string;
    nullPercent: number;
    sampleValues: string[];
    min?: string;
    max?: string;
  }>;
  rowCount: number;
  sampleRows: string[][];
  executionLog: string;
}

export interface EvidenceBundle {
  sectionId: string;
  sectionTitle: string;
  tier1Sources: TieredSource[];
  tier2Sources: TieredSource[];
  dataEvidence: DataSchemaEvidence[];
  nodeSummaries: Map<string, string>;  // filePath → code-driven summary
  executedValidations: string[];
}

export interface QualityMetrics {
  tier1CitationPercent: number;        // % of citations from Tier-1
  tier1SectionCoverage: number;        // % of sections with at least 1 Tier-1 citation
  executedValidationsCount: number;    // # of data schema audits run
  uncoveredSectionsCount: number;      // Sections with NO evidence
  readmeOnlyCount: number;             // Sections citing ONLY README/docs
  totalCitations: number;
  tier1Citations: number;
  tier2Citations: number;
}

export interface EvidenceFirstConfig {
  requireTier1Evidence: boolean;       // Fail generation if no Tier-1
  tier1MinPercent: number;             // Min % of Tier-1 citations (e.g., 60)
  runDataSchemaAudit: boolean;         // Auto-run schema audit for datasets
  maxRetries: number;                  // Max retrieval gate retries
  dataFileSizeLimit: number;           // Max file size for data audit (bytes)
}

export const DEFAULT_CONFIG: EvidenceFirstConfig = {
  requireTier1Evidence: true,
  tier1MinPercent: 50,
  runDataSchemaAudit: true, // Accuracy-first: compute schema evidence via code execution
  maxRetries: 2,
  dataFileSizeLimit: Infinity, // No limit - use code execution for all data files
};

// =============================================================================
// TIERED SOURCE CLASSIFICATION
// =============================================================================

const TIER_1_PATTERNS: Array<{ pattern: RegExp; category: SourceCategory }> = [
  // Core code files
  { pattern: /\.(py|ts|tsx|js|jsx|java|scala|go|rs|rb|cpp|c|h|cs|kt|swift)$/i, category: 'code' },
  // Config files
  { pattern: /\.(ya?ml|json|toml|ini|env|cfg|conf)$/i, category: 'config' },
  { pattern: /(config|settings|parameters)\.(py|ts|js|json|ya?ml)$/i, category: 'config' },
  // SQL/migrations
  { pattern: /\.(sql|ddl|dml)$/i, category: 'sql' },
  { pattern: /migrations?\//i, category: 'sql' },
  // Notebooks
  { pattern: /\.ipynb$/i, category: 'notebook' },
  // Test files
  { pattern: /(test_|_test\.|\.test\.|\.spec\.|tests\/|__tests__\/)/i, category: 'test' },
  // Pipelines
  { pattern: /(airflow|dbt|dagster|prefect|luigi|workflow|pipeline)/i, category: 'pipeline' },
  // Dataset files (schema evidence)
  { pattern: /\.(csv|parquet|feather|arrow|xlsx?|json)$/i, category: 'dataset' },
  { pattern: /data(sets?)?\//i, category: 'dataset' },
];

const TIER_2_PATTERNS: Array<{ pattern: RegExp; category: SourceCategory }> = [
  { pattern: /readme\.md$/i, category: 'readme' },
  { pattern: /\.md$/i, category: 'docs' },
  { pattern: /docs?\//i, category: 'docs' },
  { pattern: /documentation\//i, category: 'docs' },
];

/**
 * Classify a file path into its source tier and category
 */
export function classifySource(filePath: string): { tier: SourceTier; category: SourceCategory } {
  // Check Tier 1 patterns first (code, config, sql, etc.)
  for (const { pattern, category } of TIER_1_PATTERNS) {
    if (pattern.test(filePath)) {
      return { tier: 1, category };
    }
  }
  
  // Check Tier 2 patterns (docs, readme)
  for (const { pattern, category } of TIER_2_PATTERNS) {
    if (pattern.test(filePath)) {
      return { tier: 2, category };
    }
  }
  
  // Default to Tier 1 for unknown files (assume code)
  return { tier: 1, category: 'other' };
}

/**
 * Score a source for relevance + tier weighting
 * Higher score = more preferred
 */
export function scoreSource(source: TieredSource, query: string): number {
  let score = 0;
  
  // Base tier score (Tier 1 = 100, Tier 2 = 20)
  score += source.tier === 1 ? 100 : 20;
  
  // Category bonuses
  const categoryScores: Record<SourceCategory, number> = {
    code: 50,
    config: 40,
    sql: 45,
    notebook: 35,
    test: 30,
    dataset: 40,
    pipeline: 35,
    readme: 5,
    docs: 10,
    other: 15,
  };
  score += categoryScores[source.category] || 0;
  
  // Query relevance (simple keyword matching)
  const queryLower = query.toLowerCase();
  const pathLower = source.filePath.toLowerCase();
  const contentLower = (source.content || '').toLowerCase().slice(0, 2000);
  
  // Path match bonus
  for (const word of queryLower.split(/\s+/)) {
    if (word.length < 3) continue;
    if (pathLower.includes(word)) score += 20;
    if (contentLower.includes(word)) score += 10;
  }
  
  return score;
}

// =============================================================================
// DATA SCHEMA EXECUTION
// =============================================================================

/**
 * Generate Python code to audit a CSV/data file schema
 */
function generateSchemaAuditCode(filePath: string, fileContent: string): string {
  // For CSV files, generate pandas schema analysis
  const escapedContent = fileContent
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');
  
  return `
import pandas as pd
import json
import io
from datetime import datetime

# Load data from string
data_str = '''${escapedContent.slice(0, 50000)}'''

try:
    df = pd.read_csv(io.StringIO(data_str))
    
    schema = {
        "rowCount": len(df),
        "columns": []
    }
    
    for col in df.columns:
        col_info = {
            "name": col,
            "dtype": str(df[col].dtype),
            "nullPercent": round(df[col].isnull().sum() / len(df) * 100, 2),
            "sampleValues": [str(v) for v in df[col].dropna().head(3).tolist()]
        }
        
        # Add min/max for numeric columns
        if pd.api.types.is_numeric_dtype(df[col]):
            col_info["min"] = str(df[col].min())
            col_info["max"] = str(df[col].max())
        
        schema["columns"].append(col_info)
    
    # Sample rows (first 3)
    schema["sampleRows"] = df.head(3).astype(str).values.tolist()
    
    _result = schema
    print(json.dumps(schema, indent=2))
except Exception as e:
    _result = {"error": str(e)}
    print(f"Error: {e}")
`;
}

/**
 * Run data schema audit on dataset files using code execution
 * This reads files via code execution (no size limits)
 * Returns computed schema evidence
 */
export async function runDataSchemaAudit(
  dataFiles: Array<{ path: string; repoUrl?: string }>, // Only need path, not content
  config: EvidenceFirstConfig = DEFAULT_CONFIG,
  cache?: {
    schemaAudits?: Record<string, DataSchemaEvidence>;
    commitHash?: string | null;
    updateCache?: (updates: { schemaAudits?: Record<string, DataSchemaEvidence> }) => void;
  }
): Promise<DataSchemaEvidence[]> {
  const results: DataSchemaEvidence[] = [];
  
  // Check if sandbox is available
  const sandboxAvailable = await isSandboxAvailable();
  if (!sandboxAvailable) {
    console.log('[Evidence] Sandbox not available, skipping data schema audit');
    return results;
  }
  
  // Try to load from IndexedDB first (if commit hash provided)
  let cachedAudits: Record<string, DataSchemaEvidence> = {};
  if (cache?.commitHash && cache?.schemaAudits) {
    // Use provided cache (from IndexedDB or project cache)
    cachedAudits = cache.schemaAudits;
    console.log(`[Evidence] Using ${Object.keys(cachedAudits).length} cached schema audits`);
  } else if (cache?.schemaAudits) {
    // Fallback to project cache
    cachedAudits = cache.schemaAudits;
  }
  
  const newAudits: Record<string, DataSchemaEvidence> = {};
  
  // Process ALL data files (no limits)
  for (const file of dataFiles) {
    const ext = file.path.split('.').pop()?.toLowerCase() || '';
    
    // Support CSV, Parquet, Excel files
    if (!['csv', 'tsv', 'parquet', 'xlsx', 'xls'].includes(ext)) {
      continue;
    }
    
    // Check cache first
    if (cachedAudits[file.path]) {
      console.log(`[Evidence] Using cached schema audit for ${file.path}`);
      results.push(cachedAudits[file.path]);
      continue;
    }
    
    console.log(`[Evidence] Running schema audit on ${file.path} (via code execution)`);
    
    try {
      // Generate code that reads the file from the repo
      const code = generateSchemaAuditCodeFromPath(file.path, ext, file.repoUrl);
      const result = await executeCode(code, 60); // Longer timeout for large files
      
      if (result.exitCode === 0 && result.structuredResult) {
        const schema = result.structuredResult as {
          rowCount?: number;
          columns?: Array<{
            name: string;
            dtype: string;
            nullPercent: number;
            sampleValues: string[];
            min?: string;
            max?: string;
          }>;
          sampleRows?: string[][];
          error?: string;
        };
        
        // Check if the result is an error response
        if (schema.error) {
          console.log(`[Evidence] Schema audit failed for ${file.path}: ${schema.error}`);
          continue;
        }
        
        // Validate schema structure before using
        if (!schema.columns || !Array.isArray(schema.columns)) {
          console.log(`[Evidence] Schema audit returned invalid structure for ${file.path}`);
          continue;
        }
        
        const auditResult: DataSchemaEvidence = {
          filePath: file.path,
          columns: schema.columns,
          rowCount: schema.rowCount || 0,
          sampleRows: schema.sampleRows || [],
          executionLog: result.stdout,
        };
        
        results.push(auditResult);
        newAudits[file.path] = auditResult; // Store for cache
        
        console.log(`[Evidence] Schema audit complete: ${schema.columns.length} columns, ${schema.rowCount || 0} rows`);
      } else {
        console.log(`[Evidence] Schema audit failed for ${file.path}: ${result.stderr || 'No output'}`);
      }
    } catch (error) {
      console.error(`[Evidence] Schema audit error for ${file.path}:`, error);
    }
  }
  
  // Update cache with new audit results
  if (Object.keys(newAudits).length > 0 && cache?.updateCache) {
    const updatedCache = { ...cachedAudits, ...newAudits };
    cache.updateCache({ schemaAudits: updatedCache });
    console.log(`[Evidence] Cached ${Object.keys(newAudits).length} new schema audit(s)`);
  }
  
  return results;
}

/**
 * Generate Python code to read and analyze a data file from path
 * Uses GitHub API or file system depending on availability
 */
function generateSchemaAuditCodeFromPath(filePath: string, ext: string, repoUrl?: string): string {
  if (ext === 'csv' || ext === 'tsv') {
    return `
import pandas as pd
import json
import os
import requests

file_path = "${filePath}"
${repoUrl ? `repo_url = "${repoUrl}"` : ''}

try:
    # Try to read from file system first (if available)
    if os.path.exists(file_path):
        df = pd.read_csv(file_path, sep='${ext === 'tsv' ? '\\t' : ','}')
    ${repoUrl ? `elif repo_url:
        # Try to fetch from GitHub API
        import base64
        # Extract owner/repo from URL
        parts = repo_url.replace('https://github.com/', '').split('/')
        if len(parts) >= 2:
            owner, repo = parts[0], parts[1].replace('.git', '')
            api_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{file_path}"
            response = requests.get(api_url, headers={"Accept": "application/vnd.github.v3.raw"})
            if response.status_code == 200:
                import io
                df = pd.read_csv(io.StringIO(response.text))
            else:
                raise Exception(f"GitHub API error: {response.status_code}")
        else:
            raise Exception("Invalid repo URL")
    ` : ''}
    else:
        raise Exception(f"File not found: {file_path}")
    
    # Analyze schema
    schema = {
        "rowCount": len(df),
        "columns": []
    }
    
    for col in df.columns:
        col_info = {
            "name": str(col),
            "dtype": str(df[col].dtype),
            "nullPercent": round(df[col].isnull().sum() / len(df) * 100, 2) if len(df) > 0 else 0,
            "sampleValues": [str(v) for v in df[col].dropna().head(3).tolist()]
        }
        
        # Add min/max for numeric columns
        if pd.api.types.is_numeric_dtype(df[col]) and len(df[col].dropna()) > 0:
            col_info["min"] = str(df[col].min())
            col_info["max"] = str(df[col].max())
        
        schema["columns"].append(col_info)
    
    # Sample rows (first 3)
    schema["sampleRows"] = df.head(3).astype(str).values.tolist()
    
    _result = schema
    print(json.dumps(schema, indent=2))
except Exception as e:
    _result = {"error": str(e)}
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
`;
  } else if (ext === 'parquet') {
    return `
import pandas as pd
import json
import os
import requests

file_path = "${filePath}"
${repoUrl ? `repo_url = "${repoUrl}"` : ''}

try:
    if os.path.exists(file_path):
        df = pd.read_parquet(file_path)
    ${repoUrl ? `elif repo_url:
        # For Parquet, we'd need to download the binary file
        # This is a simplified version - may need adjustment
        raise Exception("Parquet files from GitHub require binary download - use local file")
    ` : ''}
    else:
        raise Exception(f"File not found: {file_path}")
    
    schema = {
        "rowCount": len(df),
        "columns": []
    }
    
    for col in df.columns:
        col_info = {
            "name": str(col),
            "dtype": str(df[col].dtype),
            "nullPercent": round(df[col].isnull().sum() / len(df) * 100, 2) if len(df) > 0 else 0,
            "sampleValues": [str(v) for v in df[col].dropna().head(3).tolist()]
        }
        
        if pd.api.types.is_numeric_dtype(df[col]) and len(df[col].dropna()) > 0:
            col_info["min"] = str(df[col].min())
            col_info["max"] = str(df[col].max())
        
        schema["columns"].append(col_info)
    
    schema["sampleRows"] = df.head(3).astype(str).values.tolist()
    
    _result = schema
    print(json.dumps(schema, indent=2))
except Exception as e:
    _result = {"error": str(e)}
    print(f"Error: {e}")
`;
  } else {
    // Excel files
    return `
import pandas as pd
import json
import os

file_path = "${filePath}"

try:
    if os.path.exists(file_path):
        df = pd.read_excel(file_path, engine='openpyxl')
    else:
        raise Exception(f"File not found: {file_path}")
    
    schema = {
        "rowCount": len(df),
        "columns": []
    }
    
    for col in df.columns:
        col_info = {
            "name": str(col),
            "dtype": str(df[col].dtype),
            "nullPercent": round(df[col].isnull().sum() / len(df) * 100, 2) if len(df) > 0 else 0,
            "sampleValues": [str(v) for v in df[col].dropna().head(3).tolist()]
        }
        
        if pd.api.types.is_numeric_dtype(df[col]) and len(df[col].dropna()) > 0:
            col_info["min"] = str(df[col].min())
            col_info["max"] = str(df[col].max())
        
        schema["columns"].append(col_info)
    
    schema["sampleRows"] = df.head(3).astype(str).values.tolist()
    
    _result = schema
    print(json.dumps(schema, indent=2))
except Exception as e:
    _result = {"error": str(e)}
    print(f"Error: {e}")
`;
  }
}

// =============================================================================
// CODE-DRIVEN NODE SUMMARIES
// =============================================================================

/**
 * Generate a code-driven summary for a KG node (file/module)
 * This summary is derived from the SOURCE CODE, not README
 */
export async function generateNodeSummary(
  openai: OpenAI,
  chunk: CodeChunk,
  relationships: CodeRelationship[]
): Promise<string> {
  // Find relationships for this chunk
  const imports = relationships
    .filter(r => r.from === chunk.id && r.type === 'imports')
    .map(r => r.to);
  const exports = relationships
    .filter(r => r.from === chunk.id && r.type === 'exports')
    .map(r => r.to);
  const callers = relationships
    .filter(r => r.to === chunk.id && r.type === 'calls')
    .map(r => r.from);
  const callees = relationships
    .filter(r => r.from === chunk.id && r.type === 'calls')
    .map(r => r.to);
  
  const prompt = `Analyze this code and generate a factual summary (max 100 words).
Focus on: purpose, inputs/outputs, key logic, dependencies.
NO speculation - only what you can see in the code.

File: ${chunk.filePath}
Type: ${chunk.type}
Name: ${chunk.name}
${chunk.signature ? `Signature: ${chunk.signature}` : ''}

Code:
\`\`\`${chunk.language}
${chunk.content.slice(0, 1500)}
\`\`\`

Dependencies: ${imports.slice(0, 5).join(', ') || 'none'}
Exports: ${exports.slice(0, 5).join(', ') || 'none'}
Called by: ${callers.slice(0, 3).join(', ') || 'none'}
Calls: ${callees.slice(0, 3).join(', ') || 'none'}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a code analyst. Generate concise, factual summaries from source code. No speculation.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 200,
    });
    
    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('[Evidence] Failed to generate node summary:', error);
    return '';
  }
}

// =============================================================================
// EVIDENCE RETRIEVAL WITH TIER GATING
// =============================================================================

/**
 * Retrieve evidence for a section with tier gating
 * If only Tier-2 sources found, retry with Tier-1 specific queries
 */
export async function retrieveEvidence(
  sectionTitle: string,
  sectionInstructions: string,
  codeIntelligence: CodeIntelligenceResult,
  allFiles: Array<{ path: string; content: string }>,
  openai: OpenAI,
  config: EvidenceFirstConfig = DEFAULT_CONFIG,
  repoUrl?: string, // Optional repo URL for data file access
  nodeSummaryCache?: Record<string, string>,
  schemaAuditCache?: {
    schemaAudits?: Record<string, DataSchemaEvidence>;
    commitHash?: string | null;
    updateCache?: (updates: { schemaAudits?: Record<string, DataSchemaEvidence> }) => void;
  },
  globalDataEvidence?: DataSchemaEvidence[] // Pre-computed schema audits (run once at document level)
): Promise<EvidenceBundle> {
  console.log(`[Evidence] Retrieving evidence for: ${sectionTitle}`);
  
  const tier1Sources: TieredSource[] = [];
  const tier2Sources: TieredSource[] = [];
  const nodeSummaries = new Map<string, string>();
  
  // Initial search
  const searchResults = await codeIntelligence.search(
    `${sectionTitle}\n${sectionInstructions}`,
    20
  );
  
  // Classify and score all results
  for (const result of searchResults) {
    const { tier, category } = classifySource(result.chunk.filePath);
    const source: TieredSource = {
      filePath: result.chunk.filePath,
      tier,
      category,
      content: result.chunk.content,
      lineRange: { start: result.chunk.startLine, end: result.chunk.endLine },
      chunkId: result.chunk.id,
    };
    
    if (tier === 1) {
      tier1Sources.push(source);
    } else {
      tier2Sources.push(source);
    }
  }
  
  // RETRIEVAL GATE: If only Tier-2 sources, retry with Tier-1 specific queries
  if (tier1Sources.length === 0 && config.requireTier1Evidence) {
    console.log('[Evidence] No Tier-1 sources found, retrying with specific queries...');
    
    // Generate Tier-1 specific search queries
    const tier1Queries = generateTier1Queries(sectionTitle, sectionInstructions);
    
    for (const query of tier1Queries) {
      const moreResults = await codeIntelligence.search(query, 10);
      
      for (const result of moreResults) {
        const { tier, category } = classifySource(result.chunk.filePath);
        if (tier === 1 && !tier1Sources.find(s => s.filePath === result.chunk.filePath)) {
          tier1Sources.push({
            filePath: result.chunk.filePath,
            tier,
            category,
            content: result.chunk.content,
            lineRange: { start: result.chunk.startLine, end: result.chunk.endLine },
            chunkId: result.chunk.id,
          });
        }
      }
    }
  }
  
  // Generate node summaries for Tier-1 sources (reuse cache if available)
  for (const source of tier1Sources.slice(0, 5)) {
    if (!nodeSummaries.has(source.filePath)) {
      const cached = nodeSummaryCache?.[source.filePath];
      if (cached) {
        nodeSummaries.set(source.filePath, cached);
        continue;
      }
      const chunk = codeIntelligence.chunks.find(c => c.id === source.chunkId);
      if (chunk) {
        const summary = await generateNodeSummary(openai, chunk, codeIntelligence.relationships);
        if (summary) {
          nodeSummaries.set(source.filePath, summary);
        }
      }
    }
  }
  
  // Use global data evidence if provided (schema audits run once at document level)
  // Otherwise, run schema audit only if not already done globally
  const dataFiles = allFiles.filter(f => classifySource(f.path).category === 'dataset');
  const dataEvidence = globalDataEvidence && globalDataEvidence.length > 0
    ? globalDataEvidence // Use pre-computed audits from document level
    : (config.runDataSchemaAudit && dataFiles.length > 0 && !globalDataEvidence
      ? await runDataSchemaAudit(
          dataFiles.map(f => ({ path: f.path, repoUrl })), // Pass paths only, not content
          config,
          schemaAuditCache // Pass cache for schema audits
        )
      : []);
  
  const executedValidations = dataEvidence.map(d => `schema_audit:${d.filePath}`);
  
  console.log(`[Evidence] Found ${tier1Sources.length} Tier-1, ${tier2Sources.length} Tier-2, ${dataEvidence.length} data audits`);
  
  return {
    sectionId: sectionTitle.toLowerCase().replace(/\s+/g, '-'),
    sectionTitle,
    tier1Sources,
    tier2Sources,
    dataEvidence,
    nodeSummaries,
    executedValidations,
  };
}

/**
 * Generate Tier-1 specific search queries
 */
function generateTier1Queries(sectionTitle: string, instructions: string): string[] {
  const queries: string[] = [];
  
  // Extract key terms
  const terms = `${sectionTitle} ${instructions}`.toLowerCase();
  
  // Add code-specific queries
  if (terms.includes('model') || terms.includes('architecture')) {
    queries.push('class model', 'def forward', 'model architecture', 'neural network');
  }
  if (terms.includes('training') || terms.includes('train')) {
    queries.push('def train', 'training loop', 'optimizer', 'loss function');
  }
  if (terms.includes('data') || terms.includes('input') || terms.includes('feature')) {
    queries.push('data loader', 'dataset class', 'feature engineering', 'preprocessing');
  }
  if (terms.includes('config') || terms.includes('parameter')) {
    queries.push('config', 'settings', 'parameters', 'hyperparameters');
  }
  if (terms.includes('test') || terms.includes('evaluation') || terms.includes('metric')) {
    queries.push('test_', 'def test', 'evaluate', 'metrics', 'accuracy');
  }
  if (terms.includes('pd') || terms.includes('probability') || terms.includes('default')) {
    queries.push('probability default', 'PD calculation', 'survival analysis');
  }
  if (terms.includes('lgd') || terms.includes('loss given default')) {
    queries.push('loss given default', 'LGD', 'recovery rate');
  }
  if (terms.includes('ecl') || terms.includes('expected credit loss')) {
    queries.push('expected credit loss', 'ECL calculation', 'impairment');
  }
  
  return queries.slice(0, 5);
}

// =============================================================================
// QUALITY METRICS CALCULATION
// =============================================================================

/**
 * Calculate quality metrics for a generated document
 */
export function calculateQualityMetrics(
  evidenceBundles: EvidenceBundle[],
  generatedCitations: Map<string, string[]>  // sectionId → citations
): QualityMetrics {
  let totalCitations = 0;
  let tier1Citations = 0;
  let tier2Citations = 0;
  let sectionsWithTier1 = 0;
  let sectionsWithoutEvidence = 0;
  let readmeOnlySections = 0;
  let executedValidationsCount = 0;
  
  for (const bundle of evidenceBundles) {
    const sectionCitations = generatedCitations.get(bundle.sectionId) || [];
    
    let hasTier1 = false;
    let hasTier2 = false;
    let allReadme = true;
    
    for (const citation of sectionCitations) {
      totalCitations++;
      const { tier, category } = classifySource(citation);
      
      if (tier === 1) {
        tier1Citations++;
        hasTier1 = true;
        allReadme = false;
      } else {
        tier2Citations++;
        hasTier2 = true;
        if (category !== 'readme') {
          allReadme = false;
        }
      }
    }
    
    // Also count Tier-1 sources from bundle
    if (bundle.tier1Sources.length > 0) {
      hasTier1 = true;
    }
    
    if (hasTier1) {
      sectionsWithTier1++;
    }
    
    if (sectionCitations.length === 0 && bundle.tier1Sources.length === 0 && bundle.tier2Sources.length === 0) {
      sectionsWithoutEvidence++;
    }
    
    if (hasTier2 && !hasTier1 && allReadme) {
      readmeOnlySections++;
    }
    
    executedValidationsCount += bundle.executedValidations.length;
  }
  
  const tier1Percent = totalCitations > 0 ? (tier1Citations / totalCitations) * 100 : 0;
  const tier1Coverage = evidenceBundles.length > 0 ? (sectionsWithTier1 / evidenceBundles.length) * 100 : 0;
  
  return {
    tier1CitationPercent: Math.round(tier1Percent),
    tier1SectionCoverage: Math.round(tier1Coverage),
    executedValidationsCount,
    uncoveredSectionsCount: sectionsWithoutEvidence,
    readmeOnlyCount: readmeOnlySections,
    totalCitations,
    tier1Citations,
    tier2Citations,
  };
}

/**
 * Check if quality metrics meet thresholds
 * Returns list of threshold violations
 */
export function checkQualityThresholds(
  metrics: QualityMetrics,
  config: EvidenceFirstConfig = DEFAULT_CONFIG
): Array<{ metric: string; value: number; threshold: number; severity: 'warning' | 'error' }> {
  const violations: Array<{ metric: string; value: number; threshold: number; severity: 'warning' | 'error' }> = [];
  
  // Tier-1 percentage threshold
  if (metrics.tier1CitationPercent < config.tier1MinPercent) {
    violations.push({
      metric: 'tier1CitationPercent',
      value: metrics.tier1CitationPercent,
      threshold: config.tier1MinPercent,
      severity: metrics.tier1CitationPercent < config.tier1MinPercent / 2 ? 'error' : 'warning',
    });
  }
  
  // No Tier-1 evidence at all is an error
  if (metrics.tier1Citations === 0 && config.requireTier1Evidence) {
    violations.push({
      metric: 'tier1Citations',
      value: 0,
      threshold: 1,
      severity: 'error',
    });
  }
  
  // Uncovered sections
  if (metrics.uncoveredSectionsCount > 0) {
    violations.push({
      metric: 'uncoveredSectionsCount',
      value: metrics.uncoveredSectionsCount,
      threshold: 0,
      severity: 'warning',
    });
  }
  
  // README-only sections
  if (metrics.readmeOnlyCount > 2) {
    violations.push({
      metric: 'readmeOnlyCount',
      value: metrics.readmeOnlyCount,
      threshold: 2,
      severity: 'warning',
    });
  }
  
  return violations;
}

// =============================================================================
// EVIDENCE BUNDLE FORMATTING
// =============================================================================

/**
 * Format evidence bundle for LLM context
 */
export function formatEvidenceForLLM(bundle: EvidenceBundle): string {
  let formatted = '## EVIDENCE BUNDLE\n\n';
  
  // Tier-1 sources (MUST USE) - DO NOT TRUNCATE CODE/CONFIG FILES
  // Only data files are truncated (they're handled via schema audits)
  if (bundle.tier1Sources.length > 0) {
    formatted += '### TIER-1 SOURCES (PRIMARY - MUST CITE)\n\n';
    for (const source of bundle.tier1Sources) {
      formatted += `#### ${source.filePath}`;
      if (source.lineRange) {
        formatted += ` (lines ${source.lineRange.start}-${source.lineRange.end})`;
      }
      formatted += `\nCategory: ${source.category}\n`;
      
      // Add node summary if available
      const summary = bundle.nodeSummaries.get(source.filePath);
      if (summary) {
        formatted += `Summary: ${summary}\n`;
      }
      
      // For data files, show truncated content (full analysis via sandbox)
      // For code/config files, show FULL content (no truncation)
      const isDataFile = source.category === 'dataset';
      if (isDataFile) {
        // Data files: show first 500 chars as preview, full analysis via schema audit
        const content = source.content?.slice(0, 500) || '[Content not available]';
        formatted += `\`\`\`\n${content}${source.content && source.content.length > 500 ? '...\n[TRUNCATED - See schema audit below for full analysis]' : ''}\n\`\`\`\n\n`;
      } else {
        // Code/config files: show FULL content (no truncation)
        formatted += `\`\`\`\n${source.content || '[Content not available]'}\n\`\`\`\n\n`;
      }
    }
  }
  
  // Data schema evidence (COMPUTED - HIGH VALUE)
  if (bundle.dataEvidence.length > 0) {
    formatted += '### DATA SCHEMA EVIDENCE (COMPUTED)\n\n';
    for (const data of bundle.dataEvidence) {
      formatted += `#### ${data.filePath}\n`;
      formatted += `Rows: ${data.rowCount}\n\n`;
      formatted += '| Column | Type | Null% | Min | Max | Sample |\n';
      formatted += '|--------|------|-------|-----|-----|--------|\n';
      for (const col of data.columns.slice(0, 15)) {
        formatted += `| ${col.name} | ${col.dtype} | ${col.nullPercent}% | ${col.min || '-'} | ${col.max || '-'} | ${col.sampleValues[0] || '-'} |\n`;
      }
      formatted += '\n';
    }
  }
  
  // Tier-2 sources (SUPPLEMENTARY - LOW TRUST) - DO NOT TRUNCATE
  if (bundle.tier2Sources.length > 0) {
    formatted += '### TIER-2 SOURCES (SUPPLEMENTARY - USE WITH CAUTION)\n\n';
    formatted += '⚠️ These are documentation files. Claims from README/docs should be verified against code.\n\n';
    for (const source of bundle.tier2Sources) {
      formatted += `#### ${source.filePath}\n`;
      // Show FULL content for documentation files (no truncation)
      formatted += `\`\`\`\n${source.content || '[Content not available]'}\n\`\`\`\n\n`;
    }
  }
  
  return formatted;
}

/**
 * Format claim→evidence table for output
 */
export function formatClaimEvidenceTable(
  claims: Array<{ claim: string; evidence: string; tier: SourceTier | 'none'; filePath?: string; lineRange?: string }>
): string {
  let table = '| Claim | Evidence | Tier | Source |\n';
  table += '|-------|----------|------|--------|\n';
  
  for (const { claim, evidence, tier, filePath, lineRange } of claims) {
    const tierStr = tier === 'none' ? '❌ GAP' : tier === 1 ? '✅ T1' : '⚠️ T2';
    const sourceStr = filePath ? `[${filePath}${lineRange ? `:${lineRange}` : ''}]` : '-';
    table += `| ${claim.slice(0, 50)}${claim.length > 50 ? '...' : ''} | ${evidence.slice(0, 40)}${evidence.length > 40 ? '...' : ''} | ${tierStr} | ${sourceStr} |\n`;
  }
  
  return table;
}

