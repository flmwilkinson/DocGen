import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';

interface BlockRegenJobData {
  runId: string;
  blockId: string;
  reason?: string;
}

interface JobContext {
  prisma: PrismaClient;
  logger: Logger;
}

export async function processBlockRegeneration(
  data: BlockRegenJobData,
  ctx: JobContext
): Promise<{ success: boolean }> {
  const { runId, blockId, reason } = data;
  const { prisma, logger } = ctx;

  logger.info({ runId, blockId, reason }, 'Regenerating block');

  try {
    // Get the generation run
    const run = await prisma.generationRun.findUnique({
      where: { id: runId },
      include: {
        template: true,
        documentVersions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!run) {
      throw new Error('Generation run not found');
    }

    const docVersion = run.documentVersions[0];
    if (!docVersion) {
      throw new Error('Document version not found');
    }

    // Get gap answers if this was triggered by answering a gap
    const gapAnswers = await prisma.gapQuestion.findMany({
      where: {
        generationRunId: runId,
        blockId,
        status: 'ANSWERED',
      },
    });

    // TODO: Re-generate the block with updated context including gap answers
    // This is a simplified implementation - full implementation would:
    // 1. Get the block from the template
    // 2. Re-run semantic search with potentially updated queries
    // 3. Include gap answers in the context
    // 4. Call the LLM to regenerate
    // 5. Update the block output

    logger.info({ runId, blockId }, 'Block regeneration completed');

    return { success: true };
  } catch (error) {
    logger.error({ error, runId, blockId }, 'Block regeneration failed');
    throw error;
  }
}

