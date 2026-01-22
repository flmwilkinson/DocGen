/**
 * LLM Tools Registry
 * 
 * Defines all tools available to the LLM agent for autonomous use.
 * Tools allow the LLM to execute code, generate charts, search code, etc.
 */

import OpenAI from 'openai';
import { generateChart, executeAnalysis, isSandboxAvailable } from './sandbox-client';

// Types for tool definitions
export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  // For chart tools
  imageBase64?: string; // First chart for backward compatibility
  imageMimeType?: string;
  chartImages?: Array<{ base64: string; mimeType: string; filename: string }>; // All charts
  // For code execution
  executedCode?: string;
  stdout?: string;
}

export interface ToolContext {
  projectName: string;
  repoUrl?: string;
  codebaseFiles?: string[];
  currentSection?: string;
  /** Data files available for chart generation - content may be fetched or URL provided */
  dataFiles?: Array<{ path: string; content?: string; url?: string }>;
}

// Tool definitions for OpenAI
export const AVAILABLE_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'generate_chart',
      description: `Generate a matplotlib chart or visualization. Use this when:
- Data would be clearer as a visual
- Comparing metrics or values
- Showing trends, distributions, or relationships
- The user/template asks for a chart or graph

The chart will be rendered with a dark theme matching the application.`,
      parameters: {
        type: 'object',
        properties: {
          python_code: {
            type: 'string',
            description: `Complete Python code to generate the chart using matplotlib/seaborn.
Available imports: matplotlib.pyplot as plt, numpy as np, seaborn as sns, pandas as pd.
Do NOT include plt.show() - the chart is automatically saved.

CRITICAL: Handle data issues to avoid errors:
- Use .dropna() before plotting to remove NaN values
- Use .select_dtypes(include=[np.number]) for numeric-only operations
- For correlation: df.select_dtypes(include=[np.number]).corr()
- For boxplots: only use numeric columns
- Check dtypes and convert with pd.to_numeric(col, errors='coerce') if needed

Example:
df = pd.read_csv('data/file.csv')
numeric_df = df.select_dtypes(include=[np.number]).dropna()
plt.figure(figsize=(10, 6))
plt.bar(numeric_df.columns[:3], numeric_df.iloc[0, :3])
plt.title('My Chart')`,
          },
          description: {
            type: 'string',
            description: 'Brief description of what the chart shows (1-2 sentences)',
          },
        },
        required: ['python_code', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute_python_analysis',
      description: `Execute Python code to perform data analysis or calculations. Use this when:
- Computing statistics from chart data (mean, median, min, max, percentiles, std dev)
- Extracting key facts and metrics from visualizations
- Performing statistical analysis on datasets
- Calculating correlation coefficients or other relationships
- Processing or transforming data for further analysis

**CRITICAL for chart blocks**: After generating charts, use this tool to extract statistics from the same data to create summary tables and write better documentation.

Returns the stdout output and any structured results.`,
      parameters: {
        type: 'object',
        properties: {
          python_code: {
            type: 'string',
            description: `Python code to execute. Available imports: pandas, numpy, scipy, json.
To return structured data, assign it to _result variable:
_result = {"metric": value, "data": [...]}`,
          },
          purpose: {
            type: 'string',
            description: 'What this analysis will compute or determine',
          },
        },
        required: ['python_code', 'purpose'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_data_table',
      description: `Create a formatted data table. Use this when:
- Presenting summary statistics from chart analysis (mean, median, percentiles, etc.)
- Showing key findings in tabular format
- Creating summary tables that complement visualizations
- Displaying structured data that benefits from tabular format

**For chart blocks**: After generating charts and computing statistics, create summary tables to document key findings.`,
      parameters: {
        type: 'object',
        properties: {
          headers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Column headers for the table',
          },
          rows: {
            type: 'array',
            items: {
              type: 'array',
              items: { type: 'string' },
            },
            description: '2D array of row data',
          },
          caption: {
            type: 'string',
            description: 'Optional table caption',
          },
        },
        required: ['headers', 'rows'],
      },
    },
  },
];

/**
 * Execute a tool call from the LLM
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  console.log(`[LLM Tools] Executing tool: ${toolName}`, args);

  switch (toolName) {
    case 'generate_chart':
      return await executeGenerateChart(
        args.python_code as string,
        args.description as string,
        context.dataFiles
      );

    case 'execute_python_analysis':
      return await executePythonAnalysis(
        args.python_code as string,
        args.purpose as string
      );

    case 'create_data_table':
      return executeCreateTable(
        args.headers as string[],
        args.rows as string[][],
        args.caption as string | undefined
      );

    default:
      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
      };
  }
}

/**
 * Generate a chart using Python
 */
async function executeGenerateChart(
  pythonCode: string,
  description: string,
  dataFiles?: Array<{ path: string; content?: string; url?: string; encoding?: 'base64' }>
): Promise<ToolResult> {
  const sandboxAvailable = await isSandboxAvailable();
  
  if (!sandboxAvailable) {
    console.log('[LLM Tools] Sandbox not available, returning code description only');
    return {
      success: true,
      result: {
        description,
        note: 'Chart code generated but sandbox not available for execution',
      },
      executedCode: pythonCode,
    };
  }

  try {
    console.log(`[LLM Tools] Generating chart with ${pythonCode.length} chars of code`);
    if (dataFiles && dataFiles.length > 0) {
      console.log(`[LLM Tools] 📂 Transferring ${dataFiles.length} data files to sandbox`);
    }
    
    const result = await generateChart(pythonCode, {
      dataFiles: dataFiles,
    });
    
    if (result.success && result.imageBase64) {
      const chartCount = result.chartImages?.length || 1;
      console.log(`[LLM Tools] ✅ Chart generated successfully! ${chartCount} chart(s), Image size: ${result.imageBase64.length} chars`);
      
      // Include execution outputs (stdout, stderr) so LLM can see data analysis results
      // This allows LLM to see summary statistics, headers, etc. from the sandbox
      const executionOutputs: any = {};
      if (result.stdout) executionOutputs.stdout = result.stdout;
      if (result.stderr) executionOutputs.stderr = result.stderr;
      if (result.structuredResult) executionOutputs.structuredResult = result.structuredResult;
      if (chartCount > 1) executionOutputs.chartCount = chartCount;
      
      return {
        success: true,
        result: { 
          description,
          ...executionOutputs, // Include execution outputs
        },
        imageBase64: result.imageBase64, // First chart for backward compatibility
        imageMimeType: result.imageMimeType,
        chartImages: result.chartImages, // All charts
        executedCode: pythonCode,
      };
    } else {
      console.warn(`[LLM Tools] ⚠️ Chart generation failed:`, result.error);
      // Log stdout/stderr for debugging - this shows what data was loaded
      if (result.stdout) {
        console.log(`[LLM Tools] 📋 Sandbox stdout:\n${result.stdout}`);
      }
      if (result.stderr) {
        console.log(`[LLM Tools] 📋 Sandbox stderr:\n${result.stderr}`);
      }
      return {
        success: false,
        error: result.error || 'Chart generation failed',
        executedCode: pythonCode,
        stdout: result.stdout, // Include for debugging
      };
    }
  } catch (error) {
    console.error(`[LLM Tools] ❌ Chart generation error:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executedCode: pythonCode,
    };
  }
}

/**
 * Execute Python analysis code
 */
async function executePythonAnalysis(
  pythonCode: string,
  purpose: string
): Promise<ToolResult> {
  const sandboxAvailable = await isSandboxAvailable();
  
  if (!sandboxAvailable) {
    return {
      success: false,
      error: 'Python sandbox not available',
      executedCode: pythonCode,
    };
  }

  try {
    const result = await executeAnalysis(pythonCode);
    
    return {
      success: result.success,
      result: result.result,
      error: result.error,
      executedCode: pythonCode,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executedCode: pythonCode,
    };
  }
}

/**
 * Create a markdown table (no execution needed)
 */
function executeCreateTable(
  headers: string[],
  rows: string[][],
  caption?: string
): ToolResult {
  // Build markdown table
  const headerRow = `| ${headers.join(' | ')} |`;
  const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
  const dataRows = rows.map(row => `| ${row.join(' | ')} |`).join('\n');
  
  const table = [headerRow, separatorRow, dataRows].join('\n');
  const fullTable = caption ? `**${caption}**\n\n${table}` : table;

  return {
    success: true,
    result: {
      markdown: fullTable,
      headers,
      rowCount: rows.length,
    },
  };
}

/**
 * Format tool results for inclusion in the document
 */
export function formatToolResultForDocument(
  toolName: string,
  result: ToolResult
): {
  content: string;
  generatedImage?: { base64: string; mimeType: string };
  generatedImages?: Array<{ base64: string; mimeType: string; filename?: string; description?: string }>;
  executedCode?: string;
} {
  if (!result.success) {
    return {
      content: `*Tool execution failed: ${result.error}*`,
    };
  }

  switch (toolName) {
    case 'generate_chart':
      // Support multiple charts - return first for backward compatibility, but also include all
      const chartImages = result.chartImages || (result.imageBase64 ? [{
        base64: result.imageBase64,
        mimeType: result.imageMimeType || 'image/png',
        filename: 'chart.png',
      }] : []);
      
      return {
        content: (result.result as { description?: string })?.description || 
                (chartImages.length > 1 ? `${chartImages.length} charts generated.` : 'Chart generated.'),
        generatedImage: chartImages.length > 0
          ? { base64: chartImages[0].base64, mimeType: chartImages[0].mimeType }
          : undefined,
        generatedImages: chartImages, // All charts
        executedCode: result.executedCode,
      };

    case 'execute_python_analysis':
      const analysisResult = result.result as Record<string, unknown>;
      let content = '';
      if (analysisResult?.output) {
        content = `\`\`\`\n${analysisResult.output}\n\`\`\``;
      } else if (analysisResult) {
        content = `Analysis results:\n\`\`\`json\n${JSON.stringify(analysisResult, null, 2)}\n\`\`\``;
      }
      return {
        content,
        executedCode: result.executedCode,
      };

    case 'create_data_table':
      return {
        content: (result.result as { markdown?: string })?.markdown || '',
      };

    default:
      return {
        content: JSON.stringify(result.result),
      };
  }
}

/**
 * Check which tools are available (sandbox running, etc.)
 */
export async function getAvailableTools(): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
  const sandboxAvailable = await isSandboxAvailable();
  
  if (sandboxAvailable) {
    // All tools available
    console.log(`[LLM Tools] ✅ Sandbox available - offering ${AVAILABLE_TOOLS.length} tools:`, AVAILABLE_TOOLS.map(t => t.function.name));
    return AVAILABLE_TOOLS;
  } else {
    // Only non-sandbox tools
    const limitedTools = AVAILABLE_TOOLS.filter(
      tool => tool.function.name === 'create_data_table'
    );
    console.warn(`[LLM Tools] ⚠️ Sandbox NOT available - only offering ${limitedTools.length} tools (no chart generation)`);
    return limitedTools;
  }
}

