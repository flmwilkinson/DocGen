/**
 * Inline Job Processor
 *
 * For local/POC mode, jobs are tracked but processed asynchronously
 * without Redis. Uses in-memory state for job tracking.
 *
 * Set QUEUE_MODE=inline to use this (default for local mode).
 *
 * Note: For production, use the full worker with Redis/BullMQ.
 */

import { logger } from './logger';

// In-memory job store
const jobStore = new Map<string, {
  type: string;
  data: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}>();

export type JobType =
  | 'generate-document'
  | 'regenerate-block'
  | 'clone-repo'
  | 'build-kg'
  | 'build-vector-index';

export interface JobData {
  [key: string]: unknown;
}

/**
 * Check if inline processing is enabled
 */
export function isInlineMode(): boolean {
  const queueMode = process.env.QUEUE_MODE || 'inline';
  return queueMode === 'inline';
}

/**
 * Check if Redis queue mode should be used
 */
export function isQueueMode(): boolean {
  return !isInlineMode();
}

/**
 * Create a job entry (for tracking)
 */
export function createJob(jobType: JobType, data: JobData): string {
  const jobId = `${jobType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  jobStore.set(jobId, {
    type: jobType,
    data,
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  logger.info({ jobId, jobType }, 'Job created (inline mode - manual processing required)');

  return jobId;
}

/**
 * Update job status
 */
export function updateJobStatus(
  jobId: string,
  status: 'pending' | 'running' | 'completed' | 'failed',
  result?: unknown,
  error?: string
): void {
  const job = jobStore.get(jobId);
  if (job) {
    job.status = status;
    job.updatedAt = new Date();
    if (result !== undefined) job.result = result;
    if (error !== undefined) job.error = error;
    jobStore.set(jobId, job);
  }
}

/**
 * Get job status
 */
export function getJobStatus(jobId: string): {
  type: string;
  status: string;
  result?: unknown;
  error?: string;
} | null {
  const job = jobStore.get(jobId);
  if (!job) return null;

  return {
    type: job.type,
    status: job.status,
    result: job.result,
    error: job.error,
  };
}

/**
 * Get all pending jobs (for manual processing)
 */
export function getPendingJobs(): Array<{
  jobId: string;
  type: string;
  data: unknown;
}> {
  const pending: Array<{ jobId: string; type: string; data: unknown }> = [];

  for (const [jobId, job] of jobStore.entries()) {
    if (job.status === 'pending') {
      pending.push({
        jobId,
        type: job.type,
        data: job.data,
      });
    }
  }

  return pending;
}

/**
 * Clean up old jobs (call periodically)
 */
export function cleanupOldJobs(maxAgeMs: number = 3600000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [jobId, job] of jobStore.entries()) {
    if (now - job.createdAt.getTime() > maxAgeMs) {
      jobStore.delete(jobId);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Get storage info
 */
export function getQueueInfo(): {
  mode: string;
  jobCount: number;
  pendingCount: number;
} {
  let pendingCount = 0;
  for (const job of jobStore.values()) {
    if (job.status === 'pending') pendingCount++;
  }

  return {
    mode: isInlineMode() ? 'inline' : 'queue',
    jobCount: jobStore.size,
    pendingCount,
  };
}
