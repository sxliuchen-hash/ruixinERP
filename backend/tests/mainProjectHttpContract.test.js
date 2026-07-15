const http = require('http');
const { generateKeyPairSync, randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');

const { MainSsoService } = require('../src/services/mainSsoService');
const { MainUserScopeService } = require('../src/services/mainUserScopeService');
const { MainPermissionVersionService } = require('../src/services/mainPermissionVersionService');
const { PERMISSIONS } = require('../src/permissions/permissionCodes');

const ACTIVE_KID = 'main-contract-test-active';
const USER_ID = 42;
const VALID_CODE = 'local-single-use-code-1234567890';
const VALID_STATE = 's'.repeat(43);

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('ERP 与主项目真实 HTTP 契约预演', () => {
  const originalEnv = { ...process.env };
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  let server;
  let baseUrl;
  let state;

  function signAssertion() {
    return jwt.sign({
      user: {
        id: USER_ID,
        username: 'http-contract-user',
        role: 'supervisor',
        realName: 'HTTP 契约用户',
        departmentName: '测试部'
      },
      permissions: {
        [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' },
        [PERMISSIONS.CONTRACT_VIEW]: { allowed: true, scope: 'team' }
      },
      permissionVersion: 12
    }, privateKey, {
      algorithm: 'RS256',
      keyid: ACTIVE_KID,
      issuer: 'patent-notice-system',
      audience: 'erp',
      subject: String(USER_ID),
      expiresIn: '60s',
      jwtid: randomUUID()
    });
  }

  function hasSsoCredentials(req) {
    return req.headers['x-erp-client-id'] === 'erp-sso-contract-test' &&
      req.headers['x-erp-client-secret'] === 'sso-contract-secret';
  }

  function hasBusinessCredentials(req) {
    return req.headers['x-erp-service-id'] === 'erp-business-contract-test' &&
      req.headers['x-erp-service-secret'] === 'business-contract-secret';
  }

  beforeAll(async () => {
    state = {
      usedCodes: new Set(),
      requests: [],
      failExchange: false,
      failTeam: false,
      failVersion: false,
      lastAssertion: ''
    };

    server = http.createServer(async (req, res) => {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');

      if (req.method === 'POST' && requestUrl.pathname === '/api/v1/internal/sso/erp/exchange') {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (_error) {
          return sendJson(res, 400, { success: false, code: 'INVALID_JSON' });
        }
        state.requests.push({ type: 'exchange', headers: req.headers, body });

        if (state.failExchange) {
          return sendJson(res, 503, { success: false, code: 'SSO_TEMPORARILY_UNAVAILABLE' });
        }
        if (!hasSsoCredentials(req)) {
          return sendJson(res, 401, { success: false, code: 'INVALID_SSO_CLIENT' });
        }
        if (body.authorizationCode !== VALID_CODE) {
          return sendJson(res, 401, { success: false, code: 'INVALID_CODE' });
        }
        if (body.state !== VALID_STATE) {
          return sendJson(res, 401, { success: false, code: 'INVALID_STATE' });
        }
        if (state.usedCodes.has(body.authorizationCode)) {
          return sendJson(res, 410, { success: false, code: 'CODE_ALREADY_USED' });
        }

        state.usedCodes.add(body.authorizationCode);
        state.lastAssertion = signAssertion();
        return sendJson(res, 200, {
          success: true,
          data: { assertion: state.lastAssertion }
        });
      }

      const teamMatch = requestUrl.pathname.match(/^\/api\/v1\/internal\/users\/(\d+)\/team-scope$/);
      if (req.method === 'GET' && teamMatch) {
        state.requests.push({ type: 'team', headers: req.headers, userId: Number(teamMatch[1]) });
        if (state.failTeam) {
          return sendJson(res, 503, { success: false, code: 'TEAM_TEMPORARILY_UNAVAILABLE' });
        }
        if (!hasBusinessCredentials(req)) {
          return sendJson(res, 401, { success: false, code: 'INVALID_BUSINESS_CLIENT' });
        }
        return sendJson(res, 200, {
          success: true,
          data: { teamUserIds: [USER_ID, 43, 44] }
        });
      }

      const versionMatch = requestUrl.pathname.match(/^\/api\/v1\/internal\/users\/(\d+)\/permission-version$/);
      if (req.method === 'GET' && versionMatch) {
        state.requests.push({ type: 'version', headers: req.headers, userId: Number(versionMatch[1]) });
        if (state.failVersion) {
          return sendJson(res, 503, { success: false, code: 'VERSION_TEMPORARILY_UNAVAILABLE' });
        }
        if (!hasBusinessCredentials(req)) {
          return sendJson(res, 401, { success: false, code: 'INVALID_BUSINESS_CLIENT' });
        }
        return sendJson(res, 200, {
          success: true,
          data: { permissionVersion: 12 }
        });
      }

      return sendJson(res, 404, { success: false, code: 'NOT_FOUND' });
    });

    const address = await listen(server);
    baseUrl = `http://127.0.0.1:${address.port}`;

    process.env.NODE_ENV = 'test';
    process.env.NO_PROXY = '127.0.0.1,localhost';
    process.env.ENABLE_SSO_LOGIN = 'true';
    process.env.MAIN_SSO_BASE_URL = baseUrl;
    process.env.MAIN_SSO_EXCHANGE_PATH = '/api/v1/internal/sso/erp/exchange';
    process.env.MAIN_SSO_TEAM_SCOPE_PATH = '/api/v1/internal/users/:userId/team-scope';
    process.env.MAIN_PERMISSION_VERSION_PATH = '/api/v1/internal/users/:userId/permission-version';
    process.env.MAIN_SSO_TIMEOUT_MS = '2000';
    process.env.ERP_SSO_CLIENT_ID = 'erp-sso-contract-test';
    process.env.ERP_SSO_CLIENT_SECRET = 'sso-contract-secret';
    process.env.MAIN_API_CLIENT_ID = 'erp-business-contract-test';
    process.env.MAIN_API_CLIENT_SECRET = 'business-contract-secret';
    process.env.ERP_SSO_ACTIVE_KID = ACTIVE_KID;
    process.env.ERP_SSO_ACTIVE_PUBLIC_KEY = publicKey;
    delete process.env.ERP_SSO_ACTIVE_PUBLIC_KEY_PATH;
    delete process.env.ERP_SSO_PREVIOUS_KID;
    delete process.env.ERP_SSO_PREVIOUS_PUBLIC_KEY;
    delete process.env.ERP_SSO_PREVIOUS_PUBLIC_KEY_PATH;
    process.env.ERP_SSO_AUDIENCE = 'erp';
    process.env.ERP_SSO_ISSUER = 'patent-notice-system';
    process.env.ERP_SSO_CALLBACK_URL = 'http://127.0.0.1:5173/sso/callback';
    process.env.ERP_SESSION_SECRET = 'erp-http-contract-session-secret';
  });

  beforeEach(() => {
    state.requests.length = 0;
    state.failExchange = false;
    state.failTeam = false;
    state.failVersion = false;
  });

  afterAll(async () => {
    await close(server);
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test('真实 axios 完成一次性 Code 兑换、active kid RS256 验签并建立 ERP 会话', async () => {
    state.usedCodes.clear();
    const service = new MainSsoService();

    const result = await service.exchangeCode(VALID_CODE, VALID_STATE);

    expect(result).toMatchObject({
      authSource: 'main_sso',
      permissionVersion: 12,
      user: {
        id: USER_ID,
        username: 'http-contract-user',
        authSource: 'main_sso',
        permissionVersion: 12
      },
      permissions: {
        [PERMISSIONS.APP_VIEW]: { allowed: true, scope: 'all' },
        [PERMISSIONS.CONTRACT_VIEW]: { allowed: true, scope: 'team' }
      }
    });

    const exchangeRequest = state.requests.find((request) => request.type === 'exchange');
    expect(exchangeRequest.headers).toMatchObject({
      'x-erp-client-id': 'erp-sso-contract-test',
      'x-erp-client-secret': 'sso-contract-secret',
      'content-type': 'application/json'
    });
    expect(exchangeRequest.headers['x-erp-service-id']).toBeUndefined();
    expect(exchangeRequest.body).toEqual({
      authorizationCode: VALID_CODE,
      state: VALID_STATE,
      audience: 'erp',
      redirectUri: 'http://127.0.0.1:5173/sso/callback'
    });

    expect(jwt.decode(state.lastAssertion, { complete: true }).header).toMatchObject({
      alg: 'RS256',
      kid: ACTIVE_KID
    });
    expect(jwt.verify(result.token, process.env.ERP_SESSION_SECRET, {
      algorithms: ['HS256'],
      issuer: 'erp',
      audience: 'erp'
    })).toMatchObject({
      sub: String(USER_ID),
      authSource: 'main_sso',
      permissionVersion: 12
    });
  });

  test('主项目原子消费 Code 后，重放通过真实 HTTP 410 映射为 ERP 401', async () => {
    state.usedCodes.clear();
    const service = new MainSsoService();

    await expect(service.exchangeCode(VALID_CODE, VALID_STATE)).resolves.toMatchObject({
      user: { id: USER_ID }
    });
    await expect(service.exchangeCode(VALID_CODE, VALID_STATE)).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED'
    });

    expect(state.requests.filter((request) => request.type === 'exchange')).toHaveLength(2);
  });

  test('team-scope 与 permission-version 使用独立业务凭证并解析真实 HTTP 响应', async () => {
    const teamService = new MainUserScopeService();
    const versionService = new MainPermissionVersionService();

    await expect(teamService.getTeamUserIds(USER_ID)).resolves.toEqual([USER_ID, 43, 44]);
    await expect(versionService.getCurrentPermissionVersion(USER_ID)).resolves.toBe(12);
    await expect(versionService.assertCurrentPermissionVersion({
      id: USER_ID,
      authSource: 'main_sso',
      permissionVersion: 12
    })).resolves.toBe(true);

    for (const request of state.requests.filter((item) => item.type === 'team' || item.type === 'version')) {
      expect(request.userId).toBe(USER_ID);
      expect(request.headers).toMatchObject({
        'x-erp-service-id': 'erp-business-contract-test',
        'x-erp-service-secret': 'business-contract-secret'
      });
      expect(request.headers['x-erp-client-id']).toBeUndefined();
      expect(request.headers['x-erp-client-secret']).toBeUndefined();
    }
  });

  test('主项目网络服务异常时 SSO、权限版本和 team scope 均明确拒绝', async () => {
    const ssoService = new MainSsoService();
    const teamService = new MainUserScopeService();
    const versionService = new MainPermissionVersionService();

    state.failExchange = true;
    await expect(ssoService.exchangeCode('failure-code-1234567890', VALID_STATE)).rejects.toMatchObject({
      statusCode: 503,
      code: 'MAIN_SSO_UNAVAILABLE'
    });

    state.failTeam = true;
    await expect(teamService.getTeamUserIds(USER_ID)).rejects.toMatchObject({
      statusCode: 503,
      code: 'MAIN_TEAM_SCOPE_UNAVAILABLE'
    });

    state.failVersion = true;
    await expect(versionService.getCurrentPermissionVersion(USER_ID, { forceRefresh: true }))
      .rejects.toMatchObject({
        statusCode: 503,
        code: 'MAIN_PERMISSION_VERSION_UNAVAILABLE'
      });
  });
});
