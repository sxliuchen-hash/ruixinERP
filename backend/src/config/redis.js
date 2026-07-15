const Redis = require('ioredis');
const logger = require('../utils/logger');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  keyPrefix: 'erp:',
  lazyConnect: true,
  connectTimeout: 5000,
  commandTimeout: 5000,
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 3) {
      logger.warn('Redis 重试次数已耗尽，依赖 Redis 的功能将保持不可用');
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
  logger.error('Redis 连接错误', {
    name: error?.name || 'Error',
    code: error?.code || 'REDIS_ERROR'
  });
});

async function closeGracefully() {
  if (redis.status === 'end') return;
  if (redis.status === 'ready') {
    try {
      await redis.quit();
      return;
    } catch (_error) {
      // quit 失败时强制断开，避免进程退出留下开放句柄。
    }
  }
  redis.disconnect(false);
}

Object.defineProperty(redis, 'closeGracefully', {
  value: closeGracefully,
  enumerable: false
});

module.exports = redis;
