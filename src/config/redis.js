/**
 * Redis Client Module
 * --------------------
 * Creates and exports a shared Redis client (ioredis).
 * Used for market data caching and BullMQ queue backend.
 */

const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');

// Create the primary Redis client
const redisClient = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  db: config.redis.db,
  maxRetriesPerRequest: null,      // Required for BullMQ compatibility
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    logger.warn(`Redis reconnecting... attempt ${times}, delay ${delay}ms`);
    return delay;
  },
});

redisClient.on('connect', () => {
  logger.info(`✅ Redis connected: ${config.redis.host}:${config.redis.port}`);
});

redisClient.on('error', (err) => {
  logger.error('Redis connection error:', err.message);
});

redisClient.on('close', () => {
  logger.warn('Redis connection closed.');
});

/**
 * Cache helpers for market data
 */
const cache = {
  /**
   * Set a cached value with optional TTL (seconds).
   */
  async set(key, value, ttlSeconds = config.scheduler.marketDataCacheTtl) {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await redisClient.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await redisClient.set(key, serialized);
    }
  },

  /**
   * Get a cached value, returns null if not found or expired.
   */
  async get(key) {
    const data = await redisClient.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  },

  /**
   * Delete a cached key.
   */
  async del(key) {
    await redisClient.del(key);
  },

  /**
   * Get all keys matching a pattern (use sparingly).
   */
  async keys(pattern) {
    return redisClient.keys(pattern);
  },
};

module.exports = { redisClient, cache };
