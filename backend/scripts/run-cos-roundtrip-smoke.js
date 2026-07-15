'use strict';

const crypto = require('crypto');

const OBJECT_PREFIX = 'erp-smoke/cos-roundtrip/';
const CONTENT_TYPE = 'application/octet-stream';
const DEFAULT_TIMEOUT_MS = 15000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;

const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  UNEXPECTED: 1,
  CONFIG: 2,
  OPERATION: 3,
  VERIFICATION: 4
});

class CosSmokeError extends Error {
  constructor(code, message, exitCode, cause) {
    super(message);
    this.name = 'CosSmokeError';
    this.code = code;
    this.exitCode = exitCode;
    this.isOperational = true;
    if (cause) this.cause = cause;
  }
}

function requiredValue(env, name) {
  const value = typeof env[name] === 'string' ? env[name].trim() : '';
  if (!value || /^<.*>$/.test(value) || /^your[_-]/i.test(value)) {
    throw new CosSmokeError(
      'COS_SMOKE_CONFIG_MISSING',
      `缺少独立测试配置 ${name}`,
      EXIT_CODES.CONFIG
    );
  }
  return value;
}

function parseTimeout(value) {
  if (value === undefined || value === '') return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(String(value))) {
    throw new CosSmokeError(
      'COS_SMOKE_TIMEOUT_INVALID',
      `COS_SMOKE_TIMEOUT_MS 必须是 ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} 的整数`,
      EXIT_CODES.CONFIG
    );
  }
  const timeoutMs = Number(value);
  if (timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new CosSmokeError(
      'COS_SMOKE_TIMEOUT_INVALID',
      `COS_SMOKE_TIMEOUT_MS 必须是 ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} 的整数`,
      EXIT_CODES.CONFIG
    );
  }
  return timeoutMs;
}

function loadConfig(env = process.env) {
  const config = {
    secretId: requiredValue(env, 'COS_SMOKE_SECRET_ID'),
    secretKey: requiredValue(env, 'COS_SMOKE_SECRET_KEY'),
    securityToken: typeof env.COS_SMOKE_SECURITY_TOKEN === 'string'
      ? env.COS_SMOKE_SECURITY_TOKEN.trim()
      : '',
    bucket: requiredValue(env, 'COS_SMOKE_BUCKET'),
    region: requiredValue(env, 'COS_SMOKE_REGION'),
    timeoutMs: parseTimeout(env.COS_SMOKE_TIMEOUT_MS)
  };

  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/i.test(config.bucket)) {
    throw new CosSmokeError(
      'COS_SMOKE_BUCKET_INVALID',
      'COS_SMOKE_BUCKET 格式不合法',
      EXIT_CODES.CONFIG
    );
  }
  if (!/(test|ci|sandbox|smoke)/i.test(config.bucket)) {
    throw new CosSmokeError(
      'COS_SMOKE_BUCKET_NOT_ISOLATED',
      'COS_SMOKE_BUCKET 名称必须包含 test、ci、sandbox 或 smoke',
      EXIT_CODES.CONFIG
    );
  }

  const productionBucket = typeof env.COS_BUCKET === 'string'
    ? env.COS_BUCKET.trim()
    : '';
  if (!productionBucket || /^<.*>$/.test(productionBucket) || /^your[_-]/i.test(productionBucket)) {
    throw new CosSmokeError(
      'COS_SMOKE_PRODUCTION_BUCKET_UNKNOWN',
      '必须提供真实 COS_BUCKET 名称用于隔离校验（不需要业务桶凭证）',
      EXIT_CODES.CONFIG
    );
  }
  if (productionBucket.toLowerCase() === config.bucket.toLowerCase()) {
    throw new CosSmokeError(
      'COS_SMOKE_BUCKET_MATCHES_PRODUCTION',
      'COS_SMOKE_BUCKET 不得与 COS_BUCKET 相同',
      EXIT_CODES.CONFIG
    );
  }

  if (!/^[a-z0-9-]+$/i.test(config.region)) {
    throw new CosSmokeError(
      'COS_SMOKE_REGION_INVALID',
      'COS_SMOKE_REGION 格式不合法',
      EXIT_CODES.CONFIG
    );
  }
  return config;
}

function createClient(config, COSClass) {
  const COS = COSClass || require('cos-nodejs-sdk-v5');
  const options = {
    SecretId: config.secretId,
    SecretKey: config.secretKey,
    Timeout: config.timeoutMs
  };
  if (config.securityToken) options.SecurityToken = config.securityToken;
  return new COS(options);
}

function createObjectKey(now = Date.now(), randomUUID = crypto.randomUUID) {
  const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  return `${OBJECT_PREFIX}${timestamp}-${randomUUID()}.bin`;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeErrorDetail(error) {
  const code = typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(error.code)
    ? error.code
    : 'UNKNOWN';
  const status = Number.isInteger(error?.statusCode) ? `, HTTP ${error.statusCode}` : '';
  return `${code}${status}`;
}

function operationError(method, error) {
  if (error instanceof CosSmokeError) return error;
  return new CosSmokeError(
    'COS_SMOKE_OPERATION_FAILED',
    `COS ${method} 失败（${safeErrorDetail(error)}）`,
    EXIT_CODES.OPERATION,
    error
  );
}

function invokeCos(client, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new CosSmokeError(
        'COS_SMOKE_OPERATION_TIMEOUT',
        `COS ${method} 超过 ${timeoutMs}ms 未完成`,
        EXIT_CODES.OPERATION
      ));
    }, timeoutMs);

    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(operationError(method, error));
      else resolve(data || {});
    };

    try {
      if (!client || typeof client[method] !== 'function') {
        finish(new Error(`SDK method ${method} unavailable`));
        return;
      }
      client[method](params, finish);
    } catch (error) {
      finish(error);
    }
  });
}

function isNotFound(error) {
  return error?.statusCode === 404 ||
    error?.cause?.statusCode === 404 ||
    ['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(error?.code) ||
    ['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(error?.cause?.code);
}

function getContentType(response) {
  if (typeof response?.ContentType === 'string') return response.ContentType;
  const headers = response?.headers;
  if (!headers || typeof headers !== 'object') return '';
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'content-type');
  return key ? String(headers[key]) : '';
}

function normalizeContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

async function assertObjectMissing(client, params, timeoutMs, phase) {
  try {
    await invokeCos(client, 'headObject', params, timeoutMs);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  throw new CosSmokeError(
    'COS_SMOKE_DELETE_NOT_EFFECTIVE',
    `${phase}后对象仍然存在`,
    EXIT_CODES.VERIFICATION
  );
}

async function cleanupExactObject(client, params, timeoutMs) {
  try {
    await invokeCos(client, 'deleteObject', params, timeoutMs);
  } catch (error) {
    if (!isNotFound(error)) {
      throw new CosSmokeError(
        'COS_SMOKE_CLEANUP_FAILED',
        `精确清理测试对象失败（${safeErrorDetail(error.cause || error)}）`,
        EXIT_CODES.VERIFICATION,
        error
      );
    }
  }
  try {
    await assertObjectMissing(client, params, timeoutMs, '清理');
  } catch (error) {
    if (error.code === 'COS_SMOKE_DELETE_NOT_EFFECTIVE') {
      throw new CosSmokeError(
        'COS_SMOKE_CLEANUP_FAILED',
        '精确清理测试对象后对象仍然存在',
        EXIT_CODES.VERIFICATION,
        error
      );
    }
    throw new CosSmokeError(
      'COS_SMOKE_CLEANUP_FAILED',
      `无法确认测试对象已清理（${safeErrorDetail(error.cause || error)}）`,
      EXIT_CODES.VERIFICATION,
      error
    );
  }
}

function logTarget(output, config, key) {
  const bucketHint = config.bucket.length <= 8
    ? '[REDACTED]'
    : `${config.bucket.slice(0, 4)}…${config.bucket.slice(-4)}`;
  const objectId = sha256(Buffer.from(key)).slice(0, 12);
  output.log(`COS smoke 目标：bucket=${bucketHint}, region=${config.region}, object=${objectId}`);
}

async function executeRoundtrip({ config, client, output = console } = {}) {
  const objectKey = createObjectKey();
  if (!objectKey.startsWith(OBJECT_PREFIX)) {
    throw new CosSmokeError(
      'COS_SMOKE_INTERNAL_KEY_INVALID',
      '测试对象 Key 不在固定隔离前缀内',
      EXIT_CODES.CONFIG
    );
  }
  const payload = crypto.randomBytes(96);
  const expectedHash = sha256(payload);
  const params = {
    Bucket: config.bucket,
    Region: config.region,
    Key: objectKey
  };

  let primaryError;
  let finalCleanupError;
  logTarget(output, config, objectKey);
  try {
    output.log('1/5 上传随机测试对象');
    await invokeCos(client, 'putObject', {
      ...params,
      Body: payload,
      ContentType: CONTENT_TYPE
    }, config.timeoutMs);

    output.log('2/5 检查对象元数据');
    const head = await invokeCos(client, 'headObject', params, config.timeoutMs);
    if (normalizeContentType(getContentType(head)) !== CONTENT_TYPE) {
      throw new CosSmokeError(
        'COS_SMOKE_CONTENT_TYPE_MISMATCH',
        'headObject 返回的 Content-Type 与上传值不一致',
        EXIT_CODES.VERIFICATION
      );
    }

    output.log('3/5 下载并校验内容摘要');
    const downloaded = await invokeCos(client, 'getObject', params, config.timeoutMs);
    if (normalizeContentType(getContentType(downloaded)) !== CONTENT_TYPE) {
      throw new CosSmokeError(
        'COS_SMOKE_CONTENT_TYPE_MISMATCH',
        'getObject 返回的 Content-Type 与上传值不一致',
        EXIT_CODES.VERIFICATION
      );
    }
    if (downloaded.Body === undefined || downloaded.Body === null) {
      throw new CosSmokeError(
        'COS_SMOKE_BODY_MISSING',
        'getObject 未返回对象内容',
        EXIT_CODES.VERIFICATION
      );
    }
    const actualBody = Buffer.isBuffer(downloaded.Body)
      ? downloaded.Body
      : Buffer.from(downloaded.Body);
    if (sha256(actualBody) !== expectedHash) {
      throw new CosSmokeError(
        'COS_SMOKE_SHA256_MISMATCH',
        '下载对象的 SHA256 与上传内容不一致',
        EXIT_CODES.VERIFICATION
      );
    }

    output.log('4/5 删除本次测试对象');
    await invokeCos(client, 'deleteObject', params, config.timeoutMs);
    output.log('5/5 确认对象不存在');
    await assertObjectMissing(client, params, config.timeoutMs, '删除');
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await cleanupExactObject(client, params, config.timeoutMs);
    } catch (cleanupError) {
      if (primaryError) cleanupError.primaryCode = primaryError.code;
      finalCleanupError = cleanupError;
    }
  }

  if (finalCleanupError) throw finalCleanupError;
  if (primaryError) throw primaryError;
  output.log('COS 单对象 round-trip smoke 通过；测试对象已确认清理');
  return {
    ok: true,
    objectId: sha256(Buffer.from(objectKey)).slice(0, 12),
    sha256: expectedHash
  };
}

async function runCosRoundtripSmoke({ env = process.env, output = console, COSClass } = {}) {
  const config = loadConfig(env);
  const client = createClient(config, COSClass);
  return executeRoundtrip({ config, client, output });
}

function redactSensitiveText(value, env = process.env) {
  let output = String(value || '');
  const sensitiveValues = [
    env.COS_SMOKE_SECRET_ID,
    env.COS_SMOKE_SECRET_KEY,
    env.COS_SMOKE_SECURITY_TOKEN
  ].filter((item) => typeof item === 'string' && item.length >= 4);
  for (const sensitive of sensitiveValues) {
    output = output.split(sensitive).join('[REDACTED]');
  }
  return output.replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]');
}

async function main({
  env = process.env,
  output = console,
  COSClass,
  runner = runCosRoundtripSmoke
} = {}) {
  try {
    await runner({ env, output, COSClass });
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const exitCode = [EXIT_CODES.CONFIG, EXIT_CODES.OPERATION, EXIT_CODES.VERIFICATION]
      .includes(error?.exitCode)
      ? error.exitCode
      : EXIT_CODES.UNEXPECTED;
    const code = /^[A-Z0-9_]+$/.test(error?.code || '')
      ? error.code
      : 'COS_SMOKE_UNEXPECTED_ERROR';
    const message = error?.isOperational
      ? error.message
      : 'COS round-trip smoke 执行异常';
    output.error(`[${code}] ${redactSensitiveText(message, env)}`);
    return exitCode;
  }
}

if (require.main === module) {
  require('dotenv').config();
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  OBJECT_PREFIX,
  CONTENT_TYPE,
  DEFAULT_TIMEOUT_MS,
  EXIT_CODES,
  CosSmokeError,
  loadConfig,
  createClient,
  createObjectKey,
  invokeCos,
  isNotFound,
  cleanupExactObject,
  executeRoundtrip,
  runCosRoundtripSmoke,
  redactSensitiveText,
  main
};
