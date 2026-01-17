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
  imageBase64?: string;
  imageMimeType?: string;
  // For code execution
  executedCode?: string;
  stdout?: string;
}

export interface ToolContext {
  projectName: string;
  repoUrl?: string;
  codebaseFiles?: string[];
  currentSection?: string;
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
Example:
plt.figure(figsize=(10, 6))
plt.bar(['A', 'B', 'C'], [10, 20, 15])
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
- Complex calculations are needed
- Data needs to be processed or transformed
- Statistical analysis is required
- You need to compute metrics or statistics

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
      description: `Create a formatted data table. Use this when presenting structured data that benefits from tabular format.`,
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
        args.description as string
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
  description: string
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
    const result = await generateChart(pythonCode);
    
    if (result.success && result.imageBase64) {
      return {
        success: true,
        result: { description },
        imageBase64: result.imageBase64,
        imageMimeType: result.imageMimeType,
        executedCode: pythonCode,
      };
    } else {
      return {
        success: false,
        error: result.error || 'Chart generation failed',
        executedCode: pythonCode,
      };
    }
  } catch (error) {
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
  executedCode?: string;
} {
  if (!result.success) {
    return {
      content: `*Tool execution failed: ${result.error}*`,
    };
  }

  switch (toolName) {
    case 'generate_chart':
      return {
        content: (result.result as { description?: string })?.description || 'Chart generated.',
        generatedImage: result.imageBase64
          ? { base64: result.imageBase64, mimeType: result.imageMimeType || 'image/png' }
          : undefined,
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
    return AVAILABLE_TOOLS;
  } else {
    // Only non-sandbox tools
    return AVAILABLE_TOOLS.filter(
      tool => tool.function.name === 'create_data_table'
    );
  }
}

