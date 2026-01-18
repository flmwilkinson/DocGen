import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Queue } from 'bullmq';
import { redis, isRedisAvailable } from '../lib/redis';

// Initialize queue for repo processing (only if Redis is available)
let repoQueue: Queue | null = null;
if (isRedisAvailable() && redis) {
  repoQueue = new Queue('repo-processing', {
    connection: redis,
  });
}

const CloneRepoSchema = z.object({
  projectId: z.string().uuid(),
  repoUrl: z.string().url(),
  branch: z.string().default('main'),
});

export const repoRoutes: FastifyPluginAsync = async (app) => {
  // Clone/index a repository
  app.post('/clone', {
    schema: {
      tags: ['Repository'],
      summary: 'Clone and index a GitHub repository',
    },
  }, async (request, reply) => {
    const body = CloneRepoSchema.parse(request.body);

    // Verify project exists
    const project = await app.prisma.project.findUnique({
      where: { id: body.projectId },
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Create repo snapshot record
    const snapshot = await app.prisma.repoSnapshot.create({
      data: {
        projectId: body.projectId,
        branch: body.branch,
        status: 'PENDING',
      },
    });

    // Queue the cloning job (if Redis is available)
    if (repoQueue) {
      await repoQueue.add('clone-repo', {
        snapshotId: snapshot.id,
        repoUrl: body.repoUrl,
        branch: body.branch,
      }, {
        jobId: `clone-${snapshot.id}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      });
    } else {
      // If Redis is not available, update status to indicate it needs manual processing
      await app.prisma.repoSnapshot.update({
        where: { id: snapshot.id },
        data: {
          status: 'PENDING',
          // Note: In a production system, you'd want a worker to process this
        },
      });
    }

    // Update project with repo URL
    await app.prisma.project.update({
      where: { id: body.projectId },
      data: { repoUrl: body.repoUrl },
    });

    return reply.status(202).send({
      snapshotId: snapshot.id,
      status: 'PENDING',
      message: 'Repository cloning started',
    });
  });

  // Get repo snapshot status
  app.get('/snapshots/:id', {
    schema: {
      tags: ['Repository'],
      summary: 'Get repository snapshot status',
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

    const snapshot = await app.prisma.repoSnapshot.findUnique({
      where: { id },
      include: {
        knowledgeGraph: {
          select: {
            id: true,
            stats: true,
          },
        },
      },
    });

    if (!snapshot) {
      return reply.status(404).send({ error: 'Snapshot not found' });
    }

    return {
      ...snapshot,
      totalSize: Number(snapshot.totalSize),
    };
  });

  // Get knowledge graph for a snapshot
  app.get('/snapshots/:id/knowledge-graph', {
    schema: {
      tags: ['Repository'],
      summary: 'Get knowledge graph for repository',
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

    const kg = await app.prisma.knowledgeGraph.findUnique({
      where: { repoSnapshotId: id },
    });

    if (!kg) {
      return reply.status(404).send({ error: 'Knowledge graph not found' });
    }

    return kg;
  });

  // Get file manifest
  app.get('/snapshots/:id/manifest', {
    schema: {
      tags: ['Repository'],
      summary: 'Get file manifest for repository',
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

    const snapshot = await app.prisma.repoSnapshot.findUnique({
      where: { id },
      select: {
        fileManifest: true,
        languageStats: true,
        totalFiles: true,
        totalSize: true,
      },
    });

    if (!snapshot) {
      return reply.status(404).send({ error: 'Snapshot not found' });
    }

    return {
      files: snapshot.fileManifest,
      languageStats: snapshot.languageStats,
      totalFiles: snapshot.totalFiles,
      totalSize: Number(snapshot.totalSize),
    };
  });

  // Semantic search over repo
  app.post('/snapshots/:id/search', {
    schema: {
      tags: ['Repository'],
      summary: 'Semantic search over repository content',
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
    const { query, topK = 10, filters } = request.body as {
      query: string;
      topK?: number;
      filters?: { filePatterns?: string[]; languages?: string[] };
    };

    // TODO: Implement actual vector search
    // For now, return placeholder
    
    const chunks = await app.prisma.vectorChunk.findMany({
      where: {
        repoSnapshotId: id,
      },
      take: topK,
    });

    return {
      results: chunks.map((chunk) => ({
        id: chunk.id,
        text: chunk.content,
        sourceRef: {
          type: chunk.sourceType,
          path: chunk.sourcePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
        },
        score: 0.8, // Placeholder score
      })),
      totalResults: chunks.length,
    };
  });

  // List snapshots for a project
  app.get('/', {
    schema: {
      tags: ['Repository'],
      summary: 'List repository snapshots',
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string', format: 'uuid' },
        },
        required: ['projectId'],
      },
    },
  }, async (request) => {
    const { projectId } = request.query as { projectId: string };

    const snapshots = await app.prisma.repoSnapshot.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        commitHash: true,
        branch: true,
        status: true,
        totalFiles: true,
        totalSize: true,
        createdAt: true,
      },
    });

    return {
      data: snapshots.map((s) => ({
        ...s,
        totalSize: Number(s.totalSize),
      })),
    };
  });
};

