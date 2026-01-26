/**
 * Local Python Executor
 *
 * Executes Python code directly on the host system without Docker.
 * For POC/development use - less secure than sandbox but works everywhere.
 *
 * Requirements:
 * - Python 3.8+ installed and in PATH
 * - pip packages: pandas, numpy, matplotlib, seaborn (optional: plotly, scipy)
 *
 * Set PYTHON_EXECUTOR=local to use this instead of the Docker sandbox.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface LocalExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  generatedFiles: Array<{
    filename: string;
    path: string;
    size: number;
    mimeType: string;
  }>;
}

export interface LocalChartResult {
  success: boolean;
  imageBase64?: string;
  imageMimeType?: string;
  chartImages?: Array<{ base64: string; mimeType: string; filename: string }>;
  error?: string;
  executionTimeMs: number;
  code: string;
  stdout?: string;
  stderr?: string;
}

// Get Python command (try python3 first, then python)
const PYTHON_CMD = process.env.PYTHON_CMD || (os.platform() === 'win32' ? 'python' : 'python3');
const LOCAL_TEMP_DIR = process.env.LOCAL_PYTHON_TEMP || path.join(os.tmpdir(), 'docgen-python');

/**
 * Ensure temp directory exists
 */
function ensureTempDir(executionId: string): string {
  const execDir = path.join(LOCAL_TEMP_DIR, executionId);
  if (!fs.existsSync(execDir)) {
    fs.mkdirSync(execDir, { recursive: true });
  }
  return execDir;
}

/**
 * Check if Python is available on the system
 */
export async function isPythonAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_CMD, ['--version']);
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * Get Python version info
 */
export async function getPythonVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_CMD, ['--version']);
    let output = '';
    proc.stdout.on('data', (data) => (output += data.toString()));
    proc.stderr.on('data', (data) => (output += data.toString()));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error('Python not available'));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Execute Python code locally
 */
export async function executeLocalPython(
  code: string,
  executionId: string,
  timeoutSec: number = 60
): Promise<LocalExecutionResult> {
  const startTime = Date.now();
  const execDir = ensureTempDir(executionId);
  const outputDir = path.join(execDir, 'output');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write the Python script
  const scriptPath = path.join(execDir, 'script.py');

  // Wrap code with output directory setup
  const wrappedCode = `
import os
import sys

# Set output directory
OUTPUT_DIR = ${JSON.stringify(outputDir.replace(/\\/g, '/'))}
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Change to execution directory
os.chdir(${JSON.stringify(execDir.replace(/\\/g, '/'))})

${code}
`;

  fs.writeFileSync(scriptPath, wrappedCode);

  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_CMD, [scriptPath], {
      cwd: execDir,
      timeout: timeoutSec * 1000,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        OUTPUT_DIR: outputDir,
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      // Find generated files
      const generatedFiles: LocalExecutionResult['generatedFiles'] = [];

      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir);
        for (const filename of files) {
          const filePath = path.join(outputDir, filename);
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            const ext = path.extname(filename).toLowerCase();
            let mimeType = 'application/octet-stream';
            if (ext === '.png') mimeType = 'image/png';
            else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
            else if (ext === '.svg') mimeType = 'image/svg+xml';
            else if (ext === '.pdf') mimeType = 'application/pdf';
            else if (ext === '.json') mimeType = 'application/json';
            else if (ext === '.csv') mimeType = 'text/csv';

            generatedFiles.push({
              filename,
              path: filePath,
              size: stats.size,
              mimeType,
            });
          }
        }
      }

      resolve({
        stdout,
        stderr,
        exitCode: code || 0,
        executionTimeMs: Date.now() - startTime,
        generatedFiles,
      });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Transfer files for Python execution
 */
export async function transferFilesLocal(
  executionId: string,
  files: Array<{ path: string; content?: string; url?: string; encoding?: 'base64' }>
): Promise<{ dataDir: string; transferred: string[] }> {
  const execDir = ensureTempDir(executionId);
  const dataDir = path.join(execDir, 'data');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const transferred: string[] = [];

  for (const file of files) {
    const targetPath = path.join(dataDir, file.path);
    const targetDir = path.dirname(targetPath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    if (file.content) {
      if (file.encoding === 'base64') {
        fs.writeFileSync(targetPath, Buffer.from(file.content, 'base64'));
      } else {
        fs.writeFileSync(targetPath, file.content);
      }
      transferred.push(file.path);
    } else if (file.url) {
      // Fetch from URL
      try {
        const response = await fetch(file.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(targetPath, buffer);
        transferred.push(file.path);
      } catch (err) {
        console.warn(`Failed to fetch ${file.url}:`, err);
      }
    }
  }

  return { dataDir: dataDir.replace(/\\/g, '/'), transferred };
}

/**
 * Generate a chart using local Python execution
 */
export async function generateChartLocal(
  code: string,
  context?: {
    title?: string;
    dataDescription?: string;
    dataFiles?: Array<{ path: string; content?: string; url?: string; encoding?: 'base64' }>;
  }
): Promise<LocalChartResult> {
  const startTime = Date.now();
  const executionId = `chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Transfer data files if provided
  let dataDir = '';
  if (context?.dataFiles && context.dataFiles.length > 0) {
    try {
      const transferResult = await transferFilesLocal(executionId, context.dataFiles);
      dataDir = transferResult.dataDir;
      console.log(`[LocalPython] Files transferred to: ${dataDir}`);
    } catch (error) {
      console.warn(`[LocalPython] File transfer failed:`, error);
    }
  }

  // Clean up code (remove markdown fences, etc.)
  let cleanedCode = code.trim();
  cleanedCode = cleanedCode.replace(/^```(?:python)?\s*\n/gm, '');
  cleanedCode = cleanedCode.replace(/\n```\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/^```(?:python)?\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/```\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/plt\.savefig\([^)]+\)/g, '# plt.savefig removed - handled automatically');
  cleanedCode = cleanedCode.replace(/plt\.show\(\)/g, '# plt.show removed');

  // Wrap code with matplotlib setup
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

plt.close('all')
plt.rcdefaults()

DATA_DIR = "${dataDir || '/tmp'}"

def load_data(filename):
    """Load a data file from DATA_DIR"""
    filepath = os.path.join(DATA_DIR, filename)
    if not os.path.exists(filepath):
        # Try to find file in subdirectories
        for root, dirs, files in os.walk(DATA_DIR):
            for f in files:
                if f == filename or filename in f:
                    filepath = os.path.join(root, f)
                    break

    if filepath.endswith('.csv'):
        return pd.read_csv(filepath)
    elif filepath.endswith('.xlsx') or filepath.endswith('.xls'):
        return pd.read_excel(filepath)
    elif filepath.endswith('.json'):
        return pd.read_json(filepath)
    elif filepath.endswith('.parquet'):
        return pd.read_parquet(filepath)
    raise FileNotFoundError(f"File not found: {filename}")

# Style setup
try:
    plt.style.use('dark_background')
    plt.rcParams['figure.facecolor'] = '#1a1a2e'
    plt.rcParams['axes.facecolor'] = '#16213e'
    plt.rcParams['axes.edgecolor'] = '#e94560'
    plt.rcParams['axes.labelcolor'] = '#ffffff'
    plt.rcParams['text.color'] = '#ffffff'
    plt.rcParams['xtick.color'] = '#ffffff'
    plt.rcParams['ytick.color'] = '#ffffff'
    plt.rcParams['grid.color'] = '#0f3460'
except:
    pass

# User code
${cleanedCode}

# Save all figures
if plt.get_fignums():
    for i, fig_num in enumerate(plt.get_fignums()):
        try:
            fig = plt.figure(fig_num)
            fig.tight_layout()
            chart_filename = f'chart_{i}.png' if len(plt.get_fignums()) > 1 else 'chart.png'
            fig.savefig(os.path.join(OUTPUT_DIR, chart_filename), dpi=150, bbox_inches='tight', facecolor='#1a1a2e')
            print(f"Saved: {chart_filename}")
        except Exception as e:
            print(f"Warning: Failed to save figure {fig_num}: {e}")
        finally:
            plt.close(fig)
    plt.close('all')
`;

  try {
    const result = await executeLocalPython(wrappedCode, executionId, 60);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Code execution failed',
        executionTimeMs: Date.now() - startTime,
        code,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }

    // Find chart images
    const chartFiles = result.generatedFiles
      .filter((f) => f.mimeType.startsWith('image/'))
      .sort((a, b) => a.filename.localeCompare(b.filename));

    if (chartFiles.length === 0) {
      return {
        success: false,
        error: 'No chart image was generated',
        executionTimeMs: Date.now() - startTime,
        code,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }

    // Read chart images as base64
    const chartImages = chartFiles.map((file) => {
      const imageBuffer = fs.readFileSync(file.path);
      return {
        base64: imageBuffer.toString('base64'),
        mimeType: file.mimeType,
        filename: file.filename,
      };
    });

    console.log(`[LocalPython] Generated ${chartImages.length} chart(s)`);

    return {
      success: true,
      imageBase64: chartImages[0].base64,
      imageMimeType: chartImages[0].mimeType,
      chartImages,
      executionTimeMs: Date.now() - startTime,
      code,
      stdout: result.stdout,
      stderr: result.stderr,
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
 * Cleanup old execution directories (call periodically)
 */
export function cleanupOldExecutions(maxAgeMs: number = 3600000): void {
  if (!fs.existsSync(LOCAL_TEMP_DIR)) return;

  const now = Date.now();
  const dirs = fs.readdirSync(LOCAL_TEMP_DIR);

  for (const dir of dirs) {
    const dirPath = path.join(LOCAL_TEMP_DIR, dir);
    try {
      const stats = fs.statSync(dirPath);
      if (stats.isDirectory() && now - stats.mtimeMs > maxAgeMs) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors
    }
  }
}
