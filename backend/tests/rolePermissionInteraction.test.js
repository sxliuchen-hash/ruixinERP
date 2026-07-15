const fs = require('fs');
const path = require('path');

const { buildAuthenticatedUser } = require('../src/middlewares/auth');
const { requirePermission } = require('../src/middlewares/requirePermission');
const { PERMISSIONS } = require('../src/permissions/permissionCodes');
const { encodePermissionGrants } = require('../src/permissions/permissionGrant');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_ROUTES = path.join(REPO_ROOT, 'backend', 'src', 'routes');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend', 'src');

function buildMainSsoUser(role, permissions) {
  return buildAuthenticatedUser({
    id: 41,
    username: 'permission-first-user',
    role,
    authSource: 'main_sso',
    iss: 'erp',
    aud: 'erp',
    permissionVersion: 7,
    permissionGrants: encodePermissionGrants(permissions)
  });
}

function runPermissionMiddleware(user, permissionCode) {
  const req = { user };
  const next = jest.fn();
  requirePermission(permissionCode)(req, {}, next);
  return { req, next, error: next.mock.calls[0]?.[0] };
}

describe('legacy role 与 main_sso 权限交互验收', () => {
  const originalLegacyFlag = process.env.ENABLE_LEGACY_SESSION;

  beforeEach(() => {
    process.env.ENABLE_LEGACY_SESSION = 'true';
  });

  afterAll(() => {
    if (originalLegacyFlag === undefined) delete process.env.ENABLE_LEGACY_SESSION;
    else process.env.ENABLE_LEGACY_SESSION = originalLegacyFlag;
  });

  test.each(['ordinary', 'unknown-main-role', '业务观察员']) (
    'main_sso role=%s 不在旧角色表中，只要签名权限存在仍可访问',
    (role) => {
      const user = buildMainSsoUser(role, {
        [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' },
        [PERMISSIONS.CONTRACT_UPDATE]: { allowed: true, scope: 'team' }
      });
      const result = runPermissionMiddleware(user, PERMISSIONS.CONTRACT_UPDATE);

      expect(user).toMatchObject({ role, authSource: 'main_sso' });
      expect(result.error).toBeUndefined();
      expect(result.req.permissionGrant).toEqual({ allowed: true, scope: 'team' });
    }
  );

  test('main_sso 即使 role=admin，缺少具体权限也必须返回 403', () => {
    const user = buildMainSsoUser('admin', {
      [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' }
    });
    const result = runPermissionMiddleware(user, PERMISSIONS.SYSTEM_UPDATE);

    expect(result.error).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(result.req.permissionGrant).toBeUndefined();
  });

  test('main_sso role=admin 也不能在缺少 erp.app.view 时建立 ERP 会话', () => {
    expect(() => buildMainSsoUser('admin', {
      [PERMISSIONS.SYSTEM_UPDATE]: { allowed: true, scope: 'all' }
    })).toThrow('无权访问 ERP');
  });

  test('legacy admin/process/agent 会话继续通过兼容映射，不要求主项目权限快照', () => {
    const admin = buildAuthenticatedUser({ id: 1, username: 'legacy-admin', role: 'admin' });
    const processUser = buildAuthenticatedUser({ id: 2, username: 'legacy-process', role: 'process' });
    const agent = buildAuthenticatedUser({ id: 3, username: 'legacy-agent', role: 'agent' });

    expect(runPermissionMiddleware(admin, PERMISSIONS.SYSTEM_UPDATE).error).toBeUndefined();
    expect(runPermissionMiddleware(processUser, PERMISSIONS.CONTRACT_VIEW).error).toBeUndefined();
    expect(runPermissionMiddleware(agent, PERMISSIONS.CONTRACT_VIEW).error).toBeUndefined();
    expect(agent.permissions[PERMISSIONS.CONTRACT_VIEW]).toEqual({ allowed: true, scope: 'self' });

    expect(runPermissionMiddleware(processUser, PERMISSIONS.SYSTEM_UPDATE).error)
      .toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  test('后端业务路由不得读取 req.user.role 或重新挂载旧角色中间件', () => {
    const offenders = [];
    for (const entry of fs.readdirSync(BACKEND_ROUTES, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      if (['auth.js', 'index.js', 'internal.js'].includes(entry.name)) continue;
      const source = fs.readFileSync(path.join(BACKEND_ROUTES, entry.name), 'utf8');
      if (
        /req\.user\.role/.test(source) ||
        /require(?:Role|Admin|ErpAccess)\s*\(/.test(source) ||
        /require\(['"]\.\.\/middlewares\/permission['"]\)/.test(source)
      ) {
        offenders.push(entry.name);
      }
    }

    expect(offenders).toEqual([]);
  });

  test('前端 main_sso 缺失 grant 时必须在 legacy admin 回退前拒绝', () => {
    const storeSource = fs.readFileSync(
      path.join(FRONTEND_SRC, 'stores', 'user.js'),
      'utf8'
    );
    const routerSource = fs.readFileSync(
      path.join(FRONTEND_SRC, 'router', 'index.js'),
      'utf8'
    );
    const canStart = storeSource.indexOf('function can(permissionCode)');
    const canEnd = storeSource.indexOf('function canAny(', canStart);
    const canSource = storeSource.slice(canStart, canEnd);
    const grantCheck = canSource.indexOf('permissions.value, permissionCode');
    const ssoDeny = canSource.indexOf("authSource.value === 'main_sso'");
    const legacyFallback = canSource.indexOf('legacyCan(userInfo.value.role, permissionCode)');

    expect(grantCheck).toBeGreaterThan(-1);
    expect(ssoDeny).toBeGreaterThan(grantCheck);
    expect(legacyFallback).toBeGreaterThan(ssoDeny);
    expect(canSource).not.toMatch(/role\s*===\s*['"]admin['"]/);
    expect(routerSource).toMatch(/userStore\.can\s*\(/);
    expect(routerSource).not.toMatch(/userInfo\.role|userStore\.userInfo\.role|role\s*===/);
  });

  test('前端角色硬编码只允许存在于 legacy 适配和员工业务展示，不得进入授权组件', () => {
    const authorizationFiles = [
      ['utils', 'permission.js'],
      ['components', 'layout', 'Sidebar.vue'],
      ['components', 'common', 'ExportButton.vue'],
      ['components', 'layout', 'SystemSwitch.vue']
    ];
    const offenders = [];

    for (const segments of authorizationFiles) {
      const file = path.join(FRONTEND_SRC, ...segments);
      const source = fs.readFileSync(file, 'utf8');
      if (/role\s*(?:===|!==)|isAdmin|isFinance|hasRole/.test(source)) {
        offenders.push(segments.join('/'));
      }
    }

    expect(offenders).toEqual([]);
  });
});
