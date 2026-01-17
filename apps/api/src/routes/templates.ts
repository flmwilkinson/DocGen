import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { TemplateSchema } from '@docgen/shared';

const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  projectId: z.string().uuid().optional(),
  templateJson: TemplateSchema,
  isPublic: z.boolean().default(false),
});

export const templateRoutes: FastifyPluginAsync = async (app) => {
  // List templates
  app.get('/', {
    schema: {
      tags: ['Templates'],
      summary: 'List templates',
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          includePublic: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request) => {
    const { projectId, includePublic = true } = request.query as { 
      projectId?: string; 
      includePublic?: boolean;
    };

    // TODO: Get userId from auth session
    const userId = 'demo-user-id';

    const where = {
      OR: [
        { createdById: userId },
        ...(includePublic ? [{ isPublic: true }] : []),
        ...(projectId ? [{ projectId }] : []),
      ],
    };

    const templates = await app.prisma.template.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { generationRuns: true },
        },
      },
    });

    return { data: templates };
  });

  // Get template by ID
  app.get('/:id', {
    schema: {
      tags: ['Templates'],
      summary: 'Get template by ID',
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

    const template = await app.prisma.template.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    return template;
  });

  // Create template
  app.post('/', {
    schema: {
      tags: ['Templates'],
      summary: 'Create new template',
    },
  }, async (request, reply) => {
    const body = CreateTemplateSchema.parse(request.body);

    // TODO: Get userId from auth session
    const userId = 'demo-user-id';

    const template = await app.prisma.template.create({
      data: {
        name: body.name,
        description: body.description,
        projectId: body.projectId,
        templateJson: body.templateJson as object,
        isPublic: body.isPublic,
        createdById: userId,
      },
    });

    return reply.status(201).send(template);
  });

  // Update template
  app.patch('/:id', {
    schema: {
      tags: ['Templates'],
      summary: 'Update template',
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
    const body = CreateTemplateSchema.partial().parse(request.body);

    const template = await app.prisma.template.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.templateJson && { templateJson: body.templateJson as object }),
        ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
        version: { increment: 1 },
      },
    });

    return template;
  });

  // Delete template
  app.delete('/:id', {
    schema: {
      tags: ['Templates'],
      summary: 'Delete template',
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

    await app.prisma.template.delete({
      where: { id },
    });

    return reply.status(204).send();
  });

  // Validate template JSON
  app.post('/validate', {
    schema: {
      tags: ['Templates'],
      summary: 'Validate template JSON',
    },
  }, async (request, reply) => {
    try {
      const templateJson = TemplateSchema.parse(request.body);
      return { valid: true, template: templateJson };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          valid: false,
          errors: error.errors,
        });
      }
      throw error;
    }
  });
};

