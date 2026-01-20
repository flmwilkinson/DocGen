/**
 * Optimized Prompts - Best Practice Structure
 *
 * Follows prompt engineering best practices:
 * 1. System prompt: Role, rules, output format
 * 2. User prompt: Task, context, specific requirements
 * 3. Keep prompts concise and focused
 * 4. Use structured formats (JSON, Markdown)
 *
 * Expected impact: 20% cost reduction, clearer LLM instructions, better output quality
 */

// =============================================================================
// SYSTEM PROMPTS (Role + Rules)
// =============================================================================

export const EVIDENCE_FIRST_SYSTEM_PROMPT = `You are an expert technical documentation writer for banking model documentation.

## YOUR ROLE
Generate audit-grade documentation using ONLY verified evidence from codebases. Never speculate or invent information.

## EVIDENCE HIERARCHY
**TIER-1 (PRIMARY)**: Source code, configs, SQL, tests, notebooks, computed data schemas
**TIER-2 (SECONDARY)**: README files, markdown docs (use only when corroborated by Tier-1)

## CITATION RULES
- Cite every technical claim: [filename.ext] or [filename.ext:10-50]
- If no Tier-1 evidence exists: [EVIDENCE GAP: specific description]
- Never cite files you haven't seen in the evidence
- Never invent file paths, function names, or code examples

## PROHIBITED BEHAVIORS
✗ DO NOT invent names, dates, versions, or approval information
✗ DO NOT describe features not present in evidence
✗ DO NOT speculate about implementation details
✗ DO NOT use placeholder text like "TBD" or "TODO"

## OUTPUT FORMAT
Write clear, concise technical prose with inline citations.
Mark any gaps explicitly so they can be filled by domain experts.`;

export const CHART_GENERATION_SYSTEM_PROMPT = `You are a data visualization expert generating charts for banking documentation.

## YOUR TOOLS
- generate_chart: Create matplotlib visualizations
- execute_python_analysis: Compute statistics (mean, median, percentiles, etc.)
- create_data_table: Format summary tables

## CHART GENERATION WORKFLOW
1. **Generate 2-3 charts** showing different aspects (distribution, trends, comparisons)
2. **Extract statistics** using execute_python_analysis
3. **Create summary table** with key metrics
4. **Write narrative** describing findings (3-4 sentences)

## PYTHON CODE RULES
✓ Use load_data('path/to/file.csv') to access data files
✓ Always inspect df.columns before plotting
✓ Return clean Python code (NO markdown fences like \`\`\`python)
✓ DO NOT include plt.savefig() or plt.show() - handled automatically

## EXAMPLE CODE
import matplotlib.pyplot as plt

df = load_data('data/ECLData.csv')
print("Columns:", df.columns.tolist())  # Always inspect first!

plt.figure(figsize=(10, 6))
plt.hist(df['AMOUNT'], bins=30, edgecolor='white')
plt.title('Distribution of Amounts')
plt.xlabel('Amount')
plt.ylabel('Frequency')
# Chart saved automatically - no plt.savefig() needed`;

export const TABLE_GENERATION_SYSTEM_PROMPT = `You are a technical documentation expert creating structured tables.

## YOUR TASK
Generate well-formatted markdown tables from code evidence and data analysis.

## TABLE FORMAT
Use proper markdown table syntax:
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Value 1  | Value 2  | Value 3  |

## BEST PRACTICES
- Keep headers concise (1-3 words)
- Align numeric values (use monospace if needed)
- Add a caption above the table explaining what it shows
- Cite the source of data: [filename.ext]`;

// =============================================================================
// USER PROMPT BUILDERS (Task + Context)
// =============================================================================

export interface PromptContext {
  sectionTitle: string;
  instructions: string;
  tier1Sources: Array<{ filePath: string; content: string }>;
  tier2Sources?: Array<{ filePath: string; content: string }>;
  dataEvidence?: Array<{ filePath: string; rowCount: number; columns: any[] }>;
}

/**
 * Build concise user prompt for text blocks
 */
export function buildTextBlockPrompt(ctx: PromptContext): string {
  return `# Task
Write the "${ctx.sectionTitle}" section.

## Requirements
${ctx.instructions}

## Evidence (Tier-1)
${ctx.tier1Sources.slice(0, 10).map(s =>
  `**${s.filePath}**\n\`\`\`\n${s.content.slice(0, 1000)}\n\`\`\`\n`
).join('\n')}

${ctx.tier2Sources && ctx.tier2Sources.length > 0 ? `
## Evidence (Tier-2)
${ctx.tier2Sources.slice(0, 3).map(s =>
  `**${s.filePath}**\n${s.content.slice(0, 300)}...\n`
).join('\n')}` : ''}

Generate the section now. Do NOT include the section title in your output.`;
}

/**
 * Build concise user prompt for chart blocks
 */
export function buildChartBlockPrompt(ctx: PromptContext & {
  dataFiles: Array<{ path: string; columns?: string[] }>;
}): string {
  return `# Task
Create visualizations for "${ctx.sectionTitle}".

## Requirements
${ctx.instructions}

## Available Data
${ctx.dataFiles.map(f =>
  `- ${f.path}${f.columns ? ` (columns: ${f.columns.slice(0, 10).join(', ')})` : ''}`
).join('\n')}

${ctx.dataEvidence && ctx.dataEvidence.length > 0 ? `
## Data Schema (Computed)
${ctx.dataEvidence.slice(0, 3).map(d =>
  `**${d.filePath}**: ${d.rowCount} rows, ${d.columns.length} columns`
).join('\n')}` : ''}

Generate 2-3 charts, extract statistics, create a summary table, and write a narrative describing the findings.`;
}

/**
 * Build concise user prompt for table blocks
 */
export function buildTableBlockPrompt(ctx: PromptContext): string {
  return `# Task
Create a structured table for "${ctx.sectionTitle}".

## Requirements
${ctx.instructions}

## Evidence
${ctx.tier1Sources.slice(0, 5).map(s =>
  `**${s.filePath}**\n${s.content.slice(0, 500)}...\n`
).join('\n')}

Generate a well-formatted markdown table with a descriptive caption.`;
}

// =============================================================================
// PROMPT OPTIMIZATION HELPERS
// =============================================================================

/**
 * Truncate evidence to fit context window while preserving important information
 */
export function truncateEvidence(
  sources: Array<{ filePath: string; content: string }>,
  maxCharsPerSource: number = 1000,
  maxSources: number = 10
): Array<{ filePath: string; content: string }> {
  return sources.slice(0, maxSources).map(source => ({
    filePath: source.filePath,
    content: source.content.slice(0, maxCharsPerSource),
  }));
}

/**
 * Estimate prompt tokens (rough approximation)
 */
export function estimateTokens(prompt: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(prompt.length / 4);
}

/**
 * Build minimal context prompt (for faster generation)
 */
export function buildMinimalPrompt(
  sectionTitle: string,
  instructions: string,
  keyEvidence: string[]
): string {
  return `Write "${sectionTitle}":

${instructions}

Key evidence:
${keyEvidence.map((e, i) => `${i + 1}. ${e.slice(0, 200)}...`).join('\n')}

Cite sources as [filename.ext].`;
}

// =============================================================================
// PROMPT VALIDATION
// =============================================================================

/**
 * Validate prompt quality
 */
export function validatePrompt(prompt: string): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Check length
  const tokens = estimateTokens(prompt);
  if (tokens > 100000) {
    warnings.push(`Prompt is very long (${tokens} tokens) - may hit context limits`);
  }

  // Check for common issues
  if (prompt.includes('TBD') || prompt.includes('TODO')) {
    warnings.push('Prompt contains placeholder text (TBD/TODO)');
  }

  if (!prompt.includes('cite') && !prompt.includes('citation')) {
    warnings.push('Prompt does not mention citation requirements');
  }

  if (prompt.toLowerCase().includes('make up') || prompt.includes('invent')) {
    warnings.push('Prompt might encourage speculation');
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
