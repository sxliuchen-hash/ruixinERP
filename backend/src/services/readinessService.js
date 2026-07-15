'use strict';

const { sequelize } = require('../config/database');
const redis = require('../config/redis');
const { getRedisRequirement } = require('../config/runtimeFeatureDependencies');
const { assertProductionRuntimeConfig } = require('./unifiedAuthPreflightService');

function safeFailure(error, fallbackCode) {
  return {
    ok: false,
    code: error?.code || fallbackCode
  };
}

async function checkReadiness({
  env = process.env,
  configCheck = assertProductionRuntimeConfig,
  database = sequelize,
  redisClient = redis,
  resolveRedisRequirement = getRedisRequirement
} = {}) {
  const checks = {
    config: { ok: false },
    database: { ok: false },
    redis: { ok: true, required: false, reasons: [] }
  };

  try {
    await configCheck({ env });
    checks.config = { ok: true };
  } catch (error) {
    checks.config = safeFailure(error, 'RUNTIME_CONFIG_INVALID');
  }

  try {
    await database.authenticate();
    checks.database = { ok: true };
  } catch (error) {
    checks.database = safeFailure(error, 'DATABASE_UNAVAILABLE');
  }

  const redisRequirement = resolveRedisRequirement(env);
  checks.redis = {
    ok: true,
    required: redisRequirement.required,
    reasons: redisRequirement.reasons || []
  };

  if (redisRequirement.required) {
    try {
      const pong = await redisClient.ping();
      if (pong !== 'PONG') throw Object.assign(new Error('unexpected Redis PING response'), {
        code: 'REDIS_PING_INVALID'
      });
    } catch (error) {
      checks.redis = {
        ...checks.redis,
        ...safeFailure(error, 'REDIS_UNAVAILABLE')
      };
    }
  }

  return {
    ready: Object.values(checks).every((check) => check.ok),
    checks
  };
}

module.exports = {
  checkReadiness,
  safeFailure
};
