/**
 * Local Python Execution API Route
 *
 * This runs Python code directly on the host machine (no Docker needed).
 * Server-side only - safe to use Node.js modules.
 */

import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Python command resolution:
// 1. Use PYTHON_CMD env var if set (can include args like "py -3.11")
// 2. On Windows, use 'py -3.11' (Python Launcher for Python 3.11 specifically)
//    Note: We specify 3.11 because newer/older versions may have missing packages
// 3. Fall back to 'python3' on Unix
const PYTHON_CMD_RAW = process.env.PYTHON_CMD || (os.platform() === 'win32' ? 'py -3.11' : 'python3');
const PYTHON_CMD_PARTS = PYTHON_CMD_RAW.split(' ');
const PYTHON_CMD = PYTHON_CMD_PARTS[0];
const PYTHON_ARGS = PYTHON_CMD_PARTS.slice(1);

interface ExecuteRequest {
  action: 'execute' | 'check' | 'transfer';
  code?: string;
  executionId?: string;
  files?: Array<{ path: string; content?: string; encoding?: 'base64' }>;
  context?: {
    title?: string;
    dataDescription?: string;
    dataFiles?: Array<{ path: string; content?: string; encoding?: 'base64' }>;
  };
}

function getTempDir(): string {
  const baseDir = process.env.LOCAL_PYTHON_TEMP || path.join(os.tmpdir(), 'docgen-python');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return baseDir;
}

function getExecutionDir(executionId: string): string {
  const dir = path.join(getTempDir(), executionId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function checkPythonAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_CMD, [...PYTHON_ARGS, '--version']);
    let output = '';

    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => { output += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ available: true, version: output.trim() });
      } else {
        resolve({ available: false, error: 'Python not found' });
      }
    });

    proc.on('error', (err) => {
      resolve({ available: false, error: err.message });
    });

    setTimeout(() => {
      proc.kill();
      resolve({ available: false, error: 'Timeout checking Python' });
    }, 5000);
  });
}

async function transferFiles(
  executionId: string,
  files: Array<{ path: string; content?: string; encoding?: 'base64' }>
): Promise<{ dataDir: string; transferred: string[] }> {
  const execDir = getExecutionDir(executionId);
  const dataDir = path.join(execDir, 'data');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const transferred: string[] = [];

  for (const file of files) {
    if (file.content) {
      const filePath = path.join(dataDir, file.path);
      const fileDir = path.dirname(filePath);

      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }

      if (file.encoding === 'base64') {
        fs.writeFileSync(filePath, Buffer.from(file.content, 'base64'));
      } else {
        fs.writeFileSync(filePath, file.content, 'utf-8');
      }

      transferred.push(file.path);
    }
  }

  return { dataDir, transferred };
}

async function executeChartCode(
  code: string,
  executionId: string,
  context?: { dataFiles?: Array<{ path: string; content?: string; encoding?: 'base64' }> }
): Promise<{
  success: boolean;
  imageBase64?: string;
  imageMimeType?: string;
  chartImages?: Array<{ base64: string; mimeType: string; filename: string }>;
  error?: string;
  stdout?: string;
  stderr?: string;
  executionTimeMs: number;
}> {
  const startTime = Date.now();
  const execDir = getExecutionDir(executionId);
  const outputDir = path.join(execDir, 'output');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Transfer data files if provided
  let dataDir = path.join(execDir, 'data');
  if (context?.dataFiles && context.dataFiles.length > 0) {
    const result = await transferFiles(executionId, context.dataFiles);
    dataDir = result.dataDir;
  }

  // Clean the code
  let cleanedCode = code.trim();
  cleanedCode = cleanedCode.replace(/^```(?:python)?\s*\n/gm, '');
  cleanedCode = cleanedCode.replace(/\n```\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/^```(?:python)?\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/```\s*$/gm, '');
  cleanedCode = cleanedCode.replace(/plt\.savefig\([^)]+\)/g, '# plt.savefig removed');
  cleanedCode = cleanedCode.replace(/plt\.show\(\)/g, '# plt.show removed');

  // Wrap with chart generation boilerplate
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

DATA_DIR = r"${dataDir.replace(/\\/g, '\\\\')}"
OUTPUT_DIR = r"${outputDir.replace(/\\/g, '\\\\')}"

def load_data(filename):
    path = os.path.join(DATA_DIR, filename)
    if os.path.exists(path):
        if filename.endswith('.csv'):
            return pd.read_csv(path)
        elif filename.endswith('.xlsx') or filename.endswith('.xls'):
            return pd.read_excel(path)
        elif filename.endswith('.json'):
            return pd.read_json(path)
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
            print(f"Error saving figure: {e}")
        finally:
            plt.close(fig)
`;

  const scriptPath = path.join(execDir, 'script.py');
  fs.writeFileSync(scriptPath, wrappedCode, 'utf-8');

  return new Promise((resolve) => {
    const proc = spawn(PYTHON_CMD, [...PYTHON_ARGS, scriptPath], {
      cwd: execDir,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (exitCode) => {
      const executionTimeMs = Date.now() - startTime;

      if (exitCode !== 0) {
        resolve({
          success: false,
          error: stderr || 'Python execution failed',
          stdout,
          stderr,
          executionTimeMs,
        });
        return;
      }

      // Find generated chart files
      const chartImages: Array<{ base64: string; mimeType: string; filename: string }> = [];

      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir);
        for (const file of files) {
          if (file.endsWith('.png')) {
            const filePath = path.join(outputDir, file);
            const data = fs.readFileSync(filePath);
            chartImages.push({
              base64: data.toString('base64'),
              mimeType: 'image/png',
              filename: file,
            });
          }
        }
      }

      if (chartImages.length === 0) {
        resolve({
          success: false,
          error: 'No chart image was generated',
          stdout,
          stderr,
          executionTimeMs,
        });
        return;
      }

      resolve({
        success: true,
        imageBase64: chartImages[0].base64,
        imageMimeType: chartImages[0].mimeType,
        chartImages,
        stdout,
        stderr,
        executionTimeMs,
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        error: err.message,
        executionTimeMs: Date.now() - startTime,
      });
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        error: 'Execution timeout (60s)',
        stdout,
        stderr,
        executionTimeMs: Date.now() - startTime,
      });
    }, 60000);
  });
}

export async function POST(request: NextRequest) {
  try {
    const body: ExecuteRequest = await request.json();

    if (body.action === 'check') {
      const result = await checkPythonAvailable();
      return NextResponse.json(result);
    }

    if (body.action === 'transfer' && body.executionId && body.files) {
      const result = await transferFiles(body.executionId, body.files);
      return NextResponse.json(result);
    }

    if (body.action === 'execute' && body.code) {
      const executionId = body.executionId || `chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const result = await executeChartCode(body.code, executionId, body.context);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  const result = await checkPythonAvailable();
  return NextResponse.json(result);
}
