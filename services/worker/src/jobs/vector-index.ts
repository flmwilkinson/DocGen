import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from 'pino';
import { generateId } from '@docgen/shared';

interface VectorIndexJobData {
  snapshotId: string;
}

interface JobContext {
  prisma: PrismaClient;
  logger: Logger;
}

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '1000', 10);
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || '200', 10);
// Embedding model - for Azure, set OPENAI_EMBEDDING_MODEL to your deployment name
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || process.env.MODEL_EMBEDDING || 'text-embedding-3-small';
const BATCH_SIZE = 50; // Max embeddings per API call

// OpenAI client configuration - supports custom base URL for Azure or proxies
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
});

export async function processVectorIndex(
  data: VectorIndexJobData,
  ctx: JobContext
): Promise<{ chunksCount: number }> {
  const { snapshotId } = data;
  const { prisma, logger } = ctx;

  try {
    const snapshot = await prisma.repoSnapshot.findUnique({
      where: { id: snapshotId },
    });

    if (!snapshot?.localPath) {
      throw new Error('Snapshot local path not found');
    }

    await prisma.repoSnapshot.update({
      where: { id: snapshotId },
      data: { status: 'EMBEDDING' },
    });

    logger.info({ snapshotId }, 'Building vector index');

    // Get text files from manifest
    const manifest = snapshot.fileManifest as Array<{
      path: string;
      language?: string;
      isDirectory: boolean;
      size: number;
    }>;

    const textExtensions = [
      '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs',
      '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift',
      '.kt', '.scala', '.md', '.txt', '.json', '.yaml', '.yml',
      '.sql', '.sh', '.bash', '.html', '.css', '.scss',
    ];

    const textFiles = manifest.filter(
      (f) =>
        !f.isDirectory &&
        f.size < 500000 && // Skip files > 500KB
        textExtensions.some((ext) => f.path.endsWith(ext))
    );

    logger.info({ count: textFiles.length }, 'Processing text files for embeddings');

    // Delete existing chunks for this snapshot
    await prisma.vectorChunk.deleteMany({
      where: { repoSnapshotId: snapshotId },
    });

    const allChunks: Array<{
      id: string;
      sourcePath: string;
      chunkIndex: number;
      content: string;
      startLine?: number;
      endLine?: number;
    }> = [];

    // Chunk all files
    for (const file of textFiles) {
      const fullPath = path.join(snapshot.localPath, file.path);
      
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const chunks = chunkText(content, file.path);
        allChunks.push(...chunks);
      } catch {
        // Skip files that can't be read
      }
    }

    logger.info({ totalChunks: allChunks.length }, 'Text chunking complete, generating embeddings');

    // Generate embeddings in batches
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      
      try {
        const embeddings = await generateEmbeddings(batch.map((c) => c.content));
        
        // Store chunks with embeddings
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const embedding = embeddings[j];
          
          // Use raw SQL to insert vector
          await prisma.$executeRaw`
            INSERT INTO vector_chunks (
              id, "repoSnapshotId", "sourceType", "sourcePath", 
              "chunkIndex", content, "startLine", "endLine", 
              metadata, embedding, "createdAt"
            ) VALUES (
              ${chunk.id}, ${snapshotId}, 'repo_file', ${chunk.sourcePath},
              ${chunk.chunkIndex}, ${chunk.content}, ${chunk.startLine}, ${chunk.endLine},
              '{}', ${embedding}::vector, NOW()
            )
          `;
        }

        logger.debug({ batch: i / BATCH_SIZE + 1, total: Math.ceil(allChunks.length / BATCH_SIZE) }, 'Batch embedded');
      } catch (error) {
        logger.error({ error, batchIndex: i }, 'Failed to generate embeddings for batch');
        // Continue with other batches
      }
    }

    // Update snapshot status
    await prisma.repoSnapshot.update({
      where: { id: snapshotId },
      data: { status: 'READY' },
    });

    logger.info({ snapshotId, chunksCount: allChunks.length }, 'Vector index built');

    return { chunksCount: allChunks.length };
  } catch (error) {
    logger.error({ error, snapshotId }, 'Failed to build vector index');
    throw error;
  }
}

function chunkText(
  content: string,
  sourcePath: string
): Array<{
  id: string;
  sourcePath: string;
  chunkIndex: number;
  content: string;
  startLine?: number;
  endLine?: number;
}> {
  const chunks: Array<{
    id: string;
    sourcePath: string;
    chunkIndex: number;
    content: string;
    startLine?: number;
    endLine?: number;
  }> = [];

  const lines = content.split('\n');
  let currentChunk = '';
  let chunkStartLine = 1;
  let lineIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (currentChunk.length + line.length > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push({
        id: generateId(),
        sourcePath,
        chunkIndex: chunks.length,
        content: currentChunk.trim(),
        startLine: chunkStartLine,
        endLine: i,
      });

      // Start new chunk with overlap
      const overlapLines = Math.ceil(CHUNK_OVERLAP / 50); // Rough estimate
      const overlapStart = Math.max(0, i - overlapLines);
      currentChunk = lines.slice(overlapStart, i + 1).join('\n');
      chunkStartLine = overlapStart + 1;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }

  // Add remaining content
  if (currentChunk.trim()) {
    chunks.push({
      id: generateId(),
      sourcePath,
      chunkIndex: chunks.length,
      content: currentChunk.trim(),
      startLine: chunkStartLine,
      endLine: lines.length,
    });
  }

  return chunks;
}

async function generateEmbeddings(texts: string[]): Promise<string[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item) => `[${item.embedding.join(',')}]`);
}

