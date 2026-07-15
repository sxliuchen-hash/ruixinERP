'use strict';

const { checkReadiness } = require('../src/services/readinessService');

describe('本地 readiness 检查', () => {
  test('配置、数据库和所需 Redis 均可用时 ready', async () => {
    const configCheck = jest.fn().mockResolvedValue({ ok: true });
    const database = { authenticate: jest.fn().mockResolvedValue(true) };
    const redisClient = { ping: jest.fn().mockResolvedValue('PONG') };

    await expect(checkReadiness({
      env: { NODE_ENV: 'production' },
      configCheck,
      database,
      redisClient,
      resolveRedisRequirement: () => ({ required: true, reasons: ['sso'] })
    })).resolves.toEqual({
      ready: true,
      checks: {
        config: { ok: true },
        database: { ok: true },
        redis: { ok: true, required: true, reasons: ['sso'] }
      }
    });
    expect(configCheck).toHaveBeenCalledWith({ env: { NODE_ENV: 'production' } });
    expect(database.authenticate).toHaveBeenCalledTimes(1);
    expect(redisClient.ping).toHaveBeenCalledTimes(1);
  });

  test('Redis 非必需时不连接 Redis', async () => {
    const redisClient = { ping: jest.fn() };
    const result = await checkReadiness({
      env: { NODE_ENV: 'test' },
      configCheck: jest.fn().mockResolvedValue({ ok: true }),
      database: { authenticate: jest.fn().mockResolvedValue(true) },
      redisClient,
      resolveRedisRequirement: () => ({ required: false, reasons: [] })
    });

    expect(result.ready).toBe(true);
    expect(result.checks.redis).toEqual({ ok: true, required: false, reasons: [] });
    expect(redisClient.ping).not.toHaveBeenCalled();
  });

  test('配置、数据库或 Redis 任一失败时 not ready，且不暴露底层错误消息', async () => {
    const secretMessage = 'password=do-not-expose';
    const result = await checkReadiness({
      env: { NODE_ENV: 'production' },
      configCheck: jest.fn().mockRejectedValue(Object.assign(new Error(secretMessage), {
        code: 'PRODUCTION_RUNTIME_CONFIG_INVALID'
      })),
      database: {
        authenticate: jest.fn().mockRejectedValue(Object.assign(new Error(secretMessage), {
          code: 'ECONNREFUSED'
        }))
      },
      redisClient: {
        ping: jest.fn().mockRejectedValue(new Error(secretMessage))
      },
      resolveRedisRequirement: () => ({
        required: true,
        reasons: ['file_tickets', 'employee_provisioning']
      })
    });

    expect(result).toMatchObject({
      ready: false,
      checks: {
        config: { ok: false, code: 'PRODUCTION_RUNTIME_CONFIG_INVALID' },
        database: { ok: false, code: 'ECONNREFUSED' },
        redis: { ok: false, required: true, code: 'REDIS_UNAVAILABLE' }
      }
    });
    expect(JSON.stringify(result)).not.toContain(secretMessage);
  });
});
