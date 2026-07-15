'use strict';

const { AppError } = require('../utils/errors');

function getLoadedExports(modulePath) {
  try {
    const resolved = require.resolve(modulePath);
    return require.cache[resolved]?.exports || null;
  } catch (_error) {
    return null;
  }
}

async function closeHttpServer(server) {
  if (!server || typeof server.close !== 'function') return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function shutdownRuntime({
  server,
  stopJobs,
  redisClient,
  erpSequelize,
  mainSequelize
} = {}) {
  const failures = [];
  const attempt = async (code, cleanup) => {
    try {
      await cleanup();
    } catch (_error) {
      failures.push(code);
    }
  };

  if (typeof stopJobs === 'function') {
    await attempt('JOBS_STOP_FAILED', () => stopJobs());
  }
  await attempt('HTTP_SERVER_CLOSE_FAILED', () => closeHttpServer(server));

  const resolvedRedis = redisClient === undefined
    ? getLoadedExports('./redis')
    : redisClient;
  if (resolvedRedis) {
    if (typeof resolvedRedis.closeGracefully === 'function') {
      await attempt('REDIS_CLOSE_FAILED', () => resolvedRedis.closeGracefully());
    } else if (typeof resolvedRedis.disconnect === 'function') {
      await attempt('REDIS_CLOSE_FAILED', () => resolvedRedis.disconnect(false));
    }
  }

  const resolvedErp = erpSequelize === undefined
    ? getLoadedExports('./database')?.sequelize
    : erpSequelize;
  if (resolvedErp && typeof resolvedErp.close === 'function') {
    await attempt('ERP_DATABASE_CLOSE_FAILED', () => resolvedErp.close());
  }

  const resolvedMain = mainSequelize === undefined
    ? getLoadedExports('./mainDatabase')?.mainSequelize
    : mainSequelize;
  if (resolvedMain && typeof resolvedMain.close === 'function') {
    await attempt('LEGACY_MAIN_DATABASE_CLOSE_FAILED', () => resolvedMain.close());
  }

  if (failures.length > 0) {
    const error = new AppError('运行资源释放不完整', 500, 'RUNTIME_SHUTDOWN_FAILED');
    error.cleanupCodes = failures;
    throw error;
  }

  return { ok: true };
}

module.exports = {
  getLoadedExports,
  closeHttpServer,
  shutdownRuntime
};
