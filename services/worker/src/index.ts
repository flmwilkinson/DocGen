import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';

// Import job processors
import { processRepoClone } from './jobs/repo-clone';
import { processKnowledgeGraph } from './jobs/knowledge-graph';
import { processVectorIndex } from './jobs/vector-index';
import { processDocumentGeneration } from './jobs/document-generation';
import { processBlockRegeneration } from './jobs/block-regeneration';

// ===========================================
// Configuration
// ===========================================

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty' }
    : undefined,
});

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

const prisma = new PrismaClient();

// ===========================================
// Workers
// ===========================================

// Repository Processing Worker
const repoWorker = new Worker(
  'repo-processing',
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Processing repo job');
    
    switch (job.name) {
      case 'clone-repo':
        return await processRepoClone(job.data, { prisma, logger, redis });
      case 'build-kg':
        return await processKnowledgeGraph(job.data, { prisma, logger });
      case 'build-vector-index':
        return await processVectorIndex(job.data, { prisma, logger });
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  },
  {
    connection: redis,
    concurrency: CONCURRENCY,
  }
);

// Document Generation Worker
const generationWorker = new Worker(
  'document-generation',
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Processing generation job');
    
    switch (job.name) {
      case 'generate-document':
        return await processDocumentGeneration(job.data, { prisma, logger, redis });
      case 'regenerate-block':
        return await processBlockRegeneration(job.data, { prisma, logger });
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  },
  {
    connection: redis,
    concurrency: Math.max(1, Math.floor(CONCURRENCY / 2)), // Lower concurrency for LLM calls
  }
);

// ===========================================
// Event Handlers
// ===========================================

repoWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, name: job.name }, 'Repo job completed');
});

repoWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, name: job?.name, err }, 'Repo job failed');
});

generationWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, name: job.name }, 'Generation job completed');
});

generationWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, name: job?.name, err }, 'Generation job failed');
});

// ===========================================
// Graceful Shutdown
// ===========================================

async function shutdown() {
  logger.info('Shutting down workers...');
  
  await Promise.all([
    repoWorker.close(),
    generationWorker.close(),
  ]);
  
  await prisma.$disconnect();
  await redis.quit();
  
  logger.info('Workers shut down successfully');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ===========================================
// Startup
// ===========================================

logger.info({
  concurrency: CONCURRENCY,
  queues: ['repo-processing', 'document-generation'],
}, '🔧 DocGen.AI Worker started');

