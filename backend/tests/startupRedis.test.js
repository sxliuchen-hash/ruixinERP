'use strict';

const { getRedisRequirement } = require('../src/config/runtimeFeatureDependencies');
const { connectRequiredRedis } = require('../src/config/startupRedis');

describe('运行功能 Redis 启动依赖', () => {
  test('生产环境即使关闭 SSO，文件票据和 Employee 建档仍要求 Redis', async () => {
    const env = {
      NODE_ENV: 'production',
      ENABLE_SSO_LOGIN: 'false'
    };
    expect(getRedisRequirement(env)).toEqual({
      required: true,
      reasons: ['file_tickets', 'employee_provisioning']
    });

    const redisClient = { ping: jest.fn().mockResolvedValue('PONG') };
    await expect(connectRequiredRedis({ redisClient, env })).resolves.toEqual({
      redisRequired: true,
      redisConnected: true,
      reasons: ['file_tickets', 'employee_provisioning']
    });
  });

  test('非生产且未开启 SSO 时保持可跳过 Redis', async () => {
    const env = { NODE_ENV: 'test', ENABLE_SSO_LOGIN: 'false' };
    const redisClient = { ping: jest.fn() };

    await expect(connectRequiredRedis({ redisClient, env })).resolves.toEqual({
      redisRequired: false,
      redisConnected: false,
      reasons: []
    });
    expect(redisClient.ping).not.toHaveBeenCalled();
  });

  test('所需 Redis 不可用时启动明确失败', async () => {
    const env = { NODE_ENV: 'production', ENABLE_SSO_LOGIN: 'true' };
    const redisClient = {
      ping: jest.fn().mockRejectedValue(new Error('offline')),
      disconnect: jest.fn()
    };

    await expect(connectRequiredRedis({ redisClient, env })).rejects.toMatchObject({
      statusCode: 503,
      code: 'REDIS_REQUIRED_UNAVAILABLE'
    });
    expect(redisClient.disconnect).toHaveBeenCalledWith(false);
  });
});
