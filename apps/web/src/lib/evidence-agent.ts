/**
 * Evidence-First Documentation Agent
 * 
 * Two-Pass Generation Architecture:
 * 
 * PASS 1 (Evidence Collection):
 *   - Retrieve Tier-1 sources first (code, config, SQL, tests, datasets)
 *   - Run data schema audits if datasets exist
 *   - Generate code-driven summaries for each KG node
 *   - Build evidence bundle with citations + line ranges
 * 
 * PASS 2 (Narrative Generation):
 *   - Generate documentation using ONLY evidence from Pass 1
 *   - Require claim→evidence mapping per section
 *   - Flag gaps for any claim without Tier-1 evidence
 * 
 * This replaces/extends the basic ReAct agent with evidence-first retrieval.
 */

import OpenAI from 'openai';
import { CodeIntelligenceResult, CodeChunk } from './code-intelligence';
import {
  EvidenceBundle,
  EvidenceFirstConfig,
  QualityMetrics,
  TieredSource,
  DEFAULT_CONFIG,
  retrieveEvidence,
  formatEvidenceForLLM,
  classifySource,
  calculateQualityMetrics,
  checkQualityThresholds,
  runDataSchemaAudit,
  DataSchemaEvidence,
} from './evidence-first';
import {
  getAvailableTools,
  executeTool,
  formatToolResultForDocument,
  ToolContext,
} from './llm-tools';
import { fetchDataFileWithCache, CachedDataFile } from './data-file-cache';

// =============================================================================
// TYPES
// =============================================================================

// Thinking step for UI display (same as react-agent)
export interface ThinkingStep {
  type: 'think' | 'search' | 'observe' | 'draft' | 'verify' | 'refine' | 'tool' | 'complete' | 'evidence';
  message: string;
  details?: string;
  iteration?: number;
  timestamp: number;
}

export type OnThinkingCallback = (step: ThinkingStep) => void;

export interface EvidenceAgentContext {
  openai: OpenAI;
  codeIntelligence: CodeIntelligenceResult;
  allFiles: Array<{ path: string; content: string }>;
  projectName: string;
  config: EvidenceFirstConfig;
  repoUrl?: string; // Optional repo URL for data file access via code execution
  nodeSummaries?: Record<string, string>;
  schemaAuditCache?: {
    schemaAudits?: Record<string, any>;
    commitHash?: string | null;
    updateCache?: (updates: { schemaAudits?: Record<string, any> }) => void;
  };
  globalDataEvidence?: Array<any>; // Pre-computed schema audits (run once at document level)
  blockType?: 'LLM_TEXT' | 'LLM_TABLE' | 'LLM_CHART'; // Block type for tool selection
  onThinking?: OnThinkingCallback; // Callback to emit thinking steps
  dataFileCache?: Map<string, CachedDataFile>; // OPTIMIZATION: Cache for data files
}

export interface EvidenceAgentResult {
  content: string;
  citations: string[];
  citationDetails: Array<{
    filePath: string;
    tier: 1 | 2;
    lineRange?: { start: number; end: number };
  }>;
  evidenceBundle: EvidenceBundle;
  claimEvidenceMap: Array<{
    claim: string;
    evidence: string;
    tier: 1 | 2 | 'none';
    filePath?: string;
  }>;
  confidence: number;
  qualityMetrics: QualityMetrics;
  gaps: string[];
}

export interface EvidenceGenerationResult {
  sections: GeneratedEvidenceSection[];
  overallMetrics: QualityMetrics;
  thresholdViolations: Array<{ metric: string; value: number; threshold: number; severity: 'warning' | 'error' }>;
  dataSchemaEvidence: DataSchemaEvidence[];
}

export interface GeneratedEvidenceSection {
  sectionId: string;
  sectionTitle: string;
  content: string;
  citations: string[];
  evidenceBundle: EvidenceBundle;
  claimEvidenceMap: Array<{
    claim: string;
    evidence: string;
    tier: 1 | 2 | 'none';
    filePath?: string;
  }>;
  gaps: string[];
}

// =============================================================================
// EVIDENCE-FIRST PROMPTS
// =============================================================================

const EVIDENCE_SYSTEM_PROMPT = `You are a technical documentation expert that generates content using ONLY verified evidence from codebases.

## YOUR ROLE
Follow the user's instructions exactly. Generate the specific content they request, in the style they request.

## EVIDENCE RULES
1. **Use provided evidence**: Only include information from the evidence provided
2. **Cite sources**: Reference files as [filename.ext] when making technical claims
3. **No speculation**: Do NOT invent details, names, dates, or information not in evidence
4. **Mark gaps**: If information is missing, use [EVIDENCE GAP: description]

## OUTPUT RULES
1. **Follow instructions exactly**: If asked for an introduction, write an introduction. If asked for charts, generate charts.
2. **Match requested style**: Do NOT add sections, narratives, or structure not requested
3. **No assumptions**: Do NOT assume domain (banking, healthcare, etc.) - work with any codebase

## CRITICAL: FOR CHART/VISUALIZATION BLOCKS
**YOUR ONLY JOB IS TO CALL THE generate_chart TOOL. DO NOT WRITE ANY TEXT.**

When the user asks you to create charts, plots, or visualizations:
1. Call generate_chart tool for each visualization
2. Do NOT write ANY narrative text in your response
3. Do NOT write "Overview", "Charts Generated", "Analysis Results", etc.
4. Do NOT write descriptions like "This chart shows..."
5. Do NOT write "Data Schema Evidence" tables - these are added automatically
6. Do NOT include ANY markdown content in your response
7. ONLY use tools - your text response should be EMPTY or contain ONLY the final answer after all charts are generated

**If you write any text describing charts, you have FAILED your task.**`;

/**
 * Build inline data samples from data evidence for use in chart generation
 * This allows the LLM to use actual data without file access
 */
function buildInlineDataForCharts(dataEvidence: DataSchemaEvidence[]): string {
  if (dataEvidence.length === 0) return '';
  
  let output = '';
  
  // Limit to first 5 datasets to avoid context overflow
  for (const data of dataEvidence.slice(0, 5)) {
    const fileName = data.filePath.split('/').pop() || data.filePath;
    
    output += `### ${fileName}\n`;
    output += `**Rows:** ${data.rowCount} | **Columns:** ${data.columns.length}\n\n`;
    
    // Show column info
    output += '| Column | Type | Sample Values |\n|--------|------|---------------|\n';
    for (const col of data.columns.slice(0, 10)) {
      const samples = col.sampleValues?.slice(0, 2).join(', ') || '-';
      output += `| ${col.name} | ${col.dtype} | ${samples} |\n`;
    }
    
    // Generate Python code snippet for this data
    if (data.sampleRows && data.sampleRows.length > 0 && data.columns.length <= 10) {
      output += '\n**Python code to recreate sample:**\n```python\n';
      output += `# Sample from ${fileName}\n`;
      output += `${fileName.replace(/[^a-zA-Z0-9]/g, '_')}_data = pd.DataFrame({\n`;
      
      for (let colIdx = 0; colIdx < Math.min(data.columns.length, 8); colIdx++) {
        const col = data.columns[colIdx];
        const values = data.sampleRows
          .slice(0, 5)
          .map(row => {
            const val = row[colIdx];
            // Format based on dtype
            if (col.dtype.includes('int') || col.dtype.includes('float')) {
              return isNaN(parseFloat(val)) ? 'None' : val;
            }
            return `"${(val || '').replace(/"/g, '\\"').slice(0, 30)}"`;
          })
          .join(', ');
        output += `    "${col.name}": [${values}],\n`;
      }
      
      output += '})\n```\n\n';
    }
  }
  
  return output;
}

/**
 * Build the user prompt for evidence-based generation
 */
function buildEvidenceUserPrompt(
  sectionTitle: string,
  sectionInstructions: string,
  evidenceBundle: EvidenceBundle,
  blockType?: 'LLM_TEXT' | 'LLM_TABLE' | 'LLM_CHART',
  transferredFiles?: Array<{ path: string; content?: string; url?: string }>
): string {
  // DO NOT truncate evidence - LLM needs to see all code/config files
  // Only data files are truncated (handled via schema audits and sandbox execution)
  const evidenceContext = formatEvidenceForLLM(evidenceBundle);
  
  let blockTypeInstructions = '';
  
  // Build inline data for charts from data evidence
  const inlineDataSamples = evidenceBundle.dataEvidence.length > 0
    ? buildInlineDataForCharts(evidenceBundle.dataEvidence)
    : '';
  
  // Extract column information from cached files (even if truncated, headers are available)
  const dataFileSchemas: Array<{ path: string; columns: string[]; rowCount?: number }> = [];
  if (transferredFiles && transferredFiles.length > 0) {
    for (const file of transferredFiles) {
      if (file.content) {
        // Try to extract headers from CSV/TSV files
        const lines = file.content.split('\n').filter(l => l.trim());
        if (lines.length > 0) {
          const headerLine = lines[0];
          const delimiter = headerLine.includes('\t') ? '\t' : ',';
          const columns = headerLine.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
          const rowCount = lines.length - 1; // Exclude header
          dataFileSchemas.push({ path: file.path, columns, rowCount });
        }
      }
    }
  }
  
  // Build list of available data files with column information
  const availableDataFiles = transferredFiles && transferredFiles.length > 0
    ? transferredFiles.map(f => {
        const schema = dataFileSchemas.find(s => s.path === f.path);
        if (schema && schema.columns.length > 0) {
          return `- ${f.path} (${schema.rowCount || '?'} rows, columns: ${schema.columns.slice(0, 15).join(', ')}${schema.columns.length > 15 ? '...' : ''})`;
        }
        return `- ${f.path}`;
      }).join('\n')
    : (evidenceBundle.dataEvidence
        .map(d => `- ${d.filePath} (${d.rowCount} rows, ${d.columns.length} cols: ${d.columns.slice(0, 15).join(', ')}${d.columns.length > 15 ? '...' : ''})`)
        .join('\n'));
  
  if (blockType === 'LLM_CHART') {
    blockTypeInstructions = `
## ⚠️ CRITICAL: CHART GENERATION REQUIRED ⚠️

**YOU MUST GENERATE VISUAL CHARTS, NOT TABLES**

For chart blocks, you MUST:
1. **PREFER VISUALS OVER TABLES** - Generate charts/graphs using the generate_chart tool
2. **DO NOT create tables** - Use create_data_table only if absolutely necessary for small summary data
3. **Generate MULTIPLE charts if needed** - You can call generate_chart multiple times to create different visualizations
4. **Focus on visualizations** - Histograms, line plots, scatter plots, bar charts, etc.

**You MUST call the generate_chart tool. This is NOT optional.**

**HOW TO LOAD DATA:**
Data files are automatically transferred to the sandbox (full files fetched from GitHub if needed). Use the \`load_data()\` helper function:

\`\`\`python
# Load a CSV file - use the EXACT path shown in AVAILABLE DATA FILES below
df = load_data('data/dataset.csv')

# Load an Excel file
df = load_data('data/file.xlsx')
\`\`\`

**CRITICAL: ALWAYS INSPECT DATA FIRST**
Before plotting, you MUST inspect the data to see what columns actually exist:

\`\`\`python
# Step 1: Load the data
df = load_data('data/dataset.csv')

# Step 2: Inspect the columns (REQUIRED - do not guess column names!)
print("Columns:", df.columns.tolist())
print("Shape:", df.shape)
print("First few rows:")
print(df.head())

# Step 3: Only then plot using the ACTUAL column names
plt.hist(df['column_name'])  # Use the EXACT column name from df.columns
\`\`\`

**IMPORTANT**: 
- Use the EXACT file path from the AVAILABLE DATA FILES list below
- The path must match exactly (case-sensitive)
- Files are automatically fetched from GitHub if they were truncated in cache
- NEVER guess column names - always use df.columns.tolist() first
- If a column doesn't exist, check df.columns and use the correct name

${availableDataFiles ? `**AVAILABLE DATA FILES (automatically transferred):**
${availableDataFiles}` : ''}

${inlineDataSamples ? `**DATA PREVIEW:**
${inlineDataSamples}` : ''}

**CORRECT Example - Using load_data():**
\`\`\`python
import matplotlib.pyplot as plt

# Load actual data using load_data() helper
df = load_data('data/dataset.csv')

# Always inspect columns first!
print("Columns:", df.columns.tolist())

plt.figure(figsize=(10, 6))
plt.hist(df['column_name'], bins=30, edgecolor='white')
plt.title('Distribution of Values')
plt.xlabel('Value')
plt.ylabel('Frequency')
# DO NOT include plt.savefig() - handled automatically!
# DO NOT include plt.show() - not needed!
\`\`\`

**CRITICAL RULES:**
- DO NOT include plt.savefig() calls - the chart is saved automatically
- DO NOT include plt.show() - not supported in headless mode
- DO NOT use file paths like "path/to/file.png" - not needed
- DO return clean Python code WITHOUT markdown code fences (no \`\`\`python)
- ALWAYS inspect df.columns before plotting to use correct column names

**ALSO CORRECT - Inline data as fallback:**
\`\`\`python
import matplotlib.pyplot as plt
import pandas as pd

# Use inline data if files not available
data = pd.DataFrame({
    'Category': ['A', 'B', 'C'],
    'Value': [25, 40, 30]
})
plt.bar(data['Category'], data['Value'])
\`\`\`

**CHART GENERATION WORKFLOW**

**1. Generate Visualizations**
- Use generate_chart tool to create charts based on the user's instructions
- Consider creating multiple charts if requested: distributions, trends, comparisons, correlations, etc.
- Examples: histogram, box plot, line plot, scatter plot, bar chart

**2. Extract Statistics (if requested)**
- Use execute_python_analysis to compute statistics when asked for:
  - Mean, median, min, max, standard deviation
  - Percentiles (25th, 50th, 75th, 90th, 95th)
  - Distribution characteristics
  - Correlation coefficients
- Example code:
\`\`\`python
df = load_data('data/example.csv')
stats = {
    "mean": float(df['column_name'].mean()),
    "median": float(df['column_name'].median()),
    "std": float(df['column_name'].std()),
    "p25": float(df['column_name'].quantile(0.25)),
    "p75": float(df['column_name'].quantile(0.75))
}
_result = stats
\`\`\`

**3. Create Tables (if requested)**
- Use create_data_table to present statistics in tabular format when asked

**IMPORTANT:**
- Use \`load_data('path/to/file.csv')\` to load data files
- The path should match paths in AVAILABLE DATA FILES above
- Follow the user's instructions exactly - don't add content they didn't request`;
  } else if (blockType === 'LLM_TABLE') {
    blockTypeInstructions = `
## TABLE FORMAT REQUIRED
Generate a markdown table with proper syntax:
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |`;
  }
  
  return `Write the "${sectionTitle}" section using ONLY the evidence provided below.

## SECTION REQUIREMENTS
${sectionInstructions}
${blockTypeInstructions}

${evidenceContext}

## YOUR TASK

1. Analyze the TIER-1 evidence first
2. For each claim, cite the specific file and line range
3. If dataset schema evidence is provided, incorporate the actual computed values
4. Mark any claims that lack Tier-1 evidence as [EVIDENCE GAP: ...]
5. Do NOT include the section title "${sectionTitle}" - it will be rendered separately
6. **CRITICAL: Do NOT invent names, reviewers, authors, or people** - only use what's in the evidence
7. **CRITICAL: Do NOT invent dates, versions, or approval information** unless explicitly in code

## OUTPUT FORMAT

Write substantive documentation based on the evidence. After each major claim, cite the source:
- "The system uses XYZ architecture [src/model.py:45-60]"
- "PD curves are calculated using survival analysis [PD/pd_calc.py:12-30]"

If you must use Tier-2 (README/docs) content, note it: "According to documentation [README.md], ..."

If the evidence doesn't contain information about authors, reviewers, or people, DO NOT make it up. Say "[EVIDENCE GAP: author/reviewer information not found in codebase]" instead.

Generate the section content now.`;
}

// =============================================================================
// EVIDENCE AGENT MAIN LOOP
// =============================================================================

/**
 * Helper to emit thinking steps
 */
function emitThinking(
  ctx: EvidenceAgentContext, 
  type: ThinkingStep['type'], 
  message: string, 
  details?: string
) {
  ctx.onThinking?.({
    type,
    message,
    details,
    timestamp: Date.now(),
  });
}

/**
 * Truncate messages to fit within context limits
 * CRITICAL: Always preserve evidence context to prevent hallucinations
 */
function truncateMessagesForContext(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  systemPrompt: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  // Estimate tokens (rough: 1 token ≈ 4 chars)
  const systemTokens = systemPrompt.length / 4;
  const maxTokens = 120000; // gpt-4o-mini has 128k context, leave room for response

  // CRITICAL: Separate evidence context from other messages
  const evidenceMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  const conversationMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue; // Skip, already have systemPrompt

    // Identify evidence messages (contain "TIER-1", "EVIDENCE", or very large user prompts)
    if (msg.role === 'user' && typeof msg.content === 'string') {
      if (msg.content.includes('TIER-1') || msg.content.includes('EVIDENCE') ||
          msg.content.includes('CODE FOUND') || msg.content.length > 5000) {
        evidenceMessages.push(msg);
        continue;
      }
    }

    conversationMessages.push(msg);
  }

  // Always keep: system prompt + ALL evidence + recent conversation
  const truncated: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  let currentTokens = systemTokens;

  // Add ALL evidence messages (never truncate evidence!)
  for (const evidenceMsg of evidenceMessages) {
    const evidenceTokens = JSON.stringify(evidenceMsg).length / 4;
    truncated.push(evidenceMsg);
    currentTokens += evidenceTokens;
  }

  console.log(`[TruncateContext] Evidence tokens: ${Math.round(currentTokens - systemTokens)}, Remaining: ${Math.round(maxTokens - currentTokens)}`);

  // Add recent conversation messages (tool calls, assistant responses)
  // Keep most recent first to ensure we don't drop important tool results
  for (let i = conversationMessages.length - 1; i >= 0; i--) {
    const msg = conversationMessages[i];
    const msgTokens = JSON.stringify(msg).length / 4;

    if (currentTokens + msgTokens > maxTokens) {
      console.log(`[TruncateContext] Reached token limit, dropping ${i + 1} older conversation messages`);
      break;
    }

    truncated.push(msg);
    currentTokens += msgTokens;
  }

  // Sort to ensure proper order: system, evidence, then conversation chronologically
  const systemMsg = truncated[0];
  const evidenceMsgs = truncated.slice(1, evidenceMessages.length + 1);
  const convMsgs = truncated.slice(evidenceMessages.length + 1);

  // Re-sort conversation messages to chronological order
  convMsgs.reverse();

  const result = [systemMsg, ...evidenceMsgs, ...convMsgs];

  console.log(`[TruncateContext] Final: ${result.length} messages, ${Math.round(currentTokens)} tokens`);

  return result;
}

/**
 * Generate a section using evidence-first approach
 */
export async function generateSectionWithEvidence(
  ctx: EvidenceAgentContext,
  sectionTitle: string,
  sectionInstructions: string
): Promise<EvidenceAgentResult & { generatedImage?: { base64: string; mimeType: string }; generatedImages?: Array<{ base64: string; mimeType: string; description?: string }>; executedCode?: string; ragSources?: any[]; dataEvidence?: any[] }> {
  const blockTypeLabel = ctx.blockType === 'LLM_CHART' ? '📊 Chart' : ctx.blockType === 'LLM_TABLE' ? '📋 Table' : '📝 Text';
  console.log(`[EvidenceAgent] Starting evidence-first generation for: ${sectionTitle} (${ctx.blockType})`);
  emitThinking(ctx, 'think', `${blockTypeLabel}: "${sectionTitle}"`, ctx.blockType === 'LLM_CHART' ? 'Will generate visualization' : undefined);
  
  // For chart blocks, use ReAct agent workflow
  if (ctx.blockType === 'LLM_CHART') {
    const { generateChartWithReAct } = await import('./chart-react-agent');
    
    // PASS 1: Evidence Collection (still needed for data evidence)
    console.log(`[ChartAgent] Collecting evidence for data files...`);
    emitThinking(ctx, 'evidence', 'Collecting data evidence...', sectionInstructions.slice(0, 80));
    
    const evidenceBundle = await retrieveEvidence(
      sectionTitle,
      sectionInstructions,
      ctx.codeIntelligence,
      ctx.allFiles,
      ctx.openai,
      ctx.config,
      ctx.repoUrl,
      ctx.nodeSummaries,
      ctx.schemaAuditCache,
      ctx.globalDataEvidence // Pass pre-computed schema audits
    );
    
    // Extract data files for chart agent
    // IMPORTANT: Check cache first to avoid relying on sandbox URL fetching
    const dataFiles: Array<{ path: string; content?: string; url?: string }> = [];
    const dataFilePatterns = /\.(csv|xlsx?|json|parquet|tsv)$/i;

    // Helper to build GitHub raw URL
    function buildGitHubRawUrlForChart(repoUrl: string, filePath: string): string {
      const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!match) return '';
      const [, owner, repo] = match;
      const repoName = repo.replace(/\.git$/, '').split('/')[0];
      return `https://raw.githubusercontent.com/${owner}/${repoName}/main/${filePath}`;
    }

    let urlCount = 0;
    let contentCount = 0;
    let cachedCount = 0;

    for (const file of ctx.allFiles) {
      if (dataFilePatterns.test(file.path)) {
        const isTruncated = file.content.includes('[TRUNCATED:') ||
                           (file.content.split('\n').length <= 11 && file.content.length < 50000);

        if (isTruncated && ctx.repoUrl) {
          // Check cache FIRST before falling back to URL
          const cached = ctx.dataFileCache?.get(file.path);
          if (cached) {
            console.log(`[ChartAgent] ✅ Using cached content for ${file.path}`);
            dataFiles.push({
              path: file.path,
              content: cached.content,
            });
            cachedCount++;
            contentCount++;
          } else {
            const githubUrl = buildGitHubRawUrlForChart(ctx.repoUrl, file.path);
            if (githubUrl) {
              console.log(`[ChartAgent] ⚠️ File ${file.path} is truncated, using GitHub URL (may fail if sandbox has no network)`);
              dataFiles.push({
                path: file.path,
                url: githubUrl,
              });
              urlCount++;
            }
          }
        } else if (file.content) {
          dataFiles.push({
            path: file.path,
            content: file.content,
          });
          contentCount++;
        }
      }
    }

    console.log(`[ChartAgent] Prepared ${dataFiles.length} data files: ${contentCount} with content (${cachedCount} cached), ${urlCount} from GitHub URL`);

    // PRE-FETCH: If any files have URLs instead of content, fetch them now
    // This is critical because the sandbox may not have network access
    if (urlCount > 0) {
      console.log(`[ChartAgent] 🌐 Pre-fetching ${urlCount} files from GitHub URLs...`);
      for (const file of dataFiles) {
        if (file.url && !file.content) {
          try {
            const response = await fetch(file.url, {
              signal: AbortSignal.timeout(30000), // 30s timeout
            });
            if (response.ok) {
              const content = await response.text();
              file.content = content;
              delete file.url; // Remove URL since we have content now
              console.log(`[ChartAgent] ✅ Fetched ${file.path}: ${content.length} bytes`);
            } else {
              console.warn(`[ChartAgent] ⚠️ Failed to fetch ${file.path}: ${response.status}`);
            }
          } catch (error) {
            console.warn(`[ChartAgent] ⚠️ Error fetching ${file.path}:`, error instanceof Error ? error.message : error);
          }
        }
      }
      const stillUrlCount = dataFiles.filter(f => f.url && !f.content).length;
      const nowContentCount = dataFiles.filter(f => f.content).length;
      console.log(`[ChartAgent] After pre-fetch: ${nowContentCount} with content, ${stillUrlCount} still need URL fetch`);
    }

    // Use ReAct chart agent
    const chartResult = await generateChartWithReAct(
      {
        openai: ctx.openai,
        projectName: ctx.projectName,
        repoUrl: ctx.repoUrl,
        evidenceBundle,
        allFiles: ctx.allFiles,
        dataFiles,
        onThinking: (step) => emitThinking(ctx, step.type as any, step.message, step.details),
      },
      sectionTitle,
      sectionInstructions
    );

    console.log(`[ChartAgent] 📥 Received result from chart-react-agent:`, {
      contentLength: chartResult.content?.length || 0,
      generatedImagesCount: chartResult.generatedImages?.length || 0,
      hasExecutedCode: !!chartResult.executedCode,
      tablesCount: chartResult.tables?.length || 0,
    });

    // Convert to EvidenceAgentResult format
    const generatedImages = chartResult.generatedImages || [];
    const generatedImage = generatedImages.length > 0
      ? generatedImages[generatedImages.length - 1]
      : undefined;

    if (generatedImages.length > 0) {
      console.log(`[ChartAgent] 🖼️ Charts to return:`, generatedImages.map((img, i) => ({
        index: i,
        description: img.description,
        base64Length: img.base64?.length || 0,
        mimeType: img.mimeType,
      })));
    } else {
      console.warn(`[ChartAgent] ⚠️ No charts generated for "${sectionTitle}"`);
    }

    return {
      content: chartResult.content,
      citations: [],
      citationDetails: [],
      evidenceBundle,
      claimEvidenceMap: [],
      confidence: 0.8,
      qualityMetrics: {
        tier1CitationPercent: 0,
        tier1SectionCoverage: 0,
        executedValidationsCount: 0,
        uncoveredSectionsCount: 0,
        readmeOnlyCount: 0,
        totalCitations: 0,
        tier1Citations: 0,
        tier2Citations: 0,
      },
      gaps: [],
      generatedImage,
      generatedImages,
      executedCode: chartResult.executedCode,
      ragSources: [],
      dataEvidence: evidenceBundle.dataEvidence.map(d => ({
        filePath: d.filePath,
        rowCount: d.rowCount,
        columns: d.columns.map(col => ({
          name: col.name,
          dtype: col.dtype,
          nullPercent: col.nullPercent,
          min: col.min,
          max: col.max,
        })),
      })),
    };
  }
  
  // PASS 1: Evidence Collection (for non-chart blocks)
  console.log(`[EvidenceAgent] PASS 1: Collecting evidence...`);
  emitThinking(ctx, 'evidence', 'Collecting Tier-1 evidence from code...', sectionInstructions.slice(0, 80));
  
  const evidenceBundle = await retrieveEvidence(
    sectionTitle,
    sectionInstructions,
    ctx.codeIntelligence,
    ctx.allFiles,
    ctx.openai,
    ctx.config,
    ctx.repoUrl, // Pass repo URL for data file access
    ctx.nodeSummaries, // Reuse cached node summaries when available
    ctx.schemaAuditCache, // Pass schema audit cache
    ctx.globalDataEvidence // Pass pre-computed schema audits (run once at document level)
  );
  
  // Check if we have sufficient Tier-1 evidence
  if (evidenceBundle.tier1Sources.length === 0 && ctx.config.requireTier1Evidence) {
    console.log(`[EvidenceAgent] WARNING: No Tier-1 evidence found for ${sectionTitle}`);
    emitThinking(ctx, 'observe', `⚠️ No Tier-1 evidence found`, 'Will use Tier-2 sources');
  } else {
    emitThinking(ctx, 'observe', `Found ${evidenceBundle.tier1Sources.length} Tier-1 sources`, evidenceBundle.tier1Sources.slice(0, 3).map(s => s.filePath).join(', '));
  }
  
  // PASS 2: Narrative Generation with Tool Support
  console.log(`[EvidenceAgent] PASS 2: Generating narrative...`);
  emitThinking(ctx, 'draft', 'Writing documentation from evidence...');
  
  // Extract data files from evidence for chart generation (MUST be before buildEvidenceUserPrompt)
  // Note: Chart blocks (LLM_CHART) are handled above and return early.
  // This section only handles LLM_TEXT and LLM_TABLE blocks.

  // Get available tools for text/table generation (table tool only, no chart tools needed)
  const tools = await getAvailableTools();
  console.log(`[EvidenceAgent] Block type: ${ctx.blockType}, Tools available: ${tools.length}`);
  
  // DO NOT truncate evidence - LLM needs full codebase understanding
  // Note: Data files for sandbox are only used by chart blocks, which return early above
  const userPrompt = buildEvidenceUserPrompt(sectionTitle, sectionInstructions, evidenceBundle, ctx.blockType);

  const toolContext: ToolContext = {
    projectName: ctx.projectName,
    repoUrl: ctx.repoUrl,
    codebaseFiles: ctx.allFiles.map(f => f.path),
    currentSection: sectionTitle,
  };
  
  // Track tool outputs
  let content = '';
  let generatedImages: Array<{ base64: string; mimeType: string; description?: string }> = []; // Support multiple charts
  let executedCode: string | undefined;
  
  // Build system prompt (charts are handled by the early return above, so this is for text/table blocks)
  const systemPrompt = EVIDENCE_SYSTEM_PROMPT;

  // For text/table blocks, use auto tool choice if tools are available
  const initialToolChoice: 'auto' | undefined = tools.length > 0 ? 'auto' : undefined;
  
  console.log(`[EvidenceAgent] Tool choice for ${sectionTitle}:`, initialToolChoice);
  
  // Initial API call with tools
  let response = await ctx.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 2000,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: initialToolChoice,
  });
  
  // Handle tool calls in a loop
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  // For text/table blocks, 3 iterations is sufficient
  let iterations = 0;
  const maxIterations = 3;

  // Track which tools have been called to prevent repeated table generation
  const calledTools = new Set<string>();
  // Track table captions to prevent duplicates
  const seenTableCaptions = new Set<string>();
  
  while (response.choices[0]?.message?.tool_calls && iterations < maxIterations) {
    iterations++;
    const toolCalls = response.choices[0].message.tool_calls;
    const toolNames = toolCalls.map(tc => tc.function.name);
    console.log(`[EvidenceAgent] Iteration ${iterations}/${maxIterations}: Tool calls requested:`, toolNames);
    emitThinking(ctx, 'tool', `Executing: ${toolNames.join(', ')}`, undefined);
    
    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: response.choices[0].message.content || null,
      tool_calls: toolCalls,
    });
    
    // Execute tools
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments || '{}');

      // Skip duplicate table generation
      if (toolName === 'create_data_table') {
        const tableCaption = toolArgs.caption || 'Data Table';
        if (seenTableCaptions.has(tableCaption)) {
          console.log(`[EvidenceAgent] Skipping duplicate table: ${tableCaption}`);
          // Still add tool result but mark as skipped
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ 
              success: true, 
              skipped: true, 
              reason: 'Duplicate table caption',
              message: `Table "${tableCaption}" was already generated. Skipping duplicate.`
            }),
          });
          continue;
        }
        seenTableCaptions.add(tableCaption);
      }

      // Track tool usage
      calledTools.add(toolName);

      try {
        const toolResult = await executeTool(toolName, toolArgs, toolContext);
        
        // Format tool result for document
        const formattedResult = formatToolResultForDocument(toolName, toolResult);
        
        // Store chart image(s) if generated (support multiple charts - LLM can call tool multiple times)
        if (toolName === 'generate_chart' && formattedResult.generatedImage) {
          // If this tool call generated multiple charts, add all of them
          if (formattedResult.generatedImages && formattedResult.generatedImages.length > 1) {
            formattedResult.generatedImages.forEach((img, idx) => {
              generatedImages.push({
                base64: img.base64,
                mimeType: img.mimeType,
                description: toolArgs.description ? `${toolArgs.description} (${idx + 1})` : `Chart ${generatedImages.length + 1}`,
              });
            });
            emitThinking(ctx, 'complete', `📊 ${formattedResult.generatedImages.length} charts generated successfully!`);
          } else {
            // Single chart from this tool call
            console.log(`[EvidenceAgent] 📊 Tool call generated 1 chart`);
            // Try to extract chart title from Python code for better description
            const codeTitle = toolArgs.python_code?.match(/plt\.(title|suptitle)\(['"]([^'"]+)['"]\)/)?.[2];
            generatedImages.push({
              base64: formattedResult.generatedImage.base64,
              mimeType: formattedResult.generatedImage.mimeType,
              description: toolArgs.description || codeTitle || `Chart ${generatedImages.length + 1}`,
            });
            emitThinking(ctx, 'complete', `📊 Chart ${generatedImages.length} generated successfully!`);
          }
          // Keep executed code from the latest chart (or we could concatenate all)
          executedCode = formattedResult.executedCode;
          console.log(`[EvidenceAgent] Total charts collected so far: ${generatedImages.length}`);
        }
        
        // Include sandbox execution outputs in the context for the LLM
        // This allows LLM to see summary statistics, headers, etc. from data analysis
        let toolResultContent = JSON.stringify(toolResult);
        if (toolResult.success && toolResult.result) {
          // For analysis results, include stdout/stderr/structuredResult if available
          const result = toolResult.result as any;
          if (result.stdout || result.stderr || result.structuredResult) {
            let outputText = '';
            if (result.stdout) outputText += `\n\n**Execution Output:**\n\`\`\`\n${result.stdout}\n\`\`\``;
            if (result.stderr) outputText += `\n\n**Errors/Warnings:**\n\`\`\`\n${result.stderr}\n\`\`\``;
            if (result.structuredResult) {
              outputText += `\n\n**Structured Results:**\n\`\`\`json\n${JSON.stringify(result.structuredResult, null, 2)}\n\`\`\``;
            }
            toolResultContent = JSON.stringify(toolResult) + outputText;
          }
        }
        
        // Add tool result to messages (with execution outputs so LLM can see data analysis results)
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResultContent,
        });
      } catch (error) {
        console.error(`[EvidenceAgent] Tool execution failed:`, error);
        emitThinking(ctx, 'tool', `⚠️ Tool failed: ${toolName}`, error instanceof Error ? error.message : 'Unknown error');
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
        });
      }
    }
    
    // Continue the conversation
    const truncatedMessages = truncateMessagesForContext(messages, systemPrompt);

    // For text/table blocks, auto tool choice is sufficient
    const nextToolChoice: 'auto' | undefined = 'auto';
    
    response = await ctx.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: truncatedMessages,
      temperature: 0.3,
      max_tokens: 2000,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: nextToolChoice,
    });
  }
  
  // Get final content
  content = response.choices[0]?.message?.content || '';

  // Note: Chart block processing (LLM_CHART) is handled by the early return above.
  // Text/table blocks continue here with their generated content.
  
  // Extract citations and build claim-evidence map
  const { citations, citationDetails, claimEvidenceMap, gaps } = extractCitationsAndClaims(
    content,
    evidenceBundle
  );
  
  // Calculate quality metrics for this section
  const citationMap = new Map<string, string[]>();
  citationMap.set(evidenceBundle.sectionId, citations);
  const qualityMetrics = calculateQualityMetrics([evidenceBundle], citationMap);
  
  // Calculate confidence based on evidence quality
  const confidence = calculateConfidence(evidenceBundle, citations, gaps);
  
  console.log(`[EvidenceAgent] Generated ${sectionTitle}: ${citations.length} citations, ${gaps.length} gaps, confidence: ${confidence}`);
  emitThinking(ctx, 'complete', `✅ Complete: ${citations.length} citations, ${Math.round(confidence * 100)}% confidence`);
  
  // Build RAG sources and data evidence for UI
  const ragSources = [
    ...evidenceBundle.tier1Sources.map((src) => ({
      filePath: src.filePath,
      lineRange: src.lineRange,
      tier: 1 as const,
      category: src.category,
      excerpt: src.content?.slice(0, 400),
      reason: 'Tier-1 evidence',
    })),
    ...evidenceBundle.tier2Sources.map((src) => ({
      filePath: src.filePath,
      lineRange: src.lineRange,
      tier: 2 as const,
      category: src.category,
      excerpt: src.content?.slice(0, 400),
      reason: 'Tier-2 evidence',
    })),
  ];

  const dataEvidence = evidenceBundle.dataEvidence.map((dataEv) => ({
    filePath: dataEv.filePath,
    rowCount: dataEv.rowCount,
    columns: dataEv.columns.map((col) => ({
      name: col.name,
      dtype: col.dtype,
      nullPercent: col.nullPercent,
      min: col.min,
      max: col.max,
    })),
  }));
  
  // Convert array to single image for backward compatibility (UI expects single image for now)
  // TODO: Update UI to support multiple images
  const generatedImage = generatedImages.length > 0 ? generatedImages[generatedImages.length - 1] : undefined;
  
  console.log(`[EvidenceAgent] Returning ${generatedImages.length} chart(s) for "${sectionTitle}"`);
  if (generatedImages.length > 1) {
    console.log(`[EvidenceAgent] Multiple charts: ${generatedImages.map((img, idx) => `Chart ${idx + 1}: ${img.description || 'No description'}`).join(', ')}`);
  }
  
  return {
    content,
    citations,
    citationDetails,
    evidenceBundle,
    claimEvidenceMap,
    confidence,
    qualityMetrics,
    gaps,
    generatedImage, // For backward compatibility - last chart
    generatedImages, // New: array of all charts
    executedCode,
    ragSources,
    dataEvidence,
  };
}

/**
 * Extract citations and build claim-evidence mapping from generated content
 */
function extractCitationsAndClaims(
  content: string,
  evidenceBundle: EvidenceBundle
): {
  citations: string[];
  citationDetails: Array<{ filePath: string; tier: 1 | 2; lineRange?: { start: number; end: number } }>;
  claimEvidenceMap: Array<{ claim: string; evidence: string; tier: 1 | 2 | 'none'; filePath?: string }>;
  gaps: string[];
} {
  const citations: string[] = [];
  const citationDetails: Array<{ filePath: string; tier: 1 | 2; lineRange?: { start: number; end: number } }> = [];
  const claimEvidenceMap: Array<{ claim: string; evidence: string; tier: 1 | 2 | 'none'; filePath?: string }> = [];
  const gaps: string[] = [];
  
  // Extract file citations: [filename.ext] or [filename.ext:start-end]
  const citationRegex = /\[([^\]]+\.[a-zA-Z]+(?::\d+(?:-\d+)?)?)\]/g;
  let match;
  
  while ((match = citationRegex.exec(content)) !== null) {
    const fullMatch = match[1];
    const [filePath, lineRangeStr] = fullMatch.split(':');
    
    if (!citations.includes(filePath)) {
      citations.push(filePath);
      
      const { tier } = classifySource(filePath);
      let lineRange: { start: number; end: number } | undefined;
      
      if (lineRangeStr) {
        const [start, end] = lineRangeStr.split('-').map(Number);
        if (start) {
          lineRange = { start, end: end || start };
        }
      }
      
      citationDetails.push({ filePath, tier, lineRange });
    }
  }
  
  // Extract evidence gaps: [EVIDENCE GAP: description]
  const gapRegex = /\[EVIDENCE GAP:\s*([^\]]+)\]/gi;
  while ((match = gapRegex.exec(content)) !== null) {
    gaps.push(match[1]);
  }
  
  // Build simple claim-evidence map from sentences with citations
  const sentences = content.split(/[.!?]\s+/);
  for (const sentence of sentences) {
    const sentenceCitations = sentence.match(citationRegex);
    if (sentenceCitations && sentenceCitations.length > 0) {
      const firstCitation = sentenceCitations[0].replace(/[\[\]]/g, '').split(':')[0];
      const { tier } = classifySource(firstCitation);
      
      claimEvidenceMap.push({
        claim: sentence.replace(citationRegex, '').trim().slice(0, 100),
        evidence: sentenceCitations[0],
        tier,
        filePath: firstCitation,
      });
    }
  }
  
  // Add gap entries to claim-evidence map
  for (const gap of gaps) {
    claimEvidenceMap.push({
      claim: gap,
      evidence: 'MISSING',
      tier: 'none',
    });
  }
  
  return { citations, citationDetails, claimEvidenceMap, gaps };
}

/**
 * Calculate confidence score based on evidence quality
 */
function calculateConfidence(
  evidenceBundle: EvidenceBundle,
  citations: string[],
  gaps: string[]
): number {
  let confidence = 0.5; // Base confidence
  
  // Boost for Tier-1 sources
  const tier1Count = citations.filter(c => classifySource(c).tier === 1).length;
  confidence += Math.min(tier1Count * 0.1, 0.3);
  
  // Boost for data schema evidence
  if (evidenceBundle.dataEvidence.length > 0) {
    confidence += 0.1;
  }
  
  // Boost for executed validations
  confidence += Math.min(evidenceBundle.executedValidations.length * 0.05, 0.1);
  
  // Penalty for gaps
  confidence -= gaps.length * 0.05;
  
  // Penalty for README-only citations
  const readmeOnlyCount = citations.filter(c => classifySource(c).category === 'readme').length;
  if (readmeOnlyCount > 0 && tier1Count === 0) {
    confidence -= 0.2;
  }
  
  return Math.max(0.1, Math.min(1.0, confidence));
}

// =============================================================================
// FULL DOCUMENT GENERATION WITH EVIDENCE
// =============================================================================

/**
 * Generate complete documentation with evidence-first approach
 */
export async function generateDocumentWithEvidence(
  ctx: EvidenceAgentContext,
  sections: Array<{ id: string; title: string; instructions: string }>,
  onProgress?: (message: string) => void
): Promise<EvidenceGenerationResult> {
  console.log(`[EvidenceAgent] Generating ${sections.length} sections with evidence-first approach`);
  
  const generatedSections: GeneratedEvidenceSection[] = [];
  const allBundles: EvidenceBundle[] = [];
  const allCitations = new Map<string, string[]>();
  
  // Run data schema audit once for all datasets
  onProgress?.('Running data schema audits...');
  const dataFiles = ctx.allFiles.filter(f => classifySource(f.path).category === 'dataset');
  const globalDataEvidence = ctx.config.runDataSchemaAudit && dataFiles.length > 0
    ? await runDataSchemaAudit(dataFiles.slice(0, 10), ctx.config)
    : [];
  
  if (globalDataEvidence.length > 0) {
    console.log(`[EvidenceAgent] Completed ${globalDataEvidence.length} data schema audits`);
  }
  
  // Generate each section
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    onProgress?.(`Generating: ${section.title} (${i + 1}/${sections.length})...`);
    
    try {
      const result = await generateSectionWithEvidence(ctx, section.title, section.instructions);
      
      // Add global data evidence to bundle if relevant
      if (globalDataEvidence.length > 0 && 
          (section.title.toLowerCase().includes('data') || 
           section.title.toLowerCase().includes('input') ||
           section.title.toLowerCase().includes('feature'))) {
        result.evidenceBundle.dataEvidence.push(...globalDataEvidence);
      }
      
      generatedSections.push({
        sectionId: section.id,
        sectionTitle: section.title,
        content: result.content,
        citations: result.citations,
        evidenceBundle: result.evidenceBundle,
        claimEvidenceMap: result.claimEvidenceMap,
        gaps: result.gaps,
      });
      
      allBundles.push(result.evidenceBundle);
      allCitations.set(section.id, result.citations);
    } catch (error) {
      console.error(`[EvidenceAgent] Failed to generate ${section.title}:`, error);
      
      // Create placeholder section with gap
      generatedSections.push({
        sectionId: section.id,
        sectionTitle: section.title,
        content: `[EVIDENCE GAP: Failed to generate section due to error]`,
        citations: [],
        evidenceBundle: {
          sectionId: section.id,
          sectionTitle: section.title,
          tier1Sources: [],
          tier2Sources: [],
          dataEvidence: [],
          nodeSummaries: new Map(),
          executedValidations: [],
        },
        claimEvidenceMap: [],
        gaps: ['Failed to generate section'],
      });
    }
  }
  
  // Calculate overall metrics
  const overallMetrics = calculateQualityMetrics(allBundles, allCitations);
  const thresholdViolations = checkQualityThresholds(overallMetrics, ctx.config);
  
  console.log(`[EvidenceAgent] Document complete. Metrics:`, {
    tier1Percent: overallMetrics.tier1CitationPercent,
    tier1Coverage: overallMetrics.tier1SectionCoverage,
    uncovered: overallMetrics.uncoveredSectionsCount,
    violations: thresholdViolations.length,
  });
  
  return {
    sections: generatedSections,
    overallMetrics,
    thresholdViolations,
    dataSchemaEvidence: globalDataEvidence,
  };
}

// =============================================================================
// INTEGRATION HELPERS
// =============================================================================

/**
 * Convert EvidenceAgentResult to the format expected by the existing generation pipeline
 */
export function convertToLegacyFormat(result: EvidenceAgentResult): {
  content: string;
  citations: string[];
  confidence: number;
} {
  return {
    content: result.content,
    citations: result.citations,
    confidence: result.confidence,
  };
}

/**
 * Generate gaps from evidence-based generation
 */
export function generateEvidenceGaps(
  result: EvidenceAgentResult,
  sectionId: string,
  sectionTitle: string
): Array<{
  id: string;
  sectionId: string;
  sectionTitle: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  suggestion: string;
}> {
  const gaps: Array<{
    id: string;
    sectionId: string;
    sectionTitle: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    suggestion: string;
  }> = [];
  
  // Convert evidence gaps to document gaps
  for (let i = 0; i < result.gaps.length; i++) {
    gaps.push({
      id: `evidence-gap-${sectionId}-${i}`,
      sectionId,
      sectionTitle,
      severity: 'high',
      description: `No code evidence found: ${result.gaps[i]}`,
      suggestion: 'Provide code files, configs, or test files that demonstrate this functionality',
    });
  }
  
  // Add gap if no Tier-1 citations
  if (result.qualityMetrics.tier1Citations === 0) {
    gaps.push({
      id: `tier1-gap-${sectionId}`,
      sectionId,
      sectionTitle,
      severity: 'critical',
      description: 'Section has no Tier-1 evidence (code, config, tests)',
      suggestion: 'This section relies only on README/docs. Add code evidence to support claims.',
    });
  }
  
  // Add gap if README-only
  if (result.qualityMetrics.readmeOnlyCount > 0 && result.qualityMetrics.tier1Citations === 0) {
    gaps.push({
      id: `readme-only-${sectionId}`,
      sectionId,
      sectionTitle,
      severity: 'high',
      description: 'Section cites only README/documentation files',
      suggestion: 'README claims should be verified against actual code implementation',
    });
  }
  
  return gaps;
}

