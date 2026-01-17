import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

// Initialize queue for generation
const generationQueue = new Queue('document-generation', {
  connection: redis,
});

const StartGenerationSchema = z.object({
  projectId: z.string().uuid(),
  templateId: z.string().uuid(),
  repoSnapshotId: z.string().uuid().optional(),
  artifactIds: z.array(z.string().uuid()).optional(),
  userContext: z.record(z.unknown()).optional(),
});

export const generationRoutes: FastifyPluginAsync = async (app) => {
  // Start a new generation run
  app.post('/start', {
    schema: {
      tags: ['Generation'],
      summary: 'Start document generation',
    },
  }, async (request, reply) => {
    const body = StartGenerationSchema.parse(request.body);

    // Verify project and template exist
    const [project, template] = await Promise.all([
      app.prisma.project.findUnique({ where: { id: body.projectId } }),
      app.prisma.template.findUnique({ where: { id: body.templateId } }),
    ]);

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    // Create generation run
    const run = await app.prisma.generationRun.create({
      data: {
        projectId: body.projectId,
        templateId: body.templateId,
        repoSnapshotId: body.repoSnapshotId,
        status: 'PENDING',
        inputs: {
          artifactIds: body.artifactIds || [],
          userContext: body.userContext || {},
        },
      },
    });

    // Queue the generation job
    await generationQueue.add('generate-document', {
      runId: run.id,
      templateId: body.templateId,
      repoSnapshotId: body.repoSnapshotId,
      artifactIds: body.artifactIds || [],
      userContext: body.userContext || {},
    }, {
      jobId: `gen-${run.id}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });

    return reply.status(202).send({
      runId: run.id,
      status: 'PENDING',
      message: 'Generation started',
    });
  });

  // Get generation run status
  app.get('/runs/:id', {
    schema: {
      tags: ['Generation'],
      summary: 'Get generation run status',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const run = await app.prisma.generationRun.findUnique({
      where: { id },
      include: {
        template: {
          select: { id: true, name: true },
        },
        documentVersions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        gapQuestions: {
          where: { status: 'OPEN' },
        },
        _count: {
          select: {
            gapQuestions: true,
            agentTraces: true,
          },
        },
      },
    });

    if (!run) {
      return reply.status(404).send({ error: 'Generation run not found' });
    }

    return run;
  });

  // List generation runs for a project
  app.get('/runs', {
    schema: {
      tags: ['Generation'],
      summary: 'List generation runs',
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
        },
        required: ['projectId'],
      },
    },
  }, async (request) => {
    const { projectId, status } = request.query as { 
      projectId: string; 
      status?: string;
    };

    const runs = await app.prisma.generationRun.findMany({
      where: {
        projectId,
        ...(status && { status: status as never }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        template: {
          select: { id: true, name: true },
        },
        _count: {
          select: {
            documentVersions: true,
            gapQuestions: true,
          },
        },
      },
    });

    return { data: runs };
  });

  // Get document version
  app.get('/documents/:id', {
    schema: {
      tags: ['Generation'],
      summary: 'Get document version',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const doc = await app.prisma.documentVersion.findUnique({
      where: { id },
      include: {
        blockOutputs: true,
        generationRun: {
          include: {
            gapQuestions: true,
          },
        },
      },
    });

    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    return doc;
  });

  // Regenerate a specific block
  app.post('/runs/:runId/blocks/:blockId/regenerate', {
    schema: {
      tags: ['Generation'],
      summary: 'Regenerate a specific block',
      params: {
        type: 'object',
        properties: {
          runId: { type: 'string', format: 'uuid' },
          blockId: { type: 'string', format: 'uuid' },
        },
        required: ['runId', 'blockId'],
      },
    },
  }, async (request, reply) => {
    const { runId, blockId } = request.params as { runId: string; blockId: string };

    const run = await app.prisma.generationRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      return reply.status(404).send({ error: 'Generation run not found' });
    }

    // Queue block regeneration
    await generationQueue.add('regenerate-block', {
      runId,
      blockId,
    }, {
      jobId: `regen-${runId}-${blockId}`,
    });

    return {
      message: 'Block regeneration started',
      runId,
      blockId,
    };
  });

  // Answer gap questions
  app.post('/runs/:runId/gaps/:gapId/answer', {
    schema: {
      tags: ['Generation'],
      summary: 'Answer a gap question',
      params: {
        type: 'object',
        properties: {
          runId: { type: 'string', format: 'uuid' },
          gapId: { type: 'string', format: 'uuid' },
        },
        required: ['runId', 'gapId'],
      },
    },
  }, async (request, reply) => {
    const { runId, gapId } = request.params as { runId: string; gapId: string };
    const { answer } = request.body as { answer: string };

    const gap = await app.prisma.gapQuestion.findFirst({
      where: {
        id: gapId,
        generationRunId: runId,
      },
    });

    if (!gap) {
      return reply.status(404).send({ error: 'Gap question not found' });
    }

    // Update gap with answer
    await app.prisma.gapQuestion.update({
      where: { id: gapId },
      data: {
        userAnswer: answer,
        status: 'ANSWERED',
        answeredAt: new Date(),
      },
    });

    // Queue re-evaluation of affected blocks
    if (gap.blockId) {
      await generationQueue.add('regenerate-block', {
        runId,
        blockId: gap.blockId,
        reason: 'gap_answered',
      });
    }

    return {
      message: 'Gap answered, affected blocks will be regenerated',
      gapId,
    };
  });

  // Get agent traces for debugging
  app.get('/runs/:runId/traces', {
    schema: {
      tags: ['Generation'],
      summary: 'Get agent traces for a run',
      params: {
        type: 'object',
        properties: {
          runId: { type: 'string', format: 'uuid' },
        },
        required: ['runId'],
      },
    },
  }, async (request) => {
    const { runId } = request.params as { runId: string };

    const traces = await app.prisma.agentTrace.findMany({
      where: { generationRunId: runId },
      orderBy: { createdAt: 'asc' },
    });

    return { data: traces };
  });

  // Cancel a generation run
  app.post('/runs/:id/cancel', {
    schema: {
      tags: ['Generation'],
      summary: 'Cancel a generation run',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    await app.prisma.generationRun.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date(),
      },
    });

    // Remove from queue if pending
    const job = await generationQueue.getJob(`gen-${id}`);
    if (job) {
      await job.remove();
    }

    return { message: 'Generation run cancelled' };
  });
};

