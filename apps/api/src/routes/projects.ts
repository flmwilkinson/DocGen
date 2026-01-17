import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  repoUrl: z.string().url().optional(),
  settings: z.record(z.unknown()).optional(),
});

const UpdateProjectSchema = CreateProjectSchema.partial();

export const projectRoutes: FastifyPluginAsync = async (app) => {
  // List projects
  app.get('/', {
    schema: {
      tags: ['Projects'],
      summary: 'List all projects',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20 },
        },
      },
    },
  }, async (request) => {
    const { page = 1, limit = 20 } = request.query as { page?: number; limit?: number };
    const skip = (page - 1) * limit;

    // TODO: Get userId from auth session
    const userId = 'demo-user-id';

    const [projects, total] = await Promise.all([
      app.prisma.project.findMany({
        where: { ownerId: userId },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: {
            select: {
              generationRuns: true,
              artifacts: true,
            },
          },
        },
      }),
      app.prisma.project.count({ where: { ownerId: userId } }),
    ]);

    return {
      data: projects,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  // Get single project
  app.get('/:id', {
    schema: {
      tags: ['Projects'],
      summary: 'Get project by ID',
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

    const project = await app.prisma.project.findUnique({
      where: { id },
      include: {
        repoSnapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        templates: {
          orderBy: { updatedAt: 'desc' },
        },
        generationRuns: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        _count: {
          select: {
            artifacts: true,
            generationRuns: true,
          },
        },
      },
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    return project;
  });

  // Create project
  app.post('/', {
    schema: {
      tags: ['Projects'],
      summary: 'Create new project',
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          repoUrl: { type: 'string' },
          settings: { type: 'object' },
        },
        required: ['name'],
      },
    },
  }, async (request, reply) => {
    const body = CreateProjectSchema.parse(request.body);

    // TODO: Get userId from auth session
    const userId = 'demo-user-id';

    // Ensure demo user exists
    await app.prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: 'demo@docgen.ai',
        name: 'Demo User',
      },
      update: {},
    });

    const project = await app.prisma.project.create({
      data: {
        ...body,
        ownerId: userId,
      },
    });

    return reply.status(201).send(project);
  });

  // Update project
  app.patch('/:id', {
    schema: {
      tags: ['Projects'],
      summary: 'Update project',
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
    const body = UpdateProjectSchema.parse(request.body);

    const project = await app.prisma.project.update({
      where: { id },
      data: body,
    });

    return project;
  });

  // Delete project
  app.delete('/:id', {
    schema: {
      tags: ['Projects'],
      summary: 'Delete project',
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

    await app.prisma.project.delete({
      where: { id },
    });

    return reply.status(204).send();
  });
};

