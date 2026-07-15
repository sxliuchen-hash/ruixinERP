'use strict';

const {
  MAX_RESPONSE_BYTES,
  ReadyWaitError,
  parseAllowedHosts,
  validateReadyUrl,
  loadReadyWaitConfig,
  probeReady,
  waitForReady
} = require('../src/services/readyWaitService');
const readyCli = require('../scripts/wait-for-ready');

function validEnv(overrides = {}) {
  return {
    READY_URL: 'http://127.0.0.1:3001/api/v1/health/ready',
    READY_WAIT_TIMEOUT_MS: '1000',
    READY_WAIT_INTERVAL_MS: '200',
    READY_REQUEST_TIMEOUT_MS: '500',
    READY_REQUIRED_CONSECUTIVE_SUCCESSES: '3',
    ...overrides
  };
}

function readyResponse(overrides = {}) {
  return new Response(JSON.stringify({
    success: true,
    code: 'READY',
    data: { ready: true },
    ...overrides
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('安全 ready 等待器', () => {
  test('默认只允许固定本机 ready 路径，远程地址要求精确白名单和 HTTPS', () => {
    expect(validateReadyUrl(
      'http://localhost:3001/api/v1/health/ready'
    ).hostname).toBe('localhost');
    expect(validateReadyUrl(
      'http://[::1]:3001/api/v1/health/ready'
    ).hostname).toBe('[::1]');

    const allowed = parseAllowedHosts('erp.iptt.top,10.0.0.8');
    expect(validateReadyUrl(
      'https://erp.iptt.top/api/v1/health/ready',
      allowed
    ).hostname).toBe('erp.iptt.top');
    expect(() => validateReadyUrl(
      'https://not-allowed.iptt.top/api/v1/health/ready',
      allowed
    )).toThrow(expect.objectContaining({ code: 'READY_URL_HOST_NOT_ALLOWED' }));
    expect(() => validateReadyUrl(
      'http://erp.iptt.top/api/v1/health/ready',
      allowed
    )).toThrow(expect.objectContaining({ code: 'READY_URL_REMOTE_HTTP_FORBIDDEN' }));
  });

  test.each([
    ['http://user:password@127.0.0.1:3001/api/v1/health/ready', 'READY_URL_CREDENTIALS_FORBIDDEN'],
    ['http://127.0.0.1:3001/api/v1/health/ready?token=secret', 'READY_URL_QUERY_FORBIDDEN'],
    ['http://127.0.0.1:3001/api/v1/health/ready#token', 'READY_URL_FRAGMENT_FORBIDDEN'],
    ['http://127.0.0.1:3001/api/v1/health/live', 'READY_URL_PATH_INVALID'],
    ['file:///api/v1/health/ready', 'READY_URL_PROTOCOL_INVALID']
  ])('拒绝不安全 ready URL：%s', (url, code) => {
    expect(() => validateReadyUrl(url)).toThrow(expect.objectContaining({ code }));
  });

  test.each(['*.iptt.top', 'erp.iptt.top:443', 'https://erp.iptt.top', 'user@erp.iptt.top']) (
    '拒绝非精确 allowlist：%s',
    (value) => {
      expect(() => parseAllowedHosts(value)).toThrow(expect.objectContaining({
        code: 'READY_ALLOWED_HOSTS_INVALID'
      }));
    }
  );

  test('超时、间隔和单请求超时必须在有界范围内', () => {
    expect(() => loadReadyWaitConfig({
      env: validEnv({ READY_WAIT_TIMEOUT_MS: '999' })
    })).toThrow(expect.objectContaining({ code: 'READY_WAIT_TIMEOUT_MS_INVALID' }));
    expect(() => loadReadyWaitConfig({
      env: validEnv({ READY_WAIT_INTERVAL_MS: '1001' })
    })).toThrow(expect.objectContaining({ code: 'READY_WAIT_INTERVAL_MS_INVALID' }));
    expect(() => loadReadyWaitConfig({
      env: validEnv({ READY_REQUEST_TIMEOUT_MS: '1001' })
    })).toThrow(expect.objectContaining({ code: 'READY_REQUEST_TIMEOUT_MS_INVALID' }));
    expect(() => loadReadyWaitConfig({
      env: validEnv({ READY_REQUIRED_CONSECUTIVE_SUCCESSES: '2' })
    })).toThrow(expect.objectContaining({
      code: 'READY_REQUIRED_CONSECUTIVE_SUCCESSES_INVALID'
    }));
  });

  test('probe 仅发无凭证 GET、禁止 redirect，并严格验证 ready JSON 契约', async () => {
    const config = loadReadyWaitConfig({ env: validEnv() });
    const fetchImpl = jest.fn().mockResolvedValue(readyResponse());
    const clearTimer = jest.fn();

    await expect(probeReady(config, {
      fetchImpl,
      setTimer: jest.fn(() => 42),
      clearTimer
    })).resolves.toEqual({ ready: true, code: 'READY', status: 200 });
    expect(fetchImpl).toHaveBeenCalledWith(config.url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store'
      }
    });
    const requestOptions = fetchImpl.mock.calls[0][1];
    expect(JSON.stringify(requestOptions)).not.toMatch(/authorization|cookie|token|secret/i);
    expect(clearTimer).toHaveBeenCalledWith(42);

    await expect(probeReady(config, {
      fetchImpl: jest.fn().mockResolvedValue(readyResponse({ code: 'LIVE' })),
      setTimer: () => 1,
      clearTimer: () => {}
    })).resolves.toMatchObject({ ready: false, code: 'READY_CONTRACT_INVALID' });
  });

  test('HTTP 非 200、非法 JSON 和超大正文均视为未就绪且不回显正文', async () => {
    const config = loadReadyWaitConfig({ env: validEnv() });
    const timerOptions = { setTimer: () => 1, clearTimer: () => {} };

    await expect(probeReady(config, {
      ...timerOptions,
      fetchImpl: jest.fn().mockResolvedValue(new Response('secret details', { status: 503 }))
    })).resolves.toEqual({ ready: false, code: 'READY_HTTP_STATUS', status: 503 });
    await expect(probeReady(config, {
      ...timerOptions,
      fetchImpl: jest.fn().mockResolvedValue(new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }))
    })).resolves.toEqual({ ready: false, code: 'READY_RESPONSE_INVALID_JSON' });
    await expect(probeReady(config, {
      ...timerOptions,
      fetchImpl: jest.fn().mockResolvedValue(new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      }))
    })).resolves.toEqual({ ready: false, code: 'READY_CONTENT_TYPE_INVALID', status: 200 });
    await expect(probeReady(config, {
      ...timerOptions,
      fetchImpl: jest.fn().mockResolvedValue(new Response('x', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(MAX_RESPONSE_BYTES + 1)
        }
      }))
    })).resolves.toEqual({ ready: false, code: 'READY_RESPONSE_TOO_LARGE' });
  });

  test('失败后按固定间隔重试，连续三次成功才返回', async () => {
    const config = loadReadyWaitConfig({ env: validEnv() });
    const results = [
      { ready: false, code: 'READY_HTTP_STATUS', status: 503 },
      { ready: false, code: 'READY_REQUEST_FAILED' },
      { ready: true, code: 'READY', status: 200 },
      { ready: true, code: 'READY', status: 200 },
      { ready: true, code: 'READY', status: 200 }
    ];
    let clock = 1000;
    const attempts = [];
    const sleep = jest.fn(async (milliseconds) => { clock += milliseconds; });

    await expect(waitForReady({
      config,
      probe: jest.fn(async () => results.shift()),
      now: () => clock,
      sleep,
      onAttempt: (attempt) => attempts.push(attempt)
    })).resolves.toEqual({
      ok: true,
      attempts: 5,
      consecutiveSuccesses: 3,
      elapsedMs: 800,
      target: 'http://127.0.0.1:3001/api/v1/health/ready'
    });
    expect(sleep).toHaveBeenNthCalledWith(1, 200);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(attempts).toHaveLength(5);
    expect(attempts.at(-1)).toMatchObject({
      consecutiveSuccesses: 3,
      requiredConsecutiveSuccesses: 3
    });
  });

  test('任一次失败都会把连续成功计数清零', async () => {
    const config = loadReadyWaitConfig({
      env: validEnv({ READY_WAIT_TIMEOUT_MS: '2000' })
    });
    const results = [
      { ready: true, code: 'READY', status: 200 },
      { ready: true, code: 'READY', status: 200 },
      { ready: false, code: 'READY_HTTP_STATUS', status: 503 },
      { ready: true, code: 'READY', status: 200 },
      { ready: true, code: 'READY', status: 200 },
      { ready: true, code: 'READY', status: 200 }
    ];
    let clock = 0;

    await expect(waitForReady({
      config,
      probe: jest.fn(async () => results.shift()),
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; }
    })).resolves.toMatchObject({
      ok: true,
      attempts: 6,
      consecutiveSuccesses: 3
    });
  });

  test('达到总超时 fail-closed，最后结果只保留安全 code/status', async () => {
    const config = loadReadyWaitConfig({ env: validEnv() });
    let clock = 5000;
    const secret = 'should-not-leak';
    let caught;
    try {
      await waitForReady({
        config,
        probe: jest.fn(async () => {
          const error = new Error(secret);
          error.code = 'ECONNREFUSED';
          throw error;
        }),
        now: () => clock,
        sleep: async (milliseconds) => { clock += milliseconds; }
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'READY_WAIT_TIMEOUT',
      details: {
        attempts: 5,
        lastCode: 'ECONNREFUSED'
      }
    });
    expect(JSON.stringify(caught)).not.toContain(secret);
  });

  test('CLI 允许重复精确 allow-host，拒绝未知参数并返回确定退出码', async () => {
    expect(readyCli.parseArgs([
      '--url=http://127.0.0.1:3001/api/v1/health/ready',
      '--allow-host', 'erp.iptt.top',
      '--allow-host=erp-test.iptt.top'
    ])).toEqual({
      url: 'http://127.0.0.1:3001/api/v1/health/ready',
      allowedHosts: ['erp.iptt.top', 'erp-test.iptt.top']
    });
    expect(() => readyCli.parseArgs(['--timeout', '1'])).toThrow(expect.objectContaining({
      code: 'READY_ARGUMENT_UNKNOWN'
    }));

    const output = { log: jest.fn(), error: jest.fn() };
    await expect(readyCli.main({
      args: [],
      env: validEnv(),
      output,
      execute: jest.fn().mockResolvedValue({ attempts: 1, elapsedMs: 5 })
    })).resolves.toBe(0);
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining('/api/v1/health/ready'));

    await expect(readyCli.main({
      args: ['--url', 'http://127.0.0.1:3001/api/v1/health/ready?token=secret'],
      env: validEnv(),
      output
    })).resolves.toBe(1);
    expect(output.error).toHaveBeenLastCalledWith(expect.stringContaining('READY_URL_QUERY_FORBIDDEN'));
    expect(JSON.stringify(output.error.mock.calls)).not.toContain('token=secret');
  });

  test('内部异常也会收敛为安全错误码', async () => {
    const result = await probeReady(loadReadyWaitConfig({ env: validEnv() }), {
      fetchImpl: jest.fn().mockRejectedValue(new ReadyWaitError('CUSTOM_SECRET', 'sensitive body')),
      setTimer: () => 1,
      clearTimer: () => {}
    });
    expect(result).toEqual({ ready: false, code: 'READY_REQUEST_FAILED' });
  });
});
