/**
 * ReAct Agent for Chart Generation and Analysis
 * 
 * Implements a proper ReAct workflow for chart blocks:
 * 1. ANALYZE - Inspect data files, understand structure, identify key variables
 * 2. PLAN - Create a plan for which charts/analyses to generate
 * 3. EXECUTE - Generate charts and run statistical analysis
 * 4. PARSE - Extract key facts and statistics from analysis outputs
 * 5. DOCUMENT - Write comprehensive documentation with charts, tables, and narrative
 */

import OpenAI from 'openai';
import {
  getAvailableTools,
  executeTool,
  formatToolResultForDocument,
  ToolContext,
} from './llm-tools';
import { EvidenceBundle } from './evidence-first';

// =============================================================================
// TYPES
// =============================================================================

export interface ChartAgentContext {
  openai: OpenAI;
  projectName: string;
  repoUrl?: string;
  evidenceBundle: EvidenceBundle;
  allFiles: Array<{ path: string; content: string }>;
  dataFiles: Array<{ path: string; content?: string; url?: string }>;
  onThinking?: (step: { type: string; message: string; details?: string }) => void;
}

export interface ChartPlan {
  charts: Array<{
    title: string;
    type: 'histogram' | 'line' | 'scatter' | 'bar' | 'box' | 'heatmap' | 'correlation';
    dataFile: string;
    variables: string[];
    purpose: string;
  }>;
  analyses: Array<{
    purpose: string;
    dataFile: string;
    metrics: string[];
  }>;
  tables: Array<{
    title: string;
    purpose: string;
  }>;
}

export interface ChartAgentResult {
  content: string;
  generatedImages: Array<{ base64: string; mimeType: string; description: string }>;
  executedCode?: string;
  analysisResults?: Record<string, unknown>;
  tables?: Array<{ headers: string[]; rows: string[][]; caption?: string }>;
}

// =============================================================================
// REACT WORKFLOW
// =============================================================================

/**
 * STEP 1: ANALYZE - Inspect data files and understand structure
 */
async function analyze(
  ctx: ChartAgentContext
): Promise<{ dataSummary: string; availableVariables: Record<string, string[]> }> {
  ctx.onThinking?.({ type: 'think', message: 'Analyzing data files...', details: 'Inspecting file structure and variables' });
  
  const availableVariables: Record<string, string[]> = {};
  let dataSummary = '## DATA ANALYSIS\n\n';
  
  // Use data evidence from evidence bundle if available
  if (ctx.evidenceBundle.dataEvidence.length > 0) {
    for (const dataEv of ctx.evidenceBundle.dataEvidence) {
      const columns = dataEv.columns.map(col => col.name);
      availableVariables[dataEv.filePath] = columns;
      dataSummary += `### ${dataEv.filePath}\n`;
      dataSummary += `- Rows: ${dataEv.rowCount}\n`;
      dataSummary += `- Columns (${columns.length}): ${columns.slice(0, 10).join(', ')}${columns.length > 10 ? '...' : ''}\n`;
      dataSummary += `- Key metrics: ${dataEv.columns.filter(col => 
        ['amount', 'value', 'price', 'rate', 'score', 'count', 'total'].some(k => col.name.toLowerCase().includes(k))
      ).map(col => col.name).slice(0, 5).join(', ')}\n\n`;
    }
  } else {
    // Fallback: analyze from file content
    for (const file of ctx.dataFiles) {
      if (file.path.endsWith('.csv')) {
        const lines = file.content?.split('\n').slice(0, 2) || [];
        if (lines.length > 0) {
          const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
          availableVariables[file.path] = headers;
          dataSummary += `### ${file.path}\n`;
          dataSummary += `- Columns: ${headers.slice(0, 10).join(', ')}${headers.length > 10 ? '...' : ''}\n\n`;
        }
      }
    }
  }
  
  return { dataSummary, availableVariables };
}

/**
 * STEP 2: PLAN - Create a plan for charts and analyses
 */
async function createPlan(
  ctx: ChartAgentContext,
  sectionTitle: string,
  sectionInstructions: string,
  dataSummary: string,
  availableVariables: Record<string, string[]>
): Promise<ChartPlan> {
  ctx.onThinking?.({ type: 'think', message: 'Creating analysis plan...', details: 'Determining which charts and analyses to generate' });
  
  const systemPrompt = `You are a data analysis expert. Your task is to create a comprehensive plan for visualizing and analyzing data.

## AVAILABLE DATA
${dataSummary}

## TASK
${sectionInstructions}

## YOUR JOB
Create a plan for:
1. Which charts to generate (3-6 visualizations showing different aspects)
2. Which statistical analyses to run (mean, median, distributions, correlations, etc.)
3. Which summary tables to create (key statistics, findings)

Return a JSON object with this structure:
{
  "charts": [
    {
      "title": "Chart title",
      "type": "histogram|line|scatter|bar|box|heatmap|correlation",
      "dataFile": "path/to/file.csv",
      "variables": ["var1", "var2"],
      "purpose": "What this chart will show"
    }
  ],
  "analyses": [
    {
      "purpose": "Compute summary statistics",
      "dataFile": "path/to/file.csv",
      "metrics": ["mean", "median", "std", "percentiles"]
    }
  ],
  "tables": [
    {
      "title": "Summary Statistics",
      "purpose": "Present key findings"
    }
  ]
}`;

  const response = await ctx.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Create a comprehensive analysis plan for: ${sectionTitle}` },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  try {
    const plan = JSON.parse(response.choices[0]?.message?.content || '{}') as ChartPlan;
    console.log(`[ChartAgent] Plan created: ${plan.charts?.length || 0} charts, ${plan.analyses?.length || 0} analyses, ${plan.tables?.length || 0} tables`);
    return plan;
  } catch (error) {
    console.error('[ChartAgent] Failed to parse plan, using default', error);
    // Default plan: generate a few basic charts
    return {
      charts: Object.keys(availableVariables).slice(0, 3).map((filePath, idx) => ({
        title: `Chart ${idx + 1}`,
        type: 'histogram' as const,
        dataFile: filePath,
        variables: availableVariables[filePath].slice(0, 1),
        purpose: 'Explore data distribution',
      })),
      analyses: [],
      tables: [],
    };
  }
}

/**
 * STEP 3: EXECUTE - Generate charts and run analyses
 */
async function execute(
  ctx: ChartAgentContext,
  plan: ChartPlan
): Promise<{
  charts: Array<{ base64: string; mimeType: string; description: string; code: string }>;
  analyses: Array<{ result: Record<string, unknown>; stdout: string }>;
}> {
  ctx.onThinking?.({ type: 'tool', message: 'Executing plan...', details: `Generating ${plan.charts.length} charts and ${plan.analyses.length} analyses` });
  
  const generatedCharts: Array<{ base64: string; mimeType: string; description: string; code: string }> = [];
  const analysisResults: Array<{ result: Record<string, unknown>; stdout: string }> = [];
  
  const toolContext: ToolContext = {
    projectName: ctx.projectName,
    repoUrl: ctx.repoUrl,
    dataFiles: ctx.dataFiles,
  };
  
  // Execute charts
  for (const chartPlan of plan.charts || []) {
    try {
      ctx.onThinking?.({ type: 'tool', message: `Generating chart: ${chartPlan.title}`, details: chartPlan.purpose });
      
      // Generate Python code for the chart
      const chartCodePrompt = `Generate Python matplotlib code to create a ${chartPlan.type} chart.

Requirements:
- Chart title: "${chartPlan.title}"
- Data file: ${chartPlan.dataFile}
- Variables to plot: ${chartPlan.variables.join(', ')}
- Purpose: ${chartPlan.purpose}

**CRITICAL**: Use the load_data() helper function to load the file. The helper is already available in the sandbox.

Example:
\`\`\`python
import matplotlib.pyplot as plt
import pandas as pd

# Load data using the helper function
df = load_data('${chartPlan.dataFile}')

# Inspect columns first
print("Columns:", df.columns.tolist())
print("Shape:", df.shape)

# Create ${chartPlan.type} chart
plt.figure(figsize=(10, 6))
# ... your plotting code here using df['${chartPlan.variables[0] || 'column'}'] ...
plt.title('${chartPlan.title}')
plt.tight_layout()
\`\`\`

Return ONLY the Python code, no explanations. Make sure to use the EXACT column names from df.columns.`;

      const codeResponse = await ctx.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a Python data visualization expert. Generate clean, working matplotlib code.' },
          { role: 'user', content: chartCodePrompt },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });

      const pythonCode = codeResponse.choices[0]?.message?.content?.trim() || '';
      
      if (pythonCode) {
        // Execute the chart
        const toolResult = await executeTool('generate_chart', {
          python_code: pythonCode,
          description: chartPlan.title,
        }, toolContext);
        
        const formattedResult = formatToolResultForDocument('generate_chart', toolResult);
        
        if (formattedResult.generatedImage) {
          const charts = formattedResult.generatedImages || [formattedResult.generatedImage];
          charts.forEach((img, idx) => {
            generatedCharts.push({
              base64: img.base64,
              mimeType: img.mimeType,
              description: idx === 0 ? chartPlan.title : `${chartPlan.title} (${idx + 1})`,
              code: pythonCode,
            });
          });
          ctx.onThinking?.({ type: 'complete', message: `✅ Chart generated: ${chartPlan.title}` });
        }
      }
    } catch (error) {
      console.error(`[ChartAgent] Failed to generate chart "${chartPlan.title}":`, error);
    }
  }
  
  // Execute analyses
  for (const analysisPlan of plan.analyses || []) {
    try {
      ctx.onThinking?.({ type: 'tool', message: `Running analysis: ${analysisPlan.purpose}`, details: analysisPlan.metrics.join(', ') });
      
      // Generate Python code for analysis
      const analysisCodePrompt = `Generate Python code to compute ${analysisPlan.purpose}.

Requirements:
- Data file: ${analysisPlan.dataFile}
- Metrics to compute: ${analysisPlan.metrics.join(', ')}
- Store results in _result variable as a dictionary

Use the load_data() helper function:
df = load_data('${analysisPlan.dataFile}')

Return ONLY the Python code, no explanations.`;

      const codeResponse = await ctx.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a Python data analysis expert. Generate clean, working pandas/numpy code.' },
          { role: 'user', content: analysisCodePrompt },
        ],
        temperature: 0.3,
        max_tokens: 800,
      });

      const pythonCode = codeResponse.choices[0]?.message?.content?.trim() || '';
      
      if (pythonCode) {
        const toolResult = await executeTool('execute_python_analysis', {
          python_code: pythonCode,
          purpose: analysisPlan.purpose,
        }, toolContext);
        
        if (toolResult.success && toolResult.result) {
          const result = toolResult.result as any;
          analysisResults.push({
            result: result.structuredResult || result,
            stdout: result.stdout || '',
          });
          ctx.onThinking?.({ type: 'complete', message: `✅ Analysis complete: ${analysisPlan.purpose}` });
        }
      }
    } catch (error) {
      console.error(`[ChartAgent] Failed to run analysis "${analysisPlan.purpose}":`, error);
    }
  }
  
  return { charts: generatedCharts, analyses: analysisResults };
}

/**
 * STEP 4: PARSE - Extract key facts from analysis results
 */
function parse(
  analysisResults: Array<{ result: Record<string, unknown>; stdout: string }>
): { keyFacts: string; statistics: Record<string, unknown> } {
  const statistics: Record<string, unknown> = {};
  const keyFacts: string[] = [];
  
  for (const analysis of analysisResults) {
    if (analysis.result) {
      Object.assign(statistics, analysis.result);
      
      // Extract key facts
      for (const [key, value] of Object.entries(analysis.result)) {
        if (typeof value === 'number') {
          keyFacts.push(`${key}: ${value.toFixed(2)}`);
        } else if (typeof value === 'object' && value !== null) {
          keyFacts.push(`${key}: ${JSON.stringify(value)}`);
        }
      }
    }
    
    if (analysis.stdout) {
      // Extract numbers from stdout
      const numberMatches = analysis.stdout.match(/\d+\.?\d*/g);
      if (numberMatches) {
        keyFacts.push(...numberMatches.slice(0, 5));
      }
    }
  }
  
  return {
    keyFacts: keyFacts.join(', '),
    statistics,
  };
}

/**
 * STEP 5: DOCUMENT - Write comprehensive documentation
 */
async function document(
  ctx: ChartAgentContext,
  sectionTitle: string,
  sectionInstructions: string,
  plan: ChartPlan,
  charts: Array<{ base64: string; mimeType: string; description: string; code: string }>,
  analysisResults: Array<{ result: Record<string, unknown>; stdout: string }>,
  keyFacts: string,
  statistics: Record<string, unknown>
): Promise<{ content: string; tables: Array<{ headers: string[]; rows: string[][]; caption?: string }> }> {
  ctx.onThinking?.({ type: 'draft', message: 'Writing documentation...', details: 'Combining charts, analysis, and narrative' });
  
  // Create summary tables from statistics
  const tables: Array<{ headers: string[]; rows: string[][]; caption?: string }> = [];
  
  if (Object.keys(statistics).length > 0) {
    // Create a summary statistics table
    const statEntries = Object.entries(statistics);
    if (statEntries.length > 0) {
      const headers = ['Metric', 'Value'];
      const rows = statEntries.map(([key, value]) => [
        key,
        typeof value === 'number' ? value.toFixed(4) : String(value),
      ]);
      tables.push({
        headers,
        rows,
        caption: 'Summary Statistics',
      });
    }
  }
  
  // Generate narrative
  const chartDescriptions = charts.map((chart, idx) => 
    `Chart ${idx + 1}: ${chart.description}`
  ).join('\n');
  
  const analysisSummary = analysisResults.map((analysis, idx) => {
    const resultStr = JSON.stringify(analysis.result, null, 2).slice(0, 200);
    return `Analysis ${idx + 1}: ${resultStr}...`;
  }).join('\n');
  
  const narrativePrompt = `Write comprehensive documentation for "${sectionTitle}".

## REQUIREMENTS
${sectionInstructions}

## CHARTS GENERATED
${chartDescriptions}

## ANALYSIS RESULTS
${keyFacts ? `Key Facts: ${keyFacts}` : ''}
${analysisSummary ? `\n${analysisSummary}` : ''}

## YOUR TASK
Write 4-6 sentences that:
1. Describe what each chart shows
2. Reference the statistical findings
3. Explain key insights and patterns
4. Be specific about data sources and metrics

Include the charts and tables in your response naturally.`;

  const response = await ctx.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a documentation expert. Write clear, comprehensive documentation that references specific charts, statistics, and findings.' },
      { role: 'user', content: narrativePrompt },
    ],
    temperature: 0.3,
    max_tokens: 800,
  });
  
  let content = response.choices[0]?.message?.content || '';
  
  // Create tables using create_data_table tool if we have statistics
  if (tables.length > 0) {
    for (const table of tables) {
      try {
        const toolResult = await executeTool('create_data_table', {
          headers: table.headers,
          rows: table.rows,
          caption: table.caption,
        }, {
          projectName: ctx.projectName,
          repoUrl: ctx.repoUrl,
          dataFiles: ctx.dataFiles,
        });
        
        const formattedResult = formatToolResultForDocument('create_data_table', toolResult);
        if (formattedResult.content) {
          content += '\n\n' + formattedResult.content;
        }
      } catch (error) {
        console.error('[ChartAgent] Failed to create table:', error);
        // Fallback: add markdown table directly
        const tableMarkdown = `\n\n### ${table.caption || 'Summary Table'}\n\n| ${table.headers.join(' | ')} |\n| ${table.headers.map(() => '---').join(' | ')} |\n${table.rows.map(row => `| ${row.join(' | ')} |`).join('\n')}\n`;
        content += tableMarkdown;
      }
    }
  }
  
  return { content, tables };
}

/**
 * Main ReAct workflow for chart generation
 */
export async function generateChartWithReAct(
  ctx: ChartAgentContext,
  sectionTitle: string,
  sectionInstructions: string
): Promise<ChartAgentResult> {
  console.log(`[ChartAgent] Starting ReAct workflow for: ${sectionTitle}`);
  
  // STEP 1: ANALYZE
  const { dataSummary, availableVariables } = await analyze(ctx);
  
  // STEP 2: PLAN
  const plan = await createPlan(ctx, sectionTitle, sectionInstructions, dataSummary, availableVariables);
  
  // STEP 3: EXECUTE
  const { charts, analyses } = await execute(ctx, plan);
  
  // STEP 4: PARSE
  const { keyFacts, statistics } = parse(analyses);
  
  // STEP 5: DOCUMENT
  const { content, tables } = await document(ctx, sectionTitle, sectionInstructions, plan, charts, analyses, keyFacts, statistics);
  
  // Combine all executed code
  const allCode = charts.map(c => c.code).join('\n\n# ---\n\n');
  
  return {
    content,
    generatedImages: charts.map(c => ({
      base64: c.base64,
      mimeType: c.mimeType,
      description: c.description,
    })),
    executedCode: allCode || undefined,
    analysisResults: statistics,
    tables,
  };
}

