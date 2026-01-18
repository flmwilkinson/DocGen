import Redis from 'ioredis';
import { logger } from './logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false'; // Default to true, but can disable

let redis: Redis | null = null;
let redisAvailable = false;
let lastErrorLogTime = 0;
const ERROR_LOG_INTERVAL = 60000; // Only log errors once per minute

if (REDIS_ENABLED) {
  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        // Stop retrying after 5 attempts to avoid spam
        if (times > 5) {
          return null; // Stop retrying
        }
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: true, // Don't connect immediately
      enableOfflineQueue: false, // Don't queue commands when offline
    });

    redis.on('connect', () => {
      redisAvailable = true;
      logger.info('Redis connected');
    });

    redis.on('error', (err) => {
      redisAvailable = false;
      // Only log errors once per minute to avoid spam
      const now = Date.now();
      if (now - lastErrorLogTime > ERROR_LOG_INTERVAL) {
        logger.warn({ err: { code: err.code, message: err.message } }, 'Redis connection error (will retry silently)');
        lastErrorLogTime = now;
      }
    });

    redis.on('close', () => {
      redisAvailable = false;
      logger.info('Redis connection closed');
    });

    // Attempt connection (but don't fail if it doesn't work)
    redis.connect().catch(() => {
      // Silently fail - Redis is optional
      logger.info('Redis not available - background job queues will be disabled');
    });
  } catch (error) {
    logger.warn('Failed to initialize Redis - background job queues will be disabled');
    redis = null;
  }
} else {
  logger.info('Redis disabled via REDIS_ENABLED=false');
}

export { redis, redisAvailable };

// Helper to check if Redis is available
export function isRedisAvailable(): boolean {
  return redisAvailable && redis !== null;
}

