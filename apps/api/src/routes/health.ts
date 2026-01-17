import { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Health check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            version: { type: 'string' },
            services: {
              type: 'object',
              properties: {
                database: { type: 'string' },
                redis: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const checks = {
      database: 'unknown',
      redis: 'unknown',
    };

    // Check database
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      checks.database = 'healthy';
    } catch {
      checks.database = 'unhealthy';
    }

    // Check Redis
    try {
      await app.redis.ping();
      checks.redis = 'healthy';
    } catch {
      checks.redis = 'unhealthy';
    }

    const allHealthy = Object.values(checks).every((s) => s === 'healthy');

    return reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      services: checks,
    });
  });

  app.get('/ready', {
    schema: {
      tags: ['Health'],
      summary: 'Readiness check',
      response: {
        200: {
          type: 'object',
          properties: {
            ready: { type: 'boolean' },
          },
        },
      },
    },
  }, async () => {
    return { ready: true };
  });
};

