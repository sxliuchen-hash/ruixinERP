'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { getMainSsoConfig } = require('../config/mainSso');
const { AppError } = require('../utils/errors');

function teamScopeUnavailable(message = '主项目团队数据范围服务暂时不可用') {
  return new AppError(message, 503, 'MAIN_TEAM_SCOPE_UNAVAILABLE');
}

class MainUserScopeService {
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
    if (!cached) return null;
    if (cached.expiresAt <= this.now()) {
      this.cache.delete(Number(userId));
      return null;
    }
    return [...cached.userIds];
  }

  async getTeamUserIds(userId) {
    const normalizedUserId = Number(userId);
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) return [];

    const cached = this.getCached(normalizedUserId);
    if (cached) return cached;

    const config = getMainSsoConfig({ includePublicKey: false });
    if (!config.businessClientId || !config.businessClientSecret) {
      logger.warn('团队数据范围查询失败：主项目业务 API 凭证未配置', { userId: normalizedUserId });
      throw teamScopeUnavailable('主项目团队数据范围服务凭证未配置');
    }
    if (
      (config.clientId && config.businessClientId === config.clientId) ||
      (config.clientSecret && config.businessClientSecret === config.clientSecret)
    ) {
      logger.warn('团队数据范围查询失败：业务 API 复用了 SSO 兑换 Client ID 或 Secret', {
        userId: normalizedUserId
      });
      throw teamScopeUnavailable('主项目团队数据范围服务凭证配置无效');
    }

    const endpointPath = config.teamScopePath.replace(':userId', encodeURIComponent(normalizedUserId));

    try {
      const response = await this.httpClient.get(`${config.baseUrl}${endpointPath}`, {
        timeout: config.timeoutMs,
        headers: {
          [config.businessClientIdHeader]: config.businessClientId,
          [config.businessClientSecretHeader]: config.businessClientSecret
        }
      });

      const payload = response?.data?.data || response?.data || {};
      const rawIds = payload.teamUserIds;
      if (
        !Array.isArray(rawIds) ||
        rawIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
        new Set(rawIds).size !== rawIds.length ||
        !rawIds.includes(normalizedUserId)
      ) {
        logger.warn('主项目团队数据范围响应格式无效', { userId: normalizedUserId });
        throw teamScopeUnavailable('主项目团队数据范围响应无效');
      }

      const userIds = [...rawIds];

      this.cache.set(normalizedUserId, {
        userIds,
        expiresAt: this.now() + Math.min(config.teamScopeCacheTtlMs, 300000)
      });
      return [...userIds];
    } catch (error) {
      if (error?.code === 'MAIN_TEAM_SCOPE_UNAVAILABLE') throw error;
      logger.warn('主项目团队数据范围查询失败，已拒绝 team scope 请求', {
        userId: normalizedUserId,
        status: error.response?.status || 0,
        code: error.code || 'HTTP_ERROR'
      });
      throw teamScopeUnavailable();
    }
  }
}

module.exports = new MainUserScopeService();
module.exports.MainUserScopeService = MainUserScopeService;
module.exports.teamScopeUnavailable = teamScopeUnavailable;
