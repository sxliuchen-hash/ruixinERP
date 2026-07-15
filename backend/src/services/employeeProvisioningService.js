'use strict';

const crypto = require('crypto');
const Employee = require('../models/Employee');
const logger = require('../utils/logger');
const { AppError, ValidationError } = require('../utils/errors');
const { mapEmployeeWriteError } = require('./employeeService');
const {
  createDefaultProvisioningIdempotencyStore
} = require('./provisioningIdempotencyStore');

const EMPLOYEE_ROLES = new Set(['boss', 'partner', 'sales', 'purchase', 'admin']);
const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_IDEMPOTENCY_RECORDS = 10000;

class EmployeeProvisioningService {
  constructor({
    model = Employee,
    now = () => Date.now(),
    idempotencyTtlMs = DEFAULT_IDEMPOTENCY_TTL_MS,
    maxIdempotencyRecords = DEFAULT_MAX_IDEMPOTENCY_RECORDS,
    idempotencyStore = createDefaultProvisioningIdempotencyStore(),
    lockTtlMs = 30000,
    lockWaitMs = 5000,
    lockPollMs = 25,
    wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))
  } = {}) {
    this.model = model;
    this.now = now;
    this.idempotencyTtlMs = idempotencyTtlMs;
    this.maxIdempotencyRecords = maxIdempotencyRecords;
    this.idempotencyStore = idempotencyStore;
    this.lockTtlMs = lockTtlMs;
    this.lockWaitMs = lockWaitMs;
    this.lockPollMs = lockPollMs;
    this.wait = wait;
    this.idempotencyRecords = new Map();
    this.userQueues = new Map();
  }

  async provision({ userId, name, employeeRole, wechatUserId, idempotencyKey }) {
    const request = this._normalizeRequest({
      userId,
      name,
      employeeRole,
      wechatUserId,
      idempotencyKey
    });
    const fingerprint = this._fingerprint(request);
    this._pruneIdempotencyRecords();

    const existingRecord = this.idempotencyRecords.get(request.idempotencyKey);
    if (existingRecord) {
      if (existingRecord.fingerprint !== fingerprint) {
        throw new AppError(
          'Idempotency-Key 已用于不同的 Employee 建档请求',
          409,
          'IDEMPOTENCY_KEY_CONFLICT'
        );
      }
      return existingRecord.promise;
    }
    if (this.idempotencyRecords.size >= this.maxIdempotencyRecords) {
      throw new AppError(
        'Employee 建档幂等记录容量已满，请稍后重试',
        503,
        'PROVISION_IDEMPOTENCY_CAPACITY_EXCEEDED'
      );
    }

    const promise = this._enqueueUser(
      request.userId,
      () => this._provisionClusterSafe(request, fingerprint)
    );
    const record = {
      fingerprint,
      promise,
      expiresAt: this.now() + this.idempotencyTtlMs
    };
    this.idempotencyRecords.set(request.idempotencyKey, record);

    try {
      return await promise;
    } catch (error) {
      if (this.idempotencyRecords.get(request.idempotencyKey) === record) {
        this.idempotencyRecords.delete(request.idempotencyKey);
      }
      throw error;
    }
  }

  _normalizeRequest({ userId, name, employeeRole, wechatUserId, idempotencyKey }) {
    const normalizedUserId = Number(userId);
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedRole = typeof employeeRole === 'string' ? employeeRole.trim() : '';
    const normalizedKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    const normalizedWechatUserId = typeof wechatUserId === 'string' && wechatUserId.trim()
      ? wechatUserId.trim()
      : null;

    if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId <= 0) {
      throw new ValidationError('主项目用户 ID 无效');
    }
    if (!normalizedName || normalizedName.length > 50 || !EMPLOYEE_ROLES.has(normalizedRole)) {
      throw new ValidationError('Employee 建档身份字段无效');
    }
    if (normalizedWechatUserId && normalizedWechatUserId.length > 50) {
      throw new ValidationError('企微用户标识无效');
    }
    if (normalizedKey.length < 8 || normalizedKey.length > 200) {
      throw new ValidationError('Idempotency-Key 必须为 8～200 位字符串');
    }

    return {
      userId: normalizedUserId,
      name: normalizedName,
      employeeRole: normalizedRole,
      wechatUserId: normalizedWechatUserId,
      idempotencyKey: normalizedKey
    };
  }

  _fingerprint(request) {
    return crypto.createHash('sha256').update(JSON.stringify({
      userId: request.userId,
      name: request.name,
      employeeRole: request.employeeRole,
      wechatUserId: request.wechatUserId
    })).digest('hex');
  }

  _pruneIdempotencyRecords() {
    const now = this.now();
    for (const [key, record] of this.idempotencyRecords.entries()) {
      if (record.expiresAt <= now) this.idempotencyRecords.delete(key);
    }
  }

  async _enqueueUser(userId, task) {
    const previous = this.userQueues.get(userId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.userQueues.set(userId, current);
    try {
      return await current;
    } finally {
      if (this.userQueues.get(userId) === current) this.userQueues.delete(userId);
    }
  }

  _lockOwner(fingerprint) {
    return `${fingerprint}:${crypto.randomUUID()}`;
  }

  _ownerFingerprint(owner) {
    return typeof owner === 'string' ? owner.split(':', 1)[0] : '';
  }

  async _loadStoredResult(request, fingerprint) {
    const stored = await this.idempotencyStore.getResult(request.idempotencyKey);
    if (!stored) return null;
    if (stored.fingerprint !== fingerprint) {
      throw new AppError(
        'Idempotency-Key 已用于不同的 Employee 建档请求',
        409,
        'IDEMPOTENCY_KEY_CONFLICT'
      );
    }

    const employee = typeof this.model.findByPk === 'function'
      ? await this.model.findByPk(stored.employeeId)
      : await this.model.findOne({ where: { user_id: request.userId } });
    if (!employee || Number(employee.user_id) !== request.userId) {
      throw new AppError(
        'Employee 建档幂等结果对应资源已不存在',
        409,
        'PROVISION_IDEMPOTENCY_RESOURCE_MISSING'
      );
    }
    return { employee, created: stored.created === true };
  }

  async _waitForStoredResult(request, fingerprint, deadline) {
    while (this.now() < deadline) {
      const stored = await this._loadStoredResult(request, fingerprint);
      if (stored) return stored;
      const owner = await this.idempotencyStore.getLockOwner(
        'idempotency',
        request.idempotencyKey
      );
      if (!owner) return null;
      if (this._ownerFingerprint(owner) !== fingerprint) {
        throw new AppError(
          'Idempotency-Key 已用于不同的 Employee 建档请求',
          409,
          'IDEMPOTENCY_KEY_CONFLICT'
        );
      }
      await this.wait(this.lockPollMs);
    }
    throw new AppError(
      '相同 Employee 建档请求正在处理中，请稍后重试',
      409,
      'PROVISION_IDEMPOTENCY_IN_PROGRESS'
    );
  }

  async _acquireUserLock(userId, owner) {
    const deadline = this.now() + this.lockWaitMs;
    while (this.now() < deadline) {
      const result = await this.idempotencyStore.acquireLock(
        'user',
        String(userId),
        owner,
        this.lockTtlMs
      );
      if (result.acquired) return true;
      await this.wait(this.lockPollMs);
    }
    throw new AppError(
      '该用户的 Employee 建档请求正在处理中，请稍后重试',
      409,
      'PROVISION_USER_IN_PROGRESS'
    );
  }

  async _provisionClusterSafe(request, fingerprint) {
    const replay = await this._loadStoredResult(request, fingerprint);
    if (replay) return replay;

    const idempotencyOwner = this._lockOwner(fingerprint);
    const lock = await this.idempotencyStore.acquireLock(
      'idempotency',
      request.idempotencyKey,
      idempotencyOwner,
      this.lockTtlMs
    );
    if (!lock.acquired) {
      if (!lock.owner) return this._provisionClusterSafe(request, fingerprint);
      if (this._ownerFingerprint(lock.owner) !== fingerprint) {
        throw new AppError(
          'Idempotency-Key 已用于不同的 Employee 建档请求',
          409,
          'IDEMPOTENCY_KEY_CONFLICT'
        );
      }
      const waited = await this._waitForStoredResult(
        request,
        fingerprint,
        this.now() + this.lockWaitMs
      );
      if (waited) return waited;
      return this._provisionClusterSafe(request, fingerprint);
    }

    const userOwner = this._lockOwner(fingerprint);
    let userLocked = false;
    try {
      const replayAfterLock = await this._loadStoredResult(request, fingerprint);
      if (replayAfterLock) return replayAfterLock;

      await this._acquireUserLock(request.userId, userOwner);
      userLocked = true;
      const result = await this._provisionNormalized(request);
      await this.idempotencyStore.saveResult(request.idempotencyKey, {
        fingerprint,
        userId: request.userId,
        employeeId: Number(result.employee.id),
        created: result.created === true
      }, this.idempotencyTtlMs);
      return result;
    } finally {
      if (userLocked) {
        await this.idempotencyStore.releaseLock('user', String(request.userId), userOwner);
      }
      await this.idempotencyStore.releaseLock(
        'idempotency',
        request.idempotencyKey,
        idempotencyOwner
      );
    }
  }

  async _provisionNormalized({ userId, name, employeeRole, wechatUserId, idempotencyKey }) {
    const defaults = {
      user_id: userId,
      name,
      role: employeeRole
    };
    if (wechatUserId) defaults.wechat_userid = wechatUserId;

    let employee;
    let created;
    try {
      [employee, created] = await this.model.findOrCreate({
        where: { user_id: userId },
        defaults
      });
    } catch (error) {
      if (error?.name !== 'SequelizeUniqueConstraintError') {
        throw mapEmployeeWriteError(error);
      }
      employee = typeof this.model.findOne === 'function'
        ? await this.model.findOne({ where: { user_id: userId } })
        : null;
      if (!employee) throw mapEmployeeWriteError(error);
      created = false;
    }

    if (!created) {
      const updates = {};
      if (employee.name !== defaults.name) updates.name = defaults.name;
      if (employee.role !== employeeRole) updates.role = employeeRole;
      // 主项目当前可能传 null；未知外部值不能清空 ERP 已维护的企微绑定。
      if (wechatUserId && employee.wechat_userid !== wechatUserId) {
        updates.wechat_userid = wechatUserId;
      }
      if (Object.keys(updates).length > 0) {
        try {
          await employee.update(updates);
        } catch (error) {
          throw mapEmployeeWriteError(error);
        }
      }
    }

    logger.info('主项目 Employee 建档完成', {
      userId,
      employeeId: employee.id,
      created,
      // 仅记录存在性，不记录幂等键原文。
      idempotencyKeyPresent: Boolean(idempotencyKey)
    });

    return { employee, created };
  }
}

module.exports = new EmployeeProvisioningService();
module.exports.EmployeeProvisioningService = EmployeeProvisioningService;
