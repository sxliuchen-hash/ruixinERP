'use strict';

jest.mock('../src/config/redis', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  eval: jest.fn(),
  on: jest.fn()
}));

const app = require('../src/app');
const manifest = require('../src/permissions/erp-permission-manifest.json');

const PUBLIC_ROUTES = new Set([
  'GET /api/v1/health',
  'GET /api/v1/health/live',
  'GET /api/v1/health/ready',
  'GET /api/v1/auth/features',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/sso/initiate',
  'POST /api/v1/auth/sso/exchange',
  'GET /api/v1/wechat/callback',
  'POST /api/v1/wechat/callback'
]);

const AUTH_ONLY_ROUTES = new Set([
  'POST /api/v1/auth/logout',
  'GET /api/v1/auth/profile'
]);

const INTERNAL_SERVICE_ROUTES = new Map([
  ['GET /api/v1/internal/permissions/manifest', ['requireManifestClient']],
  [
    'POST /api/v1/internal/provisioning/employees',
    ['requireProvisionClient', 'requireIdempotencyKey']
  ]
]);

const ALTERNATE_AUTH_ROUTES = new Map([
  ['GET /api/v1/files/download', ['ticketOrAuth']]
]);

function mountPathFromRegexp(regexp) {
  const source = regexp?.source || '';
  if (source === '^\\/?(?=\\/|$)') return '';

  const match = source.match(/^\^\\\/(.+)\\\/\?\(\?=\\\/\|\$\)$/);
  if (!match) throw new Error(`无法解析 Express mount regexp: ${regexp}`);

  return `/${match[1]}`
    .replace(/\\\//g, '/')
    .replace(/\\-/g, '-');
}

function joinPaths(prefix, routePath) {
  const localPath = routePath === '/' ? '' : String(routePath);
  return `${prefix}${localPath}` || '/';
}

function enumerateExpressRoutes(stack, prefix = '', inheritedMiddleware = []) {
  const routes = [];
  const activeMiddleware = [...inheritedMiddleware];

  for (const layer of stack) {
    if (layer.route) {
      const routePaths = Array.isArray(layer.route.path)
        ? layer.route.path
        : [layer.route.path];
      const routeMiddleware = layer.route.stack.map((item) => item.handle?.name || 'anonymous');
      const middlewareNames = [...activeMiddleware, ...routeMiddleware];

      for (const routePath of routePaths) {
        for (const method of Object.keys(layer.route.methods).filter((key) => layer.route.methods[key])) {
          routes.push({
            route: `${method.toUpperCase()} ${joinPaths(prefix, routePath)}`,
            middlewareNames
          });
        }
      }
      continue;
    }

    if (Array.isArray(layer.handle?.stack)) {
      routes.push(...enumerateExpressRoutes(
        layer.handle.stack,
        `${prefix}${mountPathFromRegexp(layer.regexp)}`,
        activeMiddleware
      ));
      continue;
    }

    activeMiddleware.push(layer.handle?.name || 'anonymous');
  }

  return routes;
}

describe('真实 Express 路由与 Manifest 覆盖门禁', () => {
  const enumerated = enumerateExpressRoutes(app._router.stack);
  const routeMap = new Map(enumerated.map((item) => [item.route, item]));
  const manifestRoutes = new Set(
    manifest.modules.flatMap((module) =>
      module.permissions.flatMap((permission) => permission.routes)
    )
  );
  const nonManifestWhitelist = new Set([
    ...PUBLIC_ROUTES,
    ...AUTH_ONLY_ROUTES,
    ...INTERNAL_SERVICE_ROUTES.keys()
  ]);

  test('运行时真实路由无重复 method/path', () => {
    expect(enumerated).toHaveLength(205);
    expect(enumerated).toHaveLength(routeMap.size);
    expect(nonManifestWhitelist.size).toBe(13);
  });

  test('192 条 Manifest route 与真实 Express 业务路由双向完全一致', () => {
    expect(manifestRoutes.size).toBe(192);

    const actualBusinessRoutes = new Set(
      [...routeMap.keys()].filter((route) => !nonManifestWhitelist.has(route))
    );
    expect([...actualBusinessRoutes].sort()).toEqual([...manifestRoutes].sort());
  });

  test('所有非 Manifest 路由必须精确属于公开、仅认证或内部服务白名单', () => {
    const actualNonManifestRoutes = new Set(
      [...routeMap.keys()].filter((route) => !manifestRoutes.has(route))
    );
    expect([...actualNonManifestRoutes].sort()).toEqual([...nonManifestWhitelist].sort());
  });

  test('所有 Manifest 业务路由在真实 Express 链上均经过会话或一次性票据认证', () => {
    const missingAuthentication = [...manifestRoutes].filter((route) => {
      const middlewareNames = routeMap.get(route)?.middlewareNames || [];
      if (middlewareNames.includes('authenticate')) return false;
      const alternateMiddleware = ALTERNATE_AUTH_ROUTES.get(route);
      return !alternateMiddleware ||
        !alternateMiddleware.every((middlewareName) => middlewareNames.includes(middlewareName));
    });
    expect(missingAuthentication).toEqual([]);
  });

  test('auth-only 与内部服务路由使用各自规定的认证中间件', () => {
    for (const route of AUTH_ONLY_ROUTES) {
      expect(routeMap.get(route)?.middlewareNames).toContain('authenticate');
    }
    for (const [route, middlewareNames] of INTERNAL_SERVICE_ROUTES) {
      expect(routeMap.get(route)).toBeDefined();
      for (const middlewareName of middlewareNames) {
        expect(routeMap.get(route).middlewareNames).toContain(middlewareName);
      }
    }
  });
});
