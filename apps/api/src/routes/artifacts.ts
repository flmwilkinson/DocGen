import { FastifyPluginAsync } from 'fastify';
import { uploadFile, getFile, deleteFile, generateStorageKey } from '../lib/storage';
import { getMimeType, getFileExtension } from '@docgen/shared';

export const artifactRoutes: FastifyPluginAsync = async (app) => {
  // List artifacts for a project
  app.get('/', {
    schema: {
      tags: ['Artifacts'],
      summary: 'List artifacts',
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string', format: 'uuid' },
          type: { type: 'string' },
        },
        required: ['projectId'],
      },
    },
  }, async (request) => {
    const { projectId, type } = request.query as { 
      projectId: string; 
      type?: string;
    };

    const artifacts = await app.prisma.artifact.findMany({
      where: {
        projectId,
        ...(type && { type: type as never }),
      },
      orderBy: { createdAt: 'desc' },
    });

    return { data: artifacts };
  });

  // Upload artifact
  app.post('/upload', {
    schema: {
      tags: ['Artifacts'],
      summary: 'Upload a file artifact',
      querystring: {
        type: 'object',
        properties: {
          projectId: { type: 'string', format: 'uuid' },
        },
        required: ['projectId'],
      },
    },
  }, async (request, reply) => {
    const { projectId } = request.query as { projectId: string };

    // Verify project exists
    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const filename = data.filename;
    const extension = getFileExtension(filename);
    const mimeType = data.mimetype || getMimeType(extension);
    const buffer = await data.toBuffer();
    const size = buffer.length;

    // Generate storage key and upload
    const storageKey = generateStorageKey(projectId, filename);
    await uploadFile(storageKey, buffer, mimeType);

    // Create artifact record
    const artifact = await app.prisma.artifact.create({
      data: {
        projectId,
        type: 'UPLOADED_FILE',
        filename: storageKey.split('/').pop()!,
        originalFilename: filename,
        mimeType,
        size: BigInt(size),
        storageKey,
        metadata: {
          extension,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    return reply.status(201).send({
      id: artifact.id,
      filename: artifact.originalFilename,
      mimeType: artifact.mimeType,
      size: Number(artifact.size),
      createdAt: artifact.createdAt,
    });
  });

  // Download artifact
  app.get('/:id/download', {
    schema: {
      tags: ['Artifacts'],
      summary: 'Download artifact file',
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

    const artifact = await app.prisma.artifact.findUnique({
      where: { id },
    });

    if (!artifact) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }

    const { body, contentType } = await getFile(artifact.storageKey);

    return reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `attachment; filename="${artifact.originalFilename || artifact.filename}"`)
      .send(body);
  });

  // Delete artifact
  app.delete('/:id', {
    schema: {
      tags: ['Artifacts'],
      summary: 'Delete artifact',
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

    const artifact = await app.prisma.artifact.findUnique({
      where: { id },
    });

    if (!artifact) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }

    // Delete from storage
    await deleteFile(artifact.storageKey);

    // Delete record
    await app.prisma.artifact.delete({
      where: { id },
    });

    return reply.status(204).send();
  });

  // Get artifact metadata
  app.get('/:id', {
    schema: {
      tags: ['Artifacts'],
      summary: 'Get artifact metadata',
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

    const artifact = await app.prisma.artifact.findUnique({
      where: { id },
    });

    if (!artifact) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }

    return {
      ...artifact,
      size: Number(artifact.size),
    };
  });
};

