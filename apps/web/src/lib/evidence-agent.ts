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
  blockType?: 'LLM_TEXT' | 'LLM_TABLE' | 'LLM_CHART'; // Block type for tool selection
  onThinking?: OnThinkingCallback; // Callback to emit thinking steps
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

const EVIDENCE_SYSTEM_PROMPT = `You are an EVIDENCE-FIRST documentation agent generating audit-grade banking documentation.

## CRITICAL RULES

1. **EVIDENCE HIERARCHY**
   - TIER-1 (MUST USE): Core code, configs, SQL, tests, notebooks, dataset schemas
   - TIER-2 (LOW TRUST): README, docs - use ONLY if corroborated by Tier-1

2. **CITATION REQUIREMENTS**
   - Every non-trivial claim MUST cite a specific file path + line range
   - Format: [filename.ext:start-end] or [filename.ext]
   - If you cannot find Tier-1 evidence for a claim, mark it: [EVIDENCE GAP: description]

3. **NO SPECULATION - ABSOLUTELY FORBIDDEN**
   - Do NOT invent file paths, code examples, or technical details
   - Do NOT invent names, reviewers, authors, or people - these MUST come from evidence
   - Do NOT describe features not present in the evidence
   - Do NOT make up dates, versions, or approval information unless explicitly in code
   - If information is missing, say so explicitly with [EVIDENCE GAP: ...]

4. **NO HALLUCINATED PEOPLE OR ENTITIES**
   - NEVER invent author names, reviewer names, approver names, or any person names
   - NEVER invent company names, department names, or organizational structures
   - If the evidence doesn't contain names/people, DO NOT include them
   - Example: If you see "Author: John Doe" in evidence, you can cite it. Otherwise, DO NOT make it up.

5. **DATA EVIDENCE**
   - If dataset schema evidence is provided, use it as PRIMARY source
   - Include actual column names, types, null percentages from computed schema
   - These are COMPUTED facts, not documentation claims

6. **CLAIM→EVIDENCE FORMAT**
   For each major claim, internally track:
   - What claim am I making?
   - What is my evidence?
   - What tier is the evidence?
   - What file/line proves this?

7. **GAP MARKERS**
   - [EVIDENCE GAP: description of what's missing] - when claim lacks Tier-1 support
   - [TBD] - only for specific numeric values that need measurement
   - [NEEDS: specific description] - for business context not in code
   - NEVER write placeholder text like [NEEDS: xxx] - always describe what's actually needed

8. **CHART GENERATION**
   - If this is a chart block, you MUST use the generate_chart tool
   - Write Python code using matplotlib to create the visualization
   - The code will be executed automatically
   - Do NOT just describe a chart - actually generate it using the tool`;

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

You MUST call the generate_chart tool. This is NOT optional.

**HOW TO LOAD DATA:**
Data files are automatically transferred to the sandbox (full files fetched from GitHub if needed). Use the \`load_data()\` helper function:

\`\`\`python
# Load a CSV file - use the EXACT path shown in AVAILABLE DATA FILES below
df = load_data('ECL/datasets/ECLData.csv')

# Load an Excel file
df = load_data('PD/datasets/file.xlsx')
\`\`\`

**CRITICAL: ALWAYS INSPECT DATA FIRST**
Before plotting, you MUST inspect the data to see what columns actually exist:

\`\`\`python
# Step 1: Load the data
df = load_data('ECL/datasets/ECLData.csv')

# Step 2: Inspect the columns (REQUIRED - do not guess column names!)
print("Columns:", df.columns.tolist())
print("Shape:", df.shape)
print("First few rows:")
print(df.head())

# Step 3: Only then plot using the ACTUAL column names
plt.hist(df['OUTSTANDING'])  # Use the EXACT column name from df.columns
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
df = load_data('ECL/datasets/ECLData.csv')

plt.figure(figsize=(10, 6))
plt.hist(df['OUTSTANDING'], bins=30, edgecolor='white')
plt.title('Distribution of Outstanding Amounts')
plt.xlabel('Outstanding Amount')
plt.ylabel('Frequency')
\`\`\`

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

**IMPORTANT:**
- Use \`load_data('path/to/file.csv')\` to load transferred files
- The path should match paths in AVAILABLE DATA FILES above
- If load_data fails, fall back to inline data from DATA PREVIEW
- Always create a chart - don't just describe one`;
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
 * Keeps system prompt and recent messages, removes older evidence
 */
function truncateMessagesForContext(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  systemPrompt: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  // Estimate tokens (rough: 1 token ≈ 4 chars)
  const systemTokens = systemPrompt.length / 4;
  const maxTokens = 100000; // Leave room for response
  let currentTokens = systemTokens;
  
  const truncated: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];
  
  // Keep messages in reverse order (most recent first)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'system') continue; // Already added
    
    const msgTokens = JSON.stringify(msg).length / 4;
    if (currentTokens + msgTokens > maxTokens) {
      // Truncate user message content if it's too long
      if (msg.role === 'user' && typeof msg.content === 'string') {
        const maxContentLength = (maxTokens - currentTokens) * 4;
        truncated.unshift({
          ...msg,
          content: msg.content.slice(0, maxContentLength) + '\n\n[Content truncated for context length]',
        });
      }
      break;
    }
    
    truncated.unshift(msg);
    currentTokens += msgTokens;
  }
  
  return truncated;
}

/**
 * Generate a section using evidence-first approach
 */
export async function generateSectionWithEvidence(
  ctx: EvidenceAgentContext,
  sectionTitle: string,
  sectionInstructions: string
): Promise<EvidenceAgentResult & { generatedImage?: { base64: string; mimeType: string }; executedCode?: string; ragSources?: any[]; dataEvidence?: any[] }> {
  const blockTypeLabel = ctx.blockType === 'LLM_CHART' ? '📊 Chart' : ctx.blockType === 'LLM_TABLE' ? '📋 Table' : '📝 Text';
  console.log(`[EvidenceAgent] Starting evidence-first generation for: ${sectionTitle} (${ctx.blockType})`);
  emitThinking(ctx, 'think', `${blockTypeLabel}: "${sectionTitle}"`, ctx.blockType === 'LLM_CHART' ? 'Will generate visualization' : undefined);
  
  // PASS 1: Evidence Collection
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
    ctx.nodeSummaries // Reuse cached node summaries when available
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
  const dataFilesForSandbox: Array<{ path: string; content?: string; url?: string }> = [];
  
  // Helper to build GitHub raw URL
  function buildGitHubRawUrl(repoUrl: string, filePath: string): string {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return '';
    const [, owner, repo] = match;
    const repoName = repo.replace(/\.git$/, '').split('/')[0]; // Handle URLs with path
    // Default to main branch (could be enhanced to detect branch from context)
    return `https://raw.githubusercontent.com/${owner}/${repoName}/main/${filePath}`;
  }
  
  // Get data file contents from the code intelligence context
  if (ctx.blockType === 'LLM_CHART') {
    // Find data files in allFiles
    const dataFilePatterns = /\.(csv|xlsx?|json|parquet|tsv)$/i;
    for (const file of ctx.allFiles) {
      if (dataFilePatterns.test(file.path)) {
        // Check if file is truncated (from cache compression)
        // Truncated files have "[TRUNCATED:" marker or are suspiciously small for data files
        const isTruncated = file.content.includes('[TRUNCATED:') || 
                           (file.content.split('\n').length <= 11 && file.content.length < 50000);
        
        if (isTruncated && ctx.repoUrl) {
          // File is truncated - fetch full content from GitHub
          console.log(`[EvidenceAgent] File ${file.path} appears truncated (${file.content.split('\n').length} lines), fetching full content from GitHub...`);
          const githubUrl = buildGitHubRawUrl(ctx.repoUrl, file.path);
          if (githubUrl) {
            dataFilesForSandbox.push({
              path: file.path,
              url: githubUrl, // Use URL instead of truncated content
            });
          } else {
            console.warn(`[EvidenceAgent] Could not build GitHub URL for ${file.path}`);
          }
        } else if (file.content && !isTruncated) {
          // File is not truncated, use content directly
          dataFilesForSandbox.push({
            path: file.path,
            content: file.content,
          });
        } else if (!file.content) {
          // No content at all - try GitHub URL
          if (ctx.repoUrl) {
            const githubUrl = buildGitHubRawUrl(ctx.repoUrl, file.path);
            if (githubUrl) {
              dataFilesForSandbox.push({
                path: file.path,
                url: githubUrl,
              });
            }
          }
        }
      }
    }
    const urlCount = dataFilesForSandbox.filter(f => f.url).length;
    const contentCount = dataFilesForSandbox.filter(f => f.content).length;
    console.log(`[EvidenceAgent] Found ${dataFilesForSandbox.length} data files to transfer: ${contentCount} with content, ${urlCount} from GitHub`);
  }
  
  // Get available tools (especially for chart generation)
  const tools = await getAvailableTools();
  const hasChartTool = tools.some(t => t.function.name === 'generate_chart');
  console.log(`[EvidenceAgent] Block type: ${ctx.blockType}, Tools available: ${tools.length}, Has chart tool: ${hasChartTool}`);
  
  // Warn user if chart tool is not available for chart blocks
  if (ctx.blockType === 'LLM_CHART' && !hasChartTool) {
    emitThinking(ctx, 'tool', '⚠️ Sandbox not running - charts disabled', 'Run: docker-compose up sandbox-python -d');
  }
  
  // DO NOT truncate evidence - LLM needs full codebase understanding
  // Data files are handled via schema audits (outputs shown, not raw data)
  const userPrompt = buildEvidenceUserPrompt(sectionTitle, sectionInstructions, evidenceBundle, ctx.blockType, dataFilesForSandbox);
  
  const toolContext: ToolContext = {
    projectName: ctx.projectName,
    repoUrl: ctx.repoUrl,
    codebaseFiles: ctx.allFiles.map(f => f.path),
    currentSection: sectionTitle,
    dataFiles: dataFilesForSandbox.length > 0 ? dataFilesForSandbox : undefined,
  };
  
  // Track tool outputs
  let content = '';
  let generatedImage: { base64: string; mimeType: string } | undefined;
  let executedCode: string | undefined;
  
  // Build system prompt with tool instructions if needed
  let systemPrompt = EVIDENCE_SYSTEM_PROMPT;
  if (ctx.blockType === 'LLM_CHART') {
    if (hasChartTool) {
      systemPrompt += '\n\n## ⚠️ CRITICAL: CHART GENERATION REQUIRED ⚠️\n\nYou MUST call the generate_chart tool. This is MANDATORY for chart blocks.\n\nDO NOT write text describing a chart. DO NOT say "a chart would show...".\n\nYOU MUST call the generate_chart tool with Python matplotlib code. The tool will execute it and embed the image.';
    } else {
      console.warn(`[EvidenceAgent] Chart tool not available for ${sectionTitle} - sandbox may be down`);
      systemPrompt += '\n\n## CHART GENERATION REQUIRED\n\nYou MUST generate Python matplotlib code in a code block. The code will be executed to create the chart.';
    }
  }
  
  // For chart blocks, we need to force tool usage
  // Use function-specific tool_choice to strongly encourage chart generation
  const initialToolChoice: 'auto' | { type: 'function'; function: { name: string } } | undefined = 
    ctx.blockType === 'LLM_CHART' && hasChartTool
      ? { type: 'function', function: { name: 'generate_chart' } }
      : tools.length > 0 ? 'auto' : undefined;
  
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
  
  let iterations = 0;
  const maxIterations = 3;
  
  while (response.choices[0]?.message?.tool_calls && iterations < maxIterations) {
    iterations++;
    const toolCalls = response.choices[0].message.tool_calls;
    const toolNames = toolCalls.map(tc => tc.function.name);
    console.log(`[EvidenceAgent] Tool calls requested:`, toolNames);
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
      
      try {
        const toolResult = await executeTool(toolName, toolArgs, toolContext);
        
        // Format tool result for document
        const formattedResult = formatToolResultForDocument(toolName, toolResult);
        
        // Store chart image if generated (support multiple charts - LLM can call tool multiple times)
        if (toolName === 'generate_chart' && formattedResult.generatedImage) {
          generatedImage = formattedResult.generatedImage;
          executedCode = formattedResult.executedCode;
          emitThinking(ctx, 'complete', '📊 Chart generated successfully!');
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
    
    // If we have a chart image already, we can skip the second API call to save tokens
    // Just use a simple completion to get the narrative text
    if (generatedImage && ctx.blockType === 'LLM_CHART') {
      console.log(`[EvidenceAgent] Chart image already generated, using minimal completion for narrative`);
      // Use a much shorter prompt for the narrative
      const narrativePrompt = `Write a brief narrative (2-3 sentences) describing the chart that was just generated for "${sectionTitle}". 
The chart has been successfully created. Just describe what it shows.`;
      
      response = await ctx.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a documentation assistant. Write concise descriptions of data visualizations.' },
          { role: 'user', content: narrativePrompt },
        ],
        temperature: 0.3,
        max_tokens: 300, // Much shorter for chart descriptions
      });
    } else {
      // For non-chart blocks or when no image yet, continue with full conversation
      // But truncate messages if they're too long
      const truncatedMessages = truncateMessagesForContext(messages, systemPrompt);
      
      response = await ctx.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: truncatedMessages,
        temperature: 0.3,
        max_tokens: 2000,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: 'auto',
      });
    }
  }
  
  // Get final content
  content = response.choices[0]?.message?.content || '';
  
  // For chart blocks, if no image was generated via tools, try to extract Python code from content
  if (ctx.blockType === 'LLM_CHART' && !generatedImage && content) {
    console.log(`[EvidenceAgent] ⚠️ Chart block "${sectionTitle}" did not generate image via tools. Attempting fallback extraction...`);
    const pythonCodeMatch = content.match(/```python\s*([\s\S]*?)```/);
    if (pythonCodeMatch) {
      const pythonCode = pythonCodeMatch[1].trim();
      console.log(`[EvidenceAgent] Found Python code block (${pythonCode.length} chars), executing...`);
      try {
        const { generateChart, isSandboxAvailable } = await import('./sandbox-client');
        const sandboxAvailable = await isSandboxAvailable();
        if (!sandboxAvailable) {
          console.error(`[EvidenceAgent] ❌ Sandbox not available - cannot execute chart code for "${sectionTitle}"`);
          // Add a visible warning to the content
          content = `⚠️ **Chart Generation Unavailable**: The Python sandbox service is not running. To generate charts:\n\n1. Run \`docker-compose up sandbox-python -d\` OR\n2. Run \`cd services/sandbox-python && pip install -r requirements.txt && python main.py\`\n\n---\n\n**Chart Code (not executed):**\n\n\`\`\`python\n${pythonCode}\n\`\`\`\n\n---\n\n${content}`;
        } else {
          const chartResult = await generateChart(pythonCode);
          if (chartResult.success && chartResult.imageBase64) {
            generatedImage = {
              base64: chartResult.imageBase64,
              mimeType: chartResult.imageMimeType || 'image/png',
            };
            executedCode = pythonCode;
            console.log(`[EvidenceAgent] ✅ Chart generated successfully via fallback for "${sectionTitle}"`);
          } else {
            console.warn(`[EvidenceAgent] ⚠️ Chart generation failed:`, chartResult.error);
            // Add error to content
            content = `⚠️ **Chart Generation Failed**: ${chartResult.error || 'Unknown error'}\n\n**Chart Code:**\n\n\`\`\`python\n${pythonCode}\n\`\`\`\n\n---\n\n${content}`;
          }
        }
      } catch (error) {
        console.error(`[EvidenceAgent] ❌ Error executing chart code:`, error);
        content = `⚠️ **Chart Execution Error**: ${error instanceof Error ? error.message : 'Unknown error'}\n\n---\n\n${content}`;
      }
    } else {
      console.warn(`[EvidenceAgent] ⚠️ No Python code block found in chart response for "${sectionTitle}". Content preview: ${content.substring(0, 200)}...`);
      // LLM didn't generate code at all
      if (!hasChartTool) {
        content = `⚠️ **Chart Generation Unavailable**: The Python sandbox service is not running. Start it with:\n\n\`docker-compose up sandbox-python -d\`\n\n---\n\n${content}`;
      }
    }
  }
  
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
  
  return {
    content,
    citations,
    citationDetails,
    evidenceBundle,
    claimEvidenceMap,
    confidence,
    qualityMetrics,
    gaps,
    generatedImage,
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

