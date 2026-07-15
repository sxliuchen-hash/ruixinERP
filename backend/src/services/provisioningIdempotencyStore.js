'use strict';

const crypto = require('crypto');
const { AppError } = require('../utils/errors');

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

class MemoryProvisioningIdempotencyStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.results = new Map();
    this.locks = new Map();
  }

  _resultKey(key) {
    return hashKey(key);
  }

  _lockKey(namespace, key) {
    return `${namespace}:${hashKey(key)}`;
  }

  _purge() {
    const now = this.now();
    for (const [key, value] of this.results.entries()) {
      if (value.expiresAt <= now) this.results.delete(key);
    }
    for (const [key, value] of this.locks.entries()) {
      if (value.expiresAt <= now) this.locks.delete(key);
    }
  }

  async getResult(key) {
    this._purge();
    return this.results.get(this._resultKey(key))?.value || null;
  }

  async saveResult(key, value, ttlMs) {
    this._purge();
    this.results.set(this._resultKey(key), {
      value,
      expiresAt: this.now() + ttlMs
    });
    return true;
  }

  async acquireLock(namespace, key, owner, ttlMs) {
    this._purge();
    const lockKey = this._lockKey(namespace, key);
    const existing = this.locks.get(lockKey);
    if (existing) return { acquired: false, owner: existing.owner };
    this.locks.set(lockKey, { owner, expiresAt: this.now() + ttlMs });
    return { acquired: true, owner };
  }

  async getLockOwner(namespace, key) {
    this._purge();
    return this.locks.get(this._lockKey(namespace, key))?.owner || null;
  }

  async releaseLock(namespace, key, owner) {
    this._purge();
    const lockKey = this._lockKey(namespace, key);
    if (this.locks.get(lockKey)?.owner !== owner) return false;
    this.locks.delete(lockKey);
    return true;
  }
}

class RedisProvisioningIdempotencyStore {
  constructor({ redisClient }) {
    this.redisClient = redisClient;
  }

  _resultKey(key) {
    return `provision:result:${hashKey(key)}`;
  }

  _lockKey(namespace, key) {
    return `provision:lock:${namespace}:${hashKey(key)}`;
  }

  async _run(operation) {
    try {
      return await operation();
    } catch (_error) {
      throw new AppError(
        'Employee 建档幂等服务暂时不可用',
        503,
        'PROVISION_IDEMPOTENCY_UNAVAILABLE'
      );
    }
  }

  async getResult(key) {
    return this._run(async () => {
      const raw = await this.redisClient.get(this._resultKey(key));
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (_error) {
        throw new Error('invalid provisioning idempotency result');
      }
    });
  }

  async saveResult(key, value, ttlMs) {
    return this._run(async () => {
      await this.redisClient.set(
        this._resultKey(key),
        JSON.stringify(value),
        'PX',
        ttlMs
      );
      return true;
    });
  }

  async acquireLock(namespace, key, owner, ttlMs) {
    return this._run(async () => {
      const lockKey = this._lockKey(namespace, key);
      const result = await this.redisClient.set(lockKey, owner, 'PX', ttlMs, 'NX');
      if (result === 'OK') return { acquired: true, owner };
      return { acquired: false, owner: await this.redisClient.get(lockKey) };
    });
  }

  async getLockOwner(namespace, key) {
    return this._run(() => this.redisClient.get(this._lockKey(namespace, key)));
  }

  async releaseLock(namespace, key, owner) {
    return this._run(async () => {
      const result = await this.redisClient.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        1,
        this._lockKey(namespace, key),
        owner
      );
      return result === 1;
    });
  }
}

function createDefaultProvisioningIdempotencyStore() {
  if (process.env.NODE_ENV === 'test') return new MemoryProvisioningIdempotencyStore();
  return new RedisProvisioningIdempotencyStore({ redisClient: require('../config/redis') });
}

module.exports = {
  MemoryProvisioningIdempotencyStore,
  RedisProvisioningIdempotencyStore,
  createDefaultProvisioningIdempotencyStore,
  hashKey
};
