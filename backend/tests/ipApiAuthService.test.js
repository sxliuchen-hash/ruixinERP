const jwt = require('jsonwebtoken');
const {
  IpApiAuthService,
  AUTH_MODES
} = require('../src/services/ipApiAuthService');

describe('IP 系统业务 API 认证隔离', () => {
  const originalEnv = { ...process.env };
  let service;

  beforeEach(() => {
    service = new IpApiAuthService();
    if (originalEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.JWT_SECRET = 'legacy-shared-secret';
    process.env.ENABLE_LEGACY_SESSION = 'true';
    delete process.env.IP_AUTH_MODE;
    delete process.env.IP_API_CLIENT_ID;
    delete process.env.IP_API_CLIENT_SECRET;
    delete process.env.MAIN_API_CLIENT_ID;
    delete process.env.MAIN_API_CLIENT_SECRET;
    delete process.env.ERP_SSO_CLIENT_ID;
    delete process.env.ERP_SSO_CLIENT_SECRET;
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test('旧模式仅作为显式回滚能力透传 ERP Bearer 会话', () => {
    const headers = service.buildUserRequestHeaders({
      headers: { authorization: 'Bearer legacy-session' },
      user: { id: 5, authSource: 'legacy' }
    });

    expect(service.getAuthMode()).toBe(AUTH_MODES.LEGACY_SHARED_JWT);
    expect(headers.Authorization).toBe('Bearer legacy-session');
  });

  test('生产环境未配置模式时默认使用 client_credentials，不能静默回退共享 JWT', () => {
    process.env.NODE_ENV = 'production';
    process.env.MAIN_API_CLIENT_ID = 'erp-business';
    process.env.MAIN_API_CLIENT_SECRET = 'business-secret';

    const headers = service.buildUserRequestHeaders({
      headers: { authorization: 'Bearer legacy-session-must-not-leak' },
      user: { id: 17, permissionVersion: 8, authSource: 'main_sso' }
    });

    expect(service.getAuthMode()).toBe(AUTH_MODES.CLIENT_CREDENTIALS);
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-ERP-Service-Id']).toBe('erp-business');
    expect(headers['X-Acting-User-Id']).toBe('17');
  });

  test('生产环境只有显式配置 legacy_shared_jwt 才允许回滚', () => {
    process.env.NODE_ENV = 'production';
    process.env.IP_AUTH_MODE = 'legacy_shared_jwt';

    const headers = service.buildUserRequestHeaders({
      headers: { authorization: 'Bearer explicit-legacy-session' },
      user: { id: 5, authSource: 'legacy' }
    });

    expect(headers.Authorization).toBe('Bearer explicit-legacy-session');
  });

  test('client_credentials 使用独立服务凭证并携带 acting user', () => {
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.MAIN_API_CLIENT_ID = 'erp-business';
    process.env.MAIN_API_CLIENT_SECRET = 'business-secret';

    const headers = service.buildUserRequestHeaders({
      headers: { authorization: 'Bearer browser-session-must-not-leak' },
      user: { id: 17, permissionVersion: 8, authSource: 'main_sso' }
    });

    expect(headers).toMatchObject({
      'X-ERP-Service-Id': 'erp-business',
      'X-ERP-Service-Secret': 'business-secret',
      'X-Acting-User-Id': '17',
      'X-Acting-Permission-Version': '8'
    });
    expect(headers.Authorization).toBeUndefined();
  });

  test('hybrid 对 main_sso 用户使用服务凭证和 acting user', () => {
    process.env.IP_AUTH_MODE = 'hybrid';
    process.env.MAIN_API_CLIENT_ID = 'erp-business';
    process.env.MAIN_API_CLIENT_SECRET = 'business-secret';

    const headers = service.buildUserRequestHeaders({
      headers: { authorization: 'Bearer erp-session-must-not-leak' },
      user: { id: 17, permissionVersion: 8, authSource: 'main_sso' }
    });

    expect(headers).toMatchObject({
      'X-ERP-Service-Id': 'erp-business',
      'X-Acting-User-Id': '17',
      'X-Acting-Permission-Version': '8'
    });
    expect(headers.Authorization).toBeUndefined();
  });

  test('hybrid 对 legacy 用户继续转发旧 Bearer 会话', () => {
    process.env.IP_AUTH_MODE = 'hybrid';

    const headers = service.buildUserRequestHeaders({
      headers: { authorization: 'Bearer legacy-session' },
      user: { id: 5, permissionVersion: 0, authSource: 'legacy' }
    });

    expect(headers.Authorization).toBe('Bearer legacy-session');
    expect(headers['X-ERP-Service-Id']).toBeUndefined();
  });

  test('hybrid 对未知会话来源 fail-closed', () => {
    process.env.IP_AUTH_MODE = 'hybrid';

    expect(() => service.buildUserRequestHeaders({
      headers: { authorization: 'Bearer unknown-session' },
      user: { id: 5, permissionVersion: 0, authSource: 'unknown' }
    })).toThrow(expect.objectContaining({ statusCode: 401 }));
  });

  test.each(['legacy_shared_jwt', 'hybrid'])('legacy session 已关闭时 %s 配置 fail-closed', (mode) => {
    process.env.IP_AUTH_MODE = mode;
    process.env.ENABLE_LEGACY_SESSION = 'false';

    expect(() => service.getAuthMode()).toThrow(expect.objectContaining({
      statusCode: 503,
      code: 'IP_AUTH_CONFIGURATION_ERROR'
    }));
  });

  test('client_credentials 不接受 legacy 会话伪装 acting user', () => {
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.MAIN_API_CLIENT_ID = 'erp-business';
    process.env.MAIN_API_CLIENT_SECRET = 'business-secret';

    expect(() => service.buildUserRequestHeaders({
      headers: { authorization: 'Bearer legacy-session' },
      user: { id: 17, permissionVersion: 0, authSource: 'legacy' }
    })).toThrow(expect.objectContaining({ statusCode: 401 }));
  });

  test.each([
    ['只配置 IP_API_CLIENT_ID', 'IP_API_CLIENT_SECRET'],
    ['只配置 IP_API_CLIENT_SECRET', 'IP_API_CLIENT_ID']
  ])('%s 时不得与 MAIN_API 凭证混搭', (_label, missingKey) => {
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.MAIN_API_CLIENT_ID = 'erp-business';
    process.env.MAIN_API_CLIENT_SECRET = 'business-secret';
    process.env.IP_API_CLIENT_ID = 'erp-patent';
    process.env.IP_API_CLIENT_SECRET = 'patent-secret';
    delete process.env[missingKey];

    expect(() => service.buildBackgroundRequestHeaders('patent-job')).toThrow(
      expect.objectContaining({
        statusCode: 503,
        code: 'IP_AUTH_CONFIGURATION_ERROR'
      })
    );
  });

  test('后台任务使用纯服务身份，不伪造 acting user', () => {
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.IP_API_CLIENT_ID = 'erp-patent-job';
    process.env.IP_API_CLIENT_SECRET = 'job-secret';

    const headers = service.buildBackgroundRequestHeaders('patent-anomaly-scan');

    expect(headers).toMatchObject({
      'X-ERP-Service-Id': 'erp-patent-job',
      'X-ERP-Service-Secret': 'job-secret',
      'X-ERP-Job-Name': 'patent-anomaly-scan'
    });
    expect(headers['X-Acting-User-Id']).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
  });

  test('hybrid 后台任务始终使用纯服务身份', () => {
    process.env.IP_AUTH_MODE = 'hybrid';
    process.env.IP_API_CLIENT_ID = 'erp-patent-job';
    process.env.IP_API_CLIENT_SECRET = 'job-secret';

    const headers = service.buildBackgroundRequestHeaders('patent-anomaly-scan');

    expect(headers).toMatchObject({
      'X-ERP-Service-Id': 'erp-patent-job',
      'X-ERP-Job-Name': 'patent-anomaly-scan'
    });
    expect(headers.Authorization).toBeUndefined();
  });

  test.each([
    ['Client ID 相同但 Secret 不同', () => {
      process.env.IP_API_CLIENT_ID = process.env.ERP_SSO_CLIENT_ID;
      process.env.IP_API_CLIENT_SECRET = 'ip-only-secret';
    }],
    ['Client Secret 相同但 ID 不同', () => {
      process.env.IP_API_CLIENT_ID = 'ip-only-client';
      process.env.IP_API_CLIENT_SECRET = process.env.ERP_SSO_CLIENT_SECRET;
    }]
  ])('IP 服务凭证%s时不得复用 SSO code 兑换凭证', (_label, configureIpCredential) => {
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.ERP_SSO_CLIENT_ID = 'erp-sso-client';
    process.env.ERP_SSO_CLIENT_SECRET = 'erp-sso-secret';
    configureIpCredential();

    expect(() => service.buildBackgroundRequestHeaders('job')).toThrow(
      expect.objectContaining({ code: 'IP_AUTH_CONFIGURATION_ERROR' })
    );
  });

  test('client_credentials 用户请求缺少 acting user 时拒绝', () => {
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.MAIN_API_CLIENT_ID = 'erp-business';
    process.env.MAIN_API_CLIENT_SECRET = 'business-secret';

    expect(() => service.buildUserRequestHeaders({ headers: {} })).toThrow(
      expect.objectContaining({ statusCode: 401 })
    );
  });

  test.each([
    ['缺少 permissionVersion', { id: 17, authSource: 'main_sso' }],
    ['permissionVersion 为负数', { id: 17, permissionVersion: -1, authSource: 'main_sso' }],
    ['permissionVersion 不是整数', { id: 17, permissionVersion: 'bad', authSource: 'main_sso' }]
  ])('client_credentials 用户存在 ID 但%s时拒绝', (_label, user) => {
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.MAIN_API_CLIENT_ID = 'erp-business';
    process.env.MAIN_API_CLIENT_SECRET = 'business-secret';

    expect(() => service.buildUserRequestHeaders({ headers: {}, user })).toThrow(
      expect.objectContaining({ statusCode: 401 })
    );
  });

  test('client_credentials 允许显式 permissionVersion=0 的过渡会话', () => {
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.MAIN_API_CLIENT_ID = 'erp-business';
    process.env.MAIN_API_CLIENT_SECRET = 'business-secret';

    const headers = service.buildUserRequestHeaders({
      headers: {},
      user: { id: 17, permissionVersion: 0, authSource: 'main_sso' }
    });

    expect(headers['X-Acting-Permission-Version']).toBe('0');
  });

  test('旧后台模式生成短期共享 JWT 供应急回滚', () => {
    process.env.IP_SYSTEM_USER_ID = '9';
    const headers = service.buildBackgroundRequestHeaders('legacy-job');
    const payload = jwt.verify(headers.Authorization.replace('Bearer ', ''), process.env.JWT_SECRET);

    expect(payload).toMatchObject({ id: 9, username: 'system', role: 'admin' });
  });

  test('未知认证模式 fail closed', () => {
    process.env.IP_AUTH_MODE = 'unknown';
    expect(() => service.buildBackgroundRequestHeaders('job')).toThrow(
      expect.objectContaining({ code: 'IP_AUTH_CONFIGURATION_ERROR' })
    );
  });

  test.each(['legacy_shared_jwt', 'hybrid'])(
    'legacy session 关闭后运行时拒绝 IP_AUTH_MODE=%s',
    (mode) => {
      process.env.ENABLE_LEGACY_SESSION = 'false';
      process.env.IP_AUTH_MODE = mode;

      expect(() => service.getAuthMode()).toThrow(
        expect.objectContaining({ code: 'IP_AUTH_CONFIGURATION_ERROR' })
      );
    }
  );

  test('全量 SSO client_credentials 不需要 JWT_SECRET 且拒绝 legacy acting user', () => {
    process.env.ENABLE_LEGACY_SESSION = 'false';
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.MAIN_API_CLIENT_ID = 'erp-business';
    process.env.MAIN_API_CLIENT_SECRET = 'business-secret';
    delete process.env.JWT_SECRET;

    const headers = service.buildUserRequestHeaders({
      headers: { authorization: 'Bearer must-not-leak' },
      user: { id: 17, permissionVersion: 9, authSource: 'main_sso' }
    });
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-Acting-Permission-Version']).toBe('9');

    expect(() => service.buildUserRequestHeaders({
      headers: { authorization: 'Bearer old-session' },
      user: { id: 17, permissionVersion: 0, authSource: 'legacy' }
    })).toThrow(expect.objectContaining({ statusCode: 401 }));
  });

  test('浏览器伪造的服务/acting/job Header 不会被转发覆盖服务端身份', () => {
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.MAIN_API_CLIENT_ID = 'server-client';
    process.env.MAIN_API_CLIENT_SECRET = 'server-secret';
    const headers = service.buildUserRequestHeaders({
      headers: {
        'x-erp-service-id': 'attacker-client',
        'x-erp-service-secret': 'attacker-secret',
        'x-acting-user-id': '999',
        'x-acting-permission-version': '999',
        'x-erp-job-name': 'attacker-job'
      },
      user: { id: 17, permissionVersion: 9, authSource: 'main_sso' }
    });

    expect(headers).toMatchObject({
      'X-ERP-Service-Id': 'server-client',
      'X-ERP-Service-Secret': 'server-secret',
      'X-Acting-User-Id': '17',
      'X-Acting-Permission-Version': '9'
    });
    expect(headers['X-ERP-Job-Name']).toBeUndefined();
  });

  test.each([
    ['Header 重名', { IP_API_ACTING_USER_ID_HEADER: 'x-erp-service-id' }],
    ['保留 Header', { IP_API_JOB_NAME_HEADER: 'Authorization' }],
    ['内容类型 Header', { IP_API_CLIENT_ID_HEADER: 'Content-Type' }],
    ['非法 Header 字符', { IP_API_CLIENT_ID_HEADER: 'X ERP Client' }]
  ])('%s配置时 fail-closed', (_label, config) => {
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.MAIN_API_CLIENT_ID = 'server-client';
    process.env.MAIN_API_CLIENT_SECRET = 'server-secret';
    Object.assign(process.env, config);

    expect(() => service.buildUserRequestHeaders({
      headers: {},
      user: { id: 17, permissionVersion: 9, authSource: 'main_sso' }
    })).toThrow(expect.objectContaining({ code: 'IP_AUTH_CONFIGURATION_ERROR' }));

    for (const key of Object.keys(config)) delete process.env[key];
  });

  test.each([
    ['字符串 acting user ID', { id: '17', permissionVersion: 9, authSource: 'main_sso' }],
    ['字符串权限版本', { id: 17, permissionVersion: '9', authSource: 'main_sso' }]
  ])('%s不能进入服务身份 Header', (_label, user) => {
    process.env.IP_AUTH_MODE = 'client_credentials';
    process.env.MAIN_API_CLIENT_ID = 'server-client';
    process.env.MAIN_API_CLIENT_SECRET = 'server-secret';

    expect(() => service.buildUserRequestHeaders({ headers: {}, user })).toThrow(
      expect.objectContaining({ statusCode: 401 })
    );
  });

  test.each(['', 'Bad Job', 'job\r\nX-Forged: yes'])(
    '非法后台任务名 %p 被拒绝',
    (jobName) => {
      process.env.IP_AUTH_MODE = 'client_credentials';
      process.env.MAIN_API_CLIENT_ID = 'server-client';
      process.env.MAIN_API_CLIENT_SECRET = 'server-secret';
      expect(() => service.buildBackgroundRequestHeaders(jobName)).toThrow(
        expect.objectContaining({ code: 'IP_AUTH_CONFIGURATION_ERROR' })
      );
    }
  );
});
