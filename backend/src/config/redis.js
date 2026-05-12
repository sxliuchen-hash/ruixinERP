const Redis = require('ioredis');
const logger = require('../utils/logger');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  keyPrefix: 'erp:',
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 3) {
      logger.warn('Redis 不可用，缓存功能已禁用（不影响核心业务）');
      return null; // 停止重试
    }
    const delay = Math.min(times * 200, 2000);
    return delay;
  }
});

redis.on('connect', () => {
  logger.info('Redis 连接成功');
});

redis.on('error', (error) => {
  logger.error('Redis 连接错误:', error);
});

module.exports = redis;
