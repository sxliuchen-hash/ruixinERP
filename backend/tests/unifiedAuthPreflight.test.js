const { generateKeyPairSync } = require('crypto');
const {
  validateManifest,
  assertProductionRuntimeConfig,
  withDefaultDatabaseConnection,
  runUnifiedAuthPreflight
} = require('../src/services/unifiedAuthPreflightService');
const manifest = require('../src/permissions/erp-permission-manifest.json');

describe('统一认证生产配置预检', () => {
  const active = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const previous = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  function validEnv() {
    return {
      NODE_ENV: 'production',
      ENABLE_SSO_LOGIN: 'true',
      ENABLE_PASSWORD_LOGIN: 'false',
      ENABLE_LEGACY_SESSION: 'false',
      WECHAT_UNBOUND_APPROVAL_POLICY: 'reject',
      MAIN_SSO_BASE_URL: 'https://main-api.test.internal',
      MAIN_SYSTEM_URL: 'https://main.test.internal',
      IP_API_BASE_URL: 'https://main-api.test.internal/api/v1',
      ERP_SSO_CALLBACK_URL_PRODUCTION: 'https://erp.test.internal/sso/callback',
      MAIN_SSO_CONTINUE_PATH: '/sso/continue',
      ERP_SSO_STATE_TTL_SEC: '120',
      ERP_SSO_STATE_COOKIE_NAME: 'erp_sso_browser',
      ERP_SSO_AUDIENCE: 'erp',
      ERP_SSO_ISSUER: 'patent-notice-system',
      ERP_SSO_ASSERTION_MAX_LIFETIME_SEC: '120',
      ERP_SESSION_SECRET: 'erp-session-secret-0123456789abcdef0123456789',
      JWT_SECRET: 'legacy-session-secret-0123456789abcdef012345',
      ERP_SSO_CLIENT_ID: 'erp-sso',
      ERP_SSO_CLIENT_SECRET: 'sso-secret-0123456789abcdef0123456789',
      MAIN_API_CLIENT_ID: 'erp-business',
      MAIN_API_CLIENT_SECRET: 'business-secret-0123456789abcdef012345',
      ERP_MANIFEST_CLIENT_ID: 'main-permission-center',
      ERP_MANIFEST_CLIENT_SECRET: 'manifest-secret-0123456789abcdef012345',
      ERP_PROVISION_CLIENT_ID: 'main-employee-provision',
      ERP_PROVISION_CLIENT_SECRET: 'provision-secret-0123456789abcdef012345',
      IP_AUTH_MODE: 'client_credentials',
      ERP_SSO_ACTIVE_KID: 'main-2026-07',
      ERP_SSO_ACTIVE_PUBLIC_KEY: active.publicKey,
      ERP_SSO_PREVIOUS_KID: 'main-2026-06',
      ERP_SSO_PREVIOUS_PUBLIC_KEY: previous.publicKey,
      ERP_SSO_ALLOW_LEGACY_NO_KID: 'false',
      UNIFIED_AUTH_PREFLIGHT_CHECK_DB: 'false',
      REDIS_HOST: 'redis.internal',
      REDIS_PORT: '6379',
      UNIFIED_AUTH_PREFLIGHT_CHECK_REDIS: 'true'
    };
  }

  test('合法生产配置通过，默认不连接数据库', async () => {
    const employeeIndexCheck = jest.fn();
    const result = await runUnifiedAuthPreflight({
      env: validEnv(),
      manifest,
      employeeIndexCheck
    });

    expect(result).toMatchObject({
      ok: true,
      manifest: { version: '1.3.0', permissionCount: 117, routeCount: 192 },
      redisChecked: true,
      employeeIndexChecked: false,
      databaseSchemaChecked: false,
      payrollSchemaChecked: false
    });
    expect(employeeIndexCheck).not.toHaveBeenCalled();
  });

  test('生产运行时启动门禁只检查配置，不依赖 preflight 开关或外部连接', async () => {
    const env = validEnv();
    delete env.UNIFIED_AUTH_PREFLIGHT_CHECK_DB;
    delete env.UNIFIED_AUTH_PREFLIGHT_CHECK_REDIS;

    await expect(assertProductionRuntimeConfig({ env, manifest })).resolves.toMatchObject({
      ok: true,
      configOnly: true,
      redisChecked: false,
      employeeIndexChecked: false,
      databaseSchemaChecked: false,
      payrollSchemaChecked: false
    });
  });

  test('生产运行时启动门禁复用完整配置规则并使用独立错误码', async () => {
    const env = validEnv();
    env.ERP_SESSION_SECRET = 'short';

    await expect(assertProductionRuntimeConfig({ env, manifest })).rejects.toMatchObject({
      code: 'PRODUCTION_RUNTIME_CONFIG_INVALID',
      statusCode: 503,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'ERP_SESSION_SECRET_WEAK' })
      ])
    });
  });

  test('生产运行时启动门禁允许显式的密码登录应急回滚组合', async () => {
    const env = validEnv();
    env.ENABLE_SSO_LOGIN = 'false';
    env.ENABLE_PASSWORD_LOGIN = 'true';
    env.ENABLE_LEGACY_SESSION = 'true';
    env.IP_AUTH_MODE = 'hybrid';

    await expect(assertProductionRuntimeConfig({ env, manifest })).resolves.toMatchObject({
      ok: true,
      configOnly: true,
      featureFlags: {
        ssoLogin: false,
        passwordLogin: true,
        legacySession: true
      }
    });
  });

  test('生产运行时启动门禁仍拒绝关闭全部登录入口', async () => {
    const env = validEnv();
    env.ENABLE_SSO_LOGIN = 'false';
    env.ENABLE_PASSWORD_LOGIN = 'false';

    await expect(assertProductionRuntimeConfig({ env, manifest })).rejects.toMatchObject({
      code: 'PRODUCTION_RUNTIME_CONFIG_INVALID',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'ALL_LOGIN_DISABLED' })
      ])
    });
  });

  test('非生产环境跳过生产运行时门禁', async () => {
    await expect(assertProductionRuntimeConfig({ env: { NODE_ENV: 'test' }, manifest })).resolves.toMatchObject({
      ok: true,
      skipped: true
    });
  });

  test('显式开启数据库检查时调用注入的只读完整结构检查', async () => {
    const employeeIndexCheck = jest.fn().mockResolvedValue(true);
    const payrollSchemaCheck = jest.fn().mockResolvedValue(true);
    const env = validEnv();
    env.UNIFIED_AUTH_PREFLIGHT_CHECK_DB = 'true';

    const result = await runUnifiedAuthPreflight({
      env,
      manifest,
      employeeIndexCheck,
      payrollSchemaCheck
    });

    expect(employeeIndexCheck).toHaveBeenCalledTimes(1);
    expect(payrollSchemaCheck).toHaveBeenCalledTimes(1);
    expect(result.employeeIndexChecked).toBe(true);
    expect(result.databaseSchemaChecked).toBe(true);
    expect(result.payrollSchemaChecked).toBe(true);
  });

  test('默认数据库检查链复用同一连接并且只关闭一次', async () => {
    const database = {
      authenticate: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(undefined)
    };
    const createConnection = jest.fn().mockReturnValue(database);
    const employeeIndexCheck = jest.fn().mockResolvedValue(true);
    const payrollSchemaCheck = jest.fn().mockResolvedValue(true);

    await withDefaultDatabaseConnection(async (connection) => {
      await employeeIndexCheck(connection);
      await payrollSchemaCheck(connection);
    }, { createConnection });

    expect(createConnection).toHaveBeenCalledTimes(1);
    expect(database.authenticate).toHaveBeenCalledTimes(1);
    expect(employeeIndexCheck).toHaveBeenCalledWith(database);
    expect(payrollSchemaCheck).toHaveBeenCalledWith(database);
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  test('默认数据库连接即使结构检查失败也只关闭一次', async () => {
    const database = {
      authenticate: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(undefined)
    };

    await expect(withDefaultDatabaseConnection(async () => {
      throw new Error('schema failure');
    }, { createConnection: () => database })).rejects.toThrow('schema failure');

    expect(database.close).toHaveBeenCalledTimes(1);
  });

  test('数据库结构检查失败时以安全的统一预检错误 fail-closed', async () => {
    const env = validEnv();
    env.UNIFIED_AUTH_PREFLIGHT_CHECK_DB = 'true';

    await expect(runUnifiedAuthPreflight({
      env,
      manifest,
      employeeIndexCheck: jest.fn().mockRejectedValue(
        new Error('payrolls raw schema and credential detail')
      ),
      payrollSchemaCheck: jest.fn()
    })).rejects.toMatchObject({
      code: 'UNIFIED_AUTH_PREFLIGHT_FAILED',
      statusCode: 503,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'ERP_DATABASE_INDEX_SCHEMA_INVALID' })
      ])
    });
  });

  test.each([
    ['待迁移', 'PAYROLL_SCHEMA_MIGRATION_REQUIRED'],
    ['结构冲突', 'PAYROLL_SCHEMA_CONFLICT'],
    ['读取失败', 'PAYROLL_SCHEMA_INSPECTION_FAILED'],
    ['未知错误', 'PAYROLL_SCHEMA_INVALID']
  ])('薪酬结构%s时使用独立 issue code 且不误报检查成功', async (_label, errorCode) => {
    const env = validEnv();
    env.UNIFIED_AUTH_PREFLIGHT_CHECK_DB = 'true';
    const error = new Error('raw payroll schema detail');
    if (errorCode !== 'PAYROLL_SCHEMA_INVALID') error.code = errorCode;

    let caught;
    try {
      await runUnifiedAuthPreflight({
        env,
        manifest,
        employeeIndexCheck: jest.fn().mockResolvedValue(true),
        payrollSchemaCheck: jest.fn().mockRejectedValue(error)
      });
    } catch (preflightError) {
      caught = preflightError;
    }

    expect(caught).toMatchObject({
      code: 'UNIFIED_AUTH_PREFLIGHT_FAILED',
      issues: expect.arrayContaining([expect.objectContaining({ code: errorCode })])
    });
    expect(JSON.stringify(caught.issues)).not.toContain('raw payroll schema detail');
  });

  test('灰度期允许 hybrid，并提示旧会话排空后切换', async () => {
    const env = validEnv();
    env.ENABLE_PASSWORD_LOGIN = 'true';
    env.ENABLE_LEGACY_SESSION = 'true';
    env.IP_AUTH_MODE = 'hybrid';

    const result = await runUnifiedAuthPreflight({ env, manifest });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('旧会话排空后必须切换 client_credentials')
    ]));
  });

  test('关闭旧登录和旧会话后拒绝继续使用 hybrid', async () => {
    const env = validEnv();
    env.IP_AUTH_MODE = 'hybrid';

    await expect(runUnifiedAuthPreflight({ env, manifest })).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'IP_HYBRID_WITHOUT_LEGACY' })
      ])
    });
  });

  test('错误配置聚合失败且错误信息不泄露 Secret 或公钥', async () => {
    const env = validEnv();
    env.ENABLE_SSO_LOGIN = 'false';
    env.ENABLE_PASSWORD_LOGIN = 'false';
    env.ERP_SSO_CALLBACK_URL_PRODUCTION = 'http://erp.example.test/sso/callback';
    env.ERP_SESSION_SECRET = env.JWT_SECRET;
    env.MAIN_API_CLIENT_ID = env.ERP_SSO_CLIENT_ID;
    env.MAIN_API_CLIENT_SECRET = env.ERP_SSO_CLIENT_SECRET;
    delete env.IP_API_CLIENT_SECRET;
    env.IP_API_CLIENT_ID = 'partial-ip-client';
    env.ERP_SSO_ALLOW_LEGACY_NO_KID = 'true';

    let caught;
    try {
      await runUnifiedAuthPreflight({ env, manifest });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'UNIFIED_AUTH_PREFLIGHT_FAILED', statusCode: 503 });
    const codes = caught.issues.map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      'SSO_DISABLED',
      'ALL_LOGIN_DISABLED',
      'CALLBACK_INVALID',
      'SESSION_SECRET_NOT_INDEPENDENT',
      'CLIENT_ID_REUSED',
      'CLIENT_SECRET_REUSED',
      'IP_CREDENTIAL_PAIR_INVALID',
      'LEGACY_NO_KID_ENABLED'
    ]));
    const safeOutput = JSON.stringify({ message: caught.message, issues: caught.issues });
    expect(safeOutput).not.toContain(env.ERP_SSO_CLIENT_SECRET);
    expect(safeOutput).not.toContain('BEGIN PUBLIC KEY');
  });

  test.each([
    ['独立会话 Secret 过短', (env) => { env.ERP_SESSION_SECRET = 'short'; }, 'ERP_SESSION_SECRET_WEAK'],
    ['SSO Client Secret 仍是占位值', (env) => { env.ERP_SSO_CLIENT_SECRET = 'replace_with_sso_secret'; }, 'ERP_SSO_CLIENT_SECRET_PLACEHOLDER'],
    ['业务 API Client Secret 过短', (env) => { env.MAIN_API_CLIENT_SECRET = 'too-short'; }, 'MAIN_API_CLIENT_SECRET_WEAK'],
    ['启用 legacy 时 JWT Secret 仍是占位值', (env) => {
      env.ENABLE_LEGACY_SESSION = 'true';
      env.JWT_SECRET = 'replace_with_legacy_secret';
    }, 'JWT_SECRET_PLACEHOLDER']
  ])('%s时生产预检拒绝', async (_label, mutate, code) => {
    const env = validEnv();
    mutate(env);

    await expect(runUnifiedAuthPreflight({ env, manifest })).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code })])
    });
  });

  test.each([
    ['previous kid 缺少公钥', (env) => { delete env.ERP_SSO_PREVIOUS_PUBLIC_KEY; }],
    ['previous 公钥缺少 kid', (env) => { delete env.ERP_SSO_PREVIOUS_KID; }],
    ['active 公钥不是 RSA PEM', (env) => { env.ERP_SSO_ACTIVE_PUBLIC_KEY = 'not-a-key'; }],
    ['active/previous kid 相同', (env) => { env.ERP_SSO_PREVIOUS_KID = env.ERP_SSO_ACTIVE_KID; }]
  ])('%s 时拒绝', async (_label, mutate) => {
    const env = validEnv();
    mutate(env);
    await expect(runUnifiedAuthPreflight({ env, manifest })).rejects.toMatchObject({
      code: 'UNIFIED_AUTH_PREFLIGHT_FAILED'
    });
  });

  test.each([
    ['Client ID 相同但 Secret 不同', (env) => {
      env.IP_API_CLIENT_ID = env.ERP_SSO_CLIENT_ID;
      env.IP_API_CLIENT_SECRET = 'ip-only-secret';
    }],
    ['Client Secret 相同但 ID 不同', (env) => {
      env.IP_API_CLIENT_ID = 'ip-only-client';
      env.IP_API_CLIENT_SECRET = env.ERP_SSO_CLIENT_SECRET;
    }]
  ])('IP 专用凭证%s时不得复用 SSO Code 兑换凭证', async (_label, configureIpCredential) => {
    const env = validEnv();
    configureIpCredential(env);

    await expect(runUnifiedAuthPreflight({ env, manifest })).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'IP_CREDENTIAL_REUSES_SSO' })
      ])
    });
  });

  test.each([
    ['Client ID', (env) => { env.MAIN_API_CLIENT_ID = env.ERP_SSO_CLIENT_ID; }, 'CLIENT_ID_REUSED'],
    ['Client Secret', (env) => { env.MAIN_API_CLIENT_SECRET = env.ERP_SSO_CLIENT_SECRET; }, 'CLIENT_SECRET_REUSED']
  ])('MAIN_API 单独复用 SSO %s 时生产预检拒绝', async (_label, mutate, code) => {
    const env = validEnv();
    mutate(env);

    await expect(runUnifiedAuthPreflight({ env, manifest })).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code })])
    });
  });

  test.each([
    ['Client ID', (env) => { env.ERP_PROVISION_CLIENT_ID = env.ERP_MANIFEST_CLIENT_ID; }, 'CLIENT_ID_REUSED'],
    ['Client Secret', (env) => { env.ERP_PROVISION_CLIENT_SECRET = env.MAIN_API_CLIENT_SECRET; }, 'CLIENT_SECRET_REUSED']
  ])('Employee 建档凭证复用其他通道的 %s 时生产预检拒绝', async (_label, mutate, code) => {
    const env = validEnv();
    mutate(env);

    await expect(runUnifiedAuthPreflight({ env, manifest })).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code })])
    });
  });

  test.each([
    ['callback 路径错误', (env) => { env.ERP_SSO_CALLBACK_URL_PRODUCTION = 'https://erp.test.internal/wrong'; }, 'CALLBACK_PATH_INVALID'],
    ['callback 带查询串', (env) => { env.ERP_SSO_CALLBACK_URL_PRODUCTION = 'https://erp.test.internal/sso/callback?tenant=1'; }, 'CALLBACK_INVALID'],
    ['callback 带 userinfo', (env) => { env.ERP_SSO_CALLBACK_URL_PRODUCTION = 'https://user:pass@erp.test.internal/sso/callback'; }, 'CALLBACK_INVALID'],
    ['callback 仍是占位域名', (env) => { env.ERP_SSO_CALLBACK_URL_PRODUCTION = 'https://erp.example.test/sso/callback'; }, 'CALLBACK_INVALID'],
    ['audience 错误', (env) => { env.ERP_SSO_AUDIENCE = 'other'; }, 'SSO_AUDIENCE_INVALID'],
    ['issuer 错误', (env) => { env.ERP_SSO_ISSUER = 'other'; }, 'SSO_ISSUER_INVALID'],
    ['assertion 最大生命周期超过主项目上限', (env) => { env.ERP_SSO_ASSERTION_MAX_LIFETIME_SEC = '300'; }, 'SSO_ASSERTION_MAX_LIFETIME_INVALID'],
    ['SSO Client ID Header 被改写', (env) => { env.MAIN_SSO_CLIENT_ID_HEADER = 'X-Custom-Client'; }, 'MAIN_SSO_CLIENT_ID_HEADER_NOT_FIXED'],
    ['业务 Job Header 被改写', (env) => { env.IP_API_JOB_NAME_HEADER = 'X-Custom-Job'; }, 'IP_API_JOB_NAME_HEADER_NOT_FIXED'],
    ['Manifest Secret Header 被改写', (env) => { env.ERP_MANIFEST_CLIENT_SECRET_HEADER = 'X-Custom-Manifest'; }, 'ERP_MANIFEST_CLIENT_SECRET_HEADER_NOT_FIXED'],
    ['Provision Client ID Header 被改写', (env) => { env.ERP_PROVISION_CLIENT_ID_HEADER = 'X-Custom-Provision'; }, 'ERP_PROVISION_CLIENT_ID_HEADER_NOT_FIXED']
  ])('%s 时拒绝', async (_label, mutate, code) => {
    const env = validEnv();
    mutate(env);

    await expect(runUnifiedAuthPreflight({ env, manifest })).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code })])
    });
  });

  test.each([
    ['缺少主项目 SSO 地址', (env) => { delete env.MAIN_SSO_BASE_URL; }, 'MAIN_SSO_BASE_URL_MISSING'],
    ['主项目 SSO 地址仍是占位域名', (env) => { env.MAIN_SSO_BASE_URL = 'https://main-api.example.test'; }, 'MAIN_SSO_BASE_URL_INVALID'],
    ['主项目浏览器地址不是 HTTPS', (env) => { env.MAIN_SYSTEM_URL = 'http://main.example.test'; }, 'MAIN_SYSTEM_URL_INVALID'],
    ['主项目浏览器地址不是纯 Origin', (env) => { env.MAIN_SYSTEM_URL = 'https://main.example.test/base'; }, 'MAIN_SYSTEM_URL_INVALID'],
    ['主项目浏览器地址仍是占位域名', (env) => { env.MAIN_SYSTEM_URL = 'https://main-project.example.com'; }, 'MAIN_SYSTEM_URL_INVALID'],
    ['缺少专利业务 API 地址', (env) => { delete env.IP_API_BASE_URL; }, 'IP_API_BASE_URL_MISSING'],
    ['专利业务 API 地址仍是占位域名', (env) => { env.IP_API_BASE_URL = 'https://main-api.example.test/api/v1'; }, 'IP_API_BASE_URL_INVALID'],
    ['team scope 路径缺少 userId', (env) => { env.MAIN_SSO_TEAM_SCOPE_PATH = '/api/v1/internal/users/team-scope'; }, 'MAIN_SSO_TEAM_SCOPE_PATH_USER_ID_MISSING'],
    ['team scope 路径虽合法但不是固定契约', (env) => { env.MAIN_SSO_TEAM_SCOPE_PATH = '/api/v1/internal/users/:userId/team'; }, 'MAIN_SSO_TEAM_SCOPE_PATH_NOT_FIXED'],
    ['permissionVersion 路径包含查询串', (env) => { env.MAIN_PERMISSION_VERSION_PATH = '/api/v1/internal/users/:userId/permission-version?raw=1'; }, 'MAIN_PERMISSION_VERSION_PATH_INVALID'],
    ['exchange 路径虽合法但不是固定契约', (env) => { env.MAIN_SSO_EXCHANGE_PATH = '/api/v1/internal/sso/erp/redeem'; }, 'MAIN_SSO_EXCHANGE_PATH_NOT_FIXED']
  ])('%s 时生产预检拒绝', async (_label, mutate, code) => {
    const env = validEnv();
    mutate(env);

    await expect(runUnifiedAuthPreflight({ env, manifest })).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code })])
    });
  });

  test.each([
    ['缺少密码登录开关', (env) => { delete env.ENABLE_PASSWORD_LOGIN; }, 'ENABLE_PASSWORD_LOGIN_MISSING'],
    ['legacy 开关值非法', (env) => { env.ENABLE_LEGACY_SESSION = 'maybe'; }, 'ENABLE_LEGACY_SESSION_INVALID'],
    ['数据库检查开关值非法', (env) => { env.UNIFIED_AUTH_PREFLIGHT_CHECK_DB = 'sometimes'; }, 'UNIFIED_AUTH_PREFLIGHT_CHECK_DB_INVALID'],
    ['缺少企微未绑定审批策略', (env) => { delete env.WECHAT_UNBOUND_APPROVAL_POLICY; }, 'WECHAT_UNBOUND_APPROVAL_POLICY_MISSING'],
    ['企微未绑定审批策略非法', (env) => { env.WECHAT_UNBOUND_APPROVAL_POLICY = 'silently_allow'; }, 'WECHAT_UNBOUND_APPROVAL_POLICY_INVALID']
  ])('%s 时不允许依赖默认值继续生产部署', async (_label, mutate, code) => {
    const env = validEnv();
    mutate(env);

    await expect(runUnifiedAuthPreflight({ env, manifest })).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code })])
    });
  });

  test('Manifest 契约、版本或路由不合法时拒绝', () => {
    const invalidManifest = JSON.parse(JSON.stringify(manifest));
    invalidManifest.schemaVersion = 2;
    invalidManifest.application.code = 'other';
    invalidManifest.application.version = 'v-next';
    const firstRoutePermission = invalidManifest.modules
      .flatMap((module) => module.permissions)
      .find((permission) => permission.routes.length > 0);
    const secondRoutePermission = invalidManifest.modules
      .flatMap((module) => module.permissions)
      .find((permission) => permission !== firstRoutePermission && permission.routes.length > 0);
    secondRoutePermission.routes.push(firstRoutePermission.routes[0]);
    const issues = [];

    validateManifest(invalidManifest, issues);

    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'MANIFEST_SCHEMA_VERSION_INVALID',
      'MANIFEST_APPLICATION_CODE_INVALID',
      'MANIFEST_VERSION_INVALID',
      'MANIFEST_ROUTE_DUPLICATE'
    ]));
  });
});
