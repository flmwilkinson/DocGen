/**
 * Python Sandbox Client
 *
 * Communicates with the Python sandbox service to execute code,
 * generate charts, and perform data analysis.
 *
 * Supports two modes:
 * 1. Local Python execution (default when NEXT_PUBLIC_USE_LOCAL_PYTHON=true)
 *    - Uses /api/python route which spawns Python locally
 *    - No Docker required
 *
 * 2. Docker sandbox (when Docker is available)
 *    - Uses the sandbox-python container
 *    - Better isolation but requires Docker
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
  base64Data?: string;
}

export interface ChartResult {
  success: boolean;
  imageBase64?: string;
  imageMimeType?: string;
  chartImages?: Array<{ base64: string; mimeType: string; filename: string }>;
  error?: string;
  executionTimeMs: number;
  code: string;
  stdout?: string;
  stderr?: string;
  structuredResult?: Record<string, unknown>;
}

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

// Configuration
const USE_LOCAL_PYTHON = process.env.NEXT_PUBLIC_USE_LOCAL_PYTHON === 'true' ||
  process.env.NEXT_PUBLIC_USE_LOCAL_PYTHON === undefined; // Default to true if not set
const SANDBOX_URL = process.env.NEXT_PUBLIC_SANDBOX_PYTHON_URL || 'http://localhost:8001';

// Track which mode is being used
let currentMode: 'local' | 'docker' | 'unknown' = 'unknown';

/**
 * Check if Python is available (either locally or via Docker sandbox)
 */
export async function isSandboxAvailable(): Promise<boolean> {
  // Try local Python first if configured
  if (USE_LOCAL_PYTHON) {
    try {
      console.log('[Sandbox] Checking local Python availability...');
      const response = await fetch('/api/python', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check' }),
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.available) {
          console.log(`[Sandbox] Local Python available: ${result.version}`);
          currentMode = 'local';
          return true;
        }
      }
    } catch (error) {
      console.warn('[Sandbox] Local Python check failed:', error instanceof Error ? error.message : error);
    }
  }

  // Fall back to Docker sandbox
  try {
    console.log(`[Sandbox] Checking Docker sandbox at ${SANDBOX_URL}/health`);
    const response = await fetch(`${SANDBOX_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });

    if (response.ok) {
      console.log('[Sandbox] Docker sandbox available');
      currentMode = 'docker';
      return true;
    }
  } catch (error) {
    console.warn('[Sandbox] Docker sandbox not available:', error instanceof Error ? error.message : error);
  }

  currentMode = 'unknown';
  return false;
}

/**
 * Get the current sandbox mode
 */
export function getSandboxMode(): 'local' | 'docker' | 'unknown' {
  return currentMode;
}

/**
 * Transfer files to the sandbox for use in code execution
 */
export async function transferFilesToSandbox(
  executionId: string,
  files: Array<{ path: string; content?: string; url?: string; encoding?: 'base64' }>
): Promise<TransferFilesResult> {
  // For local Python, use the local API route
  if (currentMode === 'local' || USE_LOCAL_PYTHON) {
    try {
      console.log(`[Sandbox] Transferring ${files.length} files locally for execution ${executionId}`);
      const response = await fetch('/api/python', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transfer',
          executionId,
          files,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        throw new Error(`Local transfer failed: ${response.status}`);
      }

      const result = await response.json();
      return {
        executionId,
        dataDir: result.dataDir,
        transferred: result.transferred?.map((t: string) => ({ path: t, fullPath: t, size: 0 })) || [],
        errors: [],
      };
    } catch (error) {
      console.error('[Sandbox] Local file transfer failed:', error);
      // Don't fall back to Docker for file transfers - just throw
      throw error;
    }
  }

  // Docker sandbox file transfer
  try {
    console.log(`[Sandbox] Transferring ${files.length} files to Docker sandbox for execution ${executionId}`);
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
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`Transfer failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return {
      executionId: result.execution_id,
      dataDir: result.data_dir,
      transferred: result.transferred || [],
      errors: result.errors || [],
    };
  } catch (error) {
    console.error('[Sandbox] Docker file transfer failed:', error);
    throw error;
  }
}

/**
 * Execute Python code in the sandbox
 */
export async function executeCode(
  code: string,
  timeoutSec: number = 60,
  executionId?: string
): Promise<ExecutionResult> {
  // For local Python, use the local API route
  if (currentMode === 'local' || USE_LOCAL_PYTHON) {
    try {
      const response = await fetch('/api/python', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          code,
          executionId,
        }),
        signal: AbortSignal.timeout((timeoutSec + 10) * 1000),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Local execution failed: ${error}`);
      }

      const result = await response.json();

      // The local API returns a slightly different format
      if (result.success) {
        return {
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exitCode: 0,
          executionTimeMs: result.executionTimeMs || 0,
          generatedFiles: result.chartImages?.map((img: { filename: string; base64: string; mimeType: string }) => ({
            filename: img.filename,
            path: `/local/${executionId}/${img.filename}`,
            size: img.base64.length,
            mimeType: img.mimeType,
            base64Data: img.base64,
          })) || [],
          structuredResult: result.structuredResult,
        };
      } else {
        return {
          stdout: result.stdout || '',
          stderr: result.stderr || result.error || 'Execution failed',
          exitCode: 1,
          executionTimeMs: result.executionTimeMs || 0,
          generatedFiles: [],
          structuredResult: undefined,
        };
      }
    } catch (error) {
      console.error('[Sandbox] Local execution failed:', error);
      throw error;
    }
  }

  // Docker sandbox execution
  const response = await fetch(`${SANDBOX_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  // For local execution, files are already in the result
  // This function is only needed for Docker sandbox
  if (currentMode === 'local') {
    console.warn('[Sandbox] downloadFileAsBase64 called in local mode - files should already be in result');
    return '';
  }

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

  // Ensure we know which mode we're using
  if (currentMode === 'unknown') {
    await isSandboxAvailable();
  }

  const executionId = `chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // For local Python, use a simplified direct approach
  if (currentMode === 'local' || USE_LOCAL_PYTHON) {
    try {
      console.log('[Sandbox] Using local Python for chart generation');
      const response = await fetch('/api/python', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          code,
          executionId,
          context: {
            title: context?.title,
            dataDescription: context?.dataDescription,
            dataFiles: context?.dataFiles,
          },
        }),
        signal: AbortSignal.timeout(70000),
      });

      const result = await response.json();

      if (result.success) {
        return {
          success: true,
          imageBase64: result.imageBase64,
          imageMimeType: result.imageMimeType || 'image/png',
          chartImages: result.chartImages,
          executionTimeMs: result.executionTimeMs || Date.now() - startTime,
          code,
          stdout: result.stdout,
          stderr: result.stderr,
          structuredResult: result.structuredResult,
        };
      } else {
        return {
          success: false,
          error: result.error || 'Chart generation failed',
          executionTimeMs: result.executionTimeMs || Date.now() - startTime,
          code,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTimeMs: Date.now() - startTime,
        code,
      };
    }
  }

  // Docker sandbox chart generation (original implementation)
  let dataDir = '';
  if (context?.dataFiles && context.dataFiles.length > 0) {
    try {
      console.log(`[Sandbox] Transferring ${context.dataFiles.length} data files for chart`);
      const transferResult = await transferFilesToSandbox(executionId, context.dataFiles);
      dataDir = transferResult.dataDir;
      console.log(`[Sandbox] Files available at: ${dataDir}`);
    } catch (error) {
      console.warn('[Sandbox] File transfer failed:', error);
    }
  }

  // Clean the code
  let cleanedCode = code.trim();
  cleanedCode = cleanedCode.replace(/^```(?:python)?\s*\n/gm, '');
  cleanedCode = cleanedCode.replace(/\n```\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/^```(?:python)?\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/```\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/plt\.savefig\([^)]+\)/g, '# plt.savefig removed');
  cleanedCode = cleanedCode.replace(/plt\.show\(\)/g, '# plt.show removed');

  // Wrap code with chart generation boilerplate
  const wrappedCode = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import os
import warnings

warnings.filterwarnings('ignore', category=UserWarning)
warnings.filterwarnings('ignore', category=RuntimeWarning)
warnings.filterwarnings('ignore', message='.*masked.*')

plt.close('all')
plt.rcdefaults()

DATA_DIR = "${dataDir || '/tmp/sandbox/data'}"

def load_data(filename):
    path = os.path.join(DATA_DIR, filename)
    if os.path.exists(path):
        if filename.endswith('.csv'):
            return pd.read_csv(path)
        elif filename.endswith('.xlsx') or filename.endswith('.xls'):
            return pd.read_excel(path)
        elif filename.endswith('.json'):
            return pd.read_json(path)
        elif filename.endswith('.parquet'):
            return pd.read_parquet(path)
    raise FileNotFoundError(f"File not found: {path}")

plt.style.use('dark_background')
plt.rcParams['figure.facecolor'] = '#1a1a2e'
plt.rcParams['axes.facecolor'] = '#16213e'
plt.rcParams['axes.edgecolor'] = '#e94560'
plt.rcParams['axes.labelcolor'] = '#ffffff'
plt.rcParams['text.color'] = '#ffffff'
plt.rcParams['xtick.color'] = '#ffffff'
plt.rcParams['ytick.color'] = '#ffffff'
plt.rcParams['grid.color'] = '#0f3460'

# User code
${cleanedCode}

# Save figures
if plt.get_fignums():
    for i, fig_num in enumerate(plt.get_fignums()):
        try:
            fig = plt.figure(fig_num)
            fig.tight_layout()
            chart_filename = f'chart_{i}.png' if len(plt.get_fignums()) > 1 else 'chart.png'
            fig.savefig(os.path.join(OUTPUT_DIR, chart_filename), dpi=150, bbox_inches='tight', facecolor='#1a1a2e')
            print(f"Saved: {chart_filename}")
        except Exception as e:
            print(f"Error saving figure: {e}")
        finally:
            plt.close(fig)
    plt.close('all')
`;

  try {
    const result = await executeCode(wrappedCode, 60, executionId);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Code execution failed',
        executionTimeMs: Date.now() - startTime,
        code,
        stdout: result.stdout,
        stderr: result.stderr,
        structuredResult: result.structuredResult,
      };
    }

    const chartFiles = result.generatedFiles.filter(
      f => f.filename.startsWith('chart') || f.filename.startsWith('figure_') || f.mimeType.startsWith('image/')
    ).sort((a, b) => a.filename.localeCompare(b.filename));

    if (chartFiles.length === 0) {
      return {
        success: false,
        error: 'No chart image was generated',
        executionTimeMs: Date.now() - startTime,
        code,
        stdout: result.stdout,
        stderr: result.stderr,
        structuredResult: result.structuredResult,
      };
    }

    const pathParts = chartFiles[0].path.split('/');
    const fileExecutionId = pathParts[pathParts.length - 2];

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

    return {
      success: true,
      imageBase64: chartImages[0].base64,
      imageMimeType: chartImages[0].mimeType,
      chartImages,
      executionTimeMs: Date.now() - startTime,
      code,
      stdout: result.stdout,
      stderr: result.stderr,
      structuredResult: result.structuredResult,
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
  let cleanedCode = code.trim();
  cleanedCode = cleanedCode.replace(/^```(?:python)?\s*\n/gm, '');
  cleanedCode = cleanedCode.replace(/\n```\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/^```(?:python)?\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/```\s*$/gm, '');

  const wrappedCode = `
import json
import pandas as pd
import numpy as np

_input_data = ${JSON.stringify(inputData || {})}

${cleanedCode}
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
