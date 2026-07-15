const internalRouter = require('../src/routes/internal');
const {
  safeEqual,
  requireManifestClient
} = require('../src/middlewares/internalServiceAuth');

describe('权限 Manifest 内部读取接口', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test('Manifest 目录只通过 GET /permissions/manifest 暴露', () => {
    const routes = internalRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).filter((method) => layer.route.methods[method])
      }));

    expect(routes).toContainEqual({ path: '/permissions/manifest', methods: ['get'] });
    expect(routes).not.toContainEqual({ path: '/permissions/manifest', methods: ['post'] });
  });

  test('服务凭证未配置时 fail-closed 为 503', () => {
    delete process.env.ERP_MANIFEST_CLIENT_ID;
    delete process.env.ERP_MANIFEST_CLIENT_SECRET;
    const next = jest.fn();

    requireManifestClient({ headers: {} }, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 503,
      code: 'MANIFEST_API_CONFIGURATION_ERROR'
    });
  });

  test('错误或缺失服务凭证返回 401', () => {
    process.env.ERP_MANIFEST_CLIENT_ID = 'main-project';
    process.env.ERP_MANIFEST_CLIENT_SECRET = 'manifest-secret';

    for (const headers of [
      {},
      {
        'x-erp-manifest-client-id': 'main-project',
        'x-erp-manifest-client-secret': 'wrong'
      },
      {
        'x-erp-manifest-client-id': 'wrong',
        'x-erp-manifest-client-secret': 'manifest-secret'
      }
    ]) {
      const next = jest.fn();
      requireManifestClient({ headers }, {}, next);
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    }
  });

  test('正确服务凭证通过 timing-safe 校验', () => {
    process.env.ERP_MANIFEST_CLIENT_ID = 'main-project';
    process.env.ERP_MANIFEST_CLIENT_SECRET = 'manifest-secret';
    const next = jest.fn();

    requireManifestClient({
      headers: {
        'x-erp-manifest-client-id': 'main-project',
        'x-erp-manifest-client-secret': 'manifest-secret'
      }
    }, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(safeEqual('same-secret', 'same-secret')).toBe(true);
    expect(safeEqual('same-secret', 'other-secret')).toBe(false);
    expect(safeEqual('short', 'much-longer')).toBe(false);
  });

  test('接口响应包含完整目录和 SHA-256 hash，不含角色授权数据', () => {
    const routeLayer = internalRouter.stack.find(
      (layer) => layer.route?.path === '/permissions/manifest'
    );
    const finalHandler = routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;
    const res = { json: jest.fn() };

    finalHandler({}, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const response = res.json.mock.calls[0][0];
    expect(response).toMatchObject({
      success: true,
      data: {
        schemaVersion: 1,
        application: { code: 'erp', version: expect.any(String) },
        modules: expect.any(Array),
        hash: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    });
    expect(response.data.roleGrants).toBeUndefined();
    expect(response.data.users).toBeUndefined();
  });
});
