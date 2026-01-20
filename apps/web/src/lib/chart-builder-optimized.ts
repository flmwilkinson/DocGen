/**
 * Optimized Chart Builder - Consolidated LLM Calls
 *
 * Instead of making 10-15 LLM calls per chart block, this generates everything in ONE call:
 * 1. Analysis plan (what charts to create)
 * 2. Python code for ALL charts
 * 3. Python code for statistical analysis
 * 4. Narrative text
 *
 * Then executes all charts in PARALLEL for maximum speed.
 *
 * Expected impact: 70% latency reduction for chart blocks
 */

import OpenAI from 'openai';
import { executeTool, ToolContext } from './llm-tools';
import { DataSchemaEvidence, EvidenceBundle } from './evidence-first';

export interface OptimizedChartResult {
  content: string;
  generatedImages: Array<{ base64: string; mimeType: string; description: string }>;
  executedCode?: string;
  analysisResults?: Record<string, unknown>;
  tables?: Array<{ headers: string[]; rows: string[][]; caption?: string }>;
}

export interface ChartGenerationPlan {
  charts: Array<{
    pythonCode: string;
    description: string;
    chartType: string;
  }>;
  analysis?: {
    pythonCode: string;
    purpose: string;
  };
  summaryTable?: {
    headers: string[];
    rows: string[][];
    caption: string;
  };
  narrative: string;
}

/**
 * Generate charts, analysis, and documentation in ONE consolidated LLM call
 * This replaces the multi-step ReAct workflow for better performance
 */
export async function generateChartsOptimized(
  openai: OpenAI,
  sectionTitle: string,
  sectionInstructions: string,
  evidenceBundle: EvidenceBundle,
  dataFiles: Array<{ path: string; content?: string; url?: string }>,
  toolContext: ToolContext
): Promise<OptimizedChartResult> {
  console.log(`[ChartOptimized] Generating charts for: ${sectionTitle}`);

  // Build data context
  const dataSummary = buildDataSummary(evidenceBundle.dataEvidence, dataFiles);

  // SINGLE LLM CALL: Generate everything at once
  const plan = await generateChartPlan(openai, sectionTitle, sectionInstructions, dataSummary);

  console.log(`[ChartOptimized] Plan: ${plan.charts.length} charts, ${plan.analysis ? '1 analysis' : 'no analysis'}, ${plan.summaryTable ? '1 table' : 'no table'}`);

  // Execute all charts in PARALLEL
  const chartPromises = plan.charts.map((chart, idx) =>
    executeTool('generate_chart', {
      python_code: chart.pythonCode,
      description: chart.description,
    }, toolContext)
      .then(result => ({
        index: idx,
        result,
        description: chart.description,
        chartType: chart.chartType,
      }))
      .catch(error => ({
        index: idx,
        result: { success: false, error: error.message },
        description: chart.description,
        chartType: chart.chartType,
      }))
  );

  const chartResults = await Promise.all(chartPromises);

  // Extract successful charts
  const generatedImages: Array<{ base64: string; mimeType: string; description: string }> = [];
  let executedCode = '';

  for (const chartResult of chartResults) {
    if (chartResult.result.success) {
      const formatted = formatChartResult(chartResult.result);
      if (formatted.generatedImage) {
        generatedImages.push({
          base64: formatted.generatedImage.base64,
          mimeType: formatted.generatedImage.mimeType,
          description: chartResult.description,
        });
      }
      if (formatted.executedCode) {
        executedCode += `\n\n# Chart ${chartResult.index + 1}: ${chartResult.description}\n${formatted.executedCode}`;
      }
    } else {
      console.warn(`[ChartOptimized] Chart ${chartResult.index + 1} failed:`, chartResult.result.error);
    }
  }

  // Execute analysis if provided
  let analysisResults: Record<string, unknown> | undefined;
  if (plan.analysis) {
    try {
      const analysisResult = await executeTool('execute_python_analysis', {
        python_code: plan.analysis.pythonCode,
        purpose: plan.analysis.purpose,
      }, toolContext);

      if (analysisResult.success) {
        analysisResults = analysisResult.result as Record<string, unknown>;
      }
    } catch (error) {
      console.warn(`[ChartOptimized] Analysis failed:`, error);
    }
  }

  // Build final content with narrative + table
  let content = plan.narrative;

  if (plan.summaryTable) {
    const tableMarkdown = formatTableAsMarkdown(
      plan.summaryTable.headers,
      plan.summaryTable.rows,
      plan.summaryTable.caption
    );
    content += '\n\n' + tableMarkdown;
  }

  console.log(`[ChartOptimized] Complete: ${generatedImages.length} charts generated`);

  return {
    content,
    generatedImages,
    executedCode: executedCode || undefined,
    analysisResults,
    tables: plan.summaryTable ? [plan.summaryTable] : undefined,
  };
}

/**
 * Generate a comprehensive chart plan in ONE LLM call
 */
async function generateChartPlan(
  openai: OpenAI,
  sectionTitle: string,
  sectionInstructions: string,
  dataSummary: string
): Promise<ChartGenerationPlan> {
  const systemPrompt = `You are a data visualization expert. Generate a comprehensive plan for visualizing data.

Return a JSON object with:
{
  "charts": [
    {
      "pythonCode": "Complete Python code (NO markdown fences, NO plt.savefig, NO plt.show)",
      "description": "What this chart shows",
      "chartType": "histogram|scatter|line|bar|box|heatmap"
    }
  ],
  "analysis": {
    "pythonCode": "Code to compute statistics (mean, median, percentiles, etc.) - assign to _result variable",
    "purpose": "What this analysis computes"
  },
  "summaryTable": {
    "headers": ["Metric", "Value"],
    "rows": [["Mean", "123.45"], ["Median", "100.0"]],
    "caption": "Summary Statistics"
  },
  "narrative": "3-4 sentences describing the visualizations and key findings"
}

CRITICAL:
- Generate 2-3 charts showing different aspects
- Use load_data('filename') to access files
- NO markdown code fences (no \`\`\`python)
- NO plt.savefig() or plt.show()
- ALWAYS inspect df.columns before plotting`;

  const userPrompt = `Generate visualizations for "${sectionTitle}".

**Requirements:** ${sectionInstructions}

**Available Data:**
${dataSummary}

Create a comprehensive plan with charts, analysis, table, and narrative.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
  });

  const plan = JSON.parse(response.choices[0]?.message?.content || '{}');

  // Validate plan structure
  if (!plan.charts || !Array.isArray(plan.charts) || plan.charts.length === 0) {
    throw new Error('Invalid plan: missing charts array');
  }

  return plan as ChartGenerationPlan;
}

/**
 * Build data summary from evidence
 */
function buildDataSummary(
  dataEvidence: DataSchemaEvidence[],
  dataFiles: Array<{ path: string; content?: string; url?: string }>
): string {
  let summary = '';

  if (dataEvidence.length > 0) {
    summary += '## Data Schema Evidence (Computed)\n\n';
    for (const data of dataEvidence.slice(0, 5)) {
      summary += `### ${data.filePath}\n`;
      summary += `- Rows: ${data.rowCount}\n`;
      summary += `- Columns (${data.columns.length}): ${data.columns.map(c => c.name).slice(0, 10).join(', ')}\n`;
      summary += `- Key columns: ${data.columns.filter(c => ['amount', 'value', 'price', 'rate'].some(k => c.name.toLowerCase().includes(k))).map(c => c.name).slice(0, 5).join(', ')}\n\n`;
    }
  } else if (dataFiles.length > 0) {
    summary += '## Available Data Files\n\n';
    for (const file of dataFiles.slice(0, 5)) {
      summary += `- ${file.path}\n`;
    }
  }

  return summary;
}

/**
 * Format chart result (helper)
 */
function formatChartResult(result: any): {
  generatedImage?: { base64: string; mimeType: string };
  executedCode?: string;
} {
  return {
    generatedImage: result.imageBase64 ? {
      base64: result.imageBase64,
      mimeType: result.imageMimeType || 'image/png',
    } : undefined,
    executedCode: result.executedCode,
  };
}

/**
 * Format table as markdown
 */
function formatTableAsMarkdown(
  headers: string[],
  rows: string[][],
  caption?: string
): string {
  const headerRow = `| ${headers.join(' | ')} |`;
  const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
  const dataRows = rows.map(row => `| ${row.join(' | ')} |`).join('\n');

  const table = [headerRow, separatorRow, dataRows].join('\n');
  return caption ? `**${caption}**\n\n${table}` : table;
}
