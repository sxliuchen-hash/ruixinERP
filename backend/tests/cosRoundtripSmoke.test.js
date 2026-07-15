'use strict';

const fs = require('fs');
const path = require('path');
const {
  OBJECT_PREFIX,
  CONTENT_TYPE,
  EXIT_CODES,
  CosSmokeError,
  loadConfig,
  createClient,
  invokeCos,
  executeRoundtrip,
  main
} = require('../scripts/run-cos-roundtrip-smoke');

function validEnv(overrides = {}) {
  return {
    COS_SMOKE_SECRET_ID: 'smoke-secret-id',
    COS_SMOKE_SECRET_KEY: 'smoke-secret-key',
    COS_SMOKE_BUCKET: 'erp-smoke-test-1250000000',
    COS_SMOKE_REGION: 'ap-guangzhou',
    COS_SMOKE_TIMEOUT_MS: '3000',
    COS_BUCKET: 'erp-production-1250000000',
    ...overrides
  };
}

function notFoundError() {
  const error = new Error('not found');
  error.code = 'NoSuchKey';
  error.statusCode = 404;
  return error;
}

function createMemoryCos({ corruptBody = false, wrongContentType = false } = {}) {
  let object = null;
  const calls = [];
  const client = {
    putObject: jest.fn((params, callback) => {
      calls.push(['putObject', params]);
      object = {
        key: params.Key,
        body: Buffer.from(params.Body),
        contentType: params.ContentType
      };
      callback(null, { statusCode: 200 });
    }),
    headObject: jest.fn((params, callback) => {
      calls.push(['headObject', params]);
      if (!object || object.key !== params.Key) return callback(notFoundError());
      return callback(null, {
        headers: {
          'content-type': wrongContentType ? 'text/plain' : object.contentType
        }
      });
    }),
    getObject: jest.fn((params, callback) => {
      calls.push(['getObject', params]);
      if (!object || object.key !== params.Key) return callback(notFoundError());
      const body = corruptBody ? Buffer.from('corrupted') : Buffer.from(object.body);
      return callback(null, {
        Body: body,
        headers: { 'Content-Type': object.contentType }
      });
    }),
    deleteObject: jest.fn((params, callback) => {
      calls.push(['deleteObject', params]);
      if (object?.key === params.Key) object = null;
      callback(null, { statusCode: 204 });
    })
  };
  return { client, calls, getObject: () => object };
}

describe('COS 单对象 round-trip smoke', () => {
  test('只使用独立 COS_SMOKE 凭证，不会回退到业务 COS 凭证', () => {
    expect(() => loadConfig({
      COS_SECRET_ID: 'production-id',
      COS_SECRET_KEY: 'production-key',
      COS_BUCKET: 'erp-production-1250000000',
      COS_REGION: 'ap-guangzhou'
    })).toThrow(expect.objectContaining({
      code: 'COS_SMOKE_CONFIG_MISSING',
      exitCode: EXIT_CODES.CONFIG
    }));
  });

  test.each([
    [
      { COS_SMOKE_BUCKET: 'erp-production-1250000000' },
      'COS_SMOKE_BUCKET_NOT_ISOLATED'
    ],
    [
      {
        COS_SMOKE_BUCKET: 'erp-smoke-test-1250000000',
        COS_BUCKET: 'ERP-SMOKE-TEST-1250000000'
      },
      'COS_SMOKE_BUCKET_MATCHES_PRODUCTION'
    ],
    [
      { COS_SMOKE_TIMEOUT_MS: '999' },
      'COS_SMOKE_TIMEOUT_INVALID'
    ],
    [
      { COS_BUCKET: '' },
      'COS_SMOKE_PRODUCTION_BUCKET_UNKNOWN'
    ]
  ])('拒绝不安全的 smoke 配置 %#', (overrides, expectedCode) => {
    expect(() => loadConfig(validEnv(overrides))).toThrow(
      expect.objectContaining({ code: expectedCode, exitCode: EXIT_CODES.CONFIG })
    );
  });

  test('SDK 使用独立凭证、可选临时 Token 和请求超时', () => {
    const config = loadConfig(validEnv({
      COS_SMOKE_SECURITY_TOKEN: 'temporary-security-token'
    }));
    const client = { name: 'mock-client' };
    const COSClass = jest.fn(() => client);

    expect(createClient(config, COSClass)).toBe(client);
    expect(COSClass).toHaveBeenCalledWith({
      SecretId: 'smoke-secret-id',
      SecretKey: 'smoke-secret-key',
      SecurityToken: 'temporary-security-token',
      Timeout: 3000
    });
  });

  test('完成 put/head/get/SHA256/Content-Type/delete/不存在确认并精确清理', async () => {
    const config = loadConfig(validEnv());
    const memoryCos = createMemoryCos();
    const output = { log: jest.fn(), error: jest.fn() };

    await expect(executeRoundtrip({
      config,
      client: memoryCos.client,
      output
    })).resolves.toEqual(expect.objectContaining({ ok: true }));

    expect(memoryCos.getObject()).toBeNull();
    expect(memoryCos.client.putObject).toHaveBeenCalledTimes(1);
    expect(memoryCos.client.getObject).toHaveBeenCalledTimes(1);
    expect(memoryCos.client.deleteObject).toHaveBeenCalledTimes(2);
    expect(memoryCos.client.headObject).toHaveBeenCalledTimes(3);

    const putParams = memoryCos.client.putObject.mock.calls[0][0];
    expect(putParams.Key).toMatch(new RegExp(`^${OBJECT_PREFIX}`));
    expect(putParams.Body).toBeInstanceOf(Buffer);
    expect(putParams.Body).toHaveLength(96);
    expect(putParams.ContentType).toBe(CONTENT_TYPE);

    const everyKey = memoryCos.calls.map(([, params]) => params.Key);
    expect(new Set(everyKey)).toEqual(new Set([putParams.Key]));
    expect(memoryCos.calls.map(([method]) => method)).not.toEqual(
      expect.arrayContaining(['listObjects', 'deleteMultipleObject'])
    );
    const logs = output.log.mock.calls.flat().join('\n');
    expect(logs).not.toContain(config.bucket);
    expect(logs).not.toContain(putParams.Key);
    expect(logs).not.toContain(config.secretId);
    expect(logs).not.toContain(config.secretKey);
  });

  test('下载内容摘要不一致时失败且仍精确清理对象', async () => {
    const memoryCos = createMemoryCos({ corruptBody: true });
    await expect(executeRoundtrip({
      config: loadConfig(validEnv()),
      client: memoryCos.client,
      output: { log: jest.fn(), error: jest.fn() }
    })).rejects.toMatchObject({
      code: 'COS_SMOKE_SHA256_MISMATCH',
      exitCode: EXIT_CODES.VERIFICATION
    });
    expect(memoryCos.getObject()).toBeNull();
    expect(memoryCos.client.deleteObject).toHaveBeenCalledTimes(1);
  });

  test('head Content-Type 不一致时失败且仍精确清理对象', async () => {
    const memoryCos = createMemoryCos({ wrongContentType: true });
    await expect(executeRoundtrip({
      config: loadConfig(validEnv()),
      client: memoryCos.client,
      output: { log: jest.fn(), error: jest.fn() }
    })).rejects.toMatchObject({
      code: 'COS_SMOKE_CONTENT_TYPE_MISMATCH',
      exitCode: EXIT_CODES.VERIFICATION
    });
    expect(memoryCos.getObject()).toBeNull();
  });

  test('SDK 无回调时由本地超时门禁终止', async () => {
    jest.useFakeTimers();
    try {
      const pending = invokeCos({
        headObject: jest.fn()
      }, 'headObject', {}, 1000);
      const rejection = expect(pending).rejects.toMatchObject({
        code: 'COS_SMOKE_OPERATION_TIMEOUT',
        exitCode: EXIT_CODES.OPERATION
      });
      await jest.advanceTimersByTimeAsync(1000);
      await rejection;
    } finally {
      jest.useRealTimers();
    }
  });

  test('CLI 使用分层退出码并从错误日志移除凭证和 URL', async () => {
    const env = validEnv({ COS_SMOKE_SECURITY_TOKEN: 'smoke-security-token' });
    const output = { log: jest.fn(), error: jest.fn() };
    const runner = jest.fn(async () => {
      throw new CosSmokeError(
        'COS_SMOKE_OPERATION_FAILED',
        `failed smoke-secret-id smoke-secret-key smoke-security-token https://secret.example/key`,
        EXIT_CODES.OPERATION
      );
    });

    await expect(main({ env, output, runner })).resolves.toBe(EXIT_CODES.OPERATION);
    const line = output.error.mock.calls[0][0];
    expect(line).toContain('[COS_SMOKE_OPERATION_FAILED]');
    expect(line).toContain('[REDACTED]');
    expect(line).toContain('[REDACTED_URL]');
    expect(line).not.toContain('smoke-secret');
    expect(line).not.toContain('secret.example');
  });

  test('源文件不包含列表、批量或递归删除调用，package 暴露人工 smoke 命令', () => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'run-cos-roundtrip-smoke.js');
    const source = fs.readFileSync(scriptPath, 'utf8');
    const ciSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'),
      'utf8'
    );
    const packageJson = require('../package.json');

    expect(source).not.toMatch(/\.list(?:Objects|ObjectsV2|ObjectVersions)\s*\(/);
    expect(source).not.toMatch(/\.delete(?:MultipleObject|Objects)\s*\(/);
    expect(packageJson.scripts['smoke:cos-roundtrip'])
      .toBe('node scripts/run-cos-roundtrip-smoke.js');
    expect(ciSource).not.toMatch(/(?:npm|pnpm|yarn)\s+run\s+smoke:cos-roundtrip/);
  });
});
