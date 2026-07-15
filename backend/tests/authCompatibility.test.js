jest.mock('../src/services/authService', () => ({
  login: jest.fn(),
  getProfile: jest.fn()
}));

const authService = require('../src/services/authService');
const authController = require('../src/controllers/authController');
const ssoController = require('../src/controllers/ssoController');
const authRouter = require('../src/routes/auth');
const {
  buildAuthenticatedUser,
  resolveVerificationSecret,
  validateMainSsoSessionClaims
} = require('../src/middlewares/auth');
const { PERMISSIONS } = require('../src/permissions/permissionCodes');
const { encodePermissionGrants } = require('../src/permissions/permissionGrant');

describe('双模式认证兼容性', () => {
  const originalPasswordFlag = process.env.ENABLE_PASSWORD_LOGIN;
  const originalLegacySessionFlag = process.env.ENABLE_LEGACY_SESSION;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalPasswordFlag === undefined) delete process.env.ENABLE_PASSWORD_LOGIN;
    else process.env.ENABLE_PASSWORD_LOGIN = originalPasswordFlag;
    if (originalLegacySessionFlag === undefined) delete process.env.ENABLE_LEGACY_SESSION;
    else process.env.ENABLE_LEGACY_SESSION = originalLegacySessionFlag;
  });

  test('旧密码登录缺省开启并保持原响应契约', async () => {
    delete process.env.ENABLE_PASSWORD_LOGIN;
    const loginResult = {
      token: 'legacy-token',
      user: { id: 7, username: 'agent01', role: 'agent' },
      permissions: {
        [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' }
      },
      authSource: 'legacy',
      permissionVersion: 0
    };
    authService.login.mockResolvedValue(loginResult);
    const req = { body: { username: '  agent01  ', password: 'secret' } };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await authController.login(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(authService.login).toHaveBeenCalledWith('agent01', 'secret');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: '登录成功',
      data: loginResult
    });
  });

  test('显式关闭密码登录后在查询用户前拒绝', async () => {
    process.env.ENABLE_PASSWORD_LOGIN = 'false';
    const next = jest.fn();

    await authController.login(
      { body: { username: 'admin', password: 'secret' } },
      { json: jest.fn() },
      next
    );

    expect(authService.login).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN'
    });
  });

  test.each(['admin', 'process', 'agent'])('旧 %s JWT 继续产生兼容权限，入口 scope=all', (role) => {
    const user = buildAuthenticatedUser({ id: 8, username: 'legacy-user', role });

    expect(user).toMatchObject({
      id: 8,
      username: 'legacy-user',
      role,
      authSource: 'legacy',
      permissionVersion: 0
    });
    expect(user.permissions[PERMISSIONS.APP_VIEW]).toEqual({ allowed: true, scope: 'all' });
    if (role === 'agent') {
      expect(user.permissions[PERMISSIONS.CONTRACT_VIEW]).toEqual({ allowed: true, scope: 'self' });
    }
  });

  test('旧 JWT 可兼容缺少 authSource，但显式未知认证来源必须拒绝', () => {
    expect(buildAuthenticatedUser({ id: 8, username: 'legacy-user', role: 'admin' }))
      .toMatchObject({ authSource: 'legacy' });
    expect(() => buildAuthenticatedUser({
      id: 8,
      username: 'legacy-user',
      role: 'admin',
      authSource: 'unknown'
    })).toThrow('认证来源无效');
  });

  test.each(['supervisor', 'client', 'sub_account', 'sub_department'])(
    '旧 JWT 的非历史 ERP 角色 %s 不能借兼容层进入',
    (role) => {
      expect(() => buildAuthenticatedUser({ id: 8, username: 'legacy-user', role }))
        .toThrow('无权访问 ERP');
    }
  );

  test('旧 session 可独立下线并可通过开关回滚，不影响密码端点开关', () => {
    process.env.ENABLE_LEGACY_SESSION = 'false';
    process.env.ENABLE_PASSWORD_LOGIN = 'true';

    expect(() => buildAuthenticatedUser({ id: 8, username: 'legacy-user', role: 'admin' }))
      .toThrow('旧版 ERP 会话已失效');

    process.env.ENABLE_LEGACY_SESSION = 'true';
    expect(buildAuthenticatedUser({ id: 8, username: 'legacy-user', role: 'admin' }))
      .toMatchObject({ id: 8, authSource: 'legacy' });
  });

  test('main_sso 会话可承载 supervisor 和签名权限快照', () => {
    const permissions = {
      [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' },
      [PERMISSIONS.EXPENSE_VIEW]: { allowed: true, scope: 'team' }
    };
    const user = buildAuthenticatedUser({
      id: 12,
      username: 'leader01',
      role: 'supervisor',
      authSource: 'main_sso',
      iss: 'erp',
      aud: 'erp',
      permissionVersion: 3,
      permissionGrants: encodePermissionGrants(permissions)
    });

    expect(user).toMatchObject({
      id: 12,
      role: 'supervisor',
      authSource: 'main_sso',
      permissionVersion: 3,
      permissions
    });
  });

  test.each(['admin', 'process', 'agent', 'client'])(
    'main_sso role=%s 不注入 legacy 权限，也不改写 assertion scope',
    (role) => {
      const permissions = {
        [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' },
        [PERMISSIONS.EXPENSE_VIEW]: { allowed: true, scope: 'all' }
      };
      const user = buildAuthenticatedUser({
        id: 12,
        username: 'sso-user',
        role,
        authSource: 'main_sso',
        iss: 'erp',
        aud: 'erp',
        permissionVersion: 3,
        permissionGrants: encodePermissionGrants(permissions)
      });

      expect(user.permissions).toEqual(permissions);
      expect(user.permissions[PERMISSIONS.PAYROLL_PAY]).toBeUndefined();
      expect(user.permissions[PERMISSIONS.EXPENSE_VIEW].scope).toBe('all');
    }
  );

  test.each([
    ['签发方错误', { iss: 'main', aud: 'erp', permissionVersion: 1 }],
    ['接收方错误', { iss: 'erp', aud: 'other', permissionVersion: 1 }],
    ['权限版本非法', { iss: 'erp', aud: 'erp', permissionVersion: -1 }]
  ])('main_sso %s 时 fail-closed', (_label, claims) => {
    expect(() => buildAuthenticatedUser({
      id: 12,
      username: 'leader01',
      role: 'supervisor',
      authSource: 'main_sso',
      permissionGrants: encodePermissionGrants({
        [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' }
      }),
      ...claims
    })).toThrow();
  });

  test('main_sso 缺少入口权限时拒绝', () => {
    expect(() => buildAuthenticatedUser({
      id: 12,
      username: 'leader01',
      role: 'supervisor',
      authSource: 'main_sso',
      iss: 'erp',
      aud: 'erp',
      permissionVersion: 1,
      permissionGrants: encodePermissionGrants({
        [PERMISSIONS.CONTRACT_VIEW]: { allowed: true, scope: 'team' }
      })
    })).toThrow('无权访问 ERP');
  });

  test('生产环境 main_sso 会话不得回退使用旧 JWT_SECRET', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSessionSecret = process.env.ERP_SESSION_SECRET;
    const originalJwtSecret = process.env.JWT_SECRET;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ERP_SESSION_SECRET;
      process.env.JWT_SECRET = 'legacy-shared-secret';

      expect(() => resolveVerificationSecret(true))
        .toThrow('ERP 单点登录会话配置无效');
      expect(resolveVerificationSecret(false)).toBe('legacy-shared-secret');
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalSessionSecret === undefined) delete process.env.ERP_SESSION_SECRET;
      else process.env.ERP_SESSION_SECRET = originalSessionSecret;
      if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  test('ERP 短会话要求 sub/id、jti、assertionJti 和权限版本严格一致', () => {
    const valid = {
      authSource: 'main_sso',
      sub: '12',
      id: 12,
      iat: 100,
      exp: 200,
      jti: 'erp-session-jti',
      assertionJti: 'main-assertion-jti',
      permissionVersion: 3
    };
    expect(validateMainSsoSessionClaims(valid)).toBe(true);

    for (const invalid of [
      { ...valid, sub: '13' },
      { ...valid, sub: 12 },
      { ...valid, jti: '' },
      { ...valid, assertionJti: null },
      { ...valid, permissionVersion: '3' },
      { ...valid, exp: 100 }
    ]) {
      expect(() => validateMainSsoSessionClaims(invalid)).toThrow(
        expect.objectContaining({ statusCode: 401 })
      );
    }
  });

  test('认证路由同时注册密码登录与 SSO code 兑换，且兑换只接受 POST', () => {
    const routes = authRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).filter((method) => layer.route.methods[method])
      }));

    expect(routes).toEqual(expect.arrayContaining([
      { path: '/login', methods: ['post'] },
      { path: '/sso/initiate', methods: ['post'] },
      { path: '/sso/exchange', methods: ['post'] },
      { path: '/logout', methods: ['post'] },
      { path: '/profile', methods: ['get'] }
    ]));
  });

  test.each([undefined, null, '', 'short', 123, 'x'.repeat(513)])(
    'SSO controller 拒绝非法 code=%p，且不会尝试兑换',
    async (code) => {
      const next = jest.fn();
      await ssoController.exchange(
        { body: { code } },
        { json: jest.fn() },
        next
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR'
      });
    }
  );
});
