'use strict';

const { createHash, randomBytes } = require('crypto');
const redis = require('../config/redis');
const { AppError } = require('../utils/errors');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,200}$/;
const STATE_KEY_PREFIX = 'sso_state:';
const CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  return {0, ''}
end

redis.call('DEL', KEYS[1])
local expectedBindingHash = string.sub(value, 1, 64)
if expectedBindingHash ~= ARGV[1] then
  return {-1, ''}
end

return {1, string.sub(value, 66)}
`;

function hashValue(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isValidOpaqueToken(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

function normalizeLocalRedirect(value) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  if (!candidate || candidate.length > 2048 || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return '';
  }

  try {
    const parsed = new URL(candidate, 'https://erp.local');
    if (parsed.origin !== 'https://erp.local') return '';
    if (parsed.pathname === '/sso/initiate' || parsed.pathname === '/sso/callback') return '';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_error) {
    return '';
  }
}

function encodeRedirect(redirect) {
  return Buffer.from(redirect, 'utf8').toString('base64url');
}

function decodeRedirect(encoded) {
  if (!encoded) return '';
  try {
    return normalizeLocalRedirect(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (_error) {
    return '';
  }
}

class SsoStateService {
  constructor({
    redisClient = redis,
    ttlSec = Number.parseInt(process.env.ERP_SSO_STATE_TTL_SEC, 10) || 120,
    randomBytesFn = randomBytes
  } = {}) {
    this.redisClient = redisClient;
    this.ttlSec = ttlSec;
    this.randomBytesFn = randomBytesFn;
  }

  createToken() {
    return this.randomBytesFn(32).toString('base64url');
  }

  async create({ browserBinding = '', redirect = '' } = {}) {
    const binding = isValidOpaqueToken(browserBinding)
      ? browserBinding
      : this.createToken();
    const bindingHash = hashValue(binding);
    const safeRedirect = normalizeLocalRedirect(redirect);
    const value = `${bindingHash}:${encodeRedirect(safeRedirect)}`;

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = this.createToken();
        const result = await this.redisClient.set(
          `${STATE_KEY_PREFIX}${hashValue(state)}`,
          value,
          'EX',
          this.ttlSec,
          'NX'
        );
        if (result === 'OK') {
          return {
            state,
            browserBinding: binding,
            redirect: safeRedirect,
            expiresIn: this.ttlSec
          };
        }
      }
    } catch (_error) {
      throw new AppError(
        'SSO 登录状态服务暂时不可用',
        503,
        'SSO_STATE_STORE_UNAVAILABLE'
      );
    }

    throw new AppError(
      'SSO 登录状态创建失败',
      503,
      'SSO_STATE_STORE_UNAVAILABLE'
    );
  }

  async consume({ state, browserBinding } = {}) {
    if (!isValidOpaqueToken(state)) {
      throw new AppError('SSO 登录状态无效', 400, 'SSO_STATE_INVALID');
    }
    if (!isValidOpaqueToken(browserBinding)) {
      throw new AppError('SSO 登录状态缺少浏览器绑定', 401, 'SSO_STATE_MISSING');
    }

    let result;
    try {
      result = await this.redisClient.eval(
        CONSUME_SCRIPT,
        1,
        `${STATE_KEY_PREFIX}${hashValue(state)}`,
        hashValue(browserBinding)
      );
    } catch (_error) {
      throw new AppError(
        'SSO 登录状态服务暂时不可用',
        503,
        'SSO_STATE_STORE_UNAVAILABLE'
      );
    }

    const status = Number(Array.isArray(result) ? result[0] : result);
    if (status === -1) {
      throw new AppError('SSO 登录状态与当前浏览器不匹配', 401, 'SSO_STATE_MISMATCH');
    }
    if (status !== 1) {
      throw new AppError('SSO 登录状态无效、已过期或已使用', 401, 'SSO_STATE_INVALID');
    }

    return {
      redirect: decodeRedirect(Array.isArray(result) ? result[1] : '')
    };
  }
}

module.exports = new SsoStateService();
module.exports.SsoStateService = SsoStateService;
module.exports.CONSUME_SCRIPT = CONSUME_SCRIPT;
module.exports.STATE_KEY_PREFIX = STATE_KEY_PREFIX;
module.exports.hashValue = hashValue;
module.exports.isValidOpaqueToken = isValidOpaqueToken;
module.exports.normalizeLocalRedirect = normalizeLocalRedirect;
