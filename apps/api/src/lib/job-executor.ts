/**
 * Job Executor
 *
 * Provides a unified interface for executing background jobs.
 * When Redis is available, jobs are queued via BullMQ.
 * When Redis is unavailable, jobs run inline (synchronously or via setImmediate).
 */

import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { redis, isRedisAvailable } from './redis';

// Lazy import of job processors to avoid circular dependencies
let processRepoClone: Function | null = null;
let processKnowledgeGraph: Function | null = null;
let processVectorIndex: Function | null = null;
let processDocumentGeneration: Function | null = null;
let processBlockRegeneration: Function | null = null;

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

// Queue instances (only created if Redis is available)
let repoQueue: Queue | null = null;
let generationQueue: Queue | null = null;

/**
 * Initialize queues if Redis is available
 */
function initQueues(): void {
  if (isRedisAvailable() && redis) {
    repoQueue = repoQueue || new Queue('repo-processing', { connection: redis });
    generationQueue = generationQueue || new Queue('document-generation', { connection: redis });
  }
}

/**
 * Dynamically load job processors
 * This avoids issues with the worker package not being available
 */
async function loadJobProcessors(): Promise<void> {
  if (!processRepoClone) {
    try {
      // Try to import from worker service
      const repoClone = await import('../../../../services/worker/src/jobs/repo-clone');
      processRepoClone = repoClone.processRepoClone;
    } catch {
      logger.warn('Could not load repo-clone processor');
    }
  }

  if (!processKnowledgeGraph) {
    try {
      const kg = await import('../../../../services/worker/src/jobs/knowledge-graph');
      processKnowledgeGraph = kg.processKnowledgeGraph;
    } catch {
      logger.warn('Could not load knowledge-graph processor');
    }
  }

  if (!processVectorIndex) {
    try {
      const vi = await import('../../../../services/worker/src/jobs/vector-index');
      processVectorIndex = vi.processVectorIndex;
    } catch {
      logger.warn('Could not load vector-index processor');
    }
  }

  if (!processDocumentGeneration) {
    try {
      const dg = await import('../../../../services/worker/src/jobs/document-generation');
      processDocumentGeneration = dg.processDocumentGeneration;
    } catch {
      logger.warn('Could not load document-generation processor');
    }
  }

  if (!processBlockRegeneration) {
    try {
      const br = await import('../../../../services/worker/src/jobs/block-regeneration');
      processBlockRegeneration = br.processBlockRegeneration;
    } catch {
      logger.warn('Could not load block-regeneration processor');
    }
  }
}

/**
 * Job context for inline execution
 * Provides a mock redis that logs operations instead of failing
 */
function createInlineContext(prisma: PrismaClient): {
  prisma: PrismaClient;
  logger: pino.Logger;
  redis: null;
  executeFollowUpJob: (queueName: string, jobName: string, data: Record<string, unknown>) => Promise<void>;
} {
  return {
    prisma,
    logger,
    redis: null,
    // Follow-up jobs are executed inline
    executeFollowUpJob: async (queueName: string, jobName: string, data: Record<string, unknown>) => {
      logger.info({ queueName, jobName }, 'Executing follow-up job inline');
      await executeJobInline(prisma, queueName, jobName, data);
    },
  };
}

/**
 * Execute a job inline (without Redis)
 */
async function executeJobInline(
  prisma: PrismaClient,
  queueName: string,
  jobName: string,
  data: Record<string, unknown>
): Promise<void> {
  await loadJobProcessors();
  const ctx = createInlineContext(prisma);

  const jobKey = `${queueName}:${jobName}`;
  logger.info({ jobKey, data }, 'Executing job inline');

  try {
    switch (jobKey) {
      case 'repo-processing:clone-repo':
        if (processRepoClone) {
          await processRepoClone(data, ctx);
        } else {
          throw new Error('repo-clone processor not available');
        }
        break;

      case 'repo-processing:build-kg':
        if (processKnowledgeGraph) {
          await processKnowledgeGraph(data, ctx);
        } else {
          throw new Error('knowledge-graph processor not available');
        }
        break;

      case 'repo-processing:build-vector-index':
        if (processVectorIndex) {
          await processVectorIndex(data, ctx);
        } else {
          throw new Error('vector-index processor not available');
        }
        break;

      case 'document-generation:generate-document':
        if (processDocumentGeneration) {
          await processDocumentGeneration(data, ctx);
        } else {
          throw new Error('document-generation processor not available');
        }
        break;

      case 'document-generation:regenerate-block':
        if (processBlockRegeneration) {
          await processBlockRegeneration(data, ctx);
        } else {
          throw new Error('block-regeneration processor not available');
        }
        break;

      default:
        throw new Error(`Unknown job: ${jobKey}`);
    }

    logger.info({ jobKey }, 'Job completed successfully');
  } catch (error) {
    logger.error({ jobKey, error }, 'Job failed');
    throw error;
  }
}

/**
 * Add a job to the queue or execute inline
 *
 * @param queueName - The queue name (e.g., 'repo-processing', 'document-generation')
 * @param jobName - The job name (e.g., 'clone-repo', 'generate-document')
 * @param data - Job data
 * @param options - Job options (only used with Redis)
 */
export async function addJob(
  queueName: string,
  jobName: string,
  data: Record<string, unknown>,
  prisma: PrismaClient,
  options?: {
    jobId?: string;
    attempts?: number;
    delay?: number;
    runInBackground?: boolean;
  }
): Promise<{ queued: boolean; jobId?: string }> {
  initQueues();

  // If Redis is available and we have a queue, use it
  if (isRedisAvailable()) {
    const queue = queueName === 'document-generation' ? generationQueue : repoQueue;

    if (queue) {
      const job = await queue.add(jobName, data, {
        jobId: options?.jobId,
        attempts: options?.attempts || 3,
        delay: options?.delay,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      });

      logger.info({ queueName, jobName, jobId: job.id }, 'Job queued');
      return { queued: true, jobId: job.id };
    }
  }

  // No Redis - execute inline
  if (options?.runInBackground) {
    // Run in background using setImmediate
    setImmediate(async () => {
      try {
        await executeJobInline(prisma, queueName, jobName, data);
      } catch (error) {
        logger.error({ queueName, jobName, error }, 'Background job failed');
      }
    });
    logger.info({ queueName, jobName }, 'Job scheduled for background execution');
    return { queued: false, jobId: `inline-${Date.now()}` };
  } else {
    // Execute synchronously (blocks the request)
    await executeJobInline(prisma, queueName, jobName, data);
    return { queued: false, jobId: `inline-${Date.now()}` };
  }
}

/**
 * Get job status
 */
export async function getJobStatus(
  queueName: string,
  jobId: string
): Promise<{
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'unknown';
  progress?: number;
  error?: string;
}> {
  initQueues();

  if (!isRedisAvailable()) {
    return { status: 'unknown' };
  }

  const queue = queueName === 'document-generation' ? generationQueue : repoQueue;

  if (!queue) {
    return { status: 'unknown' };
  }

  const job = await queue.getJob(jobId);

  if (!job) {
    return { status: 'unknown' };
  }

  const state = await job.getState();
  const progress = job.progress;

  return {
    status: state as 'waiting' | 'active' | 'completed' | 'failed',
    progress: typeof progress === 'number' ? progress : undefined,
    error: job.failedReason,
  };
}

/**
 * Cancel a job
 */
export async function cancelJob(
  queueName: string,
  jobId: string
): Promise<boolean> {
  initQueues();

  if (!isRedisAvailable()) {
    return false;
  }

  const queue = queueName === 'document-generation' ? generationQueue : repoQueue;

  if (!queue) {
    return false;
  }

  const job = await queue.getJob(jobId);

  if (job) {
    await job.remove();
    return true;
  }

  return false;
}

/**
 * Check if the job system is using Redis (queued) or inline execution
 */
export function isUsingQueues(): boolean {
  return isRedisAvailable() && (repoQueue !== null || generationQueue !== null);
}
