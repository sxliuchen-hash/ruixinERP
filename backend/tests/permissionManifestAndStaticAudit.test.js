const fs = require('fs');
const path = require('path');
const manifest = require('../src/permissions/erp-permission-manifest.json');
const { getPermissionManifest } = require('../src/permissions/manifest');
const {
  PERMISSIONS,
  ALL_PERMISSION_CODES,
  isKnownPermission
} = require('../src/permissions/permissionCodes');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_SRC = path.join(REPO_ROOT, 'backend', 'src');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend', 'src');

const EXPORT_PERMISSION_MATRIX = Object.freeze([
  {
    key: 'PAYMENT_EXPORT',
    code: 'erp.payment.export',
    viewKey: 'PAYMENT_VIEW',
    route: 'GET /api/v1/export/payments',
    localPath: '/payments',
    scopes: ['self', 'team', 'all'],
    page: 'views/payment/PaymentList.vue'
  },
  {
    key: 'CONTRACT_EXPORT',
    code: 'erp.contract.export',
    viewKey: 'CONTRACT_VIEW',
    route: 'GET /api/v1/export/contracts',
    localPath: '/contracts',
    scopes: ['self', 'team', 'all'],
    page: 'views/contract/ContractList.vue'
  },
  {
    key: 'INVENTORY_EXPORT',
    code: 'erp.inventory.export',
    viewKey: 'INVENTORY_VIEW',
    route: 'GET /api/v1/export/inventory',
    localPath: '/inventory',
    scopes: ['self', 'team', 'all'],
    page: 'views/inventory/InventoryList.vue'
  },
  {
    key: 'INVOICE_EXPORT',
    code: 'erp.invoice.export',
    viewKey: 'INVOICE_VIEW',
    route: 'GET /api/v1/export/invoices',
    localPath: '/invoices',
    scopes: ['all'],
    page: 'views/invoice/InvoiceList.vue'
  },
  {
    key: 'EXPENSE_EXPORT',
    code: 'erp.expense.export',
    viewKey: 'EXPENSE_VIEW',
    route: 'GET /api/v1/export/expenses',
    localPath: '/expenses',
    scopes: ['self', 'team', 'all'],
    page: 'views/expense/ExpenseList.vue'
  },
  {
    key: 'PROJECT_EXPORT',
    code: 'erp.project.export',
    viewKey: 'PROJECT_VIEW',
    route: 'GET /api/v1/export/projects',
    localPath: '/projects',
    scopes: ['self', 'team', 'all'],
    page: 'views/project/ProjectList.vue'
  },
  {
    key: 'COST_EXPORT',
    code: 'erp.cost.export',
    viewKey: 'COST_VIEW',
    route: 'GET /api/v1/export/costs',
    localPath: '/costs',
    scopes: ['all'],
    page: 'views/cost/CostList.vue'
  },
  {
    key: 'PAYROLL_EXPORT',
    code: 'erp.payroll.export',
    viewKey: 'PAYROLL_VIEW',
    route: 'GET /api/v1/export/payroll',
    localPath: '/payroll',
    scopes: ['all'],
    page: 'views/payroll/PayrollList.vue'
  }
]);

function walkFiles(directory, extensions) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(fullPath, extensions));
    else if (extensions.has(path.extname(entry.name))) result.push(fullPath);
  }
  return result;
}

function extractPermissionLiterals(source) {
  return source.match(/erp\.[a-z0-9_]+\.[a-z0-9_]+/g) || [];
}

function flattenManifestPermissions() {
  return manifest.modules.flatMap((module) =>
    module.permissions.map((permission) => ({ module, permission }))
  );
}

describe('ERP 权限 Manifest 与代码一致性', () => {
  test('Manifest 具备稳定的应用身份和版本结构', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.application).toMatchObject({
      code: 'erp',
      name: expect.any(String),
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/)
    });
    expect(manifest.modules.length).toBeGreaterThan(0);

    const moduleCodes = manifest.modules.map((module) => module.code);
    expect(new Set(moduleCodes).size).toBe(moduleCodes.length);
  });

  test('每个权限编码与所属 module/action、scope 和正式交付元数据一致', () => {
    const entries = flattenManifestPermissions();
    const codes = entries.map(({ permission }) => permission.code);
    expect(new Set(codes).size).toBe(codes.length);

    for (const { module, permission } of entries) {
      expect(permission.code).toBe(`erp.${module.code}.${permission.action}`);
      expect(permission.name).toEqual(expect.any(String));
      expect(permission.name.length).toBeGreaterThan(0);
      expect(permission.description).toEqual(expect.any(String));
      expect(permission.description.length).toBeGreaterThan(0);
      expect(permission.scopes.length).toBeGreaterThan(0);
      expect(new Set(permission.scopes).size).toBe(permission.scopes.length);
      expect(permission.scopes.every((scope) => ['self', 'team', 'all'].includes(scope))).toBe(true);
      expect(['normal', 'high', 'critical']).toContain(permission.riskLevel);
      expect(typeof permission.sensitive).toBe('boolean');
      expect(typeof permission.deprecated).toBe('boolean');
      expect(Array.isArray(permission.routes)).toBe(true);
      expect(Array.isArray(permission.pages)).toBe(true);

      for (const route of permission.routes) {
        expect(route).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \/api\/v1\//);
      }
      for (const page of permission.pages) {
        expect(page).toMatch(/^\/(?!\/)/);
      }

      // 已下线权限允许仅保留编码用于兼容旧配置；所有在用权限必须有接口或页面落点。
      if (!permission.deprecated) {
        expect(permission.routes.length + permission.pages.length).toBeGreaterThan(0);
      }
    }
  });

  test('Manifest 与后端权限编码常量精确一一对应', () => {
    const manifestCodes = flattenManifestPermissions()
      .map(({ permission }) => permission.code)
      .sort();
    const codeConstants = [...ALL_PERMISSION_CODES].sort();

    expect(manifestCodes).toEqual(codeConstants);
    expect(codeConstants.every(isKnownPermission)).toBe(true);
  });

  test('八个模块导出权限与八条导出路由一一对应，旧全局权限仅保留为 deprecated', () => {
    const entries = flattenManifestPermissions();
    const exportRouteSource = fs.readFileSync(
      path.join(BACKEND_SRC, 'routes', 'export.js'),
      'utf8'
    );
    const permissionByCode = new Map(
      entries.map(({ permission }) => [permission.code, permission])
    );
    const exportRouteOwners = new Map();
    for (const { permission } of entries) {
      for (const route of permission.routes) {
        if (route.startsWith('GET /api/v1/export/')) {
          exportRouteOwners.set(route, permission.code);
        }
      }
    }

    expect([...exportRouteOwners.keys()].sort())
      .toEqual(EXPORT_PERMISSION_MATRIX.map((item) => item.route).sort());

    for (const item of EXPORT_PERMISSION_MATRIX) {
      expect(PERMISSIONS[item.key]).toBe(item.code);
      expect(exportRouteOwners.get(item.route)).toBe(item.code);

      const permission = permissionByCode.get(item.code);
      expect(permission).toMatchObject({
        code: item.code,
        action: 'export',
        scopes: item.scopes,
        riskLevel: 'high',
        sensitive: true,
        deprecated: false,
        routes: [item.route]
      });

      const escapedPath = item.localPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(exportRouteSource).toMatch(new RegExp(
        `router\\.get\\(\\s*["']${escapedPath}["'][\\s\\S]*?` +
        `scopedExport\\(\\s*PERMISSIONS\\.${item.viewKey}\\s*,\\s*` +
        `PERMISSIONS\\.${item.key}`
      ));
    }

    const legacyGlobalExport = permissionByCode.get('erp.export.export');
    expect(legacyGlobalExport).toMatchObject({
      deprecated: true,
      routes: []
    });
  });

  test('对外 Manifest 带稳定 SHA-256 hash 且不改变原始目录', () => {
    const first = getPermissionManifest();
    const second = getPermissionManifest();

    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.hash).toBe(first.hash);
    expect(manifest.hash).toBeUndefined();
    expect(first.application).toEqual(manifest.application);
    expect(first.modules).toEqual(manifest.modules);
  });

  test('前后端源码使用的所有 ERP 权限字面量都必须登记于 Manifest', () => {
    const files = [
      ...walkFiles(BACKEND_SRC, new Set(['.js', '.json'])),
      ...walkFiles(FRONTEND_SRC, new Set(['.js', '.vue']))
    ];
    const unknownUsages = [];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const permissionCode of extractPermissionLiterals(source)) {
        if (!isKnownPermission(permissionCode)) {
          unknownUsages.push(`${path.relative(REPO_ROOT, file)}: ${permissionCode}`);
        }
      }
    }

    expect(unknownUsages).toEqual([]);
  });

  test('前端权限常量与 Manifest 精确一致且无重复', () => {
    const frontendConstantsPath = path.join(FRONTEND_SRC, 'constants', 'permissions.js');
    const source = fs.readFileSync(frontendConstantsPath, 'utf8');
    const frontendCodes = extractPermissionLiterals(source);

    expect(frontendCodes.length).toBeGreaterThan(0);
    expect(new Set(frontendCodes).size).toBe(frontendCodes.length);
    expect(frontendCodes.every(isKnownPermission)).toBe(true);
    expect([...frontendCodes].sort()).toEqual([...ALL_PERMISSION_CODES].sort());
  });

  test('后端 requirePermission 引用的常量都存在且属于 Manifest', () => {
    const unknownKeys = [];
    const routeFiles = walkFiles(path.join(BACKEND_SRC, 'routes'), new Set(['.js']));

    for (const file of routeFiles) {
      const source = fs.readFileSync(file, 'utf8');
      const matches = source.matchAll(/requirePermission\s*\(\s*PERMISSIONS\.([A-Z0-9_]+)/g);
      for (const match of matches) {
        const key = match[1];
        if (!Object.prototype.hasOwnProperty.call(PERMISSIONS, key) || !isKnownPermission(PERMISSIONS[key])) {
          unknownKeys.push(`${path.relative(REPO_ROOT, file)}: PERMISSIONS.${key}`);
        }
      }
    }

    expect(unknownKeys).toEqual([]);
  });

  test('Manifest 声明的接口映射不重复，避免一个接口被多个权限歧义保护', () => {
    const owners = new Map();
    const duplicates = [];

    for (const { permission } of flattenManifestPermissions()) {
      for (const route of permission.routes) {
        if (owners.has(route) && owners.get(route) !== permission.code) {
          duplicates.push(`${route}: ${owners.get(route)} / ${permission.code}`);
        } else {
          owners.set(route, permission.code);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });

  test('critical 权限必须映射到后端接口，并显式标注敏感性', () => {
    const invalid = flattenManifestPermissions()
      .filter(({ permission }) => permission.riskLevel === 'critical' && !permission.deprecated)
      .filter(({ permission }) => permission.routes.length === 0 || typeof permission.sensitive !== 'boolean')
      .map(({ permission }) => permission.code);

    expect(invalid).toEqual([]);
  });

  test('实际后端接口与 Manifest 的 route→permission 矩阵双向精确一致', () => {
    const indexSource = fs.readFileSync(path.join(BACKEND_SRC, 'routes', 'index.js'), 'utf8');
    const mounts = [...indexSource.matchAll(
      /router\.use\(\s*['"]([^'"]+)['"]\s*,\s*require\(\s*['"]\.\/([^'"]+)['"]\s*\)\s*\)/g
    )].map((match) => ({ mount: match[1], fileBase: match[2] }));
    const keyByCode = Object.fromEntries(
      Object.entries(PERMISSIONS).map(([key, code]) => [key, code])
    );
    const manifestOwner = new Map();
    for (const { permission } of flattenManifestPermissions()) {
      for (const route of permission.routes) manifestOwner.set(route, permission.code);
    }

    const actualOwner = new Map();
    const failures = [];
    const publicWithoutPermission = new Set([
      'GET /api/v1/wechat/callback',
      'POST /api/v1/wechat/callback'
    ]);
    const specialOwners = new Map([
      ['POST /api/v1/files/ticket', PERMISSIONS.FILE_DOWNLOAD],
      ['GET /api/v1/files/download', PERMISSIONS.FILE_DOWNLOAD]
    ]);

    for (const { mount, fileBase } of mounts) {
      if (['auth', 'internal'].includes(fileBase)) continue;
      const file = path.join(BACKEND_SRC, 'routes', `${fileBase}.js`);
      if (!fs.existsSync(file)) continue; // 忽略 index.js 中保留的注释示例/TODO
      const source = fs.readFileSync(file, 'utf8');
      const globalPermissionKeys = [...source.matchAll(
        /router\.use\(\s*requirePermission\(\s*PERMISSIONS\.([A-Z0-9_]+)\s*\)\s*\)/g
      )].map((match) => match[1]).filter((key) => key !== 'APP_VIEW');
      const globalPermissionKey = globalPermissionKeys.length === 1
        ? globalPermissionKeys[0]
        : null;
      const routeMatches = [...source.matchAll(
        /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g
      )];

      for (let index = 0; index < routeMatches.length; index += 1) {
        const match = routeMatches[index];
        const method = match[1].toUpperCase();
        const localPath = match[2];
        const start = match.index;
        const end = index + 1 < routeMatches.length ? routeMatches[index + 1].index : source.length;
        const block = source.slice(start, end);
        const fullPath = localPath === '/'
          ? `/api/v1${mount}`
          : `/api/v1${mount}${localPath}`;
        const route = `${method} ${fullPath}`;
        const directPermissionKeys = [...block.matchAll(
          /requirePermission\(\s*PERMISSIONS\.([A-Z0-9_]+)\s*\)/g
        )].map((permissionMatch) => permissionMatch[1]);
        const scopedExportPermissionKeys = [...block.matchAll(
          /scopedExport\(\s*PERMISSIONS\.([A-Z0-9_]+)\s*,\s*PERMISSIONS\.([A-Z0-9_]+)/g
        )].flatMap((permissionMatch) => [permissionMatch[1], permissionMatch[2]]);
        const permissionKeys = [...directPermissionKeys, ...scopedExportPermissionKeys];
        const expectedManifestCode = manifestOwner.get(route);
        const permissionKey = permissionKeys.find(
          (key) => keyByCode[key] === expectedManifestCode
        ) || permissionKeys[0] || globalPermissionKey;

        if (!permissionKey) {
          if (publicWithoutPermission.has(route)) continue;
          const specialOwner = specialOwners.get(route);
          if (specialOwner) {
            actualOwner.set(route, specialOwner);
            continue;
          }
          failures.push(`${route}: 业务接口未声明 requirePermission`);
          continue;
        }

        const permissionCode = keyByCode[permissionKey];
        if (!permissionCode) {
          failures.push(`${route}: 未知 PERMISSIONS.${permissionKey}`);
          continue;
        }
        actualOwner.set(route, permissionCode);
      }
    }

    for (const [route, permissionCode] of actualOwner) {
      if (manifestOwner.get(route) !== permissionCode) {
        failures.push(`${route}: code=${permissionCode}, manifest=${manifestOwner.get(route) || 'missing'}`);
      }
    }
    for (const [route, permissionCode] of manifestOwner) {
      if (actualOwner.get(route) !== permissionCode) {
        failures.push(`${route}: manifest=${permissionCode}, actual=${actualOwner.get(route) || 'missing'}`);
      }
    }

    expect(failures).toEqual([]);
  });
});

describe('SSO URL 安全静态审计', () => {
  test('前端源码不再生成或接收任何长效 ?token= 查询参数', () => {
    const offenders = [];
    for (const file of walkFiles(FRONTEND_SRC, new Set(['.js', '.vue']))) {
      const source = fs.readFileSync(file, 'utf8');
      if (/\?token=|query\.token|urlToken/.test(source)) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  test('系统切换不再拼接 ERP 长效 token', () => {
    const source = fs.readFileSync(
      path.join(FRONTEND_SRC, 'components', 'layout', 'SystemSwitch.vue'),
      'utf8'
    );

    expect(source).not.toMatch(/\?token=/);
    expect(source).not.toMatch(/userStore\.token/);
    expect(source).not.toMatch(/encodeURIComponent\([^)]*token/i);
    expect(source).toContain("window.open(MAIN_SYSTEM_URL, '_blank', 'noopener,noreferrer')");
  });

  test('Router 不再把 query.token 写入本地会话', () => {
    const source = fs.readFileSync(path.join(FRONTEND_SRC, 'router', 'index.js'), 'utf8');

    expect(source).not.toMatch(/query\.token/);
    expect(source).not.toMatch(/urlToken/);
    expect(source).not.toMatch(/setToken\s*\(\s*[^)]*token/i);
    expect(source).toContain("path: '/sso/callback'");
  });

  test('SSO 回调只读取一次性 code+state，并通过带 Cookie 的 POST body 兑换', () => {
    const callbackSource = fs.readFileSync(path.join(FRONTEND_SRC, 'views', 'SsoCallback.vue'), 'utf8');
    const authApiSource = fs.readFileSync(path.join(FRONTEND_SRC, 'api', 'auth.js'), 'utf8');

    expect(callbackSource).toMatch(/route\.query\.code/);
    expect(callbackSource).toMatch(/route\.query\.state/);
    expect(callbackSource).not.toMatch(/route\.query\.token/);
    expect(callbackSource).toMatch(/router\.replace/);
    expect(authApiSource).toContain(
      "request.post('/auth/sso/exchange', { code, state }, { withCredentials: true })"
    );
    expect(authApiSource).not.toMatch(/request\.get\([^\n]*sso\/exchange/);
  });

  test('SSO 回调必须在兑换前清理旧会话，失败后也保持无登录态', () => {
    const callbackSource = fs.readFileSync(
      path.join(FRONTEND_SRC, 'views', 'SsoCallback.vue'),
      'utf8'
    );
    const firstClearIndex = callbackSource.indexOf('userStore.clearAuth()');
    const codeReadIndex = callbackSource.indexOf('const code =');
    const stateReadIndex = callbackSource.indexOf('const state =');
    const urlCleanupIndex = callbackSource.indexOf("await router.replace({ path: '/sso/callback' })");
    const exchangeIndex = callbackSource.indexOf('await userStore.exchangeSsoCode(code, state)');
    const catchIndex = callbackSource.indexOf('} catch (error)');
    const failureClearIndex = callbackSource.indexOf('userStore.clearAuth()', firstClearIndex + 1);

    expect(firstClearIndex).toBeGreaterThan(-1);
    expect(firstClearIndex).toBeLessThan(codeReadIndex);
    expect(stateReadIndex).toBeGreaterThan(codeReadIndex);
    expect(firstClearIndex).toBeLessThan(exchangeIndex);
    expect(urlCleanupIndex).toBeGreaterThan(stateReadIndex);
    expect(urlCleanupIndex).toBeLessThan(exchangeIndex);
    expect(failureClearIndex).toBeGreaterThan(catchIndex);
  });
});

describe('核心业务 scope 执行静态门禁', () => {
  const coreModules = ['payment', 'expense', 'loan', 'inventory', 'project'];

  test.each(coreModules)('%s service 必须显式接收并应用 permission dataFilter', (moduleName) => {
    const source = fs.readFileSync(
      path.join(BACKEND_SRC, 'services', `${moduleName}Service.js`),
      'utf8'
    );

    expect(source).toMatch(/dataFilter/);
    expect(source).toMatch(/normalize|ScopeFilter|dataFilter\s*\)/);
  });

  test.each(coreModules)('%s controller 必须向 service 传递 req.dataFilter', (moduleName) => {
    const source = fs.readFileSync(
      path.join(BACKEND_SRC, 'controllers', `${moduleName}Controller.js`),
      'utf8'
    );

    expect(source).toMatch(/req\.dataFilter/);
  });

  test.each(coreModules)('%s routes 必须使用权限编码中间件', (moduleName) => {
    const routeFile = moduleName === 'payment' ? 'payments'
      : moduleName === 'expense' ? 'expenses'
        : moduleName === 'loan' ? 'loans'
          : moduleName === 'project' ? 'projects'
            : 'inventory';
    const source = fs.readFileSync(path.join(BACKEND_SRC, 'routes', `${routeFile}.js`), 'utf8');

    expect(source).toMatch(/requirePermission\s*\(/);
    expect(source).toMatch(/attachPermissionDataScope|PermissionDataScope/);
    expect(source).not.toMatch(/requireErpAccess\s*\(/);
  });
});

describe('全项目权限矩阵静态门禁', () => {
  const roleMiddlewarePattern = /require(Admin|ErpAccess|Role)\s*\(/;
  const excludedRouteFiles = new Set(['auth.js', 'index.js', 'internal.js']);

  test('所有业务路由必须使用 requirePermission，不能继续依赖静态角色中间件', () => {
    const failures = [];
    for (const file of walkFiles(path.join(BACKEND_SRC, 'routes'), new Set(['.js']))) {
      if (excludedRouteFiles.has(path.basename(file))) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (!/requirePermission\s*\(/.test(source) || roleMiddlewarePattern.test(source)) {
        failures.push(path.relative(REPO_ROOT, file));
      }
    }

    expect(failures).toEqual([]);
  });

  test('前端业务页面不再使用 userStore.isAdmin/isFinance 控制功能按钮', () => {
    const offenders = [];
    for (const file of walkFiles(FRONTEND_SRC, new Set(['.vue']))) {
      const source = fs.readFileSync(file, 'utf8');
      if (/userStore\.(isAdmin|isFinance)/.test(source)) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  test('User Store 不再暴露角色派生的 isAdmin/isFinance 授权入口', () => {
    const source = fs.readFileSync(path.join(FRONTEND_SRC, 'stores', 'user.js'), 'utf8');

    expect(source).not.toMatch(/const\s+is(Admin|Finance)\s*=/);
    expect(source).not.toMatch(/^\s*is(Admin|Finance),\s*$/m);
  });

  test('401 必须立即清理会话，403 与登录页提供无重复的明确反馈', () => {
    const requestSource = fs.readFileSync(path.join(FRONTEND_SRC, 'api', 'request.js'), 'utf8');
    const userStoreSource = fs.readFileSync(path.join(FRONTEND_SRC, 'stores', 'user.js'), 'utf8');
    const loginSource = fs.readFileSync(path.join(FRONTEND_SRC, 'views', 'Login.vue'), 'utf8');
    const forbiddenSource = fs.readFileSync(path.join(FRONTEND_SRC, 'views', 'Forbidden.vue'), 'utf8');

    expect(requestSource).toContain("void userStore.expireSession('session_expired')");
    expect(requestSource).not.toContain('userStore.logout()');
    expect(requestSource).toMatch(/case 403:[\s\S]*?!isSsoExchangeReq[\s\S]*?response\.data\?\.message/);

    const expireStart = userStoreSource.indexOf('function expireSession(');
    const expireClear = userStoreSource.indexOf('clearAuth()', expireStart);
    const expireRedirect = userStoreSource.indexOf("router.replace({ path: '/login'", expireStart);
    expect(expireStart).toBeGreaterThan(-1);
    expect(expireClear).toBeGreaterThan(expireStart);
    expect(expireClear).toBeLessThan(expireRedirect);

    expect(loginSource).toContain('session_expired');
    expect(loginSource).toContain('no_erp_access');
    expect(forbiddenSource).toContain('router.back()');
    expect(forbiddenSource).not.toContain("router.push('/dashboard')");
  });

  test('前端 Router 每个业务页面都声明 permission meta', () => {
    const source = fs.readFileSync(path.join(FRONTEND_SRC, 'router', 'index.js'), 'utf8');
    const routeBlocks = [...source.matchAll(/path:\s*'([^']+)'[\s\S]*?meta:\s*\{([^}]+)\}/g)];
    const allowedWithoutPermission = new Set(['/login', '/sso/callback', '/:pathMatch(.*)*', 'forbidden']);
    const missing = [];

    for (const match of routeBlocks) {
      const routePath = match[1];
      const meta = match[2];
      if (!allowedWithoutPermission.has(routePath) && !/permission:\s*PERMISSIONS\./.test(meta)) {
        missing.push(routePath);
      }
    }

    expect(missing).toEqual([]);
  });

  test('主项目 assertion 不得出现在前端源码或浏览器存储键中', () => {
    const offenders = [];
    for (const file of walkFiles(FRONTEND_SRC, new Set(['.js', '.vue']))) {
      const source = fs.readFileSync(file, 'utf8');
      if (/assertion|main_sso_assertion|ERP_SSO_PUBLIC_KEY/.test(source)) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  test('现有高风险页面按钮必须逐动作调用 can(PERMISSIONS.*)', () => {
    const pageActionMatrix = {
      'views/account/AccountList.vue': [
        'ACCOUNT_CREATE', 'ACCOUNT_UPDATE', 'ACCOUNT_ADJUST', 'ACCOUNT_TRANSFER'
      ],
      'views/customer/CustomerList.vue': [
        'CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_DELETE'
      ],
      'views/supplier/SupplierList.vue': [
        'SUPPLIER_CREATE', 'SUPPLIER_UPDATE', 'SUPPLIER_DELETE'
      ],
      'views/invoice/InvoiceList.vue': [
        'INVOICE_CREATE', 'INVOICE_UPDATE', 'INVOICE_CONFIRM', 'INVOICE_DELETE'
      ],
      'views/payment/PaymentList.vue': [
        'PAYMENT_CREATE', 'PAYMENT_UPDATE', 'PAYMENT_DELETE', 'PAYMENT_CONFIRM'
      ],
      'views/expense/ExpenseList.vue': [
        'EXPENSE_CREATE', 'EXPENSE_UPDATE', 'EXPENSE_DELETE', 'EXPENSE_APPROVE'
      ],
      'views/loan/LoanList.vue': [
        'LOAN_CREATE', 'LOAN_UPDATE', 'LOAN_DELETE', 'LOAN_REPAY'
      ],
      'views/inventory/InventoryList.vue': [
        'INVENTORY_CREATE', 'INVENTORY_UPDATE', 'INVENTORY_DELETE',
        'INVENTORY_IMPORT', 'INVENTORY_BATCH_DELETE', 'INVENTORY_SELL', 'INVENTORY_SYNC'
      ],
      'views/inventory/InventoryDetail.vue': [
        'INVENTORY_UPDATE', 'INVENTORY_SYNC', 'PATENT_FEE_VIEW'
      ],
      'views/inventory/PatentAnomalyAlerts.vue': [
        'INVENTORY_ANOMALY_SCAN', 'INVENTORY_ANOMALY_RESOLVE'
      ],
      'views/inventory/SoldAnalytics.vue': ['INVENTORY_UNSELL'],
      'views/project/ProjectList.vue': [
        'PROJECT_CREATE', 'PROJECT_UPDATE', 'PROJECT_DELETE', 'PROJECT_REFRESH'
      ],
      'views/project/ProjectDetail.vue': ['PROJECT_UPDATE', 'PROJECT_REFRESH'],
      'views/reconciliation/ReconciliationPage.vue': [
        'RECONCILIATION_IMPORT', 'RECONCILIATION_MATCH',
        'RECONCILIATION_UNMATCH', 'RECONCILIATION_DELETE'
      ],
      'views/import/ImportPage.vue': ['IMPORT_VALIDATE', 'IMPORT_EXECUTE'],
      'views/performance/PerformanceImport.vue': [
        'PERFORMANCE_IMPORT_IMPORT', 'PERFORMANCE_IMPORT_DELETE'
      ],
      'views/system/SalaryRules.vue': ['SALARY_RULE_UPDATE', 'SALARY_RULE_RESET'],
      'views/payroll/PayrollList.vue': [
        'PAYROLL_GENERATE', 'PAYROLL_UPDATE', 'PAYROLL_CONFIRM',
        'PAYROLL_PAY', 'PAYROLL_VOID', 'PAYROLL_DELETE'
      ],
      'views/employee/EmployeeList.vue': [
        'EMPLOYEE_CREATE', 'EMPLOYEE_UPDATE', 'EMPLOYEE_DELETE', 'EMPLOYEE_CHANGE_STATUS'
      ],
      'views/cost/CostList.vue': [
        'COST_CREATE', 'COST_UPDATE', 'COST_DELETE', 'COST_GENERATE'
      ],
      'views/contract/ContractList.vue': [
        'CONTRACT_CREATE', 'CONTRACT_UPDATE', 'CONTRACT_DELETE'
      ],
      'views/contract/ContractDetail.vue': [
        'CONTRACT_CONFIRM', 'CONTRACT_UPLOAD'
      ],
      'views/system/ClassifyRules.vue': [
        'CLASSIFY_RULE_CREATE', 'CLASSIFY_RULE_UPDATE', 'CLASSIFY_RULE_DELETE'
      ],
      'views/system/WechatBindings.vue': ['WECHAT_CONFIGURE', 'WECHAT_SYNC'],
      'components/layout/NotificationBell.vue': [
        'NOTIFICATION_VIEW', 'NOTIFICATION_UPDATE', 'NOTIFICATION_DELETE'
      ]
    };
    const missing = [];

    for (const [relativeFile, permissionKeys] of Object.entries(pageActionMatrix)) {
      const source = fs.readFileSync(path.join(FRONTEND_SRC, relativeFile), 'utf8');
      for (const permissionKey of permissionKeys) {
        const usePattern = new RegExp(`can\\s*\\(\\s*PERMISSIONS\\.${permissionKey}\\s*\\)`);
        if (!usePattern.test(source)) {
          missing.push(`${relativeFile}: PERMISSIONS.${permissionKey}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test('敏感操作入口必须在按钮标签自身声明对应权限', () => {
    const actionButtonMatrix = [
      ['views/contract/ContractList.vue', 'handleDelete', 'CONTRACT_DELETE'],
      ['views/contract/ContractDetail.vue', 'handleConfirm', 'CONTRACT_CONFIRM'],
      ['views/invoice/InvoiceList.vue', 'handleMarkIssued', 'INVOICE_CONFIRM'],
      ['views/invoice/InvoiceList.vue', 'handleMarkCancelled', 'INVOICE_CONFIRM'],
      ['views/payment/PaymentList.vue', 'handleConfirm', 'PAYMENT_CONFIRM'],
      ['views/payment/PaymentList.vue', 'handleDelete', 'PAYMENT_DELETE'],
      ['views/expense/ExpenseList.vue', 'handleConfirm', 'EXPENSE_APPROVE'],
      ['views/expense/ExpenseList.vue', 'handleDelete', 'EXPENSE_DELETE'],
      ['views/loan/LoanList.vue', 'handleRepay', 'LOAN_REPAY'],
      ['views/loan/LoanList.vue', 'handleDeleteRepayment', 'LOAN_REPAY'],
      ['views/loan/LoanList.vue', 'handleDelete', 'LOAN_DELETE'],
      ['views/inventory/InventoryList.vue', 'handleBatchSync', 'INVENTORY_SYNC'],
      ['views/inventory/InventoryList.vue', 'handleBatchDelete', 'INVENTORY_BATCH_DELETE'],
      ['views/inventory/InventoryList.vue', 'handleDelete', 'INVENTORY_DELETE'],
      ['views/inventory/PatentAnomalyAlerts.vue', 'handleTriggerScan', 'INVENTORY_ANOMALY_SCAN'],
      ['views/inventory/PatentAnomalyAlerts.vue', 'openResolveDialog', 'INVENTORY_ANOMALY_RESOLVE'],
      ['views/project/ProjectList.vue', 'handleRefresh', 'PROJECT_REFRESH'],
      ['views/project/ProjectList.vue', 'handleDelete', 'PROJECT_DELETE'],
      ['views/cost/CostList.vue', 'handleGenerateRecurring', 'COST_GENERATE'],
      ['views/reconciliation/ReconciliationPage.vue', 'handleUpload', 'RECONCILIATION_IMPORT'],
      ['views/reconciliation/ReconciliationPage.vue', 'handleUnmatch', 'RECONCILIATION_UNMATCH'],
      ['views/reconciliation/ReconciliationPage.vue', 'openCreatePaymentDialog', 'RECONCILIATION_MATCH'],
      ['views/reconciliation/ReconciliationPage.vue', 'handleIgnore', 'RECONCILIATION_MATCH'],
      ['views/reconciliation/ReconciliationPage.vue', 'handleDeleteBatch', 'RECONCILIATION_DELETE'],
      ['views/import/ImportPage.vue', 'handleValidate', 'IMPORT_VALIDATE'],
      ['views/import/ImportPage.vue', 'handleExecuteImport', 'IMPORT_EXECUTE'],
      ['views/performance/PerformanceImport.vue', 'handleValidate', 'PERFORMANCE_IMPORT_IMPORT'],
      ['views/performance/PerformanceImport.vue', 'handleConfirm', 'PERFORMANCE_IMPORT_IMPORT'],
      ['views/performance/PerformanceImport.vue', 'removeBatch', 'PERFORMANCE_IMPORT_DELETE'],
      ['views/payroll/PayrollList.vue', 'handleGenerate', 'PAYROLL_GENERATE'],
      ['views/payroll/PayrollList.vue', 'handleConfirmAll', 'PAYROLL_CONFIRM'],
      ['views/payroll/PayrollList.vue', 'handleConfirm', 'PAYROLL_CONFIRM'],
      ['views/payroll/PayrollList.vue', 'handlePaid', 'PAYROLL_PAY'],
      ['views/payroll/PayrollList.vue', 'handleVoid', 'PAYROLL_VOID'],
      ['views/payroll/PayrollList.vue', 'handleDelete', 'PAYROLL_DELETE'],
      ['views/employee/EmployeeList.vue', 'handleRegular', 'EMPLOYEE_CHANGE_STATUS'],
      ['views/employee/EmployeeList.vue', 'handleResign', 'EMPLOYEE_CHANGE_STATUS'],
      ['views/employee/EmployeeList.vue', 'handleDelete', 'EMPLOYEE_DELETE'],
      ['views/system/WechatBindings.vue', 'testToken', 'WECHAT_CONFIGURE'],
      ['views/system/WechatBindings.vue', 'manualSync', 'WECHAT_SYNC'],
      ['views/system/WechatBindings.vue', 'manualSyncAll', 'WECHAT_SYNC'],
      ['components/layout/NotificationBell.vue', 'handleMarkAllRead', 'NOTIFICATION_UPDATE'],
      ['components/layout/NotificationBell.vue', 'handleDelete', 'NOTIFICATION_DELETE']
    ];
    const failures = [];

    for (const [relativeFile, handler, permissionKey] of actionButtonMatrix) {
      const source = fs.readFileSync(path.join(FRONTEND_SRC, relativeFile), 'utf8');
      const tags = [...source.matchAll(
        /<(?:el-button|el-link)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gs
      )]
        .map((match) => match[0])
        .filter((tag) => new RegExp(
          `@click(?:\\.[a-z]+)*=["'][^"']*\\b${handler}(?:\\b|\\()`
        ).test(tag));

      if (tags.length === 0) {
        failures.push(`${relativeFile}: 未找到 @click=${handler} 的操作按钮`);
        continue;
      }
      for (const tag of tags) {
        const hasPermissionDirective = (tag.includes('v-if=') || tag.includes(':disabled='))
          && tag.includes(`can(PERMISSIONS.${permissionKey})`);
        if (!hasPermissionDirective) {
          failures.push(`${relativeFile}: ${handler} 按钮缺少 PERMISSIONS.${permissionKey}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  test('文件预览下载与年费查询的每个前端入口都必须显式声明权限', () => {
    const contractDetailSource = fs.readFileSync(
      path.join(FRONTEND_SRC, 'views', 'contract', 'ContractDetail.vue'),
      'utf8'
    );
    const fileActionTags = [...contractDetailSource.matchAll(/<(?:el-link|el-button)\b[^>]*>/g)]
      .map((match) => match[0])
      .filter((tag) => /@click="(?:previewFile|openInNewWindow|downloadFileForce)\(/.test(tag));

    expect(fileActionTags).toHaveLength(5);
    for (const tag of fileActionTags) {
      expect(tag).toContain('v-if="can(PERMISSIONS.FILE_DOWNLOAD)"');
    }

    const inventoryDetailSource = fs.readFileSync(
      path.join(FRONTEND_SRC, 'views', 'inventory', 'InventoryDetail.vue'),
      'utf8'
    );
    const patentFeeActionTags = [...inventoryDetailSource.matchAll(/<el-button\b[^>]*>/g)]
      .map((match) => match[0])
      .filter((tag) => tag.includes('@click="fetchIpFeeDetail"'));

    expect(patentFeeActionTags).toHaveLength(3);
    for (const tag of patentFeeActionTags) {
      expect(tag).toContain('v-if="can(PERMISSIONS.PATENT_FEE_VIEW)"');
    }
  });

  test('通用导出按钮强制声明模块权限，七个页面使用各自 export 权限', () => {
    const legacyPermissionSource = fs.readFileSync(
      path.join(FRONTEND_SRC, 'utils', 'permission.js'),
      'utf8'
    );
    const exportButtonSource = fs.readFileSync(
      path.join(FRONTEND_SRC, 'components', 'common', 'ExportButton.vue'),
      'utf8'
    );

    expect(legacyPermissionSource).not.toMatch(/permissionMap|hasRole|hasFinanceAccess|role\s*===/);
    expect(legacyPermissionSource).toMatch(/(?:userStore|useUserStore\(\))\.can\s*\(/);
    expect(exportButtonSource).toMatch(
      /permission:\s*\{[^}]*type:\s*String[^}]*required:\s*true[^}]*\}/s
    );
    expect(exportButtonSource).not.toMatch(/default:\s*PERMISSIONS\.EXPORT_EXECUTE/);
    expect(exportButtonSource).toMatch(/userStore\.can\s*\(\s*permission\s*\)/);

    for (const item of EXPORT_PERMISSION_MATRIX) {
      const pageSource = fs.readFileSync(path.join(FRONTEND_SRC, item.page), 'utf8');
      const escapedPath = item.localPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(pageSource).toMatch(new RegExp(`path=["']/export${escapedPath}["']`));
      expect(pageSource).toMatch(new RegExp(
        `:permission=["']PERMISSIONS\\.${item.key}["']`
      ));
    }
  });
});
