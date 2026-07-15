const { MainUserScopeService } = require('../src/services/mainUserScopeService');

describe('主项目 team scope 查询与缓存', () => {
  const originalEnv = { ...process.env };
  let now;

  beforeEach(() => {
    now = 1000;
    process.env.MAIN_SSO_BASE_URL = 'https://main.example.test/';
    process.env.MAIN_SSO_TEAM_SCOPE_PATH = '/api/v1/internal/users/:userId/team-scope';
    process.env.ERP_SSO_CLIENT_ID = 'sso-client-must-not-be-used';
    process.env.ERP_SSO_CLIENT_SECRET = 'sso-secret-must-not-be-used';
    process.env.MAIN_API_CLIENT_ID = 'erp-business-api';
    process.env.MAIN_API_CLIENT_SECRET = 'business-api-secret';
    process.env.MAIN_USER_SCOPE_CACHE_TTL_MS = '120000';
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, key)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test('获取契约规定的 teamUserIds，并使用独立业务凭证', async () => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        data: { data: { teamUserIds: [5, 6, 9] } }
      })
    };
    const service = new MainUserScopeService({ httpClient, now: () => now });

    await expect(service.getTeamUserIds(5)).resolves.toEqual([5, 6, 9]);
    expect(httpClient.get).toHaveBeenCalledWith(
      'https://main.example.test/api/v1/internal/users/5/team-scope',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-ERP-Service-Id': 'erp-business-api',
          'X-ERP-Service-Secret': 'business-api-secret'
        })
      })
    );
    const requestOptions = httpClient.get.mock.calls[0][1];
    expect(requestOptions.headers['X-ERP-Client-Id']).toBeUndefined();
    expect(requestOptions.headers['X-ERP-Client-Secret']).toBeUndefined();
  });

  test('有效期内使用缓存，过期后重新查询主项目', async () => {
    const httpClient = {
      get: jest.fn()
        .mockResolvedValueOnce({ data: { teamUserIds: [5, 6] } })
        .mockResolvedValueOnce({ data: { teamUserIds: [5, 7] } })
    };
    const service = new MainUserScopeService({ httpClient, now: () => now });

    await expect(service.getTeamUserIds(5)).resolves.toEqual([5, 6]);
    now += 60000;
    await expect(service.getTeamUserIds(5)).resolves.toEqual([5, 6]);
    expect(httpClient.get).toHaveBeenCalledTimes(1);

    now += 61000;
    await expect(service.getTeamUserIds(5)).resolves.toEqual([5, 7]);
    expect(httpClient.get).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['请求失败', { get: jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })) }],
    ['响应不是数组', { get: jest.fn().mockResolvedValue({ data: { data: { teamUserIds: '5,6' } } }) }],
    ['使用非契约字段', { get: jest.fn().mockResolvedValue({ data: { data: { userIds: [5, 6] } } }) }],
    ['包含字符串或非法 ID', { get: jest.fn().mockResolvedValue({ data: { data: { teamUserIds: [5, '6', 0] } } }) }],
    ['包含重复 ID', { get: jest.fn().mockResolvedValue({ data: { data: { teamUserIds: [5, 6, 6] } } }) }],
    ['未包含本人', { get: jest.fn().mockResolvedValue({ data: { data: { teamUserIds: [6, 7] } } }) }]
  ])('%s 时明确返回 503，不能静默伪装为空团队', async (_label, httpClient) => {
    const service = new MainUserScopeService({ httpClient, now: () => now });
    await expect(service.getTeamUserIds(5)).rejects.toMatchObject({
      statusCode: 503,
      code: 'MAIN_TEAM_SCOPE_UNAVAILABLE'
    });
  });

  test('服务凭证缺失时返回 503；用户 ID 非法时仍本地拒绝且不发送请求', async () => {
    delete process.env.MAIN_API_CLIENT_SECRET;
    const httpClient = { get: jest.fn() };
    const service = new MainUserScopeService({ httpClient, now: () => now });

    await expect(service.getTeamUserIds(5)).rejects.toMatchObject({
      statusCode: 503,
      code: 'MAIN_TEAM_SCOPE_UNAVAILABLE'
    });
    await expect(service.getTeamUserIds(0)).resolves.toEqual([]);
    await expect(service.getTeamUserIds('bad')).resolves.toEqual([]);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  test.each([
    ['Client ID 相同但 Secret 不同', () => {
      process.env.MAIN_API_CLIENT_ID = process.env.ERP_SSO_CLIENT_ID;
    }],
    ['Client Secret 相同但 ID 不同', () => {
      process.env.MAIN_API_CLIENT_SECRET = process.env.ERP_SSO_CLIENT_SECRET;
    }]
  ])('业务 API 与 SSO %s时返回 503 且不发送请求', async (_label, mutate) => {
    mutate();
    const httpClient = { get: jest.fn() };
    const service = new MainUserScopeService({ httpClient, now: () => now });

    await expect(service.getTeamUserIds(5)).rejects.toMatchObject({
      statusCode: 503,
      code: 'MAIN_TEAM_SCOPE_UNAVAILABLE'
    });
    expect(httpClient.get).not.toHaveBeenCalled();
  });
});
