'use strict';

const { AppError } = require('../src/utils/errors');
const {
  SsoStateService,
  STATE_KEY_PREFIX,
  hashValue,
  normalizeLocalRedirect
} = require('../src/services/ssoStateService');
const ssoStateService = require('../src/services/ssoStateService');
const mainSsoService = require('../src/services/mainSsoService');
const ssoController = require('../src/controllers/ssoController');
const { assertMainSsoInitiationConfig } = require('../src/config/mainSso');

class AtomicRedisFake {
  constructor() {
    this.values = new Map();
    this.setCalls = [];
    this.evalCalls = [];
  }

  async set(key, value, ...args) {
    this.setCalls.push([key, value, ...args]);
    if (this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async eval(_script, keyCount, key, bindingHash) {
    this.evalCalls.push([keyCount, key, bindingHash]);
    const value = this.values.get(key);
    if (!value) return [0, ''];
    this.values.delete(key);
    if (value.slice(0, 64) !== bindingHash) return [-1, ''];
    return [1, value.slice(65)];
  }
}

describe('ERP SSO state 服务端浏览器绑定', () => {
  test('创建 32 字节随机 state，仅使用哈希 Redis key 并设置 EX/NX', async () => {
    const redisClient = new AtomicRedisFake();
    const service = new SsoStateService({ redisClient, ttlSec: 120 });

    const result = await service.create({ redirect: '/contracts/42?tab=files' });

    expect(result.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.browserBinding).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result).toMatchObject({ redirect: '/contracts/42?tab=files', expiresIn: 120 });
    expect(redisClient.setCalls).toHaveLength(1);
    expect(redisClient.setCalls[0]).toEqual([
      `${STATE_KEY_PREFIX}${hashValue(result.state)}`,
      expect.stringMatching(/^[a-f0-9]{64}:/),
      'EX',
      120,
      'NX'
    ]);
    expect(redisClient.setCalls[0][0]).not.toContain(result.state);
    expect(redisClient.setCalls[0][1]).not.toContain(result.browserBinding);
  });

  test('同浏览器只能原子消费一次，并恢复服务端绑定的本地 redirect', async () => {
    const redisClient = new AtomicRedisFake();
    const service = new SsoStateService({ redisClient });
    const created = await service.create({ redirect: '/payments?page=2' });

    const results = await Promise.allSettled([
      service.consume({ state: created.state, browserBinding: created.browserBinding }),
      service.consume({ state: created.state, browserBinding: created.browserBinding })
    ]);

    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((item) => item.status === 'fulfilled').value).toEqual({
      redirect: '/payments?page=2'
    });
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect(results.find((item) => item.status === 'rejected').reason).toMatchObject({
      statusCode: 401,
      code: 'SSO_STATE_INVALID'
    });
  });

  test('跨浏览器消费失败且 state 同样被销毁', async () => {
    const redisClient = new AtomicRedisFake();
    const service = new SsoStateService({ redisClient });
    const created = await service.create();
    const otherBrowser = Buffer.alloc(32, 7).toString('base64url');

    await expect(service.consume({
      state: created.state,
      browserBinding: otherBrowser
    })).rejects.toMatchObject({ statusCode: 401, code: 'SSO_STATE_MISMATCH' });
    await expect(service.consume({
      state: created.state,
      browserBinding: created.browserBinding
    })).rejects.toMatchObject({ statusCode: 401, code: 'SSO_STATE_INVALID' });
  });

  test('缺 Cookie、非法 state 与 Redis 故障全部 fail-closed', async () => {
    const redisClient = new AtomicRedisFake();
    const service = new SsoStateService({ redisClient });
    const created = await service.create();

    await expect(service.consume({ state: created.state })).rejects.toMatchObject({
      statusCode: 401,
      code: 'SSO_STATE_MISSING'
    });
    await expect(service.consume({ state: 'bad', browserBinding: created.browserBinding }))
      .rejects.toMatchObject({ statusCode: 400, code: 'SSO_STATE_INVALID' });

    const unavailable = new SsoStateService({
      redisClient: {
        set: jest.fn().mockRejectedValue(new Error('redis down')),
        eval: jest.fn().mockRejectedValue(new Error('redis down'))
      }
    });
    await expect(unavailable.create()).rejects.toMatchObject({
      statusCode: 503,
      code: 'SSO_STATE_STORE_UNAVAILABLE'
    });
    await expect(unavailable.consume({
      state: created.state,
      browserBinding: created.browserBinding
    })).rejects.toMatchObject({ statusCode: 503, code: 'SSO_STATE_STORE_UNAVAILABLE' });
  });

  test.each([
    ['https://evil.example/path', ''],
    ['//evil.example/path', ''],
    ['/sso/callback?code=secret', ''],
    ['/projects/8?tab=cost', '/projects/8?tab=cost']
  ])('redirect %s 归一化为 %s', (input, expected) => {
    expect(normalizeLocalRedirect(input)).toBe(expected);
  });
});

describe('ERP SSO state HTTP 控制器契约', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_SSO_LOGIN = 'true';
    process.env.MAIN_SYSTEM_URL = 'https://main.example.test';
    process.env.MAIN_SSO_CONTINUE_PATH = '/sso/continue';
    process.env.ERP_SSO_CALLBACK_URL = 'http://localhost:5173/sso/callback';
    process.env.ERP_SSO_CLIENT_ID = 'erp-sso';
    process.env.ERP_SSO_CLIENT_SECRET = 'sso-secret';
    process.env.ERP_SSO_ACTIVE_KID = 'main-active';
    process.env.ERP_SSO_ACTIVE_PUBLIC_KEY = 'test-public-key';
    process.env.ERP_SESSION_SECRET = 'test-session-secret';
    process.env.ERP_SSO_STATE_TTL_SEC = '120';
    process.env.ERP_SSO_STATE_COOKIE_NAME = 'erp_sso_browser';
    delete process.env.ERP_SSO_PREVIOUS_KID;
    delete process.env.ERP_SSO_PREVIOUS_PUBLIC_KEY;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test('initiate 设置 HttpOnly/SameSite Cookie 并返回固定主项目 continue 地址', async () => {
    const state = 's'.repeat(43);
    const browserBinding = 'b'.repeat(43);
    jest.spyOn(ssoStateService, 'create').mockResolvedValue({
      state,
      browserBinding,
      expiresIn: 120
    });
    const req = {
      headers: { cookie: `erp_sso_browser=${browserBinding}` },
      body: { redirect: '/contracts/42' }
    };
    const res = { cookie: jest.fn(), json: jest.fn() };
    const next = jest.fn();

    await ssoController.initiate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(ssoStateService.create).toHaveBeenCalledWith({
      browserBinding,
      redirect: '/contracts/42'
    });
    expect(res.cookie).toHaveBeenCalledWith('erp_sso_browser', browserBinding, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 120000
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        state,
        redirectUrl: `https://main.example.test/sso/continue?app=erp&state=${state}`,
        continueUrl: `https://main.example.test/sso/continue?app=erp&state=${state}`,
        expiresIn: 120
      }
    });
  });

  test('exchange 必须先消费 state，再向主项目发送 code+state', async () => {
    const state = 's'.repeat(43);
    const browserBinding = 'b'.repeat(43);
    const consumeSpy = jest.spyOn(ssoStateService, 'consume').mockResolvedValue({
      redirect: '/payments'
    });
    const exchangeSpy = jest.spyOn(mainSsoService, 'exchangeCode').mockResolvedValue({
      token: 'erp-session',
      user: { id: 42 }
    });
    const req = {
      headers: { cookie: `erp_sso_browser=${browserBinding}` },
      body: { code: 'c'.repeat(43), state }
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await ssoController.exchange(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(consumeSpy).toHaveBeenCalledWith({ state, browserBinding });
    expect(exchangeSpy).toHaveBeenCalledWith('c'.repeat(43), state);
    expect(consumeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      exchangeSpy.mock.invocationCallOrder[0]
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ redirect: '/payments' })
    }));
  });

  test('state 校验失败时绝不请求主项目', async () => {
    jest.spyOn(ssoStateService, 'consume').mockRejectedValue(
      new AppError('state mismatch', 401, 'SSO_STATE_MISMATCH')
    );
    const exchangeSpy = jest.spyOn(mainSsoService, 'exchangeCode');
    const req = {
      headers: { cookie: `erp_sso_browser=${'b'.repeat(43)}` },
      body: { code: 'c'.repeat(43), state: 's'.repeat(43) }
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await ssoController.exchange(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'SSO_STATE_MISMATCH' }));
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test.each([
    [{ mainSystemUrl: 'https://user:pass@main.example.test' }, '主项目浏览器地址无效'],
    [{ mainSystemUrl: 'https://main.example.test/base' }, '主项目浏览器地址无效'],
    [{ mainSystemUrl: 'https://main.example.test?tenant=1' }, '主项目浏览器地址无效'],
    [{ mainSystemUrl: 'https://main.example.test#fragment' }, '主项目浏览器地址无效'],
    [{ callbackUrl: 'http://localhost:5173/wrong' }, 'ERP SSO 回调地址无效'],
    [{ callbackUrl: 'ftp://localhost/sso/callback' }, 'ERP SSO 回调地址无效'],
    [{ callbackUrl: 'http://localhost:5173/sso/callback?tenant=1' }, 'ERP SSO 回调地址无效'],
    [{ callbackUrl: 'http://user:pass@localhost:5173/sso/callback' }, 'ERP SSO 回调地址无效'],
    [{ continuePath: '//evil.example/sso/continue' }, '主项目 SSO continue 路径无效'],
    [{ continuePath: '/sso\\continue' }, '主项目 SSO continue 路径无效'],
    [{ continuePath: '/sso/continue\n' }, '主项目 SSO continue 路径无效']
  ])('运行时拒绝异常主项目 URL/continue 路径 %#', (overrides, message) => {
    const base = {
      clientId: 'erp-sso',
      clientSecret: 'sso-secret',
      publicKeys: { 'main-active': 'test-key' },
      activeKid: 'main-active',
      callbackUrl: 'http://localhost:5173/sso/callback',
      mainSystemUrl: 'https://main.example.test',
      continuePath: '/sso/continue',
      stateTtlSec: 120,
      stateCookieName: 'erp_sso_browser',
      sessionSecret: 'session-secret',
      assertionMaxLifetimeSec: 120
    };
    expect(() => assertMainSsoInitiationConfig({ ...base, ...overrides })).toThrow(message);
  });

  test('生产运行时拒绝占位主项目 Origin', () => {
    process.env.NODE_ENV = 'production';
    const config = {
      clientId: 'erp-sso',
      clientSecret: 'sso-secret',
      publicKeys: { 'main-active': 'test-key' },
      activeKid: 'main-active',
      callbackUrl: 'https://erp.iptt.top/sso/callback',
      mainSystemUrl: 'https://main-project.example.com',
      continuePath: '/sso/continue',
      stateTtlSec: 120,
      stateCookieName: 'erp_sso_browser',
      sessionSecret: 'session-secret',
      assertionMaxLifetimeSec: 120
    };

    expect(() => assertMainSsoInitiationConfig(config)).toThrow('主项目浏览器地址无效');
  });

  test('生产运行时拒绝占位 callback 域名', () => {
    process.env.NODE_ENV = 'production';
    const config = {
      clientId: 'erp-sso',
      clientSecret: 'sso-secret',
      publicKeys: { 'main-active': 'test-key' },
      activeKid: 'main-active',
      callbackUrl: 'https://erp.example.test/sso/callback',
      mainSystemUrl: 'https://main.test.internal',
      continuePath: '/sso/continue',
      stateTtlSec: 120,
      stateCookieName: 'erp_sso_browser',
      assertionMaxLifetimeSec: 120,
      sessionSecret: 'erp-session-secret'
    };
    process.env.ERP_SESSION_SECRET = 'erp-session-secret';
    delete process.env.JWT_SECRET;

    expect(() => assertMainSsoInitiationConfig(config)).toThrow('ERP SSO 回调地址无效');
  });
});
