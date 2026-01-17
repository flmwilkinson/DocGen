import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'SYS:standard',
        },
      }
    : undefined,
  base: {
    service: 'docgen-api',
    version: process.env.npm_package_version || '0.1.0',
  },
});

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

