'use strict';

const crypto = require('crypto');
const { AppError, UnauthorizedError } = require('../utils/errors');

class SsoAssertionReplayGuard {
  constructor({
    redisClient = null,
    now = () => Date.now(),
    maxTtlSeconds = 305
  } = {}) {
    this.redisClient = redisClient;
    this.now = now;
    this.maxTtlSeconds = maxTtlSeconds;
    this.memory = new Map();
  }

  _buildKey(jti) {
    const digest = crypto.createHash('sha256').update(jti).digest('hex');
    return `sso_assertion_jti:${digest}`;
  }

  async consume({ jti, expiresAt }) {
    const nowSeconds = Math.floor(this.now() / 1000);
    const rawExpiresAt = Number(expiresAt);
    const ttlSeconds = rawExpiresAt - nowSeconds + 5;
    if (
      typeof jti !== 'string' ||
      jti.length < 8 ||
      jti.length > 200 ||
      !Number.isInteger(rawExpiresAt) ||
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < 1 ||
      ttlSeconds > this.maxTtlSeconds
    ) {
      throw new UnauthorizedError('主项目身份断言重放标识无效');
    }
    const key = this._buildKey(jti);

    if (!this.redisClient) {
      for (const [storedKey, expiry] of this.memory.entries()) {
        if (expiry <= nowSeconds) this.memory.delete(storedKey);
      }
      if (this.memory.has(key)) {
        throw new UnauthorizedError('主项目身份断言已被使用');
      }
      this.memory.set(key, nowSeconds + ttlSeconds);
      return true;
    }

    try {
      const result = await this.redisClient.set(key, '1', 'EX', ttlSeconds, 'NX');
      if (result !== 'OK') {
        throw new UnauthorizedError('主项目身份断言已被使用');
      }
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new AppError(
        'SSO 身份断言重放保护暂时不可用',
        503,
        'SSO_REPLAY_GUARD_UNAVAILABLE'
      );
    }
  }
}

function createDefaultReplayGuard() {
  // Jest 单测使用实例内原子 Map；运行环境使用 Redis SET NX，覆盖多实例部署。
  if (process.env.NODE_ENV === 'test') return new SsoAssertionReplayGuard();
  return new SsoAssertionReplayGuard({ redisClient: require('../config/redis') });
}

module.exports = {
  SsoAssertionReplayGuard,
  createDefaultReplayGuard
};
