const fs = require('fs');
const path = require('path');
const {
  getLegacyAuthorizationRole
} = require('../src/permissions/legacyRoleAdapter');
const {
  requireRole,
  requireAdmin
} = require('../src/middlewares/permission');

describe('main_sso 与 legacy 角色授权隔离', () => {
  test.each(['admin', 'process', 'agent', 'supervisor', 'client'])(
    'main_sso role=%s 不得进入 legacy 角色授权通道',
    (role) => {
      expect(getLegacyAuthorizationRole({ authSource: 'main_sso', role })).toBeNull();
    }
  );

  test.each(['admin', 'process', 'agent'])(
    'legacy role=%s 保留旧登录兼容',
    (role) => {
      expect(getLegacyAuthorizationRole({ authSource: 'legacy', role })).toBe(role);
    }
  );

  test.each([
    ['requireRole', requireRole('admin')],
    ['requireAdmin', requireAdmin()]
  ])('%s 不得因 main_sso role=admin 绕过 Manifest 权限', (_label, middleware) => {
    const next = jest.fn();
    middleware({ user: { authSource: 'main_sso', role: 'admin' } }, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      code: 'FORBIDDEN'
    }));
  });

  test.each([
    ['requireRole', requireRole('admin')],
    ['requireAdmin', requireAdmin()]
  ])('%s 在 Manifest 权限已通过后不解释 main_sso 角色名', (_label, middleware) => {
    const next = jest.fn();
    middleware({
      user: { authSource: 'main_sso', role: 'arbitrary-main-role' },
      permissionCode: 'erp.system.update',
      permissionGrant: { allowed: true, scope: 'all' }
    }, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('legacy requireRole/requireAdmin 行为保持不变', () => {
    const roleAllowed = jest.fn();
    const roleDenied = jest.fn();
    const adminAllowed = jest.fn();
    const adminDenied = jest.fn();

    requireRole('process')({ user: { authSource: 'legacy', role: 'process' } }, {}, roleAllowed);
    requireRole('process')({ user: { authSource: 'legacy', role: 'agent' } }, {}, roleDenied);
    requireAdmin()({ user: { authSource: 'legacy', role: 'admin' } }, {}, adminAllowed);
    requireAdmin()({ user: { authSource: 'legacy', role: 'process' } }, {}, adminDenied);

    expect(roleAllowed).toHaveBeenCalledWith();
    expect(adminAllowed).toHaveBeenCalledWith();
    expect(roleDenied).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(adminDenied).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  test('路由不再使用 legacy requireRole/requireAdmin 作为接口授权', () => {
    const routesDir = path.join(__dirname, '..', 'src', 'routes');
    const failures = [];

    for (const filename of fs.readdirSync(routesDir).filter((name) => name.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(routesDir, filename), 'utf8');
      if (/\brequire(Role|Admin)\s*\(/.test(source)) failures.push(filename);
    }

    expect(failures).toEqual([]);
  });

  test('带 legacy scope fallback 的 controller 不直接传递 main_sso role', () => {
    for (const filename of [
      'inventoryController.js',
      'projectController.js',
      'notificationController.js'
    ]) {
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'controllers', filename),
        'utf8'
      );
      expect(source).toMatch(/getLegacyAuthorizationRole/);
      expect(source).not.toMatch(/req\.user\.role/);
      expect(source).not.toMatch(/role:\s*userRole\s*}\s*=\s*req\.user/);
    }
  });

  test('Employee role 仅用于薪酬业务属性和主项目 Employee 建档同步', () => {
    const allowedBusinessFiles = new Set([
      'employeeProvisioningService.js',
      'exportService.js',
      'payrollService.js',
      'performanceService.js',
      'purchaseCommissionService.js'
    ]);
    const servicesDir = path.join(__dirname, '..', 'src', 'services');
    const unexpected = [];

    for (const filename of fs.readdirSync(servicesDir).filter((name) => name.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(servicesDir, filename), 'utf8');
      if (/\b(emp|employee|employees|e)\.role\b/.test(source) && !allowedBusinessFiles.has(filename)) {
        unexpected.push(filename);
      }
    }

    expect(unexpected).toEqual([]);
  });
});
