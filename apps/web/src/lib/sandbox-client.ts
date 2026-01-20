/**
 * Python Sandbox Client
 * 
 * Communicates with the Python sandbox service to execute code,
 * generate charts, and perform data analysis.
 */

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  generatedFiles: GeneratedFile[];
  structuredResult?: Record<string, unknown>;
}

export interface GeneratedFile {
  filename: string;
  path: string;
  size: number;
  mimeType: string;
  base64Data?: string; // Will be populated after download
}

export interface ChartResult {
  success: boolean;
  imageBase64?: string; // First chart for backward compatibility
  imageMimeType?: string;
  chartImages?: Array<{ base64: string; mimeType: string; filename: string }>; // All charts
  error?: string;
  executionTimeMs: number;
  code: string;
  stdout?: string; // Execution output (summary stats, headers, etc.)
  stderr?: string; // Errors/warnings
  structuredResult?: Record<string, unknown>; // Structured results (schema info, etc.)
}

// Get sandbox URL from environment or use default
const SANDBOX_URL = process.env.NEXT_PUBLIC_SANDBOX_PYTHON_URL || 'http://localhost:8001';

export interface TransferredFile {
  path: string;
  fullPath: string;
  size: number;
}

export interface TransferFilesResult {
  executionId: string;
  dataDir: string;
  transferred: TransferredFile[];
  errors: Array<{ path: string; error: string }>;
}

/**
 * Transfer files to the sandbox for use in code execution.
 * Files can be provided as direct content or URLs to fetch.
 */
export async function transferFilesToSandbox(
  executionId: string,
  files: Array<{ path: string; content?: string; url?: string; encoding?: 'base64' }>
): Promise<TransferFilesResult> {
  try {
    console.log(`[Sandbox] Transferring ${files.length} files for execution ${executionId}`);
    
    const response = await fetch(`${SANDBOX_URL}/transfer-files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        execution_id: executionId,
        files: files.map(f => ({
          path: f.path,
          content: f.content,
          url: f.url,
          encoding: f.encoding,
        })),
      }),
      signal: AbortSignal.timeout(60000), // 60s timeout for large files
    });

    if (!response.ok) {
      throw new Error(`Transfer failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`[Sandbox] Transferred ${result.transferred?.length || 0} files, ${result.errors?.length || 0} errors`);
    
    if (result.errors?.length > 0) {
      console.warn(`[Sandbox] Transfer errors:`, result.errors);
    }
    
    return {
      executionId: result.execution_id,
      dataDir: result.data_dir,
      transferred: result.transferred || [],
      errors: result.errors || [],
    };
  } catch (error) {
    console.error(`[Sandbox] Transfer files failed:`, error);
    throw error;
  }
}

/**
 * Check if the sandbox service is available
 */
export async function isSandboxAvailable(): Promise<boolean> {
  try {
    console.log(`[Sandbox] Checking availability at ${SANDBOX_URL}/health`);
    const response = await fetch(`${SANDBOX_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    const available = response.ok;
    console.log(`[Sandbox] Available: ${available}`);
    return available;
  } catch (error) {
    console.warn(`[Sandbox] Not available:`, error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Execute Python code in the sandbox
 * @param executionId - Optional execution ID to use existing directory (for file transfers)
 */
export async function executeCode(
  code: string,
  timeoutSec: number = 60,
  executionId?: string
): Promise<ExecutionResult> {
  const response = await fetch(`${SANDBOX_URL}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      timeout_sec: timeoutSec,
      execution_id: executionId,
    }),
    signal: AbortSignal.timeout((timeoutSec + 10) * 1000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sandbox execution failed: ${error}`);
  }

  const result = await response.json();
  
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exit_code,
    executionTimeMs: result.execution_time_ms,
    generatedFiles: result.generated_files.map((f: Record<string, unknown>) => ({
      filename: f.filename as string,
      path: f.path as string,
      size: f.size as number,
      mimeType: f.mime_type as string,
    })),
    structuredResult: result.structured_result,
  };
}

/**
 * Download a generated file as base64
 */
export async function downloadFileAsBase64(
  executionId: string,
  filename: string
): Promise<string> {
  const response = await fetch(
    `${SANDBOX_URL}/download/${executionId}/${filename}`,
    { signal: AbortSignal.timeout(30000) }
  );

  if (!response.ok) {
    throw new Error(`Failed to download file: ${filename}`);
  }

  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // Remove data URL prefix if present
      const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Generate a chart using Python code execution
 * This is the main function used by the LLM agent
 * 
 * @param code - Python code to execute
 * @param context - Optional context including data files to transfer
 */
export async function generateChart(
  code: string,
  context?: {
    title?: string;
    dataDescription?: string;
    dataFiles?: Array<{ path: string; content?: string; url?: string; encoding?: 'base64' }>;
  }
): Promise<ChartResult> {
  const startTime = Date.now();

  // Generate execution ID for this chart
  const executionId = `chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Transfer data files if provided
  let dataDir = '';
  if (context?.dataFiles && context.dataFiles.length > 0) {
    try {
      console.log(`[Sandbox] Transferring ${context.dataFiles.length} data files for chart`);
      const transferResult = await transferFilesToSandbox(executionId, context.dataFiles);
      dataDir = transferResult.dataDir;
      console.log(`[Sandbox] Files available at: ${dataDir}`);
    } catch (error) {
      console.warn(`[Sandbox] File transfer failed:`, error);
      // Continue without files - code may use inline data
    }
  }

  // CRITICAL: Strip markdown code fences if present (LLM sometimes includes them)
  let cleanedCode = code.trim();

  // Remove markdown code fences: ```python ... ``` or ``` ... ```
  cleanedCode = cleanedCode.replace(/^```(?:python)?\s*\n/gm, '');
  cleanedCode = cleanedCode.replace(/\n```\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/^```(?:python)?\s*$/gm, ''); // Remove standalone fences
  cleanedCode = cleanedCode.replace(/```\s*$/gm, '');

  // Remove any plt.savefig() calls - we handle saving automatically
  cleanedCode = cleanedCode.replace(/plt\.savefig\([^)]+\)/g, '# plt.savefig removed - handled automatically');

  // Remove plt.show() calls
  cleanedCode = cleanedCode.replace(/plt\.show\(\)/g, '# plt.show removed');

  console.log(`[Sandbox] Original code length: ${code.length}, Cleaned: ${cleanedCode.length}`);
  if (code !== cleanedCode) {
    console.log(`[Sandbox] ✂️ Stripped markdown fences and plt.savefig/show calls`);
  }

  // Wrap the code to ensure proper chart saving
  const wrappedCode = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import os

# Data directory where transferred files are located
DATA_DIR = "${dataDir || '/tmp/sandbox/data'}"

# Helper function to load data files
def load_data(filename):
    """Load a data file from the DATA_DIR"""
    path = os.path.join(DATA_DIR, filename)
    
    # Debug: list available files
    if not os.path.exists(path):
        available_files = []
        for root, dirs, files in os.walk(DATA_DIR):
            for f in files:
                rel_path = os.path.relpath(os.path.join(root, f), DATA_DIR)
                available_files.append(rel_path)
        print(f"DEBUG: Looking for {filename} in {DATA_DIR}")
        print(f"DEBUG: Available files: {available_files[:10]}")  # Show first 10
    
    if os.path.exists(path):
        if filename.endswith('.csv'):
            return pd.read_csv(path)
        elif filename.endswith('.xlsx') or filename.endswith('.xls'):
            return pd.read_excel(path)
        elif filename.endswith('.json'):
            return pd.read_json(path)
        elif filename.endswith('.parquet'):
            return pd.read_parquet(path)
    raise FileNotFoundError(f"File not found: {path}. DATA_DIR={DATA_DIR}, filename={filename}")

# Set style
plt.style.use('dark_background')
plt.rcParams['figure.facecolor'] = '#1a1a2e'
plt.rcParams['axes.facecolor'] = '#16213e'
plt.rcParams['axes.edgecolor'] = '#e94560'
plt.rcParams['axes.labelcolor'] = '#ffffff'
plt.rcParams['text.color'] = '#ffffff'
plt.rcParams['xtick.color'] = '#ffffff'
plt.rcParams['ytick.color'] = '#ffffff'
plt.rcParams['grid.color'] = '#0f3460'

# User code starts here
${cleanedCode}

# Ensure all figures are saved (support multiple charts)
if plt.get_fignums():
    fig_nums = plt.get_fignums()
    for i, fig_num in enumerate(fig_nums):
        fig = plt.figure(fig_num)
        fig.tight_layout()
        # Save each figure with a unique name
        chart_filename = f'chart_{i}.png' if len(fig_nums) > 1 else 'chart.png'
        fig.savefig(os.path.join(OUTPUT_DIR, chart_filename), dpi=150, bbox_inches='tight', facecolor='#1a1a2e')
    plt.close('all')
`;

  try {
    const result = await executeCode(wrappedCode, 60, executionId); // Use same execution ID as file transfer
    
    // Check for errors
    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Code execution failed',
        executionTimeMs: Date.now() - startTime,
        code,
        stdout: result.stdout, // Include stdout even on error (may have useful info)
        stderr: result.stderr,
        structuredResult: result.structuredResult,
      };
    }
    
    // Find ALL chart images (support multiple charts)
    // Sandbox saves as: chart.png, chart_0.png, chart_1.png, or figure_0.png, figure_1.png
    const chartFiles = result.generatedFiles.filter(
      f => f.filename.startsWith('chart') || f.filename.startsWith('figure_') || f.mimeType.startsWith('image/')
    ).sort((a, b) => {
      // Sort by filename to ensure consistent order
      return a.filename.localeCompare(b.filename);
    });
    
    if (chartFiles.length === 0) {
      return {
        success: false,
        error: 'No chart image was generated',
        executionTimeMs: Date.now() - startTime,
        code,
        stdout: result.stdout, // Include stdout to show what happened
        stderr: result.stderr,
        structuredResult: result.structuredResult,
      };
    }
    
    // Extract execution ID from path (use different variable name to avoid shadowing)
    const pathParts = chartFiles[0].path.split('/');
    const fileExecutionId = pathParts[pathParts.length - 2];
    
    // Download all chart images as base64
    const chartImages = await Promise.all(
      chartFiles.map(async (chartFile) => {
        const base64Data = await downloadFileAsBase64(fileExecutionId, chartFile.filename);
        return {
          base64: base64Data,
          mimeType: chartFile.mimeType,
          filename: chartFile.filename,
        };
      })
    );
    
    console.log(`[Sandbox] Generated ${chartImages.length} chart(s): ${chartFiles.map(f => f.filename).join(', ')}`);
    
    // Return first chart for backward compatibility, but also include all charts
    return {
      success: true,
      imageBase64: chartImages[0].base64, // First chart for backward compatibility
      imageMimeType: chartImages[0].mimeType,
      chartImages: chartImages, // All charts
      executionTimeMs: Date.now() - startTime,
      code,
      stdout: result.stdout, // Include stdout (summary stats, headers, etc.)
      stderr: result.stderr, // Include stderr (warnings, etc.)
      structuredResult: result.structuredResult, // Include structured results (schema info, etc.)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTimeMs: Date.now() - startTime,
      code,
    };
  }
}

/**
 * Execute data analysis code and return structured results
 */
export async function executeAnalysis(
  code: string,
  inputData?: Record<string, unknown>
): Promise<{
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}> {
  // CRITICAL: Strip markdown code fences if present
  let cleanedCode = code.trim();
  cleanedCode = cleanedCode.replace(/^```(?:python)?\s*\n/gm, '');
  cleanedCode = cleanedCode.replace(/\n```\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/^```(?:python)?\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/```\s*$/gm, '');

  // Wrap code to capture results
  const wrappedCode = `
import json
import pandas as pd
import numpy as np

# Input data (if provided)
_input_data = ${JSON.stringify(inputData || {})}

# User code
${cleanedCode}

# If _result is defined, it will be captured
`;

  try {
    const result = await executeCode(wrappedCode, 60);
    
    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Analysis failed',
      };
    }
    
    return {
      success: true,
      result: result.structuredResult || { output: result.stdout },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

