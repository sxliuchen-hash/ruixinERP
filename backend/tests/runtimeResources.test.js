'use strict';

const { shutdownRuntime } = require('../src/config/runtimeResources');

describe('运行资源集中释放', () => {
  test('单项释放失败时仍继续释放其余资源并返回安全聚合错误', async () => {
    const stopJobs = jest.fn(() => { throw new Error('job detail'); });
    const server = {
      close: jest.fn((callback) => callback(new Error('server detail')))
    };
    const redisClient = {
      closeGracefully: jest.fn().mockRejectedValue(new Error('redis detail'))
    };
    const erpSequelize = {
      close: jest.fn().mockRejectedValue(new Error('erp db detail'))
    };
    const mainSequelize = {
      close: jest.fn().mockResolvedValue(undefined)
    };

    await expect(shutdownRuntime({
      server,
      stopJobs,
      redisClient,
      erpSequelize,
      mainSequelize
    })).rejects.toMatchObject({
      statusCode: 500,
      code: 'RUNTIME_SHUTDOWN_FAILED',
      cleanupCodes: [
        'JOBS_STOP_FAILED',
        'HTTP_SERVER_CLOSE_FAILED',
        'REDIS_CLOSE_FAILED',
        'ERP_DATABASE_CLOSE_FAILED'
      ]
    });

    expect(stopJobs).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(redisClient.closeGracefully).toHaveBeenCalledTimes(1);
    expect(erpSequelize.close).toHaveBeenCalledTimes(1);
    expect(mainSequelize.close).toHaveBeenCalledTimes(1);
  });

  test('全部资源释放成功时返回 ok', async () => {
    const redisClient = { disconnect: jest.fn() };
    const result = await shutdownRuntime({
      server: null,
      stopJobs: jest.fn(),
      redisClient,
      erpSequelize: { close: jest.fn().mockResolvedValue(undefined) },
      mainSequelize: { close: jest.fn().mockResolvedValue(undefined) }
    });

    expect(result).toEqual({ ok: true });
    expect(redisClient.disconnect).toHaveBeenCalledWith(false);
  });
});
