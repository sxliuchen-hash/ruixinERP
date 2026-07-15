'use strict';

const { AppError } = require('../utils/errors');
const { getRedisRequirement } = require('./runtimeFeatureDependencies');

async function connectRequiredRedis({ redisClient, env = process.env } = {}) {
  const requirement = getRedisRequirement(env);
  if (!requirement.required) {
    return { redisRequired: false, redisConnected: false, reasons: [] };
  }

  const client = redisClient || require('./redis');
  try {
    const pong = await client.ping();
    if (pong !== 'PONG') throw new Error('unexpected Redis PING response');
    return { redisRequired: true, redisConnected: true, reasons: requirement.reasons };
  } catch (_error) {
    if (typeof client.closeGracefully === 'function') {
      await client.closeGracefully().catch(() => undefined);
    } else if (typeof client.disconnect === 'function') {
      client.disconnect(false);
    }
    throw new AppError(
      '统一认证依赖的 Redis 无法连接',
      503,
      'REDIS_REQUIRED_UNAVAILABLE'
    );
  }
}

module.exports = { connectRequiredRedis };
