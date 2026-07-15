'use strict';

const fs = require('fs');
const path = require('path');
const { PERMISSIONS } = require('../src/permissions/permissionCodes');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend', 'src');

function readFrontend(...segments) {
  return fs.readFileSync(path.join(FRONTEND_SRC, ...segments), 'utf8');
}

function normalizeRoutePath(routePath) {
  return routePath.startsWith('/') ? routePath : `/${routePath}`;
}

function extractRouterPermissions(source) {
  const result = new Map();
  const routeBlocks = source.matchAll(
    /\{\s*path:\s*'([^']+)'[\s\S]*?name:\s*'[^']+'[\s\S]*?component:\s*\(\)\s*=>\s*import\([^)]*\),?[\s\S]*?meta:\s*\{([^}]*)\}/g
  );

  for (const match of routeBlocks) {
    const permission = match[2].match(/permission:\s*PERMISSIONS\.([A-Z0-9_]+)/)?.[1];
    if (permission) result.set(normalizeRoutePath(match[1]), permission);
  }
  return result;
}

function extractSidebarPermissions(source) {
  const result = new Map();
  const menuTags = source.matchAll(/<el-menu-item\b[^>]*\bindex="(\/[^"?]+)"[^>]*>/g);

  for (const match of menuTags) {
    const permission = match[0].match(/v-if="can\(PERMISSIONS\.([A-Z0-9_]+)\)"/)?.[1];
    if (!permission) throw new Error(`侧栏菜单 ${match[1]} 未在标签自身声明 can(PERMISSIONS.*)`);
    result.set(match[1], permission);
  }
  return result;
}

function extractAuthorizedDestinations(source) {
  return new Map([...source.matchAll(
    /\{\s*path:\s*'([^']+)'\s*,\s*permission:\s*PERMISSIONS\.([A-Z0-9_]+)\s*,[\s\S]*?pattern:/g
  )].map((match) => [match[1], match[2]]));
}

function loadAuthNavigation() {
  const source = readFrontend('utils', 'authNavigation.js');
  const runnable = source
    .replace(
      /^import\s+\{\s*PERMISSIONS\s*\}\s+from\s+['"][^'"]+['"]\s*;?\s*/,
      `const PERMISSIONS = ${JSON.stringify(PERMISSIONS)};\n`
    )
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+\{\s*AUTHORIZED_DESTINATIONS\s*\}\s*;?/, '')
    .concat('\nreturn { AUTHORIZED_DESTINATIONS, normalizeLocalRedirect, resolvePostAuthRedirect };');

  return Function(runnable)();
}

function createUserStore(...permissionCodes) {
  const allowed = new Set(permissionCodes);
  return { can: (permissionCode) => allowed.has(permissionCode) };
}

describe('ERP 前端路由、菜单与登录落地权限覆盖', () => {
  const routerSource = readFrontend('router', 'index.js');
  const sidebarSource = readFrontend('components', 'layout', 'Sidebar.vue');
  const navigationSource = readFrontend('utils', 'authNavigation.js');

  test('所有侧栏菜单与 Router、登录落地点三方路径和权限精确一致', () => {
    const routerPermissions = extractRouterPermissions(routerSource);
    const sidebarPermissions = extractSidebarPermissions(sidebarSource);
    const authorizedDestinations = extractAuthorizedDestinations(navigationSource);

    expect(sidebarPermissions.size).toBeGreaterThan(0);
    expect([...authorizedDestinations.entries()].sort()).toEqual(
      [...sidebarPermissions.entries()].sort()
    );

    const routerMenuPermissions = new Map(
      [...routerPermissions.entries()].filter(([routePath]) => sidebarPermissions.has(routePath))
    );
    expect([...routerMenuPermissions.entries()].sort()).toEqual(
      [...sidebarPermissions.entries()].sort()
    );

    const missingRouterMenus = [...sidebarPermissions.keys()]
      .filter((routePath) => !routerPermissions.has(routePath));
    expect(missingRouterMenus).toEqual([]);
  });

  test('详情路由沿用所属模块 view 权限，且登录重定向可识别详情路径', () => {
    const routerPermissions = extractRouterPermissions(routerSource);
    const { AUTHORIZED_DESTINATIONS } = loadAuthNavigation();
    const detailMatrix = [
      ['/contracts/:id', '/contracts/123', PERMISSIONS.CONTRACT_VIEW],
      ['/projects/:id', '/projects/7', PERMISSIONS.PROJECT_VIEW],
      ['/inventory/:id', '/inventory/9', PERMISSIONS.INVENTORY_VIEW]
    ];

    for (const [routePath, concretePath, permissionCode] of detailMatrix) {
      const permissionKey = Object.entries(PERMISSIONS)
        .find(([, code]) => code === permissionCode)?.[0];
      expect(routerPermissions.get(routePath)).toBe(permissionKey);

      const destination = AUTHORIZED_DESTINATIONS.find((item) => item.pattern.test(concretePath));
      expect(destination).toMatchObject({ permission: permissionCode });
    }
  });

  test('特殊子路径必须排在通用前缀之前，避免误用库存或业绩权限', () => {
    const paths = [...extractAuthorizedDestinations(navigationSource).keys()];

    expect(paths.indexOf('/inventory/anomalies')).toBeLessThan(paths.indexOf('/inventory'));
    expect(paths.indexOf('/inventory/sold-analytics')).toBeLessThan(paths.indexOf('/inventory'));
    expect(paths.indexOf('/performance/import')).toBeLessThan(paths.indexOf('/performance'));
    expect(paths.indexOf('/performance/purchase-commission')).toBeLessThan(
      paths.indexOf('/performance')
    );
  });

  test('登录后重定向拒绝外部地址、反斜杠和多层编码路径穿越', () => {
    const { normalizeLocalRedirect } = loadAuthNavigation();
    const rejected = [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/%2F%2Fevil.example',
      '/%252F%252Fevil.example',
      '/contracts/../payroll',
      '/contracts/%2e%2e/payroll',
      '/contracts/%252e%252e/payroll',
      '/login',
      '/sso/callback',
      '/forbidden'
    ];

    for (const redirect of rejected) {
      expect(normalizeLocalRedirect(redirect)).toBe('');
    }
    expect(normalizeLocalRedirect('/contracts/123?tab=files')).toBe('/contracts/123?tab=files');
  });

  test('登录后仅保留有权路径，否则回落到第一个有权菜单或无权页', () => {
    const { resolvePostAuthRedirect } = loadAuthNavigation();

    expect(resolvePostAuthRedirect(
      createUserStore(PERMISSIONS.CONTRACT_VIEW),
      '/contracts/123?tab=files'
    )).toBe('/contracts/123?tab=files');
    expect(resolvePostAuthRedirect(
      createUserStore(PERMISSIONS.PROJECT_VIEW),
      '/projects/7'
    )).toBe('/projects/7');
    expect(resolvePostAuthRedirect(
      createUserStore(PERMISSIONS.INVENTORY_VIEW),
      '/inventory/9'
    )).toBe('/inventory/9');
    expect(resolvePostAuthRedirect(
      createUserStore(PERMISSIONS.INVENTORY_VIEW),
      '/inventory/anomalies'
    )).toBe('/inventory');
    expect(resolvePostAuthRedirect(
      createUserStore(PERMISSIONS.INVENTORY_ANOMALY_VIEW),
      '/inventory/anomalies'
    )).toBe('/inventory/anomalies');
    expect(resolvePostAuthRedirect(
      createUserStore(PERMISSIONS.INVENTORY_VIEW),
      '/inventory/sold-analytics'
    )).toBe('/inventory/sold-analytics');
    expect(resolvePostAuthRedirect(
      createUserStore(PERMISSIONS.EXPENSE_VIEW),
      '/dashboard'
    )).toBe('/expenses');
    expect(resolvePostAuthRedirect(
      createUserStore(PERMISSIONS.CONTRACT_VIEW),
      '/payroll'
    )).toBe('/contracts');
    expect(resolvePostAuthRedirect(createUserStore(), '/dashboard')).toBe('/forbidden');
  });
});
