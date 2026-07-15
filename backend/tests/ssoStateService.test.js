'use strict';

const {
  SsoStateService,
  STATE_KEY_PREFIX,
  hashValue,
  isValidOpaqueToken,
  normalizeLocalRedirect
} = require('../src/services/ssoStateService');

class AtomicFakeRedis {
  constructor() {
    this.records = new Map();
    this.setCalls = [];
    this.evalCalls = [];
    this.failSet = false;
    this.failEval = false;
  }

  async set(key, value, ex, ttlSec, nx) {
    this.setCalls.push({ key, value, ex, ttlSec, nx });
    if (this.failSet) throw new Error('redis unavailable');
    if (nx === 'NX' && this.records.has(key)) return null;
    this.records.set(key, value);
    return 'OK';
  }

  async eval(_script, numberOfKeys, key, bindingHash) {
    this.evalCalls.push({ numberOfKeys, key, bindingHash });
    if (this.failEval) throw new Error('redis unavailable');

    // Redis Lua 在单线程内原子执行：先读取并删除，再比较浏览器绑定。
    if (!this.records.has(key)) return [0, ''];
    const value = this.records.get(key);
    this.records.delete(key);
    const expectedBindingHash = value.slice(0, 64);
    if (expectedBindingHash !== bindingHash) return [-1, ''];
    return [1, value.slice(65)];
  }
}

describe('ERP RP 浏览器 state 存储与一次性消费', () => {
  test('state 与 browser binding 均为 32 字节随机 opaque token，Redis 只保存哈希键', async () => {
    const redisClient = new AtomicFakeRedis();
    let randomCall = 0;
    const randomBytesFn = jest.fn(() => Buffer.alloc(32, ++randomCall));
    const service = new SsoStateService({ redisClient, ttlSec: 120, randomBytesFn });

    const created = await service.create({ redirect: '/contracts?tab=mine#top' });

    expect(isValidOpaqueToken(created.state)).toBe(true);
    expect(isValidOpaqueToken(created.browserBinding)).toBe(true);
    expect(created.state).not.toBe(created.browserBinding);
    expect(created).toMatchObject({ redirect: '/contracts?tab=mine#top', expiresIn: 120 });
    expect(randomBytesFn).toHaveBeenCalledTimes(2);

    const [write] = redisClient.setCalls;
    expect(write).toMatchObject({
      key: `${STATE_KEY_PREFIX}${hashValue(created.state)}`,
      ex: 'EX',
      ttlSec: 120,
      nx: 'NX'
    });
    expect(write.key).not.toContain(created.state);
    expect(write.value).not.toContain(created.browserBinding);
    expect(write.value.startsWith(`${hashValue(created.browserBinding)}:`)).toBe(true);
  });

  test('同一浏览器可复用 HttpOnly binding，但每次 initiate 都生成不同 state', async () => {
    const redisClient = new AtomicFakeRedis();
    let byte = 10;
    const service = new SsoStateService({
      redisClient,
      randomBytesFn: () => Buffer.alloc(32, byte++)
    });
    const browserBinding = Buffer.alloc(32, 99).toString('base64url');

    const first = await service.create({ browserBinding });
    const second = await service.create({ browserBinding });

    expect(first.browserBinding).toBe(browserBinding);
    expect(second.browserBinding).toBe(browserBinding);
    expect(first.state).not.toBe(second.state);
  });

  test('合法 callback 只消费一次并恢复服务端绑定的内部 redirect', async () => {
    const redisClient = new AtomicFakeRedis();
    const service = new SsoStateService({ redisClient });
    const created = await service.create({ redirect: '/inventory/8?from=sso' });

    await expect(service.consume({
      state: created.state,
      browserBinding: created.browserBinding
    })).resolves.toEqual({ redirect: '/inventory/8?from=sso' });

    await expect(service.consume({
      state: created.state,
      browserBinding: created.browserBinding
    })).rejects.toMatchObject({
      statusCode: 401,
      code: 'SSO_STATE_INVALID'
    });
  });

  test('跨浏览器 callback 被拒绝且 state 立即烧毁，原浏览器也不能随后重放', async () => {
    const redisClient = new AtomicFakeRedis();
    const service = new SsoStateService({ redisClient });
    const browserA = await service.create();
    const browserB = await service.create();

    await expect(service.consume({
      state: browserA.state,
      browserBinding: browserB.browserBinding
    })).rejects.toMatchObject({
      statusCode: 401,
      code: 'SSO_STATE_MISMATCH'
    });

    await expect(service.consume({
      state: browserA.state,
      browserBinding: browserA.browserBinding
    })).rejects.toMatchObject({ code: 'SSO_STATE_INVALID' });
  });

  test('两个并发 callback 对同一 state 最多一个成功', async () => {
    const redisClient = new AtomicFakeRedis();
    const service = new SsoStateService({ redisClient });
    const created = await service.create();

    const results = await Promise.allSettled([
      service.consume({ state: created.state, browserBinding: created.browserBinding }),
      service.consume({ state: created.state, browserBinding: created.browserBinding })
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason).toMatchObject({
      statusCode: 401,
      code: 'SSO_STATE_INVALID'
    });
  });

  test.each([
    [{ state: '', browserBinding: 'b'.repeat(43) }, 400, 'SSO_STATE_INVALID'],
    [{ state: 's'.repeat(43), browserBinding: '' }, 401, 'SSO_STATE_MISSING'],
    [{ state: 'bad state', browserBinding: 'b'.repeat(43) }, 400, 'SSO_STATE_INVALID'],
    [{ state: 's'.repeat(43), browserBinding: 'short' }, 401, 'SSO_STATE_MISSING']
  ])('缺少或非法 state/cookie 在访问 Redis 前 fail-closed: %j', async (input, statusCode, code) => {
    const redisClient = new AtomicFakeRedis();
    const service = new SsoStateService({ redisClient });

    await expect(service.consume(input)).rejects.toMatchObject({ statusCode, code });
    expect(redisClient.evalCalls).toHaveLength(0);
  });

  test('Redis 创建或消费不可用时返回 503，不回退进程内存', async () => {
    const createRedis = new AtomicFakeRedis();
    createRedis.failSet = true;
    const createService = new SsoStateService({ redisClient: createRedis });
    await expect(createService.create()).rejects.toMatchObject({
      statusCode: 503,
      code: 'SSO_STATE_STORE_UNAVAILABLE'
    });

    const consumeRedis = new AtomicFakeRedis();
    const consumeService = new SsoStateService({ redisClient: consumeRedis });
    const created = await consumeService.create();
    consumeRedis.failEval = true;
    await expect(consumeService.consume({
      state: created.state,
      browserBinding: created.browserBinding
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'SSO_STATE_STORE_UNAVAILABLE'
    });
    expect(consumeService).not.toHaveProperty('memory');
  });

  test.each([
    ['https://evil.example/path', ''],
    ['//evil.example/path', ''],
    ['/sso/initiate', ''],
    ['/sso/callback?code=secret', ''],
    ['/contracts', '/contracts'],
    ['/projects/1?tab=cost#detail', '/projects/1?tab=cost#detail']
  ])('redirect 只接受 ERP 内部业务路径: %s', (input, expected) => {
    expect(normalizeLocalRedirect(input)).toBe(expected);
  });
});
