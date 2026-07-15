'use strict';

const fs = require('fs');
const path = require('path');
const manifest = require('../src/permissions/erp-permission-manifest.json');
const { PERMISSIONS } = require('../src/permissions/permissionCodes');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend', 'src');

function readFrontend(...segments) {
  return fs.readFileSync(path.join(FRONTEND_SRC, ...segments), 'utf8');
}

describe('ERP 前端统一认证流程静态验收', () => {
  test('正式权限目录固定为 Manifest v1.3.0 的 30 模块、117 权限、192 接口映射', () => {
    const permissions = manifest.modules.flatMap((module) => module.permissions);
    const routeCount = permissions.reduce((total, permission) => total + permission.routes.length, 0);

    expect(manifest.application.version).toBe('1.3.0');
    expect(manifest.modules).toHaveLength(30);
    expect(permissions).toHaveLength(117);
    expect(routeCount).toBe(192);
  });

  test('密码登录配置读取完成前和读取失败后均保持默认关闭', () => {
    const source = readFrontend('views', 'Login.vue');

    expect(source).toContain('const passwordLoginEnabled = ref(false)');
    expect(source).toContain('v-if="featuresLoaded && passwordLoginEnabled"');
    expect(source).toContain('v-else-if="featuresLoadFailed"');
    expect(source).toMatch(/catch\s*\{[\s\S]*?featuresLoadFailed\.value = true[\s\S]*?passwordLoginEnabled\.value = false/);
    expect(source).toContain('if (!featuresLoaded.value || !passwordLoginEnabled.value) return');
  });

  test('密码和 SSO 成功后只跳内部有权页面，不固定跳 Dashboard', () => {
    const loginSource = readFrontend('views', 'Login.vue');
    const callbackSource = readFrontend('views', 'SsoCallback.vue');
    const navigationSource = readFrontend('utils', 'authNavigation.js');

    expect(loginSource).toContain('resolvePostAuthRedirect(userStore, route.query.redirect)');
    expect(callbackSource).toContain('resolvePostAuthRedirect(userStore, requestedRedirect)');
    expect(loginSource).not.toMatch(/router\.(?:push|replace)\(\s*route\.query\.redirect/);
    expect(callbackSource).not.toMatch(/router\.replace\(\s*['"]\/dashboard['"]\s*\)/);
    expect(navigationSource).toContain("|| '/forbidden'");
    expect(navigationSource).toMatch(/userStore\.can\(destination\.permission\)/);
    expect(navigationSource).not.toMatch(/\brole\b|isAdmin|isFinance|hasRole/);

    const permissionKeys = [...navigationSource.matchAll(/PERMISSIONS\.([A-Z0-9_]+)/g)]
      .map((match) => match[1]);
    expect(permissionKeys.length).toBeGreaterThan(0);
    expect(permissionKeys.filter((key) => !Object.prototype.hasOwnProperty.call(PERMISSIONS, key))).toEqual([]);
  });

  test('SSO callback 兑换前清除旧会话和 URL code/state，错误后保持无登录态', () => {
    const source = readFrontend('views', 'SsoCallback.vue');
    const firstClear = source.indexOf('userStore.clearAuth()');
    const codeRead = source.indexOf('const code =');
    const stateRead = source.indexOf('const state =');
    const urlCleanup = source.indexOf("await router.replace({ path: '/sso/callback' })");
    const exchange = source.indexOf('await userStore.exchangeSsoCode(code, state)');
    const catchStart = source.indexOf('} catch (error)');
    const failureClear = source.indexOf('userStore.clearAuth()', firstClear + 1);

    expect(firstClear).toBeGreaterThan(-1);
    expect(firstClear).toBeLessThan(codeRead);
    expect(stateRead).toBeGreaterThan(codeRead);
    expect(urlCleanup).toBeGreaterThan(stateRead);
    expect(urlCleanup).toBeLessThan(exchange);
    expect(failureClear).toBeGreaterThan(catchStart);
    expect(source).not.toContain('使用备用登录');
    expect(source).toContain('查看登录选项');
  });

  test('401 立即失效本地会话，登录和 SSO 403 由页面单独展示', () => {
    const requestSource = readFrontend('api', 'request.js');
    const storeSource = readFrontend('stores', 'user.js');

    expect(requestSource).toContain("void userStore.expireSession('session_expired')");
    expect(requestSource).not.toContain('userStore.logout()');
    expect(requestSource).toMatch(/case 403:[\s\S]*?!isLoginReq && !isSsoExchangeReq/);

    const expireStart = storeSource.indexOf('function expireSession(');
    const clearIndex = storeSource.indexOf('clearAuth()', expireStart);
    const redirectIndex = storeSource.indexOf("router.replace({ path: '/login'", expireStart);
    expect(clearIndex).toBeGreaterThan(expireStart);
    expect(clearIndex).toBeLessThan(redirectIndex);
  });

  test('工资导出复用统一下载组件并由真实高风险权限控制', () => {
    const payrollSource = readFrontend('views', 'payroll', 'PayrollList.vue');
    const exportButtonSource = readFrontend('components', 'common', 'ExportButton.vue');
    const exportApiSource = readFrontend('api', 'export.js');

    expect(payrollSource).toContain('path="/export/payroll"');
    expect(payrollSource).toContain(':params="exportParams"');
    expect(payrollSource).toContain(':permission="PERMISSIONS.PAYROLL_EXPORT"');
    expect(payrollSource).toContain('status: filterStatus.value || undefined');
    expect(payrollSource).toContain('confirm');

    expect(exportButtonSource).toContain('await downloadExcel(props.path, props.params)');
    expect(exportButtonSource).toContain('v-if="userStore.can(permission)"');
    expect(exportApiSource).toContain('Authorization: userStore.token');
    expect(exportApiSource).not.toMatch(/localStorage\.(?:getItem|setItem)/);
  });
});
