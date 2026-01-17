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
  imageBase64?: string;
  imageMimeType?: string;
  error?: string;
  executionTimeMs: number;
  code: string;
}

// Get sandbox URL from environment or use default
const SANDBOX_URL = process.env.NEXT_PUBLIC_SANDBOX_PYTHON_URL || 'http://localhost:8001';

/**
 * Check if the sandbox service is available
 */
export async function isSandboxAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${SANDBOX_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Execute Python code in the sandbox
 */
export async function executeCode(
  code: string,
  timeoutSec: number = 60
): Promise<ExecutionResult> {
  const response = await fetch(`${SANDBOX_URL}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      timeout_sec: timeoutSec,
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
 */
export async function generateChart(
  code: string,
  context?: {
    title?: string;
    dataDescription?: string;
  }
): Promise<ChartResult> {
  const startTime = Date.now();
  
  // Wrap the code to ensure proper chart saving
  const wrappedCode = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import os

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
${code}

# Ensure figure is saved
if plt.get_fignums():
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'chart.png'), dpi=150, bbox_inches='tight', facecolor='#1a1a2e')
    plt.close('all')
`;

  try {
    const result = await executeCode(wrappedCode, 30);
    
    // Check for errors
    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Code execution failed',
        executionTimeMs: Date.now() - startTime,
        code,
      };
    }
    
    // Find the chart image
    const chartFile = result.generatedFiles.find(
      f => f.filename === 'chart.png' || f.mimeType.startsWith('image/')
    );
    
    if (!chartFile) {
      return {
        success: false,
        error: 'No chart image was generated',
        executionTimeMs: Date.now() - startTime,
        code,
      };
    }
    
    // Extract execution ID from path
    const pathParts = chartFile.path.split('/');
    const executionId = pathParts[pathParts.length - 2];
    
    // Download the image as base64
    const base64Data = await downloadFileAsBase64(executionId, chartFile.filename);
    
    return {
      success: true,
      imageBase64: base64Data,
      imageMimeType: chartFile.mimeType,
      executionTimeMs: Date.now() - startTime,
      code,
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
  // Wrap code to capture results
  const wrappedCode = `
import json
import pandas as pd
import numpy as np

# Input data (if provided)
_input_data = ${JSON.stringify(inputData || {})}

# User code
${code}

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

