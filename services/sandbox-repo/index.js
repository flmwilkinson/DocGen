/**
 * DocGen.AI Repo Runner Sandbox Service
 * 
 * Executes commands within repository environments in isolated containers.
 */

import express from 'express';
import Docker from 'dockerode';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8002;
const REPOS_DIR = process.env.REPOS_DIR || '/tmp/repos';
const DEFAULT_TIMEOUT = parseInt(process.env.SANDBOX_TIMEOUT_SEC || '300', 10);

// Docker client (optional - for full isolation)
let docker;
try {
  docker = new Docker();
} catch (e) {
  console.warn('Docker not available, running commands directly');
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'sandbox-repo', docker: !!docker });
});

// Execute command in repo
app.post('/execute', async (req, res) => {
  const {
    repoPath,
    command,
    args = [],
    env = {},
    workingDir,
    timeoutSec = DEFAULT_TIMEOUT,
  } = req.body;

  if (!repoPath || !command) {
    return res.status(400).json({ error: 'repoPath and command are required' });
  }

  const executionId = uuidv4();
  const fullRepoPath = path.isAbsolute(repoPath) ? repoPath : path.join(REPOS_DIR, repoPath);
  const cwd = workingDir ? path.join(fullRepoPath, workingDir) : fullRepoPath;

  console.log(`[${executionId}] Executing: ${command} ${args.join(' ')} in ${cwd}`);

  try {
    // Check if repo path exists
    await fs.access(fullRepoPath);

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    // Execute command
    const result = await new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        timeout: timeoutSec * 1000,
        shell: true,
      });

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        // Limit output size
        if (stdout.length > 1024 * 1024) {
          stdout = stdout.slice(0, 1024 * 1024) + '\n[OUTPUT TRUNCATED]';
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > 1024 * 1024) {
          stderr = stderr.slice(0, 1024 * 1024) + '\n[OUTPUT TRUNCATED]';
        }
      });

      proc.on('close', (code) => {
        resolve({ exitCode: code || 0, stdout, stderr });
      });

      proc.on('error', (err) => {
        reject(err);
      });

      // Handle timeout
      setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeoutSec}s`));
      }, timeoutSec * 1000);
    });

    const executionTimeMs = Date.now() - startTime;

    // Collect any produced artifacts (files in output directory)
    const producedArtifacts = [];
    const outputDir = path.join(cwd, 'output');
    try {
      const files = await fs.readdir(outputDir);
      for (const file of files) {
        const filePath = path.join(outputDir, file);
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          producedArtifacts.push({
            filename: file,
            path: filePath,
            size: stats.size,
          });
        }
      }
    } catch {
      // Output directory doesn't exist, that's fine
    }

    res.json({
      executionId,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      executionTimeMs,
      producedArtifacts,
    });

  } catch (error) {
    console.error(`[${executionId}] Error:`, error);
    res.status(500).json({
      executionId,
      error: error.message,
      stdout: '',
      stderr: error.message,
      exitCode: 1,
      executionTimeMs: 0,
      producedArtifacts: [],
    });
  }
});

// Execute in Docker container (more isolated)
app.post('/execute-isolated', async (req, res) => {
  if (!docker) {
    return res.status(501).json({ error: 'Docker not available' });
  }

  const {
    repoPath,
    command,
    args = [],
    env = {},
    image = 'node:20-alpine',
    timeoutSec = DEFAULT_TIMEOUT,
  } = req.body;

  const executionId = uuidv4();
  const fullRepoPath = path.isAbsolute(repoPath) ? repoPath : path.join(REPOS_DIR, repoPath);

  console.log(`[${executionId}] Isolated execution: ${command} in ${image}`);

  try {
    const container = await docker.createContainer({
      Image: image,
      Cmd: ['/bin/sh', '-c', `${command} ${args.join(' ')}`],
      WorkingDir: '/repo',
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
      HostConfig: {
        Binds: [`${fullRepoPath}:/repo:ro`],
        Memory: 512 * 1024 * 1024, // 512MB
        CpuPeriod: 100000,
        CpuQuota: 100000, // 1 CPU
        NetworkMode: 'none', // No network access
        AutoRemove: true,
      },
    });

    const startTime = Date.now();
    await container.start();

    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    });

    let stdout = '';
    let stderr = '';

    stream.on('data', (chunk) => {
      // Docker stream format: first 8 bytes are header
      const content = chunk.slice(8).toString();
      const type = chunk[0];
      if (type === 1) stdout += content;
      else stderr += content;
    });

    // Wait for container to finish
    const result = await container.wait();
    const executionTimeMs = Date.now() - startTime;

    res.json({
      executionId,
      stdout,
      stderr,
      exitCode: result.StatusCode,
      executionTimeMs,
      producedArtifacts: [],
    });

  } catch (error) {
    console.error(`[${executionId}] Error:`, error);
    res.status(500).json({
      executionId,
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🔧 Repo Runner Sandbox listening on port ${PORT}`);
});

