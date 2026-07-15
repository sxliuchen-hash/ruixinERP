'use strict';

jest.mock('../src/services/mainSsoService', () => ({
  exchangeCode: jest.fn()
}));
jest.mock('../src/services/ssoStateService', () => ({
  create: jest.fn(),
  consume: jest.fn(),
  isValidOpaqueToken: jest.fn((value) => (
    typeof value === 'string' && /^[A-Za-z0-9_-]{32,200}$/.test(value)
  ))
}));
jest.mock('../src/config/authFeatures', () => ({
  isSsoLoginEnabled: jest.fn(() => true)
}));
jest.mock('../src/config/mainSso', () => ({
  getMainSsoConfig: jest.fn(),
  assertMainSsoInitiationConfig: jest.fn()
}));

const mainSsoService = require('../src/services/mainSsoService');
const ssoStateService = require('../src/services/ssoStateService');
const {
  getMainSsoConfig,
  assertMainSsoInitiationConfig
} = require('../src/config/mainSso');
const { isSsoLoginEnabled } = require('../src/config/authFeatures');
const controller = require('../src/controllers/ssoController');

const VALID_STATE = 's'.repeat(43);
const VALID_BINDING = 'b'.repeat(43);
const OTHER_BINDING = 'x'.repeat(43);
const VALID_CODE = 'c'.repeat(43);

function createResponse() {
  return {
    cookie: jest.fn(),
    json: jest.fn()
  };
}

function createNext() {
  return jest.fn();
}

describe('ERP RP state Controller 端到端编排', () => {
  const config = {
    mainSystemUrl: 'https://main.example.test',
    continuePath: '/sso/continue',
    audience: 'erp',
    stateCookieName: 'erp_sso_browser',
    stateCookieSecure: true,
    stateTtlSec: 120
  };

  beforeEach(() => {
    jest.clearAllMocks();
    isSsoLoginEnabled.mockReturnValue(true);
    getMainSsoConfig.mockReturnValue(config);
    assertMainSsoInitiationConfig.mockImplementation(() => undefined);
  });

  test('initiate 创建 state、复用当前浏览器 Cookie 并返回固定 continue URL', async () => {
    ssoStateService.create.mockResolvedValue({
      state: VALID_STATE,
      browserBinding: VALID_BINDING,
      redirect: '/contracts',
      expiresIn: 120
    });
    const req = {
      headers: { cookie: `other=1; erp_sso_browser=${VALID_BINDING}; theme=dark` },
      body: { redirect: '/contracts' }
    };
    const res = createResponse();
    const next = createNext();

    await controller.initiate(req, res, next);

    expect(ssoStateService.create).toHaveBeenCalledWith({
      browserBinding: VALID_BINDING,
      redirect: '/contracts'
    });
    expect(res.cookie).toHaveBeenCalledWith('erp_sso_browser', VALID_BINDING, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 120000
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        state: VALID_STATE,
        redirectUrl: `https://main.example.test/sso/continue?app=erp&state=${VALID_STATE}`,
        continueUrl: `https://main.example.test/sso/continue?app=erp&state=${VALID_STATE}`,
        expiresIn: 120
      }
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('initiate 在 SSO 关闭或配置错误时不创建 state/cookie', async () => {
    isSsoLoginEnabled.mockReturnValue(false);
    const disabledRes = createResponse();
    const disabledNext = createNext();
    await controller.initiate({ headers: {}, body: {} }, disabledRes, disabledNext);
    expect(disabledNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 503,
      code: 'SSO_LOGIN_DISABLED'
    }));
    expect(ssoStateService.create).not.toHaveBeenCalled();
    expect(disabledRes.cookie).not.toHaveBeenCalled();

    isSsoLoginEnabled.mockReturnValue(true);
    assertMainSsoInitiationConfig.mockImplementationOnce(() => {
      const error = new Error('invalid config');
      error.code = 'SSO_CONFIGURATION_ERROR';
      throw error;
    });
    const invalidRes = createResponse();
    const invalidNext = createNext();
    await controller.initiate({ headers: {}, body: {} }, invalidRes, invalidNext);
    expect(invalidNext).toHaveBeenCalledWith(expect.objectContaining({ code: 'SSO_CONFIGURATION_ERROR' }));
    expect(ssoStateService.create).not.toHaveBeenCalled();
    expect(invalidRes.cookie).not.toHaveBeenCalled();
  });

  test('合法 callback 先原子消费浏览器 state，再把同一 state 交给主项目 exchange', async () => {
    ssoStateService.consume.mockResolvedValue({ redirect: '/inventory' });
    mainSsoService.exchangeCode.mockResolvedValue({
      token: 'erp-session',
      user: { id: 7 },
      permissions: {},
      authSource: 'main_sso'
    });
    const req = {
      headers: { cookie: `erp_sso_browser=${VALID_BINDING}` },
      body: { code: VALID_CODE, state: VALID_STATE }
    };
    const res = createResponse();
    const next = createNext();

    await controller.exchange(req, res, next);

    expect(ssoStateService.consume).toHaveBeenCalledWith({
      state: VALID_STATE,
      browserBinding: VALID_BINDING
    });
    expect(mainSsoService.exchangeCode).toHaveBeenCalledWith(VALID_CODE, VALID_STATE);
    expect(ssoStateService.consume.mock.invocationCallOrder[0])
      .toBeLessThan(mainSsoService.exchangeCode.mock.invocationCallOrder[0]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ token: 'erp-session', redirect: '/inventory' })
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    [{ code: VALID_CODE }, 'SSO_STATE_MISSING'],
    [{ state: VALID_STATE }, undefined],
    [{ code: 'too-short', state: VALID_STATE }, undefined],
    [{ code: 'x'.repeat(201), state: VALID_STATE }, undefined],
    [{ code: `${'x'.repeat(42)}!`, state: VALID_STATE }, undefined]
  ])('缺少 callback 参数时在消费 state 和请求主项目前拒绝: %j', async (body, expectedCode) => {
    const res = createResponse();
    const next = createNext();
    await controller.exchange({ headers: {}, body }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    if (expectedCode) expect(next.mock.calls[0][0]).toMatchObject({ code: expectedCode });
    expect(ssoStateService.consume).not.toHaveBeenCalled();
    expect(mainSsoService.exchangeCode).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test.each([
    ['缺 Cookie', Object.assign(new Error('missing'), { statusCode: 401, code: 'SSO_STATE_MISSING' })],
    ['跨浏览器', Object.assign(new Error('mismatch'), { statusCode: 401, code: 'SSO_STATE_MISMATCH' })],
    ['重复 callback', Object.assign(new Error('used'), { statusCode: 401, code: 'SSO_STATE_INVALID' })],
    ['Redis 不可用', Object.assign(new Error('redis'), { statusCode: 503, code: 'SSO_STATE_STORE_UNAVAILABLE' })]
  ])('%s时不向主项目发送 exchange', async (_label, stateError) => {
    ssoStateService.consume.mockRejectedValue(stateError);
    const res = createResponse();
    const next = createNext();

    await controller.exchange({
      headers: _label === '缺 Cookie' ? {} : { cookie: `erp_sso_browser=${OTHER_BINDING}` },
      body: { code: VALID_CODE, state: VALID_STATE }
    }, res, next);

    expect(next).toHaveBeenCalledWith(stateError);
    expect(mainSsoService.exchangeCode).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('重复或并发 callback 中只有成功消费 state 的请求能触发主项目 exchange', async () => {
    let consumed = false;
    ssoStateService.consume.mockImplementation(async () => {
      if (consumed) {
        throw Object.assign(new Error('used'), { statusCode: 401, code: 'SSO_STATE_INVALID' });
      }
      consumed = true;
      return { redirect: '' };
    });
    mainSsoService.exchangeCode.mockResolvedValue({ token: 'session', permissions: {} });
    const request = {
      headers: { cookie: `erp_sso_browser=${VALID_BINDING}` },
      body: { code: VALID_CODE, state: VALID_STATE }
    };
    const responses = [createResponse(), createResponse()];
    const nexts = [createNext(), createNext()];

    await Promise.all([
      controller.exchange(request, responses[0], nexts[0]),
      controller.exchange(request, responses[1], nexts[1])
    ]);

    expect(mainSsoService.exchangeCode).toHaveBeenCalledTimes(1);
    expect(responses.filter((response) => response.json.mock.calls.length === 1)).toHaveLength(1);
    expect(nexts.filter((next) => next.mock.calls.length === 1)).toHaveLength(1);
    expect(nexts.find((next) => next.mock.calls.length === 1).mock.calls[0][0])
      .toMatchObject({ code: 'SSO_STATE_INVALID' });
  });

  test('Cookie 解析只接受精确名称，不接受相似前缀', () => {
    expect(controller.readCookie(
      `erp_sso_browser_old=${OTHER_BINDING}; erp_sso_browser=${VALID_BINDING}`,
      'erp_sso_browser'
    )).toBe(VALID_BINDING);
    expect(controller.readCookie(`erp_sso_browser_old=${OTHER_BINDING}`, 'erp_sso_browser')).toBe('');
  });
});
