'use strict';

const net = require('net');

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_REQUIRED_CONSECUTIVE_SUCCESSES = 3;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 30000;
const MIN_REQUIRED_CONSECUTIVE_SUCCESSES = 3;
const MAX_REQUIRED_CONSECUTIVE_SUCCESSES = 10;
const MAX_RESPONSE_BYTES = 32 * 1024;
const READY_PATH = '/api/v1/health/ready';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SAFE_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN'
]);

class ReadyWaitError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReadyWaitError';
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}

function parseIntegerSetting(value, {
  name,
  fallback,
  min,
  max
}) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) {
    throw new ReadyWaitError(
      `${name}_INVALID`,
      `${name} 必须是 ${min}-${max} 的整数`
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ReadyWaitError(
      `${name}_INVALID`,
      `${name} 必须是 ${min}-${max} 的整数`
    );
  }
  return parsed;
}

function normalizeHostname(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

function parseAllowedHosts(value) {
  if (value === undefined || value === null || value === '') return new Set();
  const values = Array.isArray(value)
    ? value
    : String(value).split(',');
  const hosts = new Set();
  for (const entry of values) {
    const host = normalizeHostname(entry);
    const isIp = net.isIP(host) !== 0;
    const isDnsName = host.length <= 253 && host.split('.').every(
      (label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    );
    if (
      !host ||
      host.includes('*') ||
      host.includes('/') ||
      host.includes('@') ||
      (!isIp && !isDnsName)
    ) {
      throw new ReadyWaitError(
        'READY_ALLOWED_HOSTS_INVALID',
        'READY_ALLOWED_HOSTS 只能包含逗号分隔的精确主机名或 IP，不支持通配符、端口和路径'
      );
    }
    hosts.add(host);
  }
  return hosts;
}

function validateReadyUrl(rawValue, allowedHosts = new Set()) {
  const value = String(rawValue || '').trim();
  if (!value) {
    throw new ReadyWaitError('READY_URL_MISSING', '必须通过 --url 或 READY_URL 提供 ready 地址');
  }

  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    throw new ReadyWaitError('READY_URL_INVALID', 'READY_URL 必须是有效的 HTTP(S) 地址');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ReadyWaitError('READY_URL_PROTOCOL_INVALID', 'READY_URL 只允许 http 或 https');
  }
  if (url.username || url.password) {
    throw new ReadyWaitError('READY_URL_CREDENTIALS_FORBIDDEN', 'READY_URL 不得包含账号或凭证');
  }
  if (url.search) {
    throw new ReadyWaitError('READY_URL_QUERY_FORBIDDEN', 'READY_URL 不得包含 query，包括 Token、Code 或其他参数');
  }
  if (url.hash) {
    throw new ReadyWaitError('READY_URL_FRAGMENT_FORBIDDEN', 'READY_URL 不得包含片段');
  }
  if (url.pathname !== READY_PATH) {
    throw new ReadyWaitError('READY_URL_PATH_INVALID', `READY_URL 路径必须固定为 ${READY_PATH}`);
  }

  const hostname = normalizeHostname(url.hostname);
  const isLocal = LOCAL_HOSTS.has(hostname);
  if (!isLocal && !allowedHosts.has(hostname)) {
    throw new ReadyWaitError(
      'READY_URL_HOST_NOT_ALLOWED',
      'READY_URL 只允许本机地址；远程主机必须加入 READY_ALLOWED_HOSTS 精确白名单'
    );
  }
  if (!isLocal && url.protocol !== 'https:') {
    throw new ReadyWaitError(
      'READY_URL_REMOTE_HTTP_FORBIDDEN',
      '非本机 ready 地址必须使用 HTTPS'
    );
  }
  return url;
}

function loadReadyWaitConfig({ env = process.env, url, allowedHosts } = {}) {
  const timeoutMs = parseIntegerSetting(env.READY_WAIT_TIMEOUT_MS, {
    name: 'READY_WAIT_TIMEOUT_MS',
    fallback: DEFAULT_TIMEOUT_MS,
    min: MIN_TIMEOUT_MS,
    max: MAX_TIMEOUT_MS
  });
  const intervalMs = parseIntegerSetting(env.READY_WAIT_INTERVAL_MS, {
    name: 'READY_WAIT_INTERVAL_MS',
    fallback: DEFAULT_INTERVAL_MS,
    min: MIN_INTERVAL_MS,
    max: Math.min(MAX_INTERVAL_MS, timeoutMs)
  });
  const requestTimeoutMs = parseIntegerSetting(env.READY_REQUEST_TIMEOUT_MS, {
    name: 'READY_REQUEST_TIMEOUT_MS',
    fallback: Math.min(DEFAULT_REQUEST_TIMEOUT_MS, timeoutMs),
    min: MIN_INTERVAL_MS,
    max: timeoutMs
  });
  const requiredConsecutiveSuccesses = parseIntegerSetting(
    env.READY_REQUIRED_CONSECUTIVE_SUCCESSES,
    {
      name: 'READY_REQUIRED_CONSECUTIVE_SUCCESSES',
      fallback: DEFAULT_REQUIRED_CONSECUTIVE_SUCCESSES,
      min: MIN_REQUIRED_CONSECUTIVE_SUCCESSES,
      max: MAX_REQUIRED_CONSECUTIVE_SUCCESSES
    }
  );
  const hosts = parseAllowedHosts(allowedHosts || env.READY_ALLOWED_HOSTS);
  const readyUrl = validateReadyUrl(url || env.READY_URL, hosts);
  return {
    url: readyUrl,
    safeTarget: `${readyUrl.protocol}//${readyUrl.host}${readyUrl.pathname}`,
    timeoutMs,
    intervalMs,
    requestTimeoutMs,
    requiredConsecutiveSuccesses,
    allowedHosts: hosts
  };
}

async function readLimitedJson(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ReadyWaitError('READY_RESPONSE_TOO_LARGE', 'ready 响应超过安全读取上限');
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new ReadyWaitError('READY_RESPONSE_TOO_LARGE', 'ready 响应超过安全读取上限');
    }
    try {
      return JSON.parse(text);
    } catch (_error) {
      throw new ReadyWaitError('READY_RESPONSE_INVALID_JSON', 'ready 响应不是有效 JSON');
    }
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ReadyWaitError('READY_RESPONSE_TOO_LARGE', 'ready 响应超过安全读取上限');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_error) {
    throw new ReadyWaitError('READY_RESPONSE_INVALID_JSON', 'ready 响应不是有效 JSON');
  }
}

function safeProbeFailure(error) {
  const readyCode = typeof error?.code === 'string' && /^READY_[A-Z0-9_]{1,88}$/.test(error.code)
    ? error.code
    : '';
  const networkCode = SAFE_NETWORK_CODES.has(error?.code) ? error.code : '';
  const safeCode = readyCode || networkCode ||
    (error?.name === 'AbortError' ? 'READY_REQUEST_TIMEOUT' : 'READY_REQUEST_FAILED');
  return { ready: false, code: safeCode };
}

async function probeReady(config, {
  fetchImpl = global.fetch,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return { ready: false, code: 'READY_FETCH_UNAVAILABLE' };
  }
  const controller = new AbortController();
  const timer = setTimer(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetchImpl(config.url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store'
      }
    });
    if (response.status !== 200) {
      return { ready: false, code: 'READY_HTTP_STATUS', status: response.status };
    }
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
      return { ready: false, code: 'READY_CONTENT_TYPE_INVALID', status: response.status };
    }
    let body;
    try {
      body = await readLimitedJson(response);
    } catch (error) {
      return safeProbeFailure(error);
    }
    if (body?.success !== true || body?.code !== 'READY' || body?.data?.ready !== true) {
      return { ready: false, code: 'READY_CONTRACT_INVALID', status: response.status };
    }
    return { ready: true, code: 'READY', status: response.status };
  } catch (error) {
    return safeProbeFailure(error);
  } finally {
    clearTimer(timer);
  }
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForReady({
  config,
  probe = probeReady,
  now = Date.now,
  sleep = defaultSleep,
  onAttempt = () => {}
} = {}) {
  if (!config) config = loadReadyWaitConfig();
  const startedAt = now();
  const deadline = startedAt + config.timeoutMs;
  const maxAttempts = Math.ceil(config.timeoutMs / Math.max(config.intervalMs, 1)) + 2;
  let attempts = 0;
  let consecutiveSuccesses = 0;
  let lastResult = { ready: false, code: 'READY_NOT_PROBED' };

  while (attempts < maxAttempts) {
    if (attempts > 0 && now() >= deadline) break;
    attempts += 1;
    try {
      lastResult = await probe({
        ...config,
        requestTimeoutMs: Math.min(
          config.requestTimeoutMs,
          Math.max(1, deadline - now())
        )
      });
    } catch (error) {
      lastResult = safeProbeFailure(error);
    }
    if (lastResult.ready === true) {
      consecutiveSuccesses += 1;
    } else {
      consecutiveSuccesses = 0;
    }
    onAttempt({
      attempt: attempts,
      ready: lastResult.ready === true,
      code: lastResult.code,
      status: lastResult.status,
      consecutiveSuccesses,
      requiredConsecutiveSuccesses: config.requiredConsecutiveSuccesses
    });
    if (
      lastResult.ready === true &&
      consecutiveSuccesses >= config.requiredConsecutiveSuccesses
    ) {
      return {
        ok: true,
        attempts,
        consecutiveSuccesses,
        elapsedMs: Math.max(0, now() - startedAt),
        target: config.safeTarget
      };
    }

    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(config.intervalMs, remaining));
  }

  throw new ReadyWaitError(
    'READY_WAIT_TIMEOUT',
    `ready 未在 ${config.timeoutMs}ms 内通过`,
    {
      attempts,
      consecutiveSuccesses,
      lastCode: lastResult.code,
      lastStatus: lastResult.status
    }
  );
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_REQUIRED_CONSECUTIVE_SUCCESSES,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS,
  MIN_REQUIRED_CONSECUTIVE_SUCCESSES,
  MAX_REQUIRED_CONSECUTIVE_SUCCESSES,
  MAX_RESPONSE_BYTES,
  READY_PATH,
  LOCAL_HOSTS,
  SAFE_NETWORK_CODES,
  ReadyWaitError,
  parseIntegerSetting,
  normalizeHostname,
  parseAllowedHosts,
  validateReadyUrl,
  loadReadyWaitConfig,
  readLimitedJson,
  safeProbeFailure,
  probeReady,
  waitForReady
};
