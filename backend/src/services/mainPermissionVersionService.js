'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { AppError, UnauthorizedError } = require('../utils/errors');
const { getMainSsoConfig } = require('../config/mainSso');

class MainPermissionVersionService {
  constructor({ httpClient = axios, now = () => Date.now() } = {}) {
    this.httpClient = httpClient;
    this.now = now;
    this.cache = new Map();
  }

  clearCache(userId) {
    if (userId === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(Number(userId));
  }

  getCached(userId) {
    const cached = this.cache.get(Number(userId));
    if (!cached || cached.expiresAt <= this.now()) {
      this.cache.delete(Number(userId));
      return null;
    }
    return cached.permissionVersion;
  }

  validateBusinessCredentials(config) {
    if (!config.businessClientId || !config.businessClientSecret) {
      throw new AppError('主项目业务 API 凭证未配置', 503, 'MAIN_API_CONFIGURATION_ERROR');
    }
    if (
      (config.clientId && config.businessClientId === config.clientId) ||
      (config.clientSecret && config.businessClientSecret === config.clientSecret)
    ) {
      throw new AppError(
        '主项目业务 API 的 Client ID 和 Client Secret 均不得复用 SSO 兑换凭证',
        503,
        'MAIN_API_CONFIGURATION_ERROR'
      );
    }
  }

  async getCurrentPermissionVersion(userId, { forceRefresh = false } = {}) {
    const normalizedUserId = Number(userId);
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
      throw new UnauthorizedError('ERP 会话用户标识无效');
    }

    if (!forceRefresh) {
      const cached = this.getCached(normalizedUserId);
      if (cached !== null) return cached;
    }

    const config = getMainSsoConfig({ includePublicKey: false });
    this.validateBusinessCredentials(config);
    const endpointPath = config.permissionVersionPath.replace(
      ':userId',
      encodeURIComponent(normalizedUserId)
    );

    let response;
    try {
      response = await this.httpClient.get(`${config.baseUrl}${endpointPath}`, {
        timeout: config.timeoutMs,
        headers: {
          [config.businessClientIdHeader]: config.businessClientId,
          [config.businessClientSecretHeader]: config.businessClientSecret
        }
      });
    } catch (error) {
      logger.warn('主项目权限版本查询失败', {
        userId: normalizedUserId,
        status: error.response?.status || 0,
        code: error.code || 'HTTP_ERROR'
      });
      throw new AppError('主项目权限服务暂时不可用', 503, 'MAIN_PERMISSION_VERSION_UNAVAILABLE');
    }

    const payload = response?.data?.data || response?.data || {};
    const permissionVersion = payload.permissionVersion;
    if (!Number.isSafeInteger(permissionVersion) || permissionVersion < 0) {
      throw new AppError('主项目权限版本响应无效', 503, 'MAIN_PERMISSION_VERSION_INVALID');
    }

    this.cache.set(normalizedUserId, {
      permissionVersion,
      expiresAt: this.now() + Math.min(config.permissionVersionCacheTtlMs, 300000)
    });
    return permissionVersion;
  }

  async assertCurrentPermissionVersion(user, { forceRefresh = false } = {}) {
    if (user?.authSource !== 'main_sso') return true;

    const sessionVersion = Number(user.permissionVersion);
    const usedCachedVersion = !forceRefresh && this.getCached(user.id) !== null;
    let currentVersion = await this.getCurrentPermissionVersion(user.id, { forceRefresh });

    // 普通请求首次可能命中本实例的旧缓存。缓存与会话不一致时先实时确认，
    // 避免多实例部署中仅因本地缓存滞后而错误踢出有效会话。
    if (usedCachedVersion && currentVersion !== sessionVersion) {
      const cachedVersion = currentVersion;
      currentVersion = await this.getCurrentPermissionVersion(user.id, { forceRefresh: true });
      if (currentVersion !== cachedVersion) {
        require('./mainUserScopeService').clearCache(user.id);
      }
    }

    if (currentVersion !== sessionVersion) {
      this.clearCache(user.id);
      require('./mainUserScopeService').clearCache(user.id);
      throw new UnauthorizedError('权限已发生变更，请从主项目重新进入 ERP');
    }
    return true;
  }
}

module.exports = new MainPermissionVersionService();
module.exports.MainPermissionVersionService = MainPermissionVersionService;
