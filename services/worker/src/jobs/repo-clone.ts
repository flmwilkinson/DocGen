import { PrismaClient } from '@prisma/client';
import { simpleGit, SimpleGit } from 'simple-git';
import { Queue } from 'bullmq';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from 'pino';
import Redis from 'ioredis';

interface RepoCloneJobData {
  snapshotId: string;
  repoUrl: string;
  branch: string;
}

interface JobContext {
  prisma: PrismaClient;
  logger: Logger;
  redis: Redis;
}

const REPOS_DIR = process.env.REPOS_DIR || '/tmp/docgen-repos';

export async function processRepoClone(
  data: RepoCloneJobData,
  ctx: JobContext
): Promise<{ success: boolean; filesCount: number }> {
  const { snapshotId, repoUrl, branch } = data;
  const { prisma, logger, redis } = ctx;

  const repoQueue = new Queue('repo-processing', { connection: redis });

  try {
    // Update status to CLONING
    await prisma.repoSnapshot.update({
      where: { id: snapshotId },
      data: { status: 'CLONING' },
    });

    // Create repos directory if not exists
    await fs.mkdir(REPOS_DIR, { recursive: true });

    // Clone directory path
    const repoDir = path.join(REPOS_DIR, snapshotId);

    // Clone repository
    logger.info({ repoUrl, branch, repoDir }, 'Cloning repository');
    
    const git: SimpleGit = simpleGit();
    await git.clone(repoUrl, repoDir, ['--branch', branch, '--depth', '100']);

    // Get commit hash
    const localGit = simpleGit(repoDir);
    const log = await localGit.log(['-1']);
    const commitHash = log.latest?.hash;

    // Build file manifest
    logger.info('Building file manifest');
    const fileManifest = await buildFileManifest(repoDir);
    const languageStats = calculateLanguageStats(fileManifest);

    // Update snapshot with manifest
    await prisma.repoSnapshot.update({
      where: { id: snapshotId },
      data: {
        status: 'INDEXING',
        commitHash,
        localPath: repoDir,
        fileManifest,
        languageStats,
        totalFiles: fileManifest.length,
        totalSize: BigInt(fileManifest.reduce((sum, f) => sum + f.size, 0)),
      },
    });

    // Queue knowledge graph building
    await repoQueue.add('build-kg', { snapshotId }, {
      jobId: `kg-${snapshotId}`,
    });

    // Queue vector index building
    await repoQueue.add('build-vector-index', { snapshotId }, {
      jobId: `vec-${snapshotId}`,
    });

    return { success: true, filesCount: fileManifest.length };
  } catch (error) {
    logger.error({ error, snapshotId }, 'Failed to clone repository');

    await prisma.repoSnapshot.update({
      where: { id: snapshotId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    throw error;
  }
}

interface FileManifestEntry {
  path: string;
  size: number;
  language?: string;
  isDirectory: boolean;
}

async function buildFileManifest(repoDir: string): Promise<FileManifestEntry[]> {
  const manifest: FileManifestEntry[] = [];
  
  async function walkDir(dir: string, relativePath: string = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip hidden files and common ignore patterns
      if (entry.name.startsWith('.')) continue;
      if (['node_modules', '__pycache__', 'venv', '.git', 'dist', 'build'].includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        manifest.push({
          path: relPath,
          size: 0,
          isDirectory: true,
        });
        await walkDir(fullPath, relPath);
      } else {
        const stats = await fs.stat(fullPath);
        const ext = path.extname(entry.name).toLowerCase();
        
        manifest.push({
          path: relPath,
          size: stats.size,
          language: getLanguageFromExtension(ext),
          isDirectory: false,
        });
      }
    }
  }

  await walkDir(repoDir);
  return manifest;
}

function getLanguageFromExtension(ext: string): string | undefined {
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.cs': 'csharp',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.md': 'markdown',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.sql': 'sql',
    '.sh': 'shell',
    '.bash': 'shell',
  };
  return langMap[ext];
}

function calculateLanguageStats(manifest: FileManifestEntry[]) {
  const langCounts: Record<string, { files: number; bytes: number }> = {};
  
  for (const entry of manifest) {
    if (entry.isDirectory || !entry.language) continue;
    
    if (!langCounts[entry.language]) {
      langCounts[entry.language] = { files: 0, bytes: 0 };
    }
    langCounts[entry.language].files++;
    langCounts[entry.language].bytes += entry.size;
  }

  const totalBytes = Object.values(langCounts).reduce((sum, l) => sum + l.bytes, 0);
  
  return Object.entries(langCounts)
    .map(([language, stats]) => ({
      language,
      files: stats.files,
      lines: Math.round(stats.bytes / 40), // Rough estimate
      percentage: totalBytes > 0 ? Math.round((stats.bytes / totalBytes) * 100) : 0,
    }))
    .sort((a, b) => b.percentage - a.percentage);
}

