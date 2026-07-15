'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend', 'src');

function walkFiles(dir, extensions) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(absolutePath, extensions);
    return entry.isFile() && extensions.has(path.extname(entry.name)) ? [absolutePath] : [];
  });
}

describe('前端登录角色授权静态审计', () => {
  test('只有显式 legacy 会话可使用角色映射，main_sso/未知来源均默认拒绝', () => {
    const source = fs.readFileSync(path.join(FRONTEND_SRC, 'stores', 'user.js'), 'utf8');
    const canStart = source.indexOf('function can(permissionCode)');
    const canSsoDeny = source.indexOf("if (authSource.value !== 'legacy') return false", canStart);
    const legacyCanFallback = source.indexOf('return legacyCan(', canStart);
    const scopeStart = source.indexOf('function scopeOf(permissionCode)');
    const scopeSsoDeny = source.indexOf("if (authSource.value !== 'legacy') return 'none'", scopeStart);
    const legacyScopeFallback = source.indexOf('return legacyScope(', scopeStart);

    expect(canStart).toBeGreaterThan(-1);
    expect(canSsoDeny).toBeGreaterThan(canStart);
    expect(canSsoDeny).toBeLessThan(legacyCanFallback);
    expect(scopeStart).toBeGreaterThan(-1);
    expect(scopeSsoDeny).toBeGreaterThan(scopeStart);
    expect(scopeSsoDeny).toBeLessThan(legacyScopeFallback);
  });

  test('登录角色判断只能存在于 legacy 兼容或纯展示/员工业务字段白名单', () => {
    const allowedRoleFiles = new Set([
      'constants/permissions.js', // authSource=legacy 的显式兼容适配器
      'stores/user.js', // 保存身份标签，并在 main_sso 默认拒绝后调用 legacy 适配器
      'layout/MainLayout.vue', // 只展示主项目返回的账号身份标签
      'views/employee/EmployeeList.vue', // 员工岗位影响薪酬字段展示，动作仍检查权限码
      'views/payroll/PayrollList.vue' // 工资条展示员工岗位，不参与当前用户授权
    ]);
    const roleAuthorizationPatterns = [
      /\b(?:userStore|userInfo|user)\s*\.\s*role\b/,
      /\brole\s*(?:===|!==|==|!=)/,
      /\b(?:hasRole|requireRole|isAdmin|isFinance)\b/,
      /meta\s*\.\s*role\b/,
      /\[(?:[^\]\r\n]*['"](?:admin|process|agent)['"]){2,}[^\]\r\n]*\]/
    ];
    const offenders = [];

    for (const file of walkFiles(FRONTEND_SRC, new Set(['.js', '.vue', '.ts']))) {
      const relativePath = path.relative(FRONTEND_SRC, file).replace(/\\/g, '/');
      if (allowedRoleFiles.has(relativePath)) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (roleAuthorizationPatterns.some((pattern) => pattern.test(source))) {
        offenders.push(relativePath);
      }
    }

    expect(offenders).toEqual([]);
  });

  test('菜单和路由只使用权限编码，不读取登录角色', () => {
    const routerSource = fs.readFileSync(path.join(FRONTEND_SRC, 'router', 'index.js'), 'utf8');
    const sidebarSource = fs.readFileSync(
      path.join(FRONTEND_SRC, 'components', 'layout', 'Sidebar.vue'),
      'utf8'
    );

    for (const source of [routerSource, sidebarSource]) {
      expect(source).not.toMatch(/\brole\b/i);
      expect(source).not.toMatch(/\b(?:admin|process|agent)\b/i);
    }
    expect(routerSource).toMatch(/meta:\s*\{[^}]*permission:\s*PERMISSIONS\./);
    expect(sidebarSource).toMatch(/can\(PERMISSIONS\./);
    expect(sidebarSource).toMatch(/canAny\(/);
  });

  test('员工岗位 role 只影响业务字段展示，员工操作仍显式检查权限码', () => {
    const employeeSource = fs.readFileSync(
      path.join(FRONTEND_SRC, 'views', 'employee', 'EmployeeList.vue'),
      'utf8'
    );

    expect(employeeSource).not.toMatch(/userStore\.userInfo\.role/);
    expect(employeeSource).toMatch(/row\.role === 'sales'/);
    expect(employeeSource).toMatch(
      /row\.role === 'sales'\s*&&\s*can\(PERMISSIONS\.EMPLOYEE_UPDATE\)/
    );
  });
});
