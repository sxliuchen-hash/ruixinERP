'use strict';

jest.mock('../src/config/redis', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  eval: jest.fn(),
  ping: jest.fn(),
  on: jest.fn()
}));

const app = require('../src/app');

describe('应用启动顺序', () => {
  test('生产运行配置门禁在数据库、Redis、任务和端口监听之前执行', async () => {
    const events = [];
    const fakeServer = { close: jest.fn() };

    const server = await app.start({
      runtimeConfigCheck: jest.fn(async () => events.push('config')),
      connectDatabases: jest.fn(async () => events.push('database')),
      connectRedis: jest.fn(async () => events.push('redis')),
      startJobs: jest.fn(() => events.push('jobs')),
      listen: jest.fn((_port, callback) => {
        events.push('listen');
        callback();
        return fakeServer;
      })
    });

    expect(server).toBe(fakeServer);
    expect(events).toEqual(['config', 'database', 'redis', 'jobs', 'listen']);
  });

  test('生产运行配置门禁失败时不连接依赖、不启动任务且不监听端口', async () => {
    const configError = Object.assign(new Error('invalid runtime config'), {
      code: 'PRODUCTION_RUNTIME_CONFIG_INVALID'
    });
    const connectDatabases = jest.fn();
    const connectRedis = jest.fn();
    const startJobs = jest.fn();
    const listen = jest.fn();
    const shutdown = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();

    await expect(app.start({
      runtimeConfigCheck: jest.fn().mockRejectedValue(configError),
      connectDatabases,
      connectRedis,
      startJobs,
      listen,
      shutdown,
      exit
    })).resolves.toBeNull();

    expect(connectDatabases).not.toHaveBeenCalled();
    expect(connectRedis).not.toHaveBeenCalled();
    expect(startJobs).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  test('数据库启动失败时由 app.start 统一释放资源后退出', async () => {
    const events = [];
    const databaseError = Object.assign(new Error('safe database failure'), {
      code: 'ERP_DATABASE_UNAVAILABLE'
    });

    await expect(app.start({
      runtimeConfigCheck: jest.fn(async () => events.push('config')),
      connectDatabases: jest.fn(async () => {
        events.push('database');
        throw databaseError;
      }),
      connectRedis: jest.fn(async () => events.push('redis')),
      startJobs: jest.fn(() => events.push('jobs')),
      listen: jest.fn(() => events.push('listen')),
      shutdown: jest.fn(async () => events.push('shutdown')),
      exit: jest.fn((code) => events.push(`exit:${code}`))
    })).resolves.toBeNull();

    expect(events).toEqual(['config', 'database', 'shutdown', 'exit:1']);
  });
});
