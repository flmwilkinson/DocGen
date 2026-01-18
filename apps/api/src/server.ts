import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { logger } from './lib/logger';

// Import routes
import { projectRoutes } from './routes/projects';
import { templateRoutes } from './routes/templates';
import { artifactRoutes } from './routes/artifacts';
import { generationRoutes } from './routes/generation';
import { repoRoutes } from './routes/repo';
import { healthRoutes } from './routes/health';

const PORT = parseInt(process.env.API_PORT || '4000', 10);
const HOST = process.env.API_HOST || '0.0.0.0';

async function buildServer() {
  const app = Fastify({
    logger: logger,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
  });

  // ===========================================
  // Plugins
  // ===========================================

  await app.register(cors, {
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.CORS_ORIGIN 
      : true,
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // Disable for dev
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(multipart, {
    limits: {
      fileSize: parseInt(process.env.MAX_UPLOAD_SIZE_MB || '100', 10) * 1024 * 1024,
    },
  });

  await app.register(websocket);

  // Swagger documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'DocGen.AI API',
        description: 'API for AI-powered documentation generation',
        version: '0.1.0',
      },
      servers: [
        {
          url: `http://localhost:${PORT}`,
          description: 'Development server',
        },
      ],
      tags: [
        { name: 'Health', description: 'Health check endpoints' },
        { name: 'Projects', description: 'Project management' },
        { name: 'Templates', description: 'Template management' },
        { name: 'Artifacts', description: 'File upload and management' },
        { name: 'Repository', description: 'Repository indexing' },
        { name: 'Generation', description: 'Document generation' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // ===========================================
  // Decorators
  // ===========================================

  app.decorate('prisma', prisma);
  app.decorate('redis', redis); // May be null if Redis is unavailable

  // ===========================================
  // Hooks
  // ===========================================

  app.addHook('onRequest', async (request) => {
    // Add request ID if not present
    if (!request.headers['x-request-id']) {
      request.headers['x-request-id'] = crypto.randomUUID();
    }
  });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
    if (redis) {
      try {
        await redis.quit();
      } catch (error) {
        // Ignore errors on shutdown
      }
    }
    logger.info('Server shutting down, connections closed');
  });

  // ===========================================
  // Error Handling
  // ===========================================

  app.setErrorHandler(async (error, request, reply) => {
    logger.error({
      err: error,
      requestId: request.id,
      url: request.url,
      method: request.method,
    });

    // Prisma errors
    if (error.code === 'P2025') {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'The requested resource was not found',
      });
    }

    // Validation errors
    if (error.validation) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: error.message,
        details: error.validation,
      });
    }

    // Default error response
    const statusCode = error.statusCode || 500;
    return reply.status(statusCode).send({
      error: error.name || 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' 
        ? 'An unexpected error occurred' 
        : error.message,
    });
  });

  // ===========================================
  // Routes
  // ===========================================

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(projectRoutes, { prefix: '/api/projects' });
  await app.register(templateRoutes, { prefix: '/api/templates' });
  await app.register(artifactRoutes, { prefix: '/api/artifacts' });
  await app.register(repoRoutes, { prefix: '/api/repo' });
  await app.register(generationRoutes, { prefix: '/api/generation' });

  return app;
}

// ===========================================
// Start Server
// ===========================================

async function start() {
  try {
    const app = await buildServer();
    
    await app.listen({ port: PORT, host: HOST });
    
    logger.info(`🚀 DocGen.AI API running at http://${HOST}:${PORT}`);
    logger.info(`📚 API Documentation at http://${HOST}:${PORT}/docs`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

start();

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma;
    redis: typeof redis | null; // May be null if Redis is unavailable
  }
}

