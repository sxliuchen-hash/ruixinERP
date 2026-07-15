const { generateKeyPairSync } = require('crypto');
const jwt = require('jsonwebtoken');
const { MainSsoService: ProductionMainSsoService } = require('../src/services/mainSsoService');
const { SsoAssertionReplayGuard } = require('../src/services/ssoAssertionReplayGuard');
const { readPublicKeyring } = require('../src/config/mainSso');
const mainPermissionVersionService = require('../src/services/mainPermissionVersionService');
const mainUserScopeService = require('../src/services/mainUserScopeService');
const { PERMISSIONS } = require('../src/permissions/permissionCodes');
const { decodePermissionGrants } = require('../src/permissions/permissionGrant');

const VALID_STATE = 's'.repeat(43);

class MainSsoService extends ProductionMainSsoService {
  exchangeCode(code, state = VALID_STATE) {
    return super.exchangeCode(code, state);
  }
}

describe('主项目 SSO 授权码兑换', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const { privateKey: previousPrivateKey, publicKey: previousPublicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const originalEnv = { ...process.env };
  const sessionSecret = 'erp-test-session-secret-with-enough-entropy';

  function configureSso() {
    process.env.ENABLE_SSO_LOGIN = 'true';
    process.env.MAIN_SSO_BASE_URL = 'https://main.example.test/';
    process.env.MAIN_SSO_EXCHANGE_PATH = '/api/v1/internal/sso/erp/exchange';
    process.env.ERP_SSO_CLIENT_ID = 'erp-test-client';
    process.env.ERP_SSO_CLIENT_SECRET = 'erp-test-secret';
    process.env.ERP_SSO_ACTIVE_KID = 'main-active';
    process.env.ERP_SSO_ACTIVE_PUBLIC_KEY = publicKey;
    process.env.ERP_SSO_PREVIOUS_KID = 'main-previous';
    process.env.ERP_SSO_PREVIOUS_PUBLIC_KEY = previousPublicKey;
    process.env.ERP_SSO_ALLOW_LEGACY_NO_KID = 'false';
    process.env.ERP_SSO_ISSUER = 'patent-notice-system';
    process.env.ERP_SSO_AUDIENCE = 'erp';
    process.env.JWT_SECRET = sessionSecret;
    process.env.ERP_SESSION_SECRET = sessionSecret;
    process.env.ERP_SESSION_EXPIRES_IN = '15m';
  }

  function signAssertion(overrides = {}, signOptions = {}) {
    const { omitKid = false, ...jwtOptions } = signOptions;
    const payload = {
      username: 'supervisor01',
      role: 'supervisor',
      realName: '测试主管',
      permissions: {
        [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' },
        [PERMISSIONS.CONTRACT_VIEW]: { allowed: true, scope: 'team' },
        'erp.unknown.execute': { allowed: true, scope: 'all' }
      },
      permissionVersion: 9,
      ...overrides
    };

    return jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      issuer: 'patent-notice-system',
      audience: 'erp',
      subject: '42',
      jwtid: 'assertion-jti-001',
      expiresIn: '60s',
      ...(!omitKid && { keyid: 'main-active' }),
      ...jwtOptions
    });
  }

  beforeEach(() => {
    configureSso();
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

  test.each([
    ['previous kid 缺少公钥', () => { delete process.env.ERP_SSO_PREVIOUS_PUBLIC_KEY; }],
    ['previous 公钥缺少 kid', () => { delete process.env.ERP_SSO_PREVIOUS_KID; }]
  ])('运行时配置中%s时立即拒绝', (_label, mutate) => {
    mutate();
    expect(() => readPublicKeyring()).toThrow(
      expect.objectContaining({ code: 'SSO_CONFIGURATION_ERROR', statusCode: 503 })
    );
  });

  test('只有 previous 公钥而 active kid 无对应公钥时拒绝启动兑换', async () => {
    delete process.env.ERP_SSO_ACTIVE_PUBLIC_KEY;
    const httpClient = { post: jest.fn() };
    const service = new MainSsoService({ httpClient });

    await expect(service.exchangeCode('missing-active-key-code-12345')).rejects.toMatchObject({
      statusCode: 503,
      code: 'SSO_CONFIGURATION_ERROR'
    });
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  test('成功兑换时只信任 assertion 内签名权限并签发 ERP 专用会话', async () => {
    const permissionCacheSpy = jest.spyOn(mainPermissionVersionService, 'clearCache');
    const teamCacheSpy = jest.spyOn(mainUserScopeService, 'clearCache');
    const assertion = signAssertion();
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          data: {
            assertion,
            // 外层字段没有 assertion 签名保护，必须被忽略。
            permissions: {
              [PERMISSIONS.PAYROLL_PAY]: { allowed: true, scope: 'all' }
            }
          }
        }
      })
    };
    const service = new MainSsoService({ httpClient });

    const result = await service.exchangeCode('single-use-code-1234567890');

    expect(httpClient.post).toHaveBeenCalledWith(
      'https://main.example.test/api/v1/internal/sso/erp/exchange',
      {
        authorizationCode: 'single-use-code-1234567890',
        state: VALID_STATE,
        audience: 'erp',
        redirectUri: 'http://localhost:5173/sso/callback'
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-ERP-Client-Id': 'erp-test-client',
          'X-ERP-Client-Secret': 'erp-test-secret'
        })
      })
    );
    expect(result).toMatchObject({
      authSource: 'main_sso',
      permissionVersion: 9,
      user: {
        id: 42,
        username: 'supervisor01',
        role: 'supervisor',
        realName: '测试主管',
        authSource: 'main_sso'
      }
    });
    expect(result.permissions).toEqual({
      [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' },
      [PERMISSIONS.CONTRACT_VIEW]: { allowed: true, scope: 'team' }
    });
    expect(result.permissions[PERMISSIONS.PAYROLL_PAY]).toBeUndefined();
    expect(result.permissions['erp.unknown.execute']).toBeUndefined();
    expect(result.assertion).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(assertion);
    expect(permissionCacheSpy).toHaveBeenCalledWith(42);
    expect(teamCacheSpy).toHaveBeenCalledWith(42);

    const session = jwt.verify(result.token, sessionSecret, {
      issuer: 'erp',
      audience: 'erp'
    });
    expect(session).toMatchObject({
      sub: '42',
      id: 42,
      username: 'supervisor01',
      role: 'supervisor',
      authSource: 'main_sso',
      permissionVersion: 9,
      assertionJti: 'assertion-jti-001'
    });
    expect(decodePermissionGrants(session.permissionGrants)).toEqual(result.permissions);
  });

  test('主项目 users.id 与 assertion sub 不一致时拒绝，避免身份 ID 被替换', async () => {
    const assertion = signAssertion({
      user: {
        id: 999,
        username: 'nested-user',
        role: 'supervisor',
        realName: '嵌套用户'
      }
    });
    const service = new MainSsoService({
      httpClient: { post: jest.fn().mockResolvedValue({ data: { assertion } }) }
    });

    await expect(service.exchangeCode('single-use-code-1234567890')).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED'
    });
  });

  test('assertion 嵌套 user.id 必须是与 sub 相同的整数，字符串 ID 也拒绝', async () => {
    const assertion = signAssertion({
      user: {
        id: '42',
        username: 'nested-user',
        role: 'supervisor'
      }
    });
    const service = new MainSsoService({
      httpClient: { post: jest.fn().mockResolvedValue({ data: { assertion } }) }
    });

    await expect(service.exchangeCode('nested-string-id-code-12345')).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED'
    });
  });

  test('RS256 kid 轮换期间 active/previous 两把公钥都可验签', async () => {
    const previousAssertion = jwt.sign({
      username: 'previous-key-user',
      role: 'supervisor',
      permissions: { [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' } },
      permissionVersion: 10
    }, previousPrivateKey, {
      algorithm: 'RS256',
      issuer: 'patent-notice-system',
      audience: 'erp',
      subject: '44',
      jwtid: 'assertion-previous-key',
      expiresIn: '60s',
      keyid: 'main-previous'
    });
    const service = new MainSsoService({
      httpClient: { post: jest.fn().mockResolvedValue({ data: { assertion: previousAssertion } }) }
    });

    const result = await service.exchangeCode('single-use-code-previous-key');
    expect(result.user.id).toBe(44);
    expect(result.permissionVersion).toBe(10);
  });

  test.each([
    ['缺少 kid', { omitKid: true }],
    ['未知 kid', { keyid: 'unknown-key' }]
  ])('RS256 assertion %s 时 fail-closed', async (_label, options) => {
    const assertion = signAssertion({}, options);
    const service = new MainSsoService({
      httpClient: { post: jest.fn().mockResolvedValue({ data: { assertion } }) }
    });

    await expect(service.exchangeCode('single-use-code-invalid-kid')).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED'
    });
  });

  test('SSO 缺省关闭时不调用主项目', async () => {
    delete process.env.ENABLE_SSO_LOGIN;
    const httpClient = { post: jest.fn() };
    const service = new MainSsoService({ httpClient });

    await expect(service.exchangeCode('single-use-code-1234567890')).rejects.toMatchObject({
      statusCode: 503,
      code: 'SSO_LOGIN_DISABLED'
    });
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  test.each([
    [400, 401, 'UNAUTHORIZED'],
    [401, 401, 'UNAUTHORIZED'],
    [409, 401, 'UNAUTHORIZED'],
    [410, 401, 'UNAUTHORIZED'],
    [403, 403, 'FORBIDDEN'],
    [429, 429, 'SSO_RATE_LIMIT']
  ])('主项目返回 HTTP %i 时 fail-closed 为 %i/%s', async (status, expectedStatus, code) => {
    const httpClient = {
      post: jest.fn().mockRejectedValue({ response: { status }, code: 'MOCK_REJECT' })
    };
    const service = new MainSsoService({ httpClient });

    await expect(service.exchangeCode('single-use-code-1234567890')).rejects.toMatchObject({
      statusCode: expectedStatus,
      code
    });
  });

  test('主项目网络异常不能退化为本地登录或空权限会话', async () => {
    const httpClient = {
      post: jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
    };
    const service = new MainSsoService({ httpClient });

    await expect(service.exchangeCode('single-use-code-1234567890')).rejects.toMatchObject({
      statusCode: 503,
      code: 'MAIN_SSO_UNAVAILABLE'
    });
  });

  test('缺少 state 时在请求主项目前拒绝兑换', async () => {
    const httpClient = { post: jest.fn() };
    const service = new ProductionMainSsoService({ httpClient });

    await expect(service.exchangeCode('single-use-code-1234567890')).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR'
    });
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  test('过期 assertion 必须拒绝', async () => {
    const assertion = signAssertion({}, { expiresIn: -10 });
    const service = new MainSsoService({
      httpClient: { post: jest.fn().mockResolvedValue({ data: { data: { assertion } } }) }
    });

    await expect(service.exchangeCode('single-use-code-1234567890')).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED'
    });
  });

  test('assertion 缺失 ERP 入口权限时拒绝，即使主项目 HTTP 返回成功', async () => {
    const assertion = signAssertion({
      permissions: {
        [PERMISSIONS.CONTRACT_VIEW]: { allowed: true, scope: 'team' }
      }
    });
    const service = new MainSsoService({
      httpClient: { post: jest.fn().mockResolvedValue({ data: { assertion } }) }
    });

    await expect(service.exchangeCode('single-use-code-1234567890')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN'
    });
  });

  test.each(['client', 'customer', 'unknown'])('assertion 返回非 ERP 可绑定主项目角色 %s 时拒绝', async (role) => {
    const assertion = signAssertion({ role });
    const service = new MainSsoService({
      httpClient: { post: jest.fn().mockResolvedValue({ data: { assertion } }) }
    });

    await expect(service.exchangeCode('invalid-role-code-123456789')).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED'
    });
  });

  test('assertion 缺少 permissionVersion 时必须拒绝，不能静默按 0 接受', async () => {
    const assertion = signAssertion({ permissionVersion: undefined });
    const service = new MainSsoService({
      httpClient: { post: jest.fn().mockResolvedValue({ data: { assertion } }) }
    });

    await expect(service.exchangeCode('single-use-code-no-permission-version')).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED'
    });
  });

  test('同一 assertion jti 即使通过不同 Code 返回也只能建立一次 ERP 会话', async () => {
    const assertion = signAssertion();
    const httpClient = {
      post: jest.fn().mockResolvedValue({ data: { assertion } })
    };
    const service = new MainSsoService({ httpClient });

    await expect(service.exchangeCode('single-use-code-first-123456')).resolves.toMatchObject({
      authSource: 'main_sso'
    });
    await expect(service.exchangeCode('single-use-code-second-12345')).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED'
    });
  });

  test('并发兑换返回同一 assertion jti 时只有一个请求成功', async () => {
    const assertion = signAssertion();
    const service = new MainSsoService({
      httpClient: { post: jest.fn().mockResolvedValue({ data: { assertion } }) }
    });

    const results = await Promise.allSettled([
      service.exchangeCode('concurrent-code-first-123456'),
      service.exchangeCode('concurrent-code-second-12345')
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason).toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED'
    });
  });

  test('Redis assertion 重放保护使用 SET NX，存储异常时 fail-closed', async () => {
    const redisClient = { set: jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null) };
    const guard = new SsoAssertionReplayGuard({
      redisClient,
      now: () => 1_700_000_000_000
    });

    await expect(guard.consume({ jti: 'assertion-jti-redis', expiresAt: 1_700_000_060 }))
      .resolves.toBe(true);
    await expect(guard.consume({ jti: 'assertion-jti-redis', expiresAt: 1_700_000_060 }))
      .rejects.toMatchObject({ statusCode: 401 });
    expect(redisClient.set).toHaveBeenCalledWith(
      expect.stringMatching(/^sso_assertion_jti:[a-f0-9]{64}$/),
      '1',
      'EX',
      65,
      'NX'
    );

    const unavailable = new SsoAssertionReplayGuard({
      redisClient: { set: jest.fn().mockRejectedValue(new Error('redis down')) }
    });
    await expect(unavailable.consume({
      jti: 'assertion-jti-unavailable',
      expiresAt: Math.floor(Date.now() / 1000) + 60
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'SSO_REPLAY_GUARD_UNAVAILABLE'
    });
  });

  test.each([
    ['permissionVersion 为字符串', { permissionVersion: '9' }, {}],
    ['assertion 生命周期超过上限', {}, { expiresIn: '301s' }],
    ['iat 位于未来', { iat: Math.floor(Date.now() / 1000) + 30 }, {}]
  ])('%s时拒绝宽松 claim', async (_label, overrides, options) => {
    const assertion = signAssertion(overrides, options);
    const service = new MainSsoService({
      httpClient: { post: jest.fn().mockResolvedValue({ data: { assertion } }) }
    });

    await expect(service.exchangeCode('strict-claim-code-123456789')).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED'
    });
  });

  test.each([
    ['sub 为数字', 42, 'valid-jti-numeric-sub'],
    ['jti 为数字', '42', 12345]
  ])('%s时拒绝 assertion', async (_label, sub, jti) => {
    const assertion = jwt.sign({
      sub,
      jti,
      username: 'strict-user',
      role: 'supervisor',
      permissions: { [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' } },
      permissionVersion: 1
    }, privateKey, {
      algorithm: 'RS256',
      issuer: 'patent-notice-system',
      audience: 'erp',
      expiresIn: '60s',
      keyid: 'main-active'
    });
    const service = new MainSsoService({
      httpClient: { post: jest.fn().mockResolvedValue({ data: { assertion } }) }
    });

    await expect(service.exchangeCode('strict-type-code-1234567890')).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED'
    });
  });

  test.each([
    [{ allowed: true, scope: 'none' }],
    [{ allowed: true, scope: 'root' }],
    [{ allowed: false, scope: 'all' }]
  ])('入口权限 grant=%p 时必须拒绝', async (appGrant) => {
    const assertion = signAssertion({
      permissions: { [PERMISSIONS.APP_VIEW]: appGrant }
    });
    const service = new MainSsoService({
      httpClient: { post: jest.fn().mockResolvedValue({ data: { assertion } }) }
    });

    await expect(service.exchangeCode('single-use-code-1234567890')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN'
    });
  });
});
