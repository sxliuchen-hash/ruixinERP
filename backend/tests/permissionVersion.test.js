const { MainPermissionVersionService } = require('../src/services/mainPermissionVersionService');
const mainPermissionVersionService = require('../src/services/mainPermissionVersionService');
const mainUserScopeService = require('../src/services/mainUserScopeService');
const {
  requireCurrentPermissionVersion,
  requireFreshPermissionVersion
} = require('../src/middlewares/permissionVersion');
const fs = require('fs');
const path = require('path');
const permissionManifest = require('../src/permissions/erp-permission-manifest.json');
const { PERMISSIONS } = require('../src/permissions/permissionCodes');
const { encodePermissionGrants } = require('../src/permissions/permissionGrant');
const { authenticate } = require('../src/middlewares/auth');
const jwt = require('jsonwebtoken');

describe('permissionVersion 会话失效机制', () => {
  const originalEnv = { ...process.env };
  let now;

  function configureBusinessApi() {
    process.env.MAIN_SSO_BASE_URL = 'https://main.example.test/';
    process.env.MAIN_PERMISSION_VERSION_PATH = '/api/v1/internal/users/:userId/permission-version';
    process.env.MAIN_PERMISSION_VERSION_CACHE_TTL_MS = '120000';
    process.env.MAIN_API_CLIENT_ID = 'erp-business-api';
    process.env.MAIN_API_CLIENT_SECRET = 'business-secret';
    process.env.ERP_SSO_CLIENT_ID = 'erp-sso-exchange';
    process.env.ERP_SSO_CLIENT_SECRET = 'sso-secret';
  }

  beforeEach(() => {
    now = 1000;
    configureBusinessApi();
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

  test('普通请求缓存版本，过期或 forceRefresh 时重新查询', async () => {
    const httpClient = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { data: { permissionVersion: 4 } } })
        .mockResolvedValueOnce({ data: { data: { permissionVersion: 5 } } })
        .mockResolvedValueOnce({ data: { data: { permissionVersion: 6 } } })
    };
    const service = new MainPermissionVersionService({ httpClient, now: () => now });

    await expect(service.getCurrentPermissionVersion(9)).resolves.toBe(4);
    now += 60000;
    await expect(service.getCurrentPermissionVersion(9)).resolves.toBe(4);
    expect(httpClient.get).toHaveBeenCalledTimes(1);

    await expect(service.getCurrentPermissionVersion(9, { forceRefresh: true })).resolves.toBe(5);
    expect(httpClient.get).toHaveBeenCalledTimes(2);

    now += 121000;
    await expect(service.getCurrentPermissionVersion(9)).resolves.toBe(6);
    expect(httpClient.get).toHaveBeenCalledTimes(3);
  });

  test('权限版本相同放行；不一致返回 401 并清除缓存', async () => {
    const scopeCacheSpy = jest.spyOn(mainUserScopeService, 'clearCache');
    const service = new MainPermissionVersionService({
      httpClient: { get: jest.fn().mockResolvedValue({ data: { permissionVersion: 8 } }) },
      now: () => now
    });
    const user = { id: 11, authSource: 'main_sso', permissionVersion: 8 };

    await expect(service.assertCurrentPermissionVersion(user)).resolves.toBe(true);
    user.permissionVersion = 7;
    await expect(service.assertCurrentPermissionVersion(user)).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED'
    });
    expect(service.getCached(11)).toBeNull();
    expect(scopeCacheSpy).toHaveBeenCalledWith(11);
  });

  test('多实例缓存版本与新 SSO 会话不一致时先强制刷新，实时版本一致则放行', async () => {
    const scopeCacheSpy = jest.spyOn(mainUserScopeService, 'clearCache');
    const httpClient = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { permissionVersion: 4 } })
        .mockResolvedValueOnce({ data: { permissionVersion: 5 } })
    };
    const service = new MainPermissionVersionService({ httpClient, now: () => now });

    // 模拟实例 B 在用户重新 SSO 前缓存了旧版本；新会话由实例 A 签发为版本 5。
    await expect(service.getCurrentPermissionVersion(11)).resolves.toBe(4);
    await expect(service.assertCurrentPermissionVersion({
      id: 11,
      authSource: 'main_sso',
      permissionVersion: 5
    })).resolves.toBe(true);

    expect(httpClient.get).toHaveBeenCalledTimes(2);
    expect(service.getCached(11)).toBe(5);
    expect(scopeCacheSpy).toHaveBeenCalledWith(11);
  });

  test('缓存不一致且强制刷新后仍不一致时才拒绝旧会话', async () => {
    const httpClient = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { permissionVersion: 5 } })
        .mockResolvedValueOnce({ data: { permissionVersion: 5 } })
    };
    const service = new MainPermissionVersionService({ httpClient, now: () => now });

    await expect(service.getCurrentPermissionVersion(11)).resolves.toBe(5);
    await expect(service.assertCurrentPermissionVersion({
      id: 11,
      authSource: 'main_sso',
      permissionVersion: 4
    })).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });

    expect(httpClient.get).toHaveBeenCalledTimes(2);
  });

  test('legacy 会话跳过主项目版本 API，保持回滚通道', async () => {
    const httpClient = { get: jest.fn() };
    const service = new MainPermissionVersionService({ httpClient, now: () => now });

    await expect(service.assertCurrentPermissionVersion({
      id: 3,
      authSource: 'legacy',
      permissionVersion: 0
    })).resolves.toBe(true);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  test('版本查询使用 MAIN_API 独立凭证，不发送 SSO 兑换凭证', async () => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({ data: { permissionVersion: 2 } })
    };
    const service = new MainPermissionVersionService({ httpClient, now: () => now });

    await service.getCurrentPermissionVersion(13);

    expect(httpClient.get).toHaveBeenCalledWith(
      'https://main.example.test/api/v1/internal/users/13/permission-version',
      expect.objectContaining({
        headers: {
          'X-ERP-Service-Id': 'erp-business-api',
          'X-ERP-Service-Secret': 'business-secret'
        }
      })
    );
    const headers = httpClient.get.mock.calls[0][1].headers;
    expect(headers['X-ERP-Client-Id']).toBeUndefined();
    expect(headers['X-ERP-Client-Secret']).toBeUndefined();
  });

  test.each([
    ['业务凭证缺失', () => { delete process.env.MAIN_API_CLIENT_SECRET; }],
    ['业务 Client ID 复用 SSO Client ID', () => {
      process.env.MAIN_API_CLIENT_ID = process.env.ERP_SSO_CLIENT_ID;
    }],
    ['业务 Client Secret 复用 SSO Client Secret', () => {
      process.env.MAIN_API_CLIENT_SECRET = process.env.ERP_SSO_CLIENT_SECRET;
    }]
  ])('%s 时配置 fail-closed', async (_label, mutateEnv) => {
    mutateEnv();
    const service = new MainPermissionVersionService({ httpClient: { get: jest.fn() } });

    await expect(service.getCurrentPermissionVersion(9)).rejects.toMatchObject({
      statusCode: 503,
      code: 'MAIN_API_CONFIGURATION_ERROR'
    });
  });

  test('主项目不可用或返回非 JSON 整数版本时 fail-closed', async () => {
    const unavailable = new MainPermissionVersionService({
      httpClient: { get: jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })) }
    });
    await expect(unavailable.getCurrentPermissionVersion(9)).rejects.toMatchObject({
      statusCode: 503,
      code: 'MAIN_PERMISSION_VERSION_UNAVAILABLE'
    });

    for (const permissionVersion of ['9', 'bad', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = new MainPermissionVersionService({
        httpClient: { get: jest.fn().mockResolvedValue({ data: { permissionVersion } }) }
      });
      await expect(invalid.getCurrentPermissionVersion(9)).rejects.toMatchObject({
        statusCode: 503,
        code: 'MAIN_PERMISSION_VERSION_INVALID'
      });
    }
  });

  test('普通/高风险 middleware 分别请求缓存校验与强制实时校验', async () => {
    const spy = jest.spyOn(mainPermissionVersionService, 'assertCurrentPermissionVersion')
      .mockResolvedValue(true);
    const req = { user: { id: 5, authSource: 'main_sso', permissionVersion: 1 } };
    const normalNext = jest.fn();
    const freshNext = jest.fn();

    await requireCurrentPermissionVersion()(req, {}, normalNext);
    await requireFreshPermissionVersion()(req, {}, freshNext);

    expect(spy).toHaveBeenNthCalledWith(1, req.user, { forceRefresh: false });
    expect(spy).toHaveBeenNthCalledWith(2, req.user, { forceRefresh: true });
    expect(normalNext).toHaveBeenCalledWith();
    expect(freshNext).toHaveBeenCalledWith();
  });

  test('authenticate 对 main_sso 会话自动执行缓存版 permissionVersion 校验', async () => {
    process.env.ERP_SESSION_SECRET = 'erp-session-secret-for-version-test';
    const token = jwt.sign({
      id: 21,
      username: 'sso-user',
      role: 'supervisor',
      authSource: 'main_sso',
      permissionVersion: 6,
      assertionJti: 'assertion-jti-version-21',
      permissionGrants: encodePermissionGrants({
        [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' }
      })
    }, process.env.ERP_SESSION_SECRET, {
      issuer: 'erp',
      audience: 'erp',
      subject: '21',
      jwtid: 'erp-session-version-21',
      expiresIn: '10m'
    });
    const spy = jest.spyOn(mainPermissionVersionService, 'assertCurrentPermissionVersion')
      .mockResolvedValue(true);
    const req = { headers: { authorization: `Bearer ${token}` } };

    await new Promise((resolve, reject) => {
      authenticate(req, {}, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    expect(req.user).toMatchObject({
      id: 21,
      authSource: 'main_sso',
      permissionVersion: 6
    });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 21 }));
  });

  test('authenticate 在主项目版本服务拒绝时不注入用户并向下传错', async () => {
    process.env.ERP_SESSION_SECRET = 'erp-session-secret-for-version-test';
    const token = jwt.sign({
      id: 22,
      username: 'stale-user',
      role: 'supervisor',
      authSource: 'main_sso',
      permissionVersion: 2,
      assertionJti: 'assertion-jti-version-22',
      permissionGrants: encodePermissionGrants({
        [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' }
      })
    }, process.env.ERP_SESSION_SECRET, {
      issuer: 'erp',
      audience: 'erp',
      subject: '22',
      jwtid: 'erp-session-version-22',
      expiresIn: '10m'
    });
    jest.spyOn(mainPermissionVersionService, 'assertCurrentPermissionVersion')
      .mockRejectedValue(Object.assign(new Error('stale'), {
        statusCode: 401,
        code: 'UNAUTHORIZED'
      }));
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await new Promise((resolve) => authenticate(req, {}, resolve));

    expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    expect(req.user).toBeUndefined();
  });

  test('所有 critical 权限及 high 风险写路由都执行实时 permissionVersion 校验', () => {
    const routeFileByModule = {
      account: 'accounts.js',
      customer: 'customers.js',
      supplier: 'suppliers.js',
      contract: 'contracts.js',
      invoice: 'invoices.js',
      payment: 'payments.js',
      expense: 'expenses.js',
      loan: 'loans.js',
      inventory: 'inventory.js',
      inventory_anomaly: 'inventory.js',
      project: 'projects.js',
      cost: 'costs.js',
      reconciliation: 'reconciliation.js',
      import: 'import.js',
      audit: 'logs.js',
      wechat: 'wechat.js',
      employee: 'employees.js',
      purchase_commission: 'performance.js',
      performance_import: 'performanceImport.js',
      salary_rule: 'salaryRules.js',
      payroll: 'payroll.js',
      system: 'systemSettings.js',
      classify_rule: 'classifyRules.js',
      file: 'files.js'
    };
    const keyByCode = Object.fromEntries(
      Object.entries(PERMISSIONS).map(([key, code]) => [code, key])
    );
    const failures = [];

    for (const module of permissionManifest.modules) {
      for (const permission of module.permissions) {
        const hasWriteRoute = permission.routes.some((route) => !route.startsWith('GET '));
        const requiresRealtime = permission.riskLevel === 'critical' || (
          permission.riskLevel === 'high' && hasWriteRoute
        );
        if (!requiresRealtime || permission.deprecated) continue;

        const routeFile = routeFileByModule[module.code];
        const permissionKey = keyByCode[permission.code];
        if (!routeFile || !permissionKey) {
          failures.push(`${permission.code}: 缺少验收路由映射或常量`);
          continue;
        }

        const source = fs.readFileSync(
          path.join(__dirname, '..', 'src', 'routes', routeFile),
          'utf8'
        );
        const marker = `requirePermission(PERMISSIONS.${permissionKey})`;
        let offset = 0;
        let found = false;
        while ((offset = source.indexOf(marker, offset)) >= 0) {
          found = true;
          const nearby = source.slice(Math.max(0, offset - 120), offset + marker.length + 240);
          if (!/requireFreshPermissions|requireFreshPermissionVersion/.test(nearby)) {
            failures.push(`${permission.code}: ${routeFile} 的路由未实时校验版本`);
          }
          offset += marker.length;
        }
        if (!found) failures.push(`${permission.code}: ${routeFile} 未引用该权限`);
      }
    }

    expect(failures).toEqual([]);
  });
});
