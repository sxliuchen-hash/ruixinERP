const { AppError } = require('../src/utils/errors');
const path = require('path');
const { spawnSync } = require('child_process');
const packageJson = require('../package.json');
const {
  runMainProjectContractSmoke
} = require('../src/services/mainProjectContractSmokeService');
const {
  main,
  redactSensitiveText,
  runMainProjectContractSmoke: runSmokeCommand
} = require('../scripts/run-main-project-contract-smoke');

const VALID_SSO_STATE = 's'.repeat(43);

describe('主项目测试环境契约烟雾检查', () => {
  function validConfig() {
    return {
      baseUrl: 'https://main.test.example',
      exchangePath: '/api/v1/internal/sso/erp/exchange',
      teamScopePath: '/api/v1/internal/users/:userId/team-scope',
      permissionVersionPath: '/api/v1/internal/users/:userId/permission-version',
      timeoutMs: 5000,
      businessClientId: 'erp-business',
      businessClientSecret: 'business-secret-value',
      businessClientIdHeader: 'X-ERP-Service-Id',
      businessClientSecretHeader: 'X-ERP-Service-Secret',
      clientId: 'erp-sso',
      clientSecret: 'sso-secret-value',
      clientIdHeader: 'X-ERP-Client-Id',
      clientSecretHeader: 'X-ERP-Client-Secret',
      audience: 'erp',
      callbackUrl: 'https://erp.test.example/sso/callback',
      publicKeys: { 'main-active': 'public-key-placeholder' }
    };
  }

  function validHttpClient() {
    return {
      get: jest.fn((url) => {
        if (url.endsWith('/team-scope')) {
          return Promise.resolve({
            data: { code: 200, message: '查询成功', data: { teamUserIds: [42, 43] } }
          });
        }
        return Promise.resolve({
          data: { code: 200, message: '查询成功', data: { permissionVersion: 8 } }
        });
      }),
      post: jest.fn()
    };
  }

  test('package.json 暴露固定的只读契约烟雾命令', () => {
    expect(packageJson.scripts['smoke:main-contract'])
      .toBe('node scripts/run-main-project-contract-smoke.js');
  });

  test('CLI 缺少用户 ID 时快速退出且不会连接 Redis', () => {
    const backendRoot = path.resolve(__dirname, '..');
    const result = spawnSync(
      process.execPath,
      [path.join(backendRoot, 'scripts', 'run-main-project-contract-smoke.js')],
      {
        cwd: backendRoot,
        env: {
          ...process.env,
          MAIN_CONTRACT_SMOKE_USER_ID: '',
          ENABLE_SSO_LOGIN: 'true',
          REDIS_HOST: '127.0.0.1',
          REDIS_PORT: '1'
        },
        encoding: 'utf8',
        timeout: 5000
      }
    );

    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    expect(result.status).toBe(1);
    expect(output).toContain('MAIN_CONTRACT_SMOKE_USER_ID_INVALID');
    expect(output).not.toMatch(/ECONNREFUSED|Redis 连接|REDIS_REQUIRED_UNAVAILABLE/);
    expect(result.error).toBeUndefined();
  });

  test('真实 CLI 配置路径缺少 MAIN_SSO_BASE_URL 时在发送请求前失败', async () => {
    const httpClient = validHttpClient();

    await expect(runMainProjectContractSmoke({
      env: { MAIN_CONTRACT_SMOKE_USER_ID: '42' },
      httpClient
    })).rejects.toMatchObject({
      code: 'MAIN_CONTRACT_SMOKE_CONFIGURATION_ERROR',
      statusCode: 503
    });
    expect(httpClient.get).not.toHaveBeenCalled();
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  test('默认只执行 team-scope 和 permission-version 两个只读检查', async () => {
    const httpClient = validHttpClient();
    const result = await runMainProjectContractSmoke({
      env: { MAIN_CONTRACT_SMOKE_USER_ID: '42' },
      config: validConfig(),
      httpClient
    });

    expect(result).toEqual({
      userId: 42,
      teamUserIds: [42, 43],
      permissionVersion: 8,
      sso: null
    });
    expect(httpClient.get).toHaveBeenCalledTimes(2);
    expect(httpClient.post).not.toHaveBeenCalled();
    for (const call of httpClient.get.mock.calls) {
      expect(call[0]).toContain('/api/v1/internal/users/42/');
      expect(call[1].headers).toEqual({
        'X-ERP-Service-Id': 'erp-business',
        'X-ERP-Service-Secret': 'business-secret-value'
      });
    }
  });

  test.each([
    ['Client ID 相同但 Secret 不同', (config) => { config.businessClientId = config.clientId; }],
    ['Client Secret 相同但 ID 不同', (config) => { config.businessClientSecret = config.clientSecret; }]
  ])('MAIN_API 与 ERP_SSO %s时配置失败且不发送请求', async (_label, mutate) => {
    const config = validConfig();
    const httpClient = validHttpClient();
    mutate(config);

    await expect(runMainProjectContractSmoke({
      env: { MAIN_CONTRACT_SMOKE_USER_ID: '42' },
      config,
      httpClient
    })).rejects.toMatchObject({
      code: 'MAIN_CONTRACT_SMOKE_CONFIGURATION_ERROR',
      statusCode: 503
    });
    expect(httpClient.get).not.toHaveBeenCalled();
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  test('显式提供一次性 Code 时执行 exchange、验证 assertion 且不返回敏感内容', async () => {
    const httpClient = validHttpClient();
    httpClient.post.mockResolvedValue({
      data: {
        code: 200,
        message: '兑换成功',
        data: { assertion: 'signed-assertion-must-stay-private' }
      }
    });
    const assertionVerifier = jest.fn().mockReturnValue({
      user: { id: 42 },
      permissionVersion: 8
    });
    const env = {
      MAIN_CONTRACT_SMOKE_USER_ID: '42',
      SSO_AUTHORIZATION_CODE: 'one-time-code-must-stay-private',
      SSO_STATE: VALID_SSO_STATE
    };

    const result = await runMainProjectContractSmoke({
      env,
      config: validConfig(),
      httpClient,
      assertionVerifier
    });

    expect(httpClient.post).toHaveBeenCalledWith(
      'https://main.test.example/api/v1/internal/sso/erp/exchange',
      {
        authorizationCode: env.SSO_AUTHORIZATION_CODE,
        state: VALID_SSO_STATE,
        audience: 'erp',
        redirectUri: 'https://erp.test.example/sso/callback'
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-ERP-Client-Id': 'erp-sso',
          'X-ERP-Client-Secret': 'sso-secret-value'
        })
      })
    );
    expect(assertionVerifier).toHaveBeenCalledWith(
      'signed-assertion-must-stay-private',
      expect.any(Object)
    );
    expect(JSON.stringify(result)).not.toContain(env.SSO_AUTHORIZATION_CODE);
    expect(JSON.stringify(result)).not.toContain('signed-assertion-must-stay-private');
    expect(JSON.stringify(result)).not.toContain('sso-secret-value');
  });

  test('可选 SSO 成功路径的 stdout、stderr 和返回摘要均不泄露凭证、完整 Code、assertion 或 Token', async () => {
    const output = { log: jest.fn(), error: jest.fn() };
    const httpClient = validHttpClient();
    const assertion = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI0MiJ9.private_signature';
    const erpToken = 'erp-session-token-must-stay-private';
    const code = 'one-time-code-must-stay-private';
    const config = validConfig();
    httpClient.post.mockResolvedValue({
      data: { code: 200, message: '兑换成功', data: { assertion } }
    });

    const summary = await runSmokeCommand({
      env: {
        MAIN_CONTRACT_SMOKE_USER_ID: '42',
        SSO_AUTHORIZATION_CODE: code,
        SSO_STATE: VALID_SSO_STATE,
        ERP_SSO_CLIENT_SECRET: config.clientSecret,
        MAIN_API_CLIENT_SECRET: config.businessClientSecret
      },
      config,
      httpClient,
      output,
      assertionVerifier: jest.fn().mockReturnValue({
        user: { id: 42 },
        permissionVersion: 8,
        token: erpToken
      })
    });

    const visibleOutput = [
      ...output.log.mock.calls.flat(),
      ...output.error.mock.calls.flat(),
      JSON.stringify(summary)
    ].join('\n');

    for (const sensitiveValue of [
      config.clientSecret,
      config.businessClientSecret,
      code,
      VALID_SSO_STATE,
      assertion,
      erpToken
    ]) {
      expect(visibleOutput).not.toContain(sensitiveValue);
    }
    expect(output.error).not.toHaveBeenCalled();
    expect(summary.sso).toEqual({ verified: true, userId: 42, permissionVersion: 8 });
  });

  test.each([
    ['缺少用户 ID', {}, 'MAIN_CONTRACT_SMOKE_USER_ID_INVALID'],
    ['用户 ID 非正整数', { MAIN_CONTRACT_SMOKE_USER_ID: '0' }, 'MAIN_CONTRACT_SMOKE_USER_ID_INVALID']
  ])('%s 时明确失败', async (_label, env, code) => {
    await expect(runMainProjectContractSmoke({
      env,
      config: validConfig(),
      httpClient: validHttpClient()
    })).rejects.toMatchObject({ code, statusCode: 400 });
  });

  test.each([
    ['teamUserIds 不是数组', { teamUserIds: '42' }],
    ['teamUserIds 含非法 ID', { teamUserIds: [42, -1] }],
    ['teamUserIds 含字符串 ID', { teamUserIds: [42, '43'] }],
    ['teamUserIds 不含本人', { teamUserIds: [43] }],
    ['teamUserIds 含重复 ID', { teamUserIds: [42, 42] }]
  ])('%s 时拒绝', async (_label, teamPayload) => {
    const httpClient = validHttpClient();
    httpClient.get.mockImplementation((url) => Promise.resolve({
      data: {
        success: true,
        data: url.endsWith('/team-scope') ? teamPayload : { permissionVersion: 8 }
      }
    }));

    await expect(runMainProjectContractSmoke({
      env: { MAIN_CONTRACT_SMOKE_USER_ID: '42' },
      config: validConfig(),
      httpClient
    })).rejects.toMatchObject({ code: 'MAIN_CONTRACT_SMOKE_TEAM_SCOPE_INVALID' });
  });

  test.each([
    ['缺失', {}],
    ['为负数', { permissionVersion: -1 }],
    ['不是整数', { permissionVersion: 'bad' }],
    ['数字字符串也不是 JSON 整数', { permissionVersion: '8' }]
  ])('permissionVersion %s时拒绝', async (_label, versionPayload) => {
    const httpClient = validHttpClient();
    httpClient.get.mockImplementation((url) => Promise.resolve({
      data: {
        success: true,
        data: url.endsWith('/team-scope') ? { teamUserIds: [42] } : versionPayload
      }
    }));

    await expect(runMainProjectContractSmoke({
      env: { MAIN_CONTRACT_SMOKE_USER_ID: '42' },
      config: validConfig(),
      httpClient
    })).rejects.toMatchObject({ code: 'MAIN_CONTRACT_SMOKE_PERMISSION_VERSION_INVALID' });
  });

  test('HTTP 错误不透传 axios 中可能包含的 Secret 或 Code', async () => {
    const httpClient = validHttpClient();
    const sensitive = 'business-secret-value one-time-code-must-stay-private';
    httpClient.get.mockRejectedValue(Object.assign(new Error(sensitive), {
      response: { status: 503 }
    }));

    let caught;
    try {
      await runMainProjectContractSmoke({
        env: {
          MAIN_CONTRACT_SMOKE_USER_ID: '42',
          SSO_AUTHORIZATION_CODE: 'one-time-code-must-stay-private',
          SSO_STATE: VALID_SSO_STATE
        },
        config: validConfig(),
        httpClient
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'MAIN_CONTRACT_SMOKE_HTTP_ERROR', statusCode: 503 });
    expect(caught.message).not.toContain('business-secret-value');
    expect(caught.message).not.toContain('one-time-code-must-stay-private');
  });

  test('SSO assertion 用户与检查用户不一致时拒绝', async () => {
    const httpClient = validHttpClient();
    httpClient.post.mockResolvedValue({ data: { assertion: 'private-assertion' } });

    await expect(runMainProjectContractSmoke({
      env: {
        MAIN_CONTRACT_SMOKE_USER_ID: '42',
        SSO_AUTHORIZATION_CODE: 'private-code',
        SSO_STATE: VALID_SSO_STATE
      },
      config: validConfig(),
      httpClient,
      assertionVerifier: () => ({ user: { id: 99 }, permissionVersion: 8 })
    })).rejects.toMatchObject({ code: 'MAIN_CONTRACT_SMOKE_SSO_USER_MISMATCH' });
  });

  test('SSO assertion 权限版本与本轮实时查询结果不一致时拒绝', async () => {
    const httpClient = validHttpClient();
    httpClient.post.mockResolvedValue({ data: { assertion: 'private-assertion' } });

    await expect(runMainProjectContractSmoke({
      env: {
        MAIN_CONTRACT_SMOKE_USER_ID: '42',
        SSO_AUTHORIZATION_CODE: 'private-code',
        SSO_STATE: VALID_SSO_STATE
      },
      config: validConfig(),
      httpClient,
      assertionVerifier: () => ({ user: { id: 42 }, permissionVersion: 9 })
    })).rejects.toMatchObject({
      code: 'MAIN_CONTRACT_SMOKE_SSO_PERMISSION_VERSION_MISMATCH',
      statusCode: 503
    });
  });

  test('命令失败时返回非零码并对已知敏感值脱敏', async () => {
    const output = { log: jest.fn(), error: jest.fn() };
    const env = {
      ERP_SSO_CLIENT_SECRET: 'sso-secret-value',
      MAIN_API_CLIENT_SECRET: 'business-secret-value',
      SSO_AUTHORIZATION_CODE: 'private-code-value',
      SSO_STATE: VALID_SSO_STATE
    };
    const error = new AppError(
      '失败 sso-secret-value business-secret-value private-code-value',
      503,
      'MAIN_CONTRACT_SMOKE_TEST_ERROR'
    );

    await expect(main({ env, output, runner: jest.fn().mockRejectedValue(error) })).resolves.toBe(1);
    const printed = output.error.mock.calls.flat().join(' ');
    expect(printed).toContain('MAIN_CONTRACT_SMOKE_TEST_ERROR');
    expect(printed).not.toContain('sso-secret-value');
    expect(printed).not.toContain('business-secret-value');
    expect(printed).not.toContain('private-code-value');
  });

  test('JWT 形态内容会被统一脱敏', () => {
    const jwtLike = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI0MiJ9.signature_value';
    expect(redactSensitiveText(`assertion=${jwtLike}`, {})).toBe('assertion=[REDACTED_JWT]');
  });

  test.each([
    [{ SSO_AUTHORIZATION_CODE: 'private-code' }, 'MAIN_CONTRACT_SMOKE_SSO_STATE_REQUIRED'],
    [{ SSO_STATE: VALID_SSO_STATE }, 'MAIN_CONTRACT_SMOKE_SSO_STATE_REQUIRED'],
    [{ SSO_AUTHORIZATION_CODE: 'private-code', SSO_STATE: 'bad state' }, 'MAIN_CONTRACT_SMOKE_SSO_STATE_INVALID']
  ])('Code/state 不成对或 state 非法时在 HTTP 前拒绝', async (extraEnv, code) => {
    const httpClient = validHttpClient();
    await expect(runMainProjectContractSmoke({
      env: { MAIN_CONTRACT_SMOKE_USER_ID: '42', ...extraEnv },
      config: validConfig(),
      httpClient
    })).rejects.toMatchObject({ code, statusCode: 400 });
    expect(httpClient.get).not.toHaveBeenCalled();
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  test('脚本导出的 smoke runner 可注入 HTTP 和输出，并只返回安全摘要', async () => {
    const output = { log: jest.fn(), error: jest.fn() };
    const httpClient = validHttpClient();
    const summary = await runSmokeCommand({
      env: { MAIN_CONTRACT_SMOKE_USER_ID: '42' },
      config: validConfig(),
      httpClient,
      output
    });

    expect(summary).toEqual({
      ok: true,
      userId: 42,
      teamUserCount: 2,
      permissionVersion: 8,
      sso: null
    });
    expect(httpClient.post).not.toHaveBeenCalled();
    expect(JSON.stringify(summary)).not.toContain('business-secret-value');
  });
});
